// Division reviews are rebuilt from published results. Run: `node server/division-review.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { divisionReview } from "./divisionReview.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

const division4 = {
  divisionName: "Division 4",
  standings: [
    { name: "James Dixon", played: 2, won: 2, lost: 0, points: 14, legsFor: 10, diff: 8, oneEighties: 1 },
    { name: "Bobby Barnes", played: 2, won: 1, lost: 1, points: 11, legsFor: 9, diff: 2 },
    { name: "Terry Thompson", played: 2, won: 1, lost: 1, points: 10, legsFor: 8, diff: 1 },
    { name: "Riaan Roux", played: 2, won: 1, lost: 1, points: 9, legsFor: 7, diff: 0 },
    { name: "Kieren Hutton", played: 2, won: 1, lost: 1, points: 9, legsFor: 7, diff: 0 },
    { name: "Ben Ward", played: 2, won: 1, lost: 1, points: 7, legsFor: 5, diff: -2 },
    { name: "Stuart Barton", played: 2, won: 0, lost: 2, points: 7, legsFor: 7, diff: -2 },
    { name: "Carl Langridge", played: 2, won: 1, lost: 1, points: 7, legsFor: 5, diff: -4 },
  ],
  fixtures: [
    { week: 2, status: "played", homeName: "Carl Langridge", awayName: "Stuart Barton", homeLegs: 5, awayLegs: 4, homeAvg: 37.75, awayAvg: 36.47, homeCheckout: 40, awayCheckout: 32 },
    { week: 2, status: "played", homeName: "Terry Thompson", awayName: "Riaan Roux", homeLegs: 5, awayLegs: 2, homeAvg: 44.46, awayAvg: 42.78, homeCheckout: 65, awayCheckout: 16 },
    { week: 2, status: "played", homeName: "James Dixon", awayName: "Ben Ward", homeLegs: 5, awayLegs: 0, homeAvg: 52.55, awayAvg: 41.49, home180: 1, away180: 0, homeCheckout: 69, awayCheckout: 0 },
    { week: 2, status: "played", homeName: "Kieren Hutton", awayName: "Bobby Barnes", homeLegs: 5, awayLegs: 4, homeAvg: 46.97, awayAvg: 45.45, homeCheckout: 48, awayCheckout: 120 },
    { week: 3, status: "scheduled", homeName: "Stuart Barton", awayName: "Terry Thompson" },
    { week: 3, status: "scheduled", homeName: "Carl Langridge", awayName: "James Dixon" },
    { week: 3, status: "scheduled", homeName: "Riaan Roux", awayName: "Kieren Hutton" },
    { week: 3, status: "scheduled", homeName: "Ben Ward", awayName: "Bobby Barnes" },
  ],
};

console.log("Division 4 review:");
const review = divisionReview(division4);
for (const paragraph of review.paragraphs) console.log(`  ${paragraph}`);
const text = review.paragraphs.join(" ");
check("title names the division", review.title === "What's happening in Division 4");
check("leader record uses the whole season", text.includes("James Dixon is top after two wins from two"));
check("latest week is the story", text.includes("In week 2 James put Ben Ward away 5–0"));
check("best average and 180 are only mentioned when saved", text.includes("best average in the division and a 180"));
check("small checkout is the needle", text.includes("A 69 checkout is the one bit of that win you would quietly redo"));
check("last-leg loss can still own the finish", text.includes("Bobby still walked off with a 120 checkout") && text.includes("Kieren has the points. Bobby has the moment."));
check("scruffy decider stays light", text.includes("Carl Langridge nicked Stuart Barton 5–4 the scruffy way"));
check("comfortable 5–2 is not required", !text.includes("Terry Thompson beat") && !text.includes("Riaan"));
check("next public week is the hook", text.includes("Week 3 is the one to come back for"));
check("bottom player gets the leader", text.includes("Carl, fresh off that scrape, gets James") && text.includes("direct shot at the leader"));
check("whitewash gets an answer", text.includes("Ben Ward gets Bobby Barnes in second") && text.includes("answer the 5–0"));
check("winless player is named", text.includes("Stuart Barton, still looking for a first win, plays Terry Thompson"));

const hidden = divisionReview({
  ...division4,
  fixtures: division4.fixtures.filter((fixture) => fixture.week === 2),
});
check("an unreleased next week is not named", !hidden.paragraphs.join(" ").includes("Week 3") && hidden.paragraphs.join(" ").includes("Next week is not on the board yet"));

const pending = divisionReview({
  divisionName: "Division 2",
  standings: [
    { name: "Allan Sargent", played: 1, won: 1, lost: 0, points: 7, legsFor: 5, diff: 5 },
    { name: "Danny Robbins", played: 0, won: 0, lost: 0, points: 0, legsFor: 0, diff: 0 },
  ],
  fixtures: [
    { week: 2, status: "played", homeName: "Allan Sargent", awayName: "Ryan morris", homeLegs: 5, awayLegs: 0, homeAvg: 67.7, awayAvg: 54.7, homeCheckout: 66 },
    { week: 2, status: "submitted", homeName: "Danny Robbins", awayName: "Dave akers", homeLegs: 5, awayLegs: 4, homeCheckout: 101, awayCheckout: 80 },
  ],
});
const pendingText = pending.paragraphs.join(" ");
check("unapproved stats are not quoted", !pendingText.includes("5–4") && !pendingText.includes("101") && pendingText.includes("Danny Robbins against Dave akers has not landed yet"));
check("published result still leads", pendingText.includes("Allan Sargent is top after one win from one") && pendingText.includes("put Ryan morris away 5–0"));

