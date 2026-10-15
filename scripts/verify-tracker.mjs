#!/usr/bin/env node
// Cross-checks the tracker against the latest scan, so wrong statuses or dates can't slip through.
//
//   1. Save the tracker rows: ArtifactData list (collection "deadlines", limit 1000, out_dir "~/.blackboard-mcp/data/db-snapshot")
//   2. node scripts/verify-tracker.mjs
//
// For every row with a columnId it compares the due date and submission status with
// ~/.blackboard-mcp/data/corpus/<course>/gradebook.json (whose `submission` field comes from the student's real
// attempts). It also lists gradebook items no row tracks, and visible rows that have a due date
// but no calendar event. Exit code 1 if anything needs fixing.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, WORK_DIR } from "../src/blackboard.mjs";

const snapDir = path.join(process.argv[2] ? path.resolve(process.argv[2]) : path.join(WORK_DIR, "db-snapshot"), "deadlines");
const semester = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "semester.json"), "utf8")).modules;
let usesCalendar = false;
try {
  usesCalendar = !!JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tracker.json"), "utf8")).calendarId;
} catch {}

const rows = fs.readdirSync(snapDir).filter((f) => f.endsWith(".json")).map((f) => {
  const j = JSON.parse(fs.readFileSync(path.join(snapDir, f), "utf8"));
  return { id: f.replace(/\.json$/, ""), ...(j.data || j) };
});

const columns = new Map();
for (const dir of fs.readdirSync(path.join(WORK_DIR, "corpus"))) {
  if (!semester.some((m) => dir.startsWith(m))) continue;
  const file = path.join(WORK_DIR, "corpus", dir, "gradebook.json");
  if (!fs.existsSync(file)) continue;
  for (const col of JSON.parse(fs.readFileSync(file, "utf8"))) columns.set(col.id, { ...col, course: dir });
}

const expected = { graded: ["graded"], submitted: ["submitted", "graded"], draft: ["not_submitted"], not_submitted: ["not_submitted"] };
const problems = [];
const tracked = new Set();
const now = Date.now();

for (const r of rows.filter((r) => !r.hidden)) {
  if (r.columnId) {
    tracked.add(r.columnId);
    const col = columns.get(r.columnId);
    if (!col) {
      problems.push({ id: r.id, problem: "gradebook item no longer exists (removed or hidden on Blackboard?)" });
      continue;
    }
    if (col.due && Date.parse(col.due) !== Date.parse(r.due)) problems.push({ id: r.id, problem: `due date differs: tracker ${r.due}, Blackboard ${col.due}` });
    if (!(expected[col.submission] || []).includes(r.status)) problems.push({ id: r.id, problem: `status differs: tracker "${r.status}", Blackboard attempts say "${col.submission}"${col.submittedAt ? ` (${col.submittedAt})` : ""}` });
    if (col.grade && r.grade !== col.grade) problems.push({ id: r.id, problem: `grade released on Blackboard: ${col.grade}` });
  } else if (r.status === "submitted" || r.status === "graded") {
    problems.push({ id: r.id, problem: `marked "${r.status}" but has no gradebook item to prove it; use "unknown" unless the student confirmed` });
  }
  if (usesCalendar && r.due && Date.parse(r.due) > now && !r.calendarEventId) problems.push({ id: r.id, problem: "upcoming dated deadline with no Google Calendar event" });
}
for (const [id, col] of columns) {
  if (!tracked.has(id)) problems.push({ id: `(gradebook ${col.course})`, problem: `"${col.name}" (due ${col.due ?? "none"}) isn't tracked; add a row with columnId ${id}` });
}

console.log(JSON.stringify({ rowsChecked: rows.length, gradebookItems: columns.size, ok: problems.length === 0, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
