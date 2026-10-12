import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JobStore } from "../jobs/store.js";
import { describeError } from "../jobs/tasks.js";
import { fetchMedia, kindForExt } from "../media/download.js";
import { probe } from "../media/proc.js";
import type { Asset } from "../schemas.js";
import { bullets, fail, ok, toErrorResult } from "./result.js";

export function registerAssetTools(server: McpServer, store: JobStore): void {
  server.registerTool(
    "add_asset",
    {
      title: "Add visuals to shots",
      description:
        "Attach generated visuals to shots of a Hyv video job. After generating an image or video for a shot with " +
        "the OpenArt tools, pass its result URL here (or an absolute local file path). The file is downloaded into " +
        "the job folder; replacing a shot's visual is fine. Accepts several shots at once.",
      inputSchema: {
        job_id: z.string(),
        assets: z
          .array(
            z.object({
              shot_id: z.string(),
              source: z.string().describe("http(s) URL of the generated image/video, or an absolute local file path"),
            }),
          )
          .min(1),
      },
    },
    async ({ job_id, assets }) => {
      try {
        const job = await store.get(job_id);
        if (!job.shot_list) return fail(`Job ${job_id} has no shot list yet. Call save_shot_list first.`);
        const shots = new Map(job.shot_list.shots.map((s) => [s.id, s]));

        const dir = path.join(store.jobDir(job_id), "assets");
        await mkdir(dir, { recursive: true });

        // Each item succeeds or fails on its own, so one bad entry never drops the rest of the batch.
        const added: Asset[] = [];
        const notes: string[] = [];
        const failures: string[] = [];
        for (const { shot_id, source } of assets) {
          if (!shots.has(shot_id)) {
            failures.push(`${shot_id}: unknown shot id (valid: ${[...shots.keys()].join(", ")}).`);
            continue;
          }
          try {
            const file = await fetchMedia(source, path.join(dir, `${shot_id}.incoming`));
            const ext = path.extname(file);
            const final = path.join(dir, `${shot_id}${ext}`);
            await rm(final, { force: true });
            await rename(file, final);
            const previous = job.assets[shot_id];
            if (previous && store.resolve(job_id, previous.file) !== final) await rm(store.resolve(job_id, previous.file), { force: true });

            const kind = kindForExt(ext)!;
            const info = await probe(final);
            const shot = shots.get(shot_id)!;
            added.push({
              shot_id, kind, source,
              file: path.relative(store.jobDir(job_id), final),
              width: info.width, height: info.height,
              duration_s: kind === "video" ? info.duration_s : undefined,
              added_at: new Date().toISOString(),
            });
            if (kind !== shot.kind) notes.push(`${shot_id}: planned as ${shot.kind}, got ${kind} (fine; ${kind === "image" ? "it gets a slow zoom" : "it plays as video"}).`);
            if (kind === "video" && info.duration_s && info.duration_s + 0.2 < shot.duration_s) {
              notes.push(`${shot_id}: clip is ${info.duration_s.toFixed(1)}s but the shot is ${shot.duration_s}s; the last frame will be held.`);
            }
          } catch (err) {
            failures.push(`${shot_id}: ${describeError(err)}`);
          }
        }

        const updated = await store.update(job_id, (j) => ({
          ...j,
          assets: { ...j.assets, ...Object.fromEntries(added.map((a) => [a.shot_id, a])) },
          stage: j.stage === "shot_list" ? "visuals" : j.stage,
        }));
        const missing = updated.shot_list!.shots.filter((s) => !updated.assets[s.id]).map((s) => s.id);
        const lines = [
          added.length ? `Added ${added.map((a) => `${a.shot_id} (${a.kind})`).join(", ")} to job ${job_id}.` : "No visuals added.",
          failures.length ? `Failed:\n${bullets(failures)}` : "",
          notes.length ? `Notes:\n${bullets(notes)}` : "",
          missing.length
            ? `Still missing: ${missing.join(", ")}.`
            : "All shots have visuals. Next: generate_voiceover, then pick_music, then assemble_video.",
        ];
        const text = lines.filter(Boolean).join("\n\n");
        return added.length ? ok(text) : fail(text);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
