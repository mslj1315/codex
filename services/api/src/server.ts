import Fastify from "fastify";
import { fileURLToPath } from "node:url";

export interface ServerOptions {
  databaseUrl?: string;
}

export function buildServer(_options: ServerOptions = {}) {
  const app = Fastify();

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = buildServer({ databaseUrl: process.env.DATABASE_URL });
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ host: "0.0.0.0", port });
}
