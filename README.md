# blackboard-mcp

**A Claude plugin that keeps Trinity College Dublin students on top of their deadlines.**

It connects Claude to your TCD Blackboard (read-only, with your own login) and reads *everything* in your modules: course pages, slide decks, PDFs, Word docs, assignment instructions, announcements, the gradebook and lecturers' own module websites. Many deadlines only appear in a module outline or a slide, never in the Blackboard calendar. Claude finds them, builds a week-by-week deadline tracker for the whole term, can put every deadline on your Google Calendar with the details, and re-checks it all every morning.

> Unofficial student project. Not affiliated with, or endorsed by, Trinity College Dublin or Anthology (Blackboard). Use it in line with College IT policies.

## What you get

- **A week-by-week tracker page** for the whole term (Week 1 → study week → exams), past weeks included. Each deadline shows its weight, what to submit, rules (GenAI, late penalties) and where the info came from. Tick things off as you go.
- **True submission status.** It checks your actual Blackboard submissions, not the gradebook's status label, which shows placeholders for group work before anyone has submitted.
- **Deadlines from everywhere:** gradebook items, assignment instructions, outlines, intro slides, announcements, schedule tables that are only pictures, group lists (to find your group and presentation week), and module websites outside Blackboard.
- **Google Calendar (optional):** every deadline as an event with reminders and a full description; midterms and assessed tutorials in their real time slots.
- **A daily check:** each morning it rescans, updates the tracker and calendar, verifies every status against Blackboard, and gives you a short rundown.

## Requirements

- **Claude desktop app** (Claude Code) on Windows or macOS. The tracker page and the daily schedule use the desktop app's Artifacts and scheduled tasks. The Blackboard tools also work in the Claude Code CLI.
- **Node.js 18+**: https://nodejs.org (LTS)
- **Microsoft Edge or Google Chrome**, used only for the sign-in window
- A **TCD Blackboard** account
- Optional: the **Google Calendar** connector in Claude

## Install

In Claude Code, run:

```text
/plugin marketplace add bolgerru/blackboard-mcp
/plugin install blackboard-mcp@blackboard-mcp
```

Restart Claude (the first start installs the plugin's packages, about a minute), then say:

> **Set up my Blackboard deadline tracker**

Claude walks you through it:

1. A browser window opens on TCD Blackboard, and you sign in as usual. Claude never sees your password.
2. You pick this semester's modules.
3. It confirms the term weeks from the TCD academic calendar.
4. It scans everything (10–20 minutes the first time).
5. It builds your tracker page, and optionally your Google Calendar events.
6. It schedules the daily check at a time you choose.

After that, the daily check runs on its own, or you can say **"check Blackboard"** any time.

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
| `src/server.mjs` | MCP server: `blackboard_login`, `blackboard_status`, `list_courses`, `get_due_items`, `get_timetable`, `list_course_content`, `get_content_item`, `get_announcements`, `get_grades`, `blackboard_api_get` |
| `src/blackboard.mjs` | Reuses your browser login for read-only calls to Blackboard's REST API (the same calls the Blackboard website makes), with silent re-login. Submission status comes from your attempts. |
| `scripts/scan.mjs` | Incremental full scan of this semester's modules into `~/.blackboard-mcp/data/corpus/`, including text from PPTX, PDF, DOCX and embedded pages |
| `scripts/verify-tracker.mjs` | Cross-checks every tracker row against the scan (due dates, real submission status, untracked items) |
| `scripts/grep-deadlines.sh`, `scripts/extract-images.mjs` | Help Claude find deadlines in text and in schedule tables that are images |
| `tracker/deadline-tracker.html` | The tracker page (an Artifact with its own small database) |
| `skills/blackboard-setup` | The one-time setup walkthrough |
| `skills/blackboard-daily-check` | The daily routine, plus `reference.md` with every rule it follows |

Settings: `BB_URL` (default `https://tcd.blackboard.com`), `BB_BROWSER` (`msedge` or `chrome`), `BB_DATA_DIR` (default `~/.blackboard-mcp`).

## Without the plugin system

```bash
git clone https://github.com/bolgerru/blackboard-mcp
cd blackboard-mcp
npm ci
claude mcp add blackboard -s user -- node "$PWD/bin/start.mjs"
```

Then copy the two folders in `skills/` into `~/.claude/skills/` and say "Set up my Blackboard deadline tracker".
