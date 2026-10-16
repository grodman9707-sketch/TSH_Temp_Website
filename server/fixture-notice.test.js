// Staff can attach a fixture notice. Players see it on released matches.
// Run: `node server/fixture-notice.test.js`
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

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
check("admin desk has a fixture notice editor for staff", appJs.includes('id: "fixture-notices"') && appJs.includes("fixtureNoticesDesk(d)") && appJs.includes("SAVE NOTICE"));
check("players see the notice on the hub, my matches, and the division list", appJs.includes("fixtureNoticeBlock") && appJs.includes("fixtureNoticeAlerts") && appJs.includes("FIXTURE NOTICE"));
check("notice box is styled", css.includes(".fixture-notice"));
const noticesAt = appJs.indexOf("fixtureNoticesDesk(d)");
const ownerOnlyAt = appJs.indexOf("panel(manageFixturesDesk(d, allLeagueOptions)");
check("fixture notices are not tucked into the owner-only tools", noticesAt !== -1 && ownerOnlyAt !== -1 && noticesAt < ownerOnlyAt);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-fixture-notice-"));
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

  const created = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Notice Division" },
  });
  const leagueId = created.data.league?.id;
  const other = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Other Notice Division" },
  });
  const otherLeagueId = other.data.league?.id;
  check("divisions created", created.status === 200 && leagueId && other.status === 200 && otherLeagueId);

  async function addPlayer(name, email, league) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const res = await api(port, "/api/auth/register", {
      method: "POST",
      body: { name, email, password: "pass1234", regional: "international", dartcounterName: `${slug}-notice`, avg: 48 },
    });
    check(`register ${name}`, res.status === 200 && res.data.token);
    if (league) {
      const placed = await api(port, "/api/admin/place-player", {
        method: "POST",
        token: ownerTok,
        body: { userId: res.data.user.id, leagueId: league },
      });
      check(`placed ${name}`, placed.status === 200);
    }
    return { id: res.data.user.id, token: res.data.token };
  }

  const home = await addPlayer("Nora Notice", "nora-notice@test.com", leagueId);
  const away = await addPlayer("Omar Notice", "omar-notice@test.com", leagueId);
  const divAdmin = await addPlayer("Dana Notice", "dana-notice@test.com", leagueId);
  const head = await addPlayer("Hank Notice", "hank-notice@test.com");
  const otherHome = await addPlayer("Ivy Notice", "ivy-notice@test.com", otherLeagueId);
  const otherAway = await addPlayer("Jules Notice", "jules-notice@test.com", otherLeagueId);

  async function addFixture(league, homeId, awayId, week, date) {
    const made = await api(port, "/api/admin/fixtures", {
      method: "POST",
      token: ownerTok,
      body: { leagueId: league, homeId, awayId, week, date, season: 1 },
    });
    check(`fixture week ${week}`, made.status === 200 && made.data.fixture?.id);
    return made.data.fixture.id;
  }

  const liveId = await addFixture(leagueId, home.id, away.id, 2, "2026-10-11");
  const hiddenId = await addFixture(leagueId, home.id, away.id, 8, "2026-11-08");
  const otherId = await addFixture(otherLeagueId, otherHome.id, otherAway.id, 2, "2026-10-11");

  const playerDenied = await api(port, `/api/admin/fixtures/${liveId}/notice`, {
    method: "POST",
    token: home.token,
    body: { text: "Players cannot write this" },
  });
  check("a player cannot post a fixture notice", playerDenied.status === 403);

  const posted = await api(port, `/api/admin/fixtures/${liveId}/notice`, {
    method: "POST",
    token: ownerTok,
    body: { text: "  Overdue. Extension granted through Sunday.  " },
  });
  check(
    "owner can post a notice",
    posted.status === 200 &&
      posted.data.fixture?.staffNotice === "Overdue. Extension granted through Sunday." &&
      posted.data.fixture?.staffNoticeByName
  );

  const hiddenPosted = await api(port, `/api/admin/fixtures/${hiddenId}/notice`, {
    method: "POST",
    token: ownerTok,
    body: { text: "This week is not out yet." },
  });
  check("a notice can be saved on an unreleased fixture", hiddenPosted.status === 200);

  const mine = await api(port, "/api/my-fixtures", { token: home.token });
  const seen = (mine.data.fixtures || []).find((f) => f.id === liveId);
  const unseen = (mine.data.fixtures || []).find((f) => f.id === hiddenId);
  check("the player sees the notice on the released match", seen?.staffNotice === "Overdue. Extension granted through Sunday." && seen?.staffNoticeByName);
  check("an unreleased fixture stays hidden, notice and all", !unseen);

  const league = await api(port, `/api/leagues/${leagueId}`);
  const publicFixture = (league.data.fixtures || []).find((f) => f.id === liveId);
  const publicHidden = (league.data.fixtures || []).find((f) => f.id === hiddenId);
  check("the division fixtures list shows the notice", publicFixture?.staffNotice === "Overdue. Extension granted through Sunday.");
  check("the division list does not leak the unreleased notice", !publicHidden);

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const staffHidden = (overview.data.fixtures || []).find((f) => f.id === hiddenId);
  check("staff still see the notice on an unreleased fixture", staffHidden?.staffNotice === "This week is not out yet.");

  const tooLong = await api(port, `/api/admin/fixtures/${liveId}/notice`, {
    method: "POST",
    token: ownerTok,
    body: { text: "x".repeat(401) },
  });
  const still = await api(port, "/api/my-fixtures", { token: away.token });
  const awaySeen = (still.data.fixtures || []).find((f) => f.id === liveId);
  check("a notice over 400 characters is rejected", tooLong.status === 400 && awaySeen?.staffNotice === "Overdue. Extension granted through Sunday.");

  const assigned = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: divAdmin.id, leagueId },
  });
  check("division admin assigned", assigned.status === 200);
  const divLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "dana-notice@test.com", password: "pass1234" },
  });
  const divTok = divLogin.data.token;
  const divPosted = await api(port, `/api/admin/fixtures/${liveId}/notice`, {
    method: "POST",
    token: divTok,
    body: { text: "Extension stands. Please play this week." },
  });
  check("division admin can update a notice in their division", divPosted.status === 200 && divPosted.data.fixture?.staffNotice === "Extension stands. Please play this week.");
  const divDenied = await api(port, `/api/admin/fixtures/${otherId}/notice`, {
    method: "POST",
    token: divTok,
    body: { text: "Not this division" },
  });
  check("division admin cannot notice another division", divDenied.status === 403);

  const madeHead = await api(port, "/api/admin/assign-head-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: head.id },
  });
  check("head admin assigned", madeHead.status === 200);
  const headLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "hank-notice@test.com", password: "pass1234" },
  });
  const headPosted = await api(port, `/api/admin/fixtures/${otherId}/notice`, {
    method: "POST",
    token: headLogin.data.token,
    body: { text: "Head admin note for the other division." },
  });
  check("head admin can post a notice in any division", headPosted.status === 200 && headPosted.data.fixture?.staffNotice === "Head admin note for the other division.");

  const cleared = await api(port, `/api/admin/fixtures/${liveId}/notice`, {
    method: "POST",
    token: divTok,
    body: { text: "   " },
  });
  const afterClear = await api(port, "/api/my-fixtures", { token: home.token });
  const clearedFixture = (afterClear.data.fixtures || []).find((f) => f.id === liveId);
  check("blank text removes the notice", cleared.status === 200 && cleared.data.fixture?.staffNotice === "" && clearedFixture?.staffNotice === "");

  const activity = await api(port, "/api/admin/activity", { token: ownerTok });
  const summaries = (activity.data.entries || []).map((entry) => entry.summary).join(" ");
  check("the staff log records the notice", activity.status === 200 && summaries.includes("Extension stands") && summaries.includes("Cleared the notice"));
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
console.log("\nAll fixture notice checks passed.");
