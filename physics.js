// 파괴 물리 (Rapier). 시작·리셋 때 건물마다 블록을 무작위 "덩어리"(평균 CHUNK_SIZE개, 한 층 높이로 납작하게)로
// 묶고, 평소엔 덩어리마다 감싸는 상자 하나가 정적 충돌체다.
// Rapier step은 바디가 없어도 충돌체 수에 비례해 느려진다 (실측: 정적 충돌체 2.5만 개면 빈 world도 step 3.5ms).
// 그래서 제자리 덩어리 전부는 조준용 query world에만 두고, 시뮬레이션 world에는 지형·움직이는 덩어리·잔해와
// 움직이는 덩어리 근처의 제자리 덩어리만 그때그때 넣는다.
// 폭발에 맞으면 폭심 가까운 블록은 가루(사라짐), 나머지는 덩어리째 하나의 동적 바디로 떨어져 나간다.
// 실제 건물처럼 벽판·슬래브 조각 단위로 무너지고, 바디 수도 블록 단위보다 훨씬 적다.
// 멈춘 덩어리는 바디를 없애고 그 자리에 정적 충돌체만 남겨(잔해) 계산에서 빼고, 근처에 다시 폭발이 나면 바디를 되살린다.
// ponytail: 1차 구현은 "맞은 곳만 부서진다". 받침이 사라져도 위층은 떠 있다(지지 구조 붕괴 없음).
//           덩어리는 떨어지며 다시 쪼개지지 않는다. 쪼개려면 충돌 세기를 보고 바디를 둘로 나눈다.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { BLOCK } from './buildings.js';

// 동시에 움직이는 덩어리 상한. 넘으면 가장 오래된 덩어리부터 지운다. (Core Ultra 9 285H 기준)
const MAX_ACTIVE = 500;
const MAX_PIECES_PER_BLAST = 250; // 폭발 한 번에 새로 떨어져 나가는 덩어리 상한. 넘는 것은 가루로
const CHUNK_SIZE = 10; // 처음 묶는 덩어리 평균 블록 수 (오목한 덩어리는 boxy가 더 나눠서 실제론 더 작다)
const FLAT = 1.8; // 덩어리를 묶을 때 세로 거리를 이만큼 크게 쳐서 한 층 높이 안에서 납작하게 묶이게
const MIN_FILL = 0.5; // 덩어리 블록이 감싸는 상자를 이 비율 이상 채우도록 나눈다 (아래 boxy)
const DUST_ZONE = 0.6; // 폭심에서 반경의 (1 - 이 값) 안쪽 블록은 가루가 된다
const SETTLE_TIME = 1; // 이 시간(초) 동안 거의 멈춰 있으면 잔해로 굳힌다
const CELL = 6; // 검색용 격자 크기(m)
const INTACT = 0, PIECE = 1, GONE = 2;
// 충돌 그룹 (Rapier: 상위 16비트 = 소속, 하위 16비트 = 부딪힐 상대)
const G_TERRAIN = 1, G_INTACT = 2, G_PIECE = 4;
const groups = (member, filter) => (member << 16) | filter;
// 떨어져 나온 직후의 덩어리는 아직 붙어 있던 이웃 블록과 겹쳐 있어, 잠깐(PASS_TIME초) 제자리 블록과 부딪히지 않게 한다.
// 겹친 채 부딪히면 서로 밀쳐내며 튀고, 계속 떨려서 잠들지 않아 물리 계산이 무거워진다.
const PASS_TIME = 0.35;
const MAX_LIFE = 6; // 이 시간(초)이 지나도 덜덜 떨기만 하는 덩어리는 강제로 굳힌다

