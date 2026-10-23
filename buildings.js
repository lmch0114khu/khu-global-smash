// 건물 외곽선을 층수만큼 올린 "속이 빈 복셀 껍데기"로 만들고, 사진을 참고한 건축 요소(열주, 박공, 난간, 돔,
// 시계탑, 계단식 객석 등)를 같은 블록으로 덧붙인다. 렌더링은 InstancedMesh 하나.
import * as THREE from 'three';

export const BLOCK = 3; // m. 블록 한 변
const LAYERS_PER_FLOOR = 2; // 실제보다 2배 높게 보이도록 1층 = 블록 2단 (사용자 요청)
const DEFAULT_FLOORS = 2; // overrides.json에도 OSM에도 층수가 없을 때

// 블록 옆면 무늬 (텍스처 아틀라스의 칸 번호)
const TILE = {
  WINDOW: 0, PILASTER: 1, ARCH: 2, CORNICE: 3, PLAIN: 4, CURTAIN: 5, COLUMN: 6, DOOR: 7, CLOCK: 8,
  BALUSTRADE: 9, BASE: 10, WINDOW_BLUE: 11, RIBBON: 12, BRICK: 13,
};
const TILE_COUNT = 14;

// 건물별 외관. 나무위키 「경희대학교/국제캠퍼스」 문서와 이미지 검색의 건물 사진을 보고 골랐다.
// 정면(가장 가까운 도로 쪽)에 현관·열주를 붙인다.
//  stone/sandstone/temple/library: 흰(체대는 따뜻한 베이지) 화강석 신고전주의. 1층 아치창, 기둥 사이 긴 창,
//    정면 열주, 처마, 난간, 가운데 높은 옥탑. temple은 박공, library는 정면 전체 열주·기단·대계단
//  gate / amphitheater / observatory: 정문·노천극장·천문대 전용 모델
//  arena: 선승관. 벽돌 아치 회랑, 금색 띠, 계단식 금속 지붕, 시계탑
//  나머지: 타일·페인트 마감 현대식 건물. 벽색·창 종류·모서리/양끝 마감·지붕색만 건물마다 다르다.
// ponytail: 건물 하나에 외관 하나를 통째로 입힌다. 실제 건물의 비대칭 날개·부속동까지는 재현하지 않음.
const STONE = {
  wall: '#f4f2ec', roof: '#d6d3cc', base: TILE.ARCH, mid: TILE.PILASTER, top: TILE.CORNICE,
  portico: true, parapet: TILE.BALUSTRADE, attic: true, quoins: true,
};
const MODERN = {
  wall: '#e4e6e1', roof: '#b4b5b1', base: TILE.BASE, mid: TILE.WINDOW, top: TILE.PLAIN,
  parapet: TILE.PLAIN, entrance: '#7d8a91', rooftop: true,
};
const WHITE_MODERN = { ...MODERN, wall: '#f4f4f1', roof: '#c9c9c5', mid: TILE.RIBBON };
const STYLES = {
  stone: STONE,
  sandstone: { ...STONE, wall: '#ecdfc6', roof: '#d8ccb6' }, // 체육대학관: 따뜻한 베이지 석재, 거대 열주
  temple: { ...STONE, pediment: true }, // 예술디자인대학: 열주 위 박공
  library: { ...STONE, facePlaza: true, grand: true }, // 중앙도서관: 광장 쪽 정면 전체 열주 + 기단 + 대계단
  gate: { ...STONE, wall: '#f2efe7', kind: 'gate' },
  amphitheater: { wall: '#f3f1ec', roof: '#d0cbc1', seat: '#cbc6bb', kind: 'amphitheater' },
  observatory: { wall: '#f4f3ef', roof: '#e4e2dc', dome: '#c3c8cf', kind: 'observatory' }, // 흰 원형 다층 + 은색 돔
  arena: {
    wall: '#d4926a', roof: '#5b6067', band: '#dcb453', base: TILE.ARCH, mid: TILE.ARCH, top: TILE.PLAIN,
    steppedRoof: true, clockTower: '#4f9a86', noFloors: true, // 속은 통으로 빈 체육관
  },
  engineering: { ...WHITE_MODERN, clockFront: true }, // 공학관: 흰 띠창 건물 + 가운데 시계탑
  whiteModern: WHITE_MODERN, // 외국어대학관: 흰 모더니즘
  studentHall: { ...WHITE_MODERN, base: TILE.CURTAIN }, // 학생회관: 흰 벽 + 1층 통유리
  labWhite: { ...WHITE_MODERN, wall: '#eceeed', roof: '#3a73c4' }, // 공학관 실험동: 파란 지붕
  plainWhite: { ...MODERN, wall: '#efede6', roof: '#c4c2bc' }, // 원자로센터: 흰 페인트
  beigeTower: { ...MODERN, wall: '#e7dcc6', mid: TILE.WINDOW_BLUE, canopy: '#f2f1ec', glassCore: true }, // 전자정보대학관: 베이지 석재, 파란 유리, 큰 처마
  sandTile: { ...MODERN, wall: '#dcc89e', roof: '#c7bba3', mid: TILE.WINDOW_BLUE }, // 생명과학대학: 샌드 베이지 타일
  brownBrick: { ...MODERN, wall: '#8d7166', roof: '#a99c94', quoins: true }, // 국제대학(아태관): 갈색 벽돌 타일
  pinkTile: { ...MODERN, wall: '#f1efe9', mid: TILE.WINDOW_BLUE, trim: '#d79e88', trimTile: TILE.PLAIN, trimEnds: true }, // 국제학관: 흰 몸체 + 연분홍 타일 양끝
  creamPanel: { ...MODERN, wall: '#e9e3d6', mid: TILE.WINDOW_BLUE }, // 멀티미디어교육관: 크림 석재 패널
  creamTile: { ...MODERN, wall: '#eadcbd', mid: TILE.WINDOW_BLUE }, // 글로벌관: 크림 타일
  dorm: { ...MODERN, wall: '#f4f1ea', roof: '#c3c0b9', trim: '#2a7a95', trimTile: TILE.CURTAIN, entrance: '#2f4f9e', glassCore: true }, // 우정원: 모서리 청록 유리탑, 파란 현관
  dorm2: { ...MODERN, wall: '#dfe1de', glassCore: true }, // 제2기숙사: 연회색 석재 + 유리
  aejiwon: { ...MODERN, wall: '#f2f0ea', trim: '#a5583f', trimTile: TILE.BRICK, trimEnds: true }, // 애지원: 흰 격자 + 양끝 벽돌
  grayPanel: { ...MODERN, wall: '#cdd0d2', roof: '#b9bcbe', mid: TILE.RIBBON }, // 실험연구동: 회색 금속 패널
  farm: { ...MODERN, wall: '#ecedea' }, // 실습농장동
  redGable: { // 도예관: 붉은 외벽 + 회색 석재 기둥 + 회색 박공지붕
    ...MODERN, wall: '#b9463b', roof: '#5a5e63', trim: '#a3a19c', trimTile: TILE.BASE, parapet: null, rooftop: false,
    gable: { tile: TILE.PLAIN, color: '#5a5e63', inset: 0 },
  },
  greenhouse: { // 원예생명공학과 온실: 진회색 벽돌 + 옥상 유리온실
    ...MODERN, wall: '#5f5b57', roof: '#4f4c49', base: TILE.BRICK, mid: TILE.WINDOW, rooftop: false, noFloors: true,
    gable: { tile: TILE.CURTAIN, color: '#dcefe9', inset: 1 },
  },
};
const SMALL_COLORS = ['#e4e6e1', '#ece6da', '#e0d8cc', '#dde2e6', '#e8ddca']; // 이름 없는 작은 건물 벽색
// 목록에 없으면: 이름 없는 일반 건물(building=yes)은 small, 나머지는 stone
const STYLE_BY_NAME = {
  '경희대학교 국제캠퍼스 중앙도서관': 'library',
  '경희대학교 국제캠퍼스 정문': 'gate',
  예술디자인대학: 'temple',
  체육대학관: 'sandstone',
  선승관: 'arena',
  천문대: 'observatory',
  노천극장: 'amphitheater',
  공학관: 'engineering',
  공학실험동: 'labWhite',
  원자로센터: 'plainWhite',
  전자정보대학: 'beigeTower',
  생명과학대학: 'sandTile',
  국제대학: 'brownBrick',
  국제학관: 'pinkTile',
  외국어대학관: 'whiteModern',
  학생회관: 'studentHall',
  멀티미디어교육관: 'creamPanel',
  글로벌관: 'creamTile',
  우정원: 'dorm',
  '제2기숙사 남자동': 'dorm2',
  '제2기숙사(여자동)': 'dorm2',
  애지원: 'aejiwon',
  실험연구동: 'grayPanel',
  실습농장동: 'farm',
  '예술디자인대학 도예관': 'redGable',
  원예생물공학온실: 'greenhouse',
};

