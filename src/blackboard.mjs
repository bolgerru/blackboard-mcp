// Blackboard Learn client that rides on the user's own browser login.
//
// Students can't register a REST API app, but the Blackboard web UI itself calls
// the /learn/api endpoints using the logged-in session cookies. We let the user
// sign in (SSO, MFA and all) in a real Edge/Chrome window, save that session,
// and replay it for read-only GET requests.

import { chromium, request } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Everything personal (login, settings, scanned course files, notes) lives here, never in the repo.
export const DATA_DIR = process.env.BB_DATA_DIR || path.join(os.homedir(), ".blackboard-mcp");
export const WORK_DIR = path.join(DATA_DIR, "data");
export const DEFAULT_BB_URL = "https://tcd.blackboard.com";
const PROFILE_DIR = path.join(DATA_DIR, "browser-profile");
const SESSION_FILE = path.join(DATA_DIR, "session.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

export class NotLoggedInError extends Error {
  constructor(msg = "Not logged in to Blackboard (or the session expired). Use the blackboard_login tool to sign in again.") {
    super(msg);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function getBaseUrl() {
  const raw = process.env.BB_URL || readJson(CONFIG_FILE)?.baseUrl || DEFAULT_BB_URL;
  const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  return u.origin;
}

export function setBaseUrl(raw) {
  const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ baseUrl: u.origin }, null, 2));
  return u.origin;
}

function requireBaseUrl() {
  const base = getBaseUrl();
  if (!base) {
    throw new Error(
      "Blackboard URL not set. Call blackboard_login with your school's Blackboard address (e.g. https://blackboard.myschool.edu)."
    );
  }
  return base;
}

// ---------- login ----------

/**
 * Installed Chromium browsers usable for the sign-in window, in order of preference:
 * [{ channel: "msedge" | "chrome", executablePath }]. Edge first on Windows (built in), Chrome first on
 * macOS (more common there). Covers per-user installs (e.g. ~/Applications on a Mac), which
 * Playwright's own channel lookup misses.
 */
export function installedBrowsers() {
  const pf = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const macApp = (name) => ["/Applications", path.join(os.homedir(), "Applications")].map((d) => path.join(d, `${name}.app`, "Contents", "MacOS", name));
  const candidates = {
    win32: [
      ["msedge", pf.map((p) => path.join(p, "Microsoft", "Edge", "Application", "msedge.exe"))],
      ["chrome", pf.map((p) => path.join(p, "Google", "Chrome", "Application", "chrome.exe"))],
    ],
    darwin: [
      ["chrome", macApp("Google Chrome")],
      ["msedge", macApp("Microsoft Edge")],
    ],
    linux: [
      ["chrome", ["/opt/google/chrome/chrome", "/usr/bin/google-chrome"]],
      ["msedge", ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge"]],
    ],
  }[process.platform] || [];
  const found = [];
  for (const [channel, paths] of candidates) {
    const executablePath = paths.find((p) => fs.existsSync(p));
    if (executablePath) found.push({ channel, executablePath });
  }
  if (process.env.BB_BROWSER) found.sort((a, b) => (a.channel === process.env.BB_BROWSER ? -1 : b.channel === process.env.BB_BROWSER ? 1 : 0));
  return found;
}

/** Which installed browser the sign-in window will use ("msedge", "chrome"), or null if neither is found. */
export function findBrowser() {
  return installedBrowsers()[0]?.channel ?? null;
}

async function launchBrowser({ headless = false } = {}) {
  const opts = { headless, viewport: null, args: ["--no-first-run"] };
  const found = installedBrowsers();
  // Launch by exact path when we found one; otherwise let Playwright try its standard locations.
  const attempts = found.length ? found.map((b) => ({ executablePath: b.executablePath })) : [{ channel: "msedge" }, { channel: "chrome" }];
  let lastErr;
  for (const how of attempts) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, ...how });
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    found.length
      ? `Couldn't open ${found.map((b) => b.channel).join(" or ")} for the Blackboard sign-in: ${lastErr?.message}`
      : "No Chrome or Microsoft Edge found for the Blackboard sign-in window. Install Google Chrome (https://www.google.com/chrome/) and try again."
  );
}

/**
 * Opens a visible browser window on the Blackboard site and waits until the
 * user has signed in themselves. Saves the session cookies for later API calls.
 */
