import { createWriteStream, mkdirSync }   from 'fs';
import { readFile }                        from 'fs/promises';
import { extname, join }                   from 'path';
import { pipeline }                        from 'stream/promises';
import { createRequire }                   from 'module';
import pool                                from '../db/pool.js';
import { processDocumentText }             from '../utils/vectorEngine.js';

const _require = createRequire(import.meta.url);

const UPLOAD_DIR = './uploads';
const MAX_BYTES  = 25 * 1024 * 1024; // 25 MB

// MIME types and extensions whose raw bytes are valid UTF-8 text
const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
  'text/css', 'text/javascript', 'application/json',
  'application/javascript', 'application/xml', 'application/x-yaml',
]);
const TEXT_EXTS = new Set([
  '.txt', '.md', '.csv', '.json', '.js', '.ts',
  '.xml', '.html', '.yaml', '.yml', '.log',
]);

async function extractText(filePath, mimeType, ext) {
  if (TEXT_MIMES.has(mimeType) || TEXT_EXTS.has(ext)) {
    return readFile(filePath, 'utf8');
  }
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const { PDFParse } = _require('pdf-parse');
    const buf = await readFile(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    return result.text;
  }
  return null; // binary / unsupported — skip embedding
}

mkdirSync(UPLOAD_DIR, { recursive: true });

export default async function fileRoutes(fastify, options) {

  // POST /api/files/upload
  fastify.post('/api/files/upload', {
    config: { rawBody: false },
  }, async (request, reply) => {
    const { messageId, uploaderId } = request.query;
    if (!messageId || !uploaderId) {
      return reply.code(400).send({ success: false, message: 'messageId and uploaderId are required.' });
    }

    let part;
    try {
      part = await request.file({ limits: { fileSize: MAX_BYTES } });
    } catch {
      return reply.code(400).send({ success: false, message: 'No file found in request.' });
    }

    if (!part) return reply.code(400).send({ success: false, message: 'No file found in request.' });

    const ext      = extname(part.filename).toLowerCase() || '.bin';
    const safeName = `${crypto.randomUUID()}${ext}`;
    const diskPath = join(UPLOAD_DIR, safeName);
    const dbPath   = `/uploads/${safeName}`;

    try {
      await pipeline(part.file, createWriteStream(diskPath));
    } catch (err) {
      // part.file emits an error if the stream is truncated by the size limit
      if (part.file.truncated) {
        return reply.code(413).send({ success: false, message: `File exceeds the 25 MB limit.` });
      }
      throw err;
    }

    const { rows } = await pool.query(
      `INSERT INTO attachments (message_id, uploader_id, file_path, original_name, mime_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [messageId, uploaderId, dbPath, part.filename, part.mimetype],
    );

    // Fire-and-forget embedding pipeline — never blocks or fails the upload response
    // Pass rows[0].id (attachments.id) as fileId — this is the FK in document_embeddings.
    const attachmentId = rows[0].id;
    setImmediate(async () => {
      try {
        const text = await extractText(diskPath, part.mimetype, ext);
        if (text && text.trim()) {
          // Mark as indexing before starting embeddings
          await pool.query(
            `INSERT INTO vector_index_status (file_id, status)
             VALUES ($1, 'indexing')
             ON CONFLICT (file_id) DO UPDATE SET status = 'indexing', updated_at = now()`,
            [attachmentId],
          );
          try {
            await processDocumentText(attachmentId, text.trim());
            await pool.query(
              `UPDATE vector_index_status SET status = 'ready', updated_at = now()
               WHERE file_id = $1`,
              [attachmentId],
            );
          } catch (embedErr) {
            await pool.query(
              `UPDATE vector_index_status
               SET status = 'error', error_msg = $2, updated_at = now()
               WHERE file_id = $1`,
              [attachmentId, (embedErr.message ?? 'Unknown error').slice(0, 500)],
            ).catch(() => {});
            throw embedErr;
          }
        }
      } catch (err) {
        fastify.log.warn({ err }, '[vectorEngine] embedding skipped for %s', safeName);
      }
    });

    return reply.code(201).send({ success: true, fileId: rows[0].id, path: dbPath });
  });

  // GET /api/files/:fileId/index-status — returns the RAG indexing state for a file
  fastify.get('/api/files/:fileId/index-status', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { fileId } = request.params;

    const { rows } = await pool.query(
      `SELECT vis.file_id AS "fileId", vis.status, vis.error_msg AS "errorMsg", vis.updated_at AS "updatedAt"
       FROM vector_index_status vis
       WHERE vis.file_id = $1`,
      [fileId],
    );

    if (!rows.length) {
      return reply.send({ fileId, status: 'not_indexed', errorMsg: null });
    }
    return reply.send(rows[0]);
  });
}
