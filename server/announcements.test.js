// Homepage window, News-tab glow, and announcement post/delete permissions.
// Run: `node server/announcements.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  NEWS_GLOW_MS,
  NEWS_HOME_MS,
  announcementsForHome,
  newsTabShouldGlow,
} from "../public/announcementFormat.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const now = Date.parse("2026-09-01T12:00:00.000Z");
const hoursAgo = (h) => ({ createdAt: new Date(now - h * 3600 * 1000).toISOString() });
const daysAgo = (d) => hoursAgo(d * 24);

check("12-hour post glows", newsTabShouldGlow([hoursAgo(12)], now) === true);
check("48-hour post no longer glows", newsTabShouldGlow([hoursAgo(48)], now) === false);
check("47-hour post still glows", newsTabShouldGlow([hoursAgo(47)], now) === true);
check("6-day post is on the landing page", announcementsForHome([daysAgo(6)], now).length === 1);
check("7-day post leaves the landing page", announcementsForHome([daysAgo(7)], now).length === 0);
check("old seed-style post is hidden on home", announcementsForHome([{ createdAt: "2026-08-01T12:00:00.000Z" }], now).length === 0);
check("glow window is 48 hours", NEWS_GLOW_MS === 48 * 3600 * 1000);
check("home window is 7 days", NEWS_HOME_MS === 7 * 24 * 3600 * 1000);
check("invalid date never glows", newsTabShouldGlow([{ createdAt: "nope" }], now) === false);

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

async function register(port, name) {
  const slug = name.toLowerCase().replace(/\s+/g, "");
  return api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email: `${slug}@test.com`,
      password: "pass1234",
      regional: "europe",
      dartcounterName: `${name}DC`,
      avg: 50,
    },
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-announce-perm-"));
const port = 19100 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitHealth(port, child);

  const anon = await api(port, "/api/announcements");
  check("public news list ok", anon.status === 200 && anon.data.ok);
  check("guests cannot post or delete", anon.data.canPost === false && anon.data.canDelete === false);

  const guestPost = await api(port, "/api/admin/announcements", {
    method: "POST",
    body: { title: "Nope", body: "Nope" },
  });
  check("unauthenticated post is rejected", guestPost.status === 401 || guestPost.status === 403);

  const ownerLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", ownerLogin.status === 200 && Boolean(ownerLogin.data.token));
  const ownerTok = ownerLogin.data.token;

  const ownerList = await api(port, "/api/announcements", { token: ownerTok });
  check("owner can post and delete", ownerList.data.canPost === true && ownerList.data.canDelete === true);

  const ownerPost = await api(port, "/api/admin/announcements", {
    method: "POST",
    token: ownerTok,
    body: { title: "Owner note", body: "[center]Play this week[/center]\n\nGood luck." },
  });
  check("owner can publish", ownerPost.status === 200 && ownerPost.data.announcement?.title === "Owner note");
  const ownerNewsId = ownerPost.data.announcement?.id;

  const player = await register(port, "Pat Player");
  check("player registered", player.status === 200);
  const playerTok = player.data.token;
  const playerPost = await api(port, "/api/admin/announcements", {
    method: "POST",
    token: playerTok,
    body: { title: "Player note", body: "Should fail" },
  });
  check("players cannot post", playerPost.status === 403);

  const adminReg = await register(port, "Dana Admin");
  const adminId = adminReg.data.user.id;
  const assignAdmin = await api(port, "/api/admin/assign-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: adminId, leagueId: 1 },
  });
  check("division admin assigned", assignAdmin.status === 200);
  const adminLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "danaadmin@test.com", password: "pass1234" },
  });
  const adminTok = adminLogin.data.token;
  const adminFlags = await api(port, "/api/announcements", { token: adminTok });
  check("division admin can post but not delete", adminFlags.data.canPost === true && adminFlags.data.canDelete === false);

  const adminPost = await api(port, "/api/admin/announcements", {
    method: "POST",
    token: adminTok,
    body: { title: "Admin note", body: "Division reminder" },
  });
  check("division admin can publish", adminPost.status === 200 && adminPost.data.announcement?.title === "Admin note");
  const adminNewsId = adminPost.data.announcement?.id;

  const adminDelete = await api(port, `/api/admin/announcements/${adminNewsId}/delete`, {
    method: "POST",
    token: adminTok,
    body: {},
  });
  check("division admin cannot delete", adminDelete.status === 403);

  const headReg = await register(port, "Hank Head");
  const assignHead = await api(port, "/api/admin/assign-head-admin", {
    method: "POST",
    token: ownerTok,
    body: { userId: headReg.data.user.id },
  });
  check("head admin assigned", assignHead.status === 200);
  const headLogin = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "hankhead@test.com", password: "pass1234" },
  });
  const headTok = headLogin.data.token;
  const headFlags = await api(port, "/api/announcements", { token: headTok });
  check("head admin can post and delete", headFlags.data.canPost === true && headFlags.data.canDelete === true);

  const headPost = await api(port, "/api/admin/announcements", {
    method: "POST",
    token: headTok,
    body: { title: "Head note", body: "From the desk" },
  });
  check("head admin can publish", headPost.status === 200);
  const headNewsId = headPost.data.announcement?.id;

  const headDelete = await api(port, `/api/admin/announcements/${adminNewsId}/delete`, {
    method: "POST",
    token: headTok,
    body: {},
  });
  check("head admin can delete another post", headDelete.status === 200 && headDelete.data.ok);

  const afterHead = await api(port, "/api/announcements");
  const titles = (afterHead.data.announcements || []).map((a) => a.title);
  check("deleted admin post is gone", !titles.includes("Admin note"));
  check("other posts remain", titles.includes("Head note") && titles.includes("Owner note"));

  const ownerDelete = await api(port, `/api/admin/announcements/${headNewsId}/delete`, {
    method: "POST",
    token: ownerTok,
    body: {},
  });
  check("owner can delete", ownerDelete.status === 200);

  const missing = await api(port, `/api/admin/announcements/${ownerNewsId}/delete`, {
    method: "POST",
    token: ownerTok,
    body: {},
  });
  const missingAgain = await api(port, `/api/admin/announcements/${ownerNewsId}/delete`, {
    method: "POST",
    token: ownerTok,
    body: {},
  });
  check("owner deletes remaining post", missing.status === 200);
  check("delete missing post is 404", missingAgain.status === 404);

  const blank = await api(port, "/api/admin/announcements", {
    method: "POST",
    token: adminTok,
    body: { title: "  ", body: "" },
  });
  check("empty announcement is rejected", blank.status === 400);

  const appJs = await fetch(`http://127.0.0.1:${port}/app.js`);
  const src = await appJs.text();
  check("home page loads recent news helper", src.includes("announcementsForHome") && src.includes("homeNewsSection"));
  check("news tab glow class is wired", src.includes("nav-news-glow") && src.includes("newsTabShouldGlow"));
  check("all staff see the compose form", src.includes("Only owners and Head Admins can delete"));
} finally {
  child.kill("SIGTERM");
}

if (failures) process.exit(1);
console.log("announcement home/glow/permission tests passed");