// 짝홀 규칙 점-다각형 판정 (fetch-osm.mjs와 같은 방식). rings: 고리 배열
export function inside([x, z], rings) {
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

// fetch-osm.mjs와 같은 등장방형 투영. overrides.json "add"의 [위도, 경도]를 로컬 미터로 바꾼다.
function toLocal(origin, [lat, lon]) {
  const R = 6378137;
  const D2R = Math.PI / 180;
  return [(lon - origin.lon) * D2R * R * Math.cos(origin.lat * D2R), -(lat - origin.lat) * D2R * R];
}

const centroid = (pts) => [0, 1].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
const polyArea = (pts) => Math.abs(pts.reduce((s, [x, z], i) => {
  const [x2, z2] = pts[(i + 1) % pts.length];
  return s + x * z2 - x2 * z;
}, 0)) / 2;

// 점들에 가장 잘 맞는 원의 중심 (Kåsa 최소제곱). 평균을 빼면 Σx = Σz = 0이라 2×2 연립방정식이 된다.
function fitCircle(pts) {
  const [mx, mz] = centroid(pts);
  let sxx = 0, szz = 0, sxz = 0, sxr = 0, szr = 0;
  for (const [px, pz] of pts) {
    const x = px - mx;
    const z = pz - mz;
    const r = x * x + z * z;
    sxx += x * x; szz += z * z; sxz += x * z; sxr += x * r; szr += z * r;
  }
  const det = sxx * szz - sxz * sxz;
  return [mx + (sxr * szz - szr * sxz) / det / 2, mz + (szr * sxx - sxr * sxz) / det / 2];
}

// 옆면 무늬 아틀라스. 흰 바탕이라 인스턴스 색(벽 색)이 곱해진다.
// 유리·개구부는 알파를 GLASS_ALPHA로 표시해 두고, 셰이더가 그 부분엔 벽 색을 곱하지 않는다 (벽돌 건물의 유리가 갈색이 되지 않게).
const GLASS_ALPHA = 200 / 255;
function facadeAtlas() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S * TILE_COUNT;
  cv.height = S;
  const g = cv.getContext('2d');
  const mask = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  mask.canvas.width = cv.width;
  mask.canvas.height = S;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cv.width, S);
  const rect = (color, x, y, w, h) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  let ox = 0; // 지금 그리는 칸의 x 오프셋 (mask용)
  const glass = (x, y, w, h, tone = '#2e3c4e', sky = '#4f6984') => {
    rect(tone, x, y, w, h);
    rect(sky, x, y, w, h * 0.3); // 하늘 반사
    mask.fillRect(ox + x, y, w, h);
  };
  const tile = (n, draw) => {
    g.save();
    g.translate(n * S, 0);
    ox = n * S;
    draw();
    g.restore();
  };

  tile(TILE.WINDOW, () => {
    rect('#dcdcdc', 0, 56, 64, 8); // 층 사이 띠
    glass(16, 14, 32, 32);
    rect('#e6e6e6', 31, 14, 2, 32); // 창틀
  });
  tile(TILE.PILASTER, () => {
    rect('#eceae6', 10, 0, 44, 64); // 기둥 사이 오목한 면
    rect('#d3d1cc', 10, 0, 1, 64);
    rect('#d3d1cc', 53, 0, 1, 64);
    glass(20, 8, 24, 48);
    rect('#dddbd6', 20, 30, 24, 2); // 가로 창살
    rect('#dddbd6', 31, 8, 2, 48);
  });
  tile(TILE.ARCH, () => {
    for (const c of [g, mask]) { // 아치 개구부
      c.fillStyle = c === g ? '#3a3f48' : '#000';
      c.beginPath();
      c.rect(ox * (c === mask) + 14, 30, 36, 34);
      c.arc(ox * (c === mask) + 32, 30, 18, Math.PI, 0);
      c.fill();
    }
    g.strokeStyle = '#d6d4cf';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(32, 30, 20, Math.PI, 0);
    g.stroke();
    rect('#d6d4cf', 29, 7, 6, 6); // 쐐기돌
  });
  tile(TILE.CORNICE, () => {
    rect('#dad8d3', 0, 8, 64, 3); // 처마 그림자
    for (let x = 0; x < 64; x += 8) rect('#d2d0cb', x + 2, 14, 4, 5); // 치아 장식
    rect('#e6e4df', 0, 54, 64, 2);
  });
  tile(TILE.PLAIN, () => {
    rect('#ececec', 0, 21, 64, 1); // 석재 줄눈
    rect('#ececec', 0, 42, 64, 1);
    rect('#ececec', 20, 0, 1, 21);
    rect('#ececec', 44, 21, 1, 21);
    rect('#ececec', 20, 42, 1, 22);
  });
  tile(TILE.CURTAIN, () => {
    rect('#3d5a63', 0, 0, 64, 64);
    rect('#5f8590', 0, 0, 64, 20);
    for (let v = 0; v < 64; v += 16) {
      rect('#e6e6e6', v, 0, 2, 64);
      rect('#e6e6e6', 0, v, 64, 2);
    }
  });
  tile(TILE.COLUMN, () => {
    for (let x = 6; x < 60; x += 8) rect('#d9d7d2', x, 0, 3, 64); // 세로 홈
    rect('#cfcdc8', 58, 0, 6, 64); // 둥근 기둥의 그늘진 쪽
    rect('#d6d4cf', 0, 0, 64, 4);
  });
  tile(TILE.DOOR, () => {
    glass(12, 16, 40, 48);
    rect('#e6e6e6', 31, 16, 2, 48);
    rect('#e6e6e6', 12, 28, 40, 2); // 문 위 채광창 경계
    rect('#d6d4cf', 8, 10, 48, 4); // 문틀 상인방
  });
  tile(TILE.CLOCK, () => {
    g.fillStyle = '#f8f4e6';
    g.strokeStyle = '#2f2f2f';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      rect('#2f2f2f', 32 + Math.cos(a) * 20 - 1, 32 + Math.sin(a) * 20 - 1, 2, 2);
    }
    g.beginPath(); // 10시 10분
    g.moveTo(32, 32);
    g.lineTo(22, 26);
    g.moveTo(32, 32);
    g.lineTo(44, 22);
    g.stroke();
  });
  tile(TILE.BALUSTRADE, () => {
    rect('#a9a7a2', 0, 12, 64, 44); // 난간 사이 그늘
    for (let x = 2; x < 64; x += 8) rect('#ffffff', x, 12, 4, 44); // 난간 기둥
    rect('#f2f0eb', 0, 0, 64, 12); // 손잡이
  });
  tile(TILE.BASE, () => {
    rect('#d4d2cd', 0, 0, 64, 64); // 거친 화강석 기단
    for (let y = 0; y < 64; y += 16) {
      rect('#bdbbb6', 0, y, 64, 2);
      for (let x = (y / 16) % 2 ? 0 : 16; x < 64; x += 32) rect('#bdbbb6', x, y, 2, 16);
    }
  });
  tile(TILE.WINDOW_BLUE, () => { // 밝은 파란 유리 격자창 (전정대·생과대·멀관 등)
    rect('#dcdcdc', 0, 56, 64, 8);
    glass(14, 12, 36, 36, '#2f6aa3', '#79aedb');
    rect('#e6e6e6', 31, 12, 2, 36);
  });
  tile(TILE.RIBBON, () => { // 가로로 이어진 띠창 (공학관·외대·실험연구동)
    glass(0, 18, 64, 26, '#2c5560', '#5d8d97');
    for (let x = 0; x < 64; x += 16) rect('#eeeeee', x, 18, 2, 26); // 창살
    rect('#e2e2e2', 0, 56, 64, 2);
  });
  tile(TILE.BRICK, () => { // 벽돌 줄눈
    for (let y = 0; y < 64; y += 8) {
      rect('#dedede', 0, y, 64, 1);
      for (let x = (y / 8) % 2 ? 0 : 8; x < 64; x += 16) rect('#dedede', x, y, 1, 8);
    }
  });

  // 유리 자리만 알파를 낮춘다
  const img = g.getImageData(0, 0, cv.width, S);
  const m = mask.getImageData(0, 0, cv.width, S).data;
  for (let i = 3; i < img.data.length; i += 4) if (m[i] > 128) img.data[i] = GLASS_ALPHA * 255;
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createBuildings(campus, overrides, heightAt) {
  const defs = campus.buildings.map((b) => ({
    ...b,
    floors: overrides.floors[b.id] ?? overrides.floors[b.name] ?? b.floors ?? DEFAULT_FLOORS,
  }));
  (overrides.add ?? []).forEach((a, i) => defs.push({
    id: `add${i}`,
    name: a.name ?? '',
    floors: a.floors ?? DEFAULT_FLOORS,
    outline: a.outline.map((ll) => toLocal(campus.origin, ll)),
  }));

  // 정면 찾기용: 가장 가까운 도로까지 거리
  const roadSegs = campus.roads.flatMap((r) => r.points.slice(1).map((b, i) => [r.points[i], b]));
  const roadDist = ([x, z]) => Math.min(...roadSegs.map(([[ax, az], [bx, bz]]) => {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - ax - t * dx, z - az - t * dz);
  }));

  // 사색의 광장 = 가장 큰 포장 광장 (중앙도서관 정면 방향과 광장 장식에 쓴다)
  const plaza = campus.areas.filter((a) => a.kind === 'paved').sort((a, b) => polyArea(b.outline) - polyArea(a.outline))[0];
  const plazaCenter = plaza && centroid(plaza.outline);

  const blocks = []; // { b: 건물 index, x, y, z, angle, sx, sy, sz, tile, wall, shade, roof }
  const push = (b, x, y, z, angle, tile, wall, { sx = 1, sy = 1, sz = 1, shade = 1, roof = wall } = {}) => {
    blocks.push({ b, x, y, z, angle, sx, sy, sz, tile, wall, shade, roof });
  };
  const buildings = defs.map((def, bi) => {
    const { outline } = def;
    const hash = [...def.id].reduce((h, ch) => h + ch.charCodeAt(0), 0);
    const key = STYLE_BY_NAME[def.name] ?? (def.osm === 'yes' && !def.name ? 'small' : 'stone');
    const st = key === 'small' ? { ...MODERN, wall: SMALL_COLORS[hash % SMALL_COLORS.length] } : STYLES[key];

    // 가장 긴 변을 격자 축(i 방향)에 맞춰, 비스듬한 직사각형 건물의 벽이 계단 모양이 되지 않게 한다.
    // ponytail: 꺾인 건물(L자 등)은 한 축에만 맞춰져 나머지 변은 계단 모양. 변마다 격자를 나누면 개선.
    let best = 0, angle = 0, ox = 0, oz = 0;
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > best) [best, angle, ox, oz] = [d, Math.atan2(q[1] - p[1], q[0] - p[0]), p[0], p[1]];
    });
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const local = outline.map(([x, z]) => [(x - ox) * c + (z - oz) * s, -(x - ox) * s + (z - oz) * c]);
    const toWorld = (u, v) => [ox + u * c - v * s, oz + u * s + v * c];
    const U = (n) => (n + 0.5) * BLOCK; // 칸 번호 → 칸 중심의 로컬 좌표
    const groundAt = (i, j) => heightAt(...toWorld(U(i), U(j)));

    // 블록 중심이 외곽선 안에 들어가는 칸 = 바닥 칸
    const us = local.map((p) => p[0]);
    const vs = local.map((p) => p[1]);
    const keys = new Set();
    for (let i = Math.floor(Math.min(...us) / BLOCK); i < Math.max(...us) / BLOCK; i++) {
      for (let j = Math.floor(Math.min(...vs) / BLOCK); j < Math.max(...vs) / BLOCK; j++) {
        if (inside([U(i), U(j)], [local])) keys.add(`${i},${j}`);
      }
    }
    if (!keys.size) { // 블록 하나보다 작은 건물도 최소 한 칸은 남긴다
      const mid = (a) => Math.floor(a.reduce((t, v) => t + v, 0) / a.length / BLOCK);
      keys.add(`${mid(us)},${mid(vs)}`);
    }
    const has = (i, j) => keys.has(`${i},${j}`);
    const foot = [...keys].map((k) => {
      const [i, j] = k.split(',').map(Number);
      const openI = !has(i + 1, j) || !has(i - 1, j);
      const openJ = !has(i, j + 1) || !has(i, j - 1);
      // end: 긴 축(i) 양끝 면. 애지원·국제학관처럼 양끝만 다른 재료로 마감할 때 쓴다.
      return { key: k, i, j, wall: openI || openJ, corner: openI && openJ, end: openI, ground: groundAt(i, j) };
    });
    const footMap = new Map(foot.map((f) => [f.key, f]));
    const mean = (f) => foot.reduce((t, x) => t + f(x), 0) / foot.length;
    const [ci, cj] = [mean((f) => f.i), mean((f) => f.j)];

    // 층수는 평균 지면 기준으로 세고, 비탈 아래쪽은 최저 지면까지 블록을 채워 건물이 뜨지 않게 한다.
    // 언덕 쪽 아래층은 지형에 묻힌다.
    // ponytail: 실제 언덕 건물은 층마다 출입구 높이가 다르지만 여기선 바닥 하나로 단순화.
    const bottom = Math.min(...foot.map((f) => f.ground), ...outline.map(([x, z]) => heightAt(x, z)));
    const layers = def.floors * LAYERS_PER_FLOOR + Math.max(0, Math.round((mean((f) => f.ground) - bottom) / BLOCK));
    const roofY = bottom + layers * BLOCK;
    const gk = (g) => Math.floor((g - bottom) / BLOCK); // 지면 높이 → 그 지면에 닿는 블록 층
    const yk = (k) => bottom + (k + 0.5) * BLOCK;

    let topY = bottom;
    const first = blocks.length;
    const addAt = (x, z, y, ang, tile, wall, opt = {}) => { // 월드 좌표, 임의 방향
      push(bi, x, y, z, ang, tile, wall, { roof: st.roof, ...opt });
      topY = Math.max(topY, y + ((opt.sy ?? 1) * BLOCK) / 2);
    };
    const add = (u, v, y, tile, wall, opt) => addAt(...toWorld(u, v), y, angle, tile, wall, opt); // 건물 로컬 좌표
    // 지면(조금 아래)부터 top까지 한 블록으로 세운다. 경사지에 놓이는 기둥·객석·계단용.
    const pillarAt = (x, z, ang, top, tile, wall, opt = {}) => {
      const from = Math.min(heightAt(x, z), top) - 1;
      addAt(x, z, (from + top) / 2, ang, tile, wall, { ...opt, sy: (top - from) / BLOCK });
    };
    const cell = (i, j, k, tile, wall, opt) => add(U(i), U(j), yk(k), tile, wall, opt);
    const slab = (i, j, baseY, sy, tile, wall, opt = {}) => add(U(i), U(j), baseY + (sy * BLOCK) / 2, tile, wall, { ...opt, sy });
    const column = (i, j, fromY, n, wall) => {
      for (let m = 0; m < n; m++) add(U(i), U(j), fromY + (m + 0.5) * BLOCK, TILE.COLUMN, wall, { sx: 0.5, sz: 0.5 });
    };

    // 벽에서 안쪽으로 몇 칸 들어갔는지 (옥탑·계단식 지붕용)
    const inset = new Map();
    const queue = foot.filter((f) => f.wall);
    queue.forEach((f) => inset.set(f.key, 0));
    for (let n = 0; n < queue.length; n++) {
      const f = queue[n];
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const nb = footMap.get(`${f.i + di},${f.j + dj}`);
          if (nb && !inset.has(nb.key)) {
            inset.set(nb.key, inset.get(f.key) + 1);
            queue.push(nb);
          }
        }
      }
    }

    // 정면 = 가장 가까운 도로(중앙도서관은 사색의 광장)를 향한 면. (di, dj)는 정면 바깥 방향, t는 정면을 따라가는 칸 좌표.
    let front = null;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const maxDot = Math.max(...foot.map((f) => f.i * di + f.j * dj));
      const edge = foot.filter((f) => f.i * di + f.j * dj === maxDot);
      const em = (f) => edge.reduce((t, x) => t + f(x), 0) / edge.length;
      const mid = toWorld(em((f) => U(f.i)) + (di * BLOCK) / 2, em((f) => U(f.j)) + (dj * BLOCK) / 2);
      const d = st.facePlaza && plazaCenter ? Math.hypot(mid[0] - plazaCenter[0], mid[1] - plazaCenter[1]) : roadDist(mid);
      if (!front || d < front.d) front = { di, dj, maxDot, d };
    }
    const { di, dj } = front;
    const tOf = (f) => -f.i * dj + f.j * di;
    const outer = new Map(); // t → 정면 쪽 가장 바깥 칸
    for (const f of foot) {
      const o = outer.get(tOf(f));
      if (!o || f.i * di + f.j * dj > o.i * di + o.j * dj) outer.set(tOf(f), f);
    }
    const run = [...outer.keys()].filter((t) => {
      const o = outer.get(t);
      return o.i * di + o.j * dj >= front.maxDot - 1;
    }).sort((a, b) => a - b);
    const tc = run[Math.floor(run.length / 2)];
    const doorTs = st.grand ? [tc - 1, tc, tc + 1] : [tc, run.length >= 6 ? tc + 1 : tc];
    const doorKeys = new Set(doorTs.map((t) => outer.get(t)?.key));
    const outside = (o, n = 1) => [o.i + di * n, o.j + dj * n];

    if (st.kind === 'gate') {
      // 개선문 전용 모델 (정문 사진 참고). 외곽선 가운데에 반원 아치 몸체, 좌우로 열주 날개, 날개 끝에 정자.
      // 곡선을 살리려고 몸체는 1.5m 블록으로 쌓는다. 높이는 가운데 지면 기준으로 수평을 맞춘다.
      const uc = (Math.min(...us) + Math.max(...us)) / 2;
      const vc = (Math.min(...vs) + Math.max(...vs)) / 2;
      const wingEnd = (Math.max(...us) - Math.min(...us)) / 2;
      const base = heightAt(...toWorld(uc, vc));
      const rel = (du, dv) => heightAt(...toWorld(uc + du, vc + dv)) - base; // 가운데 기준 지면 높이
      const h = BLOCK / 2;
      const BODY = 9; // 몸체 반폭
      const DEPTH = 4.5; // 몸체 반깊이
      const R = 4.5; // 아치 반지름
      const SPRING = 10; // 아치가 휘기 시작하는 높이
      const CORNICE_Y = 18;
      const TOP = 22.5;
      for (let du = -BODY + h / 2; du < BODY; du += h) {
        for (let dv = -DEPTH + h / 2; dv < DEPTH; dv += h) {
          const g = rel(du, dv);
          for (let y = Math.floor(g / h) * h - h; y < TOP; y += h) {
            const yc = y + h / 2;
            const ring = Math.abs(du) < R ? (yc < SPRING ? Math.abs(du) : Math.hypot(du, yc - SPRING)) : Infinity;
            if (ring < R) continue; // 아치 통로
            const shell = Math.abs(du) > BODY - h || Math.abs(dv) > DEPTH - h || yc < g + h || yc > TOP - h || ring < R + h;
            if (!shell) continue; // 속은 비운다
            const archivolt = ring < R + 1.6 && yc >= SPRING;
            const tile = yc > CORNICE_Y && yc < CORNICE_Y + h ? TILE.CORNICE : TILE.PLAIN;
            add(uc + du, vc + dv, base + yc, tile, st.wall, { sx: 0.5, sy: 0.5, sz: 0.5, shade: archivolt ? 0.9 : 1 });
          }
        }
      }
      for (const du of [-6.75, 6.75]) { // 몸체 앞뒤에 붙은 기둥
        for (const dv of [-(DEPTH + 0.6), DEPTH + 0.6]) {
          const g = rel(du, dv);
          add(uc + du, vc + dv, base + (g + CORNICE_Y) / 2, TILE.COLUMN, st.wall, { sx: 0.4, sz: 0.4, sy: (CORNICE_Y - g) / BLOCK });
        }
      }
      // 꼭대기 조각상: 대좌 + 가운데 큰 인물 + 양옆 인물 + 네 모서리 작은 상
      add(uc, vc, base + TOP + 0.6, TILE.BASE, st.wall, { sx: 2.4, sy: 0.4, sz: 1.3 });
      for (const [du, hgt] of [[-2.4, 1.1], [0, 1.6], [2.4, 1.1]]) {
        add(uc + du, vc, base + TOP + 1.2 + (hgt * BLOCK) / 2, TILE.PLAIN, '#f7f4ec', { sx: 0.35, sy: hgt, sz: 0.4 });
      }
      add(uc, vc, base + TOP + 1.2 + 1.6 * BLOCK - 1, TILE.PLAIN, '#f7f4ec', { sx: 1.1, sy: 0.12, sz: 0.25 }); // 펼친 팔
      for (const du of [-BODY + 1, BODY - 1]) for (const dv of [-DEPTH + 1, DEPTH - 1]) add(uc + du, vc + dv, base + TOP + 1.2, TILE.PLAIN, '#f7f4ec', { sx: 0.3, sy: 0.8, sz: 0.3 });
      // 좌우 열주 날개 (앞뒤 두 줄) + 엔타블러처 + 난간, 날개 끝 정자
      const WING_TOP = 10.5;
      for (const side of [-1, 1]) {
        for (let du = BODY + 1.5; du < wingEnd - 3; du += 3) {
          for (const dv of [-2.4, 2.4]) {
            const g = rel(side * du, dv);
            add(uc + side * du, vc + dv, base + (g + WING_TOP) / 2, TILE.COLUMN, st.wall, { sx: 0.45, sz: 0.45, sy: (WING_TOP - g) / BLOCK });
            add(uc + side * du, vc + dv * 1.2, base + WING_TOP + 2, TILE.BALUSTRADE, st.wall, { sy: 0.33, sz: 0.15 });
          }
          add(uc + side * du, vc, base + WING_TOP + 0.75, TILE.CORNICE, st.wall, { sy: 0.5, sz: 2.1 });
        }
        const du = side * (wingEnd - 1.5);
        const g = rel(du, 0);
        add(uc + du, vc, base + (g + 13.5) / 2, TILE.ARCH, st.wall, { sx: 1.2, sz: 2.3, sy: (13.5 - g) / BLOCK });
        add(uc + du, vc, base + 13.95, TILE.CORNICE, st.wall, { sx: 1.4, sy: 0.3, sz: 2.5 });
      }
    } else if (st.kind === 'amphitheater') {
      // 노천극장 전용 모델 (사진 참고): 언덕에 파묻힌 동심원 계단 객석, 원형 무대, 무대 뒤 흰 반원 열주
      // (엔타블러처·부조 띠·난간), 객석 맨 위 난간.
      // OSM 외곽선은 객석 바깥 큰 호(긴 변 몇 개) + 무대 뒤 작은 호(짧은 변 여러 개)로 되어 있다.
      // 무대 중심 = 짧은 변으로 이어진 작은 호에 맞춘 원의 중심, 객석은 그 원과 같은 중심의 동심원.
      // 객석 범위 = 바깥 꼭짓점 각도 중 가장 큰 틈의 반대편. 실제 객석 칸은 외곽선 안쪽만 채운다.
      const n0 = outline.length;
      const edge = (i) => Math.hypot(outline[(i + 1) % n0][0] - outline[i][0], outline[(i + 1) % n0][1] - outline[i][1]);
      const lens = outline.map((_, i) => edge(i));
      const short = 0.4 * Math.max(...lens);
      const arc = outline.filter((_, i) => lens[i] < short && lens[(i - 1 + n0) % n0] < short);
      const [cx, cz] = arc.length >= 3 ? fitCircle(arc) : centroid(outline);
      const dist = ([x, z]) => Math.hypot(x - cx, z - cz);
      const rIn = arc.length >= 3 ? arc.reduce((t, p) => t + dist(p), 0) / arc.length : 10;
      const rOut = Math.max(...outline.map(dist));
      const angs = outline.filter((p) => dist(p) > rIn * 1.5).map(([x, z]) => Math.atan2(z - cz, x - cx)).sort((a, b) => a - b);
      let gap = 0, open = 0;
      angs.forEach((a, n) => {
        const next = n + 1 < angs.length ? angs[n + 1] : angs[0] + 2 * Math.PI;
        if (next - a > gap) [gap, open] = [next - a, (a + next) / 2];
      });
      const a0 = open + gap / 2; // 객석 부채꼴 시작 각도 (open = 무대 뒤, 객석이 없는 쪽)
      const span = 2 * Math.PI - gap;
      const at = (r, a) => [cx + r * Math.cos(a), cz + r * Math.sin(a)];
      const stageY = heightAt(cx, cz) + 1.2; // 무대 윗면 (아래엔 대기실이 있는 기단)
      const ROW = 1.5;
      const rows = Math.floor((rOut - rIn) / ROW);
      const lastRow = new Map(); // 각도 칸 → 가장 바깥 객석 { x, z, a, top, w }
      for (let n = 0; n < rows; n++) {
        const r = rIn + 0.75 + n * ROW;
        const count = Math.ceil((r * span) / 1.6);
        for (let m = 0; m < count; m++) {
          const a = a0 + ((m + 0.5) * span) / count;
          const [x, z] = at(r, a);
          if (!inside([x, z], [outline])) continue;
          // 방향마다 맨 뒷줄이 그쪽 언덕 지면에 닿도록 단 높이를 정한다 (0.35~0.7m)
          const rise = Math.min(0.7, Math.max(0.35, (heightAt(...at(rOut, a)) + 0.4 - stageY) / rows));
          const frac = ((a - a0) / span) * 7; // 부채꼴을 7등분하는 방사형 통로 계단
          const aisle = Math.abs(frac - Math.round(frac)) * ((r * span) / 7) < 0.8;
          const top = Math.max(stageY + (n + 1) * rise - (aisle ? rise / 2 : 0), heightAt(x, z) + 0.25);
          const w = (r * span) / count;
          pillarAt(x, z, a, top, TILE.PLAIN, st.seat, { sx: ROW / BLOCK, sz: w / BLOCK, shade: aisle ? 0.85 : 1, roof: st.seat });
          const key = Math.round(((a - a0) / span) * 60);
          if (!lastRow.has(key) || lastRow.get(key).r < r) lastRow.set(key, { x, z, a, top, w, r });
        }
      }
      for (const s of lastRow.values()) { // 객석 맨 위 난간
        const [x, z] = [cx + (s.r + 0.9) * Math.cos(s.a), cz + (s.r + 0.9) * Math.sin(s.a)];
        addAt(x, z, s.top + 0.5, s.a, TILE.BALUSTRADE, st.wall, { sx: 0.1, sy: 0.33, sz: (s.w * 2.6) / BLOCK });
      }
      const rs = rIn - 2.5; // 원형 무대: 기단 + 윗면
      for (let x = -rs; x <= rs; x += 1.5) {
        for (let z = -rs; z <= rs; z += 1.5) {
          if (Math.hypot(x, z) <= rs) pillarAt(cx + x, cz + z, 0, stageY, Math.hypot(x, z) > rs - 1.5 ? TILE.ARCH : TILE.PLAIN, '#e6e1d6', { sx: 0.5, sz: 0.5, roof: '#ddd6c8' });
        }
      }
      // 무대 뒤 반원 열주: 기둥 + 엔타블러처 + 부조 띠 + 난간, 양끝은 부조 벽
      const rc = rs - 0.75;
      const ARC = Math.PI * 0.95;
      const COLS = 17;
      const colTop = stageY + 10;
      const seg = (a, len, y, tile, sy, sx, wall = st.wall) => addAt(...at(rc, a), y, a, tile, wall, { sx, sy, sz: (len + 0.5) / BLOCK });
      for (let m = 0; m < COLS; m++) {
        const a = open - ARC / 2 + (ARC * m) / (COLS - 1);
        addAt(...at(rc, a), (stageY + colTop) / 2, a, TILE.COLUMN, st.wall, { sx: 0.42, sz: 0.42, sy: (colTop - stageY) / BLOCK });
        if (m < COLS - 1) {
          const am = a + ARC / (COLS - 1) / 2;
          const len = 2 * rc * Math.sin(ARC / (COLS - 1) / 2);
          seg(am, len, colTop + 0.45, TILE.CORNICE, 0.3, 0.7);
          seg(am, len, colTop + 1.5, TILE.BASE, 0.4, 0.62, '#efebe2'); // 부조 띠
          seg(am, len, colTop + 2.4, TILE.BALUSTRADE, 0.2, 0.5);
        }
      }
      for (const side of [-1, 1]) {
        const a = open + side * (ARC / 2 + 0.1);
        addAt(...at(rc, a), (stageY + colTop + 2.7) / 2, a, TILE.BASE, st.wall, { sx: 0.9, sz: 1.6, sy: (colTop + 2.7 - stageY) / BLOCK });
      }
      topY = Math.max(topY, colTop + 3);
    } else if (st.kind === 'observatory') {
      // 천문대 전용 모델 (사진 참고): 흰 원통이 위로 갈수록 좁아지는 3단, 단마다 둥근 테라스판, 꼭대기 은색 돔.
      // 1.5m 블록으로 원을 그린다.
      const c0 = toWorld(U(ci), U(cj));
      const R0 = Math.min(16, Math.sqrt(foot.length * BLOCK * BLOCK / Math.PI)); // 외곽선 면적과 같은 원
      const h = BLOCK / 2;
      const base = Math.min(...foot.map((f) => f.ground)) - 0.5;
      const ring = (r0, r1, y0, y1, tile, wall, roof) => { // 반지름 r0~r1 고리를 y0~y1 높이로
        for (let x = -r1; x <= r1; x += h) {
          for (let z = -r1; z <= r1; z += h) {
            const r = Math.hypot(x, z);
            if (r > r1 || r < r0) continue;
            for (let y = y0; y < y1 - 0.01; y += h) {
              const sy = Math.min(h, y1 - y) / BLOCK;
              addAt(c0[0] + x, c0[1] + z, y + (sy * BLOCK) / 2, Math.atan2(z, x), tile, wall, { sx: 0.5, sz: 0.5, sy, roof });
            }
          }
        }
      };
      const tiers = [[R0 * 0.8, 0, 7.5], [R0 * 0.62, 8.1, 13.5], [R0 * 0.44, 14.1, 18]]; // [반지름, 아래, 위]
      tiers.forEach(([r, y0, y1], n) => {
        ring(r - h, r, base + y0, base + y1, TILE.RIBBON, st.wall, st.roof); // 원통 벽 (띠창)
        ring(0, r - h, base + y1 - 0.6, base + y1, TILE.PLAIN, st.wall, st.roof); // 바닥판·지붕
        if (n < tiers.length - 1) ring(r - h, r + 2.2, base + y1, base + y1 + 0.6, TILE.PLAIN, st.wall, st.roof); // 둥근 테라스판
      });
      const R = R0 * 0.36; // 은색 돔
      const q = BLOCK / 4;
      const top = base + tiers[tiers.length - 1][2];
      for (let x = -R; x <= R; x += q) {
        for (let z = -R; z <= R; z += q) {
          for (let y = 0; y <= R; y += q) {
            const r = Math.hypot(x, z, y + q / 2);
            if (r <= R && r > R - q * 1.5) addAt(c0[0] + x, c0[1] + z, top + y + q / 2, 0, TILE.PLAIN, st.dome, { sx: 0.25, sy: 0.25, sz: 0.25, roof: st.dome });
          }
        }
      }
    } else {
      // 기본 껍데기: 벽 + 맨 위 지붕
      const core = st.glassCore && outer.get(tc);
      for (let k = 0; k < layers; k++) {
        const isTop = k === layers - 1;
        for (const f of foot) {
          if (!f.wall && !isTop) continue;
          const g = gk(f.ground);
          const useTop = isTop && (st.band || layers - g > 2); // 낮은 건물은 맨 위 층에도 창을 낸다
          let tile = useTop ? st.top : k === g ? st.base : st.mid;
          let wall = useTop && st.band ? st.band : st.wall;
          let shade = k === g && st.base === TILE.BASE ? 0.85 : 1;
          if (k >= g && !isTop && (st.trimEnds ? f.end : f.corner)) {
            if (st.trim) [tile, wall] = [st.trimTile ?? TILE.PLAIN, st.trim]; // 모서리(또는 양끝) 다른 재료
            else if (st.quoins) [tile, shade] = [TILE.PLAIN, 0.93]; // 모서리 마감석
          }
          if (k === g + (st.grand ? 1 : 0) && doorKeys.has(f.key)) tile = TILE.DOOR; // 기단이 있으면 한 층 위가 현관
          else if (k > g && !isTop && core && f.key === core.key) tile = TILE.CURTAIN; // 유리 계단실
          if (k < g) [tile, shade] = [TILE.PLAIN, 0.9]; // 지형에 묻힌 층
          cell(f.i, f.j, k, tile, wall, { shade });
        }
      }

      if (!st.noFloors) {
        // 속: 층마다 얇은 바닥판 + 성긴 기둥. 부서졌을 때 층이 드러나고 속이 텅 비어 보이지 않게.
        // 바닥판은 2×2칸을 한 판으로 묶어 블록 수를 1/4로 줄인다. 층 간격은 지붕에서부터 LAYERS_PER_FLOOR단씩.
        // ponytail: 계단·벽체·방 구분은 없다. 더 채우려면 기둥 자리에 칸막이벽을 추가.
        const R = layers - 1; // 지붕 층
        const slabs = [];
        for (let n = 1; n < def.floors; n++) if (R - LAYERS_PER_FLOOR * n > 0) slabs.push(R - LAYERS_PER_FLOOR * n);
        slabs.reverse();
        const inner = foot.filter((f) => !f.wall);
        const innerKeys = new Set(inner.map((f) => f.key));
        const used = new Set();
        for (const f of inner) {
          if (used.has(f.key)) continue;
          const quad = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => `${f.i + a},${f.j + b}`);
          const big = quad.every((k) => innerKeys.has(k) && !used.has(k));
          const cells = big ? quad.map((k) => footMap.get(k)) : [f];
          cells.forEach((c) => used.add(c.key));
          const ground = Math.max(...cells.map((c) => c.ground));
          const [u, v] = big ? [U(f.i + 0.5), U(f.j + 0.5)] : [U(f.i), U(f.j)];
          for (const L of slabs) {
            const y = bottom + L * BLOCK;
            if (y > ground + 1) add(u, v, y + 0.125 * BLOCK, TILE.PLAIN, '#cfcbc4', { sx: big ? 2 : 1, sz: big ? 2 : 1, sy: 0.25, roof: '#ddd7cb' });
          }
        }
        for (const f of inner) { // 기둥: 8칸(24m)마다, 층마다 한 토막
          if (f.i % 8 || f.j % 8) continue;
          const levels = [Math.max(0, gk(f.ground) + 1), ...slabs.filter((L) => L > gk(f.ground) + 1), R];
          for (let n = 0; n < levels.length - 1; n++) {
            const y0 = bottom + levels[n] * BLOCK + (n ? 0.25 * BLOCK : 0);
            const y1 = bottom + levels[n + 1] * BLOCK;
            if (y1 - y0 > 1) add(U(f.i), U(f.j), (y0 + y1) / 2, TILE.PLAIN, '#d6d2ca', { sx: 0.35, sz: 0.35, sy: (y1 - y0) / BLOCK });
          }
        }
      }

      if (st.entrance) { // 현관 캐노피
        for (const key of doorKeys) {
          const o = footMap.get(key);
          if (o) slab(...outside(o), bottom + (gk(o.ground) + 1) * BLOCK - 0.25 * BLOCK, 0.2, TILE.PLAIN, st.entrance, { roof: st.entrance });
        }
      }

      if (st.portico && run.length >= 6) { // 정면 가운데 열주 + 엔타블러처 + 계단 (+ 박공)
        // grand(중앙도서관): 정면 대부분을 덮는 굵은 열주가 3.5m 기단 위에 서고, 기단 앞으로 5단 대계단이 광장까지 내려간다.
        const hs = st.grand ? Math.floor(run.length * 0.42) : Math.min(8, Math.floor(run.length * 0.3));
        const o0 = outer.get(tc);
        const g0 = gk(o0.ground);
        const colTop = Math.min(layers - 1, g0 + Math.max(2, Math.round((layers - 1 - g0) * (st.grand ? 0.8 : 0.65))));
        const podium = o0.ground + 3.5;
        for (let t = tc - hs; t <= tc + hs; t++) {
          const o = outer.get(t);
          if (!o) continue;
          const [pi, pj] = outside(o);
          if (st.grand) {
            for (let m = 1; m <= 6; m++) {
              const [si, sj] = outside(o, m);
              pillarAt(...toWorld(U(si), U(sj)), angle, podium - (m - 1) * 0.7, TILE.PLAIN, st.wall, { shade: m === 1 ? 0.92 : 0.97 });
            }
            const colBottom = podium;
            const colEnd = yk(colTop) - BLOCK / 2;
            if ((t - tc) % 2 === 0) add(U(pi), U(pj), (colBottom + colEnd) / 2, TILE.COLUMN, st.wall, { sx: 0.6, sz: 0.6, sy: (colEnd - colBottom) / BLOCK });
          } else {
            const g = Math.max(g0, gk(groundAt(pi, pj)));
            if ((t - tc) % 2 === 0) column(pi, pj, bottom + g * BLOCK, colTop - g, st.wall);
            const [si, sj] = outside(o, 2);
            slab(si, sj, groundAt(si, sj) - 0.2, 0.25, TILE.PLAIN, st.wall, { shade: 0.95 }); // 현관 계단
          }
          cell(pi, pj, colTop, TILE.CORNICE, st.wall);
          if (st.pediment) {
            for (let n = 1; n <= hs - Math.abs(t - tc); n++) slab(pi, pj, yk(colTop) + BLOCK / 2 + (n - 1) * 0.5 * BLOCK, 0.5, TILE.PLAIN, st.wall);
          }
        }
      }

      if (st.canopy) { // 지붕 위로 사방 한 칸씩 튀어나온 얇은 처마판 (전자정보대학관)
        const done = new Set();
        for (const f of foot) {
          for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const k2 = `${f.i + a},${f.j + b}`;
            if (done.has(k2)) continue;
            done.add(k2);
            slab(f.i + a, f.j + b, roofY + 0.9, 0.25, TILE.PLAIN, st.canopy, { roof: st.canopy });
          }
        }
      } else if (st.parapet) {
        for (const f of foot) if (f.wall) slab(f.i, f.j, roofY, 0.35, st.parapet, st.wall);
      }

      if (st.attic && foot.length >= 30) { // 가운데가 한 단 높은 옥탑
        const half = Math.max(2, Math.round(run.length * 0.25));
        for (const f of foot) if (inset.get(f.key) >= 2 && Math.abs(tOf(f) - tc) <= half) cell(f.i, f.j, layers, TILE.CORNICE, st.wall);
      }

      if (st.rooftop && foot.length >= 8 && !st.canopy) { // 계단실 + 설비
        const inner = foot.filter((f) => inset.get(f.key) >= 1);
        const mid = inner.reduce((a, f) => (Math.hypot(f.i - ci, f.j - cj) < Math.hypot(a.i - ci, a.j - cj) ? f : a), inner[0]);
        if (mid) for (const [a, b] of [[0, 0], [1, 0]]) if (has(mid.i + a, mid.j + b)) cell(mid.i + a, mid.j + b, layers, TILE.WINDOW, st.wall);
        for (const f of inner) {
          if ((f.i * 7 + f.j * 13) % 11 === 0 && f !== mid) slab(f.i, f.j, roofY, 0.45, TILE.PLAIN, '#b9bdc0', { sx: 0.6, sz: 0.6, roof: '#9ea3a6' });
        }
      }

      if (st.clockFront && outer.get(tc)) { // 정면 가운데 위로 솟은 시계탑 (공학관)
        const o = outer.get(tc);
        for (const k of [layers, layers + 1]) cell(o.i, o.j, k, k === layers ? TILE.CLOCK : TILE.PLAIN, st.wall);
        slab(o.i, o.j, roofY + 2 * BLOCK, 0.2, TILE.PLAIN, st.wall, { sx: 1.2, sz: 1.2 });
      }

      if (st.steppedRoof) { // 가운데로 갈수록 한 단씩 높아지는 돔형 금속 지붕
        for (let n = 1; n <= 3; n++) for (const f of foot) if (inset.get(f.key) >= 2 * n) cell(f.i, f.j, layers - 1 + n, TILE.PLAIN, st.roof);
      }

      if (st.clockTower && outer.get(tc)) { // 정면에 붙은 시계탑 + 청록 피라미드 지붕
        const [ti, tj] = outside(outer.get(tc));
        for (let k = Math.max(0, gk(groundAt(ti, tj))); k < layers + 3; k++) {
          const upper = k >= layers;
          cell(ti, tj, k, k === layers + 1 ? TILE.CLOCK : upper ? TILE.ARCH : TILE.PLAIN, upper ? '#efe9dc' : st.wall);
        }
        [1.1, 0.75, 0.4].forEach((w, n) => slab(ti, tj, roofY + 3 * BLOCK + n * 0.4 * BLOCK, 0.4, TILE.PLAIN, st.clockTower, { sx: w, sz: w, roof: st.clockTower }));
      }

      if (st.gable) { // 긴 축을 따라 용마루가 생기는 박공지붕 (inset만큼 안쪽에서 시작: 옥상 온실)
        const { tile, color, inset: gin } = st.gable;
        const cells = foot.filter((f) => inset.get(f.key) >= gin);
        const jMin = new Map();
        const jMax = new Map();
        for (const f of cells) {
          jMin.set(f.i, Math.min(jMin.get(f.i) ?? Infinity, f.j));
          jMax.set(f.i, Math.max(jMax.get(f.i) ?? -Infinity, f.j));
        }
        for (const f of cells) {
          const steps = Math.min(3, f.j - jMin.get(f.i), jMax.get(f.i) - f.j);
          for (let n = 0; n <= steps; n++) slab(f.i, f.j, roofY + n * 0.3 * BLOCK, 0.3, tile, color, { roof: color });
        }
      }
    }

    const [x, z] = toWorld(U(ci), U(cj));
    return { id: def.id, name: def.name, floors: def.floors, total: blocks.length - first, center: [x, z], top: topY };
  });

  // --- 사색의 광장 (사진 참고): 도서관에서 광장 쪽으로 뻗은 축을 따라 연못·3단 분수, 조각상, 아치 회랑,
  // 끝에 오벨리스크 한 쌍. OSM 잔디 화단은 산울타리로 두르고, 축 양옆에 가로등. 한 "건물"로 묶어 파괴율에 넣는다.
  const pools = []; // 바닥 텍스처에 물로 칠할 다각형 (main.js)
  const lib = buildings.find((b) => b.name.includes('중앙도서관'));
  if (plaza && lib) {
    const pb = buildings.length;
    const first = blocks.length;
    const [lx, lz] = lib.center;
    let dx = plazaCenter[0] - lx;
    let dz = plazaCenter[1] - lz;
    const dl = Math.hypot(dx, dz);
    dx /= dl;
    dz /= dl;
    const axis = Math.atan2(dz, dx);
    const proj = plaza.outline.map(([x, z]) => [(x - lx) * dx + (z - lz) * dz, -(x - lx) * dz + (z - lz) * dx]);
    const aMin = Math.min(...proj.map((p) => p[0]));
    const L = Math.max(...proj.map((p) => p[0])) - aMin; // 축 방향 길이
    const Wd = Math.max(...proj.map((p) => Math.abs(p[1]))); // 축에서 가장자리까지
    const P = (a, b) => [lx + (aMin + a) * dx - b * dz, lz + (aMin + a) * dz + b * dx]; // a: 도서관 쪽 끝부터, b: 축 옆으로
    const put = (a, b, y, ang, tile, wall, opt = {}) => { // y는 그 자리 지면에서 블록 중심까지
      const [x, z] = P(a, b);
      push(pb, x, heightAt(x, z) + y, z, ang, tile, wall, opt);
    };
    const WHITE = '#f1eee6';
    const across = axis + Math.PI / 2;

    const pa0 = 0.06 * L;
    const pa1 = 0.42 * L;
    const pw = 3.5;
    pools.push([P(pa0, -pw), P(pa1, -pw), P(pa1, pw), P(pa0, pw)]);
    for (let a = pa0; a < pa1 - 1; a += 3) for (const b of [-pw, pw]) put(a + 1.5, b, 0.2, axis, TILE.PLAIN, WHITE, { sy: 0.15, sz: 0.15 });
    for (const a of [pa0, pa1]) for (let b = -pw; b < pw - 1; b += 3) put(a, b + 1.5, 0.2, across, TILE.PLAIN, WHITE, { sy: 0.15, sz: 0.15 });
    for (const f of [0.14, 0.24, 0.34]) { // 3단 분수
      const a = f * L;
      put(a, 0, 0.3, axis, TILE.PLAIN, WHITE, { sx: 1.1, sy: 0.2, sz: 1.1 });
      put(a, 0, 1.05, axis, TILE.COLUMN, WHITE, { sx: 0.25, sy: 0.3, sz: 0.25 });
      put(a, 0, 1.7, axis, TILE.PLAIN, WHITE, { sx: 0.6, sy: 0.12, sz: 0.6 });
      put(a, 0, 2.6, axis, TILE.PLAIN, '#d6efff', { sx: 0.1, sy: 0.5, sz: 0.1, roof: '#eef9ff' }); // 물줄기
    }

    const sa = 0.55 * L; // 조각상: 대좌 + 인물 셋
    put(sa, 0, 1.0, axis, TILE.BASE, WHITE, { sx: 1.2, sy: 0.7, sz: 1.2 });
    for (const [b, hgt] of [[-0.8, 1.1], [0, 1.5], [0.8, 1.1]]) put(sa, b, 2.05 + hgt * 1.5, axis, TILE.PLAIN, '#e9e5dc', { sx: 0.25, sy: hgt, sz: 0.3 });

    const aa = 0.68 * L; // 광장을 가로지르는 낮은 아치 회랑 (가운데는 통로)
    for (let b = -0.34 * Wd; b < 0.34 * Wd - 1.5; b += 3) {
      if (Math.abs(b + 1.5) < 6) continue;
      put(aa, b + 1.5, 2.1, across, TILE.ARCH, WHITE, { sy: 1.4, sz: 0.3 });
      put(aa, b + 1.5, 4.43, across, TILE.CORNICE, WHITE, { sy: 0.15, sz: 0.4 });
    }

    for (const side of [-1, 1]) { // 오벨리스크 한 쌍: 기단 + 9단으로 가늘어지는 기둥 + 피라미드 꼭지
      const [a, b] = [0.9 * L, side * 0.3 * Wd];
      put(a, b, 1.5, axis, TILE.BASE, WHITE, { sx: 1.6, sz: 1.6 });
      put(a, b, 3.6, axis, TILE.PLAIN, WHITE, { sx: 1.2, sy: 0.4, sz: 1.2 });
      for (let k = 0; k < 9; k++) {
        const w = 0.95 - k * 0.045;
        put(a, b, 4.2 + (k + 0.5) * BLOCK, axis, TILE.PLAIN, WHITE, { sx: w, sz: w });
      }
      [0.5, 0.33, 0.16].forEach((w, k) => put(a, b, 31.2 + (k + 0.5) * 0.9, axis, TILE.PLAIN, '#e4dccb', { sx: w, sy: 0.3, sz: w }));
    }

    for (let a = 6; a < L - 6; a += 15) { // 가로등
      for (const b of [-9, 9]) {
        put(a, b, 2.1, axis, TILE.PLAIN, '#3a3d42', { sx: 0.06, sy: 1.4, sz: 0.06 });
        put(a, b, 4.4, axis, TILE.PLAIN, '#fff4cf', { sx: 0.15, sy: 0.15, sz: 0.15 });
      }
    }

    // 광장 안 잔디 화단 둘레 산울타리 (1.5m 토막)
    for (const g of campus.areas.filter((x) => x.kind === 'grass' && inside(centroid(x.outline), [plaza.outline]))) {
      g.outline.forEach((p, n) => {
        const q = g.outline[(n + 1) % g.outline.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const pieces = Math.max(1, Math.round(len / 1.5));
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        for (let k = 0; k < pieces; k++) {
          const x = p[0] + ((q[0] - p[0]) * (k + 0.5)) / pieces;
          const z = p[1] + ((q[1] - p[1]) * (k + 0.5)) / pieces;
          push(pb, x, heightAt(x, z) + 0.4, z, ang, TILE.PLAIN, '#3f7a3a', { sx: len / pieces / BLOCK, sy: 0.3, sz: 0.25, roof: '#4c8a45' });
        }
      });
    }

    const [cx, cz] = P(0.5 * L, 0);
    buildings.push({ id: 'plaza', name: '사색의 광장', floors: 0, total: blocks.length - first, center: [cx, cz], top: heightAt(cx, cz) + 6 });
  }

  // BoxGeometry 면 순서: +x, -x, +y(지붕), -y, +z, -z.
  // 옆면: 아틀라스에서 블록별 칸(aTile)을 골라 벽 색(instanceColor)과 곱한다. 위아래: 블록별 지붕색(aRoof).
  const facade = new THREE.MeshLambertMaterial({ map: facadeAtlas() });
  facade.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv.x = (vMapUv.x + aTile) / ${TILE_COUNT}.0;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `
      float wallMask = clamp((sampledDiffuseColor.a - ${GLASS_ALPHA.toFixed(4)}) / ${(1 - GLASS_ALPHA).toFixed(4)}, 0.0, 1.0);
      diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, wallMask); // 유리에는 벽 색을 곱하지 않는다
      diffuseColor.a = 1.0;`);
  };
  const roof = new THREE.MeshLambertMaterial();
  roof.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoof;\nvarying vec3 vRoof;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoof = aRoof;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoof;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vRoof;');
  };
  const geometry = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
  const mesh = new THREE.InstancedMesh(geometry, [facade, facade, roof, roof, facade, facade], blocks.length);
  const tiles = new Float32Array(blocks.length);
  const roofs = new Float32Array(blocks.length * 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  blocks.forEach((bl, n) => {
    // three의 Y축 회전은 xz 평면 각도와 부호가 반대
    mesh.setMatrixAt(n, m.compose(p.set(bl.x, bl.y, bl.z), q.setFromAxisAngle(up, -bl.angle), scale.set(bl.sx, bl.sy, bl.sz)));
    const jitter = 0.96 + Math.random() * 0.06;
    mesh.setColorAt(n, color.set(bl.wall).multiplyScalar(bl.shade * jitter));
    color.set(bl.roof).multiplyScalar(jitter).toArray(roofs, n * 3);
    tiles[n] = bl.tile;
  });
  geometry.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1));
  geometry.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roofs, 3));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, blocks, buildings, pools };
}
