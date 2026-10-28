// The astrolabe drawn on the landing page and the social card.
//
// One generator for both, so the two never drift apart. It is drawn as an
// engraving of a real instrument, in the manner of the astrolabes made in
// tenth-century Aleppo: the throne it hangs from, the limb with a degree scale,
// a plate projected for Aleppo's latitude, the rete (the openwork star map that
// turns over the plate, its pointers marking stars) and the rule that reads the
// scale. The pointers end in ogee tips, the pointed-arch profile of Arabic
// instruments. Here the stars are what Astur reaches.
//
// The plate and the ecliptic are computed, not sketched: a stereographic
// projection from the south celestial pole, with the plate's edge on the
// Tropic of Capricorn.

const CX = 300;
const CY = 340;
const LIMB_OUTER = 262;
const LIMB_INNER = 214;

const OBLIQUITY = 23.44;
const LATITUDE = 36.2; // Aleppo
const R_CAPRICORN = 212;
const rad = (deg) => (deg * Math.PI) / 180;
const R_EQUATOR = R_CAPRICORN / Math.tan(rad((90 + OBLIQUITY) / 2));
const R_CANCER = R_EQUATOR * Math.tan(rad((90 - OBLIQUITY) / 2));

/** Projected distance from the pole of a point at declination `dec`. */
const project = (dec) => R_EQUATOR * Math.tan(rad((90 - dec) / 2));

/** Point at `r` from the centre, `deg` clockwise from twelve o'clock. */
function at(r, deg) {
  return [CX + r * Math.sin(rad(deg)), CY - r * Math.cos(rad(deg))];
}

const fmt = (n) => Math.round(n * 100) / 100;
const xy = (r, deg) => at(r, deg).map(fmt).join(' ');
const circle = (cls, cx, cy, r) => `<circle class="${cls}" cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"/>`;

/**
 * An ogee tip: the edges swell into a shoulder, then sweep in to a point, the
 * profile of a pointed Arabic arch. Drawn pointing up from (0, 0) to (0, -len),
 * `w` wide at the base.
 */
function ogee(len, w) {
  const s = w + len * 0.09;
  return `M ${fmt(-w)} 0 C ${fmt(-w)} ${fmt(-len * 0.2)} ${fmt(-s)} ${fmt(-len * 0.24)} ${fmt(-s)} ${fmt(-len * 0.4)} `
    + `C ${fmt(-s)} ${fmt(-len * 0.66)} ${fmt(-w * 0.18)} ${fmt(-len * 0.78)} 0 ${fmt(-len)} `
    + `C ${fmt(w * 0.18)} ${fmt(-len * 0.78)} ${fmt(s)} ${fmt(-len * 0.66)} ${fmt(s)} ${fmt(-len * 0.4)} `
    + `C ${fmt(s)} ${fmt(-len * 0.24)} ${fmt(w)} ${fmt(-len * 0.2)} ${fmt(w)} 0 Z`;
}

function defs(id) {
  return `<defs>
    <clipPath id="${id}-plate"><circle cx="${CX}" cy="${CY}" r="${LIMB_INNER}"/></clipPath>
    <clipPath id="${id}-sky"><circle cx="${CX}" cy="${fmt(CY - horizon().u)}" r="${fmt(horizon().r)}"/></clipPath>
  </defs>`;
}

/** The throne the instrument hangs from, cut as a pointed arch. */
function throne() {
  const top = CY - LIMB_OUTER;
  const arch = `M ${CX - 46} ${top + 12} C ${CX - 46} ${top - 14} ${CX - 22} ${top - 22} ${CX - 13} ${top - 34} `
    + `C ${CX - 6} ${top - 43} ${CX - 3} ${top - 50} ${CX} ${top - 58} `
    + `C ${CX + 3} ${top - 50} ${CX + 6} ${top - 43} ${CX + 13} ${top - 34} `
    + `C ${CX + 22} ${top - 22} ${CX + 46} ${top - 14} ${CX + 46} ${top + 12}`;
  const inner = `M ${CX - 30} ${top + 4} C ${CX - 30} ${top - 10} ${CX - 14} ${top - 16} ${CX - 8} ${top - 25} `
    + `C ${CX - 4} ${top - 31} ${CX - 2} ${top - 36} ${CX} ${top - 41} `
    + `C ${CX + 2} ${top - 36} ${CX + 4} ${top - 31} ${CX + 8} ${top - 25} `
    + `C ${CX + 14} ${top - 16} ${CX + 30} ${top - 10} ${CX + 30} ${top + 4}`;
  return `
    <path class="astro-throne" d="${arch}"/>
    <path class="astro-line astro-line--fine" d="${inner}"/>
    ${circle('astro-line', CX, top - 72, 13)}
    ${circle('astro-line astro-line--fine', CX, top - 72, 10)}
    ${circle('astro-pin', CX, top - 58, 2.6)}`;
}

