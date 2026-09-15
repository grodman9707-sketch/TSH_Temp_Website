// Worlds League, crests, and World-only / World + one regional signup.
// Run: `node server/world-league.test.js`
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-world-league-"));
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

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const regionals = await api(port, "/api/regionals");
  const world = (regionals.data.regionals || []).find((r) => r.slug === "world");
  const europe = (regionals.data.regionals || []).find((r) => r.slug === "europe");
  const americas = (regionals.data.regionals || []).find((r) => r.slug === "americas");
  check("Worlds League exists", Boolean(world));
  check("World has Divisions 1–5", Array.isArray(world?.leagues) && world.leagues.length === 5);
  check(
    "World ladder names",
    JSON.stringify((world?.leagues || []).map((l) => l.displayName)) ===
      JSON.stringify(["Division 1", "Division 2", "Division 3", "Division 4", "Division 5"])
  );
  const worldDiv1 = world?.leagues?.[0]?.id;

  const both = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Too Many",
      email: "too-many@test.com",
      password: "pass1234",
      regional: "both",
      dartcounterName: "TooManyDC",
      avg: 50,
    },
  });
  check("register both regionals is rejected", both.status === 400 && /one regional/i.test(both.data.error || ""));

  const worldOnly = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "World Only",
      email: "world-only@test.com",
      password: "pass1234",
      regional: "world",
      dartcounterName: "WorldOnlyDC",
      avg: 55,
    },
  });
  check("register Worlds League only", worldOnly.status === 200 && worldOnly.data.user?.regionalChoice === "world");
  check("world-only regionalIds", JSON.stringify(worldOnly.data.user?.regionalIds) === JSON.stringify([world.id]));
  const worldTok = worldOnly.data.token;
  const worldUserId = worldOnly.data.user.id;

  const placeEurope = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: worldUserId, leagueId: 1 },
  });
  check("cannot place world-only player in Europe", placeEurope.status === 400);

  const placeWorld = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: worldUserId, leagueId: worldDiv1 },
  });
  check("can place world-only player in World Division 1", placeWorld.status === 200 && placeWorld.data.fullyPlaced === true);

  const worldMe = await api(port, "/api/auth/me", { token: worldTok });
  const joinOptions = worldMe.data.user?.openJoinRegionals || [];
  check("world-only player can add one regional", joinOptions.length === 2);
  check(
    "join options are Europe and Americas",
    joinOptions.some((r) => r.slug === "europe" || r.id === europe.id) && joinOptions.some((r) => r.slug === "americas" || r.id === americas.id)
  );

  const joinEurope = await api(port, "/api/account/league-request", {
    method: "POST",
    token: worldTok,
    body: { kind: "join", regionalId: europe.id },
  });
  check("world player can request Europe", joinEurope.status === 200 && joinEurope.data.user?.regionalChoice === "world-europe");

  const joinAmericasToo = await api(port, "/api/account/league-request", {
    method: "POST",
    token: worldTok,
    body: { kind: "join", regionalId: americas.id },
  });
  check("world + Europe cannot also request Americas", joinAmericasToo.status === 400);

  const combo = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "World Europe",
      email: "world-europe@test.com",
      password: "pass1234",
      regional: "world-europe",
      dartcounterName: "WorldEuropeDC",
      avg: 48,
    },
  });
  check("register World + Europe", combo.status === 200 && combo.data.user?.regionalChoice === "world-europe");
  const comboIds = [...(combo.data.user?.regionalIds || [])].sort((a, b) => a - b);
  check("World + Europe ids", JSON.stringify(comboIds) === JSON.stringify([europe.id, world.id].sort((a, b) => a - b)));

  const comboAmericas = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: combo.data.user.id, leagueId: 5 },
  });
  check("cannot place World + Europe player in Americas", comboAmericas.status === 400);

  const americasPlayer = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "World Americas",
      email: "world-americas@test.com",
      password: "pass1234",
      regional: "world-americas",
      dartcounterName: "WorldAmericasDC",
      avg: 47,
    },
  });
  check("register World + Americas", americasPlayer.status === 200 && americasPlayer.data.user?.regionalChoice === "world-americas");

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("signup offers Worlds League only", appJs.includes('opt("world",') && appJs.includes("Worlds League only"));
  check("signup offers World + Europe", appJs.includes('opt("world-europe"'));
  check("signup offers World + Americas", appJs.includes('opt("world-americas"'));
  check("signup no longer offers Both regionals", !appJs.includes('opt("both"') && !appJs.includes("Both lets you play"));
  check("client has World crest", appJs.includes("tsh-world-crest.png"));
  check("client has Europe crest", appJs.includes("tsh-europe-crest.png"));
  check("client has America crest", appJs.includes("tsh-america-crest.png"));

  for (const file of ["tsh-world-crest.png", "tsh-europe-crest.png", "tsh-america-crest.png"]) {
    const full = path.join(root, "public/images", file);
    check(`${file} is present`, fs.existsSync(full) && fs.statSync(full).size > 1000);
  }

  const worldPage = await fetch(`http://127.0.0.1:${port}/api/regionals/world`);
  const worldData = await worldPage.json();
  check("World overview API ok", worldPage.ok && worldData.ok && worldData.leagues?.length === 5);
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
console.log("world league tests passed");
