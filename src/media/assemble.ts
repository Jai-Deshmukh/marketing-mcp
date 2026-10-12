import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JobStore } from "../jobs/store.js";
import { UserFacingError } from "../jobs/tasks.js";
import type { AspectRatio, Job } from "../schemas.js";
import { captionCues, sceneStarts, titleCues, type Cue } from "./captions.js";
import { CANVAS, COLOR_TAGS, FPS, NORMALIZE, coverFilter, kenBurnsFilter, reframeFilter, type Canvas } from "./layout.js";
import { ffmpeg, probe } from "./proc.js";
import { brandStyle, renderText, type TextItem, type TextStyle } from "./text.js";

export interface AssembleOptions {
  aspect_ratios: AspectRatio[];
  captions: boolean;
  end_card: boolean;
  placeholders: boolean;
  music_volume: number;
}

export interface Rendered {
  aspect_ratio: AspectRatio;
  file: string;
  duration_s: number;
}

// Intermediate encodes: fast and near-lossless, re-encoded once at the end.
const WORK_ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS), ...COLOR_TAGS];
const FINAL_ENCODE = [
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), ...COLOR_TAGS,
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
];

const sec = (n: number) => n.toFixed(3);
const tag = (ar: AspectRatio) => ar.replace(":", "x");

export function missingShots(job: Job): string[] {
  return (job.shot_list?.shots ?? []).filter((s) => !job.assets[s.id]).map((s) => s.id);
}

export async function assemble(store: JobStore, job: Job, opts: AssembleOptions): Promise<Rendered[]> {
  const script = job.script;
  const shots = job.shot_list?.shots;
  if (!script || !shots) throw new UserFacingError("The job needs a saved script and shot list before assembly.");
  const missing = missingShots(job);
  if (missing.length && !opts.placeholders) {
    throw new UserFacingError(
      `Missing visuals for shots: ${missing.join(", ")}. Add them with add_asset, or assemble with placeholders: true for a timing preview.`,
    );
  }

  const dir = store.jobDir(job.id);
  const work = path.join(dir, "work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await mkdir(path.join(dir, "final"), { recursive: true });

  const master = CANVAS[job.aspect_ratio];
  const masterStyle = await brandStyle(job.aspect_ratio);
  const mainDuration = shots.reduce((t, s) => t + s.duration_s, 0);
  const endDuration = opts.end_card ? masterStyle.end_card_duration_s : 0;
  const total = mainDuration + endDuration;

  // 1. Placeholder frames for shots without visuals (timing preview only).
  const placeholders: TextItem[] = missing.map((id) => {
    const shot = shots.find((s) => s.id === id)!;
    return { kind: "placeholder", text: `[${shot.id} · ${shot.duration_s}s] ${shot.description}`, out: path.join(work, `ph_${id}.png`) };
  });
  await renderText(master, masterStyle, placeholders);

  // 2. One clean (text-free) segment per shot at the master aspect ratio, then concatenate.
  const segments: string[] = [];
  for (const [i, shot] of shots.entries()) {
    const out = path.join(work, `seg_${String(i).padStart(3, "0")}.mp4`);
    const asset = job.assets[shot.id];
    const src = asset ? store.resolve(job.id, asset.file) : path.join(work, `ph_${shot.id}.png`);
    if (asset?.kind === "video") {
      // Too-short clips hold their last frame; long ones are trimmed.
      const vf = `${coverFilter(master)},fps=${FPS},tpad=stop_mode=clone:stop_duration=${sec(shot.duration_s)},${NORMALIZE}`;
      await ffmpeg(["-i", src, "-an", "-vf", vf, "-t", sec(shot.duration_s), ...WORK_ENCODE, out]);
    } else {
      const frames = String(Math.round(shot.duration_s * FPS));
      const vf = `${kenBurnsFilter(master, shot.duration_s)},${NORMALIZE}`;
      await ffmpeg(["-i", src, "-vf", vf, "-frames:v", frames, ...WORK_ENCODE, out]);
    }
    segments.push(out);
  }
  const list = path.join(work, "segments.txt");
  await writeFile(list, segments.map((s) => `file '${s}'`).join("\n"));
  const visual = path.join(work, "visual.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", visual]);

  // 3. Audio: voiceover clips at their scene starts, music looped underneath and ducked under the voice.
  const audio = path.join(work, "audio.wav");
  await mixAudio(store, job, total, opts.music_volume, audio);

  // 4. Per aspect ratio: reframe, overlay titles + captions, append end card, mux audio.
  const spoken = Object.fromEntries((job.voiceover?.clips ?? []).map((c) => [c.scene_id, c.duration_s]));
  const results: Rendered[] = [];
  for (const ar of opts.aspect_ratios) {
    const canvas = CANVAS[ar];
    const style = ar === job.aspect_ratio ? masterStyle : await brandStyle(ar);
    const cues: (TextItem & { cue: Cue })[] = [
      ...titleCues(script).map((cue, i) => ({ kind: "title" as const, text: cue.text, cue, out: path.join(work, `${tag(ar)}_title_${i}.png`) })),
      ...(opts.captions ? captionCues(script, spoken) : []).map((cue, i) => ({
        kind: "caption" as const, text: cue.text, cue, out: path.join(work, `${tag(ar)}_cap_${i}.png`),
      })),
    ];
    await renderText(canvas, style, cues);
    const endCard = opts.end_card ? await renderEndCard(canvas, style, script.cta, work, tag(ar)) : undefined;

    const file = path.join(dir, "final", `${job.id}_${tag(ar)}.mp4`);
    await compose({ visual, audio, cues, endCard, canvas, reframe: ar !== job.aspect_ratio, total, file });
    results.push({ aspect_ratio: ar, file, duration_s: (await probe(file)).duration_s ?? total });
  }
  return results;
}

