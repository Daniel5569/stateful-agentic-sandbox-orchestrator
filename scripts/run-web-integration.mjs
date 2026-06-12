import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testPath = process.argv[2];

if (!testPath) {
  console.error("Usage: node scripts/run-web-integration.mjs <vitest-test-path>");
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["--prefix", "apps/web", "exec", "--", "vitest", "run", testPath], {
  cwd: repoRoot,
  env: { ...process.env, RUN_DB_INTEGRATION: "1" },
  stdio: "inherit"
});

child.on("exit", (code) => process.exit(code ?? 1));
