import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { RenderManifest, RenderRunner, RunnerResult } from "./worker.js";

export type SpawnResult = { stdout: string; stderr: string; code: number };
export type SpawnProcess = (command: string, args: string[], options: { cwd: string; shell: false }) => Promise<SpawnResult>;
export interface RenderFiles { writeFile(path: string, value: string): Promise<void>; }

export class FfmpegRenderRunner implements RenderRunner {
  private readonly spawn: SpawnProcess;
  private readonly files: RenderFiles;
  constructor(private readonly options: { ffmpegPath: string; ffprobePath: string; spawn?: SpawnProcess; files?: RenderFiles }) {
    validateBinary(options.ffmpegPath, "ffmpeg"); validateBinary(options.ffprobePath, "ffprobe");
    this.spawn = options.spawn ?? spawnProcess;
    this.files = options.files ?? { writeFile };
  }
  async render(manifest: RenderManifest): Promise<RunnerResult> {
    if (!manifest.workspacePath) throw new Error("Render workspace is required");
    const workspacePath = manifest.workspacePath;
    const slots = manifest.slots?.length ? manifest.slots : manifest.sourcePaths.map((_, sourceIndex) => ({ sourceIndex, trimStartSeconds: 0, trimEndSeconds: manifest.durationSeconds, muted: false, subtitleEnabled: false }));
    if (slots.some(slot => !Number.isInteger(slot.sourceIndex) || !manifest.sourcePaths[slot.sourceIndex] || !validTrim(slot.trimStartSeconds, slot.trimEndSeconds, manifest.durationSeconds))) throw new Error("Invalid render manifest");
    await this.files.writeFile(join(workspacePath, "subtitles.srt"), subtitles(slots));
    const sourceAudio = await Promise.all(manifest.sourcePaths.map(sourcePath => this.hasAudio(workspacePath, sourcePath)));
    const inputArgs = slots.flatMap(slot => ["-ss", number(slot.trimStartSeconds), "-t", number(slot.trimEndSeconds - slot.trimStartSeconds), "-i", manifest.sourcePaths[slot.sourceIndex]!]);
    const hasAudio = slots.some(slot => !slot.muted);
    const visuals = slots.map((_, index) => `[${index}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`);
    const audio = hasAudio ? slots.map((slot, index) => slot.muted || !sourceAudio[slot.sourceIndex] ? `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${number(slot.trimEndSeconds - slot.trimStartSeconds)},asetpts=PTS-STARTPTS[a${index}]` : `[${index}:a]atrim=start=0:end=${number(slot.trimEndSeconds - slot.trimStartSeconds)},asetpts=PTS-STARTPTS[a${index}]`) : [];
    const graph = hasAudio ? `${[...visuals, ...audio].join(";")};${slots.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${slots.length}:v=1:a=1[v0][a];[v0]subtitles=subtitles.srt[v]` : `${visuals.join(";")};${slots.map((_, index) => `[v${index}]`).join("")}concat=n=${slots.length}:v=1:a=0,subtitles=subtitles.srt[v]`;
    const outputArgs = hasAudio ? ["-map", "[v]", "-map", "[a]", "-c:a", "aac"] : ["-map", "[v]", "-an"];
    await run(this.spawn, this.options.ffmpegPath, ["-y", ...inputArgs, "-filter_complex", graph, ...outputArgs, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-s", "1080x1920", "-movflags", "+faststart", "output.mp4"], workspacePath);
    const metadata = await this.probe(workspacePath, "output.mp4");
    const positions = coverPositions(metadata.durationSeconds);
    for (let index = 0; index < positions.length; index++) await run(this.spawn, this.options.ffmpegPath, ["-y", "-ss", number(positions[index]!), "-i", "output.mp4", "-frames:v", "1", "-q:v", "2", `cover-${index + 1}.jpg`], workspacePath);
    return { outputPath: join(workspacePath, "output.mp4"), metadata: { ...metadata, contentType: "video/mp4" }, coverPaths: positions.map((positionSeconds, index) => ({ positionSeconds, path: join(workspacePath, `cover-${index + 1}.jpg`) })) };
  }
  private async probe(workspacePath: string, output: string) {
    const result = await this.spawn(this.options.ffprobePath, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", output], { cwd: workspacePath, shell: false });
    if (result.code !== 0) throw new Error("FFprobe failed");
    let value: unknown; try { value = JSON.parse(result.stdout); } catch { throw new Error("Invalid FFmpeg output metadata"); }
    const data = value as { format?: { format_name?: unknown; duration?: unknown }; streams?: Array<{ codec_type?: unknown; codec_name?: unknown; width?: unknown; height?: unknown; r_frame_rate?: unknown; pix_fmt?: unknown }> };
    const video = data.streams?.find(stream => stream.codec_type === "video"); const durationSeconds = Number(data.format?.duration);
    if (!video || video.codec_name !== "h264" || !String(data.format?.format_name ?? "").split(",").includes("mp4") || Number(video.width) !== 1080 || Number(video.height) !== 1920 || fps(video.r_frame_rate) !== 30 || video.pix_fmt !== "yuv420p" || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 90) throw new Error("Invalid FFmpeg output metadata");
    return { width: 1080, height: 1920, fps: 30, durationSeconds };
  }
  private async hasAudio(workspacePath: string, source: string) { const result = await this.spawn(this.options.ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", source], { cwd: workspacePath, shell: false }); if (result.code !== 0) throw new Error("FFprobe failed"); try { return (JSON.parse(result.stdout) as { streams?: Array<{ codec_type?: unknown }> }).streams?.some(stream => stream.codec_type === "audio") === true; } catch { throw new Error("Invalid source metadata"); } }
}

function subtitles(slots: NonNullable<RenderManifest["slots"]>) { let offset = 0; const entries: string[] = []; for (const slot of slots) { const duration = slot.trimEndSeconds - slot.trimStartSeconds; if (slot.subtitleEnabled && slot.subtitleText?.trim()) entries.push(`${entries.length + 1}\n${srtTime(offset)} --> ${srtTime(offset + duration)}\n${slot.subtitleText.replace(/[\r\n]+/g, " ").trim()}\n`); offset += duration; } return entries.join("\n"); }
function srtTime(seconds: number) { const milliseconds = Math.round(seconds * 1000); const hours = Math.floor(milliseconds / 3_600_000); const minutes = Math.floor(milliseconds % 3_600_000 / 60_000); const remainder = milliseconds % 60_000; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 1000)).padStart(2, "0")},${String(remainder % 1000).padStart(3, "0")}`; }
function validTrim(start: number, end: number, duration: number) { return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration; }
function number(value: number) { return String(value); }
function fps(value: unknown) { const [numerator, denominator] = String(value).split("/").map(Number); return denominator ? numerator / denominator : numerator; }
function coverPositions(duration: number) { return [duration / 4, duration / 2, duration * 3 / 4]; }
function validateBinary(value: string, expected: string) { if (!value || (!isAbsolute(value) && value !== expected) || /[\r\n]/.test(value)) throw new Error(`Invalid ${expected} binary path`); }
async function run(process: SpawnProcess, command: string, args: string[], cwd: string) { const result = await process(command, args, { cwd, shell: false }); if (result.code !== 0) throw new Error("FFmpeg execution failed"); }
function spawnProcess(command: string, args: string[], options: { cwd: string; shell: false }): Promise<SpawnResult> { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); }); child.once("error", reject); child.once("close", code => resolve({ stdout, stderr, code: code ?? 1 })); }); }
