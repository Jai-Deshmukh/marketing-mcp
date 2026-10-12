import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export type CrewRole = "writer" | "director" | "cinematographer";

export async function loadBrandKit(): Promise<{ markdown: string; json: string }> {
  const [markdown, json] = await Promise.all([
    readFile(path.join(config.brandDir, "brand-kit.md"), "utf8"),
    readFile(path.join(config.brandDir, "brand-kit.json"), "utf8"),
  ]);
  return { markdown, json };
}

// Crew prompts use {{name}} placeholders; unknown placeholders are left as-is.
export async function loadCrewPrompt(role: CrewRole, vars: Record<string, string | number>): Promise<string> {
  const template = await readFile(path.join(config.crewDir, `${role}.md`), "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export async function brandKitBlock(): Promise<string> {
  const { markdown, json } = await loadBrandKit();
  return `${markdown}\n\n## brand-kit.json\n\`\`\`json\n${json}\n\`\`\``;
}
