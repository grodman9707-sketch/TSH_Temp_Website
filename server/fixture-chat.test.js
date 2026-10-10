// Arrange chats on pending fixtures, then lock, delete, and notify.
// Run: `node server/fixture-chat.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { chatEmailDue, chatPhase, noteChatEmail, unreadForUser } from "./fixtureChat.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const STATS = {
  homeLegs: 5,
  awayLegs: 3,
  homeAvg: 62.4,
  awayAvg: 51.2,
  home180: 1,
  away180: 0,
  homeCheckout: 120,
  awayCheckout: 80,
};

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

console.log("Unit: chat phase, unread, and email window:");
check("scheduled chat is open", chatPhase({ status: "scheduled" }) === "open");
check("opponent verify still counts as pending", chatPhase({ status: "pending_verify" }) === "open");
check("admin review locks the chat", chatPhase({ status: "submitted" }) === "locked");
check("published result removes the chat", chatPhase({ status: "played" }) === "gone");
check("bye has no chat", chatPhase({ status: "bye", bye: true }) === "gone");
{
  const db = { matchChats: [], matchChatReads: [] };
  db.matchChats.push({ id: 1, fixtureId: 7, userId: 2, body: "Tuesday?", createdAt: "2026-10-08T12:00:00.000Z" });
  check("opponent has an unread message", unreadForUser(db, 7, 1).length === 1);
  check("author does not count their own message", unreadForUser(db, 7, 2).length === 0);
  db.matchChats.push({ id: 2, fixtureId: 7, userId: 9, body: "I can step in", createdAt: "2026-10-08T12:02:00.000Z" });
  const adminOwn = unreadForUser(db, 7, 9);
  check(
    "a division admin does not count their own message",
    adminOwn.length === 1 && adminOwn.every((message) => Number(message.userId) !== 9)
  );
  check("first notice is emailed", chatEmailDue(db, 7, 1));
  noteChatEmail(db, 7, 1, new Date("2026-10-08T12:00:01.000Z"));
  check("a second message in the same burst does not email again", !chatEmailDue(db, 7, 1, new Date("2026-10-08T12:00:30.000Z")));
  db.matchChatReads[0].readAt = "2026-10-08T12:05:00.000Z";
  check("reading the chat allows the next email", chatEmailDue(db, 7, 1, new Date("2026-10-08T12:06:00.000Z")));
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

async function register(port, name, email) {
  return api(port, "/api/auth/register", {
    method: "POST",
    body: { name, email, password: "pass1234", regional: "international", dartcounterName: name.replace(/\s+/g, ""), avg: 50 },
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-fixture-chat-"));
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1", EMAIL_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
let stdout = "";
child.stderr.on("data", (buf) => {
  stderr += buf.toString();
});
child.stdout.on("data", (buf) => {
  stdout += buf.toString();
});

try {
  await waitHealth(port, child);
  const appJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check(
    "fixtures open arrange chat from an icon popup",
    appJs.includes('data-act="open-chat"') && appJs.includes("chat-modal") && appJs.includes("ARRANGE THIS MATCH") && appJs.includes('data-form="MATCHCHAT"')
  );
  check("locked chat is explained in the popup", appJs.includes("CHAT LOCKED"));
  check("sending a message tells the player their opponent is notified", appJs.includes("Your opponent has been notified") && appJs.includes("NEW MESSAGE"));
  check(
    "icon access covers the two players, division admins, and every chat for owners",
    appJs.includes("Only the two players can post") && appJs.includes("Division admins can read their division") && appJs.includes("Owners can read every chat")
  );
  check("admin desk does not list a match chat history", !appJs.includes("matchChatsPanel") && !appJs.includes(">Match chats<"));
  check(
    "the header chat icon shows an unread count as soon as someone is logged in",
    appJs.includes("function headerChatLink") && appJs.includes("header-chat") && appJs.includes("chat-icon-badge")
  );
  check(
    "staff use that same header badge instead of a second chat icon",
    /function headerChatLink\(\) \{\s*if \(!state\.user\) return "";\s*const count = chatUnreadTotal\(\);/.test(appJs)
  );

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;
  const ownerId = owner.data.user.id;
  const overview = await api(port, "/api/admin/overview", { token: ownerTok });
  const leagueIds = (overview.data.allLeagues || overview.data.leagues || []).map((league) => league.id);
  check("two divisions exist", leagueIds.length > 1);
  const leagueA = leagueIds[0];
  const leagueB = leagueIds.find((id) => id !== leagueA);

  const home = await register(port, "Home Chat", "home-chat@test.com");
  const away = await register(port, "Away Chat", "away-chat@test.com");
  const stranger = await register(port, "Stranger Chat", "stranger-chat@test.com");
  const divAdmin = await register(port, "Div Admin Chat", "div-admin-chat@test.com");
  const otherAdmin = await register(port, "Other Admin Chat", "other-admin-chat@test.com");
  const head = await register(port, "Head Admin Chat", "head-admin-chat@test.com");
  const homeB = await register(port, "Home Bee", "home-bee@test.com");
  const awayB = await register(port, "Away Bee", "away-bee@test.com");
  check(
    "register players",
    [home, away, stranger, divAdmin, otherAdmin, head, homeB, awayB].every((res) => res.status === 200 && res.data.token)
  );

  const place = async (userId, leagueId) =>
    api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId, leagueId } });
  check("place division A", (await place(home.data.user.id, leagueA)).status === 200 && (await place(away.data.user.id, leagueA)).status === 200);
  check("place division B", (await place(homeB.data.user.id, leagueB)).status === 200 && (await place(awayB.data.user.id, leagueB)).status === 200);

  const assignAdmin = async (userId, leagueId) =>
    api(port, "/api/admin/assign-admin", { method: "POST", token: ownerTok, body: { userId, leagueId } });
  check("division admin A", (await assignAdmin(divAdmin.data.user.id, leagueA)).status === 200);
  check("division admin B", (await assignAdmin(otherAdmin.data.user.id, leagueB)).status === 200);
  check("owner is also admin of A", (await assignAdmin(ownerId, leagueA)).status === 200);
  check(
    "head admin",
    (await api(port, "/api/admin/assign-head-admin", { method: "POST", token: ownerTok, body: { userId: head.data.user.id } })).status === 200
  );

  const makeFixture = (leagueId, homeId, awayId, date) =>
    api(port, "/api/admin/fixtures", {
      method: "POST",
      token: ownerTok,
      body: { leagueId, week: 2, homeId, awayId, date },
    });
  const createdA = await makeFixture(leagueA, home.data.user.id, away.data.user.id, "2026-08-26");
  const createdB = await makeFixture(leagueB, homeB.data.user.id, awayB.data.user.id, "2026-08-26");
  const createdBye = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId: leagueA, week: 3, homeId: home.data.user.id, awayId: "bye", date: "2026-08-26" },
  });
  const createdFuture = await makeFixture(leagueA, home.data.user.id, away.data.user.id, "2027-06-06");
  const createdDecline = await makeFixture(leagueA, home.data.user.id, away.data.user.id, "2026-08-26");
  check("fixtures created", [createdA, createdB, createdBye, createdFuture, createdDecline].every((res) => res.status === 200 && res.data.fixture?.id));
  const fixtureA = createdA.data.fixture.id;
  const fixtureB = createdB.data.fixture.id;
  const fixtureBye = createdBye.data.fixture.id;
  const fixtureFuture = createdFuture.data.fixture.id;
  const fixtureDecline = createdDecline.data.fixture.id;
  const homeTok = home.data.token;
  const awayTok = away.data.token;

  const anon = await api(port, `/api/fixtures/${fixtureA}/chat`);
  check("login required", anon.status === 401);

  const empty = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: homeTok, body: { body: "   " } });
  check("empty message is rejected", empty.status === 400);

  const tooLong = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: homeTok, body: { body: "x".repeat(501) } });
  check("long message is rejected", tooLong.status === 400);

  const strangerPost = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: stranger.data.token, body: { body: "hello" } });
  check("another player cannot post", strangerPost.status === 403);
  const strangerRead = await api(port, `/api/fixtures/${fixtureA}/chat`, { token: stranger.data.token });
  check("another player cannot read", strangerRead.status === 403);

  const byeChat = await api(port, `/api/fixtures/${fixtureBye}/chat`, { token: homeTok });
  check("bye has no chat", byeChat.status === 404);
  const futureChat = await api(port, `/api/fixtures/${fixtureFuture}/chat`, { method: "POST", token: homeTok, body: { body: "too early" } });
  check("unreleased match is hidden from the players", futureChat.status === 404);

  const sent = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: homeTok, body: { body: "Tuesday at 8?" } });
  check("home can post on a pending match", sent.status === 200 && sent.data.notified === true && sent.data.chat?.messages?.length === 1);
  const burst = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: homeTok, body: { body: "Or Wednesday." } });
  check("a second message in the same burst does not email again", burst.status === 200 && burst.data.notified === false && burst.data.chat.messages.length === 2);

  const awaySummary = await api(port, "/api/fixtures/chats?summary=1", { token: awayTok });
  check(
    "opponent is notified in the app",
    awaySummary.status === 200 && awaySummary.data.unread?.length === 1 && awaySummary.data.unread[0].fixtureId === fixtureA && awaySummary.data.unread[0].count === 2 && awaySummary.data.unread[0].fromName === "Home Chat"
  );
  const homeSummary = await api(port, "/api/fixtures/chats?summary=1", { token: homeTok });
  check("sender is not notified about their own messages", (homeSummary.data.unread || []).length === 0);

  const awayRead = await api(port, `/api/fixtures/${fixtureA}/chat`, { token: awayTok });
  check(
    "opponent can read and the new messages are marked",
    awayRead.status === 200 && awayRead.data.chat.messages.filter((message) => message.unread).length === 2 && awayRead.data.chat.canPost === true
  );
  const awayReply = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: awayTok, body: { body: "Wednesday works." } });
  check("opponent can reply and that notifies home", awayReply.status === 200 && awayReply.data.notified === true);
  const afterRead = await api(port, "/api/fixtures/chats?summary=1", { token: awayTok });
  check("opening the chat clears the opponent notice", (afterRead.data.unread || []).length === 0);

  const opted = await api(port, "/api/account/notifications", { method: "POST", token: homeTok, body: { email: false } });
  check("home can turn match emails off", opted.status === 200 && opted.data.user?.notifyPrefs?.email === false);
  const quiet = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: awayTok, body: { body: "Still Wednesday?" } });
  check("opted-out opponent is not emailed", quiet.status === 200 && quiet.data.notified === false);
  await new Promise((r) => setTimeout(r, 200));
  const mailSoFar = `${stdout}\n${stderr}`.split("\n").filter((line) => line.includes("(match_chat)"));
  check("opted-out player was not emailed again", mailSoFar.filter((line) => line.includes("home-chat@test.com")).length === 1);
  check("opponent was emailed about the first message", mailSoFar.some((line) => line.includes("away-chat@test.com") && line.includes("New message from Home Chat")));
  const homeStillNotified = await api(port, "/api/fixtures/chats?summary=1", { token: homeTok });
  check("opted-out opponent still gets the in-app notice", homeStillNotified.data.unread?.[0]?.count === 2 && homeStillNotified.data.unread?.[0]?.fromName === "Away Chat");
  await api(port, "/api/account/notifications", { method: "POST", token: homeTok, body: { email: true } });

  const adminUnread = await api(port, "/api/fixtures/chats?summary=1", { token: divAdmin.data.token });
  check(
    "division admin sees an unread count for a chat they can read",
    adminUnread.status === 200 &&
      adminUnread.data.unread?.length === 1 &&
      adminUnread.data.unread[0].fixtureId === fixtureA &&
      adminUnread.data.unread[0].count === 4 &&
      adminUnread.data.unread[0].fromName === "Away Chat"
  );
  const otherUnread = await api(port, "/api/fixtures/chats?summary=1", { token: otherAdmin.data.token });
  check(
    "other division admin has no unread count for this chat",
    otherUnread.status === 200 && !(otherUnread.data.unread || []).some((item) => item.fixtureId === fixtureA)
  );
  const ownerUnread = await api(port, "/api/fixtures/chats?summary=1", { token: ownerTok });
  check(
    "owner sees an unread count for every chat they can read",
    (ownerUnread.data.unread || []).some((item) => item.fixtureId === fixtureA && item.count === 4)
  );
  const headUnread = await api(port, "/api/fixtures/chats?summary=1", { token: head.data.token });
  check(
    "head admin sees an unread count for every chat they can read",
    (headUnread.data.unread || []).some((item) => item.fixtureId === fixtureA && item.count === 4)
  );
  const adminOpen = await api(port, `/api/fixtures/${fixtureA}/chat`, { token: divAdmin.data.token });
  check(
    "opening the chat shows the division admin which messages are new",
    adminOpen.status === 200 && adminOpen.data.chat.messages.filter((message) => message.unread).length === 4
  );
  const adminCleared = await api(port, "/api/fixtures/chats?summary=1", { token: divAdmin.data.token });
  check(
    "opening the chat clears the division admin notice",
    !(adminCleared.data.unread || []).some((item) => item.fixtureId === fixtureA)
  );
  const homeAfterAdminRead = await api(port, "/api/fixtures/chats?summary=1", { token: homeTok });
  check("an admin reading the chat leaves the player's notice in place", homeAfterAdminRead.data.unread?.[0]?.count === 2);
  const ownerStillUnread = await api(port, "/api/fixtures/chats?summary=1", { token: ownerTok });
  check(
    "an admin reading the chat leaves another staff notice in place",
    (ownerStillUnread.data.unread || []).some((item) => item.fixtureId === fixtureA && item.count === 4)
  );

  const publicDivision = await api(port, `/api/leagues/${leagueA}`);
  check("public division payload does not include the chat", !JSON.stringify(publicDivision.data).includes("Tuesday at 8"));

  const adminA = await api(port, "/api/fixtures/chats", { token: divAdmin.data.token });
  const adminAIds = new Set((adminA.data.chats || []).map((chat) => chat.fixtureId));
  check("division admin sees their division chat and cannot post", adminA.status === 200 && adminAIds.has(fixtureA) && !adminAIds.has(fixtureB));
  const adminAChat = (adminA.data.chats || []).find((chat) => chat.fixtureId === fixtureA);
  check("division admin chat is read only", adminAChat && adminAChat.canPost === false && adminAChat.messages.some((message) => message.body === "Tuesday at 8?"));
  const adminB = await api(port, "/api/fixtures/chats", { token: otherAdmin.data.token });
  const adminBIds = new Set((adminB.data.chats || []).map((chat) => chat.fixtureId));
  check("other division admin cannot see this chat", !adminBIds.has(fixtureA));
  const adminPost = await api(port, `/api/fixtures/${fixtureA}/chat`, { method: "POST", token: divAdmin.data.token, body: { body: "I will pick the time" } });
  check("division admin cannot post", adminPost.status === 403);

  const sentB = await api(port, `/api/fixtures/${fixtureB}/chat`, { method: "POST", token: homeB.data.token, body: { body: "Division B only" } });
  check("division B player can post", sentB.status === 200);
  const ownerChats = await api(port, "/api/fixtures/chats", { token: ownerTok });
  const ownerIds = new Set((ownerChats.data.chats || []).map((chat) => chat.fixtureId));
  check("owner who is also a division admin still sees every chat", ownerIds.has(fixtureA) && ownerIds.has(fixtureB));
  const headChats = await api(port, "/api/fixtures/chats", { token: head.data.token });
  const headIds = new Set((headChats.data.chats || []).map((chat) => chat.fixtureId));
  check("head admin sees every division chat", headIds.has(fixtureA) && headIds.has(fixtureB));
  const homeList = await api(port, "/api/fixtures/chats", { token: homeTok });
  const homeIds = new Set((homeList.data.chats || []).map((chat) => chat.fixtureId));
  check("player list is only their pending matches", homeIds.has(fixtureA) && !homeIds.has(fixtureB));

  const declineNote = await api(port, `/api/fixtures/${fixtureDecline}/chat`, { method: "POST", token: homeTok, body: { body: "Keep this if it is sent back." } });
  check("decline fixture has a message", declineNote.status === 200);
  await api(port, `/api/admin/fixtures/${fixtureDecline}/skip-accept`, { method: "POST", token: ownerTok, body: { skipVisitorAccept: "1" } });
  const declineShots = await api(port, `/api/my-fixtures/${fixtureDecline}/screenshots`, { method: "POST", token: homeTok, body: { image1: PNG, image2: PNG, ...STATS } });
  check("decline fixture result submitted", declineShots.status === 200 && declineShots.data.fixture?.status === "pending_verify");
  const duringVerify = await api(port, `/api/fixtures/${fixtureDecline}/chat`, { method: "POST", token: awayTok, body: { body: "Still open while we check the stats." } });
  check("chat stays open until it is sent for admin approval", duringVerify.status === 200 && duringVerify.data.chat.locked === false);
  const verified = await api(port, `/api/fixtures/${fixtureDecline}/verify-stats`, { method: "POST", token: awayTok, body: {} });
  check("opponent verify sends it to admin", verified.status === 200 && verified.data.fixture?.status === "submitted");
  const lockedPlayer = await api(port, `/api/fixtures/${fixtureDecline}/chat`, { token: homeTok });
  check("players cannot see a locked chat", lockedPlayer.status === 403 && /locked/i.test(lockedPlayer.data.error || ""));
  const lockedPost = await api(port, `/api/fixtures/${fixtureDecline}/chat`, { method: "POST", token: awayTok, body: { body: "too late" } });
  check("players cannot post once it is locked", lockedPost.status === 403);
  const lockedAdmin = await api(port, `/api/fixtures/${fixtureDecline}/chat`, { token: divAdmin.data.token });
  check(
    "division admin can still read the locked chat",
    lockedAdmin.status === 200 && lockedAdmin.data.chat.locked === true && lockedAdmin.data.chat.canPost === false && lockedAdmin.data.chat.messages.length === 2
  );
  const declined = await api(port, `/api/admin/fixtures/${fixtureDecline}/decline-stats`, { method: "POST", token: divAdmin.data.token, body: { note: "Check the 180s" } });
  check("declining the result unlocks the chat", declined.status === 200 && declined.data.fixture?.status === "scheduled");
  const reopened = await api(port, `/api/fixtures/${fixtureDecline}/chat`, { token: homeTok });
  check("messages are still there after a decline", reopened.status === 200 && reopened.data.chat.canPost === true && reopened.data.chat.messages.length === 2);

  await api(port, `/api/admin/fixtures/${fixtureA}/skip-accept`, { method: "POST", token: ownerTok, body: { skipVisitorAccept: "1" } });
  const shots = await api(port, `/api/my-fixtures/${fixtureA}/screenshots`, { method: "POST", token: homeTok, body: { image1: PNG, image2: PNG, ...STATS } });
  check("result submitted for verify", shots.status === 200);
  const verifiedA = await api(port, `/api/fixtures/${fixtureA}/verify-stats`, { method: "POST", token: awayTok, body: {} });
  check("division A result is with the admin", verifiedA.status === 200 && verifiedA.data.fixture?.status === "submitted");
  const approved = await api(port, `/api/admin/fixtures/${fixtureA}/result`, {
    method: "POST",
    token: ownerTok,
    body: STATS,
  });
  check("owner publishes the result", approved.status === 200 && approved.data.fixture?.status === "played");
  const gonePlayer = await api(port, `/api/fixtures/${fixtureA}/chat`, { token: homeTok });
  const goneOwner = await api(port, `/api/fixtures/${fixtureA}/chat`, { token: ownerTok });
  const goneList = await api(port, "/api/fixtures/chats", { token: ownerTok });
  check("published match deletes the chat", gonePlayer.status === 404 && goneOwner.status === 404);
  check("published match is gone from the chat list", !(goneList.data.chats || []).some((chat) => chat.fixtureId === fixtureA));
  check("division B chat is still there", (goneList.data.chats || []).some((chat) => chat.fixtureId === fixtureB && chat.messages.some((message) => message.body === "Division B only")));

} finally {
  child.kill("SIGTERM");
}

if (failures) {
  const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-40).join("\n");
  if (tail) console.error(tail);
  process.exit(1);
}
console.log("fixture chat tests passed");
