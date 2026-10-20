import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/corner-render-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/selected-corner-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic", "--external:react", "--external:react-dom", "--external:recharts", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { CornerTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
test("unconfigured corner workspace stays unavailable in both languages", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(CornerTest, { locale }));
    assert.ok(html.includes(locale === "zh" ? "至少一圈已确认" : "confirmed real-lap anchor"));
    assert.doesNotMatch(html, /<video|corner-patterns|median_time|4\.983/);
  }
});
test("configured selection shows real local video and manual uncertainty, never synthetic findings", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(CornerTest, { locale, available: true }));
    assert.match(html, /blob:local/); assert.match(html, /±0.5/);
    assert.match(html, /Corner start/); assert.doesNotMatch(html, /data-testid="corner-patterns"/);
    assert.ok(html.includes(locale === "zh" ? "不会自动修正同步" : "never rewrite synchronization"));
  }
});
