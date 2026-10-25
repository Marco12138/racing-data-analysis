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
const { GuideTest, ImportPanelsTest, selectCoachReviews } = await import(pathToFileURL(`${dir}/entry.mjs`).href);
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
    assert.ok(html.includes(locale === "zh" ? "真实有效快圈" : "Real eligible fast laps"));
    assert.match(html, /L5 · 41.055s/);
    assert.ok(html.includes(locale === "zh" ? "GPS 异常提示不会因片段确认而解除" : "clip confirmation never clears GPS warnings"));
    assert.match(html, /±0.5/);
    assert.doesNotMatch(html, /L\d+ is [\d.]+s|连同下游慢 [\d.]+ 秒/);
  }
});
test("new coach evidence reaches bilingual debrief independently of legacy votes", () => {
  const review = selectCoachReviews(analysis)[0];
  const evidence = { id: review.id, name: review.name, videoConfirmed: true, contextComplete: true,
    comparison: { status: "available", section: { lap: 4 }, overall: { lap: 5 }, gain_s: .1,
      downstream_gain_s: -.3, combined_gain_s: -.2, downstream_gps_warning: false,
      parts: [{ index: 0, gain_s: .2 }, { index: 1, gain_s: -.1 }, { index: 2, gain_s: 0 }] } };
  for (const locale of ["zh", "en"]) {
    const render = () => renderToStaticMarkup(createElement(GuideTest, { locale, analysis, view: "summary", coachEvidence: [evidence] }));
    evidence.contextComplete = true;
    let html = render();
    assert.match(html, /0.100/); assert.match(html, /0.200/);
    assert.ok(html.includes(locale === "zh" ? "局部优势没有保持到下游" : "The local gain did not last downstream"));
    assert.doesNotMatch(html, /先确认一个片段|Confirm a clip first/);
    evidence.contextComplete = false; html = render();
    assert.ok(html.includes(locale === "zh" ? "先补齐减速" : "Resolve missing approach"));
    assert.ok(html.includes(locale === "zh" ? "不能称为完整弯道" : "not a complete corner"));
  }
});
