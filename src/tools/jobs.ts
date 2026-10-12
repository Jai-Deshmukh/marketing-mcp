import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { brandKitBlock, loadCrewPrompt } from "../crew.js";
import type { JobStore } from "../jobs/store.js";
import { AspectRatio, Format, Language, Platform, type Job } from "../schemas.js";
import { ok, toErrorResult } from "./result.js";

const DEFAULT_ASPECT: Record<z.infer<typeof Platform>, z.infer<typeof AspectRatio>> = {
  instagram: "9:16",
  youtube_shorts: "9:16",
  youtube: "16:9",
  linkedin: "1:1",
  x: "16:9",
  other: "9:16",
};

export function summarizeJob(job: Job): string {
  const lines = [
    `Job ${job.id}: ${job.format}, ${job.duration_s}s, ${job.platform}, ${job.aspect_ratio}, ${job.language}`,
    `Brief: ${job.brief}`,
    `Stage: ${job.stage}`,
    `Script: ${job.script ? `"${job.script.title}" (${job.script.scenes.length} scenes)` : "not yet"}`,
    `Shot list: ${job.shot_list ? `${job.shot_list.shots.length} shots` : "not yet"}`,
  ];
  if (job.shot_list) {
    const missing = job.shot_list.shots.filter((s) => !job.assets[s.id]).map((s) => s.id);
    lines.push(`Visuals: ${Object.keys(job.assets).length}/${job.shot_list.shots.length}${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
  }
  lines.push(`Voiceover: ${job.voiceover ? `${job.voiceover.clips.length} lines, ${job.voiceover.voice}` : "not yet"}`);
  lines.push(`Music: ${job.music === null ? "none" : job.music ? `"${job.music.title}" (${job.music.mood})` : "not chosen"}`);
  for (const [name, task] of Object.entries(job.tasks)) {
    lines.push(`Task ${name}: ${task.status}${task.message ? `\n${task.message}` : ""}`);
  }
  if (job.outputs.length) lines.push(`Videos:\n${job.outputs.map((o) => `- ${o.aspect_ratio}: ${o.file}`).join("\n")}`);
  lines.push(`Folder: ${config.outputDir}/${job.id}`);
  if (job.errors.length) lines.push(`Errors:\n${job.errors.map((e) => `- ${e}`).join("\n")}`);
  return lines.join("\n");
}

export function registerJobTools(server: McpServer, store: JobStore): void {
  server.registerTool(
    "start_video",
    {
      title: "Start a Hyv video",
      description:
        "Start a new Hyv short-form video from a plain-language brief. Creates a job and returns the job_id, " +
        "the Hyv brand kit and the writer instructions. Next, write the script following those instructions " +
        "and call save_script. Use this first whenever the user asks for a reel, ad or explainer video.",
      inputSchema: {
        brief: z.string().min(3).describe('What the video is about, e.g. "30s reel about circles"'),
        format: Format.default("reel"),
        duration_s: z.number().int().min(5).max(180).default(30),
        platform: Platform.default("instagram"),
        tone: z.string().optional().describe("Optional tone tweak on top of the brand tone"),
        language: Language.default("en"),
        aspect_ratio: AspectRatio.optional().describe("Defaults from platform (instagram → 9:16, youtube → 16:9)"),
      },
    },
    async (args) => {
      try {
        const job = await store.create({
          brief: args.brief,
          format: args.format,
          duration_s: args.duration_s,
          platform: args.platform,
          tone: args.tone,
          language: args.language,
          aspect_ratio: args.aspect_ratio ?? DEFAULT_ASPECT[args.platform],
        });
        const writer = await loadCrewPrompt("writer", {
          words_per_second: config.wordsPerSecond,
          duration_s: job.duration_s,
          max_words: Math.round(job.duration_s * config.wordsPerSecond),
        });
        return ok(
          [
            `Created job ${job.id}.`,
            summarizeJob(job),
            args.tone ? `Tone tweak: ${args.tone}` : "",
            "---",
            await brandKitBlock(),
            "---",
            writer,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "job_status",
    {
      title: "Job status",
      description: "Show a Hyv video job's progress: script, shot list, visuals, voiceover, music, running tasks and finished video files.",
      inputSchema: { job_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ job_id }) => {
      try {
        return ok(summarizeJob(await store.get(job_id)));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description: "List recent Hyv video jobs, newest first.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      try {
        const jobs = (await store.list()).slice(0, limit);
        if (!jobs.length) return ok("No jobs yet. Use start_video to begin one.");
        return ok(jobs.map((j) => `- ${j.id} [${j.stage}] ${j.brief}`).join("\n"));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
