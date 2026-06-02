import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import pool, { verifyChannelAccess }       from '../db/pool.js';

const LIVEKIT_URL    = process.env.LIVEKIT_URL        ?? 'https://slack-api.akstest.win';
const LIVEKIT_KEY    = process.env.LIVEKIT_API_KEY    ?? '';
const LIVEKIT_SECRET = process.env.LIVEKIT_API_SECRET ?? '';

export default async function mediaRoutes(fastify) {

  /**
   * POST /api/media/token
   * Body: { channelId: string }
   * Headers: Authorization: Bearer <jwt>
   *
   * Returns: { token: string, livekitUrl: string }
   *
   * Security:
   *  - JWT must be valid (fastify.authenticate)
   *  - Caller must be a channel member OR admin (verifyChannelAccess)
   *  - Non-admin identities are masked to their display_alias
   */
  fastify.post('/api/media/token', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { channelId } = request.body ?? {};
    const { id: userId, role: jwtRole } = request.user;

    if (!channelId) {
      return reply.code(400).send({ error: '`channelId` is required.' });
    }

    // ── 1. Membership guard ─────────────────────────────────────────────
    const allowed = await verifyChannelAccess(userId, channelId);
    if (!allowed) {
      return reply.code(403).send({ error: 'You are not a member of this channel.' });
    }

    // ── 2. Resolve caller's display alias + confirmed DB role ───────────
    const { rows } = await pool.query(
      `SELECT cm.display_alias, u.role
       FROM users u
       LEFT JOIN channel_members cm
             ON cm.user_id = u.id AND cm.channel_id = $2
       WHERE u.id = $1`,
      [userId, channelId],
    );

    const dbRow      = rows[0];
    const dbRole     = dbRow?.role ?? jwtRole ?? 'client';
    const isAdmin    = dbRole === 'admin';

    // Admins keep their real userId; others get their masked alias
    const identity   = isAdmin
      ? `admin:${userId}`
      : (dbRow?.display_alias ?? `user:${userId}`);

    // ── 3. Build AccessToken ────────────────────────────────────────────
    const at = new AccessToken(LIVEKIT_KEY, LIVEKIT_SECRET, {
      identity,
      name:   identity,
      ttl:    '4h',
    });

    // Room name = channelId — keeps huddles scoped to their channel
    const grant = {
      room:               channelId,
      roomJoin:           true,
      canPublish:         true,
      canSubscribe:       true,
      canPublishData:     true,
    };

    if (isAdmin) {
      // Admins can mute/remove participants
      grant.roomAdmin    = true;
      grant.canUpdateOwnMetadata = true;
    }

    at.addGrant(grant);

    const token = await at.toJwt();

    return reply.send({ token, livekitUrl: LIVEKIT_URL, identity, roomName: channelId });
  });
}
