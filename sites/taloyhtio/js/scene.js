// The page's illustration: As Oy Koivurinne on a winter night, seen from its car park.
// SIMULATED housing company. The drawing is decorative except for one state: the building's
// shared 22 kW feed turns amber while a planned night is charging (amber means charging, as
// on Charge). Cars are plugged in, never shown charging one by one: the scheduler publishes
// only the total load, and four cars at once would be over the limit.

const W = 900;
const H = 620;
const GROUND = 432;

/** A small seeded random generator, so the scene is the same on every visit. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Number(n.toFixed(1));

function sky(rand) {
  let stars = "";
  for (let i = 0; i < 46; i++) {
    const x = f(rand() * W), y = f(rand() * 250), r = f(0.6 + rand() * 1.1);
    const tw = i % 6 === 0 ? ` class="twinkle" style="--tw:${f(2 + rand() * 3)}s;--tw-delay:${f(rand() * 3)}s"` : "";
    stars += `<circle cx="${x}" cy="${y}" r="${r}" opacity="${f(0.35 + rand() * 0.55)}"${tw}/>`;
  }
  return `<rect width="${W}" height="${H}" fill="url(#k-sky)"/>
<g class="k-stars" fill="#e9eef7">${stars}</g>
<g class="k-moon"><circle cx="716" cy="74" r="24" fill="#e9eef7" mask="url(#k-crescent)"/></g>`;
}

/** Two rows of spruce along the horizon behind the building. */
function treeline(rand) {
  const row = (base, h0, color, step) => {
    let d = `M0 ${GROUND}`;
    for (let x = -10; x < W + 20; x += step + rand() * step) {
      const h = h0 + rand() * h0 * 0.8, w = 10 + rand() * 9;
      d += ` L${f(x - w)} ${base} L${f(x - w * 0.55)} ${f(base - h * 0.45)} L${f(x - w * 0.8)} ${f(base - h * 0.45)} L${f(x)} ${f(base - h)} L${f(x + w * 0.8)} ${f(base - h * 0.45)} L${f(x + w * 0.55)} ${f(base - h * 0.45)} L${f(x + w)} ${base}`;
    }
    return `<path d="${d} L${W} ${GROUND} Z" fill="${color}"/>`;
  };
  return row(GROUND - 70, 58, "#1a3a6e", 16) + row(GROUND - 34, 50, "#1f427a", 20);
}

const WIN_LIT = "#cfdcf1";
const WIN_DIM = "#1a335e";

function windowAt(x, y, w, h, lit, rand) {
  const glass = lit ? (rand() < 0.3 ? "#e6ecf7" : WIN_LIT) : WIN_DIM;
  // A lit window sometimes has a curtain drawn on one side, which reads as a home.
  const curtain = lit && rand() < 0.45 ? `<rect x="${f(x + (rand() < 0.5 ? 0 : w * 0.62))}" y="${y}" width="${f(w * 0.38)}" height="${h}" fill="#a9bddf"/>` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${glass}"/>${curtain}<rect x="${f(x + w / 2 - 0.75)}" y="${y}" width="1.5" height="${h}" fill="#24467a"/><rect x="${x - 2}" y="${y + h}" width="${w + 4}" height="2.5" fill="#5f7db3"/>`;
}

