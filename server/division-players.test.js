// Division players tab: only placed players, with avatar, real name, and nickname.
// Run: `node server/division-players.test.js`
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-division-players-"));
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

  const guest = await api(port, "/api/players");
  check("guests can read the division players list", guest.status === 200 && guest.data.ok === true);
  const emptyNames = (guest.data.divisions || []).map((division) => division.name);
  check(
    "every division is listed before anyone is placed",
    emptyNames.join("|") === "Division 1|Division 2|Division 3|Division 4|Division 5|Division 6"
  );
  check(
    "unplaced accounts are left out",
    (guest.data.divisions || []).every((division) => Array.isArray(division.players) && division.players.length === 0)
  );

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;

  const placed = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Gordon Example",
      email: "placed-div@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "GordonExampleDC",
      nickname: "Viking",
      avg: 52,
    },
  });
  const waiting = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Still Waiting",
      email: "waiting-div@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "StillWaitingDC",
      nickname: "Waiter",
      avg: 41,
    },
  });
  const quiet = await api(port, "/api/auth/register", {
    method: "POST",
    body: {
      name: "No Nickname",
      email: "quiet-div@test.com",
      password: "pass1234",
      regional: "international",
      dartcounterName: "NoNicknameDC",
      nickname: "",
      avg: 47,
    },
  });
  check("players register", placed.status === 200 && waiting.status === 200 && quiet.status === 200);
  const placedId = placed.data.user.id;
  const quietId = quiet.data.user.id;

  const inOne = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: placedId, leagueId: 9 },
  });
  const inTwo = await api(port, "/api/admin/place-player", {
    method: "POST",
    token: ownerTok,
    body: { userId: quietId, leagueId: 10 },
  });
  check("two players are placed", inOne.status === 200 && inTwo.status === 200);

  const hurt = await api(port, "/api/admin/injury", {
    method: "POST",
    token: ownerTok,
    body: { userId: quietId, leagueId: 10 },
  });
  check("an injured player stays in the division", hurt.status === 200);

  const listed = await api(port, "/api/players");
  const divisions = listed.data.divisions || [];
  const div1 = divisions.find((division) => division.id === 9);
  const div2 = divisions.find((division) => division.id === 10);
  const div3 = divisions.find((division) => division.id === 11);
  const everyone = divisions.flatMap((division) => division.players || []);
  const card = div1?.players?.find((player) => player.id === placedId);
  const quietCard = div2?.players?.find((player) => player.id === quietId);
  check("placed player is in their division", card?.name === "Gordon Example" && card?.nickname === "Viking");
  check(
    "card carries an avatar field and no private account data",
    card &&
      card.hasAvatar === false &&
      card.avatarUrl === "" &&
      !("email" in card) &&
      !("password" in card) &&
      !("phone" in card) &&
      !("dartcounterName" in card)
  );
  check("a player with no nickname still has a real name", quietCard?.name === "No Nickname" && quietCard?.nickname === "");
  check("an injured player stays on the division list", Boolean(quietCard));
  check("a pending player is not listed", everyone.every((player) => player.name !== "Still Waiting" && player.nickname !== "Waiter"));
  check("owners who are not placed stay off the list", everyone.every((player) => player.name !== "Gordon Rodman" && player.name !== "Jason Jackson"));
  check("an empty division is still returned", Array.isArray(div3?.players) && div3.players.length === 0);
  check("the same player is not repeated inside one division", (div1?.players || []).filter((player) => player.id === placedId).length === 1);

  const profile = await api(port, `/api/player/${placedId}`);
  check(
    "the name link target is the public profile",
    profile.status === 200 && profile.data.player?.name === "Gordon Example" && profile.data.player?.nickname === "Viking"
  );

  const stored = JSON.parse(fs.readFileSync(path.join(dir, "db.json"), "utf8"));
  const blank = stored.users.find((user) => user.id === placedId);
  blank.name = "   ";
  fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify(stored));
  const fallback = await api(port, "/api/players");
  const fallbackCard = (fallback.data.divisions || [])
    .flatMap((division) => division.players || [])
    .find((player) => player.id === placedId);
  check("a blank real name stays blank in the payload so the page can fall back", fallbackCard?.name === "" && fallbackCard?.nickname === "Viking");

  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const cardSource = appJs.slice(appJs.indexOf("function divisionPlayerCard"), appJs.indexOf("async function pagePlayers"));
  check("Players is a public nav tab", appJs.includes('["/players", "Players"]') && appJs.includes('if (q === "/players")') && appJs.includes("players: pagePlayers"));
  check("the page reads the placed-player list", appJs.includes('api("/api/players")') && appJs.includes("No players placed in this division yet."));
  check(
    "the real name is the profile link and the nickname is plain text",
    cardSource.includes('class="division-player-name"') &&
      cardSource.includes('href="/player/${Number(player.id)}"') &&
      cardSource.includes('class="division-player-nick"') &&
      !cardSource.includes('href="/player/${Number(player.id)}">${esc(nick)}')
  );
  check("cards use the existing avatar helper", cardSource.includes("avatarImg("));
  check(
    "the directory stays one column on a phone and two on a wider screen",
    css.includes(".division-player-grid") && css.includes("grid-template-columns: 1fr;") && css.includes("@media (min-width: 640px)")
  );
  check("cache bust covers the players tab", html.includes("app.js?v=90") && html.includes("styles.css?v=90"));
} finally {
  child.kill("SIGTERM");
}

if (failures) {
  if (stderr.trim()) console.error(stderr.trim());
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("division players tests passed");
