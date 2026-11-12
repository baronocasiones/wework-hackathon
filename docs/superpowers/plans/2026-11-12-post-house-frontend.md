# Post House frontend implementation plan

> **For agentic workers:** Execute these checked steps in order. Review the current worktree before editing because the studio UI has uncommitted changes.

**Goal:** Let the operator complete the existing create → choose media → choose channels → schedule → inspect result flow at desktop and phone widths, with readable controls and truthful status language.

**Architecture:** Use the current Post House brand and application as the source of truth. Treat the light editorial hierarchy in `/home/adrian/awesome-repo/awesome-design-md/design-md/airtable/DESIGN.md` as a design hypothesis, then compare it against the existing layout in the same operator tasks. Keep the Next.js page and CSS files; change layout, labels, and control affordances without changing API contracts or the publishing state machine. The reference describes marketing pages, so its 96px section spacing, proprietary fonts, coral palette, and marketing hero are not application requirements.

**Tech Stack:** Next.js 15, React 19, TypeScript, CSS, Lucide icons.

---

## Evidence and design decision

The current `app/page.tsx` puts five metrics ahead of creation, pairs creation with planning, then shows channel comparison, recent jobs, and monitoring in one long page. `app/styles.css` and `app/extra.css` render many labels and actions at 8–11px. At the inspected browser viewport, five metric cards take three rows before the creation form. The sidebar's **Calendar** link points to a **Recent activity** list (`app/page.tsx:145,207`), not a date grid. The mobile rule hides `.side-nav` and `.sidebar-bottom`, which also removes access to **Settings & connections**. The asset selector is visually hidden and has `pointer-events:none`; the visible **Choose different content** button tries to click that selector (`app/page.tsx:192`). The **Help center** and **Account** buttons have no handlers (`app/page.tsx:152,157`). These last three issues are source observations; test their actual browser behavior before changing them. `app/icon.svg` and `public/brand/post-house-mark.svg` already establish the new mark; preserve them.

| Reference | Relevant strength | Fit for this product |
|---|---|---|
| Airtable, `airtable/DESIGN.md` | Light canvas, dark ink, clear forms, restrained borders, occasional forest surface | A promising foundation for a content workbench. Adapt its patterns, not its brand colors or marketing spacing. |
| Linear, `linear.app/DESIGN.md` | Precise density and quiet status chips | Useful secondary cue for rows. Its near-black canvas and lavender accent conflict with the current light green identity. |
| Framer, `framer/DESIGN.md` | Strong emphasis on created media | Useful for the preview. Its dark gradient marketing treatment would compete with post artwork and operational data. |
| PostHog, `posthog/DESIGN.md` | Clear callouts and data labels | Useful for explicit simulation and live labels, though mascot and yellow CTA language do not fit Post House. |

All four reference paths in this table are relative to `/home/adrian/awesome-repo/awesome-design-md/design-md/`.

Use Post House's existing `--green: #1d503e`, paper, white cards, and mark. The proposed working targets are 14px body text, at least 12px for meaningful supporting labels, 16–20px section headings, and at least 44px for touch controls. Measure rendered values rather than assuming CSS declarations took effect. Give the selected artwork an obvious preview area. Keep live, simulated, failed, and uncertain outcomes distinct in words and color. Do not turn the activity list into a decorative calendar grid.

## Sharpened execution brief

A strong product designer would start with the operator's real task and rendered interface, not a palette comparison. Use the current DOM, computed styles, screenshots at fixed widths, keyboard traversal, actual empty and populated job states, and the repository's publishing rules as raw material. Test the Airtable-inspired treatment against the current layout on the same tasks. Make the smallest changes that remove observed friction. Keep final choices about visual taste and how much of the editorial reference to adopt open for the operator to review.

The result is right when browser evidence shows that the operator can finish the flow, distinguish simulated from live outcomes, reach setup on mobile, and recover from a failed job without guessing. A passing build alone cannot establish that. Record before and after screenshots, relevant computed sizes, keyboard order, and the status-state check beside the existing automated checks.

