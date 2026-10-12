import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// This file lives in src/ (dev) or dist/ (build); either way the project root is one level up.
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const Env = z.object({
  OUTPUT_DIR: z.string().default("./output"),
  WORDS_PER_SECOND: z.coerce.number().positive().default(2.5),
  MUSIC_DIR: z.string().default("./src/brand/assets/music"),
  VOICE_ENGINE: z.enum(["auto", "kokoro", "say"]).default("auto"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
});

const env = Env.parse(process.env);

export const config = {
  // Resolve against the project root: Claude Desktop launches servers with cwd "/".
  outputDir: path.resolve(projectRoot, env.OUTPUT_DIR),
  wordsPerSecond: env.WORDS_PER_SECOND,
  // Read from src/ at runtime so edits to the brand kit, prompts or music need no rebuild.
  brandDir: path.join(projectRoot, "src", "brand"),
  crewDir: path.join(projectRoot, "src", "crew"),
  musicDir: path.resolve(projectRoot, env.MUSIC_DIR),
  projectRoot,
  voiceEngine: env.VOICE_ENGINE,
  // Claude Desktop starts servers with a minimal PATH; Homebrew binaries are found via extraPath.
  ffmpeg: env.FFMPEG_PATH,
  ffprobe: env.FFPROBE_PATH,
  extraPath: ["/opt/homebrew/bin", "/usr/local/bin"],
  venvPython: path.join(projectRoot, ".venv", "bin", "python"),
};

export type Config = typeof config;
