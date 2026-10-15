#!/usr/bin/env node
// Command-line wrapper around courseImages (the MCP server's extract_images tool does the same):
// pulls the pictures out of a module's PDF/PPTX/DOCX files so schedule tables that exist only as
// images can be looked at. Saves them to ~/.blackboard-mcp/data/images/<course>/<file>/.
//
//   node scripts/extract-images.mjs CSU33012 syllabus [min KB]

import { courseImages } from "../src/corpus.mjs";

const [course, needle, minKb = "40"] = process.argv.slice(2);
if (!course || !needle) {
  console.error("Usage: node scripts/extract-images.mjs <module code or folder> <file name part> [min KB]");
  process.exit(1);
}
const r = await courseImages(course, needle, { minKb: Number(minKb), max: 50 });
console.log(`${r.folder}: ${r.total} images ≥ ${minKb} KB, largest first`);
for (const i of [...r.images, ...r.more]) console.log(`  ${i.kb} KB  ${i.file}`);
