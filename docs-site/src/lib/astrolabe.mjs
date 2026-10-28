// The astrolabe drawn in the landing hero and on the social card.
//
// One generator for both, so the two never drift apart. It is drawn as a page
// from a Renaissance notebook: ink linework given a hand's wobble by an SVG
// displacement filter, doubled strokes where a pen went round twice, compass
// construction lines that overshoot the instrument, cross-hatched shading, and
// notes in an old italic hand (one of them mirror-written).
//
// The parts are the real instrument's: the shackle it hangs from, the limb with
// its degree scale, the plate engraved with altitude circles, the rete (the
// openwork star map that turns over the plate, its pointers marking stars) and
// the alidade (the sighting rule). Here the stars are what Astur reaches.

const CX = 300;
const CY = 340;
const LIMB_OUTER = 262;
const LIMB_INNER = 214;

/** Point at `r` from the centre, `deg` clockwise from twelve o'clock. */
function at(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

const fmt = (n) => Math.round(n * 100) / 100;
const xy = (r, deg) => at(r, deg).map(fmt).join(' ');

/** Deterministic jitter, so every render draws the same "hand". */
function jitter(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280 - 0.5;
  };
}

/** A circle drawn the way a pen goes round: twice, never quite on itself. */
function inkCircle(cx, cy, r, cls, seed) {
  const j = jitter(seed);
  return `<circle class="${cls}" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"/>`
    + `<circle class="${cls} astro-retrace" cx="${fmt(cx + j() * 1.6)}" cy="${fmt(cy + j() * 1.6)}" r="${fmt(r + j() * 1.4)}"/>`;
}

function defs(id) {
  return `<defs>
    <filter id="${id}-ink" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <pattern id="${id}-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
      <line x1="0" y1="0" x2="0" y2="5" class="astro-hatch-line"/>
    </pattern>
    <pattern id="${id}-cross" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
      <line x1="0" y1="0" x2="0" y2="6" class="astro-hatch-line astro-hatch-line--dark"/>
      <line x1="0" y1="0" x2="6" y2="0" class="astro-hatch-line astro-hatch-line--dark"/>
    </pattern>
    <clipPath id="${id}-plate"><circle cx="${CX}" cy="${CY}" r="${LIMB_INNER}"/></clipPath>
    <clipPath id="${id}-mater"><circle cx="${CX}" cy="${CY}" r="${LIMB_OUTER}"/></clipPath>
  </defs>`;
}

/** Compass work left on the page: guide lines and circles past the edges. */
function construction() {
  return `<g class="astro-construction">
    <circle cx="${CX}" cy="${CY}" r="292"/>
    <circle cx="${CX}" cy="${CY - 44}" r="236"/>
    <line x1="${CX}" y1="18" x2="${CX}" y2="630"/>
    <line x1="4" y1="${CY}" x2="596" y2="${CY}"/>
    <line x1="${fmt(at(300, 225)[0])}" y1="${fmt(at(300, 225)[1])}" x2="${fmt(at(300, 45)[0])}" y2="${fmt(at(300, 45)[1])}"/>
    <path d="M ${xy(286, 112)} A 286 286 0 0 1 ${xy(286, 148)}"/>
    <path d="M ${xy(286, 248)} A 286 286 0 0 1 ${xy(286, 276)}"/>
  </g>`;
}

function shackle(id) {
  const top = CY - LIMB_OUTER;
  const throne = `M ${CX - 36} ${top + 8} C ${CX - 32} ${top - 30}, ${CX - 15} ${top - 42}, ${CX} ${top - 44} C ${CX + 15} ${top - 42}, ${CX + 32} ${top - 30}, ${CX + 36} ${top + 8}`;
  return `
    <path class="astro-throne" d="${throne}"/>
    <path d="${throne}" fill="url(#${id}-hatch)" class="astro-shade"/>
    ${inkCircle(CX, top - 62, 17, 'astro-ink', 11)}
    <circle class="astro-pin" cx="${CX}" cy="${top - 44}" r="4"/>`;
}

