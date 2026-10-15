#!/usr/bin/env node
// Entry point for the plugin's MCP server. Plugins are installed without their npm packages,
// so the first start installs them (a minute or so), then launches the server.
//
//   node bin/start.mjs                 start the MCP server (installing packages if needed)
//   node bin/start.mjs --install-only  just install the packages

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const needed = ["@modelcontextprotocol/sdk", "playwright-core", "officeparser", "zod"];
const missing = needed.filter((p) => !fs.existsSync(path.join(root, "node_modules", p, "package.json")));

if (missing.length) {
  console.error(`blackboard-mcp: installing packages (${missing.join(", ")})…`);
  const npmArgs = [fs.existsSync(path.join(root, "package-lock.json")) ? "ci" : "install", "--omit=dev", "--no-audit", "--no-fund"];
  // On Windows npm is a .cmd script, which has to go through cmd.exe.
  const [cmd, args] =
    process.platform === "win32" ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["npm", ...npmArgs].join(" ")]] : ["npm", npmArgs];
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: ["ignore", process.stderr, process.stderr], // stdout is reserved for the MCP protocol
  });
  if (r.status !== 0) {
    console.error(`blackboard-mcp: npm failed (exit ${r.status}). Run "npm ci" in ${root} and restart.`);
    process.exit(1);
  }
}

if (!process.argv.includes("--install-only")) {
  await import(pathToFileURL(path.join(root, "src", "server.mjs")).href);
}
