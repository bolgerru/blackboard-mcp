#!/usr/bin/env node
// Pulls the images out of a Blackboard file (PDF, PPTX, DOCX) so schedule/assessment
// tables that exist only as pictures can be looked at.
//
//   node scripts/extract-images.mjs <course corpus folder name> <file name substring> [min KB]
//   e.g. node scripts/extract-images.mjs CSU33012-202627 syllabus 60
//
// Downloads the original file again (only text is kept in ~/.blackboard-mcp/data/corpus), writes images to
// ~/.blackboard-mcp/data/images/<course>/<file>/ and prints their paths, largest first.

import fs from "node:fs";
import path from "node:path";
import { OfficeParser } from "officeparser";
import { bbDownload, WORK_DIR } from "../src/blackboard.mjs";

const [courseFolder, needle, minKb = "40"] = process.argv.slice(2);
if (!courseFolder || !needle) {
  console.error("Usage: node scripts/extract-images.mjs <course folder> <file name substring> [min KB]");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(WORK_DIR, "manifest.json"), "utf8"));
const content = JSON.parse(fs.readFileSync(path.join(WORK_DIR, "corpus", courseFolder, "content.json"), "utf8"));
const courseId = Object.keys(manifest).find((k) => content.some((i) => k.includes(`|item|${i.id}`)))?.split("|")[0];

const seen = new Set();
for (const [key, v] of Object.entries(manifest)) {
  if (!key.startsWith(`${courseId}|att|`) || !v.fileName?.toLowerCase().includes(needle.toLowerCase())) continue;
  if (seen.has(v.fileName)) continue;
  seen.add(v.fileName);
  const [, , contentId, attId] = key.split("|");
  const dl = await bbDownload(`/learn/api/public/v1/courses/${courseId}/contents/${contentId}/attachments/${attId}/download`);
  if (!dl) continue;
  const ext = v.fileName.split(".").pop().toLowerCase();
  const ast = await OfficeParser.parseOffice(dl.body, { fileType: ext, extractAttachments: true });
  const outDir = path.join(WORK_DIR, "images", courseFolder, v.fileName.replace(/[^\w.-]+/g, "_"));
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const hashes = new Set();
  for (const a of ast.attachments || []) {
    if (!a.mimeType?.startsWith("image/")) continue;
    const buf = Buffer.from(a.data, typeof a.data === "string" ? "base64" : undefined);
    if (buf.length < Number(minKb) * 1024) continue;
    const sig = `${buf.length}:${buf.subarray(0, 64).toString("hex")}`;
    if (hashes.has(sig)) continue; // same picture repeated on several slides
    hashes.add(sig);
    const file = path.join(outDir, a.name || `image-${written.length}.${a.mimeType.split("/")[1]}`);
    fs.writeFileSync(file, buf);
    written.push({ file, kb: Math.round(buf.length / 1024) });
  }
  written.sort((a, b) => b.kb - a.kb);
  console.log(`\n${v.fileName}: ${written.length} images ≥ ${minKb} KB`);
  for (const w of written) console.log(`  ${w.kb} KB  ${w.file}`);
}
if (!seen.size) console.log(`No files matching "${needle}" in ${courseFolder}.`);
