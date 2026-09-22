// Owner desk Manage fixtures / Overwrite stats are collapsed dropdowns.
// Run: `node server/desk-folds.test.js`
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJsPath = path.join(root, "public/app.js");
const appJs = fs.readFileSync(appJsPath, "utf8");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const parsed = spawnSync(process.execPath, ["--check", appJsPath], { encoding: "utf8" });
check("app.js parses", parsed.status === 0);
if (parsed.status !== 0 && parsed.stderr) console.error(parsed.stderr);

check("Manage fixtures is a collapsed desk fold", appJs.includes('id: "manage-fixtures"') && appJs.includes("manageFixturesDesk") && appJs.includes("data-manage-league-id"));
check("Manage fixtures groups matches by league", appJs.includes("fixturesGroupedByLeague") && appJs.includes("Open a league to skip accept"));
check("skip-accept still exists inside the fold", appJs.includes("SKIP ACCEPT (THIS MATCH)") && appJs.includes("CLEAR FIXTURES"));
check("Overwrite stats uses league and match selects", appJs.includes('data-act="override-league"') && appJs.includes('data-act="override-match"') && appJs.includes("overwriteStatsDesk"));
check("Overwrite stats does not dump every match as chips", !appJs.includes("statsDesk(d.fixtures, state.selectedResultId") && appJs.includes("hidePicker: true"));
check("Approve match stats still uses the waiting-list picker", appJs.includes("statsDesk(review, state.selectedResultId"));
check("Head Admin override title is still used", appJs.includes("Override another admin"));

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll desk-fold checks passed.");
