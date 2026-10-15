#!/usr/bin/env node
// Command-line wrapper around src/scan.mjs (the MCP server's scan_blackboard tool does the same).
//
//   node scripts/scan.mjs            # this semester's modules
//   node scripts/scan.mjs --all      # every module
//
// Prints the JSON summary (what's new or changed since the last scan) to stdout, progress to stderr.

import { runScan } from "../src/scan.mjs";

try {
  const result = await runScan({
    all: process.argv.includes("--all"),
    onProgress: ({ course, courseIndex, courseCount, files }) => process.stderr.write(`\r[${courseIndex}/${courseCount}] ${course} · ${files} files read   `),
  });
  process.stderr.write("\n");
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(2);
}
