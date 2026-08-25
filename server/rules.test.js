// Asserts the Rules tab serves the full TSH regulations with no WDL copy.
// Run: `node server/rules.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANNED = /World Darts League|\bWDL\b|worlddartsleagueinfo/i;
const REQUIRED_TITLES = [
  "ACCEPTANCE OF TERMS",
  "PLAYER REGISTRATION & SEASON COMMITMENT",
  "PLAYER VERIFICATION (DARTCOUNTER)",
  "FIXTURES & SCHEDULING",
  "MATCH FORMAT",
  "POINTS ALLOCATION",
  "MATCH START & ATTENDANCE",
  "DIVISIONS, PROMOTION & RELEGATION",
  "CAMERA & MATCH VISIBILITY REQUIREMENTS",
  "SCORING REQUIREMENTS",
  "MATCH EVIDENCE & RESULT SUBMISSION",
  "COMMUNICATION & CONDUCT",
  "WEBSITE REQUIREMENT",
  "FAIR PLAY & INTEGRITY",
  "MATCH COMPLETION & ABANDONMENT",
  "MATCH INTERRUPTIONS",
  "TECHNICAL ISSUES",
  "CHEATING & MATCH CONDUCT",
  "DISCIPLINARY SYSTEM",
  "LEAGUE INTEGRITY & PARTICIPATION",
  "ADMINISTRATIVE AUTHORITY",
  "RULE AMENDMENTS",
  "FINAL PROVISION",
];

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

async function waitHealth(port, child) {
  const deadline = Date.now() + 15000;
  let lastErr;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastErr || new Error("server did not become healthy");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-rules-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitHealth(port, child);
  const res = await fetch(`http://127.0.0.1:${port}/api/rules`);
  const data = await res.json();
  check("rules API ok without login", res.ok && data.ok);
  check("23 top-level sections", Array.isArray(data.sections) && data.sections.length === 23);
  const titles = (data.sections || []).map((s) => s.title);
  check(
    "all required section titles",
    REQUIRED_TITLES.every((title, i) => titles[i] === title)
  );
  check("no WDL copy in rules payload", !BANNED.test(JSON.stringify(data)));
  check("uses TSH Administration", JSON.stringify(data).includes("TSH Administration"));
  check("Premium protection is present", JSON.stringify(data).includes("Premium Protection System"));
  check("strike three is removal", JSON.stringify(data).includes("Strike 3 = Removal from the league"));
  const fixtures = data.sections.find((s) => s.id === "4");
  check("section 4 has 12 subsections", (fixtures?.subsections || []).length === 12);
  const file = fs.readFileSync(path.join(root, "data/leagueRules.json"), "utf8");
  check("source rules file has no WDL", !BANNED.test(file));
  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("Rules page loads /api/rules", appJs.includes("/api/rules") && appJs.includes("pageRules"));
} finally {
  child.kill("SIGTERM");
}

if (failures) process.exit(1);
console.log("rules tests passed");