export async function createPhysics({ blocks, mesh, terrainGeo, buildings, heightAt }) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.numSolverIterations = 2; // 기본 4. 파편 놀이에는 정확도보다 속도
  // 조준 레이 검사 전용 world (바디 없음). 리셋 때마다 새로 만들고, 부서진 덩어리는 지우는 대신 gone에 넣어
  // 레이 검사에서 거른다 (지우면 검사 구조를 갱신하는 step이 폭발마다 6~10ms 걸린다).
  let query = null;
  const gone = new Set(); // query world에서 부서진 덩어리 충돌체 handle
  // 잔해(떨어져 나온 덩어리)가 이후 폭발에 이만큼 더 휘말리면 가루로 사라진다. 패널 슬라이더(setMaxHits).
  // 0이면 멈추자마자(그 전에 휘말려도) 사라지고, Infinity면 폭심 바로 옆이 아닌 한 사라지지 않는다.
  let maxHits = 4;
  const poofs = []; // 폭심 밖에서 가루가 된 잔해 자리 { x, y, z, size, color }. 연출이 drainPoofs로 가져간다
  const poof = (pc, t) => poofs.push({ x: t.x, y: t.y, z: t.z, size: Math.max(pc.size.x, pc.size.y, pc.size.z), color: blocks[pc.members[0]].wall });

  // 지형: 렌더용 지형 메시와 똑같은 삼각형 (높이맵 충돌체는 대각선 방향이 달라 파편이 뜨거나 묻힐 수 있다)
  const terrainDesc = () => RAPIER.ColliderDesc.trimesh(
    new Float32Array(terrainGeo.attributes.position.array),
    new Uint32Array(terrainGeo.index.array),
  ).setFriction(0.9).setCollisionGroups(groups(G_TERRAIN, 0xffff));
  world.createCollider(terrainDesc());

  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const n = blocks.length;
  const state = new Uint8Array(n);
  const active = new Set(); // 움직이는 덩어리 { body, members, locals, still } (삽입 순서 = 오래된 순)
  const rubble = new Set(); // 굳은 덩어리 (바디 없이 정적 충돌체만)
  // 격자 칸 번호는 문자열 대신 숫자로 (리셋 때 수십만 번 찾으므로 문자열 키는 수백 ms가 든다)
  const cellId = (cx, cz) => (cx + 4096) * 8192 + cz + 4096;
  const CX = new Int32Array(n); // 블록이 있는 격자 칸
  const CY = new Int32Array(n); // 세로는 FLAT배로 쳐서 나눈 칸 (덩어리 나누기용)
  const CZ = new Int32Array(n);
  const grid = new Map(); // 칸 → 처음 자리에 있던 블록 번호들 (폭발 범위 검색)
  blocks.forEach((bl, i) => {
    CX[i] = Math.floor(bl.x / CELL);
    CY[i] = Math.floor((bl.y * FLAT) / CELL);
    CZ[i] = Math.floor(bl.z / CELL);
    const key = cellId(CX[i], CZ[i]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  for (const b of buildings) b.destroyed = 0;

  // 덩어리 기준점 c에 대한 블록 하나의 상대 행렬
  const localOf = (i, c) => {
    const bl = blocks[i];
    q.setFromAxisAngle(up, -bl.angle);
    return new THREE.Matrix4().compose(p.set(bl.x - c.x, bl.y - c.y, bl.z - c.z), q, s.set(bl.sx, bl.sy, bl.sz));
  };
  // 블록 i가 건물 축(각도 a0, 그 역회전 inv) 좌표에서 차지하는 범위 [x0, y0, z0, x1, y1, z1].
  // 블록은 세로축으로만 돌아가 있으니 각도 차이만큼 돌린 상자의 범위를 바로 계산한다.
  const extent = (i, a0, inv) => {
    const bl = blocks[i];
    const co = Math.abs(Math.cos(bl.angle - a0));
    const si = Math.abs(Math.sin(bl.angle - a0));
    const hx = (BLOCK / 2) * (co * bl.sx + si * bl.sz);
    const hy = (BLOCK / 2) * bl.sy;
    const hz = (BLOCK / 2) * (si * bl.sx + co * bl.sz);
    p.set(bl.x, bl.y, bl.z).applyQuaternion(inv);
    return [p.x - hx, p.y - hy, p.z - hz, p.x + hx, p.y + hy, p.z + hz];
  };
  const boxVol = (e) => (e[3] - e[0]) * (e[4] - e[1]) * (e[5] - e[2]);
  const merge = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
  // 블록들을 감싸는 상자 (건물 축 방향): c 기준 크기·중심·방향
  function fitBox(members, c) {
    const a0 = blocks[members[0]].angle;
    const axis = new THREE.Quaternion().setFromAxisAngle(up, -a0);
    const inv = axis.clone().invert();
    const e = members.map((i) => extent(i, a0, inv)).reduce(merge);
    const size = new THREE.Vector3(e[3] - e[0], e[4] - e[1], e[5] - e[2]);
    const mid = new THREE.Vector3((e[0] + e[3]) / 2, (e[1] + e[4]) / 2, (e[2] + e[5]) / 2).applyQuaternion(axis).sub(c);
    return { c, size, mid, axis };
  }
  const centroid = (members) => {
    const c = new THREE.Vector3();
    for (const i of members) c.add(p.set(blocks[i].x, blocks[i].y, blocks[i].z));
    return c.divideScalar(members.length);
  };
  // 상자는 조금 작게: 정적은 2%, 덩어리는 6%. 이웃과 딱 붙은 채 동적으로 바뀌면 첫 프레임에
  // 접촉이 한꺼번에 몰려 물리 계산이 크게 느려지고 서로 밀쳐 튄다.
  const cuboid = (size, k) => RAPIER.ColliderDesc.cuboid(size.x * k, size.y * k, size.z * k).setFriction(0.8).setRestitution(0.05);
  // 덩어리 충돌체는 감싸는 상자 하나 (블록 상자들을 묶은 복합 충돌체는 step이 몇 배 무겁다).
  // ㄱ자처럼 오목한 덩어리는 상자에 빈 곳이 많아 파편이 허공에 걸리므로, 블록이 상자를 MIN_FILL 이상
  // 채울 때까지 둘로 나눈다. 세 축마다 블록을 줄 세워 두 쪽 상자 부피의 합이 가장 작은 자리에서 자르므로
  // ㄱ자는 모서리에서 잘린다 (반씩 자르면 한쪽 팔이 토막 나 한 블록짜리가 많이 생긴다).
  function boxy(members) {
    const c = centroid(members);
    const fb = fitBox(members, c);
    const vol = members.reduce((t, i) => t + blocks[i].sx * blocks[i].sy * blocks[i].sz, 0) * BLOCK ** 3;
    if (members.length < 2 || vol >= MIN_FILL * fb.size.x * fb.size.y * fb.size.z) return [{ members, ...fb }];
    const inv = fb.axis.clone().invert();
    const ext = members.map((i) => extent(i, blocks[members[0]].angle, inv));
    let best = { cost: Infinity };
    for (let ax = 0; ax < 3; ax++) {
      const order = ext.map((_, k) => k).sort((a, b) => ext[a][ax] + ext[a][ax + 3] - ext[b][ax] - ext[b][ax + 3]);
      const suf = [];
      for (let k = order.length - 1; k >= 0; k--) suf[k] = k === order.length - 1 ? ext[order[k]] : merge(ext[order[k]], suf[k + 1]);
      let pre = ext[order[0]];
      for (let h = 1; h < order.length; h++) {
        const cost = boxVol(pre) + boxVol(suf[h]);
        if (cost < best.cost) best = { cost, order, h };
        pre = merge(pre, ext[order[h]]);
      }
    }
    const sorted = best.order.map((k) => members[k]);
    return [...boxy(sorted.slice(0, best.h)), ...boxy(sorted.slice(best.h))];
  }

  // --- 덩어리 나누기: 무작위 씨앗 블록을 뽑고, 같은 건물·같은 종류(벽체 / 얇은 바닥판) 안에서 가장 가까운 씨앗에 붙인다 (보로노이).
  // 바닥판과 벽이 한 덩어리에 섞이면 ㄴ자가 되어 boxy가 잘게 쪼갠다. ---
  const chunkOf = new Int32Array(n);
  let chunks = []; // { members, c, size, mid, axis, intact, handle(query world 충돌체), sim(시뮬레이션 world, 근처에 움직임이 있을 때만) }
  let chunkCells = new Map(); // 칸 → 그 칸에 블록이 있는 덩어리 번호들
  let live = []; // 시뮬레이션 world에 들어가 있는 덩어리 번호들
  const chunkDesc = ({ c, size, mid, axis }) => cuboid(size, 0.49).setTranslation(c.x + mid.x, c.y + mid.y, c.z + mid.z)
    .setRotation(axis).setCollisionGroups(groups(G_INTACT, G_PIECE));
  function buildChunks() {
    const key = (g, cx, cy, cz) => ((g * 8192 + cx + 4096) * 512 + cy + 256) * 8192 + cz + 4096;
    const group = (i) => blocks[i].b * 2 + (blocks[i].sy < 0.5 ? 1 : 0); // 건물 × 종류
    const seeds = new Map();
    const cells = []; // { seed, members }
    const addSeed = (i) => {
      const k = key(group(i), CX[i], CY[i], CZ[i]);
      if (!seeds.has(k)) seeds.set(k, []);
      seeds.get(k).push(cells.length);
      cells.push({ seed: i, members: [] });
      return cells.length - 1;
    };
    blocks.forEach((bl, i) => {
      if (Math.random() < 1 / CHUNK_SIZE) addSeed(i);
    });
    blocks.forEach((bl, i) => {
      const cx = CX[i];
      const cy = CY[i];
      const cz = CZ[i];
      const g = group(i);
      let best = -1;
      let bd = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const c of seeds.get(key(g, cx + dx, cy + dy, cz + dz)) ?? []) {
              const s0 = blocks[cells[c].seed];
              const d = (s0.x - bl.x) ** 2 + ((s0.y - bl.y) * FLAT) ** 2 + (s0.z - bl.z) ** 2;
              if (d < bd) [bd, best] = [d, c];
            }
          }
        }
      }
      if (best < 0) best = addSeed(i); // 근처에 씨앗이 없으면 이 블록이 새 씨앗 (이후 이웃이 여기에 붙는다)
      cells[best].members.push(i);
    });
    chunks = cells.filter((cell) => cell.members.length).flatMap((cell) => boxy(cell.members)); // 같은 자리 씨앗이 둘이면 하나는 빈다
    query?.free();
    query = new RAPIER.World({ x: 0, y: 0, z: 0 });
    query.createCollider(terrainDesc());
    gone.clear();
    chunkCells = new Map();
    chunks.forEach((ch, k) => {
      for (const i of ch.members) {
        chunkOf[i] = k;
        const key = cellId(CX[i], CZ[i]);
        if (!chunkCells.has(key)) chunkCells.set(key, []);
        const list = chunkCells.get(key);
        if (list[list.length - 1] !== k) list.push(k);
      }
      ch.handle = query.createCollider(chunkDesc(ch)).handle;
      ch.sim = null;
      ch.intact = true;
    });
    query.step(); // 충돌체를 레이 검사 구조에 넣는다
  }
  buildChunks();
  world.step(); // 지형을 레이 검사 구조에 넣는다 (움직이는 바디가 없으면 이후엔 step을 건너뛰므로)
  const original = mesh.instanceMatrix.array.slice(); // 리셋용 처음 자세

  const m = new THREE.Matrix4();
  const bodyM = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const hidden = new THREE.Matrix4().makeScale(1e-3, 1e-3, 1e-3).setPosition(0, -1e4, 0);
  let dirty = false;
  // 바뀐 인스턴스 번호의 최소~최대만 GPU에 올린다 (전체 행렬을 매 프레임 올리면 수 MB)
  let lo = Infinity;
  let hi = -1;
  const setMatrix = (i, matrix) => {
    mesh.setMatrixAt(i, matrix);
    lo = Math.min(lo, i);
    hi = Math.max(hi, i);
  };

  // 움직이는 덩어리 둘레 칸의 제자리 덩어리를 시뮬레이션 world에 넣는다. 덩어리가 다른 칸으로 옮겨 갔을 때만 검사.
  function liven(pc) {
    const t = pc.body.translation();
    const cx = Math.floor(t.x / CELL);
    const cz = Math.floor(t.z / CELL);
    if (pc.cx === cx && pc.cz === cz) return;
    pc.cx = cx;
    pc.cz = cz;
    const r = 1 + Math.ceil(Math.max(pc.size.x, pc.size.y, pc.size.z) / 2 / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (const k of chunkCells.get(cellId(cx + dx, cz + dz)) ?? []) {
          const ch = chunks[k];
          if (!ch.intact || ch.sim) continue;
          ch.sim = world.createCollider(chunkDesc(ch));
          live.push(k);
        }
      }
    }
  }

  const dust = (i) => { // 제자리 블록이 가루가 되어 사라짐
    buildings[blocks[i].b].destroyed++;
    state[i] = GONE;
    setMatrix(i, hidden);
    dirty = true;
  };
  const removePiece = (pc) => { // 덩어리째 사라짐
    if (pc.body) world.removeRigidBody(pc.body);
    else world.removeCollider(pc.collider, true);
    for (const i of pc.members) {
      state[i] = GONE;
      setMatrix(i, hidden);
    }
    active.delete(pc);
    rubble.delete(pc);
    dirty = true;
  };
  // 제자리 블록들을 한 덩어리 동적 바디로: 블록 중심의 평균에 바디를 두고, 덩어리를 감싸는 상자 하나를 붙인다.
  // 블록마다 충돌체를 붙이거나 볼록 껍질을 쓰면 접촉 계산이 몇 배로 늘어 착탄 직후 크게 느려진다 (실측: 블록별 34ms, 볼록 껍질 16ms → 상자).
  function spawnPiece(members, impulse) {
    const c = centroid(members);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(c.x, c.y, c.z).setLinearDamping(0.05).setAngularDamping(0.3));
    for (const i of members) {
      buildings[blocks[i].b].destroyed++;
      state[i] = PIECE;
    }
    const { size, mid, axis } = fitBox(members, c);
    const pc = { body, members, locals: members.map((i) => localOf(i, c)), size, mid, axis, still: 0, age: 0, hits: 0 };
    world.createCollider(boxOf(pc).setCollisionGroups(groups(G_PIECE, G_TERRAIN | G_PIECE)), body);
    liven(pc);
    const mass = body.mass();
    body.applyImpulse({ x: impulse.x * mass, y: impulse.y * mass, z: impulse.z * mass }, true);
    const spin = mass * Math.sqrt(members.length) * 3; // 덩어리가 클수록 천천히 구르게(관성) 토크는 완만하게만 키움
    body.applyTorqueImpulse({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin }, true);
    active.add(pc);
    return pc;
  }
  const boxOf = (pc) => cuboid(pc.size, 0.47).setTranslation(pc.mid.x, pc.mid.y, pc.mid.z).setRotation(pc.axis); // 바디 기준
  // 멈춘 덩어리: 바디를 지우고 같은 상자를 바디 없는 정적 충돌체로 남긴다 (고정 바디로 바꿔 두는 것보다 step이 가볍다)
  const settle = (pc) => {
    if (maxHits === 0) { // 잔해를 남기지 않는 설정
      poof(pc, pc.body.translation());
      removePiece(pc);
      return;
    }
    const col = pc.body.collider(0);
    const t = pc.body.translation();
    const r = pc.body.rotation();
    pc.pose = { t: { x: t.x, y: t.y, z: t.z }, r: { x: r.x, y: r.y, z: r.z, w: r.w } };
    const ct = col.translation();
    pc.collider = world.createCollider(cuboid(pc.size, 0.47).setTranslation(ct.x, ct.y, ct.z)
      .setRotation(col.rotation()).setCollisionGroups(groups(G_PIECE, 0xffff)));
    world.removeRigidBody(pc.body);
    pc.body = null;
    active.delete(pc);
    rubble.add(pc);
    dirty = true; // 한 번 더 step해서 레이 검사 구조에 넣는다
  };
  const wake = (pc) => { // 잔해 → 같은 자세의 동적 바디로 되살림
    world.removeCollider(pc.collider, true);
    pc.collider = null;
    const { t, r } = pc.pose;
    pc.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(t.x, t.y, t.z).setRotation(r).setLinearDamping(0.05).setAngularDamping(0.3));
    world.createCollider(boxOf(pc).setCollisionGroups(groups(G_PIECE, 0xffff)), pc.body);
    pc.cx = undefined;
    liven(pc);
    pc.still = 0;
    pc.age = PASS_TIME; // 다시 깨어난 잔해는 처음부터 모든 것과 부딪힘
    rubble.delete(pc);
    active.add(pc);
  };

  // point 둘레 radius 안을 부순다. power: 반지름 끝에서 0이 되는 초기 속도(m/s).
  // 반환값: 부서진 블록 번호들 (연출에서 먼지·조각 색을 고르는 데 쓴다).
  function explode(point, radius = 8, power = 30) {
    const reach = radius + BLOCK;
    const dist = (x, y, z) => Math.hypot(x - point.x, y - point.y, z - point.z);
    const dir = new THREE.Vector3();
    const kick = (x, y, z, k) => dir.set(x - point.x, y - point.y + 2, z - point.z).normalize().multiplyScalar(power * k);

    // 이미 움직이는 덩어리는 한 번 더 밀고, 근처 잔해(받침이 사라졌을 수 있음)는 깨운다.
    // 폭심 바로 옆이거나 maxHits번째 휘말린 잔해는 가루로 (같은 곳을 계속 쏘면 같은 조각만 튀며 쌓이지 않게).
    for (const pc of [...active, ...rubble]) {
      const t = pc.body ? pc.body.translation() : pc.pose.t;
      const d = dist(t.x, t.y, t.z);
      if (d > reach * 1.3) continue;
      const center = d < reach * (1 - DUST_ZONE);
      if (center || ++pc.hits >= maxHits) {
        if (!center) poof(pc, t);
        removePiece(pc);
        continue;
      }
      if (rubble.has(pc)) wake(pc);
      const v = kick(t.x, t.y, t.z, Math.max(0.1, 1 - d / reach) * 0.6).multiplyScalar(pc.body.mass()); // 이미 떨어진 잔해는 덜 밀린다
      pc.body.applyImpulse({ x: v.x, y: v.y, z: v.z }, true);
    }

    const hit = [];
    const c0x = Math.floor((point.x - reach) / CELL);
    const c1x = Math.floor((point.x + reach) / CELL);
    const c0z = Math.floor((point.z - reach) / CELL);
    const c1z = Math.floor((point.z + reach) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        for (const i of grid.get(cellId(cx, cz)) ?? []) {
          const bl = blocks[i];
          if (state[i] === INTACT && dist(bl.x, bl.y, bl.z) < reach) hit.push(i);
        }
      }
    }
    // 맞은 블록이 속한 덩어리는 통째로 떨어져 나간다. 그중 폭심 가까이·땅에 박힌 블록만 가루
    // (땅속 블록을 덩어리에 넣으면 지형 속에서 바디가 튀어오른다)
    const broken = [];
    const touched = new Set();
    for (const i of hit) touched.add(chunkOf[i]);
    let made = 0;
    for (const c of touched) {
      const ch = chunks[c];
      gone.add(ch.handle);
      ch.intact = false;
      if (ch.sim) world.removeCollider(ch.sim, true);
      ch.sim = null;
      const members = [];
      for (const i of chunks[c].members) {
        const bl = blocks[i];
        if (1 - dist(bl.x, bl.y, bl.z) / reach > DUST_ZONE || bl.y < heightAt(bl.x, bl.z) + 0.5) {
          dust(i);
          broken.push(i);
        } else members.push(i);
      }
      if (!members.length) continue;
      broken.push(...members);
      if (made++ >= MAX_PIECES_PER_BLAST) {
        members.forEach(dust);
        continue;
      }
      const c0 = centroid(members);
      spawnPiece(members, kick(c0.x, c0.y, c0.z, Math.max(0.15, 1 - dist(c0.x, c0.y, c0.z) / reach)));
    }
    while (active.size > MAX_ACTIVE) removePiece(active.values().next().value); // 상한: 가장 오래된 덩어리부터
    dirty = true;
    return broken;
  }

  // 조준용 레이 검사: 지형·건물(query world)과 잔해·덩어리(시뮬레이션 world) 중 처음 맞는 곳.
  // InstancedMesh 레이캐스트(수만 개 순회)보다 훨씬 빠르다.
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  function raycast(origin, dir, maxDist = 5000) {
    ray.origin = origin;
    ray.dir = dir;
    const far = query.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, undefined, (col) => !gone.has(col.handle));
    const hit = world.castRayAndGetNormal(ray, far ? far.timeOfImpact : maxDist, true) ?? far;
    if (!hit) return null;
    return {
      point: origin.clone().addScaledVector(dir, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    };
  }

  function reset() { // 모든 블록을 처음 자리로, 덩어리는 새로 무작위로
    for (const pc of [...active, ...rubble]) {
      if (pc.body) world.removeRigidBody(pc.body);
      else world.removeCollider(pc.collider, true);
    }
    active.clear();
    rubble.clear();
    for (const ch of chunks) if (ch.sim) world.removeCollider(ch.sim, false);
    live = [];
    state.fill(INTACT);
    for (const b of buildings) b.destroyed = 0;
    poofs.length = 0;
    buildChunks();
    mesh.instanceMatrix.array.set(original);
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.needsUpdate = true;
    lo = Infinity;
    hi = -1;
    world.step();
  }

  function step(dt) {
    if (!active.size && !dirty) return;
    world.timestep = Math.min(dt, 1 / 30);
    world.step();
    for (const pc of active) {
      const t = pc.body.translation();
      if (t.y < -100) { // 지형 밖으로 떨어진 덩어리
        removePiece(pc);
        continue;
      }
      const r = pc.body.rotation();
      bodyM.compose(p.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), one);
      pc.members.forEach((i, k) => setMatrix(i, m.multiplyMatrices(bodyM, pc.locals[k])));
      const v = pc.body.linvel();
      const w = pc.body.angvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      pc.still = speed < 0.3 && Math.hypot(w.x, w.y, w.z) < 0.5 ? pc.still + dt : 0;
      const was = pc.age;
      pc.age += dt;
      if (was < PASS_TIME && pc.age >= PASS_TIME) pc.body.collider(0).setCollisionGroups(groups(G_PIECE, 0xffff)); // 이제 제자리 블록과도 부딪힘
      // 멈춘 덩어리 → 그 자세 그대로 잔해. 오래 떨기만 하는 것도 굳히되, 아직 날아가는 중(빠름)이면 공중에 멈추지 않게 둔다.
      if (pc.still > SETTLE_TIME || (pc.age > MAX_LIFE && speed < 2) || pc.body.isSleeping()) settle(pc);
      else liven(pc);
    }
    if (hi >= lo) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    lo = Infinity;
    hi = -1;
    dirty = false;
    if (!active.size && live.length) { // 모두 멈췄으면 시뮬레이션 world의 제자리 덩어리를 비운다
      for (const k of live) {
        if (!chunks[k].sim) continue;
        world.removeCollider(chunks[k].sim, false);
        chunks[k].sim = null;
      }
      live = [];
      dirty = true; // 한 번 더 step해서 레이 검사 구조에서도 뺀다
    }
  }

  const stats = () => {
    const total = buildings.reduce((t, b) => t + b.total, 0);
    const destroyed = buildings.reduce((t, b) => t + b.destroyed, 0);
    return { active: active.size, rubble: rubble.size, destroyed, ratio: destroyed / total, chunks: chunks.length, live: live.length };
  };

  const setMaxHits = (v) => (maxHits = v);
  const drainPoofs = () => poofs.splice(0);

  return { explode, step, stats, raycast, reset, setMaxHits, drainPoofs };
}
