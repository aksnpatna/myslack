import { verifyChannelAccess } from '../db/pool.js';
import pool                    from '../db/pool.js';

const OPENAI_API_URL = 'https://api.openai.com/v1';
const BOT_SENDER     = { username: 'Project Assistant Bot', role: 'bot' };

async function embedText(text) {
  const res = await fetch(`${OPENAI_API_URL}/embeddings`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body:    JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!res.ok) throw new Error(`Embedding error ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return `[${data[0].embedding.join(',')}]`;
}

async function retrieveChunks(queryVec, channelId) {
  // Cosine distance search scoped strictly to chunks whose source file
  // traces back to a message inside this channel — prevents cross-project data leakage.
  const { rows } = await pool.query(
    `SELECT de.chunk_text,
            de.embedding <=> $1::halfvec AS distance
     FROM   document_embeddings de
     JOIN   attachments          a  ON a.id         = de.file_id
     JOIN   messages             m  ON m.id         = a.message_id
     WHERE  m.channel_id = $2
     ORDER  BY distance ASC
     LIMIT  3`,
    [queryVec, channelId],
  );
  return rows.map((r) => r.chunk_text);
}

async function chatCompletion(question, chunks) {
  const context = chunks
    .map((c, i) => `[Source ${i + 1}]\n${c}`)
    .join('\n\n');

  const res = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model:    'gpt-4o-mini',
      messages: [
        {
          role:    'system',
          content: `You are a project assistant. Answer using only the context below.\n\n${context}`,
        },
        { role: 'user', content: question },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Chat completion error ${res.status}: ${await res.text()}`);
  const { choices } = await res.json();
  return choices[0].message.content.trim();
}

/**
 * Call this from the WebSocket message handler when a message includes '@bot'.
 * @param {string}   userId
 * @param {string}   channelId
 * @param {string}   messageContent
 * @param {Function} broadcast  — fn(channelId, payload) wired from chat.js
 */
export async function handleBotMention(userId, channelId, messageContent, broadcast) {
  if (!messageContent.includes('@bot')) return;

  // Access shield
  const allowed = await verifyChannelAccess(userId, channelId);
  if (!allowed) return;

  const question = messageContent.replace(/@bot/gi, '').trim();
  if (!question) return;

  try {
    const queryVec = await embedText(question);
    const chunks   = await retrieveChunks(queryVec, channelId);

    const answer = chunks.length
      ? await chatCompletion(question, chunks)
      : "I couldn't find any relevant documents in this channel.";

    broadcast(channelId, {
      sender:    BOT_SENDER.username,
      role:      BOT_SENDER.role,
      channelId,
      content:   answer,
      parentId:  null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[bot] handleBotMention error', err.message);
    broadcast(channelId, {
      sender:    BOT_SENDER.username,
      role:      BOT_SENDER.role,
      channelId,
      content:   'Bot encountered an error processing your request.',
      parentId:  null,
      createdAt: new Date().toISOString(),
    });
  }
}
