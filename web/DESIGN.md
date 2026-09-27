# Design system

The look of the transit surge console. Read with `../spec.md` (what to build), `DECISIONS.md` and `ARCHITECTURE.md`.
Tokens live in `src/app/globals.css`, fonts in `src/app/layout.tsx`, and the token reader for ECharts/MapLibre in `src/lib/theme/tokens.ts`.
Every contrast and colour-blindness number below was measured with a script (`contrast()` from the dataviz skill's validator, OKLab ΔE×100, Machado 2009 protan/deutan simulation). None was estimated by eye.

**Subject:** real-time bus operations in Metro Vancouver, for a TransLink service planner or dispatcher. **Primary job:** see where demand is about to surge, and approve moving a spare bus there. **Also watched by:** judges during a 5-minute live demo on a projector (1280–1920 px, washed-out colour, people at the back).

---

## 1. Pass one: the first plan

What the first draft looked like, before critique:

- **Colour:** dark "mission control" by default. Near-black `#0B0F14` with `#11161D` panels, one electric-cyan accent `#00D1FF` for every interactive and data element, and orange `#FF6B35` for alerts. The light theme was white plus zinc greys.
- **Type:** IBM Plex Sans for the UI and IBM Plex Mono for every number (clock, KPIs, tables).
- **Layout:** the side panel as a stack of identical 12 px rounded cards with soft grey shadows. KPIs as a 2×2 grid of cards, each with an ALL-CAPS label (`PINGS · LAST HOUR`), a big number and a green/red ↑↓ delta chip. "View details →" links.
- **Map:** neon glow halos (blurred, additive), cyan-to-orange gradient arcs, and surge markers and buses that also pulse.
- **Principle:** "mission control", dark and glanceable.

## 2. Critique against the generic defaults

| First-pass choice | Generic default it matches | Change and why |
|---|---|---|
| Near-black and one cyan accent, dark by default | #2 near-black with a single acid accent. Also breaks the spec (default to system). | Two themes taken from the place: **overcast inlet** (light) and **harbour at night** (dark). Both surfaces are tinted blue-green like Burrard Inlet water. The only saturated colours are semantic, and there are several, each with one job. There is no brand accent. |
| Plex Mono for numbers | #5 monospace for data labels | Proportional faces with `tnum` switched on globally, so numbers still line up. The clock and KPIs use a condensed **signage** face, as on a bus headsign or departure board. |
| `PINGS · LAST HOUR` labels | #5 caps eyebrows and middle-dot meta strings | Sentence-case labels that carry the period: "Pings, 12:00–13:00". The source goes on its own line. |
| Identical rounded cards with the same shadow | #4 the SaaS card kit | The panel is one surface, organised by hairline rules and spacing, like a printed timetable. A card appears only for an object you act on (a proposal). Radius follows object type (§6.1). Shadow is used only for things that float over the map. |
| Cyan→orange gradient arcs, neon blur | #4 gradient washes as decoration | Flat colour. The only gradient is an opacity ramp along each arc (faint at the origin, full at the hub), and it encodes **direction of flow**. No blur or glow. |
| Halos, surge markers and buses all pulsing | Motion as decoration | One ambient motion: the hub halo ripple. Everything else moves only when data or the user moves it. |
| "View details →" | #5 an arrow appended to links | Buttons and links are words only. "→" appears only where it means *from → to* in data ("route 25 → 99", "104% → 91%"). |
| ↑↓ green/red delta chips | Colour-only good/bad | Pings going up is neither good nor bad (IBCS: define good per metric). Deltas are signed numbers in ink ("+50.0%"). Only severity gets colour, and always with a shape and a word. |
| Forecast as a lighter cyan line | IBCS conflict: lighter solid means *previous period* | Forecast is **dashed**, or **outlined/hatched** for bars, with a lighter band for the 80% interval. Actual is solid and darkest. Typical is thin grey. |
| IBM Plex | Not on the skill's list, but the face I'd reach for on *any* ops dashboard | Faces from the subject: Barlow Semi Condensed (drawn, in its designer's words, from California's licence plates, highway signs, buses and trains) and Atkinson Hyperlegible Next (Braille Institute, built for low-vision legibility, so it survives a projector). |

I also checked the team's pitch deck (`hub_pulse/deck`), which uses navy, cream `#F6F4EE`, orange `#E8590C` and Oswald. Copying it would land on defaults #1 and #2. The console keeps only a distant family resemblance (a deep blue-green ink) so the pitch and the demo feel related without looking templated.

The revised timetable-row idea risks default #3 (broadsheet hairlines and zero radius). Rules are therefore used only where content really is tabular (queues, lists, KPI columns, tables). Controls and cards keep modest radii, and nothing is set in dense newspaper columns.

## 3. Final plan: "Timetable and radio"

The panels read like a **timetable**: ruled rows, tabular numbers, route plates, calm ink. The map is the **radio**: each hub sends out a slow ping ripple sized by its surge index, and origin flows run into the hub like tail-light streaks on a wet street. All the boldness is spent on the map.

### Principles

1. **One loud thing.** The map carries the colour and the only ambient motion. Panels are ink on fog: quiet, dense and ruled.
2. **Numbers like a departure board.** Every number uses tabular figures. The numbers that matter (clock, KPI values, countdowns, route numbers) use the condensed signage face. Each KPI shows a unit, a period, a comparison and a source.
3. **One notation everywhere (IBCS).** Actual is solid and darkest. Forecast is dashed or outlined, with an 80% band. Typical is thin grey. The same marks appear on the map (an UPCOMING surge is a ring, an ACTIVE surge is filled), in charts, legends, chips and load bars.
4. **Colour is semantic, never decorative, and never alone.** Every colour pairs with a shape, dash, width, icon or word. Text never wears a semantic colour: it stays in `foreground` or `muted-foreground`, with a coloured mark beside it.
5. **Calm at 3600x.** Nothing jitters: tabular digits, fixed column widths, no count-up animations, and no layout shift when values change.
6. **Words from the vocabulary.** Pings, surge index, typical, forecast, proposal, extra trip, spare route, load, one-seat ride, transfer required. Sentence case. An action keeps one name through the flow (Approve → "Trip approved").

---

## 4. Colour

### 4.1 Base palette (named)

| Name | Light | Dark | Role |
|---|---|---|---|
| Sea fog / Night inlet | `#ecf3f2` | `#0a171b` | `background`: page, panel, top bar, timeline |
| Timetable paper / Wet asphalt | `#fafdfd` | `#122126` | `card`, `popover`: proposal cards, menus, map controls, legend |
| Spruce / Rain | `#0b2b33` | `#e6efef` | `foreground`, `primary`, `actual`: ink, primary buttons, the actual series |
| Slate / Drizzle | `#4f666d` | `#8aa0a4` | `muted-foreground`: labels, sources, axis text (5.41 / 6.64 : 1) |
| Harbour | `#195fb3` | `#659fe4` | `forecast` and `ring`: dashed forecast lines, focus rings |
| Sodium | `#a9650b` | `#f8a53d` | `surge-medium`, the middle of the streetlight ramp that colours halos |

Supporting chrome: `border` `#cdd8d9` / `#2d3b3f` (hairlines); `input` `#728489` / `#62767c` (control boundaries, 3.47 / 3.82 : 1, above the 3:1 non-text minimum); `muted`/`secondary` `#e1eaea` / `#18292f`; `accent` (hover) `#dde8e8` / `#1d3037`; `destructive` = `need`.
Foreground on background is 13.26 : 1 (light) and 15.60 : 1 (dark).

### 4.2 Semantic tokens

**Rule: semantic tokens paint marks** (strokes, fills, dots, icons, bars) **and never running text.** Rows marked *marks* are below 4.5:1, so they are legal as graphics (WCAG 1.4.11 needs 3:1) but must not colour text. Every other row is also text-safe. The ratio is measured against that theme's `background`; the card column matters for proposal cards and popovers.

| Role | Light | vs bg | vs card | Dark | vs bg | vs card | Used for |
|---|---|---|---|---|---|---|---|
| `surge-low` | `#af820b` | 3.10 *marks* | 3.41 | `#face5b` | 12.20 | 11.05 | Severity LOW (1.25–1.5×): halo, surge marker, severity dot |
| `surge-medium` | `#a9650b` | 4.10 *marks* | 4.51 | `#f8a53d` | 9.07 | 8.21 | Severity MEDIUM (1.5–1.75×) |
| `surge-high` | `#9d4203` | 5.81 | 6.39 | `#f1803e` | 6.86 | 6.21 | Severity HIGH (≥1.75×); chart surge line and surge-hour shading |
| `need` | `#930223` | 8.21 | 9.03 | `#ea6067` | 5.53 | 5.01 | Overcrowded routes, target-route load, the ≥85% zone |
| `spare` | `#2c9a88` | 3.07 *marks* | 3.37 | `#88edda` | 13.18 | 11.94 | Spare/donor routes, donor load |
| `late-night` | `#582684` | 9.22 | 10.14 | `#cea9fb` | 9.29 | 8.41 | Late-night tab accents, waiting-alone-risk hours |
| `actual` | `#0b2b33` | 13.26 | 14.59 | `#e6efef` | 15.60 | 14.13 | IBCS actual: solid, darkest |
| `forecast` | `#195fb3` | 5.61 | 6.17 | `#659fe4` | 6.63 | 6.00 | IBCS forecast (dashed/outlined) and its 80% band; planned scenarios |
| `typical` | `#656e71` | 4.64 | 5.11 | `#838c8f` | 5.31 | 4.81 | IBCS typical: thin grey; typical timetables |
| `access-transfer` | `#7b0159` | 9.38 | 10.31 | `#ff8ebc` | 8.55 | 7.75 | Transfer-required arcs, bubbles and badges (emphasised) |
| `access-oneseat` | `#56717b` | 4.62 | 5.08 | `#778f97` | 5.35 | 4.85 | One-seat-ride arcs, bubbles and badges (muted by low chroma) |
| `trip-proposed` | `#40258c` | 10.03 | 11.03 | `#ab9ef2` | 7.73 | 7.00 | PROPOSED trips and RESERVED buses (preview paths) |
| `trip-active` | `#035e9d` | 6.04 | 6.64 | `#3c8bd0` | 5.03 | 4.56 | APPROVED, BUS_EN_ROUTE and IN_SERVICE trips and their buses |
| `trip-done` | `#60706f` | 4.62 | 5.08 | `#7c8e8c` | 5.30 | 4.80 | COMPLETED |
| `trip-failed` | `#6c342e` | 8.61 | 9.47 | `#d49b92` | 7.73 | 7.00 | REJECTED, EXPIRED, CANCELLED |
| `map-land` | `#f3f7f6` | 1.04 | – | `#0d1619` | 1.00 | – | Fallback map background; casing and halo colour for map marks |
| `map-water` | `#c9d8dc` | 1.30 | – | `#1a2c33` | 1.26 | – | Fallback water (and the Protomaps flavour, §7.1) |
| `map-label` | `#3f555c` | 7.00 | – | `#a9bcc0` | 9.24 | – | Fallback map labels: 7.30 / 9.29 on `map-land`, 5.38 / 7.33 on `map-water` |

`map-land` and `map-water` are area fills, so text contrast doesn't apply to them. Water vs land is 1.36 (light) and 1.27 (dark): visible, and deliberately quiet.

**Why the three light-mode *marks* exceptions:** dark yellow is physically brown. Forcing `surge-low`/`surge-medium` to 4.5:1 turned the sodium ramp into three muddy browns that were indistinguishable on a projector. `spare` had to be lighter than the blue trip colour so the two stay apart for colour-blind viewers. These three are drawn only as marks, and their labels are in ink.

**Colour-blind and co-occurrence audit.** Worst pair among colours that appear together (ΔE×100: normal vision / protan-deutan simulated). The steps inside the severity ramp are judged by the ordinal check instead.

| Where colours meet | Light | Dark |
|---|---|---|
| Map: halos, surge markers, arcs, bubbles, active trips | 11.3 / 9.9 | 10.6 / 8.1 |
| Map in preview: need and spare routes, proposed trip, surge | 10.5 / 7.9 (need vs surge-high) | 9.6 / 7.5 (need vs surge-high) |
| Map after approval: routes, active trip, halos, arcs | 10.5 / 7.9 | 9.6 / 7.5 |
| Forecast chart | 14.6 / 11.6 | 12.4 / 11.7 |
| Late-night chart | 14.6 / 10.1 | 12.4 / 6.8 (forecast vs late-night) |
| Trip status badges | 13.1 / 9.3 | 12.1 / 7.6 |
| Severity ramp (ordinal check) | monotone L, ΔL ≥ 0.06, hue spread 37°: pass | same, spread 40°: pass |

The only pairs in the 6–8 CVD band (dark late-night chart; need vs surge-high on the map) always have a second channel. Late-night hours are shaded bands with a text label, and forecast is outlined bars. Need is a thick route line, and a surge is a ring or disc at a point.
Hue logic: the warm side is reserved for **pressure** (sodium ramp for surges, signal red for need, magenta for transfer-required). The cool side is for **service and plans** (teal spare, blue active trips, harbour-blue forecast, violet proposals, purple late night). Blue active trips against warm surges and routes is the most colour-blind-robust pairing, which is why an extra trip in service is blue and not green.

### 4.3 Overlays on the basemap

Measured against CARTO's real colours (Positron land `#fafaf8` / water `#d4dadc`; Dark Matter land `#0e0e0e` / water `#2C353C`):

| Role | Light: land / water | Dark: land / water |
|---|---|---|
| `surge-low` | 3.34 / **2.47** | 12.91 / 8.35 |
| `surge-medium` | 4.41 / 3.26 | 9.60 / 6.21 |
| `surge-high` | 6.25 / 4.62 | 7.26 / 4.70 |
| `need` | 8.84 / 6.54 | 5.85 / 3.79 |
| `spare` | 3.30 / **2.44** | 13.95 / 9.02 |
| `access-transfer` | 10.09 / 7.47 | 9.05 / 5.86 |
| `access-oneseat` | 4.97 / 3.68 | 5.66 / 3.66 |
| `trip-proposed` | 10.80 / 7.98 | 8.19 / 5.30 |
| `trip-active` | 6.50 / 4.81 | 5.33 / 3.45 |
| `actual`, `typical`, `forecast`, `late-night`, `trip-done`, `trip-failed` | all ≥ 3.67 | all ≥ 3.63 |

**Casing rule:** every line and point overlay sits on a `map-land`-coloured casing (a 1.5–3 px wider line underneath, or a stroke around points). This keeps the two sub-3:1 cases (light `surge-low` and `spare` over water) at ≥3.2:1 against their own casing. It also keeps overlays readable over roads, labels and each other.

---

## 5. Type

| Face | Variable | Tailwind | Role |
|---|---|---|---|
| **Atkinson Hyperlegible Next** (variable 200–800) | `--font-sans` | `font-sans` (default) | Body, UI, tables, tooltips, chart text. Letterforms are built to be told apart (I/l/1, O/0 with a slashed zero), which suits a projector. |
| **Barlow Semi Condensed** (500, 600, 700) | `--font-heading` | `font-heading` | Headings, the sim clock, KPI values, countdowns, route plates, hub names on the map. Drawn from public signage (plates, highway signs, buses and trains) and compact, like a headsign. |

Both were verified by reading the served font files: each has `tnum`, and both default to proportional digits. `body` sets `font-variant-numeric: tabular-nums lining-nums`, so everything inherits tabular figures, including SVG chart text. No monospace face is loaded: `font-mono` falls back to the system mono and is for dev-only banners.

**Scale** (Tailwind's defaults, which follow the classical 12/14/16/18/21/24/36 progression). Nothing on screen is smaller than 12 px.

| px / line | Class | Face, weight | Use |
|---|---|---|---|
| 12 / 16 | `text-xs` | sans 400 (600 for badges) | Source notes, axis ticks, legend, timeline labels, badges |
| 14 / 20 | `text-sm` | sans 400 / 600 | **Default** body, controls, list rows, KPI labels and comparisons, tabs, table cells |
| 16 / 22 | `text-base leading-snug` | sans 600 | Chart titles (the message), proposal headline, empty-state title, insight sentence |
| 18 / 22.5 | `text-lg leading-tight` | heading 600 | Panel section headings ("Approval queue"), app name |
| 20 / 25 | `text-xl leading-tight` | heading 600 | Approval-queue countdown |
| 24 / 28 | `text-2xl leading-7` | heading 600 | Hub name in the panel header, clock time |
| 30 / 32 | `text-3xl leading-8` | heading 600 | KPI values (units in `text-base` muted, e.g. `1.79` + `×`) |
| 36 / 40 | `text-4xl` | heading 600 | The single insight figure in Origins ("48%") |

Left-align all text. Right-align numbers in tables and in the queue's countdown column. Keep line length under 70 characters (the 420 px panel does this naturally). Use no letter-spacing tricks, all-caps, italics or single-word colour accents.

---

## 6. Layout

Structure follows spec §5. Proportions and alignment:

### 6.1 Desktop ≥ 1280 px

The top bar is one 56 px row at ≥ 1600 px. At 1280–1599 px it becomes two rows (48 + 40): row 1 holds identity, clock, transport, status, theme and About; row 2 holds the scenario controls, left-aligned under the clock. The side panel is 420 px, and the timeline is 88 px.

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ Name   Sat Dec 6 2025  13:20 PST [Saturday]   ❚❚  1x 60x 300x 900x 3600x    Mock data ☾ About│ 48
│        Presets ▾   Dec 6 2025, 13:00 ▾   (●) Pause when a bus is proposed   Reset demo       │ 40
├──────────────────────────────────────────────────────────────┬────────────────────────────┤
│ [Layers ▾]          ┌ Previewing: bus from route 25 … ┐       │ All hubs                   │
│                     └ Approve  Reject  Exit ──────────┘       │ UBC                        │
│                                           ◎ Park Royal        │ 1.50× typical in the last  │
│                    ◎ Waterfront Station                       │ hour; surge forecast 13–15 │
│                                                               │ Now Origins Dispatch¹ …    │
│  (( ◉ UBC ))━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━○ Surrey         │────────────────────────────│
│    halo     ━━━━━━━━━━━━━━━━━━━━━○ Richmond                    │ Pings, 12:00–13:00│Next surge│
│                                                               │ 3,920             │ 1.79×    │
│ ┌ key ───────────────┐                                        │────────────────────────────│
│ │ ○ ● ━ ─ ┅ ▬        │                    © OpenStreetMap © CARTO│ UBC forecast to reach …    │
│ └────────────────────┘                                        │ [forecast chart]           │
├──────────────────────────────────────────────────────────────┴────────────────────────────┤
│ UBC         ────────▲─────────────────────────────────────────┃──────────────────────────  │
│ Waterfront  ─────────────────────────────────────────▲────────┃──────────────────────────  │ 88
│ Park Royal  ─────────────▲────────────────────────────────────┃──────────────────────────  │
│ Nov  Dec  Jan 2026  Feb  Mar  Apr  May  Jun  Jul  Aug          Daily totals. Surge markers… │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- Map overlays sit in corners, 12 px from the edges: layers top-left, preview chip top-centre, key bottom-left, attribution bottom-right. Toasts stack top-right **of the map area** (offset right by the panel width plus 16 px), so they never cover the panel.
- Panel: 16 px padding, sections separated by 24 px and a hairline. The panel scrolls, while the header and tab strip stay pinned.

### 6.2 Tablet 768–1279 px

```
┌────────────────────────────────────────────────────────────┐
│ Name  Sat Dec 6 13:20 PST  ❚❚  1x 60x 300x 900x 3600x  ⋯   │ 56   ⋯ = presets, date, auto-pause, reset
├──────────────────────────────────────┬─────────────────────┤
│ [Layers ▾]                           │ drawer 380 px       │
│                                      │ All hubs   UBC   ✕  │
│        (( ◉ UBC ))━━━━━━○ Surrey      │ Now Origins Disp…   │
│                                      │ …                   │
│ [key]                   [Panel]      │                     │
├──────────────────────────────────────┴─────────────────────┤
│  ▲     ▲         ▮      ▲       ┃        (56 px, markers)  │
└────────────────────────────────────────────────────────────┘
```

The drawer uses `shadow-float` and a `card` background. It opens automatically on hub selection. "Mock data" and the connection status stay in the bar; the rest moves into ⋯.

### 6.3 Phone < 768 px

```
┌──────────────────────────────┐
│ Name   13:20 PST   ❚❚     ☰  │ 48
├──────────────────────────────┤
│                              │
│   map, 45vh                  │
│      (( ◉ UBC ))             │
│ [Key]              [Timeline]│ Timeline opens a bottom sheet
├──────────────────────────────┤
│ UBC                          │
│ 1.50× typical in the last…   │
│ Now Origins Dispatch Rout…   │ horizontally scrolling tab strip
│ KPIs 2 × 2                   │
│ chart, full width            │
└──────────────────────────────┘
```

Use 12 px side padding. Hit targets are at least 44 px. There is no horizontal page scroll; only the tab strip scrolls.

---

## 7. Components

### 7.1 Radius, border, shadow, spacing

- **Radius hierarchy by object type** (`--radius: 0.375rem`):
  - 0: screen-edge structure (top bar, panel, timeline, drawer inner edge).
  - `rounded-sm` (3.6 px): **plates**, meaning route plates, load-bar tracks and fills, and severity swatches.
  - `rounded-lg` (6 px): **controls**, meaning buttons, inputs, selects, tab lists, the speed segmented control and toasts.
  - `rounded-xl` (8.4 px): **floating containers**, meaning proposal cards, popovers, menus, dialogs, map controls, the key and the preview chip.
  - `rounded-full`: **state**, meaning badges (shadcn `Badge` is already a pill), status dots, the hub core and bubbles.
  - The rule: a plate names a thing (route 99), a pill tells you its state (High, Proposed).
- **Borders for structure, shadow for flight.** Hairline `border` rules separate panel sections, list rows and KPI columns. `shadow-float` is used **only** for things over the map or over other content: map controls, key, preview chip, popovers, menus, toasts, the tablet drawer and sheets. Cards inside the panel get a border and no shadow.
- **Spacing** (4 px base): 2 · 4 · 8 · 12 · 16 · 24 · 32. Row height is 40 px desktop and 44 px touch. Panel padding is 16 px. Section gap is 24 px. Inline gap inside a row is 8 px.
- **Density:** comfortable-dense. Body is 14 px. Each list row is one line where possible, with secondary facts on a second 12 px line.

### 7.2 Specific pieces

- **KPIs:** no boxes. A 2-column grid split by a vertical hairline (it stacks 2×2 on phone). Top to bottom:
  - label in `text-sm` muted, including the period ("Pings, 12:00–13:00");
  - value in `font-heading text-3xl`, with the unit in `text-base` muted;
  - comparison in `text-sm` ink ("vs 2,614 typical (+50.0%)"; for the surge index, "vs 1.25× surge line");
  - source in `text-xs` muted ("Source: Rogers pings").

  Severity appears as a badge beside the value, never as a coloured number. Values change in place, with no count-up.
- **Route plates** (`RouteBullet`): height 20 px (18 in dense rows), min-width 28 px, horizontal padding 6 px, `rounded-sm`, `font-heading` 700 at 14 px, background `route.color` and text `route.text_color` straight from GTFS.
  - If either value is missing, use `foreground` background and `background` text.
  - If the plate is below 3:1 against the panel (white or yellow routes), add `ring-1 ring-inset ring-foreground/20`.
  - Never recolour a plate with a semantic token. Identity and state are separate: load state sits next to the plate.
- **Load bars** (`LoadBar`): an 8 px track in `muted`, on a **fixed 0–125% scale** that is never truncated (a value above 125 shows a ▸ notch and its label).
  - The zone from 85% to the end is hatched with `need` at 30% (45° lines).
  - 1 px ink ticks at 85% and 100%.
  - **Before** is a solid fill (actual). **After** is a 2 px outline box in the same colour (plan/forecast notation).
  - The colour is `need` for the target route and `spare` for the donor.
  - The label to the right is ink and tabular: "104% → 91%".
- **Badges** (shadcn `Badge`, pill): text in ink, meaning carried by a leading glyph.
  - **Severity:** ○ ring for UPCOMING, ● disc for ACTIVE, in the severity colour, plus the word ("High"). This is the same mark as the map.
  - **Access:** a short thick `access-transfer` stroke + "Transfer required", or a thin `access-oneseat` stroke + "One-seat ride".
  - **Trip status:** a lucide icon in the trip colour + the label. Proposed = `CircleDashed`, Approved or En route = `Navigation`, In service = `Bus`, Completed = `CircleCheck`, Rejected/Expired/Cancelled = `CircleX`.
  - **Day type:** a secondary badge.
  - **Mock data:** an outline badge with `FlaskConical`.
  - **Connection:** Live = filled ink dot; Reconnecting… = hollow dot; Offline = `WifiOff` in `destructive`.
- **Approval queue:** a departure board. Each row, left to right:
  - the countdown (`font-heading text-xl`, right-aligned, "32 min");
  - the hub;
  - plates "25 → 99";
  - Preview (ghost), Approve (primary, sm) and Reject (outline, sm).

  Rows are sorted by soonest expiry and separated by hairlines. The row being previewed gets an `accent` background and `ring-1 ring-trip-proposed`. When under 10 sim-min are left, the countdown turns 700-weight and adds "expires soon" in `text-xs`. Colour doesn't change.
- **Proposal card** (Dispatch tab) is the one real card: `card` background, border, `rounded-xl`, 16 px padding.
  - Headline in `text-base` 600.
  - Two load bars.
  - A facts list as a 2-column `dl` (label muted, value ink, tabular).
  - A one-sentence rationale.
  - "Evidence" in a `Collapsible`, where every item carries its source.
  - Buttons at the bottom.
  - "Alternative to a rejected proposal" is a secondary badge above the headline.
- **Toasts** (sonner): `popover` background, border, `rounded-lg`, `shadow-float`. Title in `text-sm` 600, one line of `text-sm` muted, and at most one action button (Review). The icon is coloured by subject (a new proposal uses a `trip-proposed` icon). At most 3 are visible. Position: `top-right` with `offset={{ top: 72, right: 436 }}` on desktop and `mobileOffset={{ top: 56 }}`.
- **Loading:** shadcn `Skeleton` shaped like the final content (rows, a chart block). Skeletons are **static** (the pulse is disabled in `globals.css`).
- **Empty:** in place of the rows, left-aligned, with no box or illustration:
  - an optional 20 px lucide icon in muted;
  - a title in `text-base` 600;
  - one sentence in `text-sm` muted;
  - one outline `sm` button.

  The list that is "expected to be empty" (surges away from the hubs) uses the same block without an icon, so it reads as a status line, not a failure.
- **Error:** shadcn `Alert` inline, where the data would be. It says what failed and has a Retry button. It never leaves a blank panel.
- **Stale or partial:** keep the data, and add a default `Alert` with a `Clock` icon above it: "Live connection lost. Showing data as of 13:00."
- **Tabs:** `TabsList variant="line"`, which gives an underline marker and no pill segment. The Dispatch count is a pill badge.
- **Focus:** shadcn controls bring their own ring. Everything else (hub markers, clickable rows, map controls) gets `outline: 2px solid var(--ring)` with a 2 px offset from `globals.css`.

---

## 8. Map

### 8.1 Basemap

- CARTO Positron (light) and Dark Matter (dark) are neutral greys that we don't restyle. Our palette was measured against their land and water colours (§4.3), and casings do the rest.
- **Draw order and labels:** routes, catchments, arcs and bubbles go *below* the basemap's first symbol layer (`beforeId` = the first `type: "symbol"` layer in the loaded style, looked up at runtime), so place names stay legible. Surge markers, trip paths and buses go above all basemap layers. Hub markers are HTML markers, so they sit on top automatically.
- **PMTiles fallback:** build the Protomaps flavour from our tokens: `background`/`earth` = `map-land`, `water` = `map-water`, and label fills = `map-label`. The offline map should look like ours, not a third style.
- **No tiles at all:** plain `map-land` background. Overlays and hub labels still render (hub labels are HTML).
- Attribution stays visible bottom-right (compact control), and nothing overlaps it.

### 8.2 Layers

All sizes are in screen pixels. Every mark has a `map-land` casing (§4.3).

| Layer | Rule |
|---|---|
| **Hub marker** | Focusable HTML `<button>` in a react-map-gl `<Marker>`. Core: a 12 px `foreground` disc with a 2 px `map-land` ring. Selected: 16 px with a 3 px `foreground` ring. Keyboard focus shows the global ring. The label sits right of the core (offset 10 px) in `font-heading` 600 at 15 px, `map-text-halo`, and is always visible. |
| **Hub halo** | `s = clamp((surge_index − 1.0) / 0.75, 0, 1)`, from `last_full_hour.surge_index`. There is no halo when s = 0. Radius `R = 16 + 44·s` px (16 → 60). Fill = halo colour at `8 + 22·s` %. Ring = 2 px at `35 + 55·s` % opacity. Colour = `next_surge.severity` when a surge is UPCOMING or ACTIVE, otherwise the index band from `/meta.severity_bands`. Below 1.25× it is `typical` grey: elevated, but not a surge. |
| **Halo ripple** (the one ambient motion) | Two ring elements the size of the halo (2 px border in the halo colour, `opacity-0` at rest) with `motion-safe:animate-halo` and `motion-safe:animate-halo-late`. Each ripple scales from the core out to R and fades over 3.2 s; the second starts 1.6 s later. Only when s > 0. Remove the classes on dimmed hubs during preview. Use static class maps for colour (`{ LOW: "border-surge-low", … }`), because Tailwind can't see `border-${x}`. Position the rings with `left/top: −R; width/height: 2R`, not a translate, because the keyframes own `transform`. |
| **Catchments** | Circle polygon of `catchment_m`: fill `foreground` at 4% (light) / 6% (dark), 1 px outline `foreground` at 25%. |
| **Origin arcs** | Quadratic Bézier, 48 points, control point offset by 0.2 × chord to the **left** of travel (origin → hub), so every arc bows the same way. Width `1 + 9·clamp(share_of_local_pct / 15, 0, 1)` px. **Transfer required:** `access-transfer`, a casing 2 px wider in `map-land` at 0.8, and a `line-gradient` opacity ramp from 35% at the origin to 100% at the hub (source needs `lineMetrics: true`). **One-seat ride:** `access-oneseat`, width × 0.7, the same ramp capped at 70%, no casing, drawn *below* transfer arcs. Hover/selected: +2 px and full opacity; the others drop to 30%. Round caps. |
| **Origin bubbles** | At the centroid: radius `3 + 19·√(pings / max pings)` px, fill in the access colour at 25%, 1.5 px stroke in the access colour. Labels: the top 5 and the hovered one, as HTML (`text-xs`, `map-text-halo`). |
| **Surge markers** | Size by severity (radius 8 / 10 / 12 px), colour by severity. **UPCOMING** = ring: 2.5 px stroke with a `map-land` fill at 0.85 (outlined = forecast notation). **ACTIVE** = filled disc with a 2 px `map-land` stroke (solid = actual). **RESOLVED** = disc at 30% with a 1 px `typical` stroke, shown only within 6 sim-hours. At a hub the marker frames the hub core. |
| **Trip paths** | **Service** = solid 4 px. **Deadhead** = dashed 3 px, `line-dasharray: [1.5, 1.5]`. Both sit on a `map-land` casing 3 px wider. PROPOSED (preview only) uses `trip-proposed`; APPROVED, BUS_EN_ROUTE and IN_SERVICE use `trip-active`. |
| **Buses** | 20 px SDF icon: a rounded rectangle with a pointed front, rotated by `heading_deg` (`icon-rotation-alignment: map`), with a `map-land` halo of 1.5 px. Two images, *solid* and *outline*, re-added on `styleimagemissing` so they survive theme swaps. The status mapping is below this table. |
| **Routes** | **Need** = 5 px `need` with casing. **Spare** = 3.5 px `spare` with casing. **Neutral** = 2 px `typical` at 60%, no casing. Highlighted/selected = +2 px, with an HTML route plate at the line midpoint. |
| **Labels** | Hub names are always shown. Origins show the top 5 and the hovered one. All are HTML with `map-text-halo`, so they use our fonts and don't depend on glyph servers. |

Bus status to icon and colour:

| Bus status | Icon | Colour | Size |
|---|---|---|---|
| IN_SERVICE | solid | `trip-active` | 20 px |
| DEADHEADING, WAITING | outline | `trip-active` | 20 px |
| RESERVED | outline | `trip-proposed` | 20 px |
| RETURNING, REPOSITIONING | solid | `trip-done` | 20 px |
| AVAILABLE | solid | `typical` at 70% | 16 px |

**Preview:**
- Every layer outside the preview set gets its opacity multiplied by 0.2: other hubs' halos (with their ripple stopped), unrelated arcs, bubbles, surges, trips and buses.
- The donor route is drawn in `spare` and the target route in `need`, with both plates at the midpoints.
- Paths use `trip-proposed`. The bus is shown at its current position.
- The target hub's halo stays at full strength. The basemap is untouched.

**Key** (legend, bottom-left):
- `card` background, border, `rounded-xl`, `shadow-float`, 8/12 px padding, `text-xs`, max-width 260 px.
- There is no heading. It lists only layers that are on.
- Each entry has a 28 × 14 px inline-SVG sample drawn in the real notation: ring vs disc, thick casing stroke vs thin stroke, dashed vs solid, the bus glyph, and a halo sample reading "1.0× → 1.75×".
- On phone it collapses to a "Key" button.

---

## 9. Charts (ECharts)

- **Renderer: `svg`.** Charts are small, so SVG is crisp on a projector, and SVG text inherits `tabular-nums` from `body`. Canvas cannot.
- Set the font from `getComputedStyle(document.body).fontFamily`. Colours come from `useThemeTokens()`. Rebuild the options when the tokens change.
- **Title, legend and summary are HTML, not ECharts.**
  - The title is the message ("UBC forecast to reach 1.79× typical at 13:00") in `text-base` 600.
  - Below it is a one-line HTML legend using the same inline-SVG swatches as the map key.
  - The chart container has `aria-label` set to the title plus the key numbers.
  - ECharts `title` and `legend` are off.
- **Axes:**
  - The x axis is a category axis keyed by `local_date`+`hour`, labelled every 3 h ("09:00"; the first hour of a new day shows "Sun 00:00"). Axis line 1 px `border`, no ticks, labels 12 px `muted-foreground`.
  - The y axis starts at 0, has no axis line, 4 split lines at 1 px `border`, and thousands separators. Its name goes in the HTML subtitle ("Pings per hour").
  - **Index axes always draw the 1.0 baseline:** markLine 1 px `muted-foreground`, labelled "Typical (1.00×)".
- **Grid:** `{ left: 44, right: 64, top: 12, bottom: 28 }`. The right margin leaves room for direct end labels.
- **Tooltip:** axis trigger, 1 px `muted-foreground` crosshair, `card` background, `border`, radius 8, `text-sm`. Rows in a fixed order (Actual, Forecast, 80% range, Typical, Surge line), each with its notation swatch. A forecast row says "Forecast made at 07:00 for 10:00".
- **Animation:** 300 ms `cubicOut` on data change. It is off when speed ≥ 900 or when `prefers-reduced-motion` is set.
- **No dual axes, ever.** Different units get stacked grids that share the x axis.

**Forecast chart (Now):**

| Series | Style |
|---|---|
| `actual_pings` | line, 2.5 px solid `actual`, no symbols. The CURRENT row is a hollow 7 px circle in `actual` labelled "so far". |
| `forecast_pings` | line, 2 px dashed `[6, 4]` `forecast`. HISTORY rows use the same style. |
| 80% band | two stacked lines (lower: transparent; upper − lower: area). `forecast` at 14% (light) / 22% (dark), no stroke. |
| `typical_pings` | line, 1.25 px solid `typical` |
| Surge line (typical × threshold) | line, 1.5 px dotted `[2, 3]` `surge-high`, end label "Surge line, 1.25× typical" (12 px muted) |
| `is_surge` hours | markArea `surge-high` at 8% (light) / 12% (dark), no border |
| Now | vertical markLine, 1 px solid `foreground`, label "Now" at the top |

**Late night:**
- Two grids share the hour axis.
- **Top grid (pings), bars 18 px max, 2 px gap, 3 px top radius, zero-based:**
  - typical = ghost bar in `typical` at 25%;
  - actual = solid `actual`;
  - forecast = 1.5 px `forecast` outline plus a 45° decal hatch at 35%.
- **Bottom grid (48 px, departures):** step line, 1.5 px `typical`, labelled "Typical Saturday timetable (fall 2026)". The typical timetable *is* typical notation.
- **Waiting-alone risk:** hours flagged as risk get a markArea in `late-night` at 14% across both grids, plus a 12 px label "Waiting-alone risk".

**Planner:**
- share of pings = `actual` bars;
- departures before = 1.5 px `typical` step line;
- departures after = 2 px dashed `forecast` step line (a plan is not an actual).

The same rules apply to the before → after metric pairs in the table (after in outline or dashed style).

**About:**
- Backtest MAPE by horizon: `actual` bars, zero-based.
- 80% coverage by horizon: `actual` line with an 80% reference markLine in `muted-foreground`.
- Validation: pings `actual` 2.5 px against SkyTrain `typical` 2 px with square markers every 3 h (a typical weekday profile), both direct-labelled, with "r = 0.92" in the title.

**Timeline scrubber (§17.1). Deviation that needs the owner's OK:**
- **Hub identity comes from three lanes, not colour.** One thin row per hub (UBC, Waterfront Station, Park Royal), labelled at the left in `text-xs`, each on its own y scale ("Daily totals, each hub on its own scale").
  - The selected hub's lane line is 1.5 px `foreground`; the others are 1 px `muted-foreground`.
- **Surge days** are 7 px ▲ in their hub's lane, coloured by the day's retrospective severity band, with a 1 px `background` casing.
- **Events** are a 4 px strip above the lanes, using pattern rather than hue: EXAM = solid `muted-foreground` at 35%; HOLIDAY = the same colour hatched.
- **The "now" handle** is a 2 px `foreground` line with a 12 px knob. While dragging, a date chip follows it.
- **Why this deviates:** "markers coloured by hub" needs a second categorical palette on a screen whose hues are all spent on meaning. Lanes are colour-blind-proof and read faster.
- **Tablet (56 px):** markers only, in a single lane, with the hub shown in the tooltip.

---

## 10. Motion

- **Ambient:** only the hub halo ripple (§8.2). It has a 3.2 s period, eases out, and uses two staggered rings. Nothing else loops: no pulsing badges or skeletons, no looping spinners (a pending button says "Approving…" and is disabled), and no clock-digit rolls.
- **Responsive motion is fine:**
  - drawer or sheet: 200 ms ease-out;
  - collapsible: 150 ms;
  - map `fitBounds`: 600 ms;
  - toast in: 200 ms;
  - chart transitions: 300 ms, off at ≥ 900x;
  - buses glide along their paths via rAF, outside React.
- **`prefers-reduced-motion: reduce`:**
  - no ripple (the static halo still shows size and colour, because `globals.css` hides the ripple rings);
  - `jumpTo` instead of `fitBounds` animation;
  - no chart animation;
  - buses jump to each position update;
  - all CSS animation and transition durations collapse to 0.01 ms.
- Pause the rAF loops and the ripple when the tab is hidden.

---

## 11. For the UI builders

- **Tailwind colour utilities** exist for every role (`bg-`, `text-`, `border-`, `fill-`, `stroke-`, `ring-`, `outline-`, `from-` and so on). Opacity modifiers work (`bg-surge-high/10`). The roles are `surge-low` `surge-medium` `surge-high` `need` `spare` `late-night` `actual` `forecast` `typical` `access-transfer` `access-oneseat` `trip-proposed` `trip-active` `trip-done` `trip-failed` `map-land` `map-water` `map-label`, plus the shadcn set.
  - Use `text-{role}` only on icons and SVG, never on words (Principle 4).
  - Never hard-code hex in components.
- **Fonts:** `font-sans` is Atkinson Hyperlegible Next (`--font-sans`, the default) and `font-heading` is Barlow Semi Condensed (`--font-heading`). shadcn `CardTitle` already uses `font-heading`.
- **Extras:**
  - `shadow-float` (the one elevation);
  - `rounded-sm` for plates, `rounded-lg` for controls, `rounded-xl` for floating containers;
  - `motion-safe:animate-halo` and `motion-safe:animate-halo-late` for the ripple (tune its peak opacity with `--halo-ripple-opacity`);
  - `map-text-halo` for HTML text on the map.
- **Canvas and WebGL libraries:** `useThemeTokens()` (client hook) returns hex strings for `TOKEN_NAMES` and refreshes after a theme change. `readTokens()` is the same read without React, for rAF loops. The first render returns light fallbacks so SSR matches, so don't render token values into server-rendered JSX; use the Tailwind classes there.
- **Theme swap on the map:** switch the style URL, and let the `<Source>`/`<Layer>` children re-attach. Paint values come from `useThemeTokens()`, so they update in the same render.
- **Numbers:** always format through `@/lib/format`. Tabular figures come from `body`; don't override `font-variant-numeric`.
