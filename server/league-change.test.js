// Players can request a second regional or ask to drop from a league.
// Run: `node server/league-change.test.js`
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-league-change-"));
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

  const registered = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "One Regional",
      email: "one-regional@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "OneRegionalDC",
      avg: 52,
    },
  });
  check("register europe player", registered.status === 200 && registered.data.token);
  const tok = registered.data.token;
  const playerId = registered.data.user.id;

  const tooSoon = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "join" },
  });
  check("cannot join a second league before being placed in one", tooSoon.status === 400);

  const place = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: 1 },
  });
  check("placed in Europe Division 1", place.status === 200 && place.data.user?.leagueIds?.includes(1));
  check("second regional is offered after first placement", Boolean(place.data.user?.openJoinRegional?.id === 2));

  const mePlaced = await api(port, "/api/auth/me", { token: tok });
  check("player hub sees join offer", mePlaced.data.user?.openJoinRegional?.name);

  const join = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "join", regionalId: 2, note: "Want Americas too" },
  });
  check("join request ok", join.status === 200 && join.data.request?.kind === "join");
  check("join switches them to both regionals", join.data.user?.regionalChoice === "both");
  check("join is pending", join.data.user?.pendingLeagueRequests?.some((r) => r.kind === "join"));
  check("join offer hides while pending", join.data.user?.openJoinRegional == null);

  const dupJoin = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "join" },
  });
  check("duplicate join is blocked", dupJoin.status === 400);

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  check(
    "admin sees the join request",
    (overview.data.leagueRequests || []).some((r) => r.userId === playerId && r.kind === "join" && r.note === "Want Americas too")
  );

  const placeSecond = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: 5 },
  });
  check("placed in Americas", placeSecond.status === 200 && placeSecond.data.user?.leagueIds?.includes(5));
  check("join request clears after second placement", !(placeSecond.data.user?.pendingLeagueRequests || []).some((r) => r.kind === "join"));
  check("no join offer when already in both", placeSecond.data.user?.openJoinRegional == null);

  const drop = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "drop", leagueId: 1, note: "Schedule clash" },
  });
  check("drop request ok", drop.status === 200 && drop.data.request?.kind === "drop");
  check("player stays in the league until admin acts", drop.data.user?.leagueIds?.includes(1));

  const dupDrop = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "drop", leagueId: 1 },
  });
  check("duplicate drop is blocked", dupDrop.status === 400);

  const afterDrop = await api(port, "/api/admin/overview", { token: ownerTok });
  const dropReq = (afterDrop.data.leagueRequests || []).find((r) => r.userId === playerId && r.kind === "drop");
  check("admin sees the drop request", Boolean(dropReq?.id) && dropReq.leagueId === 1);

  const resolve = await api(port, "/api/admin/league-requests/resolve", {
    method: "POST",
    token: ownerTok,
    body: { id: dropReq.id, action: "done" },
  });
  check("owner can drop them", resolve.status === 200 && !resolve.data.user?.leagueIds?.includes(1));
  check("they keep the other regional", resolve.data.user?.leagueIds?.includes(5));
  check("drop request is gone", !(resolve.data.user?.pendingLeagueRequests || []).some((r) => r.kind === "drop"));

  const cancelPlayer = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Cancel Me",
      email: "cancel-league@test.com",
      password: "pass1234",
      regional: "americas",
      dartcounterName: "CancelDC",
      avg: 41,
    },
  });
  const cancelTok = cancelPlayer.data.token;
  await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: cancelPlayer.data.user.id, leagueId: 5 },
  });
  const asked = await api(port, "/api/account/league-request", {
    method: "POST",
    token: cancelTok,
    body: { kind: "join", regionalId: 1 },
  });
  const reqId = asked.data.request?.id;
  const cancelled = await api(port, "/api/account/league-request/cancel", {
    method: "POST",
    token: cancelTok,
    body: { id: reqId },
  });
  check("player can cancel a pending request", cancelled.status === 200 && !(cancelled.data.user?.pendingLeagueRequests || []).length);

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("player hub has league change buttons", appJs.includes("function leagueChangePanel") && appJs.includes("JOINLEAGUE") && appJs.includes("DROPLEAGUE"));
  check("admin desk lists league change requests", appJs.includes("League change requests") && appJs.includes("LEAGUERESOLVE"));
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
console.log("league-change tests passed");
