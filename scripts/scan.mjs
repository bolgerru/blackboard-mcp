#!/usr/bin/env node
// Full scan of this term's Blackboard courses into ~/.blackboard-mcp/data/corpus/ so deadlines can be
// found anywhere: content pages, assignment instructions, slides, PDFs, docs,
// announcements and the gradebook. Incremental: unchanged files aren't re-downloaded.
//
//   node scripts/scan.mjs            # current term
//   node scripts/scan.mjs --all      # every term
//
// Prints a JSON summary (including what's new/changed since the last scan) to stdout.

import fs from "node:fs";
import path from "node:path";
import { OfficeParser } from "officeparser";
import { bbDownload, bbGetAll, getCourses, getCurrentCourses, getMe, getSubmission, htmlToText, getBaseUrl, WORK_DIR } from "../src/blackboard.mjs";

const OUT = path.join(WORK_DIR, "corpus");
const MANIFEST = path.join(WORK_DIR, "manifest.json");
const TEXT_TYPES = /\.(pdf|pptx?|docx?|xlsx?|odt|odp|rtf|txt|md|csv|html?)$/i;

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const seenKeys = new Set();
const changes = [];
const problems = [];
const log = (...a) => console.error(...a);
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);

async function extractText(buf, fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  if (["txt", "md", "csv"].includes(ext)) return buf.toString("utf8");
  if (["html", "htm"].includes(ext)) return htmlToText(buf.toString("utf8"));
  const ast = await OfficeParser.parseOffice(buf, { fileType: ext });
  return (await ast.to("text")).value;
}

// Pull embedded file links out of Ultra document HTML.
function embeddedFiles(html) {
  if (!html) return [];
  const base = getBaseUrl();
  const fixed = html.replace(/@X@EmbeddedFile\.requestUrlStub@X@/g, `${base}/`);
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const out = new Map();
  // Each embedded file is a tag carrying href/src plus a data-bbfile JSON blob with its real name;
  // the URL itself only ends in an opaque "xid-…" id, so the name must come from data-bbfile.
  for (const tag of fixed.matchAll(/<(?:a|img|video|audio|source)\b[^>]*>/gi)) {
    const t = tag[0];
    const urlAttr = t.match(/(?:href|src)="([^"]*bbcswebdav[^"]*)"/i)?.[1];
    let info = {};
    const blob = t.match(/data-bbfile="([^"]+)"/i)?.[1];
    if (blob) {
      try {
        info = JSON.parse(decode(blob));
      } catch {}
    }
    const url = urlAttr ? decode(urlAttr) : info.resourceUrl ? decode(info.resourceUrl) : null;
    if (!url || !url.includes("bbcswebdav")) continue;
    const name = info.fileName || info.linkName || info.displayName || decodeURIComponent(url.split("?")[0].split("/").pop() || "file");
    out.set(url, name);
  }
  return [...out].map(([url, name]) => ({ url, name }));
}

async function saveFile(courseDir, key, modified, fileName, getter, meta) {
  seenKeys.add(key);
  const prev = manifest[key];
  // Reuse earlier results unless the file changed, its text went missing, or it failed last time.
  if (prev && prev.modified === modified && !prev.error && (prev.textFile ? fs.existsSync(path.join(OUT, prev.textFile)) : true)) return prev;
  if (!TEXT_TYPES.test(fileName)) {
    manifest[key] = { modified, fileName, skipped: "not a text document" };
    return manifest[key];
  }
  try {
    const dl = await getter();
    if (!dl) {
      manifest[key] = { modified, fileName, skipped: "too large or off-site" };
      return manifest[key];
    }
    const text = (await extractText(dl.body, fileName)).trim();
    const rel = path.join(path.basename(courseDir), "files", `${safe(key.split("|").pop())}__${safe(fileName)}.txt`);
    fs.mkdirSync(path.join(OUT, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), `# ${meta.course} › ${meta.location} › ${fileName}\n\n${text}`);
    manifest[key] = { modified, fileName, textFile: rel, chars: text.length };
    changes.push({ course: meta.course, change: prev ? "updated file" : "new file", where: `${meta.location} › ${fileName}` });
    if (text.length < 50) manifest[key].note = "little/no text (probably scanned or image-only)";
  } catch (e) {
    if (e.constructor?.name === "NotLoggedInError") throw e;
    manifest[key] = { modified, fileName, error: e.message.slice(0, 200) };
    problems.push({ course: meta.course, file: `${meta.location} › ${fileName}`, error: e.message.slice(0, 200) });
  }
  return manifest[key];
}

