import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run in dependency order and stop at the first failure. GPU scenarios consume the production build.
const checks = [
  "lint",
  "format:check",
  "test",
  "build",
  "validate:gpu",
  "validate:assets",
  "validate:game",
  "validate:features",
  "validate:hdr",
  "validate:quality",
  "validate:post",
  "validate:recovery",
  "validate:environments",
  "validate:codecs",
];
const root = fileURLToPath(new URL("../", import.meta.url));
for (const check of checks) {
  const result = spawnSync("pnpm", ["run", check], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, RENDERER_PREVIEW: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
