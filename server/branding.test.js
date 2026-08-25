// Asserts WDL / World Darts League copy is gone and the league contact email is TSH.
// Run: `node server/branding.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTACT = "thesocialhubinformation@gmail.com";
const BANNED = /World Darts League|\bWDL\b|worlddartsleagueinfo/i;

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

async function startServer(dataDir, port) {
  const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (buf) => {
    stderr += buf.toString();
  });
  await waitHealth(port, child);
  return { child, stderr: () => stderr };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-branding-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const { child, stderr } = await startServer(dir, port);

try {
  const contentRes = await fetch(`http://127.0.0.1:${port}/api/content`);
  const content = await contentRes.json();
  check("content ok", contentRes.ok && content.ok);
  check("league email is TSH Gmail", content.league?.email === CONTACT);
  check("league has no formerly field", !("formerly" in (content.league || {})));
  const blob = JSON.stringify(content);
  check("content JSON has no WDL / World Darts League", !BANNED.test(blob));

  const newsRes = await fetch(`http://127.0.0.1:${port}/api/announcements`);
  const news = await newsRes.json();
  check("news ok", newsRes.ok && news.ok);
  check("announcements have no WDL copy", !BANNED.test(JSON.stringify(news)));

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("served app.js has no WDL copy", !BANNED.test(appJs));
  check("served app.js uses TSH contact email", appJs.includes(CONTACT));

  const tickerSrc = fs.readFileSync(path.join(root, "server/pdcTicker.js"), "utf8");
  check("Wikipedia user-agent uses TSH contact email", tickerSrc.includes(CONTACT) && !tickerSrc.includes("worlddartsleagueinfo"));
} finally {
  child.kill("SIGTERM");
}

const migrateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-branding-migrate-"));
fs.writeFileSync(
  path.join(migrateDir, "db.json"),
  JSON.stringify({
    league: { name: "The Social Hub Darts League", shortName: "TSH Darts League", formerly: "World Darts League (WDL)", email: "worlddartsleagueinfo@gmail.com" },
    content: { faq: [{ q: "What is TSH Darts League?", a: "The Social Hub Darts League is a competitive online darts league — formerly World Darts League (WDL)." }], premium: [] },
    regionals: [],
    leagues: [],
    users: [],
    applications: [],
    announcements: [{ id: 1, title: "WDL is now TSH Darts League", body: "World Darts League has been rebranded.", createdAt: "2026-08-01T12:00:00.000Z" }],
    fixtures: [],
  })
);
const migratePort = port + 1;
const migrated = await startServer(migrateDir, migratePort);
try {
  const content = await (await fetch(`http://127.0.0.1:${migratePort}/api/content`)).json();
  check("migrate updates contact email", content.league?.email === CONTACT);
  check("migrate removes formerly", !("formerly" in (content.league || {})));
  check("migrate strips WDL from FAQ and news payload", !BANNED.test(JSON.stringify(content)));
  const news = await (await fetch(`http://127.0.0.1:${migratePort}/api/announcements`)).json();
  check("migrate rewrites WDL announcement", !BANNED.test(JSON.stringify(news)));
  check("rewritten news title", news.announcements?.[0]?.title === "Welcome to TSH Darts League");
} finally {
  migrated.child.kill("SIGTERM");
}

if (failures) {
  process.exit(1);
}
console.log("branding tests passed");
