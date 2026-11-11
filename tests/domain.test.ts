import assert from "node:assert/strict";
import test from "node:test";
import { allowedPlatformCaption, allowedPlatforms, parseUsage, wrapText } from "../src/lib/domain";
import { aggregateUsage } from "../src/lib/monitoring";

test("image and video formats expose only supported platforms", () => {
  assert.deepEqual(allowedPlatforms("image"), ["facebook", "instagram"]);
  assert.deepEqual(allowedPlatforms("video"), ["facebook", "instagram", "youtube"]);
});

test("platform captions contain distinct tracked product links", () => {
  const facebook = allowedPlatformCaption("New collection", "facebook", "campaign-7", "https://demo.example");
  const instagram = allowedPlatformCaption("New collection", "instagram", "campaign-7", "https://demo.example");
  assert.match(facebook, /platform=facebook/);
  assert.match(instagram, /platform=instagram/);
  assert.notEqual(facebook, instagram);
});

test("tracked Instagram caption reserves room for the complete product URL", () => {
  const caption = allowedPlatformCaption("x".repeat(4000), "instagram", "campaign-7", "https://demo.example");
  assert.ok(caption.length <= 2200);
  assert.match(caption, /https:\/\/demo\.example\/product\?platform=instagram&campaign=campaign-7$/);
  assert.ok(caption.startsWith("x"));
});

test("pubmat and video text wrap to safe line widths and cap rendered lines", () => {
  const pubmat = wrapText("A headline and supporting copy that must wrap before the panel edge", 16, 3);
  const video = wrapText("A longer video caption that needs multiple lines and must stay inside its overlay", 18, 3);
  for (const rendered of [pubmat, video]) {
    const lines = rendered.split("\n");
    assert.ok(lines.length <= 3);
    assert.ok(lines.every((line) => line.length <= 18));
  }
  assert.match(pubmat, /…$/);
  assert.match(video, /…$/);
});

test("provider usage is kept and missing usage stays unavailable", () => {
  assert.deepEqual(parseUsage({ usage: { input_tokens: 18, output_tokens: 7, total_tokens: 25 } }), { inputTokens: 18, outputTokens: 7, totalTokens: 25 });
  assert.deepEqual(parseUsage(undefined), { inputTokens: null, outputTokens: null, totalTokens: null });
  assert.deepEqual(aggregateUsage([
    { input_tokens: 18, output_tokens: 7, total_tokens: 25 },
    { input_tokens: null, output_tokens: null, total_tokens: null },
    { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
  ]), { inputTokens: 22, outputTokens: 13, totalTokens: 35 });
  assert.deepEqual(aggregateUsage([{ input_tokens: null, output_tokens: null, total_tokens: null }]), { inputTokens: null, outputTokens: null, totalTokens: null });
});
