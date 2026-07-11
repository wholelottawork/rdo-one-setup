export default async function healthRoutes(fastify) {
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));
}
