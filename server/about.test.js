// About Us tab: belief, mission, creed, oath, and Contact nested on the same page.
// Run: `node server/about.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_TITLES = ["Our Belief", "The League Mission Statement", "League Creed", "Player’s Oath"];
const REQUIRED_PHRASES = [
  "DARTS IS MORE THAN JUST A GAME.",
  "Darts brings us to the oche, but friendship keeps us coming back.",
  "competition is valued, but connection is essential",
  "show up, throw true",
  "This is my oath",
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-about-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitHealth(port, child);
  const res = await fetch(`http://127.0.0.1:${port}/api/about`);
  const data = await res.json();
  check("about API ok without login", res.ok && data.ok);
  const titles = (data.sections || []).map((s) => s.title);
  check(
    "belief, mission, creed, and oath sections",
    REQUIRED_TITLES.every((title, i) => titles[i] === title)
  );
  const blob = JSON.stringify(data);
  check(
    "required phrases are present",
    REQUIRED_PHRASES.every((phrase) => blob.includes(phrase))
  );
  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("nav has About Us instead of a top-level Contact tab", appJs.includes('["/about", "About Us"]') && !appJs.includes('["/contact", "Contact"]'));
  check("About page loads /api/about and keeps Contact as a section", appJs.includes("/api/about") && appJs.includes("pageAbout") && appJs.includes('id="contact"'));
  check("/contact still routes to About Us", appJs.includes('q === "/about" || q === "/contact"'));
  const css = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
  check("about styles are served", css.includes(".about-kicker") && css.includes(".rules-note"));
} finally {
  if (child.exitCode == null) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(r, 2000);
      child.on("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("about tests passed");
