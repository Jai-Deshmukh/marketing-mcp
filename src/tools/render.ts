import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JobStore } from "../jobs/store.js";
import { runTask } from "../jobs/tasks.js";
import { assemble, missingShots } from "../media/assemble.js";
import { AspectRatio } from "../schemas.js";
import { fail, ok, toErrorResult } from "./result.js";

export function registerRenderTools(server: McpServer, store: JobStore): void {
  server.registerTool(
    "assemble_video",
    {
      title: "Assemble final video",
      description:
        "Render the finished Hyv video locally with ffmpeg: shots in order (stills get a slow zoom), on-screen " +
        "text, voiceover, ducked background music, burned-in captions and the Hyv end card. Outputs one MP4 per " +
        "aspect ratio (other ratios are reframed over a blurred background, no extra generation). " +
        "Use placeholders: true to preview timing before all visuals exist. May take a few minutes; if it reports " +
        "still running, check job_status.",
      inputSchema: {
        job_id: z.string(),
        aspect_ratios: z.array(AspectRatio).min(1).optional().describe("Defaults to the job's aspect ratio"),
        captions: z.boolean().default(true),
        end_card: z.boolean().default(true),
        placeholders: z.boolean().default(false).describe("Fill shots without visuals with labelled placeholder frames"),
        music_volume: z.number().min(0).max(1).default(0.18),
      },
    },
    async ({ job_id, aspect_ratios, captions, end_card, placeholders, music_volume }) => {
      try {
        const job = await store.get(job_id);
        if (!job.script || !job.shot_list) return fail(`Job ${job_id} needs a script and shot list first.`);
        const missing = missingShots(job);
        if (missing.length && !placeholders) {
          return fail(`Missing visuals for: ${missing.join(", ")}. Add them with add_asset, or pass placeholders: true for a timing preview.`);
        }
        const opts = { aspect_ratios: aspect_ratios ?? [job.aspect_ratio], captions, end_card, placeholders, music_volume };

        const outcome = await runTask(store, job_id, "assemble", async () => {
          await store.update(job_id, (j) => ({ ...j, stage: "assembly" }));
          const outputs = await assemble(store, job, opts);
          await store.update(job_id, (j) => ({ ...j, outputs, stage: missing.length ? "assembly" : "done" }));
          const files = outputs.map((o) => `- ${o.aspect_ratio} (${o.duration_s.toFixed(1)}s): ${o.file}`).join("\n");
          return `Rendered ${outputs.length} video${outputs.length > 1 ? "s" : ""}${missing.length ? " (preview with placeholders)" : ""}:\n${files}`;
        });

        if (outcome.status === "running") return ok(`Rendering job ${job_id} in the background. Check job_status in a minute or two.`);
        if (outcome.status === "failed") return fail(`Assembly failed: ${outcome.message}`);
        const notes = [
          !job.voiceover ? "No voiceover yet (generate_voiceover)." : "",
          job.music === undefined ? "No music chosen (pick_music), so there's no background music." : "",
        ].filter(Boolean);
        return ok([outcome.message, ...notes].join("\n\n"));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
