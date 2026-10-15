---
name: blackboard-daily-check
description: Run the daily Blackboard deadline check for a TCD student. Rescans their Blackboard modules (pages, slides, PDFs, announcements, gradebook, assignment instructions) and module websites, updates their deadline tracker and Google Calendar, verifies every status against real submissions, and gives a short rundown. Use when the user says "check Blackboard", "what's due", "update my deadlines/tracker", "morning check", or when a scheduled task asks for the daily check. Requires setup to have been done once.
---

# Daily Blackboard deadline check

The instructions for the daily check come from the Blackboard server itself, so this plugin and the desktop extension always follow the same steps.

1. Call the Blackboard server's `blackboard_guide` tool with topic `daily`. Its full name is `mcp__plugin_blackboard-mcp_blackboard__blackboard_guide` when installed as this plugin (load it with ToolSearch if it's deferred).
2. Follow that guide exactly. It tells you when to read the `reference` guide too.

If the Blackboard tools aren't available, the server isn't running: ask the student to restart Claude (its first start installs packages, which takes about a minute) or run `/mcp` and reconnect `blackboard`.
