import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import osm from './campus.json';
import overrides from './overrides.json';
import { createBuildings, inside } from './buildings.js';
import { createPhysics } from './physics.js';
import { createTools } from './tools.js';

// overrides.json "remove"에 적힌 건물(학교 건물이 아닌 상점 등)은 처음부터 없는 것으로 친다.
const removed = new Set(overrides.remove ?? []);
const campus = { ...osm, buildings: osm.buildings.filter((b) => !removed.has(b.name) && !removed.has(b.id)) };

const TERRAIN_EXAGGERATION = 1.5; // 고저차를 실제보다 1.5배로 (사용자 요청)
const T = { ...campus.terrain, heights: campus.terrain.heights.map((h) => h * TERRAIN_EXAGGERATION) };
const W = (T.nx - 1) * T.step;
const D = (T.nz - 1) * T.step;
const clamp = THREE.MathUtils.clamp;

// 지형 메시(PlaneGeometry의 삼각형 분할)와 똑같이 보간한 지면 높이
function heightAt(x, z) {
  const fx = clamp((x - T.x0) / T.step, 0, T.nx - 1.0001);
  const fz = clamp((z - T.z0) / T.step, 0, T.nz - 1.0001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const h = (a, b) => T.heights[(j + b) * T.nx + i + a];
  return u + v <= 1
    ? h(0, 0) + (h(1, 0) - h(0, 0)) * u + (h(0, 1) - h(0, 0)) * v
    : h(1, 1) + (h(0, 1) - h(1, 1)) * (1 - u) + (h(1, 0) - h(1, 1)) * (1 - v);
}

// 고정 시드 난수: 새로고침해도 같은 배치
function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

// 고해상도 화면(배율 1.5 이상)에선 픽셀이 촘촘해 계단 현상이 덜하니 MSAA를 끈다 (2880×1620에서 프레임 약 5ms 절약)
const renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 1.5 });
const MAX_PIXEL_RATIO = Math.min(devicePixelRatio, 1.5); // 내장 그래픽 예산: 고해상도 화면에서도 1.5배까지만
renderer.setPixelRatio(MAX_PIXEL_RATIO);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.id = 'labels';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bcd9f0');
scene.fog = new THREE.Fog('#bcd9f0', 1500, 4000);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 6000);
camera.position.set(400, heightAt(0, 0) + 550, 900);
// 지도식 조작: 좌클릭 드래그 = 이동, 우클릭 드래그 = 회전, 휠 = 커서 쪽으로 줌, 더블클릭 = 그 지점으로 날아가기
const controls = new MapControls(camera, renderer.domElement);
controls.target.set(0, heightAt(0, 0), 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomToCursor = true;
controls.screenSpacePanning = false; // 이동은 지면과 평행하게
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 15;
controls.maxDistance = 2000;
controls.zoomSpeed = 1.4;
controls.rotateSpeed = 0.6;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const pick = (x, y) => { // 화면 좌표 아래의 건물·지면 지점 { point, normal } (물리 엔진 레이 검사)
  raycaster.setFromCamera(mouse.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return physics.raycast(raycaster.ray.origin, raycaster.ray.direction);
};
// 커서 위치: 매 프레임 그 아래에 조준 원을 그린다 (카메라가 움직여도 따라가게). 드래그 중엔 숨긴다.
let cursor = null;
let down = null;
renderer.domElement.addEventListener('pointermove', (e) => (cursor = e.buttons ? null : [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerleave', () => (cursor = null));
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0) down = [e.clientX, e.clientY];
});
// 클릭(드래그 없이 눌렀다 뗌) = 그 지점으로 미사일 발사
renderer.domElement.addEventListener('pointerup', (e) => {
  const click = e.button === 0 && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 5;
  down = null;
  if (click) tools.fire(pick(e.clientX, e.clientY));
});

scene.add(new THREE.HemisphereLight('#eef5ff', '#8f9a78', 1.6));
// 해 반대쪽 보조광(그림자 없음): 북·서쪽을 보는 흰 벽이 칙칙한 회색으로 가라앉지 않게
const fill = new THREE.DirectionalLight('#e3ebff', 0.7);
fill.position.set(-0.6, 0.5, -0.5);
scene.add(fill);
const SUN_DIR = new THREE.Vector3(0.45, 1, 0.35).normalize();
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 2500;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.3;
scene.add(sun, sun.target);

// --- 바닥: 지형 메시 하나 + 도로·잔디 등을 그린 캔버스 텍스처 (파괴 대상 아님) ---
// 그리는 순서 = 키 순서. 광장 위에 잔디 화단이, 트랙 위에 안쪽 구장이 덮이도록 paved·track을 먼저.
const AREA_COLOR = { paved: '#e3dccd', forest: '#5f9e4f', grass: '#9fd27c', parking: '#bdbab4', track: '#c8705a', pitch: '#69b85a', water: '#5eaee6' };
const ROAD = { // 폭(m), 색. 넓은 길이 위에 오도록 순서대로 그린다.
  path: [1.5, '#d2c09b'], footway: [2.5, '#e6dcc6'], steps: [2.5, '#cbbfa8'], track: [3, '#c4b08a'],
  pedestrian: [5, '#dcd3c3'], service: [6, '#7f7d7a'],
};

function groundTexture(pools) {
  const S = 2; // px/m. ponytail: 2048×3000급 텍스처 한 장. 더 선명하게 하려면 타일로 나누기
  const cv = document.createElement('canvas');
  cv.width = W * S;
  cv.height = D * S;
  const g = cv.getContext('2d');
  g.setTransform(S, 0, 0, S, -T.x0 * S, -T.z0 * S); // 이후 좌표는 로컬 미터 (x, z)
  const trace = (pts) => pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
  const rand = seeded(3);

  // 캠퍼스 경계 안만 칠하고, 이후는 source-atop으로 경계 안에만 그린다. 경계 밖은 투명 → alphaTest로 잘림.
  g.fillStyle = '#a9cc84';
  g.beginPath();
  campus.boundary.forEach(trace);
  g.fill('evenodd');
  g.globalCompositeOperation = 'source-atop';

  for (const [kind, color] of Object.entries(AREA_COLOR)) {
    for (const a of campus.areas.filter((a) => a.kind === kind)) {
      g.beginPath();
      trace(a.outline);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      if (kind === 'pitch') { // 잔디 깎은 줄무늬: 가장 긴 변에 수직으로
        const xs = a.outline.map((p) => p[0]);
        const zs = a.outline.map((p) => p[1]);
        const r = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
        let best = 0, ang = 0;
        a.outline.forEach((p, i) => {
          const q = a.outline[(i + 1) % a.outline.length];
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d > best) [best, ang] = [d, Math.atan2(q[1] - p[1], q[0] - p[0])];
        });
        g.save();
        g.clip();
        g.translate(xs[0], zs[0]);
        g.rotate(ang);
        g.fillStyle = 'rgba(255,255,255,0.09)';
        for (let u = -r; u < r; u += 8) g.fillRect(u, -r, 4, 2 * r);
        g.restore();
      }
      if (kind === 'paved') { // 광장 돌 포장 줄눈 (4m 격자)
        const xs = a.outline.map((p) => p[0]);
        const zs = a.outline.map((p) => p[1]);
        g.save();
        g.clip();
        g.fillStyle = 'rgba(120,110,95,0.18)';
        for (let x = Math.min(...xs); x < Math.max(...xs); x += 4) g.fillRect(x, Math.min(...zs), 0.25, Math.max(...zs) - Math.min(...zs));
        for (let z = Math.min(...zs); z < Math.max(...zs); z += 4) g.fillRect(Math.min(...xs), z, Math.max(...xs) - Math.min(...xs), 0.25);
        g.restore();
      }
      if (kind === 'pitch' || kind === 'track' || kind === 'parking') {
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 0.5;
        g.stroke();
      } else if (kind === 'water') {
        g.strokeStyle = '#a8d8f5';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
  }

  g.lineCap = g.lineJoin = 'round';
  for (const [type, [width, color]] of Object.entries(ROAD)) {
    const lines = campus.roads.filter((r) => r.type === type);
    const strokeAll = (w, style, dash = []) => {
      g.lineWidth = w;
      g.strokeStyle = style;
      g.setLineDash(dash);
      for (const r of lines) {
        g.beginPath();
        trace(r.points);
        g.stroke();
      }
    };
    if (type === 'service') strokeAll(width + 1.2, '#d4cfc4'); // 연석
    strokeAll(width, color);
    if (type === 'service') strokeAll(0.25, '#f3e7b0', [3, 3]); // 중앙선
    if (type === 'steps') strokeAll(width, '#a99d86', [0.4, 0.5]); // 계단 단
  }
  g.setLineDash([]);

  for (const pool of pools) { // 사색의 광장 연못
    g.beginPath();
    trace(pool);
    g.closePath();
    g.fillStyle = '#4fa3dc';
    g.fill();
    g.strokeStyle = '#bfe3f7';
    g.lineWidth = 0.8;
    g.stroke();
  }

  g.fillStyle = '#aaa59d'; // 건물 바닥(콘크리트). 블록이 부서지면 드러난다.
  for (const b of campus.buildings) {
    g.beginPath();
    trace(b.outline);
    g.fill();
  }

  // 단색 면에 옅은 얼룩을 흩어 질감을 준다.
  for (let n = 0; n < 6000; n++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(50,80,20,0.06)' : 'rgba(255,250,220,0.06)';
    g.beginPath();
    g.arc(T.x0 + rand() * W, T.z0 + rand() * D, 2 + rand() * 6, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// 건물을 먼저 만든다: 바닥 텍스처에 사색의 광장 연못(pools)을 그려야 해서
const { mesh: buildingMesh, blocks, buildings, pools } = createBuildings(campus, overrides, heightAt);
scene.add(buildingMesh);

// 물리용 지형: 표고 격자(20m) 그대로
const plane = (sub) => new THREE.PlaneGeometry(W, D, (T.nx - 1) * sub, (T.nz - 1) * sub)
  .rotateX(-Math.PI / 2)
  .translate(T.x0 + W / 2, 0, T.z0 + D / 2); // 꼭짓점 k = j * (가로 칸 수 + 1) + i, j=0이 북쪽(z0)
const terrainGeo = plane(1);
for (let k = 0; k < T.heights.length; k++) terrainGeo.attributes.position.setY(k, T.heights[k]);
// 렌더용 지형: 4배 촘촘한 격자(5m). 같은 대각선 방향이라 면은 물리 지형과 똑같고, 미사일이 땅에 맞으면 파인다.
const SUB = 4;
const groundGeo = plane(SUB);
const gp = groundGeo.attributes.position;
for (let k = 0; k < gp.count; k++) gp.setY(k, heightAt(gp.getX(k), gp.getZ(k)));
const groundFlat = gp.array.slice(); // 리셋용
groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(gp.count * 3).fill(1), 3)); // 그을음
const terrain = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: groundTexture(pools), alphaTest: 0.5, flatShading: true, vertexColors: true }));
terrain.receiveShadow = true;
scene.add(terrain);

// 땅에 맞은 자리: 살짝 파인 그릇 + 둘레 둔덕 + 그을음. 겹쳐 맞으면 더 깊은 쪽이 남는다.
// ponytail: 물리 지형은 그대로라 파인 곳에 떨어진 잔해는 원래 지면 높이(최대 깊이만큼 위)에 놓인다.
//           맞추려면 물리 삼각형 메시를 다시 만들어야 하는데 땅에 맞을 때마다 끊김이 생긴다.
const SCORCH = [0.24, 0.21, 0.18];
function crater(p, r) {
  const rc = Math.max(5, r * 0.4); // 파인 반지름 (렌더 격자 5m보다는 크게)
  const depth = r * 0.08; // 가운데 깊이 (반경 24m → 1.9m)
  const nx = (T.nx - 1) * SUB + 1;
  const step = T.step / SUB;
  const reach = rc * 2;
  const i0 = clamp(Math.floor((p.x - reach - T.x0) / step), 0, nx - 1);
  const i1 = clamp(Math.ceil((p.x + reach - T.x0) / step), 0, nx - 1);
  const j0 = clamp(Math.floor((p.z - reach - T.z0) / step), 0, (T.nz - 1) * SUB);
  const j1 = clamp(Math.ceil((p.z + reach - T.z0) / step), 0, (T.nz - 1) * SUB);
  const col = groundGeo.attributes.color;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      const s = Math.hypot(gp.getX(k) - p.x, gp.getZ(k) - p.z) / rc;
      if (s < 1) gp.setY(k, Math.min(gp.getY(k), groundFlat[k * 3 + 1] - depth * (1 - s * s)));
      else if (s < 1.5) gp.setY(k, Math.max(gp.getY(k), groundFlat[k * 3 + 1] + depth * 0.25 * Math.sin(((s - 1) / 0.5) * Math.PI)));
      const burn = THREE.MathUtils.smoothstep(s, 0.7, 2); // 0 = 가운데(가장 검다)
      for (let c = 0; c < 3; c++) col.setComponent(k, c, Math.min(col.getComponent(k, c), SCORCH[c] + (1 - SCORCH[c]) * burn));
    }
  }
  for (const a of [gp, col]) { // 바뀐 줄만 GPU에 올린다
    a.clearUpdateRanges();
    a.addUpdateRange(j0 * nx * 3, (j1 - j0 + 1) * nx * 3);
    a.needsUpdate = true;
  }
  trees.clear(p, rc * 1.2);
}
function resetGround() {
  gp.array.set(groundFlat);
  groundGeo.attributes.color.array.fill(1);
  for (const a of [gp, groundGeo.attributes.color]) {
    a.clearUpdateRanges();
    a.needsUpdate = true;
  }
  trees.restore();
}

