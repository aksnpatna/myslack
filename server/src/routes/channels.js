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

    const { rows } = await pool.query(
      `SELECT
         m.id,
         m.channel_id                                       AS "channelId",
         m.parent_id                                        AS "parentId",
         m.body                                             AS content,
         m.created_at                                       AS "createdAt",
         COALESCE(cm.display_alias, m.author_id::text)      AS sender,
         COUNT(r.id)::int                                   AS "replyCount"
       FROM messages m
       LEFT JOIN channel_members cm
             ON cm.user_id = m.author_id AND cm.channel_id = m.channel_id
       LEFT JOIN messages r ON r.parent_id = m.id
       WHERE m.channel_id = $1
       GROUP BY m.id, m.channel_id, m.parent_id, m.body, m.created_at,
                cm.display_alias, m.author_id
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [channelId],
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
}
