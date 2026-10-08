// Admin desk calls unplaced sign-ups Reserve Players.
// Run: `node server/reserve-players.test.js`
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const parsed = spawnSync(process.execPath, ["--check", path.join(root, "public/app.js")], { encoding: "utf8" });
check("app.js parses", parsed.status === 0);
check("reserve players panel title", appJs.includes('title: "Reserve Players"'));
check("reserve players count label", appJs.includes('"RESERVE PLAYERS"'));
check("old pending sign-up labels are gone", !appJs.includes("Pending sign-ups") && !appJs.includes("PENDING SIGN-UPS"));
check("the panel is still the pending sign-ups fold", appJs.includes('id: "pending-signups"'));

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll reserve player label checks passed.");
