import { z } from "zod";

export const Format = z.enum(["reel", "ad", "explainer"]);
export const Platform = z.enum(["instagram", "youtube_shorts", "youtube", "linkedin", "x", "other"]);
export const Language = z.enum(["en", "hi", "hinglish"]);
export const AspectRatio = z.enum(["9:16", "16:9", "1:1"]);

// Ids become file names (assets/<shot_id>.png, audio/vo_<scene_id>.wav), so keep them path-safe.
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Use 1-40 letters, numbers, - or _");

export const Scene = z.object({
  id: Id.describe('Short id, e.g. "s1"'),
  duration_s: z.number().positive(),
  vo: z.string().describe("Voiceover line for this scene; empty string if none"),
  on_screen_text: z.string().optional().describe("Short text overlay, a few words"),
  visual_idea: z.string().min(1).describe("What the viewer sees, in plain language"),
});

export const Script = z.object({
  title: z.string().min(1),
  hook: z.string().min(1).describe("What grabs attention in the first 2 seconds"),
  scenes: z.array(Scene).min(1),
  cta: z.string().min(1).describe("Call to action shown/spoken at the end"),
});

export const Camera = z.object({
  angle: z.string().describe("e.g. eye level, low angle, top-down"),
  move: z.string().describe("e.g. static, slow push-in, handheld pan"),
  lens: z.string().describe("e.g. 35mm, 85mm, wide"),
});

export const Shot = z.object({
  id: Id.describe('Short id, e.g. "sh1"'),
  scene_id: Id.describe("Scene this shot belongs to"),
  description: z.string().min(1),
  camera: Camera,
  duration_s: z.number().positive(),
  kind: z.enum(["video", "image"]).describe("image = still with pan/zoom, cheaper than video"),
  visual_prompt: z.string().min(1).describe("Model-ready prompt for image/video generation"),
  negative_prompt: z.string().default(""),
  transition: z.string().optional().describe("Transition into the next shot, e.g. cut, match cut, dissolve"),
});

export const Consistency = z.object({
  characters: z.string().describe("Who appears, described identically for every shot"),
  wardrobe: z.string(),
  palette: z.string(),
  lighting: z.string(),
});

export const ShotList = z.object({
  style: z.string().optional(),
  consistency: Consistency,
  shots: z.array(Shot).min(1),
});

export const Stage = z.enum(["script", "shot_list", "visuals", "audio", "assembly", "done"]);

// Paths in the manifest are relative to the job folder unless absolute (e.g. library music).
export const Asset = z.object({
  shot_id: z.string(),
  file: z.string(),
  kind: z.enum(["image", "video"]),
  source: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration_s: z.number().optional(),
  added_at: z.string(),
});

export const VoiceClip = z.object({ scene_id: z.string(), file: z.string(), duration_s: z.number() });

export const Voiceover = z.object({
  engine: z.enum(["kokoro", "say"]),
  voice: z.string(),
  clips: z.array(VoiceClip),
  created_at: z.string(),
});

export const Music = z.object({ file: z.string(), title: z.string(), mood: z.string() });

export const Output = z.object({ aspect_ratio: AspectRatio, file: z.string(), duration_s: z.number() });

export const Task = z.object({
  status: z.enum(["running", "done", "failed"]),
  started_at: z.string(),
  finished_at: z.string().optional(),
  message: z.string().optional(),
});

export const Job = z.object({
  id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  brief: z.string(),
  format: Format,
  duration_s: z.number(),
  platform: Platform,
  tone: z.string().optional(),
  language: Language.default("en"),
  aspect_ratio: AspectRatio,
  stage: Stage,
  script: Script.optional(),
  shot_list: ShotList.optional(),
  assets: z.record(z.string(), Asset).default({}),
  voiceover: Voiceover.optional(),
  music: Music.nullable().optional().describe("null = deliberately no music"),
  outputs: z.array(Output).default([]),
  tasks: z.record(z.string(), Task).default({}),
  errors: z.array(z.string()).default([]),
});

export type Script = z.infer<typeof Script>;
export type ShotList = z.infer<typeof ShotList>;
export type Job = z.infer<typeof Job>;
export type Stage = z.infer<typeof Stage>;
export type Asset = z.infer<typeof Asset>;
export type Voiceover = z.infer<typeof Voiceover>;
export type Music = z.infer<typeof Music>;
export type AspectRatio = z.infer<typeof AspectRatio>;
