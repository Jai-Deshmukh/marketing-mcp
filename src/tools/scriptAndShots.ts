import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkScript, checkShotList } from "../checks.js";
import { config } from "../config.js";
import { loadCrewPrompt } from "../crew.js";
import type { JobStore } from "../jobs/store.js";
import { Script, ShotList } from "../schemas.js";
import { bullets, fail, ok, toErrorResult } from "./result.js";

export function registerScriptTools(server: McpServer, store: JobStore): void {
  server.registerTool(
    "save_script",
    {
      title: "Save script",
      description:
        "Save (or replace) the script for a Hyv video job. Checks duration, voiceover length and brand rules; " +
        "if it fails, fix the listed problems and call again. On success returns the director and " +
        "cinematographer instructions for writing the shot list. Saving a new script clears the old shot list.",
      inputSchema: { job_id: z.string(), script: Script },
    },
    async ({ job_id, script }) => {
      try {
        const job = await store.get(job_id);
        const { errors, warnings } = checkScript(script, job.duration_s, config.wordsPerSecond);
        if (errors.length) return fail(`Script not saved. Fix these and call save_script again:\n${bullets(errors)}`);

        await store.update(job_id, (j) => ({ ...j, script, shot_list: undefined, stage: "shot_list" }));
        const vars = { aspect_ratio: job.aspect_ratio };
        const [director, dp] = await Promise.all([loadCrewPrompt("director", vars), loadCrewPrompt("cinematographer", vars)]);
        return ok(
          [
            `Saved script "${script.title}" (${script.scenes.length} scenes) to job ${job_id}.`,
            warnings.length ? `Warnings (saved anyway; consider fixing):\n${bullets(warnings)}` : "",
            "---",
            director,
            dp,
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
    "save_shot_list",
    {
      title: "Save shot list",
      description:
        "Save (or replace) the shot list for a Hyv video job that already has a script. Checks every scene is " +
        "covered and durations match the script; if it fails, fix the listed problems and call again.",
      inputSchema: { job_id: z.string(), shot_list: ShotList },
    },
    async ({ job_id, shot_list }) => {
      try {
        const job = await store.get(job_id);
        if (!job.script) return fail(`Job ${job_id} has no script yet. Call save_script first.`);

        const { errors, warnings } = checkShotList(shot_list, job.script);
        if (errors.length) return fail(`Shot list not saved. Fix these and call save_shot_list again:\n${bullets(errors)}`);

        await store.update(job_id, (j) => ({ ...j, shot_list, stage: "visuals" }));
        const videos = shot_list.shots.filter((s) => s.kind === "video");
        const images = shot_list.shots.length - videos.length;
        return ok(
          [
            `Saved ${shot_list.shots.length} shots to job ${job_id} (${videos.length} video, ${images} image).`,
            warnings.length ? `Warnings:\n${bullets(warnings)}` : "",
            [
              "Next:",
              "1. Show the user the shot list and get approval before spending OpenArt credits.",
              `2. Generate each shot with the OpenArt tools at ${job.aspect_ratio}, using its visual_prompt and negative_prompt.`,
              "   Make image keyframes first; only turn approved keyframes into video (image-to-video keeps characters consistent).",
              "   For kind: image shots, the still is enough: it gets a slow zoom in the edit.",
              "3. Pass each result URL to add_asset (several shots per call is fine).",
              "Tip: assemble_video with placeholders: true previews timing before any visuals exist.",
            ].join("\n"),
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
