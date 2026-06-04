import pool, { verifyChannelAccess }              from '../db/pool.js';
import { handleBotMention }                        from '../utils/botHandler.js';
import { validateAndSanitizeMessage, BLOCKED_CONTENT } from '../utils/messageGuard.js';
import { handleAgentMention, registerBroadcaster } from '../utils/executiveAgent.js';

const QUARANTINE_NOTICE =
  '\u26a0\ufe0f [QUARANTINE NOTICE: A message in this stream was intercepted and blocked ' +
  'due to a direct violation of our platform Terms of Service (sharing personal names, ' +
  'rates, or off-platform contact details). The administration team has been automatically notified.]';

// connId -> { socket, userId, channelId, role }
const clients = new Map();

function broadcastToChannel(channelId, payload) {
  const frame = JSON.stringify(payload);
  for (const [, client] of clients) {
    if (client.channelId === channelId && client.socket.readyState === 1) {
      client.socket.send(frame);
    }
  }
}

/** Sends a payload to every connected admin socket regardless of current channel. */
function broadcastToAdmins(payload) {
  const frame = JSON.stringify(payload);
  for (const [, client] of clients) {
    if (client.role === 'admin' && client.socket.readyState === 1) {
      client.socket.send(frame);
    }
  }
}

// Register so non-WS code paths (e.g. auth.js) can push real-time frames.
registerBroadcaster(broadcastToChannel);