// 파괴 물리: 블록이 처음 자리를 벗어나 날아다니므로 InstancedMesh 전체를 항상 그린다(경계 구 갱신 생략)
buildingMesh.frustumCulled = false;
const physicsStart = performance.now();
const physics = await createPhysics({ blocks, mesh: buildingMesh, terrainGeo, buildings, heightAt });
console.info(`물리 준비 ${Math.round(performance.now() - physicsStart)}ms (덩어리 ${physics.stats().chunks}개)`);

// 디오라마 받침: 캠퍼스 경계를 따라 흙 단면을 내려, 잘린 지형 가장자리 아래가 비어 보이지 않게 한다.
const SKIRT_BOTTOM = -20;
const skirt = [];
for (const ring of campus.boundary) {
  for (let n = 0; n < ring.length - 1; n++) {
    const [ax, az] = ring[n];
    const [bx, bz] = ring[n + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / T.step)); // 지형 굴곡을 따라가도록 잘게
    for (let s = 0; s < steps; s++) {
      const [x1, z1] = [ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps];
      const [x2, z2] = [ax + ((bx - ax) * (s + 1)) / steps, az + ((bz - az) * (s + 1)) / steps];
      const y1 = heightAt(x1, z1);
      const y2 = heightAt(x2, z2);
      skirt.push(x1, y1, z1, x2, SKIRT_BOTTOM, z2, x2, y2, z2, x1, y1, z1, x1, SKIRT_BOTTOM, z1, x2, SKIRT_BOTTOM, z2);
    }
  }
}
const skirtGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3));
skirtGeo.computeVertexNormals();
scene.add(new THREE.Mesh(skirtGeo, new THREE.MeshLambertMaterial({ color: '#a8845f', side: THREE.DoubleSide })));