### Rewritten task prompt

Review and improve the existing Post House frontend for its current operator flow: create content, choose an asset and channels, schedule a post, and inspect the result. Start with the running app, current source, computed styles, keyboard order, and actual empty and populated publishing states. Compare the current layout with one Airtable-informed light editorial treatment at 1440px, 768px, and 390px; keep the Post House mark and green identity. Make the smallest changes supported by that comparison, including readable controls, mobile access to setup, accurate Activity labeling, and distinct simulated and live outcomes. Preserve API and publishing behavior. Show before and after viewport evidence, measured text and control sizes, overflow checks, keyboard results, the status-state matrix, and the project's typecheck, test, and build results. Leave the final visual preference open for my review.

## Files and boundaries

| File | Responsibility |
|---|---|
| `app/styles.css` | Base tokens, desktop hierarchy, forms, queue rows, shared focus treatment. |
| `app/extra.css` | Monitoring, setup, and existing special states; remove conflicting tiny-text rules as needed. |
| `app/page.tsx` | Accurate navigation and section labels, accessible controls and feedback. Existing data requests and handlers stay in place. |
| `app/setup/page.tsx` | Copy and visual hierarchy only if the shared typography change leaves setup too small. |
| `app/icon.svg`, `public/brand/post-house-mark.svg` | Brand assets to inspect at sidebar and favicon size, not replace as part of this pass. |

## Verification predicate

At 1440px, 768px, and 390px, the operator can reach **Create**, choose an existing asset, choose channels, inspect the simulation warning, schedule it, and identify its result. At 390px, the operator can reach **Settings & connections** and `/setup`. There is no horizontal page overflow at these widths, meaningful labels render at 12px or larger, body fields render at 14px or larger, and touch controls render at least 44px high. The **Activity** link lands on the jobs list. Keyboard focus follows the visible flow and is visible on every interactive control. A simulated job has no **View post** link; published, queued, failed, and uncertain jobs have the right label and action. Existing create, upload, schedule, post-now, preview, setup, and dashboard paths still work. `npm run typecheck`, `npm test`, and `npm run build` pass.

## Phase 1. Capture the baseline

### Task 1: Record the current UI and behavior

**Files:** Read `app/page.tsx`, `app/styles.css`, `app/extra.css`; no edits.

- [ ] Run `git status --short` and record the existing worktree changes. Do not reset or commit someone else's edits.
- [ ] Run `npm run typecheck`, `npm test`, and `npm run build`. Record failures as baseline failures before styling.
- [ ] Open `/` in the running app and capture the current 1440px, 768px, and 390px views. Capture `/setup` too. Use a disposable local asset and scheduled job, or existing demo rows, to check the complete flow. Do not click a live publication action or purchase merely for a screenshot. Check empty, queued, simulated, published, failed, and uncertain rows where available; record missing states rather than inventing a pass.
- [ ] Record baseline observations in the change description. Count content above **Start with an idea**, measure `document.documentElement.scrollWidth` against `clientWidth`, and inspect computed font sizes and control heights for the create and schedule controls. Test the asset picker, mobile settings access, and keyboard sequence before assuming the source-observed issues reproduce.
- [ ] Write down two layout hypotheses for the same flow: the current metrics-first order with readable type, and creation-first with light editorial spacing. Keep the comparison for Task 3, after the typography baseline is fixed.

## Phase 2. Change the workbench in small units

### Task 2: Set readable type and controls

**Files:** Modify `app/styles.css`, `app/extra.css`.

- [ ] In `app/styles.css`, retain the existing color variables and font imports. Add these tokens to `:root` and use them throughout meaningful app labels, inputs, controls, table cells, and rows:

