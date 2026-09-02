// PreSeason Bounty Hunt page, opt-in, and admin claim tracking.
// Run: `node server/preseason-bounty.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  BOUNTIES,
  awardBounty,
  isMysteryRevealed,
  maxPoints,
  maxPointsForTier,
  calendarDayLabel,
  publicHunt,
  tierForAvg,
} from "./preseasonBounty.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

check("16 bounties in the hunt", BOUNTIES.length === 16);
check("12 tier + 4 universal", BOUNTIES.filter((b) => b.kind === "tier").length === 12 && BOUNTIES.filter((b) => b.kind === "universal").length === 4);
check("catalog points total 28 (12×2 + 4×1)", maxPoints() === 28);
check("a player can earn at most 12 points (4 tier + 4 universal)", maxPointsForTier("t2") === 12);
check("avg 39.9 is Tier 3", tierForAvg(39.9).id === "t3");
check("avg 40 is Tier 2", tierForAvg(40).id === "t2");
check("avg 54.9 is Tier 2", tierForAvg(54.9).id === "t2");
check("avg 55 is Tier 1", tierForAvg(55).id === "t1");
check("season start label is September 14th", calendarDayLabel("2026-09-14T00:00:00.000Z") === "September 14th");
check("mystery reveal label is September 7th", calendarDayLabel("2026-09-07T00:00:00.000Z") === "September 7th");
check("mystery locked before 7 September", isMysteryRevealed({ mysteryRevealed: false }, "2026-09-02T12:00:00.000Z") === false);
check("mystery open on 7 September", isMysteryRevealed({ mysteryRevealed: false }, "2026-09-07T00:00:00.000Z") === true);
check("admin can force mystery open", isMysteryRevealed({ mysteryRevealed: true }, "2026-09-02T12:00:00.000Z") === true);

