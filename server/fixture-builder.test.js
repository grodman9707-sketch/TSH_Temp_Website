// Combined admin fixture builder: Season vs Individual, no week-gap field, 7-day weeks.
// Run: `node server/fixture-builder.test.js`
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

async function api(port, pathname, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function dayDiff(a, b) {
  const ms = new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`);
  return Math.round(ms / 86400000);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-fixture-builder-"));
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

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("admin has one Fixtures panel", appJs.includes('data-form="FIXTURES"') && appJs.includes(">Fixtures<"));
  check("mode dropdown includes Season and Individual", appJs.includes(">Season<") && appJs.includes(">Individual fixture<"));
  check("player picks wait until a division is chosen", appJs.includes("Choose a division to pick the two players"));
  check("individual mode uses home and away player selects", appJs.includes('name="homeId"') && appJs.includes('name="awayId"') && appJs.includes("Home player"));
  check("days between weeks is removed", !appJs.includes("weekGapDays") && !appJs.includes("Days between weeks"));
  check("separate generate and create-one forms are gone", !appJs.includes("Generate season fixtures") && !appJs.includes("Create one fixture"));

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const players = [];
  for (const name of ["Alpha", "Bravo", "Charlie"]) {
    const reg = await api(port, "/api/auth/register", {
      method: "POST",
      body: {
        name: `${name} Player`,
        email: `${name.toLowerCase()}-fix@test.com`,
        password: "pass1234",
        regional: "europe",
        dartcounterName: `${name}DC`,
        avg: 50,
      },
    });
    check(`register ${name}`, reg.status === 200);
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId: reg.data.user.id, leagueId: 1 },
    });
    check(`place ${name}`, placed.status === 200);
    players.push(reg.data.user.id);
  }

  const generated = await api(port, "/api/admin/fixtures/generate", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 1, season: 1, startDate: "2026-09-06", weekGapDays: 1 },
  });
  check("generate season without using a custom gap", generated.status === 200 && generated.data.created >= 3);
  const dates = [...new Set((generated.data.fixtures || []).map((f) => f.date))].sort();
  check("generated more than one week", dates.length >= 2);
  check("weeks are seven days apart even if a 1-day gap is posted", dates.length >= 2 && dayDiff(dates[0], dates[1]) === 7);

  const one = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 1, homeId: players[0], awayId: players[1], week: 9, date: "2026-11-01" },
  });
  check("individual fixture still creates", one.status === 200 && one.data.fixture?.homeId === players[0] && one.data.fixture?.awayId === players[1]);

  const outsider = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Americas Only",
      email: "americas-fix@test.com",
      password: "pass1234",
      regional: "americas",
      dartcounterName: "AmericasDC",
      avg: 40,
    },
  });
  const outsiderPlace = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: outsider.data.user.id, leagueId: 5 },
  });
  check("place outsider in Americas", outsiderPlace.status === 200);
  const cross = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 1, homeId: players[0], awayId: outsider.data.user.id, week: 10 },
  });
  check("individual fixture rejects a player from another division", cross.status === 400);
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

try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("fixture builder tests passed");
