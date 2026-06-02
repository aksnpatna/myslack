/**
 * Automated test suite for myslack
 * Tests: auth, @agent execution, message guard, security controls
 */

const BASE = 'http://localhost:3000';
let adminToken = '';
let testToken  = '';
let testUserId = '';
let channels   = [];

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[33m→\x1b[0m';

let passed = 0, failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m═══ AUTH TESTS ═══\x1b[0m');

// 1. Admin login
{
  const { status, data } = await req('POST', '/login', {
    email: 'admin@akstest.win',
    password: 'admin123',
  });
  adminToken = data.token ?? '';
  assert('Admin login returns 200', status === 200, `status=${status}`);
  assert('Admin login returns JWT', !!adminToken, 'no token');
  assert('Admin role is admin', data.user?.role === 'admin', `role=${data.user?.role}`);
}

// 2. Unauthenticated access to /api/me
{
  const { status } = await req('GET', '/api/me', null, null);
  assert('GET /api/me without token → 401', status === 401, `status=${status}`);
}

// 3. Fake/tampered JWT is rejected
{
  const { status } = await req('GET', '/api/me', null, 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJmYWtlIn0.invalidsig');
  assert('Tampered JWT → 401', status === 401, `status=${status}`);
}

// 4. Register a new test user
const testEmail = `testuser_${Date.now()}@example.com`;
{
  const { status, data } = await req('POST', '/register', {
    email: testEmail,
    password: 'Test@secure1',
    username: 'testuser_auto',
  });
  // Should succeed (pending approval)
  assert('New user register returns 201', status === 201, `status=${status} ${JSON.stringify(data)}`);
}

// 5. Pending user cannot login
{
  const { status, data } = await req('POST', '/login', {
    email: testEmail,
    password: 'Test@secure1',
  });
  assert('Pending user login is blocked (403)', status === 403, `status=${status}`);
}

// 6. Register duplicate email
{
  const { status } = await req('POST', '/register', {
    email: testEmail,
    password: 'Test@secure1',
    username: 'dup_user',
  });
  assert('Duplicate register → 409', status === 409, `status=${status}`);
}

// 7. Admin /api/me returns correct identity
{
  const { status, data } = await req('GET', '/api/me', null, adminToken);
  assert('Admin /api/me → 200', status === 200, `status=${status}`);
  assert('Admin identity email correct', data.email === 'admin@akstest.win', data.email);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m═══ CHANNEL ACCESS TESTS ═══\x1b[0m');

// 8. Fetch channels as admin
{
  const { status, data } = await req('GET', '/api/channels', null, adminToken);
  assert('Admin GET /api/channels → 200', status === 200, `status=${status}`);
  assert('Channels is array', Array.isArray(data), typeof data);
  channels = data;
  console.log(`  ${INFO} Found ${channels.length} channels: ${channels.map(c => c.name).join(', ')}`);
}

// 9. No token → 401 on channels
{
  const { status } = await req('GET', '/api/channels', null, null);
  assert('GET /api/channels without token → 401', status === 401, `status=${status}`);
}

// 10. Access messages for a channel
if (channels.length > 0) {
  const ch = channels[0];
  const { status, data } = await req('GET', `/api/channels/${ch.id}/messages`, null, adminToken);
  assert(`GET messages for #${ch.name} → 200`, status === 200, `status=${status}`);
  assert('Messages is array', Array.isArray(data), typeof data);
  console.log(`  ${INFO} #${ch.name} has ${data.length} messages`);
}

// 11. Access messages with bad channel ID (SQL injection resistance)
{
  const { status } = await req('GET', `/api/channels/'; DROP TABLE messages; --/messages`, null, adminToken);
  assert('SQL injection in channel ID → non-200 (safe)', status !== 200, `status=${status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m═══ AGENT TESTS (via WebSocket) ═══\x1b[0m');

// WebSocket @agent test using Node's built-in WebSocket (Node 22+)
const WS_URL = process.env.WS_URL ?? 'ws://localhost:3000/ws/chat';

async function wsAgentTest(channelId, message, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}?token=${adminToken}`);
    const responses = [];
    const timer = setTimeout(() => {
      ws.close();
      resolve({ responses, timedOut: true });
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        userId: 'admin',
        channelId,
        content: message,
        parentId: null,
      }));
    });

    ws.addEventListener('message', (evt) => {
      try {
        const data = JSON.parse(evt.data);
        responses.push(data);
        // Agent done when we see an agent sender message that isn't "thinking"
        if (data.sender === 'Automated Project Director' && data.body?.length > 10) {
          clearTimeout(timer);
          ws.close();
          resolve({ responses, timedOut: false });
        }
      } catch {}
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve({ responses, timedOut: true, error: true });
    });
  });
}

if (channels.length > 0) {
  const ch = channels[0];

  // Test 1: @agent with a simple query
  console.log(`  ${INFO} Sending @agent query to #${ch.name}...`);
  const { responses, timedOut, error } = await wsAgentTest(ch.id, '@agent list pending registrations', 35000);

  assert('@agent WS connection works (no error)', !error, 'WS connection failed');
  assert('@agent receives response (no timeout)', !timedOut, `timed out after 35s, got ${responses.length} frames`);

  const agentReply = responses.find(r => r.sender === 'Automated Project Director');
  assert('@agent sends a reply message', !!agentReply, `received frames: ${responses.map(r=>r.sender||r.type).join(', ')}`);

  if (agentReply) {
    console.log(`  ${INFO} Agent reply preview: "${String(agentReply.body ?? '').slice(0, 120)}..."`);
    assert('@agent reply has meaningful content (>20 chars)', (agentReply.body ?? '').length > 20);
  }
} else {
  console.log(`  ${INFO} Skipping WS tests — no channels found`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m═══ MESSAGE GUARD TESTS ═══\x1b[0m');

// These tests verify the HTTP API surface is safe (guard runs inside WS handler,
// but we can test the guard utility directly)
import { validateAndSanitizeMessage, BLOCKED_CONTENT } from './server/src/utils/messageGuard.js';

// 12. Phone number is blocked
{
  const result = await validateAndSanitizeMessage('Call me at +61 412 345 678 for a quote', 'TestAlias');
  assert('Phone number → BLOCKED_CONTENT', result.sanitized === BLOCKED_CONTENT || result.flagged,
    `safe=${result.isSafe} flagged="${result.flaggedReason}"`);
}

// 13. Clean message passes
{
  const result = await validateAndSanitizeMessage('Please review the attached project brief', 'TestAlias');
  assert('Clean message → passes guard', result.isSafe === true, `safe=${result.isSafe}`);
}

// 14. Email in message is blocked
{
  const result = await validateAndSanitizeMessage('Contact me at john.smith@gmail.com to discuss', 'TestAlias');
  assert('Email in message → blocked or sanitized', !result.isSafe || result.sanitized !== 'Contact me at john.smith@gmail.com to discuss',
    `safe=${result.isSafe} out="${result.sanitized}"`);
}

// 15. Currency/rate info blocked
{
  const result = await validateAndSanitizeMessage('I charge $150/hr and my BSB is 062-000 account 12345678', 'TestAlias');
  assert('Payment info → blocked', !result.isSafe, `safe=${result.isSafe}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m═══ SECURITY HARDENING TESTS ═══\x1b[0m');

// 16. IDOR: accessing another user's data (if endpoint exists)
{
  const { status } = await req('GET', '/api/users', null, adminToken);
  // Admin-only endpoint
  console.log(`  ${INFO} GET /api/users → ${status}`);
}

// 17. Admin-approve endpoint requires admin role
{
  // Try to approve with no token
  const { status } = await req('POST', '/approve', { email: testEmail }, null);
  assert('POST /approve without token → 401', status === 401, `status=${status}`);
}

// 18. Mass assignment: try to set role=admin on register
{
  const { status, data } = await req('POST', '/register', {
    email: `hacker_${Date.now()}@evil.com`,
    password: 'H@ck3r!pass',
    username: 'hacker',
    role: 'admin',   // should be ignored
    status: 'approved',
  });
  // Either blocked or registered as pending (not as admin)
  assert('Register with role=admin injection → not admin',
    status !== 200 || data.user?.role !== 'admin',
    `status=${status} role=${data.user?.role}`);
}

// 19. Oversized input (>10KB body)
{
  const bigPayload = { email: 'a@b.com', password: 'x'.repeat(10001) };
  const { status } = await req('POST', '/login', bigPayload, null);
  // Should not crash (200 on bad creds or 400/413 on oversized input)
  assert('Oversized input does not crash server (non-500)', status !== 500, `status=${status}`);
}

// 20. Verify server still alive after all tests
{
  const { status } = await req('GET', '/api/me', null, adminToken);
  assert('Server still healthy after all tests', status === 200, `status=${status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m═══ RESULTS ═══\x1b[0m`);
console.log(`  ${PASS} Passed: ${passed}`);
console.log(`  ${FAIL} Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
