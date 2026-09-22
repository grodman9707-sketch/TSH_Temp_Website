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
  check("admin copy mentions Sunday GMT week release", appJs.includes("12:00am GMT on that week's Sunday"));

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
        regional: "international",
        dartcounterName: `${name}DC`,
        avg: 50,
      },
    });
    check(`register ${name}`, reg.status === 200);
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId: reg.data.user.id, leagueId: 9 },
    });
    check(`place ${name}`, placed.status === 200);
    players.push(reg.data.user.id);
  }

  const generated = await api(port, "/api/admin/fixtures/generate", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, season: 1, startDate: "2026-09-06", weekGapDays: 1 },
  });
  check("generate season without using a custom gap", generated.status === 200 && generated.data.created >= 3);
  const dates = [...new Set((generated.data.fixtures || []).map((f) => f.date))].sort();
  check("generated more than one week", dates.length >= 2);
  check("weeks are seven days apart even if a 1-day gap is posted", dates.length >= 2 && dayDiff(dates[0], dates[1]) === 7);

  const one = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, homeId: players[0], awayId: players[1], week: 9, date: "2026-11-01" },
  });
  check("individual fixture still creates", one.status === 200 && one.data.fixture?.homeId === players[0] && one.data.fixture?.awayId === players[1]);

  const outsider = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Americas Only",
      email: "americas-fix@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "AmericasDC",
      avg: 40,
    },
  });
  const outsiderPlace = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: outsider.data.user.id, leagueId: 10 },
  });
  check("place outsider in another division", outsiderPlace.status === 200);
  const cross = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, homeId: players[0], awayId: outsider.data.user.id, week: 10 },
  });
  check("individual fixture rejects a player from another division", cross.status === 400);

  check("individual form offers a Bye option", appJs.includes('value="bye"') && appJs.includes(">Bye<") && appJs.includes("Choose Bye on one side"));

  const bye = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, homeId: players[0], awayId: "bye", week: 4, date: "2026-08-02" },
  });
  check(
    "individual fixture can be a bye",
    bye.status === 200 && bye.data.fixture?.bye === true && bye.data.fixture?.status === "bye" && bye.data.fixture?.homeName === "Alpha Player" && bye.data.fixture?.awayName === "Bye" && bye.data.fixture?.awayId == null
  );
  const bothBye = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, homeId: "bye", awayId: "bye", week: 4, date: "2026-08-02" },
  });
  check("a bye needs one player", bothBye.status === 400);
  const outsiderBye = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, homeId: "bye", awayId: outsider.data.user.id, week: 4 },
  });
  check("bye rejects a player from another division", outsiderBye.status === 400);

  const byeId = bye.data.fixture.id;
  const homeTok = (await api(port, "/api/auth/login", { method: "POST", body: { email: "alpha-fix@test.com", password: "pass1234" } })).data.token;
  const mine = await api(port, "/api/my-fixtures", { token: homeTok });
  const byeRow = (mine.data.fixtures || []).find((f) => f.id === byeId);
  check("player sees the bye once that week is released", byeRow?.bye === true && byeRow?.awayName === "Bye");
  const proposeBye = await api(port, `/api/fixtures/${byeId}/propose`, {
    method: "POST",
    token: homeTok,
    body: { datetime: "2026-08-02T19:00", tz: "Europe/London" },
  });
  check("a bye cannot be scheduled", proposeBye.status === 400 && /bye/i.test(proposeBye.data.error || ""));
  const shotBye = await api(port, `/api/my-fixtures/${byeId}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: "data:image/png;base64,aaaa", image2: "data:image/png;base64,bbbb", homeLegs: 5, awayLegs: 0 },
  });
  check("a bye cannot take a result", shotBye.status === 400 && /bye/i.test(shotBye.data.error || ""));
  const table = await api(port, "/api/leagues/9");
  const alpha = (table.data.standings || []).find((r) => r.playerId === players[0]);
  check("a bye does not add a played match", alpha && alpha.played === 0 && alpha.points === 0);
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
