// Reading the scanned course files: deadline search and image extraction.

import fs from "node:fs";
import path from "node:path";
import { bbDownload, WORK_DIR } from "./blackboard.mjs";
import { extractImages } from "./extract.mjs";

const CORPUS_DIR = path.join(WORK_DIR, "corpus");

const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};

/** Scanned course folders, e.g. ["CSU33012-202627", …]. */
export function courseFolders() {
  return fs.existsSync(CORPUS_DIR) ? fs.readdirSync(CORPUS_DIR).filter((d) => fs.statSync(path.join(CORPUS_DIR, d)).isDirectory()) : [];
}

/** Resolves a module code, folder name or part of one ("CSU33012", "csu33012-202627") to a scanned folder. */
export function resolveFolder(course) {
  const q = String(course).toUpperCase();
  const folders = courseFolders();
  const hit = folders.find((f) => f.toUpperCase() === q) || folders.find((f) => f.toUpperCase().startsWith(q)) || folders.find((f) => f.toUpperCase().includes(q));
  if (!hit) throw new Error(`No scanned module matches "${course}". Scanned: ${folders.join(", ") || "none yet (run scan_blackboard first)"}`);
  return hit;
}

const DEADLINE_PATTERN =
  /\bdue\b|deadline|submi(t|ssion)|\bexam(s|ination)?\b|quiz|mid-?term|in-class|class test|\btest (on|in|will)|assessment|assignment|presentation|essay|% of (the )?(final|module|overall|grade|mark)|marks? (for|of|available)|late (submission|penalt)|extension|hand(ed)? ?in\b|turnitin|\bmcq|problem set|lab report|coursework|continuous assessment|reading week|study week/i;

/**
 * Everything deadline-related in one module: matching lines (plus the line after) from every
 * extracted file, then all page text and assignment instructions, announcements and the gradebook.
 */
export function findDeadlineText(course, { maxChars = 60000 } = {}) {
  const folder = resolveFolder(course);
  const dir = path.join(CORPUS_DIR, folder);
  const parts = [`# ${folder}`];

  const filesDir = path.join(dir, "files");
  for (const f of fs.existsSync(filesDir) ? fs.readdirSync(filesDir).filter((f) => f.endsWith(".txt")).sort() : []) {
    const lines = fs.readFileSync(path.join(filesDir, f), "utf8").split(/\r?\n/);
    const title = lines[0].replace(/^# /, "");
    const hits = [];
    let last = -2;
    lines.forEach((line, i) => {
      if (i === 0 || !DEADLINE_PATTERN.test(line)) return;
      for (const j of [i, i + 1]) {
        if (j <= last || j >= lines.length) continue;
        hits.push(`${j + 1}: ${lines[j].slice(0, 240)}`);
        last = j;
      }
    });
    if (hits.length) parts.push(`\n### ${title}\n${hits.join("\n")}`);
  }

  for (const [file, label] of [["content.json", "page"], ["announcements.json", "announcement"]]) {
    for (const i of readJson(path.join(dir, file), [])) {
      const t = [i.text, i.instructions && `INSTRUCTIONS: ${i.instructions}`].filter(Boolean).join("\n");
      if (t) parts.push(`\n[${label}] ${i.location || i.title}${i.posted ? ` (${i.posted.slice(0, 10)})` : ""}\n${t.slice(0, 1800)}`);
    }
  }

  const gb = readJson(path.join(dir, "gradebook.json"), []);
  if (gb.length)
    parts.push(
      `\n[gradebook]\n${gb.map((c) => `- ${c.name} | due ${c.due || "-"} | ${c.points ?? ""}pts | submission: ${c.submission ?? "?"}${c.submittedAt ? ` (${c.submittedAt})` : ""} | column ${c.id}`).join("\n")}`
    );

  let out = parts.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n\n[… cut at ${maxChars} characters; ask for a specific file with get_content_item or narrow the search]`;
  return out;
}

/**
 * Downloads files in a module whose name contains `needle` and returns their embedded images,
 * largest first (at least minKb each, repeated pictures removed). Also saves them under
 * data/images/<folder>/<file>/.
 */
export async function courseImages(course, needle, { minKb = 40, max = 6 } = {}) {
  const folder = resolveFolder(course);
  const manifest = readJson(path.join(WORK_DIR, "manifest.json"), {});
  const content = readJson(path.join(CORPUS_DIR, folder, "content.json"), []);
  const ids = new Set(content.map((i) => i.id));
  const matches = Object.entries(manifest).filter(([key, v]) => {
    const [, kind, itemId] = key.split("|");
    return (kind === "att" || kind === "emb") && ids.has(itemId) && v.fileName?.toLowerCase().includes(String(needle).toLowerCase());
  });
  if (!matches.length) throw new Error(`No file in ${folder} has "${needle}" in its name.`);

  const results = [];
  const seenNames = new Set();
  for (const [key, v] of matches) {
    if (seenNames.has(v.fileName)) continue;
    seenNames.add(v.fileName);
    const [courseId, kind, contentId, ...rest] = key.split("|");
    let dl;
    if (kind === "att") dl = await bbDownload(`/learn/api/public/v1/courses/${courseId}/contents/${contentId}/attachments/${rest[0]}/download`);
    else continue; // embedded files are re-found by URL during a scan; attachments cover schedules and outlines
    if (!dl) continue;
    let imgs;
    try {
      imgs = await extractImages(dl.body, v.fileName);
    } catch {
      continue;
    }
    const outDir = path.join(WORK_DIR, "images", folder, v.fileName.replace(/[^\w.-]+/g, "_"));
    fs.mkdirSync(outDir, { recursive: true });
    const sigs = new Set();
    for (const img of imgs.sort((a, b) => b.data.length - a.data.length)) {
      if (img.data.length < minKb * 1024) continue;
      const sig = `${img.data.length}:${img.data.subarray(0, 64).toString("hex")}`;
      if (sigs.has(sig)) continue; // same picture repeated on several slides/pages
      sigs.add(sig);
      const file = path.join(outDir, img.name);
      fs.writeFileSync(file, img.data);
      results.push({ file, fromFile: v.fileName, name: img.name, page: img.page, mimeType: img.mimeType, kb: Math.round(img.data.length / 1024), data: img.data });
    }
  }
  results.sort((a, b) => b.kb - a.kb);
  return { folder, total: results.length, images: results.slice(0, max), more: results.slice(max).map(({ data, ...r }) => r) };
}
