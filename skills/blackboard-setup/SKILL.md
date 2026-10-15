---
name: blackboard-setup
description: One-time setup of the Blackboard deadline tracker for a Trinity College Dublin student. Signs them in to TCD Blackboard, picks this semester's modules, does a full first scan of every module (pages, slides, PDFs, announcements, gradebook), builds their week-by-week deadline tracker page, optionally adds everything to Google Calendar, and schedules the daily check. Use when the user says "set up Blackboard", "set up my deadline tracker", "connect my Blackboard", or when blackboard_status shows no semester or tracker settings. Also use to switch to a new semester.
---

# Set up the Blackboard deadline tracker

You're setting this up for a TCD student who may not be technical. Keep messages short and plain. Explain what's happening in a line before each step that takes a while or needs them. Let them make every choice. Read [../blackboard-daily-check/reference.md](../blackboard-daily-check/reference.md) first: setup ends with a full first run of the daily check, and the rules there apply.

## 1. Check the basics

1. `node --version` must be 18 or newer. If Node is missing, tell them to install the LTS version from https://nodejs.org and restart Claude.
2. A Chromium browser is needed for signing in: Microsoft Edge (built into Windows) or Google Chrome. On a Mac without Chrome, set the `BB_BROWSER` environment variable to `chrome` after installing Chrome.
3. Call `mcp__blackboard__blackboard_status`.
   - If the `blackboard` tools don't exist, the plugin's MCP server isn't running. Its first start installs packages, which can take a minute. Run `node "<plugin folder>/bin/start.mjs" --install-only` (the plugin folder is two levels above this skill's base directory), then ask them to restart Claude, or run `/mcp` and reconnect `blackboard`, and come back.
   - Note `pluginDir`, `scripts`, `dataDir` and `corpusDir` from the result for the later steps.

## 2. Sign in to Blackboard

Tell them a browser window will open on TCD Blackboard. They sign in there themselves as usual (Microsoft/TCD login and two-factor), and the window closes on its own. Then call `mcp__blackboard__blackboard_login`. Never ask for or handle their password. The tools are read-only.

## 3. Choose this semester's modules

Call `mcp__blackboard__list_courses` (current year). Ask which modules they're taking **this semester**, as a multi-select question. TCD modules usually come in A/B pairs or semester-specific codes, and a module with no content yet is often next semester, but let them decide. Write `<dataDir>/semester.json`:

```json
{ "name": "Semester 1 (Michaelmas) 2026/27", "modules": ["ECU33051", "CSU33012"], "nextSemester": ["ECU33052"] }
```

Use module codes without the year suffix (`ECU33051`, not `ECU33051-202627`).

## 4. Term weeks

Fetch https://www.tcd.ie/calendar/academic-year-structure/ to get the current semester's teaching weeks, study week, revision week and exam session. Build the `term.weeks` list: Week 1 … Week 12 (Week 7 is usually the study/reading week, labelled e.g. "Week 7 · Study Week"), then "Revision week", then "Exams" with an explicit `end`. Each `start` is the Monday (YYYY-MM-DD). Show them the list and ask them to confirm. If the page can't be read, ask them for the first Monday of teaching. Module schedules in the scan often confirm the dates too (a syllabus listing "Week 1 14-Sept", or "Study Week 26-Oct").

## 5. First full scan

Tell them it reads every page, slide deck, PDF and announcement in their modules, so it takes a while (often 10–20 minutes), and they can leave it running. Run `node "<scripts.scan>"` in the background and wait for it. Re-run it if `problems` lists network errors.

## 6. Tracker page

The tracker is an Artifact page with its own small database, which needs the claude.ai Artifacts tools (available in the Claude desktop app).
- If the `Artifact` tool is available: publish `<scripts.trackerPage>` with `capabilities: {"db": {}}`, icon `calendar`, and a one-line description. Load the `artifact-capabilities` skill first if the session asks for it. The page is private to them.
- If not: tell them the tracker page needs the Claude desktop app. The deadlines will still be in their rundowns (and calendar), and the rest of setup still works. Skip the database steps.

Write `<dataDir>/tracker.json`:

```json
{ "trackerUrl": "https://claude.ai/artifact/…", "calendarId": null, "timeZone": "Europe/Dublin", "dailyTime": "08:00" }
```

Then `set` `meta/status` with `term` from step 4, empty `changes`, and `keyDates` for the study week and exam period.

## 7. Google Calendar (optional)

Ask if they want deadlines on their Google Calendar. If yes and a Google Calendar connector is available, use `list_calendars` and use their primary calendar (or a separate one if they prefer), then save its id as `calendarId` in tracker.json and `meta/status.calendar`. If no connector is connected, offer the connector (search the MCP registry for "Google Calendar" and suggest it), or skip.

## 8. Build the tracker: a full first pass

Do the `blackboard-daily-check` skill's steps 2–6, but treat **everything** as changed. For every module:
- run grep-deadlines and read all of it, including instructions, announcements and the gradebook
- read outlines, housekeeping and intro slides, and syllabi in full for the assessment breakdown
- check schedule images (reference.md: "Schedules can be pictures")
- find the student's name in group lists, and record their groups and presentation weeks in NOTES.md
- note any module websites in NOTES.md, and fetch them
- include past deadlines from earlier weeks too, plus `keyDates` notes for past cancellations and extensions. The week view shows the whole term.

Create `<dataDir>/NOTES.md` with a short header ("Personal notes for the daily check: groups, module websites, quirks") and what you found. Verify until `"ok": true`.

## 9. Daily check

Ask what time they'd like the daily check (default 08:00) and whether weekends too.
- If the `scheduled-tasks` tools are available (Claude desktop app): create a recurring task with title "Morning Blackboard deadline check" and the prompt: "Use the blackboard-daily-check skill to run my daily Blackboard deadline check, then give me the rundown." Tell them it runs while their computer is on and Claude is open, and catches up when they next open it. It can't run in the cloud, because the Blackboard login lives on their computer.
- Otherwise: they can say "check Blackboard" any time, or schedule `claude -p "Use the blackboard-daily-check skill"` with Windows Task Scheduler or cron.

## 10. Wrap up

Give them the tracker link, what's due in the next week (what's not submitted first), and how it works from now on: tick "Done" on the tracker when they finish something, say "log me into Blackboard" if a rundown says the login expired, and say "switch to semester 2" in January (re-run steps 3, 4, 8, and hide last semester's rows).

## Switching semester

Update semester.json (`modules` ← the new semester's codes), rebuild `term` for the new semester (step 4), set `hidden: true` on the old semester's rows, keep the old `keyDates` out of the new term, and do a full first pass (step 8).
