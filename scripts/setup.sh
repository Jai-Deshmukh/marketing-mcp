#!/usr/bin/env bash
# One-command local setup (macOS). Safe to re-run.
# Installs ffmpeg, espeak-ng (Kokoro phonemizer) and fribidi (Hindi text shaping in Pillow);
# creates a Python venv with Kokoro TTS + Pillow; builds the server; registers it in Claude Desktop.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname)" = "Darwin" ] || { echo "This setup is for macOS."; exit 1; }
command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
command -v node >/dev/null || { echo "Install Node.js 20 or newer first: https://nodejs.org (or: brew install node)"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || {
  echo "Node.js 20 or newer is required (found $(node -v))."; exit 1; }

echo "1/5 Installing ffmpeg, Python and voice tools (Homebrew)…"
for pkg in ffmpeg python@3.12 espeak-ng fribidi; do
  brew list --formula "$pkg" >/dev/null 2>&1 || HOMEBREW_NO_AUTO_UPDATE=1 brew install "$pkg"
done

echo "2/5 Creating the Python environment (Kokoro voice + caption renderer, ~1 GB)…"
PY="$(brew --prefix python@3.12)/bin/python3.12"
[ -x .venv/bin/python ] || "$PY" -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r scripts/requirements.txt

echo "3/5 Downloading the voice model…"
.venv/bin/python -W ignore -c "from kokoro import KPipeline; KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')" >/dev/null 2>&1

echo "4/5 Building the server…"
npm install --silent
npm run build --silent

echo "5/5 Adding it to Claude Desktop…"
node scripts/register-claude-desktop.mjs

echo
echo "Setup complete. Quit and reopen Claude Desktop, then connect OpenArt (see README)."
