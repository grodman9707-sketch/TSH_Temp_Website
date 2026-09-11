// Regionals nav: TSH → region → division, with nested leagues on GET /api/regionals.
// Run: `node server/regionals-nav.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-regionals-nav-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (buf) => {
  stderr += buf.toString();
});

try {
  await waitHealth(port, child);
  const res = await fetch(`http://127.0.0.1:${port}/api/regionals`);
  const data = await res.json();
  check("regionals API ok", res.ok && data.ok);
  const europe = (data.regionals || []).find((r) => r.slug === "europe");
  const americas = (data.regionals || []).find((r) => r.slug === "americas");
  check("Europe and Americas regions are present", Boolean(europe && americas));
  const europeLadder = ["Division 1", "Division 2", "Division 3", "Division 4"];
  check("Europe has four divisions", Array.isArray(europe?.leagues) && europe.leagues.length === 4);
  check("Americas has four divisions", Array.isArray(americas?.leagues) && americas.leagues.length === 4);
  check(
    "Europe ladder is Division 1–4",
    (europe?.leagues || []).every((l, i) => l.displayName === europeLadder[i])
  );
  check("Americas divisions stay Division 1–4", (americas?.leagues || []).every((l, i) => l.displayName === `Division ${i + 1}`));
  check("Europe matches Americas division names", JSON.stringify((europe?.leagues || []).map((l) => l.displayName)) === JSON.stringify((americas?.leagues || []).map((l) => l.displayName)));
  check("division links jump to the table", europe?.leagues?.[0]?.href === `/regionals/europe/leagues/${europe?.leagues?.[0]?.id}`);

  const league = await (await fetch(`http://127.0.0.1:${port}/api/leagues/1`)).json();
  check("league payload uses Division in the title", /Division 1/.test(league.league?.title || "") && league.league?.displayName === "Division 1");

  const overview = await (await fetch(`http://127.0.0.1:${port}/api/regionals/europe`)).json();
  check("Europe overview API ok", overview.ok && Array.isArray(overview.leagues));
  check(
    "Europe overview lists Division 1–4",
    JSON.stringify((overview.leagues || []).map((l) => l.displayName || l.name)) === JSON.stringify(europeLadder)
  );
  check("retired Europe rungs are gone", !(overview.leagues || []).some((l) => /Premier|Championship|Foundation|Development/.test(l.displayName || l.name || "")));

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("sidebar Regionals is a nested dropdown", appJs.includes("navRegionalsBlock") && appJs.includes("class=\"nav-tree\"") && appJs.includes("<details"));
  check("each region has its own divisions dropdown", appJs.includes("class=\"nav-sub\"") && appJs.includes("nav-subsub"));
  check("regionals page lists divisions without extra hops", appJs.includes("REGIONAL LEAGUE") && appJs.includes("DIVISIONS"));
  check("Europe and Americas overviews carry a timezone acknowledgement", appJs.includes("regionalTimezoneAck") && appJs.includes("Timezone warning") && appJs.includes("UK time (GMT/BST)") && appJs.includes("US Eastern Time (ET)"));
  check("timezone ack says a time difference is not a legitimate excuse", appJs.includes("not a legitimate excuse") && appJs.includes("as though you were in this regional"));

  const css = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
  check("nested nav has phone-sized tap targets", css.includes(".nav-tree") && css.includes(".nav-subsub") && css.includes("min-height: 2.75rem"));
  check("timezone acknowledgement has warning styling", css.includes(".regional-ack") && css.includes(".regional-ack-panel"));
} catch (err) {
  failures++;
  console.error("  FAIL - suite error:", err.message);
  if (stderr) console.error(stderr);
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

const migrateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-regionals-migrate-"));
fs.writeFileSync(
  path.join(migrateDir, "db.json"),
  JSON.stringify({
    league: { name: "The Social Hub Darts League", email: "thesocialhubinformation@gmail.com" },
    content: { faq: [], premium: [] },
    regionals: [{ id: 1, slug: "europe", name: "Europe", fullTitle: "TSH Europe", region: "Europe", active: true, sortOrder: 0 }],
    leagues: [{ id: 1, regionalId: 1, name: "League 1", format: "Best of 9", sortOrder: 0 }],
    users: [],
    applications: [],
    announcements: [],
    fixtures: [],
  })
);
const migratePort = port + 1;
const migrated = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: migrateDir, PORT: String(migratePort), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await waitHealth(migratePort, migrated);
  const renamed = await (await fetch(`http://127.0.0.1:${migratePort}/api/regionals`)).json();
  const migratedEurope = renamed.regionals?.[0];
  const migratedNames = (migratedEurope?.leagues || []).map((l) => l.displayName);
  check("migrate renames League 1 to Division 1", migratedNames.includes("Division 1"));
  check("migrate fills Division 2–4", ["Division 2", "Division 3", "Division 4"].every((name) => migratedNames.includes(name)));
  check("migrate does not add retired Europe rungs", !["Premier", "Championship", "Foundation", "Development"].some((name) => migratedNames.includes(name)));
  check(
    "migrated Europe order is Division 1–4",
    JSON.stringify(migratedNames) === JSON.stringify(["Division 1", "Division 2", "Division 3", "Division 4"])
  );
  const overviewMigrated = await (await fetch(`http://127.0.0.1:${migratePort}/api/regionals/europe`)).json();
  const overviewNames = (overviewMigrated.leagues || []).map((l) => l.displayName || l.name);
  check("Europe overview after migrate starts at Division 1", overviewNames[0] === "Division 1");
  check(
    "Europe overview after migrate matches Americas",
    JSON.stringify(overviewNames) === JSON.stringify(["Division 1", "Division 2", "Division 3", "Division 4"])
  );
} catch (err) {
  failures++;
  console.error("  FAIL - migrate:", err.message);
} finally {
  migrated.kill("SIGTERM");
  await new Promise((r) => {
    const t = setTimeout(r, 2000);
    migrated.on("exit", () => {
      clearTimeout(t);
      r();
    });
  });
}

const foldDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-regionals-fold-"));
fs.writeFileSync(
  path.join(foldDir, "db.json"),
  JSON.stringify({
    league: { name: "The Social Hub Darts League", email: "thesocialhubinformation@gmail.com" },
    content: { faq: [], premium: [] },
    regionals: [{ id: 1, slug: "europe", name: "Europe", fullTitle: "TSH Europe", region: "Europe", active: true, sortOrder: 0 }],
    leagues: [
      { id: 9, regionalId: 1, name: "Premier", format: "Best of 9", sortOrder: 0 },
      { id: 1, regionalId: 1, name: "Division 1", format: "Best of 9", sortOrder: 2 },
      { id: 12, regionalId: 1, name: "Development", format: "Best of 9", sortOrder: 7 },
    ],
    users: [
      { id: 3, name: "Pat Premier", email: "pat@test.com", password: "x", role: "player", leagueIds: [9], adminLeagueIds: [9] },
      { id: 4, name: "Dev Player", email: "dev@test.com", password: "x", role: "player", leagueIds: [12] },
    ],
    applications: [],
    announcements: [],
    fixtures: [{ id: 8, leagueId: 9, homeId: 3, awayId: 4, status: "scheduled", week: 1 }],
  })
);
const foldPort = migratePort + 1;
const folded = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: foldDir, PORT: String(foldPort), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await waitHealth(foldPort, folded);
  const foldedDb = JSON.parse(fs.readFileSync(path.join(foldDir, "db.json"), "utf8"));
  const foldedNames = (foldedDb.leagues || []).map((l) => l.name);
  check("folding drops Premier and Development", !foldedNames.includes("Premier") && !foldedNames.includes("Development"));
  check("folding keeps four Europe divisions", foldedNames.filter((n) => /^Division [1-4]$/.test(n)).length === 4);
  const pat = (foldedDb.users || []).find((u) => u.id === 3);
  const dev = (foldedDb.users || []).find((u) => u.id === 4);
  check("Premier player moves into Division 1", Array.isArray(pat?.leagueIds) && pat.leagueIds.includes(1) && !pat.leagueIds.includes(9));
  check("Premier admin assignment moves to Division 1", Array.isArray(pat?.adminLeagueIds) && pat.adminLeagueIds.includes(1) && !pat.adminLeagueIds.includes(9));
  const division4 = (foldedDb.leagues || []).find((l) => l.name === "Division 4");
  check("Development player moves into Division 4", Boolean(division4) && Array.isArray(dev?.leagueIds) && dev.leagueIds.includes(division4.id) && !dev.leagueIds.includes(12));
  check("Premier fixture moves to Division 1", (foldedDb.fixtures || []).some((f) => f.id === 8 && f.leagueId === 1));
} catch (err) {
  failures++;
  console.error("  FAIL - fold extras:", err.message);
} finally {
  folded.kill("SIGTERM");
  await new Promise((r) => {
    const t = setTimeout(r, 2000);
    folded.on("exit", () => {
      clearTimeout(t);
      r();
    });
  });
}

try {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migrateDir, { recursive: true, force: true });
  fs.rmSync(foldDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("regionals nav tests passed");
