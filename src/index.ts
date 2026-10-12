#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";
import { loadBrandKit } from "./crew.js";
import { JobStore } from "./jobs/store.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerAudioTools } from "./tools/audio.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerRenderTools } from "./tools/render.js";
import { registerScriptTools } from "./tools/scriptAndShots.js";

const server = new McpServer(
  { name: "hyv-content-studio", version: "0.1.0" },
  {
    instructions:
      "Hyv Content Studio: a small AI film crew for Hyv marketing videos. You (the assistant) do the creative " +
      "work as writer, director and cinematographer; this server supplies the brand kit and crew instructions, " +
      "checks and saves each step, and renders the final video locally for free. Flow: start_video → save_script → " +
      "save_shot_list → generate each shot with the OpenArt tools → add_asset → generate_voiceover → pick_music → " +
      "assemble_video. Get the user's approval before spending OpenArt credits. Always follow the Hyv brand kit.",
  },
);

const store = new JobStore(config.outputDir);
registerJobTools(server, store);
registerScriptTools(server, store);
registerAssetTools(server, store);
registerAudioTools(server, store);
registerRenderTools(server, store);

server.registerResource(
  "brand-kit",
  "hyv://brand-kit",
  { title: "Hyv brand kit", description: "Tone, audience, do/don't, colours, fonts, safe zones", mimeType: "text/markdown" },
  async (uri) => {
    const { markdown, json } = await loadBrandKit();
    return {
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: markdown },
        { uri: `${uri.href}.json`, mimeType: "application/json", text: json },
      ],
    };
  },
);

server.registerResource(
  "job",
  new ResourceTemplate("hyv://jobs/{job_id}", {
    list: async () => ({
      resources: (await store.list()).map((j) => ({ uri: `hyv://jobs/${j.id}`, name: `${j.id} (${j.stage})` })),
    }),
  }),
  { title: "Hyv job manifest", description: "Full manifest for one video job", mimeType: "application/json" },
  async (uri, { job_id }) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await store.get(String(job_id)), null, 2) }],
  }),
);

const promptText = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

server.registerPrompt(
  "reel_from_feature",
  { title: "Reel from a feature", description: "30s Instagram reel about one Hyv feature", argsSchema: { feature: z.string() } },
  ({ feature }) =>
    promptText(`Make a 30s Instagram reel about this Hyv feature: ${feature}. Start with start_video (format "reel"), then write the script.`),
);

server.registerPrompt(
  "ad_variations",
  { title: "Ad variations", description: "3 hook variations of a 15s ad for A/B testing", argsSchema: { message: z.string() } },
  ({ message }) =>
    promptText(
      `Make 3 variations of a 15s Hyv ad for A/B testing. Core message: ${message}. Each variation gets its own ` +
        `start_video job (format "ad", duration_s 15) and a different hook; keep the rest of the script similar.`,
    ),
);

server.registerPrompt(
  "explainer_60s",
  { title: "60s explainer", description: "60s explainer video (16:9) on one topic", argsSchema: { topic: z.string() } },
  ({ topic }) =>
    promptText(`Make a 60s YouTube explainer about: ${topic}. Start with start_video (format "explainer", duration_s 60, platform "youtube").`),
);

await server.connect(new StdioServerTransport());
console.error(`hyv-content-studio running (output: ${config.outputDir})`);
