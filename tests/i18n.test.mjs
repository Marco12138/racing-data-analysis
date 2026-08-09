import assert from "node:assert/strict";
import test from "node:test";

import {
  translate,
  translationKeys,
} from "../frontend/lib/i18n.ts";
import { localeFromAcceptLanguage } from "../frontend/lib/i18nCore.ts";

test("locale selection follows the first browser language and defaults to Chinese", () => {
  assert.equal(localeFromAcceptLanguage("en-US,en;q=0.9,zh;q=0.8"), "en");
  assert.equal(localeFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh");
  assert.equal(localeFromAcceptLanguage(null), "zh");
});

test("every declared key renders in both languages without undefined", () => {
  for (const key of translationKeys) {
    for (const locale of ["zh", "en"]) {
      const value = translate(locale, key, { value: "0.123", index: 1 });
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0, `${locale}:${key}`);
      assert.doesNotMatch(value, /undefined/);
    }
  }
});

test("interpolation preserves measured values and units", () => {
  assert.equal(translate("zh", "demo.averageLoss", { value: "0.384" }), "+0.384s 平均");
  assert.equal(translate("en", "demo.averageLoss", { value: "0.384" }), "+0.384s avg");
});
