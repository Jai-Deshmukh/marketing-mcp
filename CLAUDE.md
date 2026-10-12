# CLAUDE.md — Hyv Content Studio MCP

## What this is
A local MCP server that lets the Hyv marketing team produce short-form video and image
content from a plain-language brief ("make a 30s reel about circles"). It acts as a
small AI film crew: writer → director → cinematographer → voice/music → editor.

It runs **locally only** (stdio, no hosting) inside Claude Desktop or Claude Code.

## Cost model (hard constraint: no extra spend)
- **Creative work (script, shot list, visual prompts) is done by Claude in the chat**, on the
  team's existing Claude plan. The server never calls the Anthropic API and needs no API key.
- **Images and video come from OpenArt** (team has OpenArt Pro, 24k credits/month) via the
  OpenArt connector in Claude. OpenArt has no REST API, so the server cannot call it:
  Claude generates through the connector, then hands result URLs to this server.
- **Voice, music and assembly run locally for free**: Kokoro TTS (fallback: macOS `say`),
  royalty-free tracks in `brand/assets/music/`, `ffmpeg`.
- Never add a paid API dependency without the user explicitly asking for it.

## How a video gets made
```
Claude Desktop (Claude plan: writer / director / cinematographer)
  ├── OpenArt connector ─ images + video clips (OpenArt Pro credits)
  └── this server (local)
        start_video → brand kit + writer instructions, creates job folder
        save_script → validates (durations, VO length, hype words), returns director + DP instructions
        save_shot_list → validates (scene coverage, total duration)
        add_asset → downloads OpenArt results (URL or local path) into the job folder
        generate_voiceover → Kokoro (or macOS say) per scene
        pick_music → mood folder in the local library
        assemble_video → ffmpeg render, one MP4 per aspect ratio
```
Server tools return instructions for the next step, so Claude knows what to do without
the user attaching resources. Keep flow guidance in tool results and `src/crew/*.md`.

## Stack
- TypeScript (TS 7: `"types": ["node"]` must stay in tsconfig), Node 20+, `@modelcontextprotocol/sdk` 1.x, `zod` 4
- Transport: stdio only
- Tests: vitest
- Storage: `./output/<job_id>/` = `manifest.json`, `assets/`, `audio/`, `work/` (intermediates, wiped per render), `final/` (`OUTPUT_DIR` is resolved against the project root, because Claude Desktop starts servers with cwd `/`)
- Local tools (installed by `scripts/setup.sh`): Homebrew ffmpeg, espeak-ng, fribidi, and `.venv` (Python 3.12) with Kokoro + Pillow. Python helpers live in `src/py/` and take a JSON spec on stdin.
- Homebrew's ffmpeg has **no text filters** (no libass/drawtext). All text (captions, titles, end card, placeholders) is rendered to full-canvas PNGs by `src/py/render_text.py` and composited with `overlay`. Don't switch to `subtitles`/`drawtext`.
- Claude Desktop gives servers a minimal PATH; `media/proc.ts` prepends `/opt/homebrew/bin` and runs everything without a shell.

## Project layout
```
src/
  index.ts              # server entry: tools, resources, prompts
  config.ts             # env (all optional) + paths
  schemas.ts            # zod: Script, ShotList, Job
  checks.ts             # script / shot-list validation (pure functions)
  crew.ts               # loads brand kit + crew prompts ({{var}} templating)
  crew/                 # writer.md, director.md, cinematographer.md
  brand/                # brand-kit.md, brand-kit.json, assets/ (logo, fonts, end card, music)
  jobs/store.ts         # JobStore: one folder per job, atomic manifest writes
  jobs/tasks.ts         # runTask: background work with status in the manifest; waits up to 45s
  media/                # proc (spawn/ffprobe/python), layout (canvas, filters), captions (cue timing),
                        # text (brand style → render_text.py), download, assemble (the render pipeline)
  voice/tts.ts          # voice choice per language + Kokoro / say synthesis
  music.ts              # mood-folder music library
  py/                   # kokoro_tts.py, render_text.py
  tools/                # jobs, scriptAndShots, assets, audio, render, result
tests/                  # unit tests + assemble.integration.test.ts (skips without ffmpeg/.venv)
scripts/setup.sh        # one-command setup: brew packages, venv + Kokoro model, npm build, Claude Desktop registration
scripts/register-claude-desktop.mjs  # adds the server to claude_desktop_config.json (keeps other entries, writes .bak)
```
Brand kit, crew prompts and music are read from `src/` at runtime (no rebuild needed to edit them).

