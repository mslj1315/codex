import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import { registerImportRoutes } from "./imports/routes.js";
import { registerProfileRoutes } from "./content-planning/profile-routes.js";
import { registerWorkflowRoutes } from "./content-planning/workflow-routes.js";
import { registerOperatorContentRoutes } from "./operator-content/routes.js";
import { registerOperatorAuthRoutes } from "./operator-auth/routes.js";
import { createConfiguredGenerationService, type ModelGenerationService } from "./model-providers/generation.js";
import { developmentContextResolver, localContainerContextResolver, type TrustedContextResolver } from "./imports/routes.js";

export interface ServerOptions {
  databaseUrl?: string;
  database?: Database;
  developmentMode?: boolean;
  localContainerDevelopmentMode?: boolean;
  trustedContextResolver?: TrustedContextResolver;
  operatorConsoleDistDir?: string;
  modelGenerationService?: ModelGenerationService;
}

export function buildServer(options: ServerOptions = {}) {
  // Operator CSRF origin validation derives its scheme from this direct request.
  // Do not trust client-controlled forwarded protocol headers here.
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, trustProxy: false });
  if (options.modelGenerationService) app.decorate("modelGenerationService", options.modelGenerationService);

  app.get("/health", async () => ({ status: "ok" }));
  const database = options.database ?? (options.databaseUrl ? createDatabase(options.databaseUrl) : undefined);
  const contextResolver = options.trustedContextResolver ?? (
    options.localContainerDevelopmentMode
      ? localContainerContextResolver
      : options.developmentMode
        ? developmentContextResolver
        : undefined
  );
  if (database) {
    registerOperatorAuthRoutes(app, database);
  }
  if (database) {
    app.register((instance) => registerOperatorContentRoutes(instance, database));
  }
  if (database && contextResolver) {
    app.register((instance) => registerImportRoutes(instance, database, contextResolver));
    app.register((instance) => registerProfileRoutes(instance, database, contextResolver));
    if (options.modelGenerationService) app.register((instance) => registerWorkflowRoutes(instance, database, contextResolver, options.modelGenerationService));
  }
  if (options.operatorConsoleDistDir) {
    app.register(fastifyStatic, { root: options.operatorConsoleDistDir, prefix: "/", wildcard: false });
  }

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = buildServer({
    databaseUrl: process.env.DATABASE_URL,
    developmentMode: process.env.DEVELOPMENT_MODE === "true",
    localContainerDevelopmentMode: process.env.LOCAL_CONTAINER_DEVELOPMENT_MODE === "true",
    operatorConsoleDistDir: process.env.OPERATOR_CONSOLE_DIST_DIR,
    modelGenerationService: createConfiguredGenerationService(process.env)
  });
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ host: "0.0.0.0", port });
}
