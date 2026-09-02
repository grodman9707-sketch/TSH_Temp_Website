// Responsive layout contracts for phones, tablets, and desktops.
// Run: `node server/responsive.test.js`
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

const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

check(
  "viewport is device-width and allows pinch zoom",
  html.includes('name="viewport"') &&
    html.includes("width=device-width") &&
    html.includes("initial-scale=1") &&
    html.includes("viewport-fit=cover") &&
    !html.includes("maximum-scale=1") &&
    !html.includes("user-scalable=no")
);
check("mobile browser chrome matches the dark theme", html.includes('name="theme-color"') && html.includes("#090b11"));
check("cache-busted CSS and JS stay in lockstep", html.includes("styles.css?v=33") && html.includes("app.js?v=33"));

check("html/body clip horizontal overflow", css.includes("overflow-x: clip") && css.includes("max-width: 100%"));
check("notched phones get safe-area padding", css.includes("env(safe-area-inset-top") && css.includes("env(safe-area-inset-left") && css.includes(".site-nav"));
check("dynamic viewport height is used", css.includes("100dvh") && css.includes("calc(100dvh - 3.5rem)"));
check("hero title scales with the screen", css.includes(".hero-title") && css.includes("clamp(2.15rem, 11vw, 4.5rem)"));
check("page titles use fluid type", css.includes(".page-title") && css.includes("clamp(1.65rem, 6vw, 2.25rem)"));
check("wide league tables scroll instead of overflowing", css.includes(".table-wrap") && css.includes("min-width: 40rem") && css.includes("-webkit-overflow-scrolling: touch"));
check("league table rank column stays visible while scrolling", css.includes("position: sticky") && css.includes("nth-child(1)"));
check("datetime inputs shrink on phones", css.includes('input[type="datetime-local"]') && css.includes("min-width: 0"));
check("iOS does not pin arena backgrounds", css.includes("background-attachment: scroll") && css.includes("(hover: none)"));
check("community cards stack on small screens", css.includes(".community-card") && css.includes("flex-direction: column"));
check("division buttons drop to one column on narrow phones", css.includes(".division-grid") && css.includes("grid-template-columns: 1fr"));
check("stat columns stack before they crush", css.includes(".stat-cols") && css.includes("@media (max-width: 520px)"));
check("Sign In / Sign Up stay visible in the header CSS", css.includes(".header-auth") && css.includes("@media (min-width: 480px)"));
check("sidebar never wider than the screen", css.includes("min(18rem, 100%)"));
check("form controls stay 16px so iOS does not zoom on focus", /input, select, textarea \{\s*font-size: 1rem;/.test(css));

check("home page uses the fluid hero title", appJs.includes("hero-title") && appJs.includes("page-kicker") && appJs.includes("THE SOCIAL HUB PRESENTS"));
check("community and Discord cards share the stacking layout", appJs.includes("community-card") && (appJs.match(/community-card/g) || []).length >= 2);
check("FAQ questions wrap instead of overflowing", appJs.includes("faq-q") && appJs.includes("faq-q-text"));
check("signup steps use a shrinking track", appJs.includes("signup-steps") && appJs.includes("step-label"));
check("match and admin rows wrap", appJs.includes("split-row") && appJs.includes("header-user-name") && appJs.includes("header-crest"));
check(
  "header shows Sign In next to Sign Up on all devices",
  appJs.includes('class="btn-ghost">SIGN IN</a><a href="/sign-up" class="btn-gold">SIGN UP</a>') && !appJs.includes("hidden sm:inline-flex")
);
check("home padding is tighter on phones", appJs.includes("px-4 sm:px-6") && appJs.includes("px-4 py-12 sm:px-6 sm:py-20"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-responsive-"));
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
  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  check("served homepage keeps the responsive viewport", page.includes("width=device-width") && page.includes("viewport-fit=cover"));
  const servedCss = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
  check("served CSS includes the fluid layout rules", servedCss.includes(".hero-title") && servedCss.includes("overflow-x: clip") && servedCss.includes("100dvh"));
  const servedJs = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
  check("served app uses wrapping layout classes", servedJs.includes("community-card") && servedJs.includes("hero-title") && servedJs.includes("split-row"));
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  check("server still healthy", health.ok === true);
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

try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("responsive tests passed");
