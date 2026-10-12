// Adds (or updates) the hyv-content-studio entry in Claude Desktop's config, keeping every
// other setting and server. Uses absolute paths because Claude Desktop starts servers with
// a minimal PATH (nvm/Homebrew node is not on it).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(homedir(), "Library", "Application Support", "Claude");
const file = path.join(dir, "claude_desktop_config.json");
const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

let config = {};
if (existsSync(file)) {
  config = JSON.parse(readFileSync(file, "utf8"));
  copyFileSync(file, `${file}.bak`);
} else {
  mkdirSync(dir, { recursive: true });
}
config.mcpServers = { ...config.mcpServers, "hyv-content-studio": { command: process.execPath, args: [server] } };
writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
console.log(`Registered hyv-content-studio in ${file}`);
