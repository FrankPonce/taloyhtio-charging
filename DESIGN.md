---
name: Charge
description: Tonight's cheapest charging hours, drawn as a Finnish winter night skyline.
colors:
  night: "#0e1f3d"
  night-2: "#16294d"
  dusk: "#24467a"
  amber: "#f4b23a"
  amber-hi: "#ffc861"
  frost: "#e9eef7"
  paper: "#ffffff"
  ink: "#0e1f3d"
  muted: "#4a5b7a"
  muted-night: "#a9b8d6"
  line: "#c9d4e8"
  line-night: "#2b4370"
  building: "#5f7db3"
  error: "#9b2c22"
  error-night: "#ff9b8f"
typography:
  display:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(4rem, 16vw, 7rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 3vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  key: "3px"
  control: "10px"
  tile: "12px"
  dialog: "14px"
  panel: "16px"
spacing:
  gutter: "clamp(16px, 4vw, 32px)"
  field-gap: "14px"
  stack: "22px"
  panel-pad: "clamp(18px, 3vw, 28px)"
  container: "1040px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "14px 24px"
  button-primary-hover:
    backgroundColor: "{colors.amber-hi}"
  button-secondary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-secondary-hover:
    backgroundColor: "{colors.dusk}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  panel-frost:
    backgroundColor: "{colors.frost}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-pad}"
  charger-tile:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "12px 8px 10px"
  charger-tile-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.frost}"
---

# Design System: Charge

## Overview

**Creative North Star: "Kaamos Blue Hour"**

The night is the interface. Charge refuses the category's white card with a blue bar chart: the page ground is a navy winter night, and tonight's spot prices stand on it as a skyline of flat building silhouettes, one building per 15-minute period, its height the price. The hours to charge are the buildings with their windows lit. Everything else follows from that picture: amber is light from a window, so it only ever means charging or the one thing to press; frost is the pale panel where people type and read.

Density is calm and mobile-first, one column up to 1040px. The answer (a huge start time) is readable before anything is touched, and controls are drawn objects (a car silhouette, a two-handle battery, a slider over the price strip, icon tiles) over native inputs rather than rows of text boxes. Surfaces are flat fills; the only gradient in the system is the sky behind the skyline, which maps clock time from dusk blue at the edges of the night to deepest navy around 01:00.

**Key Characteristics:**
- Navy night ground with frost panels laid on it; charts stand directly on the night.
- Amber reserved for charging and the single primary action.
- State shown by form as well as hue: lit buildings carry window grids, the chosen tile carries a check corner.
- One self-hosted variable sans (Albert Sans 400-800), tabular figures for every number.
- Flat, unshadowed surfaces; one orchestrated motion sequence, off under reduced motion.

## Colors

A cold two-ground palette (night and frost) with one warm light source.

### Primary
- **Lit-Window Amber** (amber): planned charging periods in the skyline, strip and price chart; the added charge on the battery; the cost figure in the hero; the one primary submit button; the focus ring on the night; text selection. Its hover step is **Lamp Amber** (amber-hi).

### Secondary
- **Dusk Blue** (dusk): links inside frost panels, hover on dark buttons and tiles, drawn tile icons, disclosure summaries. Also the light end of the sky gradient's family.

### Neutral
- **Kaamos Navy** (night): the page ground, and the same value as **Ink** (ink) for text and dark fills on frost.
- **Deep Night** (night-2): reserved for panels that stay on the night.
- **Frost** (frost): primary text on the night, and the background of every panel people type in or read at length.
- **Paper** (paper): input fields, tiles and the battery shell inside frost panels; dialogs.
- **Slate Muted** (muted): hints, secondary text and scales on frost and paper (5.9:1 and 6.8:1).
- **Night Muted** (muted-night): secondary text, nav and axis labels on the night (8.2:1).
- **Frost Line** (line) and **Night Line** (line-night): hairlines and borders on each ground; night line also marks past price bars and chart gridlines.
- **Building Blue** (building): unplanned price bars and legend keys on the night.
- **Brick Error** (error) on frost, **Coral Error** (error-night) on the night.

### Named Rules
**The Window Light Rule.** Amber means light in a window: charging, the cost of that charging, and the one primary action. Never use it for decoration, headings, stars or the moon.

**The Two Grounds Rule.** Charts and the skyline stand on the night; anything typed into or read at length sits on frost. Text colour follows the ground (frost and muted-night on night; ink and muted on frost).

## Typography

**Display Font:** Albert Sans (with Segoe UI Variable Text, Segoe UI, system-ui)
**Body Font:** Albert Sans (same stack)

**Character:** One geometric-humanist variable sans, self-hosted (fonts/albert-sans-latin.woff2, OFL, Latin subset with ä, ö, å and €). Hierarchy comes from weight and size alone: the 800-weight display numerals against 400-600 running text.

### Hierarchy
- **Display** (800, clamp(4rem, 16vw, 7rem), 0.95, -0.035em, tabular): the hero start time only.
- **Headline** (700, clamp(1.25rem, 3vw, 1.5rem), 1.2): panel headings.
- **Title** (700, 1.1rem): sub-headings and slider values (field values run at 800).
- **Body** (400, 1rem, 1.5): running text, capped at 60ch inside panels with pretty wrapping.
- **Label** (600, 0.85rem): field labels, hints (400), tile captions, chart axes (12px), legends.

### Named Rules
**The Tabular Rule.** Every time, price, kWh and percentage uses tabular figures so values do not jitter as they update live.

