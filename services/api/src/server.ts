import Fastify, { type FastifyServerOptions } from "fastify";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import { registerImportRoutes } from "./imports/routes.js";
import { developmentContextResolver, localContainerContextResolver, type TrustedContextResolver } from "./imports/routes.js";
import { type ObjectStorage, unavailableObjectStorage } from "./storage/object-storage.js";
import { createMinioObjectStorageFromEnv } from "./storage/minio-object-storage.js";
import { AuthRepository } from "./auth/repository.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import { authenticatedContextResolver } from "./imports/routes.js";

export interface ServerOptions {
  databaseUrl?: string;
  database?: Database;
  authTokenSecret?: string;
  developmentMode?: boolean;
  localContainerDevelopmentMode?: boolean;
  trustedContextResolver?: TrustedContextResolver;
  objectStorage?: ObjectStorage;
  now?: () => Date;
  logger?: FastifyServerOptions["logger"];
}

export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, logger: options.logger ?? false });

  app.get("/health", async () => ({ status: "ok" }));
  const database = options.database ?? (options.databaseUrl ? createDatabase(options.databaseUrl) : undefined);
  const explicitContextResolver = options.trustedContextResolver ?? (
    options.localContainerDevelopmentMode
      ? localContainerContextResolver
      : options.developmentMode
        ? developmentContextResolver
        : undefined
  );
  const authTokenSecret = options.authTokenSecret?.trim();
  if (database && !explicitContextResolver && !authTokenSecret) {
    throw new Error("AUTH_TOKEN_SECRET is required");
  }
  const auth = database && !explicitContextResolver && authTokenSecret
    ? new AuthService(new AuthRepository(database), authTokenSecret, options.now ?? (() => new Date()))
    : undefined;
  const contextResolver = explicitContextResolver ?? (auth ? authenticatedContextResolver(auth) : undefined);
  if (auth) app.register((instance) => registerAuthRoutes(instance, auth));
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
    authTokenSecret: process.env.AUTH_TOKEN_SECRET,
    developmentMode: process.env.DEVELOPMENT_MODE === "true",
    localContainerDevelopmentMode: process.env.LOCAL_CONTAINER_DEVELOPMENT_MODE === "true",
    objectStorage: createMinioObjectStorageFromEnv(process.env),
    logger: true
  });
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ host: "0.0.0.0", port });
}
