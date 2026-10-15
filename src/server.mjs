#!/usr/bin/env node
// Blackboard MCP server: read-only tools for courses, due dates, content,
// announcements and grades. All logging goes to stderr; stdout is the MCP channel.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_DIR,
  WORK_DIR,
  NotLoggedInError,
  bbGet,
  bbGetAll,
  courseRef,
  getBaseUrl,
  getCourses,
  getCurrentCourses,
  getMe,
  getSubmission,
  htmlToText,
  interactiveLogin,
  setBaseUrl,
} from "./blackboard.mjs";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = new McpServer({ name: "blackboard", version: "1.0.0" });

const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return ok(await handler(args));
    } catch (e) {
      if (e instanceof NotLoggedInError) return fail(e.message);
      console.error(`[${name}] ${e.message}`);
      return fail(`Error: ${e.message}`);
    }
  });
}

// Runs fn for every course, keeping per-course failures instead of aborting.
async function perCourse(courses, fn) {
  const errors = [];
  const results = await Promise.all(
    courses.map(async (c) => {
      try {
        return await fn(c);
      } catch (e) {
        if (e instanceof NotLoggedInError) throw e;
        errors.push({ course: c.name, error: e.message });
        return [];
      }
    })
  );
  return { results: results.flat(), errors };
}

// No course given → current term (or every term with allTerms). A course name/code searches all terms.
async function resolveCourses(course, { allTerms = false } = {}) {
  if (!course) return allTerms ? getCourses() : getCurrentCourses();
  const all = await getCourses();
  const q = course.toLowerCase();
  const match = all.filter(
    (c) => c.id === course || c.courseId?.toLowerCase() === q || c.courseId?.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q)
  );
  if (match.length) return match;
  // Not in the membership list — trust it as a raw id.
  return [{ id: courseRef(course), courseId: course, name: course }];
}

const DAY = 86_400_000;


async function getCalendarItems(from, to) {
  const items = await bbGetAll("/learn/api/public/v1/calendars/items", {
    since: new Date(from).toISOString(),
    until: new Date(to).toISOString(),
    sort: "start",
    limit: 200,
  });
  return items.map((it) => {
    const description = htmlToText(it.description);
    // Timetable feeds (lectures, tutorials, labs) say "Event Type: LECTURE" etc.
    const eventType = description.match(/Event Type:\s*([A-Z][A-Z ]+)/i)?.[1]?.trim();
    const location = description.match(/Location\(s\):\s*([^\n]+)/i)?.[1]?.trim();
    const lecturer = description.match(/Lecturer\(s\):\s*([^\n]+)/i)?.[1]?.trim();
    return {
      course: it.calendarName,
      courseId: it.calendarId,
      title: it.title,
      start: it.start,
      end: it.end,
      type: it.type,
      isClass: !!eventType,
      eventType: eventType?.toLowerCase(),
      location,
      lecturer,
      description: eventType ? undefined : description.slice(0, 300) || undefined,
    };
  });
}

// ---------- tools ----------

tool(
  "blackboard_login",
  "Open a browser window so the student can sign in to Blackboard themselves (SSO/MFA supported). Use this first, or whenever another tool says the session expired. Pass `url` the first time to set the school's Blackboard address.",
  { url: z.string().optional().describe("School Blackboard address, e.g. https://blackboard.myschool.edu (only needed the first time)") },
  async ({ url }) => {
    if (url) setBaseUrl(url);
    if (!getBaseUrl()) throw new Error("Pass the school's Blackboard address as `url` the first time.");
    const me = await interactiveLogin();
    return `Signed in to ${getBaseUrl()} as ${me.name?.given ?? ""} ${me.name?.family ?? ""} (${me.userName}). The browser window has closed; you can use the other Blackboard tools now.`;
  }
);