{
  const db = {
    users: [{ id: 2, name: "Pat", nickname: "", avg: 42, bountyHunt: true }],
    bountyClaims: [],
    preseasonBounty: { mysteryRevealed: false, mysteryTargets: { t1: "secret", t2: "", t3: "" } },
  };
  const hunt = publicHunt(db, { now: new Date("2026-09-02T12:00:00.000Z") });
  const mystery = hunt.bounties.find((b) => b.id === "u-mystery");
  check("public payload hides mystery text before reveal", mystery.mysteryRevealed === false && mystery.mysteryTargets.t1 === "");
  check("named bounties are present", hunt.bounties.some((b) => b.name === "The Century") && hunt.bounties.some((b) => b.name === "Social Butterfly"));
  const staff = { id: 1, name: "Admin" };
  const wrong = awardBounty(db, { staff, userId: 2, bountyId: "t1-century" });
  check("tier 1 bounty rejected for tier 2 player", wrong.ok === false && /Tier 1/.test(wrong.error));
  const ok = awardBounty(db, { staff, userId: 2, bountyId: "t2-finish-him" });
  check("tier 2 bounty awarded to matching player", ok.ok === true && ok.claim.bountyId === "t2-finish-him");
  const again = awardBounty(db, { staff, userId: 2, bountyId: "t2-finish-him" });
  check("same bounty cannot be claimed twice", again.ok === false);
  const uni = awardBounty(db, { staff, userId: 2, bountyId: "u-hockey-fan" });
  check("universal bounty awarded to any tier", uni.ok === true);
  const locked = awardBounty(db, { staff, userId: 2, bountyId: "u-mystery", now: new Date("2026-09-02T12:00:00.000Z") });
  check("mystery cannot be awarded before reveal", locked.ok === false);
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

async function register(port, { name, avg }) {
  const slug = name.toLowerCase().replace(/\s+/g, "");
  return api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email: `${slug}@test.com`,
      password: "pass1234",
      regional: "europe",
      dartcounterName: `${name}DC`,
      avg,
    },
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-bounty-"));
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

  const open = await api(port, "/api/preseason-bounty");
  check("bounty API ok without login", open.status === 200 && open.data.ok);
  check("guest sees catalog and no me tracker", Array.isArray(open.data.bounties) && open.data.bounties.length === 16 && open.data.me == null);
  check("guest does not see award desk", open.data.canAward !== true && !open.data.awardPlayers);
  check("claim channel is listed", open.data.discordChannel === "#Claim_PreSeason_Bounty");
  check("season start is September 14th", open.data.seasonStartLabel === "September 14th" && String(open.data.seasonStart).startsWith("2026-09-14"));

  const joinAnon = await api(port, "/api/preseason-bounty/join", { method: "POST", body: {} });
  check("join requires login", joinAnon.status === 401);

  const t3 = await register(port, { name: "LowAvg", avg: 32 });
  check("unplaced player can register", t3.status === 200 && t3.data.token);
  const t3Tok = t3.data.token;
  check("new player is not placed", t3.data.user.fullyPlaced === false && !(t3.data.user.leagueIds || []).length);

  const beforeJoin = await api(port, "/api/preseason-bounty", { token: t3Tok });
  check("signed-in player sees their tier", beforeJoin.data.me?.tierId === "t3" && beforeJoin.data.me.joined === false);

  const joined = await api(port, "/api/preseason-bounty/join", { method: "POST", token: t3Tok, body: {} });
  check("unplaced player can opt in", joined.status === 200 && joined.data.me?.joined === true);
  check("hunter board lists opted-in player", (joined.data.hunters || []).some((h) => h.userId === t3.data.user.id));

  const t1 = await register(port, { name: "HighAvg", avg: 61 });
  const t1Tok = t1.data.token;
  await api(port, "/api/preseason-bounty/join", { method: "POST", token: t1Tok, body: {} });

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const staffView = await api(port, "/api/preseason-bounty", { token: ownerTok });
  check("staff payload includes the award desk data", staffView.data.canAward === true && staffView.data.canEditMystery === true);
  check("staff sees player list", Array.isArray(staffView.data.awardPlayers) && staffView.data.awardPlayers.length >= 2);

  const wrongTier = await api(port, "/api/admin/preseason-bounty/award", {
    method: "POST",
    token: ownerTok,
    body: { userId: t3.data.user.id, bountyId: "t1-century" },
  });
  check("API rejects wrong-tier award", wrongTier.status === 400);

  const awardT3 = await api(port, "/api/admin/preseason-bounty/award", {
    method: "POST",
    token: ownerTok,
    body: { userId: t3.data.user.id, bountyId: "t3-weight-lifter" },
  });
  check("API awards matching-tier bounty", awardT3.status === 200 && awardT3.data.ok);

  const awardUni = await api(port, "/api/admin/preseason-bounty/award", {
    method: "POST",
    token: ownerTok,
    body: { userId: t3.data.user.id, bountyId: "u-double-trouble" },
  });
  check("API awards universal bounty", awardUni.status === 200);

  const tracked = await api(port, "/api/preseason-bounty", { token: t3Tok });
  check("player tracker shows claimed bounties", tracked.data.me.claimedIds.includes("t3-weight-lifter") && tracked.data.me.claimedIds.includes("u-double-trouble"));
  check("player bonus points are 2 + 1", tracked.data.me.points === 3);
  const claimedCards = tracked.data.bounties.filter((b) => b.claimed).map((b) => b.id);
  check("claimed cards are marked on the page payload", claimedCards.includes("t3-weight-lifter") && claimedCards.includes("u-double-trouble"));

  const dup = await api(port, "/api/admin/preseason-bounty/award", {
    method: "POST",
    token: ownerTok,
    body: { userId: t3.data.user.id, bountyId: "t3-weight-lifter" },
  });
  check("API rejects a second claim of the same bounty", dup.status === 400);

  const mysteryEarly = await api(port, "/api/admin/preseason-bounty/award", {
    method: "POST",
    token: ownerTok,
    body: { userId: t3.data.user.id, bountyId: "u-mystery" },
  });
  check("API keeps mystery locked before reveal", mysteryEarly.status === 400);

  const reveal = await api(port, "/api/admin/preseason-bounty/mystery", {
    method: "POST",
    token: ownerTok,
    body: { t1: "Nine-darter", t2: "140 checkout", t3: "Checkout 40", revealed: true },
  });
  check("owner can reveal mystery targets", reveal.status === 200 && reveal.data.mysteryRevealed === true);
  const afterReveal = await api(port, "/api/preseason-bounty", { token: t3Tok });
  const mysteryCard = afterReveal.data.bounties.find((b) => b.id === "u-mystery");
  check("players see revealed mystery text", mysteryCard?.mysteryRevealed === true && mysteryCard.mysteryTargets.t3 === "Checkout 40");

  const awardMystery = await api(port, "/api/admin/preseason-bounty/award", {
    method: "POST",
    token: ownerTok,
    body: { userId: t3.data.user.id, bountyId: "u-mystery" },
  });
  check("mystery can be awarded after reveal", awardMystery.status === 200);

  const revoke = await api(port, "/api/admin/preseason-bounty/revoke", {
    method: "POST",
    token: ownerTok,
    body: { userId: t3.data.user.id, bountyId: "u-mystery" },
  });
  check("staff can revoke a claim", revoke.status === 200);
  const afterRevoke = await api(port, "/api/preseason-bounty", { token: t3Tok });
  check("revoked bounty leaves the tracker", afterRevoke.data.me.claimedIds.includes("u-mystery") === false);

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  const bountyFn = appJs.slice(appJs.indexOf("async function pageBounty"), appJs.indexOf("async function pageRules"));
  const adminFn = appJs.slice(appJs.indexOf("async function pageAdmin"), appJs.indexOf("function matchRoute"));
  check("sidebar has PreSeason Bounty tab", appJs.includes('["/preseason-bounty", "PreSeason Bounty"]'));
  check("bounty page renderer is wired", appJs.includes("pageBounty") && appJs.includes('q === "/preseason-bounty"'));
  check("players can join from the bounty page", bountyFn.includes("BOUNTYJOIN") && bountyFn.includes("JOIN THE HUNT"));
  check("public bounty page has no award desk", !bountyFn.includes("BOUNTYAWARD") && !bountyFn.includes("BOUNTYREVOKE") && !bountyFn.includes("BOUNTYMYSTERY"));
  check("award desk lives on Admin", adminFn.includes("bountyAdminDesk(bounty)") && appJs.includes('data-form="BOUNTYAWARD"'));
  check("page states season starts September 14th", bountyFn.includes("September 14th"));

  const css = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
  check("bounty styles are served", css.includes(".bounty-card") && css.includes(".bounty-hunter") && css.includes(".bounty-progress"));

  const html = await (await fetch(`http://127.0.0.1:${port}/preseason-bounty`)).text();
  check("SPA serves the bounty path", html.includes("app.js") && html.includes("TSH Darts League"));
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

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll preseason bounty checks passed.");
