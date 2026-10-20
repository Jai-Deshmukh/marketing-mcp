import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import type { JobStore } from "../jobs/store.js";
import { runTask, UserFacingError } from "../jobs/tasks.js";
import { probe } from "../media/proc.js";
import { listTracks, moods, pickTrack } from "../music.js";
import type { Voiceover } from "../schemas.js";
import { chooseVoice, kokoroAvailable, planVoices, synthesize, VOICE_HELP } from "../voice/tts.js";
import { bullets, fail, ok, toErrorResult } from "./result.js";

const FREE_MUSIC_HELP =
  "Add royalty-free tracks to the music library, one folder per mood, e.g. " +
  `${config.musicDir}/upbeat/track.mp3, .../calm/..., .../warm/... ` +
  "Free sources that allow commercial use: YouTube Audio Library (no attribution filter), Pixabay Music.";

export function registerAudioTools(server: McpServer, store: JobStore): void {
  server.registerTool(
    "generate_voiceover",
    {
      title: "Generate voiceover",
      description:
        "Generate the voiceover for every scene of a Hyv video job's saved script, locally and free. " +
        `Optional voice: ${VOICE_HELP} Defaults by job language. Re-running replaces the previous voiceover. ` +
        "Usually finishes within a minute; if it reports still running, check job_status.",
      inputSchema: {
        job_id: z.string(),
        voice: z.string().optional(),
        speed: z.number().min(0.7).max(1.3).default(1).describe("1 = natural pace"),
      },
    },
    async ({ job_id, voice, speed }) => {
      try {
        const job = await store.get(job_id);
        if (!job.script) return fail(`Job ${job_id} has no script yet. Call save_script first.`);
        const hasKokoro = await kokoroAvailable();
        const choice = chooseVoice(job.language, voice, config.voiceEngine, hasKokoro);

        const outcome = await runTask(store, job_id, "voiceover", async () => {
          const dir = path.join(store.jobDir(job_id), "audio");
          await rm(dir, { recursive: true, force: true });
          await mkdir(dir, { recursive: true });
          const scenes = job.script!.scenes.filter((s) => s.vo.trim());
          if (!scenes.length) throw new UserFacingError("The script has no voiceover lines.");

          const items = scenes.map((s) => ({ text: s.vo, out: path.join(dir, `vo_${s.id}.wav`) }));
          // Dialogue: scenes may name their own voice. Record each voice's lines in one batch.
          const groups = planVoices(scenes, job.language, voice, config.voiceEngine, hasKokoro);
          const voiceOf = new Map<string, string>();
          for (const group of groups) {
            const batch = items.filter((_, i) => group.sceneIds.includes(scenes[i].id));
            await synthesize(group.choice, speed, batch);
            for (const id of group.sceneIds) voiceOf.set(id, group.choice.voice);
          }

          const clips: Voiceover["clips"] = [];
          const warnings: string[] = [];
          for (const [i, scene] of scenes.entries()) {
            const duration_s = (await probe(items[i].out)).duration_s ?? 0;
            clips.push({ scene_id: scene.id, file: path.relative(store.jobDir(job_id), items[i].out), duration_s, voice: voiceOf.get(scene.id) });
            if (duration_s > scene.duration_s) {
              warnings.push(`Scene ${scene.id}: line takes ${duration_s.toFixed(1)}s but the scene is ${scene.duration_s}s; it will be cut off. Shorten the line or speed up.`);
            }
          }
          await store.update(job_id, (j) => ({
            ...j,
            voiceover: { engine: choice.engine, voice: choice.voice, clips, created_at: new Date().toISOString() },
            stage: j.stage === "assembly" || j.stage === "done" ? j.stage : "audio",
          }));
          const spoken = clips.reduce((t, c) => t + c.duration_s, 0);
          return [
            groups.length > 1
              ? `Voiceover ready: ${clips.length} lines, ${spoken.toFixed(1)}s of speech, ${groups.length} voices: ${groups.map((g) => `${g.choice.voice} (${g.choice.engine}, ${g.sceneIds.length} line${g.sceneIds.length === 1 ? "" : "s"})`).join(", ")}.`
              : `Voiceover ready: ${clips.length} lines, ${spoken.toFixed(1)}s of speech, voice ${groups[0].choice.voice} (${groups[0].choice.engine}).`,
            ...(warnings.length ? [`Warnings:\n${bullets(warnings)}`] : []),
          ].join("\n");
        });

        if (outcome.status === "running") return ok(`Voiceover is generating for job ${job_id}. Check job_status in a minute.`);
        if (outcome.status === "failed") return fail(`Voiceover failed: ${outcome.message}`);
        return ok(`${outcome.message}\n\nNext: pick_music (or skip music), then assemble_video.`);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "pick_music",
    {
      title: "Pick background music",
      description:
        "Choose background music for a Hyv video job from the local royalty-free library, by mood " +
        "(e.g. upbeat, calm, warm). Call with no mood to list available moods. Set none: true for no music.",
      inputSchema: {
        job_id: z.string(),
        mood: z.string().optional(),
        none: z.boolean().default(false).describe("true = no background music"),
        variation: z.number().int().min(0).default(0).describe("Pick a different track with the same mood"),
      },
    },
    async ({ job_id, mood, none, variation }) => {
      try {
        await store.get(job_id);
        if (none) {
          await store.update(job_id, (j) => ({ ...j, music: null }));
          return ok(`Job ${job_id} will have no background music.`);
        }
        const tracks = await listTracks(config.musicDir);
        if (!tracks.length) return fail(`The music library is empty. ${FREE_MUSIC_HELP}\nOr call pick_music with none: true.`);
        const available = moods(tracks);
        if (!mood) return ok(`Available moods: ${available.join(", ")} (${tracks.length} tracks).`);

        const track = pickTrack(tracks, mood, variation);
        if (!track) return fail(`No tracks for mood "${mood}". Available moods: ${available.join(", ")}.`);
        await store.update(job_id, (j) => ({ ...j, music: { file: track.file, title: track.title, mood: track.mood } }));
        return ok(`Music for job ${job_id}: "${track.title}" (${track.mood}).\n\nNext: assemble_video.`);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
