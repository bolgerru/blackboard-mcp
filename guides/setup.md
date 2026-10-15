# Set up the Blackboard deadline tracker

You're setting this up for a TCD student who may not be technical. Keep messages short and plain. Explain what's happening in a line before each step that takes a while or needs them. Let them make every choice. Read the reference first (`blackboard_guide` with topic `reference`): setup ends with a full first run of the daily check, and the rules there apply.

Everything happens through the Blackboard tools. Never ask the student to open a terminal or install anything except, if needed, a browser.

## 1. Check the basics

Call `blackboard_status`.
- It needs Microsoft Edge (built into Windows) or Google Chrome for the sign-in window. Safari can't be used, so most Mac users need Chrome. If `browser` says neither was found, ask them to install Chrome (https://www.google.com/chrome/), then continue. They don't need to use it day to day: it only opens for signing in.
- If `semester` and `tracker` are already set, setup was done before: ask whether they want to redo it or switch semester (see the end).

## 2. Sign in to Blackboard

Tell them a browser window will open on TCD Blackboard. They sign in there themselves as usual (Microsoft/TCD login and two-factor), and the window closes on its own. Then call `blackboard_login`. Never ask for or handle their password. The tools are read-only.

## 3. Choose this semester's modules

Call `list_courses` (current year). Ask which modules they're taking **this semester**, as a multi-select question. TCD modules usually come in A/B pairs or semester-specific codes, and a module with no content yet is often next semester, but let them decide. Save with `save_settings`:

```json
{ "semester": { "name": "Semester 1 (Michaelmas) 2026/27", "modules": ["ECU33051", "CSU33012"], "nextSemester": ["ECU33052"] } }
```

Use module codes without the year suffix (`ECU33051`, not `ECU33051-202627`).

## 4. Term weeks

Fetch https://www.tcd.ie/calendar/academic-year-structure/ to get the current semester's teaching weeks, study week, revision week and exam session. Build the `term.weeks` list: Week 1 to Week 12, then "Revision week", then "Exams" with an explicit `end`. Give special weeks a `name`, e.g. `{label: "Week 7", name: "Study week", start: "2026-10-26"}` (Week 7 is usually the study/reading week). Each `start` is the Monday (YYYY-MM-DD). Show them the list and ask them to confirm. If the page can't be read, ask them for the first Monday of teaching. Module schedules often confirm the dates too (a syllabus listing "Week 1 14-Sept", or "Study Week 26-Oct").

## 5. First full scan

Tell them it reads every page, slide deck, PDF and announcement in their modules, so it takes a while (often 10–20 minutes), and they can leave it running. Call `scan_blackboard`, then check `scan_status` every minute or so until it's `done`. Mention progress now and then (which module it's on). Call `scan_blackboard` again if `problems` lists network errors.

## 6. Tracker page

The tracker is an Artifact page with its own small database. It needs the Artifact tools (the Claude desktop app's Code tab has them).
- If the `Artifact` tool is available: call `get_tracker_page` with `save_to_folder` set to your scratchpad (or working) directory. It writes `deadline-tracker.html` there. Publish that file with `capabilities: {"db": {}}`, icon `calendar`, and a one-line description. Load the `artifact-capabilities` skill first if the session asks for it. The page is private to them.
- If not: tell them the tracker page needs the Claude desktop app. The deadlines will still be in their rundowns (and calendar), and the rest of setup still works. Skip the database steps.

Save with `save_settings`: `{ "tracker": { "trackerUrl": "https://claude.ai/artifact/…", "calendarId": null, "timeZone": "Europe/Dublin", "dailyTime": "08:00" } }`.

Then `set` `meta/status` with `term` from step 4, empty `changes`, and `keyDates` for the study week and exam period.

## 7. Google Calendar (optional)

Ask if they want deadlines on their Google Calendar. If yes and a Google Calendar connector is available, use `list_calendars` and use their primary calendar (or a separate one if they prefer), then save its id as `tracker.calendarId` (with `save_settings`) and in `meta/status.calendar`. If no connector is connected, offer the connector (search the MCP registry for "Google Calendar" and suggest it), or skip.

## 8. Build the tracker: a full first pass

Follow the daily check (`blackboard_guide` with topic `daily`), steps 2–6, but treat **everything** as changed. For every module:
- call `find_deadline_text` and read all of it, including instructions, announcements and the gradebook
- read outlines, housekeeping and intro slides, and syllabi in full for the assessment breakdown (`get_content_item`, or the text in `find_deadline_text`)
- check schedule images with `extract_images` (reference: "Schedules can be pictures")
- find the student's name in group lists, and record their groups and presentation weeks in the notes
- note any module websites in the notes, and fetch them
- include past deadlines from earlier weeks too, plus `keyDates` notes for past cancellations and extensions. The week view shows the whole term.

Save what you found with `save_settings` (`notes`, starting with a short header: "Personal notes for the daily check: groups, module websites, quirks"). Verify until `ok` is true.

## 9. Daily check

Ask what time they'd like the daily check (default 08:00) and whether weekends too.
- If the scheduled-tasks tools are available (Claude desktop app): create a recurring task titled "Morning Blackboard deadline check" with the prompt: "Run my daily Blackboard deadline check: call the Blackboard server's blackboard_guide tool with topic 'daily' and follow it exactly, then give me the short rundown." Tell them it runs while their computer is on and Claude is open, and catches up when they next open it. It can't run in the cloud, because the Blackboard login lives on their computer.
- Otherwise: they can say "check Blackboard" any time.

## 10. Wrap up

Give them the tracker link, what's due in the next week (what's not submitted first), and how it works from now on: tick "Done" on the tracker when they finish something, say "log me into Blackboard" if a rundown says the login expired, and say "switch to semester 2" in January.

## Switching semester

Update the semester with `save_settings` (`modules` ← the new semester's codes), rebuild `term` for the new semester (step 4), set `hidden: true` on the old semester's rows, keep the old `keyDates` out of the new term, and do a full first pass (step 8).
