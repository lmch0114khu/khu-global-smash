// 寃쏀씗??숆탳 援?젣罹좏띁??OSM ?곗씠??Overpass API)? ?쒓퀬(SRTM 30m, OpenTopoData)瑜??대젮諛쏆븘 campus.json??留뚮뱺??
// ?ㅽ뻾: node scripts/fetch-osm.mjs  (?ㅽ듃?뚰겕 ?꾩슂, ??1~2遺? ??踰??ㅽ뻾??寃곌낵瑜?而ㅻ컠???먮㈃ ?댄썑??遺덊븘??
// ?곗씠??짤 OpenStreetMap contributors, ODbL 1.0 / SRTM: NASA, ?쇰툝由??꾨찓??//
// ?ㅼ떆 ?ㅽ뻾?대룄 ?좎??섎뒗 寃?
//  - overrides.json (???ㅽ겕由쏀듃??嫄대뱶由ъ? ?딆쓬, ?고??꾩뿉 ??뼱?)
//  - campus.json?먯꽌 吏곸젒 梨꾩슫 嫄대Ъ ?대쫫 (OSM???대쫫???놁쓣 ?뚮쭔 ?댁쟾 媛믪쓣 ?댁뼱諛쏆쓬)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const REL_ID = 11246784; // 寃쏀씗??숆탳 援?젣罹좏띁??寃쎄퀎 relation
const OUT = new URL('../campus.json', import.meta.url);
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const ELEVATION_API = 'https://api.opentopodata.org/v1/srtm30m'; // 怨듦컻 API: ?붿껌??100?? 珥덈떦 1?? ?섎（ 1000??const TERRAIN_STEP = 20; // m. SRTM ?댁긽?꾧? 30m???대낫??珥섏킌?대룄 ?뺣낫媛 ?섏? ?딆쓬
const ATTEMPTS = 8;
const UA = 'khu-global-smash/0.1 (scripts/fetch-osm.mjs)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 泥?out? 寃쎄퀎 relation, ??踰덉㎏ out? 寃쎄퀎 ??嫄몄튇 寃??ы븿) ?붿냼??
const QUERY = `[out:json][timeout:120];
rel(${REL_ID});
out geom;
map_to_area->.a;
(
  way["building"](area.a);
  relation["building"](area.a);
  way["highway"](area.a);
  way["leisure"](area.a);
  relation["leisure"](area.a);
  way["landuse"](area.a);
  relation["landuse"](area.a);
  way["natural"](area.a);
  relation["natural"](area.a);
  way["amenity"="parking"](area.a);
  way["place"="square"](area.a);
);
out geom;`;

