import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/tmp`, { recursive: true });
const dir = mkdtempSync(`${root}/tmp/guide-render-`);
execFileSync(`${root}/node_modules/.bin/esbuild`, [`${root}/tests/fixtures/guided-review-entry.tsx`, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic", "--external:react", "--external:react-dom", "--external:lucide-react", `--outfile=${dir}/entry.mjs`], { stdio: "pipe" });
const { GuideTest, ImportPanelsTest } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
const analysis = JSON.parse(readFileSync(`${root}/public/demo/reviewed-real-session.json`, "utf8")).analysis;
after(() => rmSync(dir, { recursive: true, force: true }));
test("hidden free-workspace import cannot rename the guided import region", () => {
  const html = renderToStaticMarkup(createElement(ImportPanelsTest));
  const ids = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.ok(html.includes(`<h3 id="${ids[1]}">This session&#x27;s files</h3>`));
});
test("import step does not enable uncomputed steps in either language", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(GuideTest, { locale, analysis, view: "start" }));
    assert.equal((html.match(/disabled=""/g) ?? []).length, 6);
    assert.match(html, /aria-current="step"/);
  }
});
test("overview renders the real trace and laps, missing video is explicit", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(GuideTest, { locale, analysis, view: "overview" }));
    assert.match(html, /<polyline/); assert.match(html, /km|GPS/);
    assert.ok(html.includes(locale === "zh" ? "未选择视频" : "No video selected"));
    assert.doesNotMatch(html, /theoretical|synthetic/i);
  }
});
test("debrief does not promote unconfirmed model recommendations into confirmed findings", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(createElement(GuideTest, { locale, analysis, view: "summary" }));
    assert.ok(html.includes(locale === "zh" ? "尚无两侧均确认" : "No opportunity has both clips confirmed"));
    assert.ok(html.includes(locale === "zh" ? "返回核对片段" : "Review the clips"));
    assert.doesNotMatch(html, /L\d+ is [\d.]+s|连同下游慢 [\d.]+ 秒/);
  }
});