```css
:root {
  --type-body: 14px;
  --type-support: 12px;
  --type-title: 20px;
  --control-height: 44px;
  --focus-ring: 0 0 0 3px #c9dfce;
}
body { font-size: var(--type-body); }
.side-nav a, .account-row, .field-label, .option-button b,
.upload-drop b, .platform-pill, .queue-post b, td,
.setup-item p { font-size: var(--type-body); }
.workspace-card small, .side-section-title, .eyebrow,
.field-label span, .option-button small, .upload-drop small,
.selected-info small, .queue-post small, .inline-note,
.table-foot, .source-chip, .status-badge, .error-hint {
  font-size: var(--type-support);
  line-height: 1.4;
}
.card-heading h2, .section-heading h2 { font-size: var(--type-title); }
.button, .option-button, .platform-pill, .schedule-row input,
.upload-fields input, .small-button { min-height: var(--control-height); }
:where(a, button, input, textarea, select):focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
  box-shadow: var(--focus-ring);
}
```

- [ ] Remove the conflicting older declarations that force those same elements back to 8–11px or 29–36px in `app/styles.css` and `app/extra.css`. Do not pile a new override block on top of contradictory declarations. Include `.idea-input`, caption textareas, template-editor fields, setup copy, and monitoring rows in the rendered-size audit. Preserve compact decorative labels only if their meaning is also conveyed in readable text.
- [ ] Reopen `/` and `/setup` at 1440px and 390px. Read computed font sizes and heights, check text clipping and keyboard focus, then run `npm run typecheck` before the next unit.
- [ ] Commit only the files changed in this unit if working on a clean dedicated branch. Otherwise leave the unit as a separate diff and document its boundary.

### Task 3: Compare content order and make the selected media prominent

**Files:** Modify `app/page.tsx`, `app/styles.css`, `app/extra.css`; keep existing handlers as they are.

- [ ] Compare the metrics-first state from Task 2 with one reversible creation-first variant at 390px and 1440px. Record which task control is visible in the first viewport and how far the operator scrolls to schedule. If creation-first helps, move the existing complete `<div className="stat-grid">...</div>` block from before `<div className="content-grid" id="create">` to immediately after that content grid. Do not rewrite metric expressions. Keep DOM, visual, and keyboard order aligned. If it does not help, restore metrics-first and record why. Leave the final visual preference open for the operator.
- [ ] At widths above 1100px, keep creation and planning side by side. Give the planner preview media more room than its current 76×85px thumbnail by enlarging `.preview-thumb` to a 120px square and letting `.selected-content` align to its top:

```css
.selected-content { align-items: flex-start; padding: 16px; }
.preview-thumb { width: 120px; height: 120px; }
.selected-info { min-height: 120px; }
.create-card, .planner-card { padding: 24px; }
.content-grid { gap: 20px; margin-bottom: 20px; }
```

- [ ] Below 740px, stack cards in source order and keep the media preview visible beside its details:

```css
@media (max-width: 740px) {
  .preview-thumb { width: 96px; height: 96px; }
  .selected-info { min-height: 96px; }
}
```

- [ ] Check 1440px, 768px, and 390px. Confirm that the chosen content order matches the DOM and keyboard order, and that asset choice, preview dialog, platform captions, and schedule controls remain reachable.
- [ ] If **Choose different content** fails in Task 1, replace its indirect click on the hidden selector with this labeled native control inside `.selected-info`. Remove the existing button that clicks the selector:

```tsx
<label htmlFor="asset-picker" className="field-label">Content</label>
<select id="asset-picker" aria-label="Choose content" value={selected}
  onChange={(event) => setContent(event.target.value)}>
  {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
</select>
```

```css
.selected-info select {
  position: static;
  opacity: 1;
  pointer-events: auto;
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font-size: 14px;
}
```

- [ ] Check selection by mouse and keyboard with two assets. The preview and platform defaults must update for the chosen asset.
- [ ] Run `npm run typecheck`. Commit this unit only on a dedicated clean branch.

### Task 4: Name the jobs list honestly and make outcomes legible

**Files:** Modify `app/page.tsx`, `app/styles.css`, `app/extra.css`.

