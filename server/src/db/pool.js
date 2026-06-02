import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  database: 'slack_clone_db',
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:      15,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis:  5_000,
});

pool.on('error', (err, client) => {
  console.error('[pool] idle client error', err.message);
  client?.release(true);
});

/**
 * Returns true if the user is an admin OR is a member of the given channel.
 * @param {string} userId
 * @param {string} channelId
 * @returns {Promise<boolean>}
 */
export async function verifyChannelAccess(userId, channelId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM users u
     WHERE u.id = $1
       AND (
         u.role = 'admin'
         OR EXISTS (
           SELECT 1 FROM channel_members cm
           WHERE cm.user_id = $1 AND cm.channel_id = $2
         )
       )
     LIMIT 1`,
    [userId, channelId],
  );
  return rows.length > 0;
}

export default pool;
