// End-to-end API tests for propose / accept / screenshots + manual stats / opponent verify / admin approval.
// Run: `node server/match-flow.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

const STATS = {
  homeLegs: 5,
  awayLegs: 3,
  homeAvg: 62.4,
  awayAvg: 51.2,
  home180: 2,
  away180: 0,
  homeCheckout: 140,
  awayCheckout: 85,
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-match-flow-"));
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

  const homeReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Home Player", email: "home-flow@test.com", password: "pass1234", regional: "international", dartcounterName: "HomeDC", avg: 55 },
  });
  const awayReg = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Away Player", email: "away-flow@test.com", password: "pass1234", regional: "international", dartcounterName: "AwayDC", avg: 52 },
  });
  check("register home and visitor", homeReg.status === 200 && awayReg.status === 200);
  const homeTok = homeReg.data.token;
  const awayTok = awayReg.data.token;
  const homeId = homeReg.data.user.id;
  const awayId = awayReg.data.user.id;

  const placeHome = await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: homeId, leagueId: 9 } });
  const placeAway = await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: awayId, leagueId: 9 } });
  check("place both players", placeHome.status === 200 && placeAway.status === 200);

  const created = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 2, homeId, awayId, date: "2026-08-26" },
  });
  check("create fixture", created.status === 200 && created.data.fixture?.id);
  const fixtureId = created.data.fixture.id;

  const visitorPropose = await api(port, `/api/fixtures/${fixtureId}/propose`, {
    method: "POST",
    token: awayTok,
    body: { datetime: "2026-08-26T20:00", tz: "Europe/London" },
  });
  check("visitor cannot propose", visitorPropose.status === 403);

  const tooSoonShot = await api(port, `/api/my-fixtures/${fixtureId}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG },
  });
  check("screenshots blocked before accept", tooSoonShot.status === 400 && /accept/i.test(tooSoonShot.data.error || ""));

  const propose = await api(port, `/api/fixtures/${fixtureId}/propose`, {
    method: "POST",
    token: homeTok,
    body: { datetime: "2026-08-26T20:00", tz: "Europe/London" },
  });
  check("home can propose", propose.status === 200 && propose.data.fixture?.scheduleStatus === "proposed");

  const homeAccept = await api(port, `/api/fixtures/${fixtureId}/accept-time`, { method: "POST", token: homeTok, body: {} });
  check("home cannot accept own proposal", homeAccept.status === 403);

  const stillBlocked = await api(port, `/api/my-fixtures/${fixtureId}/screenshots`, {
    method: "POST",
    token: awayTok,
    body: { image1: PNG, image2: PNG },
  });
  check("screenshots still blocked until visitor accepts", stillBlocked.status === 400);

  const accept = await api(port, `/api/fixtures/${fixtureId}/accept-time`, { method: "POST", token: awayTok, body: {} });
  check("visitor can accept", accept.status === 200 && accept.data.fixture?.scheduleStatus === "agreed");

  const missingOne = await api(port, `/api/my-fixtures/${fixtureId}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, ...STATS },
  });
  check("both screenshots required", missingOne.status === 400);

  const shotsOnly = await api(port, `/api/my-fixtures/${fixtureId}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG },
  });
  check("stats required with screenshots", shotsOnly.status === 400 && /stats/i.test(shotsOnly.data.error || ""));

  const upload = await api(port, `/api/my-fixtures/${fixtureId}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG, ...STATS },
  });
  check("submit screenshots with manual stats", upload.status === 200 && upload.data.fixture?.hasBothScreenshots === true);
  check("submitted result waits on opponent", upload.data.fixture?.status === "pending_verify" && upload.data.fixture?.needsConfirm === false);

  const selfVerify = await api(port, `/api/fixtures/${fixtureId}/verify-stats`, { method: "POST", token: homeTok, body: {} });
  check("submitter cannot verify own stats", selfVerify.status === 403);

  const earlyAdmin = await api(port, "/api/admin/overview", { token: ownerTok });
  const earlyRow = (earlyAdmin.data.fixtures || []).find((f) => f.id === fixtureId);
  check("admin TO CONFIRM is empty until opponent verifies", earlyRow?.needsConfirm === false);

  const playerExtract = await api(port, `/api/my-fixtures/${fixtureId}/extracted-stats`, {
    method: "POST",
    token: homeTok,
    body: { homeLegs: 5, awayLegs: 2 },
  });
  check("players cannot post extracted stats separately", playerExtract.status === 403);

  const verify = await api(port, `/api/fixtures/${fixtureId}/verify-stats`, { method: "POST", token: awayTok, body: {} });
  check("opponent verifies stats", verify.status === 200 && verify.data.fixture?.status === "submitted" && verify.data.fixture?.needsConfirm === true);

  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const row = (overview.data.fixtures || []).find((f) => f.id === fixtureId);
  check("admin overview includes fixture", Boolean(row));
  check("admin fields pre-filled from submitted stats", row?.homeLegs === 5 && row?.awayLegs === 3 && row?.homeAvg === 62.4 && row?.awayAvg === 51.2);
  check("admin 180s and checkouts filled", row?.home180 === 2 && row?.awayCheckout === 85);
  check("extractedStats still present for the form", Boolean(row?.extractedStats?.homeLegs === 5));
  check("verified match needs admin approval", row?.needsConfirm === true);

  const confirm = await api(port, `/api/admin/fixtures/${fixtureId}/result`, {
    method: "POST",
    token: ownerTok,
    body: STATS,
  });
  check("admin approval saves played result", confirm.status === 200 && confirm.data.fixture?.status === "played");
  check("approved match leaves TO CONFIRM", confirm.data.fixture?.needsConfirm === false);

  const after = await api(port, "/api/admin/overview", { token: ownerTok });
  const playedRow = (after.data.fixtures || []).find((f) => f.id === fixtureId);
  check("overview still has screenshots after approve", playedRow?.hasBothScreenshots === true && playedRow?.status === "played");
  check("overview needsConfirm is false after approve", playedRow?.needsConfirm === false);

  const table = await api(port, "/api/leagues/9");
  const homeRow = (table.data.standings || []).find((r) => r.playerId === homeId);
  const awayRow = (table.data.standings || []).find((r) => r.playerId === awayId);
  check("league table loads home win after admin approval", homeRow?.won === 1 && homeRow?.lost === 0 && homeRow?.legsFor === 5 && homeRow?.points === 7);
  check("league table loads away loss and 180s", awayRow?.lost === 1 && awayRow?.legsFor === 3 && homeRow?.oneEighties === 2);
  const siteStats = await api(port, "/api/stats");
  check("site totals load 180s after admin approval", siteStats.data.total180s === 2);
  check("site totals load top checkout after admin approval", siteStats.data.topCheckout === 140);

  const week1 = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 1, homeId, awayId, date: "2026-08-20" },
  });
  check("create International Division 1 week 1 fixture", week1.status === 200 && week1.data.fixture?.id);
  const week1Id = week1.data.fixture.id;
  const week1MineBefore = await api(port, "/api/my-fixtures", { token: homeTok });
  const week1RowBefore = (week1MineBefore.data.fixtures || []).find((f) => f.id === week1Id);
  check("Europe L1 week 1 still requires visitor accept by default", week1RowBefore?.scheduleAcceptRequired !== false);
  const week1Blocked = await api(port, `/api/my-fixtures/${week1Id}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG },
  });
  check("Europe L1 week 1 cannot upload without accept", week1Blocked.status === 400 && /accept/i.test(week1Blocked.data.error || ""));

  const skipToggle = await api(port, `/api/admin/fixtures/${week1Id}/skip-accept`, {
    method: "POST",
    token: ownerTok,
    body: { skipVisitorAccept: true },
  });
  check("owner can skip accept on one match", skipToggle.status === 200 && skipToggle.data.fixture?.scheduleAcceptRequired === false);
  const week1Propose = await api(port, `/api/fixtures/${week1Id}/propose`, {
    method: "POST",
    token: homeTok,
    body: { datetime: "2026-08-21T19:00", tz: "Europe/London" },
  });
  check("skipped-accept match can still propose a time", week1Propose.status === 200 && week1Propose.data.fixture?.scheduleStatus === "proposed");
  const week1Shot = await api(port, `/api/my-fixtures/${week1Id}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG, ...STATS },
  });
  check("skipped-accept match can upload without visitor accept", week1Shot.status === 200 && week1Shot.data.fixture?.hasBothScreenshots === true);
  check("skipped-accept match waits on opponent", week1Shot.data.fixture?.status === "pending_verify");
  check("skipped-accept match reports skip", week1Shot.data.fixture?.scheduleAcceptRequired === false);

  const otherWeek1 = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 1, homeId, awayId, date: "2026-08-27", skipVisitorAccept: false },
  });
  check("second Europe L1 week 1 fixture created", otherWeek1.status === 200 && otherWeek1.data.fixture?.id);
  const otherBlocked = await api(port, `/api/my-fixtures/${otherWeek1.data.fixture.id}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG },
  });
  check("other week 1 match still requires accept", otherBlocked.status === 400);

  const flagged = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 2, homeId, awayId, date: "2026-09-03", skipVisitorAccept: true },
  });
  check("create flagged skip-accept fixture", flagged.status === 200 && flagged.data.fixture?.skipVisitorAccept === true);
  const flaggedShot = await api(port, `/api/my-fixtures/${flagged.data.fixture.id}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG, ...STATS },
  });
  check("flagged match can upload without accept", flaggedShot.status === 200);

  const dispute = await api(port, `/api/fixtures/${flagged.data.fixture.id}/dispute-stats`, {
    method: "POST",
    token: awayTok,
    body: { note: "Legs look wrong" },
  });
  check("opponent can send a result back", dispute.status === 200 && dispute.data.fixture?.status === "scheduled" && dispute.data.fixture?.hasBothScreenshots !== true);

  const declineFix = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: 9, week: 3, homeId, awayId, date: "2026-09-10", skipVisitorAccept: true },
  });
  check("create fixture for an admin decline", declineFix.status === 200 && declineFix.data.fixture?.id);
  const declineId = declineFix.data.fixture.id;
  const declineShot = await api(port, `/api/my-fixtures/${declineId}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG, ...STATS },
  });
  check("home submits stats that an admin can decline", declineShot.status === 200 && declineShot.data.fixture?.status === "pending_verify");
  const declineVerify = await api(port, `/api/fixtures/${declineId}/verify-stats`, { method: "POST", token: awayTok, body: {} });
  check("opponent verifies stats before admin decline", declineVerify.status === 200 && declineVerify.data.fixture?.status === "submitted");
  const tooSoonDecline = await api(port, `/api/admin/fixtures/${week1Id}/decline-stats`, { method: "POST", token: ownerTok, body: {} });
  check("decline only applies to player-verified stats", tooSoonDecline.status === 400);

  const outsiderAdmin = await api(port, "/api/auth/register", {
    method: "POST",
    body: { name: "Other Admin", email: "other-admin-flow@test.com", password: "pass1234", regional: "international", dartcounterName: "OtherAdminDC", avg: 40 },
  });
  const assignOther = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: outsiderAdmin.data.user.id, leagueId: 10 },
  });
  check("assign an admin of another division", assignOther.status === 200);
  const foreignDecline = await api(port, `/api/admin/fixtures/${declineId}/decline-stats`, {
    method: "POST",
    token: outsiderAdmin.data.token,
    body: { note: "Not your division" },
  });
  check("another division's admin cannot decline", foreignDecline.status === 403);

  const declined = await api(port, `/api/admin/fixtures/${declineId}/decline-stats`, {
    method: "POST",
    token: ownerTok,
    body: { note: "Checkout does not match the screenshot" },
  });
  check(
    "admin decline clears the result and adds a resubmit request",
    declined.status === 200 &&
      declined.data.fixture?.status === "scheduled" &&
      declined.data.fixture?.resubmitRequested === true &&
      declined.data.fixture?.resubmitNote === "Checkout does not match the screenshot" &&
      declined.data.fixture?.hasBothScreenshots !== true &&
      declined.data.fixture?.needsConfirm === false
  );
  const again = await api(port, `/api/my-fixtures/${declineId}/screenshots`, {
    method: "POST",
    token: homeTok,
    body: { image1: PNG, image2: PNG, ...STATS },
  });
  check("player can resubmit after a decline", again.status === 200 && again.data.fixture?.status === "pending_verify" && again.data.fixture?.resubmitRequested === false);

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("My Matches still has a propose form", appJs.includes('data-form="PROPOSE"') && appJs.includes("Propose date & time"));
  check("approve desk can decline and request a resubmit", appJs.includes("DECLINE & REQUEST RESUBMIT") && appJs.includes("decline-stats") && appJs.includes("Resubmit requested"));
  check("propose is not hidden when visitor accept is skipped", !/scheduleAcceptRequired === false\) return ""/.test(appJs));
  check("admin can mark skip accept on one existing match", appJs.includes("SKIP ACCEPT (THIS MATCH)") && appJs.includes("/skip-accept"));
  check("result form asks for screenshots and stats", appJs.includes("SUBMIT RESULT") && appJs.includes('data-form="VERIFYSTATS"') && appJs.includes("verify-stats"));
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
console.log("\nAll match-flow checks passed.");
