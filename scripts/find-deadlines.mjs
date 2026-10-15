#!/usr/bin/env node
// Command-line wrapper around findDeadlineText (the MCP server's find_deadline_text tool does the same).
//
//   node scripts/find-deadlines.mjs CSU33012

import { findDeadlineText } from "../src/corpus.mjs";

if (!process.argv[2]) {
  console.error("Usage: node scripts/find-deadlines.mjs <module code or scanned folder>");
  process.exit(1);
}
console.log(findDeadlineText(process.argv[2], { maxChars: Infinity }));
