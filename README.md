# blackboard-mcp

**A Claude desktop extension that keeps Trinity College Dublin students on top of their deadlines.**

It connects Claude to your TCD Blackboard (read-only, with your own login) and reads *everything* in your modules: course pages, slide decks, PDFs, Word docs, assignment instructions, announcements, the gradebook and lecturers' own module websites. Many deadlines only appear in a module outline or a slide, never in the Blackboard calendar. Claude finds them, builds a week-by-week deadline tracker for the whole term, can put every deadline on your Google Calendar with the details, and re-checks it all every morning.

> Unofficial student project. Not affiliated with, or endorsed by, Trinity College Dublin or Anthology (Blackboard). Use it in line with College IT policies.

## What you get

- **A week-by-week tracker page** for the whole term (Week 1 → study week → exams), past weeks included. Each deadline shows its weight, what to submit, rules (GenAI, late penalties) and where the info came from. Tick things off as you go.
- **True submission status.** It checks your actual Blackboard submissions, not the gradebook's status label, which shows placeholders for group work before anyone has submitted.
- **Deadlines from everywhere:** gradebook items, assignment instructions, outlines, intro slides, announcements, schedule tables that are only pictures, group lists (to find your group and presentation week), and module websites outside Blackboard.
- **Google Calendar (optional):** every deadline as an event with reminders and a full description; midterms and assessed tutorials in their real time slots.
- **A daily check:** each morning it rescans, updates the tracker and calendar, verifies every status against Blackboard, and gives you a short rundown.

## What you need

- The **Claude desktop app** for Windows or macOS (https://claude.ai/download)
- **Microsoft Edge** (built into Windows) **or Google Chrome**, used only for the Blackboard sign-in window. On a Mac, Safari won't work, so install [Chrome](https://www.google.com/chrome/) if you don't have it.
- A **TCD Blackboard** account
- Optional: the **Google Calendar** connector in Claude, for calendar sync

No git, Node.js or terminal is needed: Claude runs the extension with its own built-in Node.

## Install

1. Download **[blackboard-mcp.mcpb](https://github.com/bolgerru/blackboard-mcp/releases/latest/download/blackboard-mcp.mcpb)** from the latest release (about 7 MB).
2. Double-click it. Claude opens and asks you to install the extension, so click **Install**. (Or drag the file onto Claude's **Settings → Extensions** page.)
3. Open the **Code** tab in Claude and say:

   > **Set up my Blackboard deadline tracker**

Claude walks you through it:

1. A browser window opens on TCD Blackboard, and you sign in as usual. Claude never sees your password.
2. You pick this semester's modules.
3. It confirms the term weeks from the TCD academic calendar.
4. It scans everything (10–20 minutes the first time).
5. It builds your tracker page, and optionally your Google Calendar events.
6. It schedules the daily check at a time you choose.

After that, the daily check runs on its own, or you can say **"check Blackboard"** any time.

To update, download the newest `.mcpb` and install it the same way. Your settings and login are kept.

## Day to day

- **Tick "Done"** on the tracker when you finish something.
- **"Log me into Blackboard"**: TCD sessions expire after a few hours. The tool usually signs back in silently using your saved browser profile, and asks you only if that fails.
- **"Switch to semester 2"** in January.
- The daily check runs while your computer is on and Claude is open. If it's closed at the scheduled time, the check runs when you next open Claude. It can't run in the cloud, because your login lives on your computer.

## Privacy and safety

- **Read-only.** The Blackboard tools only read. Nothing is ever submitted, posted or changed.
- **Your login stays on your computer** in `~/.blackboard-mcp/` (session cookies and a browser profile, so treat that folder like a password). Delete the folder to sign out completely.
- **Scanned course files stay on your computer** in `~/.blackboard-mcp/data/`. Nothing from your modules is put in this repo.
- The tracker page is a private Artifact in your own Claude account, and calendar events go only to your own calendar.

## How it works

| Part | What it does |
| --- | --- |
| `src/server.mjs` | The MCP server. It provides live Blackboard tools (`list_courses`, `get_due_items`, `get_content_item`, `get_announcements`, `get_grades`, `get_timetable`, …), scan tools (`scan_blackboard`, `scan_status`, `find_deadline_text`, `extract_images`, `verify_tracker`), and setup tools (`blackboard_login`, `blackboard_status`, `save_settings`, `get_tracker_page`, `blackboard_guide`). |
| `src/blackboard.mjs` | Reuses your browser login for read-only calls to Blackboard's REST API (the same calls the Blackboard website makes), with silent re-login. Submission status comes from your attempts, not the gradebook label. |
| `src/scan.mjs`, `src/extract.mjs` | Incremental scan of this semester's modules into `~/.blackboard-mcp/data/`, with text and images from PDF, PowerPoint, Word, Excel, OpenDocument and embedded pages |
| `src/verify.mjs`, `src/corpus.mjs` | Cross-check the tracker against Blackboard, search for deadline text, and pull out schedule pictures |
| `guides/` | The setup and daily-check instructions Claude follows, plus the reference with every rule (served by `blackboard_guide`) |
| `tracker/deadline-tracker.html` | The tracker page (a private Artifact with its own small database) |
| `manifest.json` | The desktop extension manifest. `npm run pack` builds `dist/blackboard-mcp.mcpb`. |
| `.claude-plugin/`, `skills/`, `bin/` | The Claude Code plugin version (see below) |

Settings: `BB_URL` (default `https://tcd.blackboard.com`), `BB_BROWSER` (`msedge` or `chrome`), `BB_DATA_DIR` (default `~/.blackboard-mcp`).

## For Claude Code CLI users

If you use Claude Code in a terminal rather than the desktop app, install the plugin version instead. It needs git and Node.js 18+:

```text
/plugin marketplace add bolgerru/blackboard-mcp
/plugin install blackboard-mcp@blackboard-mcp
```

Restart Claude (the first start installs packages, about a minute), then say "Set up my Blackboard deadline tracker". Don't install both the extension and the plugin, or you'll get two copies of the Blackboard tools.

## Building the extension

```bash
npm ci
npm run pack   # validates manifest.json and writes dist/blackboard-mcp.mcpb
```
