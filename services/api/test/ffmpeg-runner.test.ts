import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { FfmpegRenderRunner, type SpawnProcess } from "../src/video-editing/ffmpeg-runner.js";

describe("FFmpeg storyboard render runner", () => {
  it("uses argument arrays without a shell and validates the probed MP4 output", async () => {
    const calls: Array<{ command: string; args: string[]; shell: boolean }> = [];
    const spawn: SpawnProcess = async (command, args, options) => {
      calls.push({ command, args, shell: options.shell });
      if (command === "ffprobe") return { stdout: JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "4" }, streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30/1", pix_fmt: "yuv420p" }] }), stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    };
    const files = new MemoryFiles();
    files.set(join("work", "output.mp4"), Buffer.from("output"));
    files.set(join("work", "cover-1.jpg"), Buffer.from("cover-1"));
    files.set(join("work", "cover-2.jpg"), Buffer.from("cover-2"));
    files.set(join("work", "cover-3.jpg"), Buffer.from("cover-3"));
    const runner = new FfmpegRenderRunner({ ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", spawn, files });

    const result = await runner.render({ width: 1080, height: 1920, fps: 30, durationSeconds: 4, subtitles: ["saved subtitle"], sources: [Buffer.from("source")], workspacePath: "work", slots: [{ sourceIndex: 0, trimStartSeconds: 0, trimEndSeconds: 4, muted: true, subtitleText: "saved subtitle", subtitleEnabled: true }] });

    expect(calls.every(call => call.shell === false)).toBe(true);
    expect(calls[0]).toMatchObject({ command: "ffmpeg" });
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["-ss", "0", "-t", "4", "-an", "-c:v", "libx264", "-r", "30", "-s", "1080x1920", "-movflags", "+faststart"]));
    expect(calls.filter(call => call.command === "ffmpeg")).toHaveLength(4);
    expect(result.metadata).toMatchObject({ width: 1080, height: 1920, fps: 30, durationSeconds: 4, contentType: "video/mp4" });
    expect(result.coverFrames.map(frame => frame.positionSeconds)).toEqual([1, 2, 3]);
  });

  it("rejects output whose probe metadata is not vertical H.264 MP4 at 30 fps", async () => {
    const spawn: SpawnProcess = async command => command === "ffprobe"
      ? { stdout: JSON.stringify({ format: { format_name: "matroska", duration: "4" }, streams: [{ codec_type: "video", codec_name: "vp9", width: 1920, height: 1080, r_frame_rate: "24/1" }] }), stderr: "", code: 0 }
      : { stdout: "", stderr: "", code: 0 };
    const files = new MemoryFiles();
    files.set(join("work", "output.mp4"), Buffer.from("output"));
    const runner = new FfmpegRenderRunner({ ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", spawn, files });
    await expect(runner.render({ width: 1080, height: 1920, fps: 30, durationSeconds: 4, subtitles: [], sources: [Buffer.from("source")], workspacePath: "work", slots: [{ sourceIndex: 0, trimStartSeconds: 0, trimEndSeconds: 4, muted: false, subtitleEnabled: false }] })).rejects.toThrow("Invalid FFmpeg output metadata");
  });
});

const integration = process.env.FFMPEG_INTEGRATION === "1" ? it : it.skip;
integration("renders and probes a real vertical H.264 MP4 when explicitly enabled", async () => {
  const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg"; const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";
  const workspace = await mkdtemp(join(tmpdir(), "storyboard-ffmpeg-test-"));
  try {
    const source = join(workspace, "fixture.mp4");
    const fixture = spawnSync(ffmpegPath, ["-y", "-f", "lavfi", "-i", "color=c=red:s=1080x1920:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { shell: false });
    if (fixture.status !== 0) throw new Error("FFMPEG_INTEGRATION fixture creation failed");
    const runner = new FfmpegRenderRunner({ ffmpegPath, ffprobePath });
    const result = await runner.render({ width: 1080, height: 1920, fps: 30, durationSeconds: 4, subtitles: ["saved subtitle"], sources: [await readFile(source)], workspacePath: workspace, slots: [{ sourceIndex: 0, trimStartSeconds: 0, trimEndSeconds: 4, muted: true, subtitleText: "saved subtitle", subtitleEnabled: true }] });
    expect(result.metadata).toMatchObject({ width: 1080, height: 1920, fps: 30, contentType: "video/mp4" });
    expect(result.coverFrames).toHaveLength(3);
    expect(new Set(result.coverFrames.map(frame => frame.positionSeconds)).size).toBe(3);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

class MemoryFiles {
  private readonly values = new Map<string, Buffer>();
  set(path: string, value: Buffer) { this.values.set(path, value); }
  async writeFile(path: string, value: Buffer | string) { this.values.set(path, Buffer.from(value)); }
  async readFile(path: string) { const value = this.values.get(path); if (!value) throw new Error(`missing ${path}`); return value; }
}
