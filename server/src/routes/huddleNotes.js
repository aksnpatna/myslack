import crypto from 'crypto';
import pool from '../db/pool.js';

const BROKER_BACKEND = process.env.BROKER_BACKEND_URL || 'http://localhost:8001';
const BROKER_JWT_SECRET = 'broker-secret-key-change-in-production';
const BROKER_SERVICE_ID = 'myslack-huddle-bot';

function createBrokerJWT() {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: BROKER_SERVICE_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const hb = b64(header);
  const pb = b64(payload);
  const sig = crypto.createHmac('sha256', BROKER_JWT_SECRET).update(`${hb}.${pb}`).digest('base64url');
  return `${hb}.${pb}.${sig}`;
}

export default async function huddleNotesRoutes(fastify, options) {

  /**
   * POST /api/huddles/notes/transcribe
   * Query:  sessionId, channelId, identity, sequenceNum
   * Body:   multipart audio file (webm/ogg, broker-backend handles ffmpeg conversion)
   * Proxies to broker-backend faster-whisper, stores transcript in DB.
   */
  fastify.post('/api/huddles/notes/transcribe', async (request, reply) => {
    const { sessionId, channelId, identity, sequenceNum } = request.query;
    if (!sessionId || !channelId) {
      return reply.code(400).send({ error: 'sessionId and channelId are required' });
    }

    const part = await request.file();
    if (!part) {
      return reply.code(400).send({ error: 'No audio file provided' });
    }

    const buf = await part.toBuffer();
    if (buf.length === 0) {
      return reply.code(400).send({ error: 'Empty audio chunk' });
    }

    const seq = parseInt(sequenceNum ?? '0', 10);
    const brokerJWT = createBrokerJWT();

    try {
      // Forward raw webm to broker-backend — it handles ffmpeg conversion internally
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: part.mimetype || 'audio/webm' }), part.filename || 'chunk.webm');

      const transcribeRes = await fetch(
        `${BROKER_BACKEND}/api/broker/transcribe?token=${encodeURIComponent(brokerJWT)}`,
        { method: 'POST', body: fd },
      );

      let transcript = '';
      if (transcribeRes.ok) {
        const result = await transcribeRes.json();
        transcript = result.transcript || '';
      } else {
        console.error('[huddleNotes] Broker transcribe failed:', await transcribeRes.text().catch(() => ''));
      }

      if (transcript.trim()) {
        await pool.query(
          `INSERT INTO huddle_transcripts (channel_id, session_id, speaker_identity, segment, sequence_num)
           VALUES ($1, $2, $3, $4, $5)`,
          [channelId, sessionId, identity || 'unknown', transcript, seq],
        );
      }

      return reply.send({ success: true, transcript, sequenceNum: seq });
    } catch (err) {
      console.error('[huddleNotes] Transcribe error:', err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/huddles/notes/end
   * Body: { sessionId, channelId }
   * Collects all transcripts for the session, sends to broker-backend summarizer.
   * Returns the summary text for the client to broadcast as a message.
   */
  fastify.post('/api/huddles/notes/end', async (request, reply) => {
    const { sessionId, channelId } = request.body ?? {};
    if (!sessionId || !channelId) {
      return reply.code(400).send({ error: 'sessionId and channelId are required' });
    }

    const { rows } = await pool.query(
      `SELECT speaker_identity, segment, sequence_num
       FROM huddle_transcripts
       WHERE session_id = $1 AND channel_id = $2
       ORDER BY sequence_num ASC`,
      [sessionId, channelId],
    );

    const fullTranscript = rows.map(r => `[${r.speaker_identity}]: ${r.segment}`).join('\n\n');

    if (!fullTranscript.trim()) {
      return reply.code(200).send({ success: false, reason: 'no_transcript' });
    }

    const summaryRes = await fetch(`${BROKER_BACKEND}/api/broker/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: fullTranscript }),
    });

    if (!summaryRes.ok) {
      console.error('[huddleNotes] Broker summarize failed:', await summaryRes.text().catch(() => ''));
      return reply.code(500).send({ error: 'Summarization failed' });
    }

    const result = await summaryRes.json();
    const extracted = result.extracted_data ?? {};
    const participants = [...new Set(rows.map(r => r.speaker_identity))];

    await pool.query(
      `INSERT INTO huddle_summaries (channel_id, session_id, summary_json, provider)
       VALUES ($1, $2, $3, $4)`,
      [channelId, sessionId, JSON.stringify(extracted), result.provider ?? 'unknown'],
    );

    return reply.send({
      success: true,
      summary: extracted,
      summaryText: formatHuddleSummary(extracted, participants),
      sessionId,
    });
  });

  /**
   * GET /api/huddles/notes/sessions/:channelId
   * Returns list of past huddle summaries for a channel.
   */
  fastify.get('/api/huddles/notes/sessions/:channelId', async (request, reply) => {
    const { channelId } = request.params;
    const { rows } = await pool.query(
      `SELECT hs.id, hs.session_id, hs.summary_json->>'overview' AS overview,
              hs.provider, hs.created_at,
              (SELECT COUNT(*) FROM huddle_transcripts ht WHERE ht.session_id = hs.session_id) AS segment_count
       FROM huddle_summaries hs
       WHERE hs.channel_id = $1
       ORDER BY hs.created_at DESC
       LIMIT 20`,
      [channelId],
    );
    return reply.send(rows);
  });
}

function formatHuddleSummary(extracted, participants) {
  const lines = ['📝 **Huddle Summary**', ''];

  const overview = extracted.summary
    || extracted.discussion_summary
    || (extracted.detailed_summary?.overview);

  if (overview) {
    lines.push(`**Overview:** ${overview}`, '');
  }

  const actionItems = extracted.action_items
    || extracted.detailed_summary?.next_steps
    || [];
  if (actionItems.length > 0) {
    lines.push('**Action Items:**');
    actionItems.forEach(item => lines.push(`• ${item}`));
    lines.push('');
  }

  const keyPoints = extracted.key_points
    || extracted.discussed_topics
    || extracted.detailed_summary?.key_points
    || [];
  if (keyPoints.length > 0) {
    lines.push('**Key Points:**');
    keyPoints.forEach(kp => lines.push(`• ${kp}`));
    lines.push('');
  }

  if (participants.length > 0) {
    lines.push(`**Participants:** ${participants.join(', ')}`);
    lines.push('');
  }

  const nextMeeting = extracted.meeting_suggestion || extracted.next_meeting_date;
  if (nextMeeting) {
    lines.push(`**Next Steps:** ${nextMeeting}`);
  }

  const urgency = extracted.urgency;
  const sentiment = extracted.sentiment;
  if (urgency && sentiment) {
    lines.push('');
    lines.push(`_Urgency: ${urgency} | Sentiment: ${sentiment}_`);
  }

  return lines.join('\n');
}
