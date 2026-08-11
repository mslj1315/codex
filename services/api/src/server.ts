import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import { registerImportRoutes } from "./imports/routes.js";
import { developmentContextResolver, localContainerContextResolver, type TrustedContextResolver } from "./imports/routes.js";
import { type ObjectStorage, unavailableObjectStorage } from "./storage/object-storage.js";
import { createMinioObjectStorageFromEnv } from "./storage/minio-object-storage.js";

export interface ServerOptions {
  databaseUrl?: string;
  database?: Database;
  developmentMode?: boolean;
  localContainerDevelopmentMode?: boolean;
  trustedContextResolver?: TrustedContextResolver;
  objectStorage?: ObjectStorage;
  now?: () => Date;
}

export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 });

  app.get("/health", async () => ({ status: "ok" }));
  const database = options.database ?? (options.databaseUrl ? createDatabase(options.databaseUrl) : undefined);
  const contextResolver = options.trustedContextResolver ?? (
    options.localContainerDevelopmentMode
      ? localContainerContextResolver
      : options.developmentMode
        ? developmentContextResolver
        : undefined
  );
  if (database && contextResolver) {
    app.register((instance) => registerImportRoutes(instance, {
      database,
      contextResolver,
      objectStorage: options.objectStorage ?? unavailableObjectStorage,
      now: options.now ?? (() => new Date())
    }));
  }

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = buildServer({
    databaseUrl: process.env.DATABASE_URL,
    developmentMode: process.env.DEVELOPMENT_MODE === "true",
    localContainerDevelopmentMode: process.env.LOCAL_CONTAINER_DEVELOPMENT_MODE === "true",
    objectStorage: createMinioObjectStorageFromEnv(process.env)
  });
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ host: "0.0.0.0", port });
}
