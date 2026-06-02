import bcrypt from 'bcryptjs';
import pool   from '../db/pool.js';
import { notifyNewRegistration } from '../utils/executiveAgent.js';

const VALID_STATUSES = ['approved', 'rejected'];
const VALID_ROLES    = ['consultant', 'client'];

export default async function authRoutes(fastify, options) {

  // POST /register
  fastify.post('/register', async (request, reply) => {
    const { email, password } = request.body;
    const password_hash = await bcrypt.hash(password, 10);

    // Derive a unique username from the email local part
    const baseUsername = email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'user';
    let username = baseUsername;
    let attempt  = 0;
    while (true) {
      try {
        await pool.query(
          `INSERT INTO users (email, username, password_hash, status, role)
           VALUES ($1, $2, $3, 'pending', 'client')`,
          [email, username, password_hash],
        );
        break;
      } catch (err) {
        // 23505 = unique_violation — retry with a numeric suffix on username
        if (err.code === '23505' && err.constraint?.includes('username') && attempt < 10) {
          attempt++;
          username = `${baseUsername}${attempt}`;
        } else {
          throw err;
        }
      }
    }

    // Fire-and-forget: post a compliance card to #admin-compliance-alerts
    setImmediate(() => notifyNewRegistration(email, 'client').catch(() => {}));

    return reply.code(201).send({
      success: true,
      message: 'Registration successful. Pending admin approval.',
    });
  });


  // POST /login
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    const { rows } = await pool.query(
      'SELECT id, email, role, status, password_hash FROM users WHERE email = $1',
      [email],
    );

    const user = rows[0];

    // Validate credentials first — same generic 401 for both missing user and wrong password
    // to prevent email enumeration.
    const valid = user && await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.code(401).send({ success: false, message: 'Invalid credentials.' });

    // Client privacy guard — checked after credential validation to avoid status oracle.
    if (user.status === 'pending' || user.status === 'rejected') {
      return reply.code(403).send({ success: false, message: 'Your account is pending admin approval.' });
    }

    const token = fastify.jwt.sign({ id: user.id, email: user.email, role: user.role });
    return reply.send({ success: true, token });
  });


  // GET /api/me — returns the current user's profile from the JWT
  fastify.get('/api/me', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const { id, email, role } = request.user;
    return { id, email, role };
  });


  // POST /approve  (admin only)
  fastify.post('/approve', async (request, reply) => {
    if (request.headers['x-user-role'] !== 'admin') {
      return reply.code(403).send({ success: false, message: 'Admin privileges required.' });
    }

    const { userId, newStatus, newRole } = request.body;

    if (!VALID_STATUSES.includes(newStatus)) {
      return reply.code(400).send({ success: false, message: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
    }
    if (newRole !== undefined && !VALID_ROLES.includes(newRole)) {
      return reply.code(400).send({ success: false, message: `role must be one of: ${VALID_ROLES.join(', ')}.` });
    }

    const { rowCount } = await pool.query(
      `UPDATE users
       SET status     = $1,
           role       = COALESCE($2::user_role, role),
           updated_at = now()
       WHERE id = $3`,
      [newStatus, newRole ?? null, userId],
    );

    if (rowCount === 0) return reply.code(404).send({ success: false, message: 'User not found.' });
    return reply.send({ success: true, userId, newStatus, newRole: newRole ?? 'unchanged' });
  });
}
