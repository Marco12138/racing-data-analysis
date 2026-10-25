import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = fileURLToPath(new URL("..", import.meta.url)), dir = mkdtempSync(`${root}/tmp/corner-render-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/selected-corner-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic", "--external:react", "--external:react-dom", "--external:recharts", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { CornerTest, CornerTelemetryTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
after(() => rmSync(dir, { recursive: true, force: true }));
test("unconfigured corner workspace stays unavailable in both languages", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(CornerTest, { locale }));
    assert.ok(html.includes(locale === "zh" ? "至少一圈已确认" : "confirmed real-lap anchor"));
    assert.doesNotMatch(html, /<video|corner-patterns|median_time|4\.983/);
  }
});
test("each selected video gets both AiM channels and a full lap selector in both languages", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(CornerTelemetryTest, { locale }));
    for (const lap of [3, 4, 5, 6]) assert.match(html, new RegExp(`<option value="${lap}"`));
    for (const lap of [3, 4]) for (const channel of ["speed", "rpm"]) assert.ok(html.includes(`corner-chart-L${lap}-${channel}`));
    assert.match(html, /9004/); assert.match(html, /9003/);
    assert.match(html, /±0.5/);
    assert.ok(html.includes(locale === "zh" ? "下一候选圈" : "Next candidate lap"));
    assert.ok(html.includes(locale === "zh" ? "GPS异常提示仍有效" : "GPS warnings remain"));
  }
});
test("unconfirmed candidates show curves without claiming frame sync; legacy results never fabricate samples", () => {
  const html = renderToStaticMarkup(createElement(CornerTelemetryTest, { locale: "zh", confirmed: false }));
  assert.match(html, /视频位置待确认/); assert.match(html, /data-session-time=""/);
  assert.doesNotMatch(html, /9004|9003/);
  assert.match(html, /corner-chart-L3-rpm/);
  const missing = renderToStaticMarkup(createElement(CornerTelemetryTest, { locale: "en", missing: true }));
  assert.match(missing, /no time-series telemetry/);
});
test("configured selection shows real local video and manual uncertainty, never synthetic findings", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(CornerTest, { locale, available: true }));
    assert.match(html, /blob:local/); assert.match(html, /±0.5/);
    assert.match(html, /Corner start/); assert.doesNotMatch(html, /data-testid="corner-patterns"/);
    assert.ok(html.includes(locale === "zh" ? "不会自动修正同步" : "never rewrite synchronization"));
  }
});
