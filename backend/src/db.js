// backend/src/db.js
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  database: 'slack_clone_db',          // always isolated to this DB
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:      15,                         // cap connections on shared hardware
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 5_000,
  ssl: false,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err.message);
});
