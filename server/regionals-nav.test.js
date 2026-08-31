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
  const europeLadder = ["Premier", "Championship", "Division 1", "Division 2", "Division 3", "Division 4", "Foundation", "Development"];
  check("Europe has eight divisions", Array.isArray(europe?.leagues) && europe.leagues.length === 8);
  check("Americas has four divisions", Array.isArray(americas?.leagues) && americas.leagues.length === 4);
  check(
    "Europe ladder is Premier through Development",
    (europe?.leagues || []).every((l, i) => l.displayName === europeLadder[i])
  );
  check("Americas divisions stay Division 1–4", (americas?.leagues || []).every((l, i) => l.displayName === `Division ${i + 1}`));
  check("Premier sits above Division 1", europe?.leagues?.[0]?.displayName === "Premier" && europe?.leagues?.[2]?.displayName === "Division 1");
  check("Foundation and Development sit below Division 4", europe?.leagues?.[6]?.displayName === "Foundation" && europe?.leagues?.[7]?.displayName === "Development");
  check("division links jump to the table", europe?.leagues?.[0]?.href === `/regionals/europe/leagues/${europe?.leagues?.[0]?.id}`);

  const league = await (await fetch(`http://127.0.0.1:${port}/api/leagues/1`)).json();
  check("league payload uses Division in the title", /Division 1/.test(league.league?.title || "") && league.league?.displayName === "Division 1");
  const premier = await (await fetch(`http://127.0.0.1:${port}/api/leagues/${europe?.leagues?.[0]?.id}`)).json();
  check("Premier league payload", premier.league?.displayName === "Premier" && /Premier/.test(premier.league?.title || ""));

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("sidebar Regionals is a nested dropdown", appJs.includes("navRegionalsBlock") && appJs.includes("class=\"nav-tree\"") && appJs.includes("<details"));
  check("each region has its own divisions dropdown", appJs.includes("class=\"nav-sub\"") && appJs.includes("nav-subsub"));
  check("regionals page lists divisions without extra hops", appJs.includes("REGIONAL LEAGUE") && appJs.includes("DIVISIONS"));

  const css = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
  check("nested nav has phone-sized tap targets", css.includes(".nav-tree") && css.includes(".nav-subsub") && css.includes("min-height: 2.75rem"));
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
  check(
    "migrate adds Premier, Championship, Foundation, Development",
    ["Premier", "Championship", "Foundation", "Development"].every((name) => migratedNames.includes(name))
  );
  check(
    "migrated Europe order is Premier through Development",
    JSON.stringify(migratedNames) === JSON.stringify(["Premier", "Championship", "Division 1", "Division 2", "Division 3", "Division 4", "Foundation", "Development"])
  );
} catch (err) {
  failures++;
  console.error("  FAIL - migrate:", err.message);
} finally {
  migrated.kill("SIGTERM");
}

try {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migrateDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("regionals nav tests passed");