// --- 건물 이름표 ---
const shortName = (name) => name.replace('경희대학교 국제캠퍼스 ', '');
const labels = [];
function setLabel(label, text) {
  if (label.element.textContent === text) return;
  label.element.textContent = text;
  label.userData.halfWidth = [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 10 : 6), 10) / 2; // 10px 글꼴 기준 추정
}
for (const b of buildings) {
  if (!b.name) continue;
  const el = document.createElement('div');
  el.className = 'label';
  const label = new CSS2DObject(el);
  label.position.set(b.center[0], b.top + 2, b.center[1]);
  label.userData.b = b;
  setLabel(label, shortName(b.name));
  labels.push(label);
  scene.add(label);
}

// --- 미사일·연출·효과음, 파괴율 패널, 슬라이더, R 리셋 ---
const tools = createTools({ scene, camera, physics, heightAt, blocks, onGround: crater });
const totalEl = document.getElementById('total');
const listEl = document.getElementById('list');
let uiTimer = 0;
function updateUI(dt) { // 0.25초마다
  if ((uiTimer -= dt) > 0) return;
  uiTimer = 0.25;
  totalEl.textContent = `${(physics.stats().ratio * 100).toFixed(1)}%`;
  const hurt = buildings.filter((b) => b.name && b.destroyed).sort((a, b) => b.destroyed / b.total - a.destroyed / a.total);
  listEl.replaceChildren(...hurt.slice(0, 5).map((b) => {
    const pct = (b.destroyed / b.total) * 100;
    const li = document.createElement('li');
    const name = document.createElement('span');
    const val = document.createElement('b');
    const bar = document.createElement('i');
    name.textContent = shortName(b.name);
    val.textContent = `${pct.toFixed(0)}%`;
    bar.style.width = `${pct}%`;
    li.append(name, val, bar);
    return li;
  }));
}
// --- 무기 핫바: 화면 아래 가운데. WEAPONS에 무기를 넣으면 칸(1, 2, 3, …)과 숫자키가 함께 생긴다 ---
// ponytail: 지금은 미사일뿐이라 고르면 칸 강조만 바뀐다. 무기가 늘면 고른 무기를 tools.fire에 넘긴다.
// 아이콘은 한 가지 색(currentColor) 실루엣: 칸 글자색을 따라 고른 칸만 밝아진다
const MISSILE_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><path transform="rotate(45 16 16)" fill="currentColor"
  d="M16 3c3 3 4 7 4 11v9h-8v-9c0-4 1-8 4-11zM12 16l-4 5v3l4-2zM20 16l4 5v3l-4-2zM14 24h4v2h-4z"/></svg>`;
const WEAPONS = [{ name: '미사일', icon: MISSILE_ICON }];
const slots = WEAPONS.map((w, i) => {
  const el = document.createElement('button');
  el.className = 'slot';
  el.title = `${w.name} (${i + 1})`;
  el.innerHTML = `<i>${i + 1}</i>${w.icon}`;
  el.addEventListener('click', () => selectWeapon(i));
  document.getElementById('hotbar').append(el);
  return el;
});
const selectWeapon = (i) => slots.forEach((el, n) => el.classList.toggle('on', n === i));
selectWeapon(0);

// 키보드: 한글 입력 상태(ㄱ)에서도 되게 key 대신 code로 본다. Ctrl+R 새로고침 같은 조합키는 그대로 둔다.
addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code); // 1~9: 무기 고르기
  if (digit && WEAPONS[digit[1] - 1]) selectWeapon(digit[1] - 1);
  if (e.code !== 'KeyR') return; // R: 리셋
  physics.reset();
  tools.reset();
  resetGround();
  uiTimer = 0;
});
const radiusInput = document.getElementById('radius');
const radiusVal = document.getElementById('radiusVal');
radiusInput.addEventListener('input', () => {
  tools.setRadius(+radiusInput.value);
  radiusVal.textContent = `${radiusInput.value}m`;
});
tools.setRadius(+radiusInput.value);
const speedInput = document.getElementById('speed');
const speedVal = document.getElementById('speedVal');
speedInput.addEventListener('input', () => {
  tools.setSpeed(+speedInput.value);
  speedVal.textContent = `${(+speedInput.value).toFixed(2)}×`;
});
tools.setSpeed(+speedInput.value);
const hitsInput = document.getElementById('hits'); // 잔해 소멸: 0~9번, 맨 끝(10)은 불가
const hitsVal = document.getElementById('hitsVal');
hitsInput.addEventListener('input', () => {
  physics.setMaxHits(+hitsInput.value > 9 ? Infinity : +hitsInput.value);
  hitsVal.textContent = +hitsInput.value > 9 ? '불가' : `${hitsInput.value}번`;
});
hitsInput.dispatchEvent(new Event('input')); // 새로고침 때 브라우저가 되살린 값도 반영
const volumeInput = document.getElementById('volume');
const volumeVal = document.getElementById('volumeVal');
volumeInput.addEventListener('input', () => {
  tools.setVolume(volumeInput.value / 100);
  volumeVal.textContent = `${volumeInput.value}%`;
});
tools.setVolume(volumeInput.value / 100);

// 화면에서 이름표가 겹치면 카메라에 가까운 건물 것만 남긴다.
const projected = new THREE.Vector3();
function declutterLabels() {
  const placed = [];
  labels.sort((a, b) => a.position.distanceToSquared(camera.position) - b.position.distanceToSquared(camera.position));
  for (const l of labels) {
    projected.copy(l.position).project(camera);
    const x = ((projected.x + 1) * innerWidth) / 2;
    const y = ((1 - projected.y) * innerHeight) / 2;
    const w = l.userData.halfWidth;
    l.visible = projected.z < 1 && !placed.some((p) => Math.abs(p.x - x) < p.w + w && Math.abs(p.y - y) < 16);
    if (l.visible) placed.push({ x, y, w });
  }
}

// --- 나무: 숲은 빽빽하게, 잔디밭은 듬성듬성. 침엽수(원뿔)와 활엽수(다면체). 물리는 없고, 땅이 파이는 자리만 날아간다 ---
function addTrees() {
  const rand = seeded(7);
  // 도로 가장자리에서 2m 안, 건물, 주차장·광장·구장·물 위에는 세우지 않는다.
  const segs = campus.roads.flatMap((r) => r.points.slice(1).map((b, i) => [r.points[i], b, (ROAD[r.type]?.[0] ?? 2) / 2 + 2]));
  const nearRoad = ([x, z]) => segs.some(([[ax, az], [bx, bz], w]) => {
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(x - ax - t * dx, z - az - t * dz) < w;
  });
  const blocked = campus.areas.filter((a) => a.kind !== 'forest' && a.kind !== 'grass').map((a) => a.outline)
    .concat(campus.buildings.map((b) => b.outline));
  const spots = []; // [x, z, 침엽수 여부]
  const scatter = (kind, gap, chance, pineRatio) => {
    for (const a of campus.areas.filter((a) => a.kind === kind)) {
      const xs = a.outline.map((p) => p[0]);
      const zs = a.outline.map((p) => p[1]);
      for (let x = Math.min(...xs); x < Math.max(...xs); x += gap) {
        for (let z = Math.min(...zs); z < Math.max(...zs); z += gap) {
          const p = [x + (rand() - 0.5) * gap, z + (rand() - 0.5) * gap];
          if (rand() < chance && inside(p, [a.outline]) && inside(p, campus.boundary) &&
              !blocked.some((o) => inside(p, [o])) && !nearRoad(p)) spots.push([...p, rand() < pineRatio]);
        }
      }
    }
  };
  scatter('forest', 9, 1, 0.6);
  scatter('grass', 20, 0.35, 0.2);

  const pines = spots.filter((s) => s[2]);
  const leafy = spots.filter((s) => !s[2]);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 2.5, 5).translate(0, 1.25, 0),
    new THREE.MeshLambertMaterial({ color: '#7a5a3a' }), spots.length);
  const pineCrown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 7, 6).translate(0, 5.5, 0),
    new THREE.MeshLambertMaterial({ flatShading: true }), pines.length);
  const leafCrown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3, 0).scale(1, 0.85, 1).translate(0, 5, 0),
    new THREE.MeshLambertMaterial({ flatShading: true }), leafy.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const place = (list, crown, base) => list.forEach(([x, z], i) => {
    m.compose(pos.set(x, heightAt(x, z) - 0.3, z), q.setFromAxisAngle(up, rand() * Math.PI * 2), scale.setScalar(0.7 + rand() * 0.6));
    trunk.setMatrixAt(crown === pineCrown ? i : pines.length + i, m);
    crown.setMatrixAt(i, m);
    crown.setColorAt(i, color.set(base).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.1));
  });
  place(pines, pineCrown, '#3f7f3c');
  place(leafy, leafCrown, '#6aa84f');
  for (const t of [trunk, pineCrown, leafCrown]) {
    t.castShadow = true;
    t.receiveShadow = true;
  }
  scene.add(trunk, pineCrown, leafCrown);
  const meshes = [trunk, pineCrown, leafCrown];
  const saved = meshes.map((t) => t.instanceMatrix.array.slice());
  const gone = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    count: spots.length,
    clear(p, r) { // p 둘레 r 안의 나무를 없앤다
      const hide = (list, crown, off) => list.forEach(([x, z], i) => {
        if (Math.hypot(x - p.x, z - p.z) > r) return;
        trunk.setMatrixAt(off + i, gone);
        crown.setMatrixAt(i, gone);
      });
      hide(pines, pineCrown, 0);
      hide(leafy, leafCrown, pines.length);
      for (const t of meshes) t.instanceMatrix.needsUpdate = true;
    },
    restore() {
      meshes.forEach((t, n) => {
        t.instanceMatrix.array.set(saved[n]);
        t.instanceMatrix.needsUpdate = true;
      });
    },
  };
}
const trees = addTrees();

console.info(`건물 ${buildings.length}개, 블록 ${blocks.length}개, 나무 ${trees.count}그루, 지형 ${T.nx}×${T.nz}`);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// 해상도 자동 조절: 내장 그래픽에선 화면 채우기가 병목이라 폭발이 몰리면 고해상도 화면에서 느려진다.
// 2초 평균 프레임 간격이 22ms(약 45fps)를 넘으면 픽셀 배율을 0.25 낮추고(최소 1), 10초 내내 넉넉하면 다시 올린다.
// 올린 지 10초 안에 다시 느려지면 그 배율을 상한으로 삼아 오르내림(화면 깜빡임)을 멈춘다.
let pixelRatio = MAX_PIXEL_RATIO;
let ratioCap = MAX_PIXEL_RATIO;
const perf = { sum: 0, n: 0, calm: 0, clock: 0, raisedAt: -Infinity };
function setPixelRatio(v) {
  pixelRatio = Math.max(1, v);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
}
function adaptResolution(sec) {
  if (sec <= 0 || sec > 0.1 || document.hidden) return; // 가려진 탭·한 번 끊긴 프레임은 빼고
  perf.clock += sec;
  perf.sum += sec;
  perf.n++;
  if (perf.sum < 2) return; // 2초 창
  const avg = perf.sum / perf.n;
  perf.sum = perf.n = 0;
  if (avg > 0.022 && pixelRatio > 1) {
    if (perf.clock - perf.raisedAt < 10) ratioCap = pixelRatio - 0.25;
    setPixelRatio(pixelRatio - 0.25);
    perf.calm = 0;
  } else if (avg < 0.0175 && pixelRatio < ratioCap) {
    if ((perf.calm += 2) < 10) return;
    setPixelRatio(Math.min(ratioCap, pixelRatio + 0.25));
    perf.raisedAt = perf.clock;
    perf.calm = 0;
  } else perf.calm = 0;
}

let lastTime = performance.now();
function frame(time = performance.now()) {
  adaptResolution((time - lastTime) / 1000);
  const dt = clamp((time - lastTime) / 1000, 0, 0.1); // 탭 전환 후 첫 프레임에 순간이동하지 않게 상한, 시계가 거꾸로 가면 0
  lastTime = time;
  const shake = tools.update(dt); // 미사일 비행·착탄(폭발) + 파티클
  physics.step(dt);
  tools.aim(cursor ? pick(cursor[0], cursor[1]) : null);
  updateUI(dt);
  controls.update();

  // 이동하면 목표점이 지형을 따라 오르내리고(카메라도 같이), 카메라는 땅 밑으로 들어가지 않는다.
  const t = controls.target;
  t.x = clamp(t.x, T.x0, T.x0 + W);
  t.z = clamp(t.z, T.z0, T.z0 + D);
  const dy = (heightAt(t.x, t.z) - t.y) * 0.1;
  t.y += dy;
  camera.position.y = Math.max(camera.position.y + dy, heightAt(camera.position.x, camera.position.z) + 3);

  // 그림자 범위를 시점 주변으로 좁혀 2048 그림자 맵 해상도를 아낀다.
  // ponytail: 카메라를 움직이면 그림자 가장자리가 약간 일렁임. 거슬리면 텍셀 단위 스냅 추가.
  const r = clamp(camera.position.distanceTo(t) * 0.9, 60, 900);
  const sc = sun.shadow.camera;
  if (sc.right !== r) {
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.updateProjectionMatrix();
  }
  sun.target.position.copy(t);
  sun.position.copy(t).addScaledVector(SUN_DIR, 1000);

  camera.position.add(shake); // 화면 흔들림은 그리는 동안만 (조작 상태에는 남기지 않음)
  renderer.render(scene, camera);
  declutterLabels();
  labelRenderer.render(scene, camera);
  camera.position.sub(shake);
}
renderer.setAnimationLoop(frame);
if (import.meta.env.DEV) window.app = { scene, camera, controls, renderer, sun, heightAt, frame, physics, buildings, tools, pick }; // 콘솔 디버깅용
