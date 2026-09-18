// International League, coming-soon regionals, and International-only signup.
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
  const international = (regionals.data.regionals || []).find((r) => r.slug === "international");
  const europe = (regionals.data.regionals || []).find((r) => r.slug === "europe");
  const americas = (regionals.data.regionals || []).find((r) => r.slug === "americas");
  check("International League exists", Boolean(international));
  check("International has Divisions 1–5", Array.isArray(international?.leagues) && international.leagues.length === 5);
  check(
    "International ladder names",
    JSON.stringify((international?.leagues || []).map((l) => l.displayName)) ===
      JSON.stringify(["Division 1", "Division 2", "Division 3", "Division 4", "Division 5"])
  );
  check("Europe is coming soon", europe?.comingSoon === true && (europe?.leagues || []).length === 0);
  check("Americas is coming soon", americas?.comingSoon === true && (americas?.leagues || []).length === 0);
  const intlDiv1 = international?.leagues?.[0]?.id;

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
  check("register both regionals is rejected", both.status === 400 && /coming soon/i.test(both.data.error || ""));

  const europeSignup = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Europe Only",
      email: "europe-only@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "EuropeOnlyDC",
      avg: 50,
    },
  });
  check("register Europe is rejected", europeSignup.status === 400 && /coming soon/i.test(europeSignup.data.error || ""));

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
  check("register International via world alias", worldOnly.status === 200 && worldOnly.data.user?.regionalChoice === "international");
  check("international regionalIds", JSON.stringify(worldOnly.data.user?.regionalIds) === JSON.stringify([international.id]));
  const worldTok = worldOnly.data.token;
  const worldUserId = worldOnly.data.user.id;

  const placeEurope = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: worldUserId, leagueId: 1 },
  });
  check("cannot place a player in a retired Europe league", placeEurope.status === 400);

  const placeWorld = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: worldUserId, leagueId: intlDiv1 },
  });
  check("can place player in International Division 1", placeWorld.status === 200 && placeWorld.data.fullyPlaced === true);

  const worldMe = await api(port, "/api/auth/me", { token: worldTok });
  const joinOptions = worldMe.data.user?.openJoinRegionals || [];
  check("no second regional is offered", joinOptions.length === 0);

  const joinEurope = await api(port, "/api/account/league-request", {
    method: "POST",
    token: worldTok,
    body: { kind: "join", regionalId: europe.id },
  });
  check("cannot request a coming-soon regional", joinEurope.status === 400 && /coming soon/i.test(joinEurope.data.error || ""));

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
  check("register World + Europe is rejected", combo.status === 400 && /coming soon/i.test(combo.data.error || ""));

  const intlPlayer = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Intl Player",
      email: "intl-player@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "IntlPlayerDC",
      avg: 47,
    },
  });
  check("register International League", intlPlayer.status === 200 && intlPlayer.data.user?.regionalChoice === "international");

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("signup describes International League", appJs.includes("International League") && appJs.includes("Regionals coming soon"));
  check("signup no longer offers Europe or Americas pickers", !appJs.includes('opt("world-europe"') && !appJs.includes('opt("world-americas"') && !appJs.includes("Worlds League only"));
  check("signup no longer offers Both regionals", !appJs.includes('opt("both"') && !appJs.includes("Both lets you play"));
  check("client has World crest for International", appJs.includes("tsh-world-crest.png"));
  check("client has Europe crest", appJs.includes("tsh-europe-crest.png"));
  check("client has America crest", appJs.includes("tsh-america-crest.png"));

  for (const file of ["tsh-world-crest.png", "tsh-europe-crest.png", "tsh-america-crest.png"]) {
    const full = path.join(root, "public/images", file);
    check(`${file} is present`, fs.existsSync(full) && fs.statSync(full).size > 1000);
  }

  const worldPage = await fetch(`http://127.0.0.1:${port}/api/regionals/world`);
  const worldData = await worldPage.json();
  check("legacy World overview aliases International", worldPage.ok && worldData.ok && worldData.regional?.slug === "international" && worldData.leagues?.length === 5);
  const intlPage = await fetch(`http://127.0.0.1:${port}/api/regionals/international`);
  const intlData = await intlPage.json();
  check("International overview API ok", intlPage.ok && intlData.ok && intlData.leagues?.length === 5);
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
console.log("international league tests passed");
