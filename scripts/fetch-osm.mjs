// 경희대학교 국제캠퍼스 OSM 데이터(Overpass API)와 표고(SRTM 30m, OpenTopoData)를 내려받아 campus.json을 만든다.
// 실행: node scripts/fetch-osm.mjs  (네트워크 필요, 약 1~2분. 한 번 실행한 결과를 커밋해 두면 이후엔 불필요)
// 데이터 © OpenStreetMap contributors, ODbL 1.0 / SRTM: NASA, 퍼블릭 도메인
//
// 다시 실행해도 유지되는 것:
//  - overrides.json (이 스크립트는 건드리지 않음, 런타임에 덮어씀)
//  - campus.json에서 직접 채운 건물 이름 (OSM에 이름이 없을 때만 이전 값을 이어받음)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const REL_ID = 11246784; // 경희대학교 국제캠퍼스 경계 relation
const OUT = new URL('../campus.json', import.meta.url);
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const ELEVATION_API = 'https://api.opentopodata.org/v1/srtm30m'; // 공개 API: 요청당 100점, 초당 1회, 하루 1000회
const TERRAIN_STEP = 20; // m. SRTM 해상도가 30m라 이보다 촘촘해도 정보가 늘지 않음
const ATTEMPTS = 8;
const UA = 'khu-global-smash/0.1 (scripts/fetch-osm.mjs)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 첫 out은 경계 relation, 두 번째 out은 경계 안(걸친 것 포함) 요소들.
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

// 지수 백오프 재시도. task(attempt)는 attempt로 미러를 고를 수 있다.
async function withRetry(task) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      if (attempt === ATTEMPTS - 1) throw new Error(`${ATTEMPTS}번 모두 실패: ${err.message}. 잠시 후 다시 실행하세요.`);
      const wait = Math.min(2000 * 2 ** attempt, 60_000);
      console.warn(`[${attempt + 1}/${ATTEMPTS}] ${err.message} / ${wait / 1000}초 후 재시도`);
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
  const url = MIRRORS[attempt % MIRRORS.length]; // 실패할 때마다 다음 미러로
  const json = await getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  // Overpass는 쿼리 시간 초과여도 200을 주고 remark에 오류를 담는다.
  if (json.remark?.includes('error')) throw new Error(`${new URL(url).host} ${json.remark}`);
  return json;
});

async function fetchElevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const locs = points.slice(i, i + 100).map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    const json = await withRetry(() => getJson(`${ELEVATION_API}?locations=${locs}`));
    out.push(...json.results.map((r) => r.elevation));
    process.stdout.write(`\r표고 ${out.length}/${points.length}`);
    await sleep(1100); // 초당 1회 제한
  }
  console.log();
  return out;
}

// 끝점이 맞닿은 way 조각들을 이어 닫힌 고리로 만든다.
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

// ponytail: 멀티폴리곤의 inner(구멍)는 무시하고 outer만 쓴다. 구멍 있는 건물이 나오면 inner 처리 추가.
function outerRings(el) {
  if (el.type === 'way') return el.geometry ? [el.geometry] : [];
  const outers = el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry);
  return stitch(outers.map((m) => m.geometry));
}

// 짝홀 규칙이라 경계의 inner 고리(캠퍼스 밖 구멍)도 그대로 처리된다.
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

// 선을 경계 안 구간만 남긴다. 경계를 넘는 첫/끝 점은 하나씩 남겨 렌더러가 경계에서 잘라 보이게 한다.
// ponytail: 양 끝점이 모두 밖인 긴 선분이 캠퍼스를 가로지르면 버려진다. 필요하면 선분-경계 교차 계산으로 교체.
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
  return null; // stadium, sports_centre 등 다른 면을 감싸는 컨테이너는 그리지 않음
}

const raw = await fetchOverpass(QUERY);
const rel = raw.elements.find((e) => e.type === 'relation' && e.id === REL_ID);
if (!rel) throw new Error(`경계 relation ${REL_ID}이(가) 응답에 없습니다.`);

const llRings = stitch(rel.members.filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry));
const lats = llRings.flat().map((p) => p.lat);
const lons = llRings.flat().map((p) => p.lon);
const origin = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };

// ponytail: 등장방형 투영. 캠퍼스(약 1km) 규모에선 오차가 cm 단위라 충분. 수 km 이상이면 UTM 등으로 교체.
const R = 6378137;
const D2R = Math.PI / 180;
const r1 = (v) => Math.round(v * 10) / 10;
const toLocal = ({ lat, lon }) => [
  r1((lon - origin.lon) * D2R * R * Math.cos(origin.lat * D2R)), // x: 동쪽 +
  r1(-(lat - origin.lat) * D2R * R), // z: 남쪽 +
];
const boundary = llRings.map((r) => r.map(toLocal));

// 경계 bbox(+여유 한 칸)를 덮는 표고 격자. heights[j * nx + i] = (x0 + i*step, z0 + j*step) 지점, 최저점 0 기준.
// ponytail: SRTM 30m라 옹벽·계단식 부지는 완만한 비탈로 뭉개지고, 숲은 나무 높이가 섞여 몇 m 높게 나온다.
//           더 정확히 하려면 국토지리정보원 5m DEM(수동 다운로드)으로 교체.
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
elev = elev.map((e) => (last = e ?? last)); // SRTM 결측(null)은 직전 값으로 메움
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
    const outline = ring.map(toLocal).slice(0, -1); // 닫는 점 제거
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

// 한 요소당 한 줄: 이름(name)을 찾아 고치기 쉽게.
const list = (arr) => '[\n' + arr.map((o) => '    ' + JSON.stringify(o)).join(',\n') + '\n  ]';
writeFileSync(OUT, `{
  "attribution": "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright) / 표고: NASA SRTM 30m (퍼블릭 도메인), OpenTopoData",
  "source": "Overpass API relation ${REL_ID} + ${ELEVATION_API}, ${new Date().toISOString().slice(0, 10)}",
  "origin": ${JSON.stringify(origin)},
  "terrain": ${JSON.stringify(terrain)},
  "boundary": ${list(boundary)},
  "buildings": ${list(buildings)},
  "roads": ${list(roads)},
  "areas": ${list(areas)}
}
`);

console.log(`건물 ${buildings.length}개 (이름 있음 ${buildings.filter((b) => b.name).length}), 도로 ${roads.length}개, 면 ${areas.length}개`);
console.log(`지형 ${nx}×${nz} 격자 (${TERRAIN_STEP}m), 표고 ${base}~${Math.max(...elev)}m`);
console.table(buildings.map((b) => ({ id: b.id, name: b.name, osm: b.osm, floors: b.floors, '면적(m²)': Math.round(area(b.outline)) })));
