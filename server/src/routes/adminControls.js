import pool from '../db/pool.js';

export default async function adminControls(fastify) {

  // Reusable admin guard — verifies JWT and role in one step.
  async function requireAdmin(request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ success: false, message: 'Unauthorized.' });
    }
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ success: false, message: 'Admin privileges required.' });
    }
  }


  // GET /api/admin/users — full user list for the admin panel
  fastify.get('/api/admin/users', {
    onRequest: [requireAdmin],
  }, async (request) => {
    const { rows } = await pool.query(
      `SELECT id, email, username, role, status FROM users ORDER BY email`,
    );
    return rows;
  });


  // POST /api/admin/channels
  // Creates a new channel. Derives a URL-safe slug from the name.
  fastify.post('/api/admin/channels', {
    onRequest: [requireAdmin],
  }, async (request, reply) => {
    const { name, isPrivate = false } = request.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ success: false, message: '`name` is required.' });
    }

    const trimmedName = name.trim();
    const slug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    try {
      const { rows } = await pool.query(
        `INSERT INTO channels (slug, name, is_private, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, slug, name, is_private`,
        [slug, trimmedName, Boolean(isPrivate), request.user.id],
      );
      return reply.code(201).send({ success: true, channel: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ success: false, message: `Channel slug '${slug}' already exists.` });
      }
      request.log.error(err, 'adminControls: create channel failed');
      return reply.code(500).send({ success: false, message: 'Internal server error.' });
    }
  });


  // POST /api/admin/channels/add-member
  // Adds a user to a channel (upserts so repeat calls just update the alias).
  fastify.post('/api/admin/channels/add-member', {
    onRequest: [requireAdmin],
  }, async (request, reply) => {
    const { channelId, userId, displayAlias = null } = request.body ?? {};

    if (!channelId || !userId) {
      return reply.code(400).send({ success: false, message: '`channelId` and `userId` are required.' });
    }

    const alias = typeof displayAlias === 'string' && displayAlias.trim()
      ? displayAlias.trim()
      : null;

    try {
      const { rows } = await pool.query(
        `INSERT INTO channel_members (channel_id, user_id, display_alias)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT uq_channel_member
         DO UPDATE SET display_alias = EXCLUDED.display_alias
         RETURNING id, channel_id, user_id, display_alias, joined_at`,
        [channelId, userId, alias],
      );
      return reply.code(201).send({ success: true, member: rows[0] });
    } catch (err) {
      if (err.code === '23503') {
        return reply.code(404).send({ success: false, message: 'Channel or user not found.' });
      }
      request.log.error(err, 'adminControls: add member failed');
      return reply.code(500).send({ success: false, message: 'Internal server error.' });
    }
  });


  // POST /api/admin/users/:id/approve
  // Approves or rejects a pending user registration.
  fastify.post('/api/admin/users/:id/approve', {
    onRequest: [requireAdmin],
  }, async (request, reply) => {
    const userId   = request.params.id;
    const { newStatus } = request.body ?? {};

    if (!['approved', 'rejected'].includes(newStatus)) {
      return reply.code(400).send({ success: false, message: 'newStatus must be \'approved\' or \'rejected\'.' });
    }

    const { rowCount } = await pool.query(
      `UPDATE users SET status = $1, updated_at = now() WHERE id = $2`,
      [newStatus, userId],
    );

    if (rowCount === 0) return reply.code(404).send({ success: false, message: 'User not found.' });
    return reply.send({ success: true });
  });
}
