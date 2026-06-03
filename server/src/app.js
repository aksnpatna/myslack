import Fastify          from 'fastify';
import fastifyJwt       from '@fastify/jwt';
import fastifyWs        from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyCors      from '@fastify/cors';
import authRoutes       from './routes/auth.js';
import chatRoutes       from './routes/chat.js';
import huddleRoutes     from './routes/huddles.js';
import fileRoutes       from './routes/files.js';
import attachmentRoutes  from './routes/attachments.js';
import channelRoutes    from './routes/channels.js';
import adminControls    from './routes/adminControls.js';
import mediaRoutes      from './routes/media.js';
import complianceRoutes from './routes/compliance.js';

const app = Fastify({ logger: true });

await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET ?? 'changeme-in-production',
});

await app.register(fastifyCors, {
  origin: [
    'https://slack.akstest.win',
    'http://localhost:19006',
    'http://localhost:8080',
  ],
  credentials: true,
});
await app.register(fastifyWs);
await app.register(fastifyMultipart);

app.decorate('authenticate', async (request, reply) => {
  try { await request.jwtVerify(); }
  catch { reply.code(401).send({ error: 'Unauthorized' }); }
});

await app.register(authRoutes);
await app.register(chatRoutes);
await app.register(huddleRoutes);
await app.register(fileRoutes);
await app.register(attachmentRoutes);
await app.register(channelRoutes);
await app.register(adminControls);
await app.register(mediaRoutes);
await app.register(complianceRoutes);

app.get('/health', async () => ({ status: 'ok' }));

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`[server] listening on ${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