/** The limb: a degree scale, ticked at every degree and numbered every thirty. */
function limb() {
  let ticks = '';
  for (let deg = 0; deg < 360; deg += 1) {
    const inner = deg % 10 === 0 ? 238 : deg % 5 === 0 ? 246 : 251;
    const [x1, y1] = at(256, deg);
    const [x2, y2] = at(inner, deg);
    const cls = deg % 10 === 0 ? 'astro-tick astro-tick--major' : 'astro-tick';
    ticks += `<line class="${cls}" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"/>`;
  }
  let numerals = '';
  for (let deg = 0; deg < 360; deg += 30) {
    const [x, y] = at(226, deg);
    numerals += `<text class="astro-numeral" x="${fmt(x)}" y="${fmt(y)}" transform="rotate(${deg} ${fmt(x)} ${fmt(y)})">${deg}</text>`;
  }
  return `
    <circle class="astro-mater" cx="${CX}" cy="${CY}" r="${LIMB_OUTER}"/>
    ${circle('astro-line astro-line--rim', CX, CY, LIMB_OUTER)}
    ${circle('astro-line', CX, CY, 256)}
    ${circle('astro-line astro-line--fine', CX, CY, 238)}
    ${circle('astro-line', CX, CY, LIMB_INNER)}
    <g>${ticks}</g>
    <g>${numerals}</g>`;
}

/**
 * Circle through the two meridian points at zenith distance `z`, as a signed
 * distance up the meridian (`u`) and a radius. Past the pole a point lands on
 * the far side of the centre.
 */
function almucantar(altitude) {
  const z = 90 - altitude;
  const south = project(LATITUDE - z);
  const north = LATITUDE + z <= 90 ? project(LATITUDE + z) : -R_EQUATOR * Math.tan(rad((LATITUDE + z - 90) / 2));
  return { u: (south + north) / 2, r: Math.abs(south - north) / 2 };
}

function horizon() {
  return almucantar(0);
}

function plate(id) {
  let altitudes = '';
  for (let a = 6; a < 90; a += 6) {
    const { u, r } = almucantar(a);
    altitudes += circle(a % 30 === 0 ? 'astro-plate' : 'astro-plate astro-plate--faint', CX, CY - u, r);
  }
  // Azimuth circles all pass through the zenith and the nadir; each meets the
  // meridian at the zenith at its own angle.
  const zenith = project(LATITUDE);
  const nadir = -project(-LATITUDE);
  const half = (zenith - nadir) / 2;
  const mid = (zenith + nadir) / 2;
  let azimuths = '';
  for (let a = 10; a < 180; a += 10) {
    const xc = half / Math.tan(rad(a));
    azimuths += circle('astro-plate astro-plate--faint', CX + xc, CY - mid, half / Math.sin(rad(a)));
  }
  const { u, r } = horizon();
  return `
    <g clip-path="url(#${id}-plate)">
      ${circle('astro-plate astro-plate--faint', CX, CY, R_EQUATOR)}
      ${circle('astro-plate astro-plate--faint', CX, CY, R_CANCER)}
      <line class="astro-plate astro-plate--faint" x1="${CX}" y1="${CY - LIMB_INNER}" x2="${CX}" y2="${CY + LIMB_INNER}"/>
      <line class="astro-plate astro-plate--faint" x1="${CX - LIMB_INNER}" y1="${CY}" x2="${CX + LIMB_INNER}" y2="${CY}"/>
      ${circle('astro-plate', CX, CY - u, r)}
      ${altitudes}
      <g clip-path="url(#${id}-sky)">${azimuths}</g>
    </g>`;
}

// The ecliptic touches the Tropic of Capricorn at the top and the Tropic of
// Cancer at the bottom.
const ECLIPTIC_U = (R_CAPRICORN - R_CANCER) / 2;
const ECLIPTIC_R = (R_CAPRICORN + R_CANCER) / 2;
const ECLIPTIC_BAND = 11;

/** Distance from the centre, along `deg`, at which the ray meets the ecliptic. */
function eclipticAt(deg, r = ECLIPTIC_R) {
  const c = Math.cos(rad(deg));
  const k = ECLIPTIC_U;
  return k * c + Math.sqrt(k * k * c * c + r * r - k * k);
}

/** Where ecliptic longitude `lon` falls, with the winter solstice at the top. */
function eclipticPoint(lon) {
  const dec = Math.asin(Math.sin(rad(OBLIQUITY)) * Math.sin(rad(lon))) * 180 / Math.PI;
  const ra = Math.atan2(Math.cos(rad(OBLIQUITY)) * Math.sin(rad(lon)), Math.cos(rad(lon))) * 180 / Math.PI;
  return at(project(dec), 270 - ra);
}

