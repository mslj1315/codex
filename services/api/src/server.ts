import Fastify, { type FastifyServerOptions } from "fastify";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import { registerImportRoutes } from "./imports/routes.js";
import { developmentContextResolver, localContainerContextResolver, type TrustedContextResolver } from "./imports/routes.js";
import { type ObjectStorage, unavailableObjectStorage } from "./storage/object-storage.js";
import { createMinioObjectStorageFromEnv } from "./storage/minio-object-storage.js";
import { AuthRepository } from "./auth/repository.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerProviderBrowserAuthRoutes } from "./auth/provider-browser-routes.js";
import { AuthService } from "./auth/service.js";
import { authenticatedContextResolver } from "./imports/routes.js";
import { registerProviderFeedbackRoutes } from "./provider-feedback/routes.js";
import { registerProviderConsoleStatic } from "./provider-console-static.js";

export interface ServerOptions {
  databaseUrl?: string;
  database?: Database;
  authTokenSecret?: string;
  developmentMode?: boolean;
  providerBrowserDevelopmentMode?: boolean;
  providerConsoleDistDir?: string;
  localContainerDevelopmentMode?: boolean;
  trustedContextResolver?: TrustedContextResolver;
  objectStorage?: ObjectStorage;
  now?: () => Date;
  logger?: FastifyServerOptions["logger"];
}

export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, logger: options.logger ?? false });

  app.get("/health", async () => ({ status: "ok" }));
  const providerConsoleDistDir = options.providerConsoleDistDir;
  if (providerConsoleDistDir) {
    app.register((instance) => registerProviderConsoleStatic(instance, providerConsoleDistDir));
  }
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
  if (auth) {
    app.register((instance) => registerAuthRoutes(instance, auth));
    app.register((instance) => registerProviderBrowserAuthRoutes(instance, auth, {
      developmentMode: options.providerBrowserDevelopmentMode === true
    }));
  }
  if (auth && database && !explicitContextResolver) app.register((instance) => registerProviderFeedbackRoutes(instance, { auth, database, now: options.now ?? (() => new Date()) }));
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
    providerBrowserDevelopmentMode: process.env.PROVIDER_BROWSER_DEVELOPMENT_MODE === "true",
    providerConsoleDistDir: process.env.PROVIDER_CONSOLE_DIST_DIR
      ?? fileURLToPath(new URL("../provider-console-dist", import.meta.url)),
    localContainerDevelopmentMode: process.env.LOCAL_CONTAINER_DEVELOPMENT_MODE === "true",
    objectStorage: createMinioObjectStorageFromEnv(process.env),
    logger: true
  });
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ host: "0.0.0.0", port });
}
