---
name: blackboard-setup
description: One-time setup of the Blackboard deadline tracker for a Trinity College Dublin student. Signs them in to TCD Blackboard, picks this semester's modules, does a full first scan of every module (pages, slides, PDFs, announcements, gradebook), builds their week-by-week deadline tracker page, optionally adds everything to Google Calendar, and schedules the daily check. Use when the user says "set up Blackboard", "set up my deadline tracker", "connect my Blackboard", or when blackboard_status shows no semester or tracker settings. Also use to switch to a new semester.
---

# Set up the Blackboard deadline tracker

The instructions for the first-time setup come from the Blackboard server itself, so this plugin and the desktop extension always follow the same steps.

1. Call the Blackboard server's `blackboard_guide` tool with topic `setup`. Its full name is `mcp__plugin_blackboard-mcp_blackboard__blackboard_guide` when installed as this plugin (load it with ToolSearch if it's deferred).
2. Follow that guide exactly. It tells you when to read the `reference` guide too.

If the Blackboard tools aren't available, the server isn't running: ask the student to restart Claude (its first start installs packages, which takes about a minute) or run `/mcp` and reconnect `blackboard`.
