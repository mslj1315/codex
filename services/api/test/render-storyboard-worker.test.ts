import { describe, expect, it } from "vitest";
import { renderWorkerConfiguration } from "../src/render-storyboard-worker.js";

describe("storyboard render worker command", () => {
  it("requires database, isolated signer, and explicit FFmpeg binaries", () => {
    expect(() => renderWorkerConfiguration({})).toThrow("DATABASE_URL is required");
    expect(() => renderWorkerConfiguration({ DATABASE_URL: "postgres://example" })).toThrow("VIDEO_STORAGE_MODE internal_signer is required");
    expect(() => renderWorkerConfiguration({ DATABASE_URL: "postgres://example", VIDEO_STORAGE_MODE: "internal_signer", VIDEO_STORAGE_SIGNER_URL: "https://signer.example", VIDEO_STORAGE_SIGNER_TOKEN: "worker-only" })).toThrow("FFMPEG_PATH is required");
    expect(renderWorkerConfiguration({ DATABASE_URL: "postgres://example", VIDEO_STORAGE_MODE: "internal_signer", VIDEO_STORAGE_SIGNER_URL: "https://signer.example", VIDEO_STORAGE_SIGNER_TOKEN: "worker-only", FFMPEG_PATH: "ffmpeg", FFPROBE_PATH: "ffprobe" })).toMatchObject({ ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", loop: false });
  });
});
