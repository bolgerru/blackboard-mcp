#!/usr/bin/env node
// Sign in from a terminal instead of through Claude:  npm run login -- https://blackboard.myschool.edu

import { getBaseUrl, interactiveLogin, setBaseUrl } from "./blackboard.mjs";

const url = process.argv[2];
if (url) setBaseUrl(url);
if (!getBaseUrl()) {
  console.error("Usage: npm run login -- https://blackboard.yourschool.edu");
  process.exit(1);
}

console.log(`Opening ${getBaseUrl()} — sign in in the browser window that appears...`);
try {
  const me = await interactiveLogin();
  console.log(`Signed in as ${me.userName}. Session saved.`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