tool(
  "blackboard_status",
  "Check the setup: where the plugin's scripts and the student's data folder are, which modules are tracked this semester, the tracker settings, and whether the saved Blackboard login still works. Call this first in the setup and daily-check skills.",
  {},
  async () => {
    const readJson = (f) => {
      try {
        return JSON.parse(fs.readFileSync(f, "utf8"));
      } catch {
        return null;
      }
    };
    const out = {
      blackboard: getBaseUrl(),
      pluginDir: PLUGIN_DIR,
      scripts: {
        scan: path.join(PLUGIN_DIR, "scripts", "scan.mjs"),
        verify: path.join(PLUGIN_DIR, "scripts", "verify-tracker.mjs"),
        grepDeadlines: path.join(PLUGIN_DIR, "scripts", "grep-deadlines.sh"),
        extractImages: path.join(PLUGIN_DIR, "scripts", "extract-images.mjs"),
        trackerPage: path.join(PLUGIN_DIR, "tracker", "deadline-tracker.html"),
      },
      dataDir: DATA_DIR,
      corpusDir: path.join(WORK_DIR, "corpus"),
      semester: readJson(path.join(DATA_DIR, "semester.json")),
      tracker: readJson(path.join(DATA_DIR, "tracker.json")),
      notesFile: fs.existsSync(path.join(DATA_DIR, "NOTES.md")) ? path.join(DATA_DIR, "NOTES.md") : null,
    };
    try {
      const me = await getMe();
      out.signedInAs = me.userName;
      out.name = `${me.name?.given ?? ""} ${me.name?.family ?? ""}`.trim();
    } catch (e) {
      out.signedInAs = null;
      out.login = e instanceof NotLoggedInError ? "Not signed in (or the session expired). Use blackboard_login." : `Error: ${e.message}`;
    }
    return out;
  }
);

tool(
  "list_courses",
  "List the student's Blackboard courses for the current term (or every term).",
  {
    all_terms: z.boolean().optional().describe("Include courses from previous terms/years"),
    include_unavailable: z.boolean().optional().describe("Also include closed courses (implies all_terms)"),
  },
  async ({ all_terms, include_unavailable }) => {
    if (include_unavailable) return getCourses({ includeUnavailable: true });
    return all_terms ? getCourses() : getCurrentCourses();
  }
);

tool(
  "get_due_items",
  "Everything with a due date across this term's courses (or one course): assignments, tests, quizzes and non-class calendar events, with submission status (Not submitted / Submitted (awaiting grade) / Graded). Sorted by due date; `overdue` is true only for past-due work not yet submitted. Lectures/tutorials are left out (use get_timetable). The main tool for keeping the student on track. Note: instructors also post deadlines in announcements that may not be in the gradebook — check get_announcements too.",
  {
    days_ahead: z.number().int().min(1).max(110).optional().describe("How far ahead to look (default 14)"),
    days_overdue: z.number().int().min(0).max(60).optional().describe("Also include items that were due this many days ago (default 7)"),
    course: z.string().optional().describe("Limit to one course (name, course code, or id)"),
  },
  async ({ days_ahead = 14, days_overdue = 7, course }) => {
    const now = Date.now();
    const from = now - days_overdue * DAY;
    const to = now + days_ahead * DAY;
    const me = await getMe();
    const courses = await resolveCourses(course);

    const { results: gradebookItems, errors } = await perCourse(courses, async (c) => {
      const cols = await bbGetAll(`/learn/api/public/v2/courses/${c.id}/gradebook/columns`, { limit: 200 });
      const dueCols = cols.filter((col) => {
        const due = col.grading?.due && Date.parse(col.grading.due);
        return due && due >= from && due <= to;
      });
      return Promise.all(
        dueCols.map(async (col) => {
          const s = await getSubmission(c.id, col, me.id);
          return {
            course: c.name,
            courseId: c.id,
            title: col.name,
            due: col.grading.due,
            pointsPossible: col.score?.possible,
            status: s.label,
            submitted: s.status === "submitted" || s.status === "graded",
            submittedAt: s.submittedAt ?? undefined,
            groupAssignment: s.group || undefined,
            grade: s.grade,
            columnId: col.id,
            contentId: col.contentId,
            source: "gradebook",
          };
        })
      );
    });

    for (const i of gradebookItems) i.overdue = Date.parse(i.due) < now && !i.submitted;

    // Calendar catches upcoming non-class events (course deadlines/events, personal reminders).
    let calendarItems = [];
    try {
      const courseIds = new Set(courses.map((c) => c.id));
      calendarItems = (await getCalendarItems(now, to))
        .filter((it) => !it.isClass && (!course || courseIds.has(it.courseId)))
        .map(({ isClass, eventType, location, lecturer, start, end, ...it }) => ({ ...it, due: end || start, source: "calendar" }));
    } catch (e) {
      if (e instanceof NotLoggedInError) throw e;
      errors.push({ course: "(calendar)", error: e.message });
    }

    const seen = new Set(gradebookItems.map((i) => `${i.title.toLowerCase()}|${i.due.slice(0, 10)}`));
    const merged = [
      ...gradebookItems,
      ...calendarItems.filter((i) => !seen.has(`${i.title?.toLowerCase()}|${i.due?.slice(0, 10)}`)),
    ].sort((a, b) => Date.parse(a.due) - Date.parse(b.due));

    return { now: new Date(now).toISOString(), items: merged, errors: errors.length ? errors : undefined };
  }
);

