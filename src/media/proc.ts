import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { config } from "../config.js";

export class ToolMissingError extends Error {}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly stderrTail: string,
  ) {
    super(message);
  }
}

// Claude Desktop launches servers with a minimal PATH that misses Homebrew.
const env = () => ({
  ...process.env,
  PATH: [...config.extraPath, process.env.PATH ?? "/usr/bin:/bin"].join(":"),
});

// Runs a command without a shell (arguments are never interpolated), optionally piping stdin.
export function run(cmd: string, args: string[], opts: { input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: env(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "ENOENT" ? new ToolMissingError(`"${cmd}" is not installed. Run scripts/setup.sh.`) : err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new ProcessError(`${cmd} exited with code ${code}`, stderr.trim().split("\n").slice(-6).join("\n")));
    });
    child.stdin.end(opts.input ?? "");
  });
}

export const ffmpeg = (args: string[]) => run(config.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]);

export interface Probe {
  duration_s?: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const out = await run(config.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const data = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type: string; width?: number; height?: number }[];
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const duration = Number(data.format?.duration);
  return {
    duration_s: Number.isFinite(duration) ? duration : undefined,
    width: video?.width,
    height: video?.height,
    hasVideo: !!video,
    hasAudio: !!data.streams?.some((s) => s.codec_type === "audio"),
  };
}

export async function python(script: string, spec: unknown): Promise<string> {
  try {
    await access(config.venvPython);
  } catch {
    throw new ToolMissingError("The local Python environment is missing. Run scripts/setup.sh.");
  }
  return run(config.venvPython, [script], { input: JSON.stringify(spec) });
}
