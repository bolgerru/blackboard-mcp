// Cross-checks the tracker against the latest scan, so wrong statuses or dates can't slip through.
//
// The tracker rows come from an ArtifactData list saved with out_dir <dataDir>/data/db-snapshot
// (one JSON file per row under deadlines/). For every row with a columnId it compares the due date
// and submission status with data/corpus/<course>/gradebook.json, whose `submission` field comes from
// the student's real attempts. It also lists gradebook items no row tracks, "submitted" rows without
// proof, and upcoming dated rows with no calendar event (when a calendar is configured).

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, WORK_DIR } from "./blackboard.mjs";

export const SNAPSHOT_DIR = path.join(WORK_DIR, "db-snapshot");

const readJson = (f, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};

export function verifyTracker(snapshotDir = SNAPSHOT_DIR) {
  const rowsDir = fs.existsSync(path.join(snapshotDir, "deadlines")) ? path.join(snapshotDir, "deadlines") : snapshotDir;
  if (!fs.existsSync(rowsDir)) {
    return { ok: false, problems: [{ id: "(snapshot)", problem: `No saved rows at ${rowsDir}. Save them first with ArtifactData list (collection "deadlines", limit 1000, out_dir "${snapshotDir}").` }] };
  }
  const semester = readJson(path.join(DATA_DIR, "semester.json"), {}).modules || [];
  const usesCalendar = !!readJson(path.join(DATA_DIR, "tracker.json"), {}).calendarId;

  const rows = fs
    .readdirSync(rowsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const j = readJson(path.join(rowsDir, f), {});
      return { id: f.replace(/\.json$/, ""), ...(j.data || j) };
    });

  const columns = new Map();
  const corpus = path.join(WORK_DIR, "corpus");
  for (const dir of fs.existsSync(corpus) ? fs.readdirSync(corpus) : []) {
    if (semester.length && !semester.some((m) => dir.toUpperCase().startsWith(m.toUpperCase()))) continue;
    for (const col of readJson(path.join(corpus, dir, "gradebook.json"), [])) columns.set(col.id, { ...col, course: dir });
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
      if (!(expected[col.submission] || []).includes(r.status))
        problems.push({ id: r.id, problem: `status differs: tracker "${r.status}", Blackboard attempts say "${col.submission}"${col.submittedAt ? ` (${col.submittedAt})` : ""}` });
      if (col.grade && r.grade !== col.grade) problems.push({ id: r.id, problem: `grade released on Blackboard: ${col.grade}` });
    } else if (r.status === "submitted" || r.status === "graded") {
      problems.push({ id: r.id, problem: `marked "${r.status}" but has no gradebook item to prove it; use "unknown" unless the student confirmed` });
    }
    if (usesCalendar && r.due && Date.parse(r.due) > now && !r.calendarEventId) problems.push({ id: r.id, problem: "upcoming dated deadline with no Google Calendar event" });
  }
  for (const [id, col] of columns) {
    if (!tracked.has(id)) problems.push({ id: `(gradebook ${col.course})`, problem: `"${col.name}" (due ${col.due ?? "none"}) isn't tracked; add a row with columnId ${id}` });
  }

  return { rowsChecked: rows.length, gradebookItems: columns.size, ok: problems.length === 0, problems };
}