tool(
  "get_timetable",
  "The student's class timetable from the Blackboard calendar: lectures, tutorials, labs, with times, rooms and lecturers.",
  {
    days_ahead: z.number().int().min(1).max(60).optional().describe("How many days ahead (default 7)"),
    start_date: z.string().optional().describe("Start from this date (YYYY-MM-DD) instead of now"),
  },
  async ({ days_ahead = 7, start_date }) => {
    const from = start_date ? Date.parse(start_date) : Date.now();
    if (Number.isNaN(from)) throw new Error("start_date must be YYYY-MM-DD");
    const items = await getCalendarItems(from, from + days_ahead * DAY);
    return items
      .filter((it) => it.isClass)
      .map(({ title, eventType, start, end, location, lecturer }) => ({ title, eventType, start, end, location, lecturer }));
  }
);

tool(
  "list_course_content",
  "Browse a course's content tree (folders, assignments, documents, tests, links). Use folder_id to open a specific folder.",
  {
    course: z.string().describe("Course name, course code, or id"),
    folder_id: z.string().optional().describe("Content id of a folder to list (default: course root)"),
    depth: z.number().int().min(1).max(4).optional().describe("How many folder levels to expand (default 2)"),
  },
  async ({ course, folder_id, depth = 2 }) => {
    const [c] = await resolveCourses(course);
    let budget = 400;
    async function walk(parentId, level) {
      const p = parentId
        ? `/learn/api/public/v1/courses/${c.id}/contents/${parentId}/children`
        : `/learn/api/public/v1/courses/${c.id}/contents`;
      const items = await bbGetAll(p, { limit: 200 });
      const out = [];
      for (const it of items) {
        if (budget-- <= 0) break;
        const node = {
          id: it.id,
          title: it.title,
          type: it.contentHandler?.id?.replace("resource/x-bb-", ""),
          hasChildren: it.hasChildren || undefined,
          available: it.availability?.available,
        };
        if (it.hasChildren && level < depth) {
          try {
            node.children = await walk(it.id, level + 1);
          } catch (e) {
            if (e instanceof NotLoggedInError) throw e;
            node.children_error = e.message;
          }
        }
        out.push(node);
      }
      return out;
    }
    return { course: c.name, courseId: c.id, content: await walk(folder_id, 1) };
  }
);

