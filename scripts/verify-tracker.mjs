#!/usr/bin/env node
// Command-line wrapper around src/verify.mjs (the MCP server's verify_tracker tool does the same).
//
//   1. Save the tracker rows: ArtifactData list (collection "deadlines", limit 1000, out_dir "~/.blackboard-mcp/data/db-snapshot")
//   2. node scripts/verify-tracker.mjs [snapshot dir]
//
// Exit code 1 if anything needs fixing.

import path from "node:path";
import { verifyTracker } from "../src/verify.mjs";

const result = process.argv[2] ? verifyTracker(path.resolve(process.argv[2])) : verifyTracker();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
