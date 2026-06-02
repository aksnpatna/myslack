import pool from '../db/pool.js';

export default async function complianceRoutes(fastify) {

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

  // GET /api/admin/quarantine-logs
  // Returns the most-recent policy-violation records for the admin audit panel.
  fastify.get('/api/admin/quarantine-logs', {
    onRequest: [requireAdmin],
  }, async (request) => {
    const limit = Math.min(Number(request.query.limit) || 50, 200);

    const { rows } = await pool.query(
      `SELECT ql.id,
              ql.violating_user_id,
              ql.channel_id,
              ql.raw_blocked_text,
              ql.flagged_reason,
              ql.created_at,
              u.email AS violator_email
       FROM   quarantine_logs ql
       LEFT JOIN users u ON u.id = ql.violating_user_id
       ORDER  BY ql.created_at DESC
       LIMIT  $1`,
      [limit],
    );

    return rows;
  });
}
