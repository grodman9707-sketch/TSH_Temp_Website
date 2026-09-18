// Players can ask to withdraw from a league. Regionals are coming soon, so a second league cannot be added.
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

  const regionals = await api(port, "/api/regionals");
  const international = (regionals.data.regionals || []).find((r) => r.slug === "international");
  const div1 = (international?.leagues || []).find((l) => l.displayName === "Division 1" || l.name === "Division 1");
  const leagueId = div1?.id;
  check("International Division 1 exists", Boolean(leagueId));

  const registered = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "One Regional",
      email: "one-regional@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "OneRegionalDC",
      avg: 52,
    },
  });
  check("register international player", registered.status === 200 && registered.data.token);
  const tok = registered.data.token;
  const playerId = registered.data.user.id;

  const beforePlace = await api(port, "/api/auth/me", { token: tok });
  check("no second regional is offered", beforePlace.data.user?.openJoinRegional == null && !(beforePlace.data.user?.openJoinRegionals || []).length);

  const joinEarly = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "join", regionalId: 1, note: "Want Europe too" },
  });
  check("join request for a coming-soon regional is rejected", joinEarly.status === 400 && /coming soon/i.test(joinEarly.data.error || ""));

  const place = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId },
  });
  check("placed in International Division 1", place.status === 200 && place.data.user?.leagueIds?.includes(leagueId));

  const blockedAmericas = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "join", regionalId: 2 },
  });
  check("cannot add a coming-soon regional", blockedAmericas.status === 400);

  const drop = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "drop", leagueId, note: "Schedule clash" },
  });
  check("drop request ok", drop.status === 200 && drop.data.request?.kind === "drop");
  check("player stays in the league until admin acts", drop.data.user?.leagueIds?.includes(leagueId));

  const dupDrop = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "drop", leagueId },
  });
  check("duplicate drop is blocked", dupDrop.status === 400);

  const afterDrop = await api(port, "/api/admin/overview", { token: ownerTok });
  const dropReq = (afterDrop.data.leagueRequests || []).find((r) => r.userId === playerId && r.kind === "drop" && r.leagueId === leagueId);
  check("admin sees the drop request", Boolean(dropReq?.id) && dropReq.leagueId === leagueId);

  const resolve = await api(port, "/api/admin/league-requests/resolve", {
    method: "POST",
    token: ownerTok,
    body: { id: dropReq.id, action: "done" },
  });
  check("owner can drop them", resolve.status === 200 && !resolve.data.user?.leagueIds?.includes(leagueId));
  check("drop request is gone", !(resolve.data.user?.pendingLeagueRequests || []).some((r) => r.kind === "drop"));

  const placedAgain = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId },
  });
  check("re-placed after drop", placedAgain.status === 200 && placedAgain.data.user?.leagueIds?.includes(leagueId));

  const dropAll = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "drop", scope: "all", note: "Stepping away" },
  });
  check("drop-all request ok", dropAll.status === 200 && dropAll.data.request?.scope === "all");
  check("drop-all leaves them placed until admin acts", dropAll.data.user?.leagueIds?.includes(leagueId));

  const dupAll = await api(port, "/api/account/league-request", {
    method: "POST",
    token: tok,
    body: { kind: "drop", scope: "all" },
  });
  check("duplicate drop-all is blocked", dupAll.status === 400);

  const afterAll = await api(port, "/api/admin/overview", { token: ownerTok });
  const allReq = (afterAll.data.leagueRequests || []).find((r) => r.userId === playerId && r.kind === "drop" && r.scope === "all");
  check("admin sees the withdraw-all request", Boolean(allReq?.id) && allReq.leagueTitle === "all leagues");

  const resolveAll = await api(port, "/api/admin/league-requests/resolve", {
    method: "POST",
    token: ownerTok,
    body: { id: allReq.id, action: "done" },
  });
  check("owner can drop them from every league", resolveAll.status === 200 && !(resolveAll.data.user?.leagueIds || []).length);
  check("drop-all request is gone", !(resolveAll.data.user?.pendingLeagueRequests || []).some((r) => r.kind === "drop"));

  const cancelPlayer = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Cancel Me",
      email: "cancel-league@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "CancelDC",
      avg: 41,
    },
  });
  const cancelTok = cancelPlayer.data.token;
  await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: cancelPlayer.data.user.id, leagueId },
  });
  const asked = await api(port, "/api/account/league-request", {
    method: "POST",
    token: cancelTok,
    body: { kind: "drop", leagueId },
  });
  const reqId = asked.data.request?.id;
  const cancelled = await api(port, "/api/account/league-request/cancel", {
    method: "POST",
    token: cancelTok,
    body: { id: reqId },
  });
  check("player can cancel a pending request", cancelled.status === 200 && !(cancelled.data.user?.pendingLeagueRequests || []).length);

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const indexJs = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  check(
    "player profile has league change controls",
    appJs.includes("function leagueChangeInner") &&
      appJs.includes('id="player-profile"') &&
      appJs.includes("JOINLEAGUE") &&
      appJs.includes("DROPLEAGUE") &&
      appJs.includes("ASK TO WITHDRAW") &&
      appJs.includes("All leagues")
  );
  check("admin desk lists league change requests", appJs.includes("League change requests") && appJs.includes("LEAGUERESOLVE") && appJs.includes("DROP FROM ALL LEAGUES"));
  check(
    "every admin and owner is emailed",
    indexJs.includes("function notifyStaffLeagueRequest") &&
      indexJs.includes("isStaff(u)") &&
      indexJs.includes('type: "league_request"') &&
      indexJs.includes("withdraw from all leagues")
  );
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