/** A glazed balcony box, the most Finnish-apartment thing on the facade. */
function balcony(x, y, w, lit) {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="54" fill="#1d3a68"/>
<rect x="${x + 6}" y="${y + 6}" width="${f(w * 0.36)}" height="40" fill="${lit ? WIN_LIT : WIN_DIM}"/>
<rect x="${x}" y="${y}" width="${w}" height="30" fill="#5f86c4" opacity=".28"/>
<path d="M${x} ${y + 10} H${x + w} M${x + w / 3} ${y} V${y + 30} M${x + (2 * w) / 3} ${y} V${y + 30}" stroke="#9db4dc" stroke-width="1" opacity=".55"/>
<rect x="${x}" y="${y + 30}" width="${w}" height="24" fill="#2c4f86"/>
<rect x="${x - 2}" y="${y + 29}" width="${w + 4}" height="2" fill="#c9d4e8"/>
<rect x="${x - 4}" y="${y + 54}" width="${w + 8}" height="4" fill="#c9d4e8"/></g>`;
}

function building(rand) {
  const left = 168, right = 708, roof = 132, floors = [148, 218, 288, 358];
  let g = "";
  // Roof: parapet, snow cap, vents and an aerial.
  g += `<rect x="${left + 60}" y="${roof - 26}" width="46" height="28" fill="#1f3c6c"/><rect x="${left + 58}" y="${roof - 30}" width="50" height="6" rx="3" fill="#e9eef7"/>`;
  g += `<rect x="${right - 120}" y="${roof - 14}" width="16" height="16" fill="#1f3c6c"/><rect x="${right - 92}" y="${roof - 14}" width="16" height="16" fill="#1f3c6c"/>`;
  g += `<path d="M${right - 40} ${roof} V${roof - 46} M${right - 54} ${roof - 38} H${right - 26} M${right - 50} ${roof - 28} H${right - 30}" stroke="#5f7db3" stroke-width="1.5"/>`;
  // Facade, slab lines and the precast element joints.
  g += `<rect x="${left}" y="${roof}" width="${right - left}" height="${GROUND - roof}" fill="#284a80"/>`;
  g += `<rect x="${left}" y="${roof}" width="${right - left}" height="16" fill="#203f70"/>`;
  for (const y of floors) g += `<rect x="${left}" y="${y + 66}" width="${right - left}" height="4" fill="#213f70"/>`;
  for (let x = left + 45; x < right; x += 45) g += `<rect x="${x}" y="${roof + 16}" width="1" height="${GROUND - roof - 16}" fill="#2f558f" opacity=".7"/>`;
  g += `<path d="M${left - 6} ${roof + 2} Q${left - 4} ${roof - 7} ${left + 8} ${roof - 7} H${right - 8} Q${right + 4} ${roof - 7} ${right + 6} ${roof + 2} Z" fill="#e9eef7"/>`;
  // Stairwells A and B: tall lit strips, doors, canopies, lamps and letters.
  for (const [sx, letter] of [[332, "A"], [544, "B"]]) {
    g += `<rect x="${sx - 22}" y="${roof + 16}" width="44" height="${GROUND - roof - 16}" fill="#22426f"/>`;
    for (const y of floors.slice(0, 3)) g += `<rect x="${sx - 9}" y="${y + 10}" width="18" height="50" fill="${WIN_LIT}" opacity=".92"/><rect x="${sx - 9}" y="${y + 33}" width="18" height="1.5" fill="#24467a"/>`;
    g += `<rect x="${sx - 13}" y="${GROUND - 50}" width="26" height="50" fill="#0f2142"/><rect x="${sx - 10}" y="${GROUND - 46}" width="9" height="40" fill="#3b5f99"/><rect x="${sx + 1}" y="${GROUND - 46}" width="9" height="40" fill="#3b5f99"/>`;
    g += `<rect x="${sx - 26}" y="${GROUND - 58}" width="52" height="6" fill="#c9d4e8"/><rect x="${sx - 26}" y="${GROUND - 61}" width="52" height="3" fill="#e9eef7"/>`;
    g += `<rect x="${sx + 16}" y="${GROUND - 86}" width="18" height="18" rx="2" fill="#0e1f3d"/><text x="${sx + 25}" y="${GROUND - 72}" text-anchor="middle" class="k-sign">${letter}</text>`;
    g += `<circle cx="${sx}" cy="${GROUND - 66}" r="3" fill="#e9eef7"/><path d="M${sx - 4} ${GROUND - 64} L${sx - 34} ${GROUND} H${sx + 34} L${sx + 4} ${GROUND - 64} Z" fill="#e9eef7" opacity=".07"/>`;
  }
  // Apartments: balconies on the outer bays, window pairs in the middle.
  const bays = [[188, true], [250, false], [396, false], [452, false], [606, true], [664, false]];
  for (const [i, y] of floors.entries()) {
    for (const [x, hasBalcony] of bays) {
      const lit = rand() < 0.58;
      if (hasBalcony && i < 3) g += balcony(x - 14, y + 6, 72, lit);
      else if (!hasBalcony || i === 3) g += windowAt(x, y + 14, 30, 38, lit, rand);
    }
  }
  // Electrical room door with its sign, where the shared feed leaves the building.
  g += `<rect x="${right - 46}" y="${GROUND - 40}" width="24" height="40" fill="#0f2142"/><rect x="${right - 41}" y="${GROUND - 34}" width="14" height="14" fill="#e9eef7"/><path d="M${right - 33} ${GROUND - 32} l-4 6 h3 l-2 6 l5 -7 h-3 l2 -5 z" fill="#0e1f3d"/>`;
  return `<g class="k-building">${g}</g>`;
}

/** Snow banks along the building and the yard, then the car park. */
function ground() {
  return `<rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="#5c76a6"/>
<path d="M0 ${GROUND + 6} Q120 ${GROUND - 10} 240 ${GROUND + 2} T480 ${GROUND} T720 ${GROUND + 4} T${W} ${GROUND - 2} V${GROUND + 26} H0 Z" fill="#8fa5cc"/>
<path d="M150 ${GROUND + 2} q20 -16 40 0 q16 -12 30 0 Z M600 ${GROUND + 2} q22 -15 44 0 q14 -10 26 0 Z" fill="#b8c8e3"/>
<rect x="0" y="${GROUND + 44}" width="${W}" height="118" fill="#2c4a7c"/>
<rect x="0" y="${GROUND + 44}" width="${W}" height="5" fill="#b8c8e3"/>
<path d="M0 ${GROUND + 162} Q200 ${GROUND + 150} 420 ${GROUND + 160} T${W} ${GROUND + 156} V${H} H0 Z" fill="#8fa5cc"/>`;
}

const CAR_BODY = {
  hatch: "M2 30 L2 22 Q4 18 12 17 L26 16 L38 6 Q42 4 50 4 L70 4 Q76 4 80 8 L90 16 Q98 17 98 22 L98 30 Q98 32 96 32 L84 32 A9 9 0 0 0 66 32 L34 32 A9 9 0 0 0 16 32 L4 32 Q2 32 2 30 Z",
  suv: "M2 30 L2 18 Q3 14 10 13 L26 12 L34 2 L82 2 Q86 2 88 6 L94 13 Q98 14 98 20 L98 30 Q98 32 96 32 L84 32 A9 9 0 0 0 66 32 L34 32 A9 9 0 0 0 16 32 L4 32 Q2 32 2 30 Z",
};
const CAR_GLASS = {
  hatch: "M39 15 L47 7 L58 7 L58 15 Z M61 7 L71 7 Q75 8 79 15 L61 15 Z",
  suv: "M30 12 L36 5 L56 5 L56 12 Z M59 5 L80 5 Q83 6 87 12 L59 12 Z",
};
const CAR_SNOW = { hatch: "M45 4.5 Q60 -0.5 76 5 L50 5 Z", suv: "M36 2.5 Q58 -2.5 84 2.5 L40 3 Z" };

function car(x, y, kind, color, flip) {
  const t = flip ? `translate(${x + 128} ${y}) scale(-1.28 1.28)` : `translate(${x} ${y}) scale(1.28)`;
  return `<g transform="${t}"><path d="${CAR_BODY[kind]}" fill="${color}"/><path d="${CAR_GLASS[kind]}" fill="#12254a"/><path d="${CAR_SNOW[kind]}" fill="#e9eef7"/>
<rect x="3" y="22" width="5" height="3" fill="#0e1f3d" opacity=".5"/><circle cx="25" cy="32" r="7" fill="#0b1730"/><circle cx="25" cy="32" r="3" fill="#8fa5cc"/><circle cx="75" cy="32" r="7" fill="#0b1730"/><circle cx="75" cy="32" r="3" fill="#8fa5cc"/></g>`;
}

/** Four bays P1-P4, a charge post at each, three cars plugged in, and the shared feed. */
function carPark() {
  const lotY = GROUND + 49, bayW = 140, x0 = 178;
  let g = "";
  // The shared feed: from the electrical room along the kerb to every post.
  g += `<path class="k-feed" d="M686 ${GROUND} V${GROUND + 34} H${x0 + 12}" fill="none" stroke-width="3" stroke-linejoin="round"/>`;
  g += `<text x="648" y="${GROUND + 29}" text-anchor="middle" class="k-feed-label">22 kW</text>`;
  // Four cars plugged in for the night. Plugged in is not charging: the scheduler decides
  // when each one draws power, and only the shared feed shows that power is flowing.
  const parked = [["hatch", "#3d63a1"], ["suv", "#8ea4cb"], ["hatch", "#6f8bbd"], ["suv", "#4a6fae"]];
  for (let i = 0; i < 4; i++) {
    const bx = x0 + i * bayW;
    g += `<rect x="${bx}" y="${lotY + 6}" width="2" height="96" fill="#b8c8e3" opacity=".55"/>`;
    g += `<text x="${bx + bayW / 2}" y="${lotY + 100}" text-anchor="middle" class="k-bay">P${i + 1}</text>`;
    // Post on the kerb, its small screen showing "connected".
    const px = bx + 12;
    g += `<rect x="${px - 5}" y="${GROUND + 2}" width="10" height="34" rx="2" fill="#dfe7f4"/><rect x="${px - 3}" y="${GROUND + 6}" width="6" height="7" fill="#24467a"/>`;
    g += `<circle class="k-post-idle" cx="${px}" cy="${GROUND + 19}" r="2.4"/>`;
    const [kind, color] = parked[i];
    const cy = lotY + 14;
    g += car(bx + 8, cy, kind, color, false);
    // Cable from the post, down over the kerb, to the car's charge port (rear quarter).
    const port = bx + 8 + 0.08 * 128;
    g += `<path class="k-cable" d="M${px + 4} ${GROUND + 24} C${px + 16} ${GROUND + 60} ${f(port - 10)} ${cy + 40} ${f(port)} ${cy + 27}" fill="none" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  return `<g class="k-park">${g}</g>`;
}

