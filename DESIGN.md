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
  held: "#a9bddf"
typography:
  display:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(4rem, 16vw, 7rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    fontFeature: "tnum"
  display-countdown:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(3rem, 5.6vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  display-lead:
    fontFamily: "Albert Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.15rem, 1.8vw, 1.4rem)"
    fontWeight: 600
    lineHeight: 1.3
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
  pill: "99px"
spacing:
  gutter: "clamp(16px, 4vw, 32px)"
  field-gap: "14px"
  stack: "22px"
  panel-pad: "clamp(18px, 3vw, 28px)"
  container: "1040px"
  gutter-wide: "clamp(16px, 4vw, 40px)"
  panel-pad-wide: "clamp(20px, 3.4vw, 36px)"
  section-gap: "56px"
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
  button-frost:
    backgroundColor: "{colors.frost}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "13px 22px"
  button-frost-hover:
    backgroundColor: "{colors.paper}"
  button-plain:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-plain-hover:
    backgroundColor: "{colors.frost}"
  chip-time:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  chip-time-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.frost}"
  chip-status:
    backgroundColor: "transparent"
    textColor: "{colors.muted-night}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  receipt:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "18px 20px"
  dialog-request:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "26px"
    width: "520px"
  chart-tooltip:
    backgroundColor: "{colors.frost}"
    textColor: "{colors.ink}"
    padding: "5px 10px"
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

This Kaamos world is shared. As Oy Koivurinne (sites/taloyhtio), the simulated housing company's charger page, uses the same tokens and rules on the same night and adds its own building, components and rules, recorded in the As Oy Koivurinne section below. Everything above applies to it unless that section says otherwise.

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

## As Oy Koivurinne

The same Kaamos night, its own building. Where Charge draws prices as a skyline, Koivurinne draws itself: an illustrated four-storey block seen from its car park, with tonight's state beside it. Tokens, typeface, focus rings, the frost panel, the inputs and the primary and secondary buttons are Charge's; this section records only what Koivurinne adds or does differently.

### Colors
- **Held Blue** (held): the battery charge the car already holds, in the battery gauge; also the drawn curtains in the scene's lit windows. A pale cool blue, so the amber added charge is the only warm part of the gauge.
- **Home windows** in the scene are cool frost-blue light (#cfdcf1, with an occasional brighter #e6ecf7 pane); unlit windows are a deep blue (#1a335e). These are illustration fills, not system tokens.
- **Trust line** (in the shared consent-card line, peer-card.js): green (#1d6b3a) for a fact that holds, dark amber-brown (#8a4b00) for one that does not, each paired with a drawn icon and words. These live inside the vendored runtime's consent card only.

**The Shared Feed Rule.** In the scene, amber lights only the building's shared 22 kW feed and its "22 kW" label, and only while a planned night is charging. Posts, cables and cars never turn amber: plugged in is not charging, the scheduler publishes only the total load, and the scene must never show which car charges when.

**The Cool Homes Rule.** Home windows, stairwells and lamps are cool frost-blue light, never amber. Amber in this world means charging, and homes are not charging.

### Typography
- **Countdown** (display-countdown): the hero heading's figure, the time left until requests close, at display size (max 6rem), one line (no wrapping), frost on the night.
- **Countdown lead** (display-lead): the words that open the same heading ("Requests for tonight close in"), muted-night, 600. Lead and figure are one h1; the state is said by the heading itself, with nothing above it.
- Section headings run slightly larger than Charge's (clamp(1.4rem, 3vw, 1.75rem), 700, -0.01em); rule rows are 1.05rem at 600.

### Layout
- **Hero:** two columns on desktop, the scene (1.42fr) beside the state (1fr), min-height min(80vh, 760px). The hero's background is the night sky itself, a vertical gradient (#071430 → #14305e 55% → #183766 80% → #0e1f3d) that ends in the page navy, and the scene fades into it over its right 8% (a mask) so the hero reads as one night, not two boxes.
- **At 960px and below** the hero is one column, the scene first at a fixed aspect (900/600, then 16/10 at 720px and below) and no fade mask.
- **At 720px and below** the action comes before the night's timeline, the nav wraps to its own row, the chip shortens to "Simulated", and the form, sliders and rules drop to one column.
- **Page column:** the same 1040px column with a wider gutter (gutter-wide) and 56px between sections (section-gap); frost panels pad at panel-pad-wide.

### Shapes
The control radius (10px) carries to time chips and the battery shell; the receipt uses the tile radius (12px), the request dialog the dialog radius (14px), the chart tooltip 8px.

**The One Pill Rule.** The header's "Simulated housing company" chip is the only pill (99px). Every other chip and control keeps the 10px control radius.

### Components
- **Site header:** a drawn birch-leaf mark on a dusk tile, the wordmark at 800, the status chip (pill, 1px night-line border, muted-night 0.78rem 600, no fill), and nav links in muted-night with Charge's growing underline.
- **Frost button** (button-frost): frost fill, ink text, 13px 22px, hover to paper. The hero's call to action on the night, so the one amber action stays inside the form.
- **Plain button** (button-plain): transparent with a 1px currentColor border, ink text, 12px 20px, hover to frost. The "Not now" beside an amber choice.
- **Night scene (signature):** a flat layered SVG at 900×620: sky with frost stars and crescent moon, two rows of spruce, the block with staircases A and B, glazed balconies and window pairs, snow on roof and ground, the electrical-room door, four bays P1 to P4 each with a post, a parked car and a cable, the shared feed along the kerb, two weeping birches and a lamp post in front. Drawn from a fixed seed so it is the same on every visit. Its one state is the Shared Feed Rule.
- **Load chart (the shared night):** a stepped amber area (0.9 opacity, lamp-amber top line) for all cars' kW per quarter-hour, standing directly on the night. A kW axis at 0, 11 and 22; the limit drawn as a solid 2px frost line with a 10px frost band (0.14) above it and a label; hour gridlines and ticks in night line; a muted-night baseline. Pointer and arrow keys move a frost cursor line and a frost tooltip (ink text, 700). A text summary sits beside the heading, a caption below, and a "Show the numbers" disclosure opens the full table; its marker is a drawn chevron that turns when open.
- **Select:** Charge's input with native appearance removed and a drawn dusk chevron at the right.
- **Battery gauge:** the paper shell with a 2px ink border and ink cap; held charge in held blue, added charge in amber with thin ink pane lines every 24px, widths easing over 0.25s. Under it, two labelled native range sliders ("Now", "Charge to") with live 800-weight outputs and Charge's thumb.
- **Time chips (ready by):** radio pills in the control shape: paper with a frost-line border, dusk border on hover; checked fills ink with frost text and a small frost dot before the time; focus is an ink ring on the chip.
- **Request dialog:** the site's own confirm, never the browser's: paper, 14px radius, 26px padding, max 520px, a navy backdrop (rgb(9 22 48 / .72)), the request's night, energy and ready-by as a definition list, then the amber "Send request" and a plain "Not now".
- **Receipt:** a paper card (1px frost-line border) titled "Your signed plan". Its strip is 36 quarter-hours from 22:00 to 07:00: the resident's own periods full height in amber, every other period a short line-grey cell; an axis (22:00, 02:30, 07:00) and facts below.
- **Rules rows:** hairline rows (frost line) instead of cards. The scheduler's two steps carry dusk numbers (800) in the order it applies them; the two guarantees after them carry a drawn dusk check. "What this site cannot do" rows carry a drawn mark, a muted ring with a bar through it.
- **Trust line icons:** in the consent card, each fact carries a drawn 16px stroke icon (a tick, or a warning triangle) in currentColor, 1.8 stroke, round caps; the words carry the meaning.

**The Drawn Marks Rule.** Every mark is drawn: rule numbers are type, and checks, the "cannot" ring, chevrons and trust icons are CSS borders or SVG strokes. No glyph or icon-font characters.

### Motion
All inside prefers-reduced-motion: no-preference, all off otherwise: snow falls slowly through the scene (each flake 9-19s, linear, drifting), a few stars twinkle (2-5s, alternating), and when a planned night is charging the feed draws on from the electrical room outward (1.4s, the house easing, after 0.3s). Small supporting transitions: chips and buttons press to 0.97, the disclosure chevron turns (0.2s), the battery fills ease (0.25s).

### Do and don't on Koivurinne
- **Do** say tonight's state in the hero heading itself: "Requests for tonight close in" and the countdown, no kicker or eyebrow above it.
- **Do** show the night only as the building's total load against its limit, in the scene and in the chart.
- **Do** keep the confirm in the site's own dialog, with the amber action and a plain "Not now".
- **Don't** light posts, cables, cars or home windows amber.
- **Don't** add a second pill shape; the status chip is the only one.

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
