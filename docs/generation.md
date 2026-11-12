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

`CLOUDFLARE_IMAGE_STEPS`, `CLOUDFLARE_IMAGE_MODEL`, `AGENT_ENABLED`, `AGENT_SCORE_THRESHOLD`, `AGENT_DAILY_CAP`, `GEMINI_VISION_MODEL`, `FAL_VIDEO_AUDIO_TRACK`, `FFMPEG_FONT_PATH`, `OVERLAY_QA_ENABLED` (`videos` default | `all` | `images` | `off`), `CLOUDFLARE_IMAGE_SEED` (klein-4b only)

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

## Generation quality arena + eval (2026-11-12)

Failure-driven hardening selected by screenshotting real rejected attempts (`./data/studio.sqlite`: 12 of 23 logged critique attempts rejected; dominant cluster = centered subject, no negative space for text, cluttered background). Four same-model candidates ran an arena harness (no cross-judge — no cross-family model; all parent model); candidate 4 became the base, with three grafts: unused-input import removal, video overlay-QA frame moved to t=1.0s (post fade-in), dead `critiqueVideoFrame` deleted.

- **Best-of-N selection:** both agent loops return the highest-scored attempt (not the last); `-1` (critique unavailable) is terminal and keeps the best real attempt; all-`-1` ⇒ `finalScore=-1`.
- **Fail-closed critique:** vision errors now return `-1`, never silent `100`; recorded as failed ai_call.
- **Multi-frame video critique:** frames at 1/6, 3/6, 5/6 of duration; min score gates acceptance; falls back to first-frame then `-1`.
- **Overlay readability QA (advisory, videos by default):** post-render/pre-upload critique with `focus: "overlay"`; one FFmpeg re-render at `fontScale 1.35` on 0<=score<70; never blocks upload; records `overlay_qa` attempts; video QA samples t=1.0s (after the fade-in); template solid-background fallback skips. `OVERLAY_QA_ENABLED` env: `videos` (default), `all`, `images`, `off`. Images skip QA by default because its ~1,450 tokens/attempt doubled image vision cost without visible quality gain (measured).
- **Scaffold:** `buildArtworkPrompt` (artwork-prompt.ts, pure) moves burgers to one-third composition with quiet blurred negative space; video prompts now also carry the style suffix; `recordAttempt` exported; typed `baseMediaUrl` (no `as any`).
- **FLUX.2 klein 4B:** opt-in via `CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-2-klein-4b` (multipart FormData, `CLOUDFLARE_IMAGE_SEED`; free daily 10k-neuron allocation applies). A/B vs schnell on the same prompt: klein 65 vs schnell 75 (single pass, one image). **Schnell stays default.**
- **Copy:** few-shot JSON example added; schema unchanged.
- **Eval harness (NOT committed):** `gitignore`d `scripts/eval-quality.ts` loads rejected-attempt prompts from SQLite (raw app prompts are never stored, so revised prompts are used), generates via `CLOUDFLARE_*`, scores via `critiqueImage`, counts errors, checks artifacts. Baseline: p1=65, p2=68, video=65. Candidate: p1=75 (accepted), p2=65 (rejected). Video re-check: min-of-3 critique = 65 (parity). n=1 per side; direction-only, never a percentage claim.
- **Tests:** +1 best-of-N loop test (first attempt 65 beats second 55); fail-closed call sites updated; 27/27 pass; typecheck + build clean. Budget spent: 5 images, 2 videos.

Follow-up (2026-11-12): image overlay QA moved behind `OVERLAY_QA_ENABLED`, default **videos** — QA's ~1,450 tokens/attempt doubled image vision spend for no visible image gain (measured 1,226 → ~1,330 input tokens across critics) and burned `AGENT_DAILY_CAP` twice as fast; images keep best-of-N / fail-closed / scaffold / rubric (~+7% tokens). `.env` for the demo gets `AGENT_DAILY_CAP=500` (2026-11-12 7:00 PM PHT demo; `AGENT_DAILY_CAP` keys on UTC calendar days, so afternoon testing had consumed 39/50 before the demo). Demo-day env change is not committed. `.env.example` documents `OVERLAY_QA_ENABLED`.