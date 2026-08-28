// End-to-end tests for Contact-page admin profiles.
// Run: `node server/staff-profiles.test.js`
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-staff-profiles-"));
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

  const listed = await api(port, "/api/staff-profiles");
  check("public staff list ok", listed.status === 200 && listed.data.ok);
  check("league email on staff list", listed.data.leagueEmail === "thesocialhubinformation@gmail.com");
  check("support email on staff list", listed.data.supportEmail === "Support@tshdartsleague.com");
  check("league Discord invite on staff list", listed.data.discordInvite === "https://discord.gg/PjXMqRQCfS");
  const founderCard = (listed.data.profiles || []).find((p) => p.userId === 1);
  check("founder owner profile is generated", Boolean(founderCard) && founderCard.name === "Gordon Rodman");
  check("one card per person", (listed.data.profiles || []).filter((p) => p.userId === 1).length === 1);
  check("owner card lists Owner role", founderCard?.roles?.includes("Owner") && founderCard?.roleLabel === "Owner");

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const me = await api(port, "/api/auth/me", { token: ownerTok });
  check("me includes owner contact profile", (me.data.staffProfiles || []).some((p) => p.roles?.includes("Owner")));

  const fillOwner = await api(port, "/api/account/staff-profile", {
    method: "POST",
    token: ownerTok,
    body: {
      discordUrl: "https://discord.com/users/111",
      contactEmail: "owner-fallback@example.com",
    },
  });
  check("owner can fill contact card", fillOwner.status === 200 && fillOwner.data.ok);
  const afterFill = await api(port, "/api/staff-profiles");
  const ownerPublic = (afterFill.data.profiles || []).find((p) => p.userId === 1);
  check("public listing shows Discord", ownerPublic?.discordUrl === "https://discord.com/users/111");
  check("public listing shows fallback email", ownerPublic?.contactEmail === "owner-fallback@example.com");

  const player = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Alex Admin",
      email: "alex-admin@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "AlexDC",
      avg: 50,
    },
  });
  check("register future admin", player.status === 200);
  const playerId = player.data.user.id;
  const playerTok = player.data.token;

  const denied = await api(port, "/api/account/staff-profile", {
    method: "POST",
    token: playerTok,
    body: { discordUrl: "https://discord.com/users/222", contactEmail: "nope@test.com" },
  });
  check("players cannot edit staff profiles", denied.status === 403);

  const assignAdmin = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: 1 },
  });
  check("assign division admin", assignAdmin.status === 200);
  const withAdmin = await api(port, "/api/staff-profiles");
  const adminCard = (withAdmin.data.profiles || []).find((p) => p.userId === playerId);
  check("admin profile generated for league", Boolean(adminCard) && (adminCard.leagueTitles || []).some((t) => /League 1/.test(t)));
  check("admin role label", adminCard?.roles?.includes("Admin") && adminCard?.roleLabel === "Admin");
  check("new admin card prefilled with account email", adminCard?.contactEmail === "alex-admin@test.com");

  const assignOwnerAlsoAdmin = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: 1, leagueId: 4 },
  });
  check("owner can also be a division admin", assignOwnerAlsoAdmin.status === 200);
  const ownerPlusAdmin = (await api(port, "/api/staff-profiles")).data.profiles.find((p) => p.userId === 1);
  check("owner keeps a single card", (await api(port, "/api/staff-profiles")).data.profiles.filter((p) => p.userId === 1).length === 1);
  check(
    "owner card lists Owner and Admin together",
    ownerPlusAdmin?.roles?.includes("Owner") && ownerPlusAdmin?.roles?.includes("Admin") && ownerPlusAdmin?.roleLabel === "Owner · Admin"
  );
  check("owner card still shows Discord once", ownerPlusAdmin?.discordUrl === "https://discord.com/users/111");

  const assignHead = await api(port, "/api/admin/assign-head-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId },
  });
  check("assign head admin", assignHead.status === 200);
  const withDeputy = await api(port, "/api/staff-profiles");
  const deputyCard = (withDeputy.data.profiles || []).find((p) => p.userId === playerId);
  check("one card lists Deputy Admin and Admin", deputyCard?.roleLabel === "Deputy Admin · Admin");
  check("still a single card for that person", (withDeputy.data.profiles || []).filter((p) => p.userId === playerId).length === 1);

  const fillAdmin = await api(port, "/api/account/staff-profile", {
    method: "POST",
    token: playerTok,
    body: {
      discordUrl: "https://discord.com/users/333",
      contactEmail: "alex-league@test.com",
    },
  });
  check("division admin fills their card", fillAdmin.status === 200);
  const filledPublic = await api(port, "/api/staff-profiles");
  const filledAdmin = (filledPublic.data.profiles || []).find((p) => p.userId === playerId);
  check("filled Discord is public", filledAdmin?.discordUrl === "https://discord.com/users/333");
  check("filled email is public", filledAdmin?.contactEmail === "alex-league@test.com");

  const badDiscord = await api(port, "/api/account/staff-profile", {
    method: "POST",
    token: playerTok,
    body: { discordUrl: "https://example.com/not-discord", contactEmail: "alex-league@test.com" },
  });
  check("rejects non-Discord URLs", badDiscord.status === 400);

  const revokeAdmin = await api(port, "/api/admin/revoke-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, role: "admin", leagueId: 1 },
  });
  check("revoke division admin", revokeAdmin.status === 200 && !revokeAdmin.data.pending);
  const afterRevokeAdmin = await api(port, "/api/staff-profiles");
  const afterRevokeCard = (afterRevokeAdmin.data.profiles || []).find((p) => p.userId === playerId);
  check("Admin role dropped after league removal", afterRevokeCard && !afterRevokeCard.roles.includes("Admin"));
  check("Deputy Admin kept on the same card", afterRevokeCard?.roles?.includes("Deputy Admin"));

  const replace = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, leagueId: 2 },
  });
  check("reassign as admin of another league", replace.status === 200);
  const afterReplace = await api(port, "/api/staff-profiles");
  const replacedCard = (afterReplace.data.profiles || []).find((p) => p.userId === playerId);
  check("card lists the new league", (replacedCard?.leagueTitles || []).some((t) => /League 2/.test(t)));
  check("old League 1 is gone", !(replacedCard?.leagueTitles || []).some((t) => /League 1/.test(t)));

  const revokeHead = await api(port, "/api/admin/revoke-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: playerId, role: "head_admin" },
  });
  check("revoke head admin", revokeHead.status === 200);
  const afterHead = await api(port, "/api/staff-profiles");
  const afterHeadCard = (afterHead.data.profiles || []).find((p) => p.userId === playerId);
  check("Deputy Admin dropped after head admin removal", afterHeadCard && !afterHeadCard.roles.includes("Deputy Admin"));
  check("Admin role still present", afterHeadCard?.roles?.includes("Admin"));

  const other = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Casey Owner",
      email: "casey-owner@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "CaseyDC",
      avg: 48,
    },
  });
  const otherId = other.data.user.id;
  const otherTok = other.data.token;
  const makeOwner = await api(port, "/api/admin/assign-owner", {
    method: "POST",
    token: ownerTok,
    body: { userId: otherId },
  });
  check("assign second owner", makeOwner.status === 200);
  const withSecond = await api(port, "/api/staff-profiles");
  check(
    "second owner card generated",
    (withSecond.data.profiles || []).filter((p) => p.roles?.includes("Owner")).length === 2
  );

  const requestRemove = await api(port, "/api/admin/revoke-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: otherId, role: "owner" },
  });
  check("owner removal is pending", requestRemove.status === 200 && requestRemove.data.pending);
  const stillOwner = await api(port, "/api/staff-profiles");
  check(
    "owner card remains until approved",
    (stillOwner.data.profiles || []).some((p) => p.userId === otherId && p.roles?.includes("Owner"))
  );
  const approvalId = requestRemove.data.approval.id;
  const approve = await api(port, `/api/admin/approvals/${approvalId}/approve`, {
    method: "POST",
    token: otherTok,
    body: {},
  });
  check("target owner approves removal", approve.status === 200);
  const afterOwnerGone = await api(port, "/api/staff-profiles");
  check(
    "owner card erased after approved removal",
    !(afterOwnerGone.data.profiles || []).some((p) => p.userId === otherId)
  );

  const doomed = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Riley Gone",
      email: "riley-gone@test.com",
      password: "pass1234",
      regional: "europe",
      dartcounterName: "RileyDC",
      avg: 44,
    },
  });
  const doomedId = doomed.data.user.id;
  await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: doomedId, leagueId: 3 },
  });
  const beforeDelete = await api(port, "/api/staff-profiles");
  check(
    "card exists before player delete",
    (beforeDelete.data.profiles || []).some((p) => p.userId === doomedId)
  );
  const del = await api(port, "/api/admin/delete-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: doomedId },
  });
  check("delete player", del.status === 200);
  const afterDelete = await api(port, "/api/staff-profiles");
  check(
    "cards erased when the admin is deleted",
    !(afterDelete.data.profiles || []).some((p) => p.userId === doomedId)
  );

  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("contact page uses Role, not Status", appJs.includes(">ROLE<") && !appJs.includes(">STATUS<"));
  check("contact page lists support email", appJs.includes("Support@tshdartsleague.com"));
  check("contact page uses official Admin Team heading", appJs.includes("admin-team-title") && appJs.includes("Admin Team"));
  check("contact page highlights Discord First callout", appJs.includes("discord-first") && appJs.includes("Discord First! E-mail if that Fails!"));
  check("Discord First callout is a server link", appJs.includes("discord-first") && appJs.includes("discord.gg/PjXMqRQCfS") && appJs.includes('data-external="1"'));
  check("admin Discord shows the profile URL, not Open Discord", appJs.includes("function discordDisplay") && appJs.includes("discord-profile-link") && appJs.includes("discordLinkLabel") && !appJs.includes("Players tap Open Discord"));
  check("header shows Sign In next to Sign Up on all devices", appJs.includes('class="btn-ghost">SIGN IN</a><a href="/sign-up" class="btn-gold">SIGN UP</a>') && !appJs.includes("hidden sm:inline-flex"));
  check("sidebar includes the league Discord server", appJs.includes("discord.gg/PjXMqRQCfS") && appJs.includes(">Discord</a>"));
} finally {
  child.kill("SIGTERM");
}

if (failures) {
  if (stderr) console.error(stderr);
  process.exit(1);
}
console.log("staff profile tests passed");
