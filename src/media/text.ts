import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { contrastText, hexOr, type Canvas } from "./layout.js";
import { python } from "./proc.js";

export interface TextStyle {
  colors: { primary: string; accent: string; on_primary: string; on_accent: string };
  font_heading: string | null;
  font_body: string | null;
  logo: string | null;
  end_card_file: string | null;
  end_card_duration_s: number;
  caption: { color: string; outline: string; max_chars_per_line: number };
  safe_zone: { top_pct: number; bottom_pct: number; side_pct: number };
}

export interface TextItem {
  kind: "caption" | "title" | "endcard" | "placeholder";
  text: string;
  out: string;
}

// Neutral fallbacks used until the real brand values replace the TODOs in brand-kit.json.
const FALLBACK = { primary: "#2B2D42", accent: "#FFB703" };

async function existing(rel: unknown): Promise<string | null> {
  if (typeof rel !== "string" || rel.includes("TODO")) return null;
  const file = path.resolve(config.brandDir, rel);
  try {
    await access(file);
    return file;
  } catch {
    return null;
  }
}

export async function brandStyle(aspect: string): Promise<TextStyle> {
  const kit: any = JSON.parse(await readFile(path.join(config.brandDir, "brand-kit.json"), "utf8"));
  const primary = hexOr(kit.colors?.primary, FALLBACK.primary);
  const accent = hexOr(kit.colors?.accent, FALLBACK.accent);
  const zone = kit.safe_zones?.[aspect] ?? kit.safe_zones?.["16:9"] ?? { top_pct: 8, bottom_pct: 12, side_pct: 6 };
  const onPrimary = contrastText(primary);
  return {
    colors: { primary, accent, on_primary: onPrimary, on_accent: contrastText(accent) },
    font_heading: await existing(kit.fonts?.heading?.file),
    font_body: await existing(kit.fonts?.body?.file),
    // A light logo reads on a dark end card and vice versa.
    logo: await existing(onPrimary === "#FFFFFF" ? kit.logo?.on_dark : kit.logo?.on_light),
    end_card_file: await existing(kit.end_card?.file),
    end_card_duration_s: Number(kit.end_card?.duration_s) || 2,
    caption: {
      color: hexOr(kit.captions?.color, "#FFFFFF"),
      outline: hexOr(kit.captions?.outline, "#000000"),
      max_chars_per_line: Number(kit.captions?.max_chars_per_line) || 32,
    },
    safe_zone: zone,
  };
}

export async function renderText(canvas: Canvas, style: TextStyle, items: TextItem[]): Promise<void> {
  if (!items.length) return;
  const script = path.join(config.projectRoot, "src", "py", "render_text.py");
  await python(script, { ...canvas, style, items });
}
