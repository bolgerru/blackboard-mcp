---
name: blackboard-daily-check
description: Run the daily Blackboard deadline check for a TCD student. Rescans their Blackboard modules (pages, slides, PDFs, announcements, gradebook, assignment instructions) and module websites, updates their deadline tracker and Google Calendar, verifies every status against real submissions, and gives a short rundown. Use when the user says "check Blackboard", "what's due", "update my deadlines/tracker", "morning check", or when a scheduled task asks for the daily check. Requires the blackboard-setup skill to have been run once.
---

# Daily Blackboard deadline check

Keep the student's deadline tracker exactly right: every deadline in this semester's modules, with true submission status, on the tracker page and (if set up) their Google Calendar. Then tell them what matters.

**Read [reference.md](reference.md) before writing anything.** It has the database layout, the status rules, where deadlines hide, and the calendar rules. Each rule is there because something went wrong without it.

## 0. Orient

1. Call `mcp__blackboard__blackboard_status`. It gives `pluginDir`, the script paths, `dataDir`, `corpusDir`, `semester`, `tracker` and `notesFile`, and whether the login works.
   - If `semester` or `tracker` is missing, setup hasn't been done. Use the `blackboard-setup` skill instead.
   - If the `blackboard` tools aren't available at all, tell the student the Blackboard server isn't connected and that they can restart Claude or check `/mcp`.
2. Read `notesFile` (the student's NOTES.md). It has their groups, module websites and per-module quirks.
3. Load ArtifactData (and the Google Calendar tools, if `tracker.calendarId` is set) with ToolSearch if they're deferred.

## 1. Scan

Run `node "<scripts.scan>"` and give it up to 15 minutes (run it in the background and wait if needed). It prints JSON: `courses`, `changes` (new or updated items, files, announcements, gradebook items, due-date changes, "submission status changed", "grade released") and `problems`. If problems are network errors, run it again: it only re-fetches what's missing.

If it reports a login error, the session expired and silent re-login failed. In an interactive session, call `mcp__blackboard__blackboard_login` (a window opens for the student to sign in) and rescan. In a scheduled run with nobody there, skip to step 5 with the existing data, and start the summary and rundown with: "Couldn't sign in to Blackboard. Open Claude and say 'log me into Blackboard', then I'll catch up."

## 2. Find what changed

For every entry in `changes`, open the relevant record in `<corpusDir>/<course>/` (the content.json item including its `instructions`, the announcement, or `files/*.txt`) and look for anything deadline-related: new or moved dates, extensions, new assignments, quizzes, tests, presentations, weightings, submission instructions, cancellations, groups, exam timetables. Follow "Finding deadlines that aren't in the gradebook" in reference.md, including the image check for schedules and fetching every module website listed in NOTES.md.

Then call `mcp__blackboard__get_due_items` with `days_ahead` 110 and `days_overdue` 30 for current submission statuses.

## 3. Update the tracker

ArtifactData list `deadlines` (limit 1000), then one or more batches:
- `update` (with `if_version`) rows whose date, status, grade or notes changed. Status for rows with a `columnId` comes from that column's `submission` in `gradebook.json`. Never write `done`.
- `set` new rows (check for duplicates first, include `columnId`/`courseId` or `weekOf` where they apply).
- `hidden: true` for cancelled or duplicate rows. Set `updatedAt` on every row you change.

## 4. Update Google Calendar (only if `tracker.calendarId` is set)

Follow the calendar rules in reference.md: create events for new dated rows (save `calendarEventId`), update events whose row changed or was ticked `done`, delete events of rows that became hidden. Only touch events whose ids are in the tracker.

## 5. Verify (required)

Delete `<dataDir>/data/db-snapshot`, save the rows with ArtifactData list (`out_dir` `<dataDir>/data/db-snapshot`), run `node "<scripts.verify>"`. Fix every problem and re-run until `"ok": true`.

## 6. Status and notes

`update` `meta/status` (with `if_version`): `lastUpdated`, `coverage`, `summary` (overdue, next 3 days saying clearly what's NOT submitted, anything urgent), `changes`. Append `keyDates` notes (`kind: "note"`) for cancellations, extensions, releases and notable announcements. Never remove past ones, and don't touch `term`. Add anything module-specific you learned to NOTES.md.

## 7. Rundown

Reply briefly and scannably, with dates in Irish time ("Fri 16 Oct, 21:00"):
- due today and tomorrow, then the rest of this week, marking what's not submitted
- anything overdue and not submitted
- what changed since last time (new deadlines, moved dates, grades released, calendar events added or moved)
- whether verification passed, and anything you couldn't check
- the tracker link (`tracker.trackerUrl`)

Rules: never submit, post or change anything on Blackboard; the tools are read-only, and so are you there. Never invent deadlines. Never mark something submitted without proof from the attempts data or the student. Never read, print or share `session.json` or the browser profile.
