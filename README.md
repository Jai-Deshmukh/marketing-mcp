# Hyv Content Studio

Make on-brand Hyv reels, ads and explainers by chatting with Claude.

You describe the video in plain words. Claude writes the script, plans the shots, generates the
visuals in **OpenArt**, then this tool records the voiceover, adds music, captions and the Hyv end
card, and renders the final MP4 on your Mac.

**Cost:** nothing extra. Writing uses your Claude plan, images and video use your OpenArt Pro
credits, and voice, music and editing run free on your Mac. There are no API keys to buy or enter.

---

## What you need

- A Mac (Apple Silicon recommended) with about 3 GB of free disk space
- **Claude Desktop**, signed in to your Claude account: https://claude.ai/download
- An **OpenArt** account with credits (the team uses OpenArt Pro)
- **Homebrew**: https://brew.sh
- **Node.js 20 or newer**: `brew install node` (or https://nodejs.org)

## Setup (once, about 10 minutes)

1. **Get the project folder** (`content-mcp`) from the team and put it somewhere permanent,
   e.g. `~/Hyv/content-mcp`. If you move it later, run setup again.

2. **Run setup** in Terminal:
   ```bash
   cd ~/Hyv/content-mcp
   ./scripts/setup.sh
   ```
   This installs ffmpeg and the voice tools, downloads the voice model, builds the tool and adds
   it to Claude Desktop. It's safe to run again any time.

3. **Restart Claude Desktop** (quit it fully with ⌘Q, then reopen).

4. **Connect OpenArt** in Claude Desktop: **Settings → Connectors**, find **OpenArt**, click
   **Connect** and log in with your OpenArt account.
   - There is **no OpenArt API key**. Logging in is what links your credits.
   - If OpenArt isn't listed, choose **Add custom connector** and use `https://mcp.openart.ai`.

5. **Check it worked**: in a new chat, open the tools/connectors menu (under the message box).
   You should see **hyv-content-studio** and **OpenArt** switched on.

## Making a video

Start a new chat in Claude Desktop and describe what you want:

> Make a 30s Instagram reel about asking your circle for a plumber.

What happens:
1. **Script**: Claude writes it (checked for timing and brand rules) and shows you. Ask for changes freely.
2. **Shot list**: Claude plans each shot and **asks before spending OpenArt credits**.
3. **Visuals**: Claude generates each shot in OpenArt and pulls the results into the project.
4. **Voice and music**: recorded and mixed on your Mac.
5. **Render**: the finished MP4 is saved to `content-mcp/output/<video-name>/final/`.

Things you can say along the way:

| You say | What it does |
|---|---|
| "Preview the timing with placeholders" | Renders a rough cut before any visuals exist (free) |
| "Redo shot 3 as a close-up" | Regenerates just that shot |
| "Use a British male voice" / "slower voice" | Re-records the voiceover |
| "Upbeat music" / "calm music" / "no music" | Changes the background track |
| "Also export 16:9" | Makes a landscape version from the same footage (no extra credits) |
| "Make it in Hindi" / "Hinglish" | Hindi or Hinglish script and voice |
| "Make 3 ad variations with different hooks" | A/B test versions |
| "What's the status?" | Progress while voice or rendering is running |

**Saving OpenArt credits:** approve still images first and only animate the shots that need
motion. Still shots get a slow zoom in the edit and look fine for many beats.

## Brand assets and music

All brand files live in `src/brand/`. Edit them any time; no rebuild or restart is needed.

- `brand-kit.md`: tone, audience, do's and don'ts, taglines
- `brand-kit.json`: colours (hex codes like `#FF6B35`), fonts, logo and end-card file names
- `assets/`: put the logo PNGs (transparent background), font files (`.ttf`/`.otf`) and an
  optional ready-made `end-card.png` here, using the file names in `brand-kit.json`
- `assets/music/<mood>/`: background music, one folder per mood, e.g. `assets/music/upbeat/sunny.mp3`.
  Use royalty-free tracks cleared for commercial use (YouTube Audio Library, Pixabay Music).

Until real values are filled in, videos use neutral placeholder colours and a plain "Hyv" end card.

## Troubleshooting

- **hyv-content-studio doesn't appear in Claude:** run `./scripts/setup.sh` again, then fully
  quit and reopen Claude Desktop.
- **"…is not installed. Run scripts/setup.sh":** run setup again; it fixes missing pieces.
- **"Download failed… the link may have expired":** ask Claude to regenerate that shot in OpenArt.
- **Voiceover or render "still running":** ask "what's the status?" after a minute.
- **The music library is empty:** add tracks (see above) or say "no music".
- **Error logs:** `~/Library/Logs/Claude/mcp-server-hyv-content-studio.log`

## Current limitations

- Cuts between shots are hard cuts (planned transitions aren't rendered yet).
- Runs on macOS only.
- Each person runs it on their own Mac; videos are saved locally, so share the MP4s directly.

---

## For developers

```bash
npm test           # unit + integration tests (integration needs setup.sh)
npm run dev        # watch mode
npm run inspect    # MCP Inspector
npm run build      # after code changes, then restart Claude Desktop
```
Architecture, conventions and pipeline notes are in `CLAUDE.md`.
