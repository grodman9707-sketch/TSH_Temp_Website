// Owners can edit or remove a fixture after it has been played.
// Run: `node server/fixture-edit.test.js`
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-fixture-edit-"));
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
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check(
    "manage fixtures has an edit button on each match",
    appJs.includes('data-act="edit-fixture"') && appJs.includes('open ? "CLOSE" : "EDIT"') && appJs.includes(">REMOVE</button>")
  );

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const created = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Edit Division" },
  });
  const leagueId = created.data.league?.id;
  check("division created", created.status === 200 && leagueId);

  async function addPlayer(name) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const res = await api(port, "/api/auth/register", {
      method: "POST",
      body: { name, email: `${slug}-edit@test.com`, password: "pass1234", regional: "international", dartcounterName: `${slug}-dc`, avg: 45 },
    });
    check(`register ${name}`, res.status === 200 && res.data.user?.id);
    return { id: res.data.user.id, token: res.data.token };
  }
  const home = await addPlayer("Edit Home");
  const away = await addPlayer("Edit Away");
  for (const player of [home, away]) {
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId: player.id, leagueId },
    });
    check(`placed ${player.id}`, placed.status === 200);
  }

  const made = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: home.id, awayId: away.id, week: 1, date: "2024-06-03", season: 1 },
  });
  const fixtureId = made.data.fixture?.id;
  check("fixture created", made.status === 200 && fixtureId);

  const scored = await api(port, `/api/admin/fixtures/${fixtureId}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 2 },
  });
  check("result is played", scored.status === 200 && scored.data.fixture?.status === "played" && scored.data.fixture?.homeLegs === 5);

  const denied = await api(port, `/api/admin/fixtures/${fixtureId}`, {
    method: "POST",
    token: home.token,
    body: { week: 2, weekStart: "2026-10-05", date: "2026-10-06", homeId: home.id, awayId: away.id, homeLegs: 5, awayLegs: 1 },
  });
  check("a player cannot edit a fixture", denied.status === 403);

  const edited = await api(port, `/api/admin/fixtures/${fixtureId}`, {
    method: "POST",
    token: ownerTok,
    body: {
      week: 4,
      weekStart: "2026-10-12",
      date: "2026-10-14",
      time: "19:30",
      homeId: away.id,
      awayId: home.id,
      homeLegs: 5,
      awayLegs: 3,
    },
  });
  const row = edited.data.fixture;
  check(
    "played fixture can be edited without losing the result",
    edited.status === 200 &&
      row?.status === "played" &&
      row?.week === 4 &&
      row?.weekStart === "2026-10-12" &&
      row?.date === "2026-10-14" &&
      row?.time === "19:30" &&
      row?.homeId === away.id &&
      row?.awayId === home.id &&
      row?.homeName === "Edit Away" &&
      row?.awayName === "Edit Home" &&
      row?.homeLegs === 5 &&
      row?.awayLegs === 3
  );

  const byeBlocked = await api(port, `/api/admin/fixtures/${fixtureId}`, {
    method: "POST",
    token: ownerTok,
    body: { week: 4, weekStart: "2026-10-12", homeId: "bye", awayId: home.id, homeLegs: 5, awayLegs: 3 },
  });
  check("a played match cannot be turned into a bye", byeBlocked.status === 400);

  const open = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: home.id, awayId: away.id, week: 2, date: "2026-09-28", season: 1 },
  });
  const openId = open.data.fixture?.id;
  const asBye = await api(port, `/api/admin/fixtures/${openId}`, {
    method: "POST",
    token: ownerTok,
    body: { week: 2, weekStart: "2026-09-28", date: "2026-09-28", homeId: home.id, awayId: "bye" },
  });
  check("an unplayed match can be edited into a bye", asBye.status === 200 && asBye.data.fixture?.bye === true && asBye.data.fixture?.status === "bye" && asBye.data.fixture?.awayName === "Bye");

  const removed = await api(port, `/api/admin/fixtures/${fixtureId}/delete`, {
    method: "POST",
    token: ownerTok,
    body: {},
  });
  check("a played match can be removed", removed.status === 200);
  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  check("the removed match is gone", !(overview.data.fixtures || []).some((f) => f.id === fixtureId));
  check("the bye is still there", (overview.data.fixtures || []).some((f) => f.id === openId && f.bye === true));
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
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll fixture-edit checks passed.");