export default async function chatRoutes(fastify, options) {

  fastify.get('/ws/chat', { websocket: true }, (socket, request) => {
    const connId = crypto.randomUUID();
    clients.set(connId, { socket, userId: null, channelId: null });

    socket.on('message', async (raw) => {
      let payload;
      try { payload = JSON.parse(raw.toString()); } catch { return; }

      const { userId, channelId, content, parentId = null, type, attachment = null } = payload;
      if (!userId || !channelId) return;

      // ── canvas_draw: transient coordinate fanout — no DB write ──────────
      // Payload: { type, channelId, x, y, prevX, prevY, color, brushSize, isDrawing }
      if (type === 'canvas_draw') {
        // Lightweight auth: socket must already be subscribed (has userId bound)
        const existingClient = clients.get(connId);
        if (existingClient?.userId !== userId) return;
        broadcastToChannel(channelId, {
          type:      'canvas_draw',
          channelId,
          fromConn:  connId,          // lets the sender filter their own echo
          x:         payload.x,
          y:         payload.y,
          prevX:     payload.prevX,
          prevY:     payload.prevY,
          color:     payload.color     ?? '#ffffff',
          brushSize: payload.brushSize ?? 4,
          isDrawing: payload.isDrawing ?? true,
        });
        return;
      }

      // Security guard — silently drop unauthorized access attempts
      const allowed = await verifyChannelAccess(userId, channelId);
      if (!allowed) { socket.close(1008, 'Forbidden'); return; }

      // ── Subscribe packet: bind channel without sending a message ────────
      // Clients send { type:'subscribe', userId, channelId } to register for
      // broadcasts (e.g. compliance alerts) without posting content.
      if (type === 'subscribe' || !content) {
        const { rows: subRows } = await pool.query(
          `SELECT role FROM users WHERE id = $1`, [userId],
        );
        clients.set(connId, { socket, userId, channelId, role: subRows[0]?.role ?? 'client' });
        return;
      }

      // Bind connection metadata on first valid message (includes role for admin broadcasts)
      clients.set(connId, { socket, userId, channelId, role: null });

      // De-anonymization shield: resolve display alias + sender role
      // LEFT JOIN so admin users without a channel_members row still get their
      // correct role (admins are allowed into any channel by verifyChannelAccess).
      const { rows: aliasRows } = await pool.query(
        `SELECT cm.display_alias, u.role
         FROM users u
         LEFT JOIN channel_members cm
               ON cm.user_id = u.id AND cm.channel_id = $2
         WHERE u.id = $1`,
        [userId, channelId],
      );
      const senderIdentity = aliasRows[0]?.display_alias ?? userId;
      const senderRole     = aliasRows[0]?.role ?? 'client';

      // Upgrade connection entry with resolved role
      clients.set(connId, { socket, userId, channelId, role: senderRole });

      // ── Message guard ──────────────────────────────────
      let safeContent  = content;
      let filteredContent = content;
      if (senderRole !== 'admin') {
        const alias = aliasRows[0]?.display_alias ?? 'User';
        const guard = await validateAndSanitizeMessage(content, alias);
        if (!guard.isSafe || !guard.sanitizedContent.trim()) {
          safeContent    = BLOCKED_CONTENT;
          filteredContent = BLOCKED_CONTENT;

          // ─ Fetch offender identity for audit context ─────────────
          const { rows: offenderRows } = await pool.query(
            'SELECT username, email FROM users WHERE id = $1',
            [userId],
          );
          const offender = offenderRows[0];

          // ─ 1. Admin telemetry: real-time broadcast to all connected admins ─
          const adminAlert = {
            type:              'system_admin_alert',
            sender:            '\ud83d\udd12 Compliance System',
            event:             'POLICY_VIOLATION',
            offendingUserId:   userId,
            offenderEmail:     offender?.email    ?? userId,
            offenderUsername:  offender?.username ?? userId,
            channelId,
            rawBlockedContent: content,
            flaggedReason:     guard.flaggedReason ?? 'policy violation',
            createdAt:         new Date().toISOString(),
          };
          broadcastToAdmins(adminAlert);
          console.warn('[messageGuard][ALERT]', JSON.stringify(adminAlert));

          // Persist to quarantine_logs for admin audit panel
          pool.query(
            `INSERT INTO quarantine_logs (violating_user_id, channel_id, raw_blocked_text, flagged_reason)
             VALUES ($1, $2, $3, $4)`,
            [userId, channelId, content, guard.flaggedReason ?? 'policy violation'],
          ).catch((err) => console.error('[quarantine] log insert failed:', err.message));

          // ─ 2. Public quarantine notice: system frame to the offending channel ─
          broadcastToChannel(channelId, {
            id:        crypto.randomUUID(),
            type:      'system_quarantine',
            channelId,
            sender:    '\u26a0\ufe0f System',
            content:   QUARANTINE_NOTICE,
            parentId:  null,
            createdAt: new Date().toISOString(),
          });
        } else {
          safeContent = guard.sanitizedContent;
          filteredContent = guard.sanitizedContent;
        }
      } else {
        // Admin messages: run pre-screen only (fast regex) for sanitized version
        const { isSafe, sanitizedContent } = await validateAndSanitizeMessage(content, 'admin');
        if (!isSafe || !sanitizedContent.trim()) {
          // Admin sees raw, others see sanitized; also store raw for admin audit
          filteredContent = BLOCKED_CONTENT;
        } else {
          filteredContent = sanitizedContent;
        }
      }

      // Persist to messages table (both raw and sanitized)
      const { rows: msgRows } = await pool.query(
        `INSERT INTO messages (channel_id, author_id, parent_id, body, sanitized_body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [channelId, userId, parentId, content, filteredContent],
      );

      // Trigger bot RAG pipeline if message mentions @bot
      if (safeContent.includes('@bot')) {
        handleBotMention(userId, channelId, safeContent, broadcastToChannel).catch(
          (err) => console.error('[bot] unhandled error', err.message),
        );
      }

      // Trigger executive agent if message mentions @agent or @sovereign-01
      if (safeContent.includes('@agent') || /\@sovereign-01/i.test(safeContent)) {
        handleAgentMention(
          userId, channelId, safeContent, senderIdentity, senderRole,
          broadcastToChannel, msgRows[0].id,
        ).catch((err) => console.error('[agent] unhandled error', err.message));
      }

      const broadcast = {
        id:        msgRows[0].id,
        channelId,
        sender:    senderIdentity,
        content:   safeContent,
        sanitizedContent: filteredContent,
        parentId,
        createdAt: msgRows[0].created_at,
        ...(attachment && { attachment }),
      };

      // Role-based broadcast: admins see raw, members see sanitized
      const adminFrame   = JSON.stringify({ ...broadcast, content: safeContent });
      const memberFrame  = JSON.stringify({ ...broadcast, content: filteredContent });
      for (const [, client] of clients) {
        if (client.channelId === channelId && client.socket.readyState === 1) {
          client.socket.send(client.role === 'admin' ? adminFrame : memberFrame);
        }
      }
    });

    socket.on('close', () => clients.delete(connId));
    socket.on('error', (err) => {
      console.error('[ws] socket error', err.message);
      clients.delete(connId);
    });
  });
}