export async function interactiveLogin({ timeoutMs = 5 * 60_000 } = {}) {
  const base = requireBaseUrl();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const ctx = await launchBrowser();
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${base}/ultra`, { waitUntil: "domcontentloaded" }).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (ctx.pages().length === 0) throw new Error("The login window was closed before sign-in finished.");
      const res = await ctx.request.get(`${base}/learn/api/public/v1/users/me`, { failOnStatusCode: false }).catch(() => null);
      if (res && res.ok()) {
        const me = await res.json();
        await ctx.storageState({ path: SESSION_FILE });
        await resetApi(); // pick up the new cookies
        return me;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timed out waiting for you to sign in to Blackboard.");
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Tries to renew the session without the user: reopens the saved browser profile
 * headless, where the school's SSO usually remembers them. Returns true on success.
 */
export async function silentLogin({ timeoutMs = 60_000 } = {}) {
  const base = requireBaseUrl();
  if (!fs.existsSync(PROFILE_DIR)) return false;
  let ctx;
  try {
    ctx = await launchBrowser({ headless: true });
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${base}/ultra`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await ctx.request.get(`${base}/learn/api/public/v1/users/me`, { failOnStatusCode: false }).catch(() => null);
      if (res && res.ok()) {
        await ctx.storageState({ path: SESSION_FILE });
        await resetApi();
        return true;
      }
      // Blackboard's own login page: follow its single sign-on button if there is one.
      await page.locator("a:has-text('Sign in'), a:has-text('Log in'), button:has-text('Sign in'), #redirectProvidersDropdownButton").first().click({ timeout: 1500 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  } catch (e) {
    console.error(`Silent login failed: ${e.message}`);
    return false;
  } finally {
    await ctx?.close().catch(() => {});
  }
}

let silentTried = 0;
async function withRelogin(fn) {
  try {
    return await fn();
  } catch (e) {
    // At most one silent attempt every 10 minutes.
    if (!(e instanceof NotLoggedInError) || Date.now() - silentTried < 10 * 60_000) throw e;
    silentTried = Date.now();
    if (!(await silentLogin())) throw e;
    return fn();
  }
}

// ---------- API ----------

let api = null;

async function resetApi() {
  await api?.dispose().catch(() => {});
  api = null;
  meCache = null;
}

async function getApi() {
  if (api) return api;
  const base = requireBaseUrl();
  if (!fs.existsSync(SESSION_FILE)) throw new NotLoggedInError();
  api = await request.newContext({ baseURL: base, storageState: SESSION_FILE, extraHTTPHeaders: { Accept: "application/json" } });
  return api;
}

/** Read-only GET against Blackboard's /learn/api. Returns parsed JSON. */
export function bbGet(apiPath, params) {
  return withRelogin(() => bbGetOnce(apiPath, params));
}

async function bbGetOnce(apiPath, params) {
  if (!apiPath.startsWith("/learn/api/") || apiPath.includes("..")) throw new Error("Only /learn/api/ paths are allowed.");
  const ctx = await getApi();
  const res = await ctx.get(apiPath, { params, failOnStatusCode: false, maxRedirects: 0 });
  const status = res.status();
  if (status === 401 || (status >= 300 && status < 400)) throw new NotLoggedInError();
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // An HTML page here almost always means we got bounced to the login screen.
    throw new NotLoggedInError();
  }
  if (!res.ok()) {
    const err = new Error(`Blackboard returned ${status} for ${apiPath}: ${body?.message || text.slice(0, 200)}`);
    err.status = status;
    throw err;
  }
  // Keep refreshed cookies so the session lasts as long as possible.
  await ctx.storageState({ path: SESSION_FILE }).catch(() => {});
  return body;
}

/** Downloads a file from the Blackboard host (following redirects). Returns null for non-files/too-large. */
export function bbDownload(urlOrPath, opts) {
  return withRelogin(() => bbDownloadOnce(urlOrPath, opts));
}

async function bbDownloadOnce(urlOrPath, { maxBytes = 60 * 1024 * 1024 } = {}) {
  const base = requireBaseUrl();
  const url = new URL(urlOrPath, base);
  if (url.origin !== base) return null; // never send the session to another host
  const ctx = await getApi();
  const res = await ctx.get(url.toString(), { failOnStatusCode: false, timeout: 120_000 });
  if (res.status() === 401) throw new NotLoggedInError();
  if (!res.ok()) throw new Error(`HTTP ${res.status()} downloading ${url.pathname}`);
  const type = res.headers()["content-type"] || "";
  if (type.includes("text/html") && new URL(res.url()).pathname.includes("login")) throw new NotLoggedInError();
  const body = await res.body();
  if (body.length > maxBytes) return null;
  const disp = res.headers()["content-disposition"] || "";
  const name = decodeURIComponent(disp.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || disp.match(/filename="?([^";]+)/i)?.[1] || "");
  return { body, contentType: type, fileName: name };
}

/** Follows Blackboard's paging.nextPage links and returns all results. */
export async function bbGetAll(apiPath, params = {}, maxItems = 1000) {
  const out = [];
  let page = await bbGet(apiPath, params);
  out.push(...(page?.results || []));
  while (page?.paging?.nextPage && out.length < maxItems) {
    const next = new URL(page.paging.nextPage, "http://x");
    page = await bbGet(next.pathname, Object.fromEntries(next.searchParams));
    out.push(...(page?.results || []));
  }
  return out;
}