// 吏??諛깆삤???ъ떆?? task(attempt)??attempt濡?誘몃윭瑜?怨좊? ???덈떎.
async function withRetry(task) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      if (attempt === ATTEMPTS - 1) throw new Error(`${ATTEMPTS}踰?紐⑤몢 ?ㅽ뙣: ${err.message}. ?좎떆 ???ㅼ떆 ?ㅽ뻾?섏꽭??`);
      const wait = Math.min(2000 * 2 ** attempt, 60_000);
      console.warn(`[${attempt + 1}/${ATTEMPTS}] ${err.message} / ${wait / 1000}珥????ъ떆??);
      await sleep(wait);
    }
  }
}

async function getJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...init.headers },
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

const fetchOverpass = (query) => withRetry(async (attempt) => {
  const url = MIRRORS[attempt % MIRRORS.length]; // ?ㅽ뙣???뚮쭏???ㅼ쓬 誘몃윭濡?  const json = await getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  // Overpass??荑쇰━ ?쒓컙 珥덇낵?щ룄 200??二쇨퀬 remark???ㅻ쪟瑜??대뒗??
  if (json.remark?.includes('error')) throw new Error(`${new URL(url).host} ${json.remark}`);
  return json;
});

async function fetchElevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const locs = points.slice(i, i + 100).map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    const json = await withRetry(() => getJson(`${ELEVATION_API}?locations=${locs}`));
    out.push(...json.results.map((r) => r.elevation));
    process.stdout.write(`\r?쒓퀬 ${out.length}/${points.length}`);
    await sleep(1100); // 珥덈떦 1???쒗븳
  }
  console.log();
  return out;
}

// ?앹젏??留욌떯? way 議곌컖?ㅼ쓣 ?댁뼱 ?ロ엺 怨좊━濡?留뚮뱺??
function stitch(parts) {
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  const rest = parts.map((p) => p.slice());
  const rings = [];
  while (rest.length) {
    let ring = rest.shift();
    for (let grown = true; grown && !same(ring[0], ring.at(-1)); ) {
      grown = false;
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i];
        if (same(ring.at(-1), w[0])) ring = ring.concat(w.slice(1));
        else if (same(ring.at(-1), w.at(-1))) ring = ring.concat(w.slice(0, -1).reverse());
        else continue;
        rest.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

// ponytail: 硫?고뤃由ш낀??inner(援щ찉)??臾댁떆?섍퀬 outer留??대떎. 援щ찉 ?덈뒗 嫄대Ъ???섏삤硫?inner 泥섎━ 異붽?.
function outerRings(el) {
  if (el.type === 'way') return el.geometry ? [el.geometry] : [];
  const outers = el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry);
  return stitch(outers.map((m) => m.geometry));
}

// 吏앺? 洹쒖튃?대씪 寃쎄퀎??inner 怨좊━(罹좏띁??諛?援щ찉)??洹몃?濡?泥섎━?쒕떎.
function inside([x, z], rings) {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i];
      const [xj, zj] = r[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
  }
  return c;
}

const centroid = (pts) => [0, 1].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
const area = (pts) => Math.abs(pts.reduce((s, [x, z], i) => {
  const [x2, z2] = pts[(i + 1) % pts.length];
  return s + x * z2 - x2 * z;
}, 0)) / 2;

// ?좎쓣 寃쎄퀎 ??援ш컙留??④릿?? 寃쎄퀎瑜??섎뒗 泥????먯? ?섎굹???④꺼 ?뚮뜑?ш? 寃쎄퀎?먯꽌 ?섎씪 蹂댁씠寃??쒕떎.
// ponytail: ???앹젏??紐⑤몢 諛뽰씤 湲??좊텇??罹좏띁?ㅻ? 媛濡쒖?瑜대㈃ 踰꾨젮吏꾨떎. ?꾩슂?섎㈃ ?좊텇-寃쎄퀎 援먯감 怨꾩궛?쇰줈 援먯껜.
function trimToBoundary(points, rings) {
  const ins = points.map((p) => inside(p, rings));
  const runs = [];
  let run = [];
  points.forEach((p, i) => {
    if (ins[i] || ins[i - 1] || ins[i + 1]) run.push(p);
    else if (run.length) (runs.push(run), (run = []));
  });
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

function areaKind(t) {
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.leisure === 'swimming_pool') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (t.leisure === 'track') return 'track';
  if (t.leisure === 'pitch') return 'pitch';
  if (['grass', 'meadow', 'village_green'].includes(t.landuse) || ['grassland', 'scrub'].includes(t.natural) ||
      ['park', 'garden'].includes(t.leisure)) return 'grass';
  if (t.amenity === 'parking') return 'parking';
  if (t.place === 'square' || (t.highway && t.area === 'yes')) return 'paved';
  return null; // stadium, sports_centre ???ㅻⅨ 硫댁쓣 媛먯떥??而⑦뀒?대꼫??洹몃━吏 ?딆쓬
}

const raw = await fetchOverpass(QUERY);
const rel = raw.elements.find((e) => e.type === 'relation' && e.id === REL_ID);
if (!rel) throw new Error(`寃쎄퀎 relation ${REL_ID}??媛) ?묐떟???놁뒿?덈떎.`);

const llRings = stitch(rel.members.filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry));
const lats = llRings.flat().map((p) => p.lat);
const lons = llRings.flat().map((p) => p.lon);
const origin = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };

// ponytail: ?깆옣諛⑺삎 ?ъ쁺. 罹좏띁????1km) 洹쒕え?먯꽑 ?ㅼ감媛 cm ?⑥쐞??異⑸텇. ??km ?댁긽?대㈃ UTM ?깆쑝濡?援먯껜.
const R = 6378137;
const D2R = Math.PI / 180;
const r1 = (v) => Math.round(v * 10) / 10;
const toLocal = ({ lat, lon }) => [
  r1((lon - origin.lon) * D2R * R * Math.cos(origin.lat * D2R)), // x: ?숈そ +
  r1(-(lat - origin.lat) * D2R * R), // z: ?⑥そ +
];
const boundary = llRings.map((r) => r.map(toLocal));

// 寃쎄퀎 bbox(+?ъ쑀 ??移?瑜???뒗 ?쒓퀬 寃⑹옄. heights[j * nx + i] = (x0 + i*step, z0 + j*step) 吏?? 理쒖???0 湲곗?.
// ponytail: SRTM 30m???밸꼍쨌怨꾨떒??遺吏???꾨쭔??鍮꾪깉濡?萸됯컻吏怨? ?뀁? ?섎Т ?믪씠媛 ?욎뿬 紐?m ?믨쾶 ?섏삩??
//           ???뺥솗???섎젮硫?援?넗吏由ъ젙蹂댁썝 5m DEM(?섎룞 ?ㅼ슫濡쒕뱶)?쇰줈 援먯껜.
const bx = boundary.flat().map((p) => p[0]);
const bz = boundary.flat().map((p) => p[1]);
const x0 = Math.floor(Math.min(...bx) / TERRAIN_STEP - 1) * TERRAIN_STEP;
const z0 = Math.floor(Math.min(...bz) / TERRAIN_STEP - 1) * TERRAIN_STEP;
const nx = Math.ceil(Math.max(...bx) / TERRAIN_STEP + 1) - x0 / TERRAIN_STEP + 1;
const nz = Math.ceil(Math.max(...bz) / TERRAIN_STEP + 1) - z0 / TERRAIN_STEP + 1;
const gridLL = [];
for (let j = 0; j < nz; j++) {
  for (let i = 0; i < nx; i++) {
    const x = x0 + i * TERRAIN_STEP;
    const z = z0 + j * TERRAIN_STEP;
    gridLL.push({ lat: origin.lat - z / (R * D2R), lon: origin.lon + x / (R * D2R * Math.cos(origin.lat * D2R)) });
  }
}
let elev = await fetchElevations(gridLL);
let last = elev.find((e) => e != null) ?? 0;
elev = elev.map((e) => (last = e ?? last)); // SRTM 寃곗륫(null)? 吏곸쟾 媛믪쑝濡?硫붿?
const base = Math.min(...elev);
const terrain = { x0, z0, step: TERRAIN_STEP, nx, nz, base, heights: elev.map((e) => r1(e - base)) };

const oldNames = {};
if (existsSync(OUT)) for (const b of JSON.parse(readFileSync(OUT, 'utf8')).buildings) if (b.name) oldNames[b.id] = b.name;

const buildings = [];
const roads = [];
const areas = [];
const seen = new Set();
for (const el of raw.elements) {
  const id = el.type[0] + el.id; // w123, r456
  if (el === rel || seen.has(id)) continue;
  seen.add(id);
  const t = el.tags ?? {};

  if (t.building) {
    const ring = outerRings(el).sort((a, b) => b.length - a.length)[0];
    if (!ring) continue;
    const outline = ring.map(toLocal).slice(0, -1); // ?ル뒗 ???쒓굅
    if (!inside(centroid(outline), boundary)) continue;
    const floors = parseInt(t['building:levels'], 10);
    buildings.push({
      id,
      name: t['name:ko'] || t.name || oldNames[id] || '',
      floors: Number.isFinite(floors) ? floors : null,
      osm: t.building,
      outline,
    });
  } else if (t.highway && el.type === 'way' && t.area !== 'yes') {
    if (['proposed', 'construction', 'platform'].includes(t.highway)) continue;
    for (const points of trimToBoundary(el.geometry.map(toLocal), boundary)) roads.push({ type: t.highway, points });
  } else {
    const kind = areaKind(t);
    if (!kind) continue;
    for (const ring of outerRings(el)) {
      const outline = ring.map(toLocal).slice(0, -1);
      if (outline.some((p) => inside(p, boundary)) || inside(centroid(outline), boundary)) areas.push({ kind, outline });
    }
  }
}
buildings.sort((a, b) => a.id.localeCompare(b.id));

// ???붿냼????以? ?대쫫(name)??李얠븘 怨좎튂湲??쎄쾶.
const list = (arr) => '[\n' + arr.map((o) => '    ' + JSON.stringify(o)).join(',\n') + '\n  ]';
writeFileSync(OUT, `{
  "attribution": "짤 OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright) / ?쒓퀬: NASA SRTM 30m (?쇰툝由??꾨찓??, OpenTopoData",
  "source": "Overpass API relation ${REL_ID} + ${ELEVATION_API}, ${new Date().toISOString().slice(0, 10)}",
  "origin": ${JSON.stringify(origin)},
  "terrain": ${JSON.stringify(terrain)},
  "boundary": ${list(boundary)},
  "buildings": ${list(buildings)},
  "roads": ${list(roads)},
  "areas": ${list(areas)}
}
`);

console.log(`嫄대Ъ ${buildings.length}媛?(?대쫫 ?덉쓬 ${buildings.filter((b) => b.name).length}), ?꾨줈 ${roads.length}媛? 硫?${areas.length}媛?);
console.log(`吏??${nx}횞${nz} 寃⑹옄 (${TERRAIN_STEP}m), ?쒓퀬 ${base}~${Math.max(...elev)}m`);
console.table(buildings.map((b) => ({ id: b.id, name: b.name, osm: b.osm, floors: b.floors, '硫댁쟻(m짼)': Math.round(area(b.outline)) })));
