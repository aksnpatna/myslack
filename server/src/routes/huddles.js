import { AccessToken } from 'livekit-server-sdk';
import { verifyChannelAccess } from '../db/pool.js';

export default async function huddleRoutes(fastify, options) {

  fastify.post('/api/huddles/join', async (request, reply) => {
    const { userId, channelId } = request.body;

    if (!userId || !channelId) {
      return reply.code(400).send({ success: false, message: 'userId and channelId are required.' });
    }

    const allowed = await verifyChannelAccess(userId, channelId);
    if (!allowed) {
      return reply.code(403).send({ success: false, message: 'Access denied to this channel.' });
    }

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: userId, ttl: '4h' },
    );

    token.addGrant({
      room:         channelId,
      roomJoin:     true,
      canPublish:   true,
      canSubscribe: true,
      audioOnly:    true,
    });

    const jwt = await token.toJwt();
    return reply.code(200).send({ success: true, token: jwt });
  });
}