async function scanCourse(c) {
  const courseDir = path.join(OUT, safe(c.courseId || c.id));
  fs.mkdirSync(courseDir, { recursive: true });
  const items = [];

  async function walk(parentId, trail) {
    const p = parentId
      ? `/learn/api/public/v1/courses/${c.id}/contents/${parentId}/children`
      : `/learn/api/public/v1/courses/${c.id}/contents`;
    let children;
    try {
      children = await bbGetAll(p, { limit: 200 });
    } catch (e) {
      if (e.constructor?.name === "NotLoggedInError") throw e;
      problems.push({ course: c.name, file: trail.join(" › ") || "(root)", error: e.message.slice(0, 200) });
      return;
    }
    for (const it of children) {
      if (it.availability?.available === "No") continue;
      const location = [...trail, it.title].join(" › ");
      const type = it.contentHandler?.id?.replace("resource/x-bb-", "") ?? "unknown";
      const text = htmlToText(it.body || it.description || "");
      // Assignments and tests keep their instructions (often with due dates and what to upload) here.
      const instructions = htmlToText(it.contentHandler?.instructions || "");
      const record = {
        id: it.id,
        location,
        title: it.title,
        type,
        created: it.created,
        modified: it.modified,
        url: it.contentHandler?.url,
        gradeColumnId: it.contentHandler?.gradeColumnId,
        text: text || undefined,
        instructions: instructions || undefined,
        files: [],
      };
      const key = `${c.id}|item|${it.id}`;
      seenKeys.add(key);
      if (!manifest[key]) changes.push({ course: c.name, change: "new item", where: location });
      else if (manifest[key].modified !== it.modified) changes.push({ course: c.name, change: "updated item", where: location });
      manifest[key] = { modified: it.modified };

      const meta = { course: c.name, location };
      // Uploaded files (x-bb-file and assignment attachments)
      try {
        const atts = await bbGetAll(`/learn/api/public/v1/courses/${c.id}/contents/${it.id}/attachments`);
        for (const a of atts) {
          const r = await saveFile(courseDir, `${c.id}|att|${it.id}|${a.id}`, it.modified, a.fileName, () =>
            bbDownload(`/learn/api/public/v1/courses/${c.id}/contents/${it.id}/attachments/${a.id}/download`), meta);
          record.files.push({ name: a.fileName, textFile: r.textFile, note: r.skipped || r.note || r.error });
        }
      } catch (e) {
        if (e.constructor?.name === "NotLoggedInError") throw e;
      }
      // Files embedded in document HTML or assignment instructions
      for (const f of [...embeddedFiles(it.body), ...embeddedFiles(it.contentHandler?.instructions)]) {
        const r = await saveFile(courseDir, `${c.id}|emb|${it.id}|${f.url.split("?")[0].split("/").slice(-2).join("/")}`, it.modified, f.name, () => bbDownload(f.url), meta);
        record.files.push({ name: f.name, textFile: r.textFile, note: r.skipped || r.note || r.error });
      }
      if (!record.files.length) delete record.files;
      items.push(record);
      if (it.hasChildren) await walk(it.id, [...trail, it.title]);
    }
  }

  log(`Scanning ${c.name}...`);
  await walk(null, []);
  fs.writeFileSync(path.join(courseDir, "content.json"), JSON.stringify(items, null, 2));

  // Announcements
  try {
    const ann = await bbGetAll(`/learn/api/public/v1/courses/${c.id}/announcements`, { limit: 100 });
    const list = ann.map((a) => ({ id: a.id, title: a.title, posted: a.created, modified: a.modified, text: htmlToText(a.body) }));
    for (const a of list) {
      const key = `${c.id}|ann|${a.id}`;
      seenKeys.add(key);
      if (!manifest[key]) changes.push({ course: c.name, change: "new announcement", where: a.title });
      else if (manifest[key].modified !== a.modified) changes.push({ course: c.name, change: "updated announcement", where: a.title });
      manifest[key] = { modified: a.modified };
    }
    fs.writeFileSync(path.join(courseDir, "announcements.json"), JSON.stringify(list, null, 2));
  } catch (e) {
    if (e.constructor?.name === "NotLoggedInError") throw e;
    problems.push({ course: c.name, file: "(announcements)", error: e.message.slice(0, 200) });
  }

  // Gradebook columns (official due dates) and the student's real submission state
  try {
    const me = await getMe();
    const cols = await bbGetAll(`/learn/api/public/v2/courses/${c.id}/gradebook/columns`, { limit: 200 });
    const list = [];
    for (const col of cols) {
      const s = await getSubmission(c.id, col, me.id);
      list.push({
        id: col.id,
        name: col.name,
        due: col.grading?.due,
        points: col.score?.possible,
        contentId: col.contentId,
        submission: s.status, // graded | submitted | draft | not_submitted (from attempts, not the grade record)
        submittedAt: s.submittedAt,
        grade: s.grade,
        groupAssignment: s.group,
      });
    }
    for (const col of list) {
      const key = `${c.id}|col|${col.id}`;
      seenKeys.add(key);
      const prev = manifest[key];
      if (!prev) changes.push({ course: c.name, change: "new gradebook item", where: `${col.name}${col.due ? ` (due ${col.due})` : ""}` });
      else {
        if (prev.due !== col.due) changes.push({ course: c.name, change: "due date changed", where: `${col.name}: ${prev.due} → ${col.due}` });
        if (prev.submission && prev.submission !== col.submission) changes.push({ course: c.name, change: "submission status changed", where: `${col.name}: ${prev.submission} → ${col.submission}` });
        if ((prev.grade ?? null) !== (col.grade ?? null) && col.grade) changes.push({ course: c.name, change: "grade released", where: `${col.name}: ${col.grade}` });
      }
      manifest[key] = { due: col.due, submission: col.submission, grade: col.grade ?? null };
    }
    fs.writeFileSync(path.join(courseDir, "gradebook.json"), JSON.stringify(list, null, 2));
  } catch (e) {
    if (e.constructor?.name === "NotLoggedInError") throw e;
  }

  const files = items.flatMap((i) => i.files || []);
  return {
    course: c.name,
    courseId: c.courseId,
    items: items.length,
    files: files.length,
    filesWithText: files.filter((f) => f.textFile).length,
  };
}

const firstRun = Object.keys(manifest).length === 0;
const courses = process.argv.includes("--all") ? await getCourses() : await getCurrentCourses();
fs.mkdirSync(OUT, { recursive: true });
const summary = [];
try {
  for (const c of courses) {
    summary.push(await scanCourse(c));
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1)); // save progress as we go
  }
} catch (e) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(JSON.stringify({ error: e.message }));
  process.exit(2);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(
  JSON.stringify(
    { scannedAt: new Date().toISOString(), firstRun, courses: summary, changes: firstRun ? `${changes.length} (first scan — everything is new)` : changes, problems },
    null,
    2
  )
);
