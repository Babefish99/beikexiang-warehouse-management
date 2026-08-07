import Fastify from "fastify";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok", service: "warehouse-api" }));

  return app;
}

const app = buildServer();
const port = Number(process.env.API_PORT ?? 3001);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
