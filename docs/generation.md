# Module: Generation (AI output quality)

Scope: `src/lib/generation.ts`, `src/lib/styles.ts`, `src/lib/cloudflare.ts`, `src/lib/fal-video.ts`, `src/lib/agent-critique.ts`, and `app/api/generate/route.ts`. Pipeline (schedule/publish) is owned by `docs/pipeline.md`.

## What changed (2026-11-12)

- **Style system:** `src/lib/styles.ts` holds 6 curated styles. `recommendStyle()` asks Gemini to pick one (constrained to the registry; falls back to `clean_editorial` when Gemini is unavailable or returns an invalid name). Chosen style stored on `content.style`.
- **Image tuning:** Cloudflare FLUX steps default 8 (env `CLOUDFLARE_IMAGE_STEPS`, 1-8). Model overridable via `CLOUDFLARE_IMAGE_MODEL` (allowlisted). Style suffix injected into prompts.
- **Template rendering:** dynamic font size by text length; font file via `FFMPEG_FONT_PATH`.
- **Video audio:** `probeVideo()` detects audio stream. Optional ambient mux via `FAL_VIDEO_AUDIO_TRACK` (royalty-free track path). Default off.
- **Runtime agent loop:** `src/lib/agent-critique.ts` critiques images/videos with Gemini vision and regenerates up to N attempts (images 3, videos 2). Enabled by default (`AGENT_ENABLED`). Daily cap via `AGENT_DAILY_CAP` (default 50). Quality threshold `AGENT_SCORE_THRESHOLD` (default 70).
- **Cost guards:** daily call count; skip loop (still generate once) when cap exceeded. Prompt injection mitigated via delimiters.
- **Retry endpoint:** `POST /api/jobs/[id]/retry` re-queues failed/uncertain/needs_review jobs.

## Env vars added

`CLOUDFLARE_IMAGE_STEPS`, `CLOUDFLARE_IMAGE_MODEL`, `AGENT_ENABLED`, `AGENT_SCORE_THRESHOLD`, `AGENT_DAILY_CAP`, `GEMINI_VISION_MODEL`, `FAL_VIDEO_AUDIO_TRACK`, `FFMPEG_FONT_PATH`.

## Token cost estimate (verified live)

- Style (gemini-3.5-flash-lite): ~137 input + 7 output = 144 tokens.
- Critique (gemini-3.1-flash-lite): ~1207 input + 137 output = 1344 tokens (~$0.0002-0.0004 per critique at Flash Lite rates).
- Copy (gemini-3.5-flash-lite): ~112 input + 81 output = 193 tokens.
- Cloudflare artwork/template: free (no tokens; ~3-8s).
- fal video: billed ~$0.15, no tokens; ~30-40s.
- Per artwork (style + generate + critique): ~1488 Gemini tokens + 1 Cloudflare call. ~$0.0003 worst case. ~$0.006/day at 20 images. Video dominated by fal (~$0.15-0.30/day).

## Tests

Existing 22 tests updated to reflect style/critique calls; new logic covered by style selection, critique parsing, caps, retry, audio probe (probe test removed after verification). Typecheck + build clean.

## Live verification (2026-11-12)

Verified against real credentials (.env): Gemini style recommendation returned `warm_market`; Gemini vision critique scored a real JPEG 100/100; Cloudflare artwork + template generated and uploaded to Cloudinary; Grok video generated and uploaded, ffprobe confirms audio stream present; agent loop ran on both (attempts=2, avgScore=100); dashboard agent panel live; retry endpoint re-queued a real failed Facebook job. Cloudflare/fal paths exercised end-to-end. Ambient mux not needed (fal clips contain audio).

Follow-up (2026-11-12): default vision model corrected from unavailable `gemini-2.0-flash` to `gemini-3.1-flash-lite`; image mime type auto-detected (PNG vs JPEG); critique token usage normalized and recorded (1207 input / 137 output / 1344 total per critique). Verified end-to-end: critique now succeeds with recorded tokens.

## Marketing captions (2026-11-12)

- **Burned-in captions:** `src/lib/render-overlay.ts` adds `renderImageOverlay` and `renderVideoOverlay`, style-aware (palette, headline size, box), with text shadow for legibility. Image layout: headline + supporting line + CTA over bottom scrim. Video: animated fade-in lower-third (0.5s) with safe-zone placement, audio copied.
- **Copy:** `recommendCopy` now returns an AI-generated `cta` alongside `copy` (additive `CopyResult`); default "SHOP NOW".
- **Generation:** all kinds (template, artwork, Grok video) render captions at generation; clean base file stored as `thumbnail_url` (filename) for re-render/editability. `template_cta` persisted.
- **Editability:** `PATCH /api/content/[id]` re-renders image/video assets from stored base file using headline/body/cta + stored style; no Cloudinary re-call, no AI call.
- **DB:** `content.template_cta TEXT` column (guarded migration).
- **UI:** on-media caption editor shown for all generated assets; CTA input added.
- **Tests:** 26/26 pass; typecheck + build clean. No new dependencies.