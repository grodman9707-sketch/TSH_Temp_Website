// Unplace must clear every regional league, not leave the leftover leagueId.
// Run: `node server/unplace.test.js`
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-unplace-"));
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

  const both = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Both Regionals",
      email: "both-unplace@test.com",
      password: "pass1234",
      regional: "both",
      dartcounterName: "BothDC",
      avg: 50,
    },
  });
  check("register dual-regional player", both.status === 200 && both.data.user?.id);
  const bothId = both.data.user.id;

  const europe = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: bothId, leagueId: 1 },
  });
  const americas = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: bothId, leagueId: 5 },
  });
  check("place in Europe League 1", europe.status === 200 && europe.data.user?.leagueIds?.includes(1));
  check("place in Americas League 1", americas.status === 200 && americas.data.user?.leagueIds?.includes(5));
  check("both regionals listed after place", (americas.data.user?.leagueIds || []).sort().join(",") === "1,5");

  const oneLeague = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: bothId, leagueId: 1 },
  });
  check("unplace one league leaves the other", oneLeague.status === 200 && oneLeague.data.user?.leagueIds?.join(",") === "5");
  check("leftover league is also leagueId", oneLeague.data.user?.leagueId === 5);

  await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: bothId, leagueId: 1 },
  });

  const allLeagues = await api(port, "/api/admin/unplace-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: bothId, leagueId: "" },
  });
  check("unplace all returns ok", allLeagues.status === 200);
  check("unplace all clears leagueIds", Array.isArray(allLeagues.data.user?.leagueIds) && allLeagues.data.user.leagueIds.length === 0);
  check("unplace all clears leagueId", allLeagues.data.user?.leagueId == null);

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const row = (overview.data.users || []).find((u) => u.id === bothId);
  check("admin overview shows player unplaced", Boolean(row) && !(row.leagueIds || []).length && !row.leagueId);

  const stored = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  const saved = (stored.users || []).find((u) => u.id === bothId);
  check("saved player has empty leagueIds", Array.isArray(saved?.leagueIds) && saved.leagueIds.length === 0);
  check("saved player has null leagueId", saved?.leagueId == null);

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("client does not restore a leftover leagueId", /function userLeagueIds\(u\) \{[\s\S]*?if \(Array\.isArray\(u\?\.leagueIds\)\)/.test(appJs));
  check("admin form still offers all-leagues unplace", appJs.includes('name="leagueId"><option value="">All of their leagues</option>'));
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
console.log("\nAll unplace checks passed.");
