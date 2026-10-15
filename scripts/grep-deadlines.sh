#!/usr/bin/env bash
# Usage: scripts/grep-deadlines.sh ~/.blackboard-mcp/data/corpus/<course folder>
# Prints deadline-ish lines from every extracted file, then all item and announcement text and the gradebook.
dir="$1"
pat='\bdue\b|deadline|submi(t|ssion)|\bexam(s|ination)?\b|quiz|mid-?term|in-class|class test|\btest (on|in|will)|assessment|assignment|presentation|essay|% of (the )?(final|module|overall|grade|mark)|marks? (for|of|available)|late (submission|penalt)|extension|hand(ed)? ?in\b|turnitin|\bmcq|problem set|lab report|coursework|continuous assessment|reading week'
for f in "$dir"/files/*.txt; do
  [ -f "$f" ] || continue
  hits=$(grep -inE -A1 "$pat" "$f" | grep -v '^--$' | cut -c1-240)
  [ -n "$hits" ] && printf '\n### %s\n%s\n' "$(head -1 "$f" | sed 's/^# //')" "$hits"
done
node -e '
const fs=require("fs"),p=process.argv[1];
for (const f of ["content.json","announcements.json"]) {
  if (!fs.existsSync(p+"/"+f)) continue;
  for (const i of JSON.parse(fs.readFileSync(p+"/"+f,"utf8"))) {
    const t=[i.text, i.instructions && "INSTRUCTIONS: "+i.instructions].filter(Boolean).join("\n"); if (!t) continue;
    console.log(`\n[${f.replace(".json","")}] ${i.location||i.title} ${i.posted?"("+i.posted.slice(0,10)+")":""}\n${t.slice(0,1800)}`);
  }
}
if (fs.existsSync(p+"/gradebook.json")) { const g=JSON.parse(fs.readFileSync(p+"/gradebook.json","utf8")); if (g.length) console.log("\n[gradebook]\n"+g.map(c=>`- ${c.name} | due ${c.due||"-"} | ${c.points??""}pts | content ${c.contentId||"-"}`).join("\n")); }
' "$dir"
