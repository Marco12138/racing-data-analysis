import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, ".tmp-wechat-test");
const outFile = join(outDir, "wechat-card.mjs");

mkdirSync(outDir, { recursive: true });
execFileSync(join(root, "node_modules/.bin/esbuild"), [
  join(root, "tests/fixtures/wechat-card-entry.tsx"),
  "--bundle",
  "--format=esm",
  "--platform=node",
  "--jsx=automatic",
  "--external:react",
  "--external:react-dom",
  `--outfile=${outFile}`,
], { stdio: "pipe" });
const { buildStoryboardMetadata, renderWechatCard } = await import(pathToFileURL(outFile).href);

after(() => rmSync(outDir, { recursive: true, force: true }));

function storyboardFixture() {
  return {
    token: "share-token",
    schema_version: 1,
    watermark: "AI 生成，请与教练核实",
    analysis: {
      reference_lap: 13,
      target_lap: 10,
      fastest_lap: { lap: 13, lap_time: 40.326 },
      driver: "Marco",
      vehicle: "Kosmic",
      track: "WSK Wuhan",
    },
    video: { duration_s: 120, required: true, uploaded: false },
    nodes: [1, 2, 3, 4].map((number) => ({
      id: `corner-${number}`,
      kind: "corner",
      title: `第 ${number} 弯训练重点`,
      time_range: [10, 12],
      distance_range_m: [number * 100, number * 100 + 40],
      telemetry_overlay: {},
      insight: `真实圈证据 ${number}`,
      drill: "练习并设置停止条件",
      evidence_laps: [13, 10],
      net_gain_s: 0.1,
      corner: {
        name: `Zone ${number}`,
        entry_distance_m: number * 100,
        exit_distance_m: number * 100 + 40,
      },
      source: "llm",
    })),
  };
}

test("WeChat portrait card renders session evidence and three teaching points", () => {
  const html = renderWechatCard(storyboardFixture());
  assert.match(html, /AI 驾驶复盘/);
  assert.match(html, /Marco/);
  assert.match(html, /Kosmic/);
  assert.match(html, /40\.326s/);
  assert.match(html, /第 1 弯训练重点/);
  assert.match(html, /第 3 弯训练重点/);
  assert.doesNotMatch(html, /第 4 弯训练重点/);
  assert.match(html, /分享页二维码/);
  assert.match(html, /AI 生成，请与教练核实/);
});

test("story Open Graph metadata uses fastest real lap and static brand image", () => {
  const zh = buildStoryboardMetadata(
    storyboardFixture(),
    "zh",
    "https://frontend.example/og.png",
    "https://frontend.example/story/share-token",
  );
  const en = buildStoryboardMetadata(
    storyboardFixture(),
    "en",
    "https://frontend.example/og.png",
    "https://frontend.example/story/share-token",
  );
  assert.equal(zh.title, "AI 驾驶复盘 · 最快圈 40.326s");
  assert.equal(en.title, "AI Race Review · Fastest Lap 40.326s");
  assert.equal(zh.openGraph.images[0].url, "https://frontend.example/og.png");
});

test("storyboard actions expose the 1080x1920 WeChat PNG export", () => {
  const source = readFileSync(join(root, "frontend/components/SessionStoryboard.tsx"), "utf8");
  assert.match(source, /story\.exportWechat/);
  assert.match(source, /width:\s*1080/);
  assert.match(source, /height:\s*1920/);
  assert.match(source, /wechat-1080x1920\.png/);

  const page = readFileSync(join(root, "app/story/[token]/page.tsx"), "utf8");
  assert.match(page, /generateMetadata/);
  assert.match(page, /\/og\.png/);
});
