import { createReadStream }                       from 'fs';
import { stat }                                     from 'fs/promises';
import { join }                                     from 'path';
import pool, { verifyChannelAccess }                from '../db/pool.js';

const UPLOAD_DIR = './uploads';

export default async function attachmentRoutes(fastify, options) {

  // GET /api/attachments/download/:fileId
  // Secure download — user must be authenticated and a channel participant.
  fastify.get('/api/attachments/download/:fileId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { fileId } = request.params;
    const userId     = request.user.id;

    // 1. Look up attachment + channel ownership
    const { rows } = await pool.query(
      `SELECT a.file_path, a.original_name, m.channel_id
       FROM attachments a
       JOIN messages m ON a.message_id = m.id
       WHERE a.id = $1`,
      [fileId],
    );

    if (rows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Attachment not found.' });
    }

    const { file_path, original_name, channel_id } = rows[0];

    // 2. Enforce channel membership
    const hasAccess = await verifyChannelAccess(userId, channel_id);
    if (!hasAccess) {
      return reply.code(403).send({ success: false, message: 'Access denied — not a channel participant.' });
    }

    // 3. Resolve absolute disk path
    const diskPath = join(UPLOAD_DIR, file_path.replace(/^\/?uploads\//, ''));

    try {
      await stat(diskPath);
    } catch {
      return reply.code(404).send({ success: false, message: 'File missing from disk.' });
    }

    // 4. Stream with download headers
    reply.header('Content-Disposition', `attachment; filename="${original_name ?? 'download'}"`);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(createReadStream(diskPath));
  });
}