tool(
  "get_content_item",
  "Read one content item in full: instructions/description text, attachments, and its due date/points if it's graded.",
  {
    course: z.string().describe("Course name, course code, or id"),
    content_id: z.string().describe("Content id from list_course_content or get_due_items"),
  },
  async ({ course, content_id }) => {
    const [c] = await resolveCourses(course);
    const it = await bbGet(`/learn/api/public/v1/courses/${c.id}/contents/${content_id}`);
    const result = {
      course: c.name,
      title: it.title,
      type: it.contentHandler?.id,
      text: htmlToText(it.body || it.description),
      created: it.created,
      modified: it.modified,
    };
    try {
      const att = await bbGetAll(`/learn/api/public/v1/courses/${c.id}/contents/${content_id}/attachments`);
      if (att.length) result.attachments = att.map((a) => ({ name: a.fileName, mimeType: a.mimeType }));
    } catch {}
    if (it.contentHandler?.gradeColumnId) {
      try {
        const col = await bbGet(`/learn/api/public/v2/courses/${c.id}/gradebook/columns/${it.contentHandler.gradeColumnId}`);
        result.due = col.grading?.due;
        result.pointsPossible = col.score?.possible;
      } catch {}
    }
    return result;
  }
);

tool(
  "get_announcements",
  "Recent announcements from all courses, or one course.",
  {
    course: z.string().optional().describe("Limit to one course"),
    days: z.number().int().min(1).max(180).optional().describe("Only announcements from the last N days (default 14)"),
  },
  async ({ course, days = 14 }) => {
    const since = Date.now() - days * DAY;
    const courses = await resolveCourses(course);
    const { results, errors } = await perCourse(courses, async (c) => {
      const list = await bbGetAll(`/learn/api/public/v1/courses/${c.id}/announcements`, { limit: 100 });
      return list
        .filter((a) => Date.parse(a.modified || a.created) >= since)
        .map((a) => ({ course: c.name, title: a.title, posted: a.created, text: htmlToText(a.body).slice(0, 2000) }));
    });
    results.sort((a, b) => Date.parse(b.posted) - Date.parse(a.posted));
    return { announcements: results, errors: errors.length ? errors : undefined };
  }
);

tool(
  "get_grades",
  "The student's grades for one course or this term's courses: each gradebook item with score, points possible, submission status and feedback. A null grade usually means not graded yet or not released to students.",
  {
    course: z.string().optional().describe("Limit to one course"),
    all_terms: z.boolean().optional().describe("Include previous terms/years"),
  },
  async ({ course, all_terms }) => {
    const me = await getMe();
    const courses = await resolveCourses(course, { allTerms: !!all_terms });
    const { results, errors } = await perCourse(courses, async (c) => {
      const [cols, grades] = await Promise.all([
        bbGetAll(`/learn/api/public/v2/courses/${c.id}/gradebook/columns`, { limit: 200 }),
        bbGetAll(`/learn/api/public/v2/courses/${c.id}/gradebook/users/${me.id}`, { limit: 200 }),
      ]);
      const byCol = Object.fromEntries(grades.map((g) => [g.columnId, g]));
      if (!cols.length) return [];
      return [
        {
          course: c.name,
          items: await Promise.all(
            cols.map(async (col) => {
              const g = byCol[col.id];
              const s = await getSubmission(c.id, col, me.id);
              return {
                title: col.name,
                due: col.grading?.due,
                pointsPossible: col.score?.possible,
                grade: s.grade,
                status: s.label,
                submittedAt: s.submittedAt ?? undefined,
                feedback: g?.feedback ? htmlToText(g.feedback).slice(0, 500) : undefined,
              };
            })
          ),
        },
      ];
    });
    return { courses: results, errors: errors.length ? errors : undefined };
  }
);

tool(
  "blackboard_api_get",
  "Advanced/fallback: make a read-only GET request to any Blackboard Learn REST path (must start with /learn/api/). Useful when the other tools don't cover something.",
  {
    path: z.string().describe("e.g. /learn/api/public/v1/courses/_123_1/contents"),
    params: z.record(z.string(), z.string()).optional().describe("Query string parameters"),
  },
  async ({ path, params }) => bbGet(path, params)
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Blackboard MCP server running (${getBaseUrl() ?? "URL not set yet"})`);