## Tools
| Tool | Status | Notes |
|---|---|---|
| `start_video` | done | brief, format, duration_s, platform, tone?, language (en/hi/hinglish), aspect_ratio? |
| `save_script` | done | rejects hype words, wrong total duration, VO > 125% of duration × 2.5 wps |
| `save_shot_list` | done | every scene covered, total matches script; shots are `video` or `image` (still + pan/zoom) |
| `job_status`, `list_jobs` | done | |
| `add_asset` | done | batch of {shot_id, source}; each item fails independently; warns on short clips / kind mismatch |
| `generate_voiceover` | done | background task; en → Kokoro af_heart, hi → Kokoro hf_alpha, hinglish → say "Aman"; warns if a line overruns its scene |
| `pick_music` | done | no mood = list moods; `none: true` = no music; `variation` rotates tracks |
| `assemble_video` | done | background task; `placeholders: true` for timing previews; captions, titles, end card, ducked music, loudnorm to ~-14 LUFS |

Resources: `hyv://brand-kit`, `hyv://jobs/{job_id}`. Prompts: `reel_from_feature`, `ad_variations`, `explainer_60s`.

Rules:
- Every tool returns a short human-readable summary plus paths; errors are actionable, never stack traces.
- Keep tool descriptions precise; they are what the chat model reads to choose tools.
- To save OpenArt credits: generate image keyframes first, video only for approved shots;
  prefer `kind: "image"` shots where motion isn't needed; generate once at the job's aspect ratio
  and derive other ratios in ffmpeg (blurred-background pad), never generate twice.

## Brand rules (always apply)
- Hyv helps people get things done through the people they trust (circles).
- Tone: warm, practical, direct. No hype words, no fake claims or stats.
- Never depict real people's likeness or use real logos other than Hyv's.
- Colours and fonts come from `brand-kit.json`; add the end card unless told not to.
- Captions are on by default (most social video is watched muted).
- `brand-kit.md` / `brand-kit.json` still contain TODO placeholders until marketing fills them in.

## Commands
```
npm install
npm run build      # required after changes; Claude Desktop runs dist/index.js
npm test
npm run dev        # tsx watch, for quick iteration
npm run inspect    # MCP Inspector against dist/
```
Claude Desktop config entry: `hyv-content-studio` in
`~/Library/Application Support/Claude/claude_desktop_config.json` (restart Desktop after rebuilding).

## Engineering conventions
- Validate all tool input with zod; validation logic lives in `checks.ts` as pure, tested functions.
- Write every intermediate asset and `manifest.json` per job so any step can be rerun.
- Small, testable functions; tests use temp dirs, never `./output`.
- stdout is the MCP channel: log with `console.error` only.

## Render pipeline gotchas (learned the hard way)
- Every intermediate segment must have the same pixel format and colour range (`NORMALIZE` + `COLOR_TAGS` in
  `media/layout.ts`). A JPEG decodes as full-range `yuvj420p`; mixing it in made ffmpeg rebuild the filter graph
  mid-stream and silently drop all later overlays. `assemble.integration.test.ts` guards this.
- Overlay PNGs are single-frame inputs; never loop them (that would decode every 1080p PNG on every frame).
- Video clips shorter than their shot hold the last frame (`tpad`); longer ones are trimmed.
- VO clips are trimmed to their scene so a long line never talks over the next scene.

## Next steps
- Fill in the real brand kit (colours, fonts, logo, taglines) and add royalty-free music.
- Transitions are hard cuts; `shot.transition` is recorded but not rendered yet (xfade).
