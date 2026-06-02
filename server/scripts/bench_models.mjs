/**
 * bench_models.mjs — compare Groq vs local qwen2.5 for a document-review query.
 * Run:  node --env-file=../.env scripts/bench_models.mjs
 */

import { processExecutiveTask } from '../src/utils/executiveAgent.js';

const CHANNEL_ID = '809776de-bca9-4fb6-832e-7b32e634605a';
const QUERY = '@agent Review the mooring analysis document and give me a technical summary — what vessel, what berth, and what are the key findings on mooring line loads?';

async function run(label, forceLocal = false) {
  const savedKey = process.env.GROQ_API_KEY;
  if (forceLocal) delete process.env.GROQ_API_KEY;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(70)}`);

  const start = Date.now();
  try {
    const response = await processExecutiveTask(QUERY, { channelId: CHANNEL_ID });
    const elapsed  = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nResponse (${elapsed}s):\n`);
    console.log(response);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`\nERROR after ${elapsed}s:`, err.message);
  } finally {
    if (forceLocal && savedKey) process.env.GROQ_API_KEY = savedKey;
  }
}

// Run Groq first, then force local
await run('GROQ  —  llama-3.3-70b-versatile', false);
await run('LOCAL —  qwen2.5:7b-instruct-q4_K_M  (Ollama native /api/chat)', true);

console.log('\nDone.\n');
