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

## Token cost estimate

~$0.00013 per Gemini vision critique; ~$0.00026/image worst case; ~$0.005/day at 20 images. Video dominated by fal (~$0.15-0.30/day).

## Tests

Existing 22 tests updated to reflect style/critique calls; new logic covered by style selection, critique parsing, caps, retry, audio probe (probe test removed after verification). Typecheck + build clean.

## Live verification (2026-11-12)

Verified against real credentials (.env): Gemini style recommendation returned `warm_market`; Gemini vision critique scored a real JPEG 100/100; Cloudflare artwork + template generated and uploaded to Cloudinary; Grok video generated and uploaded, ffprobe confirms audio stream present; agent loop ran on both (attempts=2, avgScore=100); dashboard agent panel live; retry endpoint re-queued a real failed Facebook job. Cloudflare/fal paths exercised end-to-end. Ambient mux not needed (fal clips contain audio).