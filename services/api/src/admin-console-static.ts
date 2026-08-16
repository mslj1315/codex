import staticFiles from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export async function registerAdminConsoleStatic(app: FastifyInstance, distDir: string): Promise<void> {
  const indexPath = join(distDir, "index.html");
  const assetsDir = join(distDir, "assets");
  if (!await file(indexPath) || !await directory(assetsDir)) return;
  const index = await readFile(indexPath);
  await app.register(staticFiles, { root: assetsDir, prefix: "/admin/assets/", decorateReply: false });
  const send = async (_request: unknown, reply: { type(value: string): { send(value: Buffer): unknown } }) => reply.type("text/html; charset=utf-8").send(index);
  app.get("/admin/", send); app.get("/admin/*", send);
}
async function file(path: string) { try { return (await stat(path)).isFile(); } catch { return false; } }
async function directory(path: string) { try { return (await stat(path)).isDirectory(); } catch { return false; } }