function limb(id) {
  let ticks = '';
  for (let deg = 0; deg < 360; deg += 2) {
    const inner = deg % 30 === 0 ? 236 : deg % 10 === 0 ? 243 : 250;
    const [x1, y1] = at(258, deg);
    const [x2, y2] = at(inner, deg);
    const cls = deg % 10 === 0 ? 'astro-tick astro-tick--major' : 'astro-tick';
    ticks += `<line class="${cls}" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"/>`;
  }
  let numerals = '';
  for (let deg = 0; deg < 360; deg += 30) {
    const [x, y] = at(225, deg);
    numerals += `<text class="astro-numeral" x="${fmt(x)}" y="${fmt(y)}" transform="rotate(${deg} ${fmt(x)} ${fmt(y)})">${deg}</text>`;
  }
  // Shade the limb's lower right, as if lit from the upper left: the band
  // between the rim and the same circle nudged toward the light.
  const ring = (cx, cy, r) => `M ${fmt(cx - r)} ${fmt(cy)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  const crescent = `${ring(CX, CY, LIMB_OUTER)} ${ring(CX - 17, CY - 17, LIMB_OUTER - 4)}`;
  return `
    <circle class="astro-mater" cx="${CX}" cy="${CY}" r="${LIMB_OUTER}"/>
    <path d="${crescent}" fill="url(#${id}-hatch)" fill-rule="evenodd" clip-path="url(#${id}-mater)" class="astro-shade"/>
    ${inkCircle(CX, CY, LIMB_OUTER, 'astro-ink astro-ink--heavy', 3)}
    ${inkCircle(CX, CY, 258, 'astro-ink astro-ink--fine', 5)}
    ${inkCircle(CX, CY, LIMB_INNER, 'astro-ink', 9)}
    <g>${ticks}</g>
    <g>${numerals}</g>`;
}

function plate(id) {
  // Altitude circles of a stereographic projection are eccentric: their
  // centres climb toward the zenith as they shrink.
  let almucantars = '';
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    almucantars += inkCircle(CX, CY - 34 - 58 * t, 196 - 168 * t, 'astro-plate-line', 20 + i);
  }
  let azimuths = '';
  for (const deg of [-60, -30, 0, 30, 60]) {
    const [x1, y1] = at(LIMB_INNER, 180 + deg);
    azimuths += `<line class="astro-plate-line astro-plate-line--faint" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${CX}" y2="${CY - 92}"/>`;
  }
  return `
    <g clip-path="url(#${id}-plate)">
      ${inkCircle(CX, CY, 152, 'astro-plate-line astro-plate-line--faint', 31)}
      ${inkCircle(CX, CY, 100, 'astro-plate-line astro-plate-line--faint', 33)}
      <line class="astro-plate-line" x1="${CX - LIMB_INNER}" y1="${CY + 28}" x2="${CX + LIMB_INNER}" y2="${CY + 28}"/>
      ${almucantars}
      ${azimuths}
    </g>`;
}

/**
 * The star pointers: label, angle, tip radius, and where the label sits
 * relative to the star (dx, dy, anchor). Placed by hand so no label crosses the
 * degree scale or the alidade at rest.
 */
const STARS = [
  ['Android', 60, 186, -10, 26, 'end'],
  ['iOS', 112, 186, -12, 24, 'end'],
  ['Flutter', 200, 190, 12, -12, 'start'],
  ['React Native', 268, 176, 12, -14, 'start'],
  ['WebView', 20, 118, 12, -4, 'start']
];

const ECLIPTIC_CY = CY - 44;
const ECLIPTIC_R = 146;

/** Distance from the centre, along `deg`, at which the ray meets the ecliptic ring. */
function eclipticAt(deg) {
  const c = Math.cos((deg * Math.PI) / 180);
  const k = CY - ECLIPTIC_CY;
  return k * c + Math.sqrt(k * k * c * c + ECLIPTIC_R * ECLIPTIC_R - k * k);
}

