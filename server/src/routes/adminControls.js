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

  // ── Sovereign Tech: Phase 1 endpoints ────────────────────────────────────

  // POST /api/admin/sovereign/obfuscate/:userId
  // Assigns (or returns the existing) obfuscated identity code for a user.
  // Codes follow the pattern CONSULTANT-XX or CLIENT-XX, derived from role.
  fastify.post('/api/admin/sovereign/obfuscate/:userId', {
    onRequest: [requireAdmin],
  }, async (request, reply) => {
    const { userId } = request.params;

    // Return existing mapping if present
    const { rows: existing } = await pool.query(
      `SELECT obfuscated_id FROM identity_mappings WHERE user_id = $1`,
      [userId],
    );
    if (existing.length > 0) {
      return reply.send({ success: true, obfuscatedId: existing[0].obfuscated_id, created: false });
    }

    // Resolve the user's role to build a prefix
    const { rows: userRows } = await pool.query(
      `SELECT role FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRows.length) {
      return reply.code(404).send({ success: false, message: 'User not found.' });
    }

    const prefix = userRows[0].role === 'admin' ? 'ADMIN' : 'CONSULTANT';

    // Generate a unique two-digit suffix
    let obfuscatedId;
    for (let attempt = 0; attempt < 100; attempt++) {
      const suffix = String(Math.floor(Math.random() * 90) + 10); // 10–99
      const candidate = `${prefix}-${suffix}`;
      const { rows: clash } = await pool.query(
        `SELECT 1 FROM identity_mappings WHERE obfuscated_id = $1`,
        [candidate],
      );
      if (!clash.length) { obfuscatedId = candidate; break; }
    }

    if (!obfuscatedId) {
      return reply.code(500).send({ success: false, message: 'Could not generate a unique obfuscated ID.' });
    }

    await pool.query(
      `INSERT INTO identity_mappings (user_id, obfuscated_id) VALUES ($1, $2)`,
      [userId, obfuscatedId],
    );

    return reply.code(201).send({ success: true, obfuscatedId, created: true });
  });

  // GET /api/admin/sovereign/metrics?nodeId=&limit=50
  // Returns recent system telemetry records.
  fastify.get('/api/admin/sovereign/metrics', {
    onRequest: [requireAdmin],
  }, async (request) => {
    const nodeId = request.query.nodeId ?? null;
    const limit  = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 500);

    const { rows } = nodeId
      ? await pool.query(
          `SELECT id, node_id, cpu_pct, mem_pct, latency_ms, recorded_at
           FROM system_metrics WHERE node_id = $1
           ORDER BY recorded_at DESC LIMIT $2`,
          [nodeId, limit],
        )
      : await pool.query(
          `SELECT id, node_id, cpu_pct, mem_pct, latency_ms, recorded_at
           FROM system_metrics ORDER BY recorded_at DESC LIMIT $1`,
          [limit],
        );
    return rows;
  });

  // POST /api/admin/sovereign/metrics
  // Records a node telemetry snapshot. Accepts nodeId, cpuPct, memPct, latencyMs.
  fastify.post('/api/admin/sovereign/metrics', {
    onRequest: [requireAdmin],
  }, async (request, reply) => {
    const { nodeId, cpuPct = null, memPct = null, latencyMs = null } = request.body ?? {};

    if (!nodeId || typeof nodeId !== 'string' || !nodeId.trim()) {
      return reply.code(400).send({ success: false, message: '`nodeId` is required.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO system_metrics (node_id, cpu_pct, mem_pct, latency_ms)
       VALUES ($1, $2, $3, $4)
       RETURNING id, recorded_at`,
      [nodeId.trim(), cpuPct, memPct, latencyMs],
    );
    return reply.code(201).send({ success: true, metric: rows[0] });
  });

  // GET /api/admin/sovereign/interventions?resolved=false
  // Lists admin intervention requests raised by the RAG agent.
  fastify.get('/api/admin/sovereign/interventions', {
    onRequest: [requireAdmin],
  }, async (request) => {
    const showResolved = request.query.resolved === 'true';

    const { rows } = await pool.query(
      `SELECT id, message_id, channel_id, query, confidence, resolved, created_at
       FROM admin_interventions
       WHERE ($1 OR resolved = false)
       ORDER BY created_at DESC
       LIMIT 100`,
      [showResolved],
    );
    return rows;
  });

  // PATCH /api/admin/sovereign/interventions/:id/resolve
  // Marks an admin intervention as resolved.
  fastify.patch('/api/admin/sovereign/interventions/:id/resolve', {
    onRequest: [requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params;

    const { rowCount } = await pool.query(
      `UPDATE admin_interventions SET resolved = true WHERE id = $1`,
      [id],
    );

    if (rowCount === 0) return reply.code(404).send({ success: false, message: 'Intervention not found.' });
    return reply.send({ success: true });
  });
}
