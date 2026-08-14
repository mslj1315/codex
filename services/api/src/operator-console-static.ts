import staticFiles from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export async function registerOperatorConsoleStatic(app: FastifyInstance, distDir: string): Promise<void> {
  const indexPath = join(distDir, "index.html");
  const assetsDir = join(distDir, "assets");
  if (!await isFile(indexPath) || !await isDirectory(assetsDir)) return;

  const index = await readFile(indexPath);
  await app.register(staticFiles, {
    root: assetsDir,
    prefix: "/operator/assets/",
    decorateReply: false
  });

  const sendIndex = async (_request: unknown, reply: { type(contentType: string): { send(payload: Buffer): unknown } }) =>
    reply.type("text/html; charset=utf-8").send(index);
  app.get("/operator/", sendIndex);
  app.get("/operator/*", sendIndex);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
