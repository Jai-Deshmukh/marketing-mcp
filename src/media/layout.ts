import type { AspectRatio } from "../schemas.js";

export const FPS = 30;

export interface Canvas {
  width: number;
  height: number;
}

export const CANVAS: Record<AspectRatio, Canvas> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

// Every segment must share one pixel format and colour range: a mid-stream change (e.g. a JPEG
// decoding as full-range yuvj420p) makes ffmpeg rebuild the filter graph, which drops overlays.
export const NORMALIZE = "scale=out_range=limited:out_color_matrix=bt709,format=yuv420p";
export const COLOR_TAGS = ["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];

// Scale to fill the canvas, then centre-crop the overflow.
export function coverFilter({ width, height }: Canvas): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
}

// Slow push-in on a still. Upscaling first keeps zoompan from jittering.
export function kenBurnsFilter(canvas: Canvas, durationS: number, zoomTo = 1.12): string {
  const frames = Math.max(1, Math.round(durationS * FPS));
  const big = { width: canvas.width * 3, height: canvas.height * 3 };
  return [
    coverFilter(big),
    `zoompan=z='1+${(zoomTo - 1).toFixed(3)}*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${canvas.width}x${canvas.height}:fps=${FPS}`,
    "setsar=1",
  ].join(",");
}

// Fit a finished video into another aspect ratio over a blurred, filled copy of itself.
export function reframeFilter(canvas: Canvas, input = "0:v", output = "v"): string {
  const { width, height } = canvas;
  return (
    `[${input}]split[bgsrc][fgsrc];` +
    `[bgsrc]${coverFilter(canvas)},gblur=sigma=40,eq=brightness=-0.08[bg];` +
    `[fgsrc]scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[${output}]`
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value : fallback;
}

// Pick black or white text for legibility on a background colour.
export function contrastText(bg: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#111111" : "#FFFFFF";
}