- [ ] Change the sidebar anchor label in `app/page.tsx:145` from `Calendar` to `Activity`. Change the heading at `app/page.tsx:207` from `POSTING CALENDAR` to `PUBLISHING ACTIVITY`; keep the `id="calendar"` anchor for existing bookmarks. Change **Up next** supporting copy from `Waiting in your calendar` to `Waiting to publish`.
- [ ] Keep the existing `StatusBadge` labels in `app/page.tsx:231-233`. In the jobs row, display the provider error as wrapped text instead of truncating the only explanation:

```css
.error-hint { max-width: 32ch; white-space: normal; overflow-wrap: anywhere; }
.queue-row { min-height: 64px; }
.status-badge { font-weight: 700; }
```

- [ ] Keep `published`, `simulated`, `queued`, `processing`, `uncertain`, `needs_review`, and `failed` styles distinct. Verify text and actions against real status rows or an isolated local fixture. A simulated job must never show a **View post** link. A failed or uncertain row must expose its explanation without relying on a hover title.
- [ ] Run `npm run typecheck`, then inspect the sidebar link and jobs list at desktop and mobile widths. Commit this unit only on a dedicated clean branch.

### Task 5: Finish responsive and setup details

**Files:** Modify `app/styles.css`, `app/extra.css`; modify `app/setup/page.tsx` only if a label needs a clearer name.

- [ ] At 390px, keep navigation available. The current `@media(max-width:740px)` hides `.side-nav` entirely, so show it as a compact horizontal row beneath the mark:

```css
@media (max-width: 740px) {
  .side-nav { display: flex; gap: 8px; margin-top: 12px; overflow-x: auto; }
  .side-nav a { min-height: 44px; flex: 0 0 auto; }
  .side-nav a span { display: none; }
  .sidebar-bottom { display: block; margin-top: 8px; }
  .sidebar-bottom .side-section-title,
  .sidebar-bottom .account-row,
  .sidebar-bottom .help-link { display: none; }
  .workspace-label, .workspace-card { display: none; }
  .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

- [ ] Check that the mobile **Settings & connections** button opens its panel and exposes the `/setup` link. In `app/page.tsx`, add `aria-expanded={showSettings}` and `aria-controls="connection-settings"` to the button, and add `id="connection-settings"` to its panel. If the baseline confirms that **Help center** and **Account** do nothing, remove those two buttons and their unused imports or styles; do not invent destinations.
- [ ] Keep the setup guide's numbered steps and simulation callout, but give its body, callout, and footer at least 14px text and 1.5 line height. Add enough vertical spacing to avoid crowding at 390px. Change **Drop in a photo or video** to **Choose a photo or video** if the current upload control has no drag-and-drop behavior.
- [ ] Inspect desktop, 768px, and 390px for page overflow, text clipping, focus, long captions, long error strings, and the open media dialog. Check the brand mark at sidebar and favicon sizes. Run `npm run typecheck`, `npm test`, and `npm run build`.

## Phase 3. Verify and hand back

### Task 6: Recheck the real operator flow

**Files:** No new source files unless a concrete defect appears.

- [ ] Repeat the Task 1 browser paths against the changed UI. Compare the same viewport screenshots, computed sizes, overflow measurements, and status-state matrix. Check keyboard navigation from **Create** through asset selection, channel selection, and schedule, and from **Activity** to a job row. Treat any missing state or blocked path as inconclusive, not verified.
- [ ] Check `git diff --check` and `git status --short`. Review the source diff for accidental API, worker, and database changes. Run `npm run typecheck`, `npm test`, and `npm run build` once more if Task 5 or a defect fix changed code after their last run.
- [ ] Report what changed, the viewport and behavior evidence, and any remaining limitations. The reference's marketing page is inspiration; the Post House app remains its own identity.

## Planning verdict

This is a medium-rigor, reversible UI pass across three primary files and one setup page. The key unknowns are the actual asset-picker behavior, mobile setup access, and whether the creation-first treatment helps the core flow. Task 1 records the first two before code changes; Task 3 compares content order after typography is readable. No new dependencies or backend changes are justified by this goal. The source review is verified; the browser baseline, layout comparison, implementation, and post-change checks remain open.
