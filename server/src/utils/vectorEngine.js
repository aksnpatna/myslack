import pool from '../db/pool.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';

// ── Text chunking ────────────────────────────────────────────────────────────
// Splits text into overlapping windows so large documents are retrievable with
// fine-grained precision. Each chunk is embedded separately.
const CHUNK_SIZE    = 1200;  // characters  (~300 tokens, well under 8 191 limit)
const CHUNK_OVERLAP = 150;   // characters carried over into the next chunk

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const slice = text.slice(start, end).trim();
    if (slice.length > 50) chunks.push(slice);  // skip tiny trailing remnants
    if (end === text.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Splits textBlob into overlapping chunks, embeds each with text-embedding-3-small
 * and persists them all to document_embeddings linked to fileId (attachments.id).
 * @param {string} fileId   – UUID from attachments.id
 * @param {string} textBlob – full extracted text of the document
 */
export async function processDocumentText(fileId, textBlob) {
  const chunks = chunkText(textBlob);

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];

    const response = await fetch(OPENAI_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: chunk }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embeddings error ${response.status}: ${err}`);
    }

    const { data } = await response.json();
    const vector   = data[0].embedding;              // number[], length 1536
    const halfvec  = `[${vector.join(',')}]`;

    await pool.query(
      `INSERT INTO document_embeddings (file_id, chunk_index, chunk_text, embedding)
       VALUES ($1, $2, $3, $4::halfvec)`,
      [fileId, chunkIndex, chunk, halfvec],
    );
  }

  console.log(`[vectorEngine] indexed ${chunks.length} chunks for file ${fileId}`);
}
