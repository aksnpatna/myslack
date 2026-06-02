// backend/src/routes/auth.js
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

/** @param {import('fastify').FastifyInstance} app */
export async function authRoutes(app) {

  // ── POST /auth/login ────────────────────────────────────────
  app.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body;

    const { rows } = await pool.query(
      'SELECT id, password_hash, role, status FROM users WHERE email = $1',
      [email],
    );

    const user = rows[0];
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });

    // Admin-approval gate — checked BEFORE password to avoid timing oracle
    if (user.status === 'pending')  return reply.code(403).send({ error: 'Account pending admin approval' });
    if (user.status === 'rejected') return reply.code(403).send({ error: 'Account rejected' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });

    const token = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '7d' });
    return reply.send({ token });
  });


  // ── POST /auth/register ─────────────────────────────────────
  app.post('/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'email', 'password'],
        properties: {
          username: { type: 'string', minLength: 2 },
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const { username, email, password } = req.body;
    const hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, status`,
      [username, email, hash],
    );

    // status defaults to 'pending' — notify user to await approval
    return reply.code(201).send({ id: rows[0].id, status: rows[0].status });
  });


  // ── PATCH /admin/users/:id/status ───────────────────────────
  // Admin-only: approve or reject a pending user
  app.patch('/admin/users/:id/status', {
    onRequest: [app.authenticate],       // JWT guard (registered in app.js)
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['approved', 'rejected'] },
        },
      },
    },
  }, async (req, reply) => {
    if (req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Admin privileges required' });
    }

    const { id } = req.params;
    const { status } = req.body;

    const { rowCount } = await pool.query(
      `UPDATE users
       SET status = $1, updated_at = now()
       WHERE id = $2 AND status = 'pending'`,
      [status, id],
    );

    if (rowCount === 0) return reply.code(404).send({ error: 'User not found or already actioned' });
    return reply.send({ id, status });
  });
}
