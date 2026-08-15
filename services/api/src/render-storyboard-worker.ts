import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db.js";
import { FfmpegRenderRunner } from "./video-editing/ffmpeg-runner.js";
import { RenderRepository } from "./video-editing/render-repository.js";
import { createConfiguredVideoStorage, type ProtectedRenderStorage } from "./video-editing/storage.js";
import { StoryboardRenderWorker, type TemporaryWorkspace } from "./video-editing/worker.js";

export type RenderWorkerConfiguration = { databaseUrl: string; ffmpegPath: string; ffprobePath: string; loop: boolean };
export function renderWorkerConfiguration(environment: Record<string, string | undefined> = process.env): RenderWorkerConfiguration {
  const databaseUrl = environment.DATABASE_URL?.trim(); if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (environment.VIDEO_STORAGE_MODE !== "internal_signer" || !environment.VIDEO_STORAGE_SIGNER_URL?.trim() || !environment.VIDEO_STORAGE_SIGNER_TOKEN?.trim()) throw new Error("VIDEO_STORAGE_MODE internal_signer is required");
  const ffmpegPath = environment.FFMPEG_PATH?.trim(); if (!ffmpegPath) throw new Error("FFMPEG_PATH is required");
  const ffprobePath = environment.FFPROBE_PATH?.trim(); if (!ffprobePath) throw new Error("FFPROBE_PATH is required");
  return { databaseUrl, ffmpegPath, ffprobePath, loop: environment.STORYBOARD_RENDER_WORKER_LOOP === "1" };
}
export async function runStoryboardRenderWorker(environment: Record<string, string | undefined> = process.env) {
  const config = renderWorkerConfiguration(environment); const storage = createConfiguredVideoStorage(environment);
  if (!storage || !isProtected(storage)) throw new Error("VIDEO_STORAGE_MODE internal_signer is required");
  const database = createDatabase(config.databaseUrl); const worker = new StoryboardRenderWorker(new RenderRepository(database).workerRepository(), workspace, storage, new FfmpegRenderRunner({ ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath }));
  let processed = 0;
  try { do { if (!await worker.runOnce()) break; processed++; } while (config.loop); return { processed }; } finally { await database.end(); }
}
const workspace: TemporaryWorkspace = { create: jobId => mkdtemp(join(tmpdir(), `storyboard-render-${safeSegment(jobId)}-`)), remove: path => rm(path, { recursive: true, force: true }) };
function safeSegment(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, "_"); }
function isProtected(value: unknown): value is ProtectedRenderStorage { return typeof value === "object" && value !== null && "downloadToFile" in value && "putProtectedFile" in value && "deleteProtected" in value; }
if (process.argv[1] === fileURLToPath(import.meta.url)) runStoryboardRenderWorker().then(result => console.log(JSON.stringify(result))).catch(() => { console.error("Storyboard render worker failed"); process.exitCode = 1; });
