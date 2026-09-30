import assert from "node:assert/strict";
import { test } from "node:test";
import { bcmToBcfd, compact, dateLabel, daysBetween, escapeHtml, fmt, int, num, oil, pct, signed, toEJ } from "../src/format.js";

test("num picks decimals by magnitude", () => {
  assert.equal(num(1234.5), "1,235");
  assert.equal(num(12.345), "12.3");
  assert.equal(num(1.2345), "1.23");
  assert.equal(num(0.0456), "0.046");
  assert.equal(num(null), "–");
  assert.equal(num(NaN), "–");
  assert.equal(num(-0.0001, 1), num(0.0001, 1)); // never "-0.0"
});

test("int and pct", () => {
  assert.equal(int(1234567.8), "1,234,568");
  assert.equal(pct(42.4), "42%");
  assert.equal(pct(0.4), "<1%");
  assert.equal(pct(0), "0%");
  assert.equal(pct(12.345, 1), "12.3%");
});

test("oil switches to mb/d above 1,000 kb/d", () => {
  assert.equal(oil(640), "640 kb/d");
  assert.equal(oil(5.3), "5.3 kb/d");
  assert.equal(oil(1609), "1.61 mb/d");
  assert.equal(oil(11671), "11.7 mb/d");
  assert.equal(oil(-2400), "-2.40 mb/d");
});

test("fmt formats by unit", () => {
  assert.equal(fmt(1609, "kb/d"), "1.61 mb/d");
  assert.equal(fmt(15.89, "bcm"), "15.9 bcm");
  assert.equal(fmt(40.3, "Mt"), "40.3 Mt");
  assert.equal(fmt(456.7, "TWh"), "457 TWh");
  assert.equal(fmt(12.5, "%"), "13%");
  assert.equal(fmt(null, "bcm"), "–");
  assert.equal(fmt(3.2, "widgets"), "3.20 widgets");
});

test("signed uses a true minus sign", () => {
  assert.equal(signed(5), "+5.00");
  assert.equal(signed(-5), "−5.00");
  assert.equal(signed(0), "0.00");
});

test("compact axis labels", () => {
  assert.equal(compact(12500), "13k");
  assert.equal(compact(2500), "2.5k");
  assert.equal(compact(3.4e6), "3.4M");
  assert.equal(compact(7), "7.0");
});

test("energy conversions", () => {
  // 1 mb/d of crude ≈ 2.09 EJ/yr
  assert.ok(Math.abs(toEJ(1000, "crude") - 2.09) < 0.01);
  assert.equal(toEJ(10, "lng"), 0.36);
  assert.equal(toEJ(5, "unknown"), 0);
  // 100 bcm/yr ≈ 9.68 Bcf/d
  assert.ok(Math.abs(bcmToBcfd(100) - 9.675) < 0.01);
});

test("dates and escaping", () => {
  assert.equal(dateLabel("2026-03-02"), "2 Mar 2026");
  assert.equal(daysBetween("2026-02-28", "2026-09-20"), 204);
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});