/**
 * The star pointers: label, angle, tip radius, and where the label sits
 * relative to the star (dx, dy, anchor). Each pointer's tip faces the centre
 * and its stem runs out to the rete's rim; the label sits beside the tip.
 */
const STARS = [
  ['Android', 118, 150, -8, 4, 'end'],
  ['iOS', 242, 150, 8, 4, 'start'],
  ['Flutter', 154, 136, 10, 4, 'start'],
  ['React Native', 206, 136, -10, 4, 'end'],
  ['WebView', 40, 150, -10, 4, 'end']
];

function rete(labels) {
  const ecx = CX;
  const ecy = CY - ECLIPTIC_U;
  let divisions = '';
  for (let lon = 0; lon < 360; lon += 5) {
    const [px, py] = eclipticPoint(lon);
    const len = lon % 30 === 0 ? ECLIPTIC_BAND : lon % 10 === 0 ? 5 : 3;
    const d = Math.hypot(px - ecx, py - ecy);
    const qx = px + ((ecx - px) / d) * len;
    const qy = py + ((ecy - py) / d) * len;
    divisions += `<line class="astro-brass astro-brass--fine" x1="${fmt(px)}" y1="${fmt(py)}" x2="${fmt(qx)}" y2="${fmt(qy)}"/>`;
  }
  let pointers = '';
  STARS.forEach(([name, deg, tip, dx, dy, anchor], index) => {
    const length = 20;
    const [sx, sy] = at(tip, deg);
    const label = labels?.[index] ?? name;
    pointers += `
      <line class="astro-brass" x1="${fmt(at(tip + length, deg)[0])}" y1="${fmt(at(tip + length, deg)[1])}" x2="${fmt(at(R_CAPRICORN - 4, deg)[0])}" y2="${fmt(at(R_CAPRICORN - 4, deg)[1])}"/>
      ${circle('astro-boss', ...at(tip + length + 2, deg), 2.4)}
      <path class="astro-pointer" transform="translate(${fmt(sx)} ${fmt(sy)}) rotate(${fmt(deg + 180)}) translate(0 ${length})" d="${ogee(length, 1.6)}" />
      <text class="astro-label" x="${fmt(sx + dx)}" y="${fmt(sy + dy)}" text-anchor="${anchor}">${label}</text>`;
  });
  // The rete's frame: its rim on the Tropic of Capricorn, the equinoctial bar,
  // and the lower meridian bar that carries the ecliptic.
  return `<g class="astro-rete">
    ${circle('astro-brass', CX, CY, R_CAPRICORN)}
    ${circle('astro-brass astro-brass--fine', CX, CY, R_CAPRICORN - 4)}
    <line class="astro-brass" x1="${CX - R_CAPRICORN}" y1="${CY}" x2="${CX + R_CAPRICORN}" y2="${CY}"/>
    <line class="astro-brass" x1="${CX}" y1="${fmt(CY + R_CANCER)}" x2="${CX}" y2="${CY + R_CAPRICORN}"/>
    ${circle('astro-brass', ecx, ecy, ECLIPTIC_R)}
    ${circle('astro-brass astro-brass--fine', ecx, ecy, ECLIPTIC_R - ECLIPTIC_BAND)}
    ${divisions}
    ${pointers}
  </g>`;
}

/** The rule: a straight bar that reads the scale, an ogee tip at each end. */
function rule() {
  const reach = 254;
  const tip = 30;
  const w = 2;
  const end = ogee(tip, w);
  return `
    <g class="astro-alidade">
      <rect class="astro-rule" x="${CX - w}" y="${CY - reach + tip}" width="${2 * w}" height="${2 * (reach - tip)}"/>
      <path class="astro-rule" transform="translate(${CX} ${CY - reach + tip})" d="${end}"/>
      <path class="astro-rule" transform="translate(${CX} ${CY + reach - tip}) rotate(180)" d="${end}"/>
    </g>
    ${circle('astro-boss astro-boss--hub', CX, CY, 9)}
    <circle class="astro-pin-hole" cx="${CX}" cy="${CY}" r="2.4"/>`;
}

/**
 * @param {{ id?: string, title?: string, labels?: string[] }} options
 * `labels` replaces the star names, in order, for a translated page.
 */
export function astrolabeSvg({ id = 'astrolabe', title = 'An astrolabe', labels } = {}) {
  return `<svg class="astrolabe" viewBox="0 0 600 640" role="img" aria-labelledby="${id}-title" xmlns="http://www.w3.org/2000/svg">
  <title id="${id}-title">${title}</title>
  ${defs(id)}
  ${throne()}
  ${limb()}
  ${plate(id)}
  ${rete(labels)}
  ${rule()}
</svg>`;
}