const after = divisionReview({
  divisionName: "Division 2",
  standings: [
    { name: "Allan Sargent", played: 2, won: 2, lost: 0, points: 14, legsFor: 10, diff: 8 },
    { name: "Danny Robbins", played: 1, won: 1, lost: 0, points: 7, legsFor: 5, diff: 1 },
  ],
  fixtures: [
    { week: 1, status: "played", homeName: "Allan Sargent", awayName: "Danny Robbins", homeLegs: 5, awayLegs: 3, homeCheckout: 40 },
    { week: 2, status: "played", homeName: "Allan Sargent", awayName: "Ryan morris", homeLegs: 5, awayLegs: 0, homeAvg: 67.7, homeCheckout: 66 },
    { week: 2, status: "played", homeName: "Danny Robbins", awayName: "Dave akers", homeLegs: 5, awayLegs: 4, homeCheckout: 101, awayCheckout: 50 },
  ],
});
const afterText = after.paragraphs.join(" ");
check("a newly published result joins the old record", afterText.includes("Allan Sargent is top after two wins from two"));
check("the story follows the latest published week", afterText.includes("This week Allan put Ryan morris away 5–0") && !afterText.includes("Danny Robbins 5–3"));

const empty = divisionReview({ divisionName: "Division 6", standings: [], fixtures: [] });
check("a division with no results stays quiet", empty.paragraphs[0].includes("Nothing is on the table yet"));

console.log("\nApproved result updates the public division review:");

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-division-review-"));
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
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const adminAt = appJs.indexOf("THE ADMIN");
  const reviewAt = appJs.indexOf("d.review");
  check("the review sits under the division admin box", adminAt !== -1 && reviewAt > adminAt && appJs.includes("review.paragraphs"));

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  check("owner login", owner.status === 200 && owner.data.token);
  const ownerTok = owner.data.token;
  const created = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Review Division" },
  });
  const leagueId = created.data.league?.id;
  check("division created", created.status === 200 && leagueId);

  async function addPlayer(name) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const res = await api(port, "/api/auth/register", {
      method: "POST",
      body: { name, email: `${slug}-review@test.com`, password: "pass1234", regional: "international", dartcounterName: `${slug}-review`, avg: 50 },
    });
    check(`register ${name}`, res.status === 200 && res.data.user?.id);
    const placed = await api(port, "/api/admin/place-player", {
      method: "POST",
      token: ownerTok,
      body: { userId: res.data.user.id, leagueId },
    });
    check(`placed ${name}`, placed.status === 200);
    return res.data.user.id;
  }
  const anna = await addPlayer("Anna Review");
  const ben = await addPlayer("Ben Review");
  const cara = await addPlayer("Cara Review");
  const dan = await addPlayer("Dan Review");

  async function addFixture(homeId, awayId, week, date) {
    const made = await api(port, "/api/admin/fixtures", {
      method: "POST",
      token: ownerTok,
      body: { leagueId, homeId, awayId, week, date, season: 1 },
    });
    check(`fixture week ${week}`, made.status === 200 && made.data.fixture?.id);
    return made.data.fixture.id;
  }
  const first = await addFixture(anna, ben, 2, "2026-09-28");
  const second = await addFixture(cara, dan, 2, "2026-09-29");
  await addFixture(ben, anna, 3, "2026-10-05");
  const hiddenId = await addFixture(anna, cara, 4, "2026-10-12");
  check("later week fixture exists", Boolean(hiddenId));

  const before = await api(port, `/api/leagues/${leagueId}`);
  check("no published result yet", (before.data.review?.paragraphs || []).join(" ").includes("Nothing is on the table yet"));

  const approved = await api(port, `/api/admin/fixtures/${first}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 0, homeAvg: 61.2, awayAvg: 44, homeCheckout: 69, homeOneEighties: 1 },
  });
  check("first result published", approved.status === 200 && approved.data.fixture?.status === "played");
  const mid = await api(port, `/api/leagues/${leagueId}`);
  const midText = (mid.data.review?.paragraphs || []).join(" ");
  check("published result appears in the review", midText.includes("Anna Review is top after one win from one") && midText.includes("put Ben Review away 5–0"));
  check("the unpublished score stays out", !midText.includes("Cara Review") || midText.includes("has not landed yet"));
  check("the unreleased week is absent", !midText.includes("week 4") && !midText.includes("Week 4"));

  const secondApproved = await api(port, `/api/admin/fixtures/${second}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 4, homeCheckout: 48, awayCheckout: 120 },
  });
  check("second result published", secondApproved.status === 200);
  const later = await api(port, `/api/leagues/${leagueId}`);
  const laterText = (later.data.review?.paragraphs || []).join(" ");
  check("the new result is added to the review", laterText.includes("120 checkout") && laterText.includes("Cara Review"));
  check("the first published win is still part of the record", laterText.includes("Anna Review is top after one win from one") || laterText.includes("joint top"));
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
console.log("\nAll division review checks passed.");
