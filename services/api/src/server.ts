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
import { registerProviderCustomerRoutes } from "./provider-customers/routes.js";
import { registerProviderConsoleStatic } from "./provider-console-static.js";
import { registerOperatorConsoleStatic } from "./operator-console-static.js";
import { registerOperatorAuthRoutes } from "./operator-auth/routes.js";
import { registerOperatorContentRoutes } from "./operator-content/routes.js";
import { registerProfileRoutes } from "./content-planning/profile-routes.js";
import { registerWorkflowRoutes } from "./content-planning/workflow-routes.js";
import { createConfiguredGenerationService, type ModelGenerationService } from "./model-providers/generation.js";
import { registerVideoAssetRoutes } from "./video-editing/routes.js";
import { createConfiguredVideoStorage, type VideoStorage } from "./video-editing/storage.js";
import { registerStoryboardContextRoutes } from "./video-editing/storyboard-context-routes.js";
import { registerModelPricingRoutes } from "./model-pricing/routes.js";
import { registerCustomerAccountAdminRoutes } from "./admin/customer-account-routes.js";
import { registerModelConfigurationRoutes } from "./admin/model-config-routes.js";
import { ModelConfigurationRepository } from "./admin/model-configs.js";

export interface ServerOptions {
  databaseUrl?: string;
  database?: Database;
  authTokenSecret?: string;
  developmentMode?: boolean;
  providerBrowserDevelopmentMode?: boolean;
  operatorPublicOrigin?: string;
  providerConsoleDistDir?: string;
  operatorConsoleDistDir?: string;
  localContainerDevelopmentMode?: boolean;
  trustedContextResolver?: TrustedContextResolver;
  objectStorage?: ObjectStorage;
  now?: () => Date;
  logger?: FastifyServerOptions["logger"];
  modelGenerationService?: ModelGenerationService;
  videoStorage?: VideoStorage;
  modelConfigEncryptionKey?: string;
}

export function buildServer(options: ServerOptions = {}) {
  // Operator CSRF origin validation derives its scheme from this direct request.
  // Do not trust client-controlled forwarded protocol headers here.
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, logger: options.logger ?? false, trustProxy: false });

  app.get("/health", async () => ({ status: "ok" }));
  const providerConsoleDistDir = options.providerConsoleDistDir;
  if (providerConsoleDistDir) {
    app.register((instance) => registerProviderConsoleStatic(instance, providerConsoleDistDir));
  }
  if (options.operatorConsoleDistDir) {
    app.register((instance) => registerOperatorConsoleStatic(instance, options.operatorConsoleDistDir!));
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
  if (auth && database && !explicitContextResolver) {
    const providerOptions = { auth, database, now: options.now ?? (() => new Date()) };
    app.register((instance) => registerProviderFeedbackRoutes(instance, providerOptions));
    app.register((instance) => registerProviderCustomerRoutes(instance, providerOptions));
    app.register((instance) => registerModelPricingRoutes(instance, providerOptions));
    app.register((instance) => registerCustomerAccountAdminRoutes(instance, auth, database));
    app.register((instance) => registerModelConfigurationRoutes(instance, auth, database, options.modelConfigEncryptionKey));
  }
  if (database) {
    registerOperatorAuthRoutes(app, database, { publicOrigin: options.operatorPublicOrigin });
    app.register((instance) => registerOperatorContentRoutes(instance, database));
  }
  if (database && contextResolver) {
    app.register((instance) => registerImportRoutes(instance, {
      database,
      contextResolver,
      objectStorage: options.objectStorage ?? unavailableObjectStorage,
      now: options.now ?? (() => new Date())
    }));
    app.register((instance) => registerProfileRoutes(instance, database, contextResolver));
    app.register((instance) => registerStoryboardContextRoutes(instance, database, contextResolver));
    const modelResolver = options.modelConfigEncryptionKey ? new ModelConfigurationRepository(database, options.modelConfigEncryptionKey) : undefined;
    if (options.modelGenerationService || modelResolver) {
      app.register((instance) => registerWorkflowRoutes(instance, database, contextResolver, options.modelGenerationService, modelResolver));
    }
    if (options.videoStorage) {
      app.register((instance) => registerVideoAssetRoutes(instance, database, contextResolver, options.videoStorage!));
    }
  }

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = buildServer({
    databaseUrl: process.env.DATABASE_URL,
    authTokenSecret: process.env.AUTH_TOKEN_SECRET,
    developmentMode: process.env.DEVELOPMENT_MODE === "true",
    providerBrowserDevelopmentMode: process.env.PROVIDER_BROWSER_DEVELOPMENT_MODE === "true",
    operatorPublicOrigin: process.env.OPERATOR_PUBLIC_ORIGIN,
    providerConsoleDistDir: process.env.PROVIDER_CONSOLE_DIST_DIR
      ?? fileURLToPath(new URL("../provider-console-dist", import.meta.url)),
    operatorConsoleDistDir: process.env.OPERATOR_CONSOLE_DIST_DIR
      ?? fileURLToPath(new URL("../operator-console-dist", import.meta.url)),
    localContainerDevelopmentMode: process.env.LOCAL_CONTAINER_DEVELOPMENT_MODE === "true",
    objectStorage: createMinioObjectStorageFromEnv(process.env),
    modelGenerationService: createConfiguredGenerationService(process.env),
    modelConfigEncryptionKey: process.env.MODEL_CONFIG_ENCRYPTION_KEY,
    videoStorage: createConfiguredVideoStorage(process.env),
    logger: true
  });
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ host: "0.0.0.0", port });
}
