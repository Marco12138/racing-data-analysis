import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";

const origin = new URL(process.env.QA_ORIGIN ?? "http://127.0.0.1:3000").origin;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname));
const sample = { name: "test-only.xrk", mimeType: "application/octet-stream", buffer: Buffer.from("<hCNF test only") };
let browser;
before(async () => { browser = await chromium.launch({ channel: "chrome" }); });
after(async () => { await browser?.close(); });

async function fixture(t, { failures = 0, available = true, path = "/review" } = {}) {
  const ctx = await browser.newContext({ locale: "zh-CN", serviceWorkers: "block" });
  const page = await ctx.newPage(), gate = Promise.withResolvers();
  const state = { checks: 0, imports: 0, available };
  t.after(async () => { gate.resolve(); await ctx.close(); });
  await ctx.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/runtime-config") return route.fulfill({ json: {
      apiOrigin: origin, apiPrefix: "/api/v1", xrkUploadUrl: origin + "/api/v1/xrk/inspect", deploymentMode: "local",
    } });
    if (url.pathname === "/api/v1/capabilities") {
      const attempt = ++state.checks;
      await gate.promise;
      if (attempt <= failures) return route.fulfill({ status: 503, json: { message: "test outage" } });
      return route.fulfill({ json: { mode: "cloud", xrk_server_import: { available: state.available, max_upload_bytes: 1000000 } } });
    }
    if (url.pathname === "/api/v1/xrk/inspect") {
      state.imports++;
      assert.ok(route.request().postDataBuffer().includes(sample.buffer));
      return route.fulfill({ status: 422, json: { message: "Test stopped at inspection" } });
    }
    if (url.pathname.startsWith("/api/v1/") || route.request().method() !== "GET") return route.abort();
    return route.continue();
  });
  await page.goto(origin + path, { waitUntil: "domcontentloaded" });
  const card = page.locator(".new-session-card").filter({ visible: true }).first();
  await card.locator('input[accept=".xrk,.xrz"]').setInputFiles(sample);
  const start = card.locator("button.new-session-card__start");
  return { page, card, start, state, release: gate.resolve };
}

for (const path of ["/review", "/workspace"]) {
  test(path + ": first click survives a transient capability failure and starts once", async t => {
    const { page, card, start, state, release } = await fixture(t, { path, failures: 1 });
    await start.click();
    await card.getByRole("status").waitFor();
    assert.equal(await start.isDisabled(), true);
    assert.equal(state.imports, 0);
    const inspect = page.waitForResponse(r => r.url().endsWith("/xrk/inspect"));
    release();
    await inspect;
    await card.getByRole("status").waitFor({ state: "detached" });
    assert.equal(state.imports, 1);
    assert.equal(state.checks, 2);
  });
}

test("cancelling while checking keeps the file and requires a fresh click", async t => {
  const { page, card, start, state, release } = await fixture(t);
  await start.click();
  await card.getByRole("button", { name: "取消等待" }).click();
  const ready = page.waitForResponse(r => r.url().endsWith("/capabilities"));
  release(); await ready;
  assert.equal(state.imports, 0);
  await card.getByText(sample.name, { exact: true }).waitFor();
  const sent = page.waitForResponse(r => r.url().endsWith("/xrk/inspect"));
  await start.click(); await sent;
  assert.equal(state.imports, 1);
});

for (const [condition, options] of [
  ["parser unavailable", { available: false }],
  ["three failed checks", { failures: 3 }],
]) test(condition + ": recheck does not send the retained file without a fresh click", async t => {
  const { page, card, start, state, release } = await fixture(t, options);
  await start.click(); release();
  await card.getByRole("alert").waitFor();
  assert.equal(await start.isDisabled(), true);
  assert.equal(state.imports, 0);
  state.available = true;
  const checked = page.waitForResponse(r => r.url().endsWith("/capabilities"));
  await card.getByRole("button", { name: "重新检查服务" }).click();
  await checked; await card.getByRole("alert").waitFor({ state: "detached" });
  await card.getByText(sample.name, { exact: true }).waitFor();
  assert.equal(state.imports, 0);
  const sent = page.waitForResponse(r => r.url().endsWith("/xrk/inspect"));
  await start.click(); await sent;
  assert.equal(state.imports, 1);
});
