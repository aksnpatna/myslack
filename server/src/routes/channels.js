import pool, { verifyChannelAccess } from '../db/pool.js';

export default async function channelRoutes(fastify) {
  // GET /api/channels/:channelId/messages — last 200 messages with sender + reply count
  fastify.get('/api/channels/:channelId/messages', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id: userId, role } = request.user;
    const { channelId } = request.params;

    // Admins can read any channel; others must be a member
    if (role !== 'admin') {
      const allowed = await verifyChannelAccess(userId, channelId);
      if (!allowed) return reply.code(403).send({ error: 'Forbidden' });
    }

    // Admins see real usernames; members see their identity-mapped obfuscated code
    // (falling back to channel display_alias, then author UUID).
    const { rows } = await pool.query(
      `SELECT
         m.id,
         m.channel_id                                        AS "channelId",
         m.parent_id                                         AS "parentId",
         m.body                                              AS content,
         m.created_at                                        AS "createdAt",
         CASE
           WHEN $2 = 'admin' THEN COALESCE(u.username, m.author_id::text)
           ELSE COALESCE(cm.display_alias, im.obfuscated_id, m.author_id::text)
         END                                                 AS sender,
         COUNT(r.id)::int                                    AS "replyCount"
       FROM messages m
       LEFT JOIN users u            ON u.id = m.author_id
       LEFT JOIN channel_members cm ON cm.user_id = m.author_id
                                   AND cm.channel_id = m.channel_id
       LEFT JOIN identity_mappings im ON im.user_id = m.author_id
       LEFT JOIN messages r         ON r.parent_id = m.id
       WHERE m.channel_id = $1
       GROUP BY m.id, m.channel_id, m.parent_id, m.body, m.created_at,
                u.username, cm.display_alias, im.obfuscated_id, m.author_id
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [channelId, role],
    );
    return rows;
  });

  // GET /api/channels — returns channels visible to the authenticated user
  fastify.get('/api/channels', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const { id: userId, role } = request.user;

    if (role === 'admin') {
      const { rows } = await pool.query(
        `SELECT id, slug, name, is_private FROM channels ORDER BY name`,
      );
      return rows;
    }

    const { rows } = await pool.query(
      `SELECT c.id, c.slug, c.name, c.is_private
       FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id
       WHERE cm.user_id = $1
       ORDER BY c.name`,
      [userId],
    );
    return rows;
  });

  // ── Phase 4: Topic routes ─────────────────────────────────────────────────

  const VALID_TOPIC_STATUSES = ['ACTIVE', 'MONITORING', 'RESOLVING'];

  // GET /api/channels/:channelId/topics
  fastify.get('/api/channels/:channelId/topics', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id: userId, role } = request.user;
    const { channelId } = request.params;

    if (role !== 'admin') {
      const allowed = await verifyChannelAccess(userId, channelId);
      if (!allowed) return reply.code(403).send({ error: 'Forbidden' });
    }

    const { rows } = await pool.query(
      `SELECT id, channel_id AS "channelId", slug, name, status, created_at AS "createdAt"
       FROM topics
       WHERE channel_id = $1
       ORDER BY created_at ASC`,
      [channelId],
    );
    return rows;
  });

  // POST /api/channels/:channelId/topics — create a topic (admin only)
  fastify.post('/api/channels/:channelId/topics', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { role, id: userId } = request.user;
    if (role !== 'admin') return reply.code(403).send({ error: 'Admin only.' });

    const { channelId } = request.params;
    const { name, status = 'ACTIVE' } = request.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: '`name` is required.' });
    }
    if (!VALID_TOPIC_STATUSES.includes(status)) {
      return reply.code(400).send({ error: `status must be one of: ${VALID_TOPIC_STATUSES.join(', ')}` });
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
      const { rows } = await pool.query(
        `INSERT INTO topics (channel_id, slug, name, status, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, channel_id AS "channelId", slug, name, status, created_at AS "createdAt"`,
        [channelId, slug, name.trim(), status, userId],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: `Topic slug '${slug}' already exists in this channel.` });
      }
      if (err.code === '23503') {
        return reply.code(404).send({ error: 'Channel not found.' });
      }
      request.log.error(err, 'topics: create failed');
      return reply.code(500).send({ error: 'Internal server error.' });
    }
  });

  // PATCH /api/channels/:channelId/topics/:topicId — update topic status
  fastify.patch('/api/channels/:channelId/topics/:topicId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { role } = request.user;
    if (role !== 'admin') return reply.code(403).send({ error: 'Admin only.' });

    const { channelId, topicId } = request.params;
    const { status } = request.body ?? {};

    if (!VALID_TOPIC_STATUSES.includes(status)) {
      return reply.code(400).send({ error: `status must be one of: ${VALID_TOPIC_STATUSES.join(', ')}` });
    }

    const { rowCount, rows } = await pool.query(
      `UPDATE topics SET status = $1
       WHERE id = $2 AND channel_id = $3
       RETURNING id, slug, name, status`,
      [status, topicId, channelId],
    );

    if (rowCount === 0) return reply.code(404).send({ error: 'Topic not found.' });
    return reply.send(rows[0]);
  });
}
