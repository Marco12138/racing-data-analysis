import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const requestedRoots = process.argv.slice(2);
const roots = requestedRoots.length ? requestedRoots : ["dist/client"];
const forbidden = ["http://127.0.0.1:8000", "http://localhost:8000"];
const violations = [];

for (const root of roots) {
  await scan(root).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

if (violations.length) {
  console.error("Public client bundle contains a loopback API URL:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Public bundle API URL check passed.");

async function scan(path) {
  const details = await stat(path);
  if (details.isDirectory()) {
    for (const entry of await readdir(path)) await scan(join(path, entry));
    return;
  }
  if (!/\.(js|mjs|html|json)$/.test(path)) return;
  const contents = await readFile(path, "utf8");
  for (const value of forbidden) {
    if (contents.includes(value)) violations.push(`${path}: ${value}`);
  }
}
