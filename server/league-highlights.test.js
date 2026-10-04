// Home-page highlights follow published results across divisions.
// Run: `node server/league-highlights.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { leagueHighlights } from "./leagueHighlights.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  - ${name}`);
  else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}
function plain(highlights) {
  return (highlights?.paragraphs || []).map((parts) => parts.map((part) => part.text).join("")).join(" ");
}

const sample = leagueHighlights([
  {
    name: "Division 2",
    href: "/regionals/international/leagues/10",
    standings: [
      { name: "Allan Sargent", played: 2, won: 2, points: 14, legsFor: 10, diff: 8 },
      { name: "Danny Robbins", played: 2, won: 2, points: 14, legsFor: 10, diff: 6 },
      { name: "Christopher smith", played: 1, won: 0, points: 2, legsFor: 2, diff: -3 },
    ],
    fixtures: [
      { week: 2, status: "played", homeName: "Allan Sargent", awayName: "Ryan morris", homeLegs: 5, awayLegs: 0, homeAvg: 67.7, awayAvg: 54.7, homeCheckout: 66 },
      { week: 2, status: "played", homeName: "Danny Robbins", awayName: "Dave akers", homeLegs: 5, awayLegs: 4, homeCheckout: 101, awayCheckout: 50 },
      { week: 2, status: "scheduled", homeName: "Nathan Goodman", awayName: "Christopher smith" },
      { week: 3, status: "scheduled", homeName: "Allan Sargent", awayName: "Christopher smith" },
    ],
  },
  {
    name: "Division 4",
    href: "/regionals/international/leagues/12",
    standings: [
      { name: "James Dixon", played: 2, won: 2, points: 14, legsFor: 10, diff: 8 },
      { name: "Bobby Barnes", played: 2, won: 1, points: 11, legsFor: 9, diff: 2 },
      { name: "Carl Langridge", played: 2, won: 1, points: 7, legsFor: 5, diff: -4 },
    ],
    fixtures: [
      { week: 2, status: "played", homeName: "James Dixon", awayName: "Ben Ward", homeLegs: 5, awayLegs: 0, homeAvg: 52.55, awayAvg: 41.49, home180: 1, homeCheckout: 69 },
      { week: 2, status: "played", homeName: "Kieren Hutton", awayName: "Bobby Barnes", homeLegs: 5, awayLegs: 4, homeCheckout: 48, awayCheckout: 120 },
      { week: 3, status: "scheduled", homeName: "Carl Langridge", awayName: "James Dixon" },
    ],
  },
]);
const sampleText = plain(sample);
console.log("Around the league:");
console.log(`  ${sampleText}`);
check("title", sample.title === "Around the league");
check("highest average leads", sampleText.includes("Allan Sargent put Ryan morris away 5–0 in Division 2, the highest average of the week"));
check("the winner gets the wink", sampleText.includes("Enjoy it, Allan."));
check("another division can own the finish", sampleText.includes("Division 4 still owns the finish") && sampleText.includes("Bobby Barnes lost a last-leg decider and walked off with a 120 checkout"));
check("joint leaders and a shot at the top are the tables to open", sampleText.includes("Division 2, where Allan Sargent and Danny Robbins are joint top") && sampleText.includes("Division 4, where Carl Langridge has a shot at James Dixon"));
check("division names link through", sample.paragraphs[0].some((part) => part.text === "Division 2" && part.href.endsWith("/leagues/10")));

const hidden = leagueHighlights([
  {
    name: "Division 1",
    href: "/d/1",
    standings: [{ name: "Pat", played: 1, won: 1, points: 7, legsFor: 5, diff: 3 }],
    fixtures: [
      { week: 1, status: "played", homeName: "Pat", awayName: "Quinn", homeLegs: 5, awayLegs: 2, homeAvg: 55, homeCheckout: 40 },
      { week: 1, status: "submitted", homeName: "Una", awayName: "Vic", homeLegs: 5, awayLegs: 0, homeAvg: 99, awayCheckout: 170 },
    ],
  },
]);
const hiddenText = plain(hidden);
check("an unapproved score stays out of the league highlight", hiddenText.includes("Pat beat Quinn 5–2") && !hiddenText.includes("Una") && !hiddenText.includes("170"));
check("no published results means no highlight", leagueHighlights([{ name: "Division 6", href: "/d/6", standings: [], fixtures: [] }]) === null);

console.log("\nApproving a match updates Around the league:");

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-league-highlights-"));
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
  const heroAt = appJs.indexOf("WHERE THE");
  const highlightAt = appJs.indexOf("homeHighlights(stats.highlights)");
  const numbersAt = appJs.indexOf("TSH In Numbers");
  check("Around the league sits between the hero and the numbers", heroAt !== -1 && highlightAt > heroAt && numbersAt > highlightAt && appJs.includes("Around the league"));

  const before = await api(port, "/api/stats");
  check("the numbers still load", before.status === 200 && typeof before.data.total180s === "number");
  check("an empty season has no highlight", before.data.highlights == null);

  const owner = await api(port, "/api/auth/login", {
    method: "POST",
    body: { email: "GRodman9707@gmail.com", password: "Rodm@n85" },
  });
  const ownerTok = owner.data.token;
  check("owner login", owner.status === 200 && ownerTok);
  const created = await api(port, "/api/admin/structure/leagues", {
    method: "POST",
    token: ownerTok,
    body: { regionalId: 3, name: "Highlight Division" },
  });
  const leagueId = created.data.league?.id;
  async function addPlayer(name) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const res = await api(port, "/api/auth/register", {
      method: "POST",
      body: { name, email: `${slug}-hl@test.com`, password: "pass1234", regional: "international", dartcounterName: `${slug}-hl`, avg: 48 },
    });
    await api(port, "/api/admin/place-player", { method: "POST", token: ownerTok, body: { userId: res.data.user.id, leagueId } });
    return res.data.user.id;
  }
  const ada = await addPlayer("Ada Highlight");
  const bo = await addPlayer("Bo Highlight");
  const made = await api(port, "/api/admin/fixtures", {
    method: "POST",
    token: ownerTok,
    body: { leagueId, homeId: ada, awayId: bo, week: 1, date: "2026-09-21", season: 1 },
  });
  const fixtureId = made.data.fixture?.id;
  const waiting = await api(port, "/api/stats");
  check("a fixture with no approved result is not a highlight", plain(waiting.data.highlights).includes("Nothing") === false && !plain(waiting.data.highlights).includes("Ada Highlight"));

  const approved = await api(port, `/api/admin/fixtures/${fixtureId}/result`, {
    method: "POST",
    token: ownerTok,
    body: { homeLegs: 5, awayLegs: 0, homeAvg: 62.4, awayAvg: 41, homeCheckout: 70, homeOneEighties: 1 },
  });
  check("result published", approved.status === 200 && approved.data.fixture?.status === "played");
  const after = await api(port, "/api/stats");
  const afterText = plain(after.data.highlights);
  console.log(`  ${afterText}`);
  check("the approved result is now the league highlight", afterText.includes("Ada Highlight put Bo Highlight away 5–0") && afterText.includes("Highlight Division"));
  check("the season numbers still include the new 180", after.data.total180s === 1);
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
console.log("\nAll league highlight checks passed.");
