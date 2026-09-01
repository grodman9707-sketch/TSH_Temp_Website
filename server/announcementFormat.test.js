// Tests for announcement body formatting and compose-toolbar wrapping.
// Run: `node server/announcementFormat.test.js`
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyAnnouncementFormat,
  escapeAnnouncement,
  formatAnnouncementBody,
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

check("empty body is empty html", formatAnnouncementBody("") === "");
check("whitespace-only body is empty html", formatAnnouncementBody("  \n\n  ") === "");
check(
  "plain text is a paragraph and escaped",
  formatAnnouncementBody("Hello <script>alert(1)</script>") ===
    "<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>"
);
check(
  "blank line becomes two paragraphs",
  formatAnnouncementBody("First para.\n\nSecond para.") === "<p>First para.</p><p>Second para.</p>"
);
check(
  "single newline is a line break",
  formatAnnouncementBody("Line one\nLine two") === "<p>Line one<br>Line two</p>"
);
check(
  "center block wraps inner paragraphs",
  formatAnnouncementBody("[center]Season 2 is live[/center]") ===
    '<div class="news-center"><p>Season 2 is live</p></div>'
);
check(
  "indent block wraps inner paragraphs",
  formatAnnouncementBody("[indent]Welcome back[/indent]") ===
    '<div class="news-indent"><p>Welcome back</p></div>'
);
check(
  "right block wraps inner paragraphs",
  formatAnnouncementBody("[right]The Board[/right]") ===
    '<div class="news-right"><p>The Board</p></div>'
);
check(
  "emoji and bold survive formatting",
  formatAnnouncementBody("Congrats **Alex** 🎯") === "<p>Congrats <strong>Alex</strong> 🎯</p>"
);
check(
  "italic is applied",
  formatAnnouncementBody("This is *important*") === "<p>This is <em>important</em></p>"
);
check(
  "divider line becomes hr",
  formatAnnouncementBody("Hello\n\n---\n\nWorld") === '<p>Hello</p><hr class="news-rule"><p>World</p>'
);
check(
  "dash lines become a list",
  formatAnnouncementBody("- First\n- Second") === '<ul class="news-list"><li>First</li><li>Second</li></ul>'
);
check(
  "tags inside text cannot inject html",
  formatAnnouncementBody('<img src=x onerror=alert(1)>') ===
    "<p>&lt;img src=x onerror=alert(1)&gt;</p>"
);
check(
  "nested indent inside center",
  formatAnnouncementBody("[center][indent]Deep[/indent][/center]") ===
    '<div class="news-center"><div class="news-indent"><p>Deep</p></div></div>'
);
check(
  "unclosed tag stays escaped text",
  formatAnnouncementBody("[center]oops") === "<p>[center]oops</p>"
);
check("escape helper matches formatter", escapeAnnouncement("<&>") === "&lt;&amp;&gt;");

const bold = applyAnnouncementFormat("Say hello", 4, 9, "bold");
check("bold wrap keeps word selected", bold.value === "Say **hello**" && bold.start === 6 && bold.end === 11);

const center = applyAnnouncementFormat("", 0, 0, "center");
check(
  "center insert uses placeholder",
  center.value === "[center]centered text[/center]" && center.start === 8 && center.end === 21
);

const indent = applyAnnouncementFormat("note", 0, 4, "indent");
check("indent wraps selection", indent.value === "[indent]note[/indent]");

const para = applyAnnouncementFormat("Hi", 2, 2, "para");
check("paragraph insert adds blank line", para.value === "Hi\n\n" && para.start === 4);

const emoji = applyAnnouncementFormat("Go ", 3, 3, "emoji", "🎯");
check("emoji insert at cursor", emoji.value === "Go 🎯" && emoji.start === 5 && emoji.end === 5);

const list = applyAnnouncementFormat("A\nB", 0, 3, "list");
check("list prefixes selected lines", list.value === "- A\n- B");

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-announce-fmt-"));
const port = 19000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitHealth(port, child);
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "GRodman9707@gmail.com", password: "Rodm@n85" }),
  });
  const auth = await login.json();
  check("owner can log in for news post", login.ok && Boolean(auth.token));

  const body =
    "[center]Season 2 🎯[/center]\n\nWelcome back.\n\n[indent]Check-in by Friday.[/indent]\n\n- Play your ties\n- Post both screenshots";
  const posted = await fetch(`http://127.0.0.1:${port}/api/admin/announcements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ title: "Formatted news", body }),
  });
  const created = await posted.json();
  check("formatted announcement is stored as markup", posted.ok && created.announcement?.body === body);

  const listed = await fetch(`http://127.0.0.1:${port}/api/announcements`);
  const news = await listed.json();
  const item = (news.announcements || []).find((a) => a.title === "Formatted news");
  check("public news api returns markup unchanged", item?.body === body);
  const html = formatAnnouncementBody(item?.body);
  check("stored markup renders a centered heading", html.includes('<div class="news-center"><p>Season 2 🎯</p></div>'));
  check("stored markup renders an indent", html.includes('<div class="news-indent"><p>Check-in by Friday.</p></div>'));
  check("stored markup renders a list", html.includes("<li>Play your ties</li>") && html.includes("<li>Post both screenshots</li>"));
} finally {
  child.kill("SIGTERM");
}

if (failures) process.exit(1);
console.log("announcement format tests passed");