function rete(id, labels) {
  const ecliptic = inkCircle(CX, ECLIPTIC_CY, ECLIPTIC_R, 'astro-brass astro-brass--heavy', 41)
    + inkCircle(CX, ECLIPTIC_CY, ECLIPTIC_R - 11, 'astro-brass', 43);
  let pointers = '';
  STARS.forEach(([name, deg, tip, dx, dy, anchor], index) => {
    const base = tip - 38;
    const d = `M ${xy(tip, deg)} C ${xy(tip - 14, deg - 1.6)} ${xy(base + 4, deg - 3.4)} ${xy(base, deg - 2.8)} `
      + `L ${xy(base, deg + 2.8)} C ${xy(base + 4, deg + 3.4)} ${xy(tip - 14, deg + 1.6)} ${xy(tip, deg)} Z`;
    // A strut ties each pointer to the ring, as on a real rete.
    const ring = eclipticAt(deg);
    const [a, b] = tip > ring ? [ring, base] : [tip, ring];
    const [sx, sy] = at(tip, deg);
    const label = labels?.[index] ?? name;
    pointers += `
      <line class="astro-brass" x1="${fmt(at(a, deg)[0])}" y1="${fmt(at(a, deg)[1])}" x2="${fmt(at(b, deg)[0])}" y2="${fmt(at(b, deg)[1])}"/>
      <path class="astro-pointer" d="${d}"/>
      <path d="${d}" fill="url(#${id}-cross)" class="astro-shade astro-shade--brass"/>
      <path class="astro-star" d="M ${fmt(sx - 5)} ${fmt(sy)} L ${fmt(sx + 5)} ${fmt(sy)} M ${fmt(sx)} ${fmt(sy - 5)} L ${fmt(sx)} ${fmt(sy + 5)} M ${fmt(sx - 3.4)} ${fmt(sy - 3.4)} L ${fmt(sx + 3.4)} ${fmt(sy + 3.4)} M ${fmt(sx - 3.4)} ${fmt(sy + 3.4)} L ${fmt(sx + 3.4)} ${fmt(sy - 3.4)}"/>
      <text class="astro-label" x="${fmt(sx + dx)}" y="${fmt(sy + dy)}" text-anchor="${anchor}">${label}</text>`;
  });
  return `<g class="astro-rete">${ecliptic}${pointers}</g>`;
}

function alidade(id) {
  const half = 252;
  const d = `M ${CX - 1.6} ${CY - half} L ${CX + 1.6} ${CY - half} L ${CX + 5} ${CY} L ${CX + 1.6} ${CY + half} L ${CX - 1.6} ${CY + half} L ${CX - 5} ${CY} Z`;
  return `
    <g class="astro-alidade">
      <path class="astro-rule" d="${d}"/>
      <path d="${d}" fill="url(#${id}-cross)" class="astro-shade astro-shade--brass"/>
      <rect class="astro-rule" x="${CX - 7}" y="${CY - 214}" width="14" height="13" rx="1.5"/>
      <rect class="astro-rule" x="${CX - 7}" y="${CY + 201}" width="14" height="13" rx="1.5"/>
    </g>
    ${inkCircle(CX, CY, 10, 'astro-brass astro-brass--heavy', 51)}
    <circle class="astro-pin-hole" cx="${CX}" cy="${CY}" r="3"/>`;
}

/** Leonardo wrote his notes right to left; one mirrored note, as on his pages. */
function notes() {
  return `<g class="astro-note" aria-hidden="true">
    <text x="${CX + 238}" y="612" transform="translate(${2 * (CX + 238)} 0) scale(-1 1)">astrolabio</text>
    <text x="${CX - 268}" y="612">fig. i</text>
  </g>`;
}

/**
 * @param {{ id?: string, title?: string, labels?: string[] }} options
 * `labels` replaces the star names, in order, for a translated page.
 */
export function astrolabeSvg({ id = 'astrolabe', title = 'An astrolabe', labels } = {}) {
  return `<svg class="astrolabe" viewBox="0 0 600 640" role="img" aria-labelledby="${id}-title" xmlns="http://www.w3.org/2000/svg">
  <title id="${id}-title">${title}</title>
  ${defs(id)}
  <g filter="url(#${id}-ink)">
    ${construction()}
    ${shackle(id)}
    ${limb(id)}
    ${plate(id)}
    ${rete(id, labels)}
    ${alidade(id)}
    ${notes()}
  </g>
</svg>`;
}