// ---------- helpers ----------

/** Accepts either a Blackboard primary id (_123_1) or a course code like "HIST101-FA26". */
export function courseRef(id) {
  return id.startsWith("_") || id.includes(":") ? id : `courseId:${id}`;
}

export function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const SUBMITTED_ATTEMPT = new Set(["NeedsGrading", "Completed", "NeedsGradingWithAttempt", "Graded"]);

/**
 * The student's real submission state for one gradebook column.
 *
 * Don't trust the grade record's `status` on its own: Blackboard creates placeholder grades
 * ("NeedsGrading", even "Graded") for group assignments before anyone submits. The attempts
 * list is the ground truth; a grade only counts once it has an actual score or display text.
 *
 * Returns { status: "graded"|"submitted"|"draft"|"not_submitted", label, submittedAt, grade, group }.
 */
export async function getSubmission(courseId, column, userId, { contentId } = {}) {
  let grade = null;
  try {
    grade = await bbGet(`/learn/api/public/v2/courses/${courseId}/gradebook/columns/${column.id}/users/${userId}`);
  } catch (e) {
    if (e instanceof NotLoggedInError) throw e;
  }
  let attempts = [];
  try {
    attempts = await bbGetAll(`/learn/api/public/v2/courses/${courseId}/gradebook/columns/${column.id}/attempts`, { userId });
  } catch (e) {
    if (e instanceof NotLoggedInError) throw e; // 404 = no attempts
  }
  let group = false;
  const cid = contentId ?? column.contentId;
  if (cid) {
    try {
      group = ((await bbGet(`/learn/api/public/v1/courses/${courseId}/contents/${cid}/groups`)).results || []).length > 0;
    } catch (e) {
      if (e instanceof NotLoggedInError) throw e;
    }
  }
  const shown = grade?.displayGrade?.text ?? (grade?.displayGrade?.score != null ? String(grade.displayGrade.score) : null) ?? (grade?.score != null ? String(grade.score) : null);
  const done = attempts.filter((a) => SUBMITTED_ATTEMPT.has(a.status));
  const submittedAt = done.map((a) => a.attemptDate || a.created).sort().pop() ?? null;
  let status;
  if (shown != null && shown !== "") status = "graded";
  else if (done.length) status = "submitted";
  else if (attempts.some((a) => a.status === "InProgress")) status = "draft";
  else status = "not_submitted";
  const label = {
    graded: "Graded",
    submitted: "Submitted (awaiting grade)",
    draft: "Draft saved, NOT submitted",
    not_submitted: group ? "Not submitted (group assignment: one member submits for the group)" : "Not submitted",
  }[status];
  return { status, label, submittedAt, grade: shown, group, attemptCount: attempts.length };
}

let meCache = null;
export async function getMe() {
  if (!meCache) meCache = await bbGet("/learn/api/public/v1/users/me");
  return meCache;
}

const termNames = new Map();
async function termName(termId) {
  if (!termId) return undefined;
  if (!termNames.has(termId)) {
    termNames.set(termId, bbGet(`/learn/api/public/v1/terms/${termId}`).then((t) => t.name).catch(() => undefined));
  }
  return termNames.get(termId);
}

export async function getCourses({ includeUnavailable = false } = {}) {
  const me = await getMe();
  const memberships = await bbGetAll(`/learn/api/public/v1/users/${me.id}/courses`, { expand: "course", limit: 100 });
  const courses = memberships
    .filter((m) => m.course && (includeUnavailable || (m.availability?.available !== "No" && m.course.availability?.available !== "No")))
    .map((m) => ({
      id: m.course.id,
      courseId: m.course.courseId,
      name: m.course.name,
      role: m.courseRoleId,
      termId: m.course.termId,
      created: m.course.created,
      url: m.course.externalAccessUrl,
      lastAccessed: m.lastAccessed,
    }));
  await Promise.all(courses.map(async (c) => (c.term = await termName(c.termId))));
  return courses;
}

// ~/.blackboard-mcp/semester.json lists the module codes being taken right now (see semester.example.json).
const SEMESTER_FILE = path.join(DATA_DIR, "semester.json");
export function getSemesterModules() {
  return readJson(SEMESTER_FILE)?.modules ?? null;
}

/**
 * This semester's courses: those listed in semester.json, or else everything in the
 * newest term (the term of the most recently created course).
 */
export async function getCurrentCourses() {
  const all = await getCourses();
  const modules = getSemesterModules();
  if (modules?.length) return all.filter((c) => modules.some((m) => c.courseId?.toUpperCase().startsWith(m.toUpperCase())));
  const newest = all.reduce((a, b) => (Date.parse(b.created) > Date.parse(a?.created ?? 0) ? b : a), null);
  return newest?.termId ? all.filter((c) => c.termId === newest.termId) : all;
}
