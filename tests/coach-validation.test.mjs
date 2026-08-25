import assert from "node:assert/strict";
import test from "node:test";

import { submitCoachValidation } from "../frontend/lib/feedbackApi.ts";

test("coach validation sends only the detector label contract", async () => {
  let request = null;
  const ok = await submitCoachValidation(
    "https://api.example",
    "/api/v1",
    {
      inspection_id: "a".repeat(32),
      episode_id: "lap-2-brake-1",
      pattern_id: "lap-2-brake-1:brake_release_abrupt",
      pattern_type: "BRAKE_RELEASE_ABRUPT",
      verdict: "uncertain",
      locale: "zh",
    },
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    },
  );

  assert.equal(ok, true);
  assert.equal(request.url, "https://api.example/api/v1/feedback/coach-validation");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body, {
    inspection_id: "a".repeat(32),
    episode_id: "lap-2-brake-1",
    pattern_id: "lap-2-brake-1:brake_release_abrupt",
    pattern_type: "BRAKE_RELEASE_ABRUPT",
    verdict: "uncertain",
    locale: "zh",
  });
  assert.equal("telemetry" in body, false);
  assert.equal("video" in body, false);
});

test("coach validation fails closed on transport errors", async () => {
  const ok = await submitCoachValidation(
    "https://api.example",
    "/api/v1",
    {
      inspection_id: "a".repeat(32),
      episode_id: "lap-2-brake-1",
      pattern_id: "lap-2-brake-1:brake_release_abrupt",
      pattern_type: "BRAKE_RELEASE_ABRUPT",
      verdict: "rejected",
      locale: "en",
    },
    async () => {
      throw new Error("offline");
    },
  );
  assert.equal(ok, false);
});
