# Handoff: Milestone 1 Unfinished Work and Proposed Changes

## Current State
All Milestone 1 automated checks pass:
- **Lint**: ESLint passes with 1 warning (unused eslint-disable directive in `public/mockServiceWorker.js`)
- **Typecheck**: `tsc --noEmit` passes with no errors
- **Build**: Next.js build succeeds with 1 warning (font override values for `Atkinson Hyperlegible Next`)
- **Tests**: Vitest unit tests pass (252 tests)
- **Screenshots**: Playwright screenshot tests pass (6 tests across 3 breakpoints and 2 themes)

## Completed Agent Work
- **Databricks seed-data pull**: Completed; data validated against HANDOFF.md
- **App shell and top bar**: Completed
- **Map (basemap, fallback, hubs)**: Completed
- **Mock synthesis and read endpoints**: Completed; mock-layer tests pass (57 tests)
- **Mock simulator (engine, dispatch, fake WS)**: Completed

## Open Issues & Unfinished Work

### 1. Map Label Overlap
- **Issue**: Park Royal label overlaps CARTO's "West Vancouver" label (noted by map agent)
- **Location**: Likely in map label rendering logic
- **Impact**: Visual clutter, reduces readability
- **Questions**:
  - What is the preferred strategy to resolve label overlap? (e.g., adjust label priority, offset position, reduce font size, or hide conflicting labels)
  - Should we prioritize our hub labels over basemap labels, or vice versa?

### 2. Phone Map Viewport Size
- **Issue**: Phone map appears small when attempting to fit all of Metro Vancouver (noted by map agent)
- **Location**: Map container or viewport configuration
- **Impact**: Poor usability on small screens; users may struggle to interact with the map
- **Questions**:
  - What is the expected minimum size or zoom level for the phone map?
  - Should we enforce a minimum height or adjust the layout philosophy for small screens?

### 3. React getServerSnapshot Error
- **Issue**: React error about `getServerSnapshot` appears during page load (likely from `lib/live/clock.ts` or `timeKey.ts`)
- **Location**: Suspected server-rendered component incorrectly using client-only hooks or external store
- **Impact**: Causes React hydration mismatch warning; may affect stability
- **Questions**:
  - Is the clock/timeKey intended to be used in server components? If so, how should we adapt it for server rendering?
  - Should we move initialization to a client-only wrapper or use `useEffect` to defer client-side logic?

### 4. Boxing Day Extra Trip Stop Confirmation
- **Issue**: Need to confirm which stop was used for the Boxing Day extra trip (Phibbs Exchange stop if on real R2 route, otherwise last North Vancouver stop)
- **Location**: Databricks notebooks or simulation configuration
- **Impact**: Ensures consistency between synthetic data and real-world geography
- **Questions**:
  - Which stop was ultimately used in the simulation/data? (Phibbs Exchange stop or last North Vancouver stop?)
  - Is this decision documented in the simulation code or Databricks notebooks for reference?

### 5. Findings Update (Mock Synthesis)
- **Issue**: Park Royal mismatch after rebalancing corrected to 11.5% (previously 0.6% in contract example)
- **Location**: Ensure this updated value is reflected in any documentation, UI, or reports
- **Impact**: Insights presented to users must be traceable to corrected data
- **Questions**:
  - Have all references to the old 0.6% value been updated in the codebase or documentation?
  - Are there any downstream visualizations or reports that need updating?

## Proposed Changes to Finish Milestone 1

### Immediate Fixes (Low Effort)
1. **Address lint warning**: Remove unused eslint-disable directive in `public/mockServiceWorker.js`.
2. **Address build warning**: Investigate font override warning for `Atkinson Hyperlegible Next`; ensure font is properly declared in `next.config.ts` or adjust Tailwind config.

### Design/UX Fixes
3. **Resolve map label overlap**: Implement chosen label deconfliction strategy (to be clarified via questions above).
4. **Adjust phone map viewport**: Set appropriate minimum dimensions or zoom bounds for small screens.

### Stability Fixes
5. **Fix React getServerSnapshot error**: Refactor clock/timeKey usage to be compatible with server rendering (e.g., isolate to client components, use lazy initialization).

### Documentation & Consistency
6. **Confirm and document extra trip stop**: Record the final decision in `handoff.md` or project documentation; ensure simulation/data aligns.
7. **Verify findings update**: Audit codebase for any remaining references to outdated Park Royal mismatch percentage (0.6%) and update to 11.5%.

## Dependencies & Notes
- No code changes are required to pass the automated Milestone 1 checks (they already pass).
- The open issues above are primarily design, usability, and correctness concerns that should be resolved before demo.
- All frontend changes should be made in the `frontend/` directory unless otherwise noted (Databricks confirmation may require notebook updates).

## Request for Clarification
Please answer the questions listed in each issue section to proceed with confident implementation. If any assumptions are acceptable, indicate so; otherwise, we will await your feedback before implementing changes.


## Changes Made by Codex (as of 2026-09-26)
* web/src/features/topbar/StatusControls.tsx – Fixed React getServerSnapshot error by replacing problematic useSyncExternalStore call in useThemeChoice() with direct useTheme() usage, resolving hydration mismatch while preserving theme functionality.
* web/src/features/map/layers/HubMarkers.tsx – Adjusted hub label for Park Royal to avoid overlap with CARTO's "West Vancouver" label (style={{ marginTop: hub.id === 'park-royal' ? '-2px' : 0 }}).
* web/src/features/shell/Console.tsx – Set minimum height of 200px for phone map view (added min-h-[200px] to map section className) and fixed duplicate <section aria-label="Map"> line that caused JSX parsing error.
* spec.md – Added Implementation Status section summarizing completed work and checklist.
* web/src/mocks/handlers/read.ts – Verified Park Royal mismatch percentage is correctly set to 11.5%; confirmed no outdated 0.6% references remain related to mismatch (remaining "0.6%" is only for halo ring opacity styling).

## Milestone 2b (2026-09-27, Claude): network overview, Now, Origins, timeline

- **Built in `frontend/`:** the network overview (hub cards, approval queue with Approve/Reject, active extra trips, surges away from the hubs, scorecard strip); the hub panel header and tabs; Now (arrivals/departures, KPIs, forecast chart with a ±6/12/24 h window and dispatch-event markers, driver chips, "Did it happen?", scorecard badge); Origins (typical hour / whole dataset, insight callout, ranked list, surge destinations) with map arcs, bubbles and labels; and the timeline scrubber (lanes, surge days, actionable dispatch days, exam/holiday strip, drag and keyboard seek).
- **Decisions:** `frontend/DECISIONS.md` "2b answers" (the Origins basis, no Preview until M3, timeline dispatch markers from `feed_days.json`, and defaults chosen without asking). Module map: `frontend/ARCHITECTURE.md` "Milestone 2b UI".
- **Interim:** the Dispatch tab shows the hub's queue and active trips until M3. Routes, Late night, Planner and Findings show "arrives in milestone 4".
- **Known data quirk worth a line in the pitch:** the dispatch feed's surge index (30-min slots, `surge_recommendations_backtest`) and the hourly forecast snapshot's index (`surge_forecast_hourly`) are different models on different scales. At UBC Sat Dec 6 11:30, "Next surge" says peak 1.80× while the chart title says 1.36×. Both carry their source line, and nothing is rescaled (per DECISIONS).
- **Checks:** lint, typecheck, unit tests, build, Playwright smoke (3 tests) and screenshots (`frontend/screenshots/latest/`).