async function mixAudio(store: JobStore, job: Job, total: number, musicVolume: number, out: string): Promise<void> {
  const script = job.script!;
  const starts = sceneStarts(script);
  const inputs: string[] = [];
  const filters: string[] = [];
  const voice: string[] = [];
  const norm = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

  for (const clip of job.voiceover?.clips ?? []) {
    const i = script.scenes.findIndex((s) => s.id === clip.scene_id);
    if (i < 0) continue; // clip from an older script
    const n = inputs.length / 2;
    inputs.push("-i", store.resolve(job.id, clip.file));
    const delay = Math.round(starts[i] * 1000);
    // Trim to the scene so an over-long line never talks over the next scene.
    filters.push(`[${n}:a]${norm},atrim=0:${sec(script.scenes[i].duration_s)},adelay=${delay}:all=1[vo${n}]`);
    voice.push(`[vo${n}]`);
  }
  if (voice.length) {
    filters.push(`${voice.join("")}amix=inputs=${voice.length}:normalize=0:duration=longest,apad=whole_dur=${sec(total)}[vo]`);
  }

  if (job.music) {
    const n = inputs.length / 2;
    inputs.push("-stream_loop", "-1", "-i", store.resolve(job.id, job.music.file));
    const fadeOut = Math.max(0, total - 1.5);
    filters.push(
      `[${n}:a]${norm},atrim=0:${sec(total)},volume=${musicVolume},afade=t=in:d=0.5,afade=t=out:st=${sec(fadeOut)}:d=1.5[mus]`,
    );
    if (voice.length) {
      filters.push("[vo]asplit=2[vokey][vomix]");
      filters.push("[mus][vokey]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]");
      filters.push("[duck][vomix]amix=inputs=2:normalize=0:duration=first[out]");
    } else {
      filters.push("[mus]anull[out]");
    }
  } else if (voice.length) {
    filters.push("[vo]anull[out]");
  } else {
    inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    filters.push("[0:a]anull[out]");
  }
  if (voice.length || job.music) {
    // Social platforms play at about -14 LUFS; normalise so the voice isn't quieter than other posts.
    filters.push("[out]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[final]");
  } else {
    filters.push("[out]anull[final]");
  }

  await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[final]", "-t", sec(total), "-c:a", "pcm_s16le", out]);
}

async function renderEndCard(canvas: Canvas, style: TextStyle, cta: string, work: string, name: string): Promise<string> {
  let png = style.end_card_file;
  if (!png) {
    png = path.join(work, `${name}_endcard.png`);
    await renderText(canvas, style, [{ kind: "endcard", text: cta, out: png }]);
  }
  const out = path.join(work, `${name}_endcard.mp4`);
  const vf = `${coverFilter(canvas)},fps=${FPS},${NORMALIZE}`;
  await ffmpeg(["-loop", "1", "-i", png, "-vf", vf, "-t", sec(style.end_card_duration_s), ...WORK_ENCODE, out]);
  return out;
}

interface ComposeArgs {
  visual: string;
  audio: string;
  cues: (TextItem & { cue: Cue })[];
  endCard?: string;
  canvas: Canvas;
  reframe: boolean;
  total: number;
  file: string;
}

async function compose({ visual, audio, cues, endCard, canvas, reframe, total, file }: ComposeArgs): Promise<void> {
  // Belt and braces: never rebuild the graph mid-stream (overlay PNGs are single frames and can't be re-read).
  const inputs = ["-reinit_filter", "0", "-i", visual];
  const graph: string[] = [reframe ? reframeFilter(canvas, "0:v", "base") : "[0:v]null[base]"];

  let last = "base";
  cues.forEach((item, k) => {
    inputs.push("-i", item.out);
    graph.push(`[${last}][${k + 1}:v]overlay=0:0:enable='between(t,${sec(item.cue.start)},${sec(item.cue.end)})'[o${k}]`);
    last = `o${k}`;
  });

  if (endCard) {
    const idx = cues.length + 1;
    inputs.push("-i", endCard);
    graph.push(`[${last}]format=yuv420p,setsar=1[main]`, `[main][${idx}:v]concat=n=2:v=1:a=0[v]`);
  } else {
    graph.push(`[${last}]format=yuv420p[v]`);
  }
  const audioIdx = cues.length + 1 + (endCard ? 1 : 0);
  inputs.push("-i", audio);

  await ffmpeg([...inputs, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", `${audioIdx}:a`, "-t", sec(total), ...FINAL_ENCODE, file]);
}