## Layout

A single column, max 1040px, centred, with fluid gutters (clamp(16px, 4vw, 32px)) and a 22px stack between sections. The skyline breaks out full-bleed across the viewport; its hour ticks and caption return to the column. The grid track is minmax(0, 1fr) so wide charts never stretch panels on a phone. Field groups use auto-fit columns at min 200px; charger tiles auto-fit at min 118px. At 520px and below the car row stacks with the silhouette beside its caption; at 760px and below dialog detail lists drop to one column. Charts and the skyline are drawn in screen pixels at their container's width and redrawn on resize, so labels keep their size.

## Elevation & Depth

Flat. Depth comes from the two grounds (frost panels laid on the night) and from the sky gradient behind the skyline, not from shadows. The only shadow is a small soft one under the ready-by slider thumb (0 2px 6px rgb(9 22 48 / .35)) so it reads as a grabbable object; dialogs dim the page with a navy backdrop (rgb(9 22 48 / .7)).

### Named Rules
**The No Glow Rule.** Lit windows are flat amber fills. No glows, blooms or gradients on buildings, bars or buttons.

## Shapes

Gently rounded rectangles scaled to object size: 16px panels, 14px dialogs, 12px tiles, 10px buttons, inputs and the battery shell, 3px legend keys. Buildings and price bars are square-cornered rectangles; the price chart panel on the night drops its radius and box and keeps only a top hairline. Drawn icons and car silhouettes are 2px rounded-cap strokes, never filled glyphs.

## Components

### Buttons
- **Shape:** gently rounded (10px), no border, 700 weight.
- **Primary:** Lit-Window Amber with ink text, 14px 24px, 1.05rem; one per page (the plan submit). Hover lifts to Lamp Amber.
- **Secondary:** ink fill with paper text, 12px 20px; hover dusk.
- **Link button / decline:** text-only dusk underline, or transparent with a currentColor border in dialogs, so two choices never look the same.
- **Focus:** 3px outline at 2px offset, amber on the night, ink inside frost panels and dialogs.

### Cards / Containers
- **Frost panel:** frost background, ink text, 16px radius, clamp(18px, 3vw, 28px) padding, no shadow, no border.
- **Night panel:** the price chart; no background, no radius, a single night-line top border, frost text.

### Inputs / Fields
- **Style:** paper fill, 1px frost-line border, 10px radius, 11px 12px padding, labels stacked above at 600 with 400 muted hints.
- **Error:** border and a 1px ring in Brick Error, plus a written message; never colour alone.

### Charger tiles (selection)
- **Style:** paper tiles, 12px radius, drawn 32px stroke icon in dusk over a caption and a tabular kW figure.
- **Selected:** inverts to ink with frost text and icon, and carries a frost check disc in the top-right corner.
- **Hover:** dusk border. Native radio underneath, focus ring on the tile.

### Battery gauge
A paper shell with an ink border and cap; the held charge is pale blue-grey, the charge being added is amber. Two 30px grab handles (a slim ink bar drawn inside) over two native range inputs.

### Ready-by strip and slider
A 30px strip of the same price buildings (lit in amber where charging, line-grey after the ready time) above a native range with a 6px track and a round ink thumb with a paper ring.

### Night Skyline (signature)
Full-bleed SVG on the night. Each 15-minute period is a flat building: facade height is price, unlit facades mid blue with a pale roof line, planned periods darken their facade and light an amber window grid (3-4px panes) and roof. Behind them, a horizontal sky gradient maps clock time (dusk blue toward 17:00 and 08:00, deepest navy at 01:00), with frost stars that fade toward dusk and a decorative frost "C" crescent. Hour ticks run under a frost baseline; "now" and "ready" labels pin to each end.

### Price chart
Bars on the night: building blue for future, night line for past, amber for chosen; a dashed frost "now" line; one fixed scale; a legend with square keys.

### Motion
One orchestrated sequence, only inside prefers-reduced-motion: no-preference: the skyline rises from the ground building by building (0.7s, cubic-bezier(.16, 1, .3, 1), staggered), then the charging windows switch on (0.5s), stars and moon fade in and a few stars twinkle. Later redraws only switch on newly planned periods. Small supporting transitions: nav underline grows on hover, tiles press to 0.97.

### Assistant panel
The vendored agent runtime is themed only through its --ns-* variables (frost background, ink foreground and primary, dusk accent, paper bubbles, Albert Sans) and sits on the frost panel without a second card.

## Do's and Don'ts

### Do:
- **Do** put the answer on the night first: the start time in display type, then the skyline.
- **Do** pair every status colour with a form: window grids on lit buildings, a check corner on the selected tile, a ring and message on errors.
- **Do** use frost panels for forms, explanations and the assistant; let charts stand on the night.
- **Do** use tabular figures for every number and draw charts at the container's pixel width.
- **Do** keep all motion inside prefers-reduced-motion: no-preference, as one sequence.
- **Do** theme the vendored runtime only through --ns-* variables and scoped overrides in the site stylesheet.

### Don't:
- **Don't** use amber for anything that is not charging, its cost, or the one primary action; stars and the moon stay frost.
- **Don't** add glows, drop shadows or gradients to buildings, bars, panels or buttons; the sky is the only gradient.
- **Don't** put a second primary (amber) button on the page.
- **Don't** set long reading text directly on the night; move it into a frost panel.
- **Don't** edit files under the vendored runtime to restyle it.
