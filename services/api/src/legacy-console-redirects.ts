import type { FastifyInstance } from "fastify";

const LEGACY_CONSOLE_PREFIXES = ["/provider", "/operator"] as const;

export function registerLegacyConsoleRedirects(app: FastifyInstance): void {
  for (const prefix of LEGACY_CONSOLE_PREFIXES) {
    app.get(`${prefix}/assets/*`, async (_request, reply) => reply.code(404).send());
    app.get(prefix, async (_request, reply) => reply.redirect("/admin/", 302));
    app.get(`${prefix}/`, async (_request, reply) => reply.redirect("/admin/", 302));
    app.get(`${prefix}/*`, async (_request, reply) => reply.redirect("/admin/", 302));
  }
}
