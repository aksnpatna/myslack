// /server/scripts/verify-delivery.js
// Run: node scripts/verify-delivery.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import WebSocket from 'ws';
import pool from '../src/db/pool.js';

const WS_URL  = process.env.WS_URL  ?? 'ws://localhost:3000/ws/chat';
const PASS    = await bcrypt.hash('test-password-123', 10);

let results = { dbIsolation: false, identityMasking: false };

// ── 1. DATABASE SEEDING ───────────────────────────────────────

// Channel
const { rows: chanRows } = await pool.query(
  `INSERT INTO channels (slug, name)
   VALUES ('project-alpha', '#project-alpha')
   ON CONFLICT (slug) DO NOTHING
   RETURNING id`,
);
const channelId = chanRows[0]?.id ?? (
  await pool.query(`SELECT id FROM channels WHERE slug = 'project-alpha'`)
).rows[0].id;

// Users (upsert by email)
async function upsertUser(email, role, status) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, status)
     VALUES ($1, $2, $3::user_role, $4::user_status)
     ON CONFLICT (email) DO UPDATE
       SET role = EXCLUDED.role, status = EXCLUDED.status
     RETURNING id`,
    [email, PASS, role, status],
  );
  return rows[0].id;
}

const adminId      = await upsertUser('admin@test.com',      'admin',      'approved');
const clientId     = await upsertUser('client@test.com',     'client',     'approved');
const consultantId = await upsertUser('consultant@test.com', 'consultant', 'approved');

// channel_members — client (no alias) + consultant ('Lead Engineer')
await pool.query(
  `INSERT INTO channel_members (channel_id, user_id, display_alias)
   VALUES ($1, $2, NULL), ($1, $3, 'Lead Engineer')
   ON CONFLICT DO NOTHING`,
  [channelId, clientId, consultantId],
);

// Verify channel visibility isolation: client should see project-alpha, NOT other channels
const { rows: visibleChans } = await pool.query(
  `SELECT c.id FROM channels c
   JOIN channel_members cm ON cm.channel_id = c.id
   WHERE cm.user_id = $1`,
  [clientId],
);
const { rows: allChans } = await pool.query(`SELECT id FROM channels`);

results.dbIsolation = (
  visibleChans.some((r) => r.id === channelId) &&
  visibleChans.length < allChans.length
);

console.log(`\n── DB Isolation ──────────────────────────────────`);
console.log(`  Channels visible to client : ${visibleChans.length}`);
console.log(`  Total channels in system   : ${allChans.length}`);
console.log(`  Client can see #project-alpha: ${visibleChans.some((r) => r.id === channelId)}`);

// ── 2. WEBSOCKET SIMULATION ───────────────────────────────────

await new Promise((resolve) => {
  const ws = new WebSocket(WS_URL);

  ws.on('error', (err) => {
    console.error('\n── WS Error ─────────────────────────────────────');
    console.error(`  Could not connect to ${WS_URL}: ${err.message}`);
    console.error('  Ensure the Fastify server is running before this step.');
    resolve();
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      userId:    consultantId,
      channelId: channelId,
      content:   'Deploying the server patch now.',
    }));
  });

  ws.on('message', (raw) => {
    const broadcast = JSON.parse(raw.toString());
    console.log('\n── WS Broadcast Received ────────────────────────');
    console.log(JSON.stringify(broadcast, null, 2));

    results.identityMasking = broadcast.sender === 'Lead Engineer';
    ws.close();
    resolve();
  });
});

// ── 3. VERIFICATION REPORT ────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log('  VERIFICATION REPORT');
console.log('══════════════════════════════════════════════════');
console.log(`  [${results.dbIsolation    ? 'PASS' : 'FAIL'}] DB isolation — client channel visibility limited`);
console.log(`  [${results.identityMasking ? 'PASS' : 'FAIL'}] Identity masking — consultant broadcasts as 'Lead Engineer'`);
console.log('══════════════════════════════════════════════════\n');

await pool.end();
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
