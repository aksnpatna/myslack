/**
 * messageGuard.js
 * Pre-commit content safety scanner for non-admin chat messages.
 *
 * Pipeline:
 *   1. Cheap regex pre-screen (email / phone) → short-circuit if obvious hit
 *   2. OpenAI Chat Completions with strict JSON schema output
 *   3. Return { isSafe, sanitizedContent, flaggedReason }
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// ---------------------------------------------------------------------------
// 1. DETERMINISTIC REGEX PRE-SCREEN
// ---------------------------------------------------------------------------

/**
 * Patterns that unambiguously identify PII or off-platform contact attempts.
 * Checked before any API call to minimise latency and cost.
 */
const PRESCREEN_PATTERNS = [
  // Standard email addresses
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,

  // E.164 / international phone numbers  (+61 412 345 678, +1-800-555-0100, etc.)
  /\+?[\d][\d\s\-().]{7,}\d/,

  // Australian mobile / local format  (04xx xxx xxx, (02) xxxx xxxx)
  /0[2-9][\s\-.]?\d{4}[\s\-.]?\d{4}/,

  // Written-out digits that spell phone numbers (e.g. "zero four one two")
  /\b(zero|one|two|three|four|five|six|seven|eight|nine)[\s\-](zero|one|two|three|four|five|six|seven|eight|nine)/i,

  // Explicit dollar amounts or rates ("$150", "$150/hr", "150 bucks", "AUD 200")
  /(\$|AUD|USD|EUR|GBP)\s?\d+|(\d+)\s?(bucks|dollars|per\s+hour|\/hr|\/hour)/i,

  // PayPal / Venmo / CashApp off-platform payment mentions
  /\b(paypal|venmo|cashapp|cash\s+app|bank\s+transfer|bsb|iban)\b/i,
];

/**
 * Returns true if ANY pre-screen pattern fires.
 * @param {string} text
 * @returns {boolean}
 */
function presceenFails(text) {
  return PRESCREEN_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// 2. OPENAI STRUCTURED-OUTPUT SCANNER
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  name: 'message_safety_result',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      isSafe: {
        type: 'boolean',
        description: 'true only when the message contains no PII, phone numbers, financial figures, or off-platform contact attempts',
      },
      sanitizedContent: {
        type: 'string',
        description: 'The cleaned message text. If isSafe is true this mirrors the original. If isSafe is false, this is an empty string.',
      },
      flaggedReason: {
        type: ['string', 'null'],
        description: 'A brief machine-readable reason string when isSafe is false, otherwise null.',
      },
    },
    required: ['isSafe', 'sanitizedContent', 'flaggedReason'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are a strict content-safety enforcer for a regulated professional services platform.

POLICY — apply ALL rules simultaneously with zero tolerance:

1. PHONE NUMBERS
   Flag any telephone number, WhatsApp handle, or obscured digit sequence regardless of
   formatting (spaces, dashes, brackets, words). This includes Australian mobile numbers
   (04xx format), international numbers (+xx prefix), and digit-word spellings
   ("zero four one two…"). Set isSafe: false and sanitizedContent: "".

2. INDIVIDUAL NAMES / CONTACT FOOTPRINTS
   If a real full name (first + last) or personal identifier appears, replace it with the
   literal token [ALIAS] in sanitizedContent. If the name cannot be replaced safely without
   altering meaning, set isSafe: false.

3. CURRENCY / RATES / OFF-PLATFORM PAYMENTS
   Any explicit dollar amount, hourly rate, or payment-platform reference ($, AUD, USD,
   "per hour", "bucks", PayPal, Venmo, bank transfer, BSB) must result in isSafe: false
   and sanitizedContent: "".

4. SAFE PASS-THROUGH
   Messages that contain none of the above must return isSafe: true, sanitizedContent equal
   to the original text verbatim, and flaggedReason: null.

Respond ONLY with the JSON object matching the provided schema. Do not include any prose outside the JSON.`;

/**
 * Calls the OpenAI Chat Completions API with strict JSON schema output.
 * @param {string} content  Raw message text
 * @param {string} alias    The sender's permitted display alias (used in system prompt context)
 * @returns {Promise<{isSafe: boolean, sanitizedContent: string, flaggedReason: string|null}>}
 */
async function callOpenAIScanner(content, alias) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[messageGuard] OPENAI_API_KEY is not set');

  const body = {
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: RESPONSE_SCHEMA,
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Sender display alias: "${alias}"\nMessage to evaluate:\n"""\n${content}\n"""`,
      },
    ],
  };

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[messageGuard] OpenAI API error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const raw  = json.choices?.[0]?.message?.content;
  if (!raw) throw new Error('[messageGuard] Empty response from OpenAI');

  return JSON.parse(raw); // schema is strict — safe to parse directly
}

// ---------------------------------------------------------------------------
// 3. PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * Validates and optionally sanitizes a message from a non-admin sender.
 *
 * @param {string} content      Raw message content
 * @param {string} alias        Sender's permitted channel display alias
 * @returns {Promise<{isSafe: boolean, sanitizedContent: string, flaggedReason: string|null}>}
 */
export async function validateAndSanitizeMessage(content, alias) {
  // --- Stage 1: cheap regex pre-screen ---
  if (presceenFails(content)) {
    return {
      isSafe:           false,
      sanitizedContent: '',
      flaggedReason:    'pre-screen: pattern match (phone / email / currency / payment method)',
    };
  }

  // --- Stage 2: LLM structured-output scan ---
  try {
    const result = await callOpenAIScanner(content, alias);

    // Defensive normalisation in case model drifts from schema
    return {
      isSafe:           result.isSafe === true,
      sanitizedContent: typeof result.sanitizedContent === 'string' ? result.sanitizedContent : '',
      flaggedReason:    result.flaggedReason ?? null,
    };
  } catch (err) {
    // On API failure, fail-open with a logged warning so the platform stays usable.
    // Operators can tighten this to fail-closed by returning isSafe: false.
    console.error('[messageGuard] scan error — failing open:', err.message);
    return { isSafe: true, sanitizedContent: content, flaggedReason: null };
  }
}

export const BLOCKED_CONTENT =
  '[PROTECTED: This message was blocked as it contained direct contact details or unverified business metrics. Off-platform contact is strictly prohibited]';