/** Birches framing the scene, and a lamp post. Koivurinne means "birch slope". */
function birches(rand) {
  const tree = (x, top, scale) => {
    let marks = "";
    for (let y = top + 20; y < H; y += 14 + rand() * 18) {
      const w = 4 + rand() * 8;
      marks += `<rect x="${f(x - 7 * scale + rand() * 6)}" y="${f(y)}" width="${f(w * scale)}" height="${f(2 + rand() * 2)}" fill="#0e1f3d" opacity=".85"/>`;
    }
    // A weeping birch: a few limbs rise and arch out, and long thin twigs hang from them.
    let branches = "";
    for (let i = 0; i < 7; i++) {
      const by = top + 8 + i * 30 + rand() * 12, dir = i % 2 ? 1 : -1, len = (46 + rand() * 46) * scale;
      const ex = x + dir * len, ey = by - len * 0.18;
      branches += `<path d="M${x} ${f(by)} Q${f(x + dir * len * 0.45)} ${f(by - len * 0.55)} ${f(ex)} ${f(ey)}" stroke="#c9d4e8" stroke-width="${f(1.5 * scale)}" fill="none" opacity=".8"/>`;
      for (let k = 0; k < 9; k++) {
        const t = 0.25 + (k / 8) * 0.75;
        const sx = x + dir * len * t, sy = by - len * 0.55 * 2 * t * (1 - t) - len * 0.18 * t * t;
        const drop = (24 + rand() * 46) * scale, sway = dir * (4 + rand() * 8);
        branches += `<path d="M${f(sx)} ${f(sy)} q${f(sway)} ${f(drop * 0.4)} ${f(sway * 0.6)} ${f(drop)}" stroke="#a9bddf" stroke-width=".8" fill="none" opacity="${f(0.35 + rand() * 0.35)}"/>`;
      }
    }
    return `<g>${branches}<path d="M${x - 8 * scale} ${H} L${x - 3 * scale} ${top} L${x + 3 * scale} ${top} L${x + 8 * scale} ${H} Z" fill="#e4ebf6"/>${marks}</g>`;
  };
  const lx = 740;
  const lamp = `<path d="M${lx - 2} 303 L${lx - 56} ${GROUND + 44} H${lx + 52} L${lx + 2} 303 Z" fill="#e9eef7" opacity=".16"/><ellipse cx="${lx - 2}" cy="${GROUND + 44}" rx="56" ry="7" fill="#e9eef7" opacity=".12"/><rect x="${lx - 2}" y="300" width="4" height="${H - 300}" fill="#0b1730"/><path d="M${lx - 8} 300 h16 l-3 -8 h-10 z" fill="#0b1730"/><rect x="${lx - 6}" y="300" width="12" height="3" fill="#e9eef7"/>`;
  return `<g class="k-trees">${lamp}${tree(122, 150, 1.25)}${tree(770, 196, 1.05)}</g>`;
}

