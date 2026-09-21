// Guard against a black homepage from invalid public/app.js.
// Run: `node server/app-js-syntax.test.js`
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJsPath = path.join(root, "public/app.js");
const parsed = spawnSync(process.execPath, ["--check", appJsPath], { encoding: "utf8" });
if (parsed.status !== 0) {
  console.error("  FAIL - public/app.js does not parse");
  if (parsed.stderr) console.error(parsed.stderr);
  process.exit(1);
}
console.log("  ok  - public/app.js parses");
console.log("app.js syntax tests passed");
