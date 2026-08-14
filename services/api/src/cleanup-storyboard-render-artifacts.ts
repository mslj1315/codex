import { fileURLToPath } from "node:url";
import { createDatabase } from "./db.js";
import { RenderArtifactCleanupRunner } from "./video-editing/render-cleanup.js";
import { RenderRepository } from "./video-editing/render-repository.js";
import { createConfiguredVideoStorage, type ProtectedRenderStorage } from "./video-editing/storage.js";

export const STORYBOARD_RENDER_CLEANUP_LOCK_KEY = 734982134;
export async function runStoryboardRenderArtifactCleanup(environment: Record<string, string | undefined> = process.env) {
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const storage = createConfiguredVideoStorage(environment);
  if (!storage || !isProtected(storage)) throw new Error("VIDEO_STORAGE_MODE internal_signer is required");
  const database = createDatabase(environment.DATABASE_URL); const client = await database.connect();
  try { const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [STORYBOARD_RENDER_CLEANUP_LOCK_KEY]); if (!lock.rows[0]?.locked) return { skipped: true as const }; const runner = new RenderArtifactCleanupRunner(new RenderRepository(database).cleanupRepository(), storage); let cleaned = 0; while (await runner.runOnce()) cleaned++; await client.query("SELECT pg_advisory_unlock($1::bigint)", [STORYBOARD_RENDER_CLEANUP_LOCK_KEY]); return { skipped: false as const, cleaned }; } finally { client.release(); await database.end(); }
}
function isProtected(value: unknown): value is ProtectedRenderStorage { return typeof value === "object" && value !== null && "download" in value && "putProtected" in value && "deleteProtected" in value; }
if (process.argv[1] === fileURLToPath(import.meta.url)) { runStoryboardRenderArtifactCleanup().then(result => console.log(JSON.stringify(result))).catch(() => { console.error("Storyboard render artifact cleanup failed"); process.exitCode = 1; }); }