function snow(rand) {
  let flakes = "";
  for (let i = 0; i < 70; i++) {
    flakes += `<circle cx="${f(rand() * W)}" cy="${f(rand() * H)}" r="${f(0.8 + rand() * 1.6)}" style="--fall:${f(9 + rand() * 10)}s;--fall-delay:-${f(rand() * 18)}s;--drift:${f(-12 + rand() * 24)}px" opacity="${f(0.4 + rand() * 0.5)}"/>`;
  }
  return `<g class="k-snow" fill="#e9eef7">${flakes}</g>`;
}

/**
 * The scene as SVG markup.
 *
 * :return: A string with one <svg> element (role img, labelled for screen readers).
 */
export function sceneSvg() {
  const rand = seeded(1975);
  return `<svg class="k-scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" role="img" aria-labelledby="k-scene-title">
<title id="k-scene-title">As Oy Koivurinne at night: a four-storey block with staircases A and B, birches in the yard, and four charging places P1 to P4 in the car park, fed by one shared 22 kW connection.</title>
<defs><linearGradient id="k-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#071430"/><stop offset=".62" stop-color="#14305e"/><stop offset="1" stop-color="#22457c"/></linearGradient>
<mask id="k-crescent"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="728" cy="66" r="22" fill="#000"/></mask></defs>
${sky(rand)}${treeline(rand)}${building(rand)}${ground()}${carPark()}${birches(rand)}${snow(rand)}</svg>`;
}

export class Scene {
  /**
   * :param el: The element the scene is drawn into.
   */
  constructor(el) {
    this.el = el;
  }

  draw() {
    if (!this.el) return;
    this.el.innerHTML = sceneSvg();
  }

  /** "open" or "charging" (a planned night is running: only the shared 22 kW feed turns amber). */
  setState(state) {
    this.el?.classList.toggle("is-charging", state === "charging");
  }
}
