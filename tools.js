// 도구: 미사일 (조준 → 발사 → 착탄 폭발) + 폭발 연출(불덩이·먼지·파편 조각·섬광·화면 흔들림) + 효과음.
// 효과음은 외부 음원 없이 Web Audio로 잡음·사인파를 그때그때 합성한다.
import * as THREE from 'three';

// 폭발 반경·미사일 속도는 패널 슬라이더로 바꾼다(main.js가 setRadius·setSpeed 호출). 파편 초속·연출 크기·소리는 반경에 맞춰 키운다.
// 아래 수치는 반경 BASE(12m)일 때 기준.
const BASE = 12;
const POWER = 28; // 폭발 가장자리에서 0이 되는 파편 초속(m/s)
const SPEED = 460; // 속도 배율 1일 때 미사일 평균 속도(m/s)
const Z = new THREE.Vector3(0, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);

export function createTools({ scene, camera, physics, heightAt, blocks, onGround }) {
  // --- 조준 원: 커서가 가리키는 면에 폭발 반경만 한 빨간 원 ---
  const aimMat = new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const reticle = new THREE.Group();
  reticle.renderOrder = 10;
  reticle.visible = false;
  scene.add(reticle);
  let radius = 2 * BASE;
  let f = radius / BASE; // 연출 배율
  function setRadius(r) { // 조준 원을 새 반경으로 다시 만든다 (선 굵기는 반경이 커질 때만 조금 굵게)
    radius = r;
    f = r / BASE;
    for (const c of reticle.children) c.geometry.dispose();
    reticle.clear();
    const w = 0.6 * Math.max(1, Math.sqrt(f));
    reticle.add(new THREE.Mesh(new THREE.RingGeometry(r - w, r, 64), aimMat));
    reticle.add(new THREE.Mesh(new THREE.CircleGeometry(w * 1.5, 16), aimMat));
    for (let k = 0; k < 4; k++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, w * 5), aimMat);
      tick.position.set(Math.cos((k * Math.PI) / 2) * (r - w * 4), Math.sin((k * Math.PI) / 2) * (r - w * 4), 0);
      tick.rotation.z = (k * Math.PI) / 2 + Math.PI / 2;
      reticle.add(tick);
    }
  }
  setRadius(radius);
  function aim(hit) {
    reticle.visible = !!hit;
    if (!hit) return;
    reticle.position.copy(hit.point).addScaledVector(hit.normal, 0.3);
    reticle.quaternion.setFromUnitVectors(Z, hit.normal);
  }

  // --- 파티클: 로우폴리 다면체를 키웠다 줄이며 없앤다 (투명도 대신 크기로 사라짐) ---
  function pool(geometry, material, max) {
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color());
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = material.type === 'MeshLambertMaterial' && !material.transparent; // 반투명 연기는 그림자를 만들지 않음
    scene.add(mesh);
    return { mesh, items: [], max };
  }
  const puff = new THREE.IcosahedronGeometry(1, 0);
  // 연기·먼지는 반투명. ponytail: 인스턴스별 투명도는 없어 전체 0.35 고정, 겹친 연기끼리 그리는 순서가 가끔 어긋난다.
  const smoke = pool(puff, new THREE.MeshLambertMaterial({ flatShading: true, transparent: true, opacity: 0.35, depthWrite: false }), 1500);
  const fireballs = pool(puff, new THREE.MeshBasicMaterial(), 300);
  const chips = pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 800);
  // p: 위치, v: 속도, s0→s1: 크기, c0→c1: 색, drag: 공기 저항, g: 중력, bounce: 땅에서 튐
  function spawn(set, p, v, life, s0, s1, c0, c1 = c0, opt = {}) {
    if (set.items.length >= set.max) set.items.shift();
    set.items.push({
      p: p.clone(), v: v.clone(), age: 0, life, s0, s1, c0: new THREE.Color(c0), c1: new THREE.Color(c1),
      drag: opt.drag ?? 0, g: opt.g ?? 0, bounce: !!opt.bounce, spin: new THREE.Quaternion().random(), w: opt.w ?? 0,
    });
  }
  const m = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  const spinStep = new THREE.Quaternion();
  const axis = new THREE.Vector3(1, 1, 0).normalize();
  function updatePool(set, dt) {
    const { items, mesh } = set;
    for (let n = items.length - 1; n >= 0; n--) {
      const it = items[n];
      it.age += dt;
      if (it.age >= it.life) {
        items.splice(n, 1);
        continue;
      }
      it.v.multiplyScalar(Math.max(0, 1 - it.drag * dt));
      it.v.y -= it.g * dt;
      it.p.addScaledVector(it.v, dt);
      if (it.bounce) {
        const ground = heightAt(it.p.x, it.p.z) + 0.2;
        if (it.p.y < ground) {
          it.p.y = ground;
          it.v.set(it.v.x * 0.5, Math.abs(it.v.y) * 0.3, it.v.z * 0.5);
        }
      }
      if (it.w) it.spin.multiply(spinStep.setFromAxisAngle(axis, it.w * dt));
    }
    items.forEach((it, n) => {
      const u = it.age / it.life;
      const size = (it.s0 + (it.s1 - it.s0) * (1 - (1 - u) ** 3)) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1); // 빨리 커지고 끝에 줄어듦
      mesh.setMatrixAt(n, m.compose(it.p, it.spin, sc.setScalar(Math.max(size, 0.001))));
      mesh.setColorAt(n, col.copy(it.c0).lerp(it.c1, u));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // --- 섬광: 점광원 하나를 폭발 자리로 옮겨 잠깐 켠다 (빛 개수가 바뀌면 셰이더가 다시 컴파일되므로 늘 켜 둠) ---
  const flash = new THREE.PointLight('#ffb25c', 0, 90, 2);
  scene.add(flash);
  let flashT = 1;
  let flashPeak = 0;

  // --- 화면 흔들림 ---
  let shake = 0;
  const shakeOffset = new THREE.Vector3();

  // --- 효과음 ---
  let ac = null;
  let master = null;
  let noiseBuf = null;
  let volume = 0.5; // 0~1, 패널 음량 슬라이더
  let speed = 1; // 미사일 속도 배율, 패널 슬라이더
  function audio() {
    if (!ac) {
      ac = new AudioContext();
      const comp = ac.createDynamicsCompressor(); // 여러 발이 겹쳐도 찢어지지 않게
      comp.threshold.value = -16;
      comp.ratio.value = 8;
      master = ac.createGain();
      master.gain.value = volume;
      master.connect(comp).connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  }
  function noise(when, dur, type, f0, f1, vol, q = 1) { // 걸러낸 잡음 한 번
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = rand(0.7, 1.3);
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, when);
    filter.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(when, Math.random());
    src.stop(when + dur + 0.05);
  }
  function tone(when, dur, f0, f1, vol, type = 'sine') { // 음높이가 미끄러지는 단음
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(master);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }
  function launchSound() {
    audio();
    const t = ac.currentTime;
    noise(t, 1.0, 'bandpass', 250, 2800, 0.35, 0.9); // 쉬익
    tone(t, 0.35, 160, 70, 0.12, 'triangle'); // 발사 충격
  }
  function boomSound(dist) {
    audio();
    const t = ac.currentTime + Math.min(0.5, dist / 343); // 멀면 소리가 조금 늦게 온다 (최대 0.5초)
    const v = Math.min(2, Math.sqrt(f)) / (1 + dist / 180); // 큰 폭발일수록 크고 낮게
    tone(t, 1.0 * Math.sqrt(f), 90 / Math.sqrt(f), 30, 0.9 * v); // 저음 쿵
    noise(t, 1.9 * Math.sqrt(f), 'lowpass', 2400, 110, 0.9 * v, 0.7); // 폭음
    noise(t, 0.22, 'highpass', 3500, 1500, 0.45 * v); // 터지는 순간의 파열음
    for (let k = 0; k < 10; k++) { // 잔해가 와르르 떨어지는 소리
      noise(t + rand(0.35, 2.0), rand(0.06, 0.18), 'bandpass', rand(1200, 4000), 700, 0.22 * v, 3);
    }
  }

  // --- 폭발 ---
  const tmp = new THREE.Vector3();
  const vel = new THREE.Vector3();
  function explode(point) {
    const hits = physics.explode(point, radius, POWER * Math.sqrt(f));
    const ground = point.y - heightAt(point.x, point.z) < 2; // 땅에 맞음 → 파인 자국 (main.js)
    if (ground) onGround?.(point, radius);
    const g = f ** 0.8; // 연출 크기 배율
    const count = (n) => Math.round(n * f);
    const wallColors = hits.length ? hits.map((i) => blocks[i].wall) : [ground ? '#8d7b62' : '#9c968c']; // 맞은 게 없으면 흙·회색 먼지
    const pick = () => wallColors[Math.floor(Math.random() * wallColors.length)];
    for (let k = 0; k < count(22); k++) { // 불덩이
      vel.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(6, 18) * g);
      spawn(fireballs, tmp.copy(point).add(vel.clone().multiplyScalar(0.12)), vel, rand(0.5, 1.0) * Math.sqrt(f), 0.8 * g, rand(5, 9) * g, '#ffe08a', '#c2410c', { drag: 3 });
    }
    for (let k = 0; k < count(30); k++) { // 바닥으로 퍼지는 먼지 (부서진 건물 색이 섞임)
      vel.set(rand(-1, 1), rand(0.1, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(4, 12) * g);
      const dust = new THREE.Color(pick()).lerp(new THREE.Color('#b8b1a5'), 0.55);
      spawn(smoke, tmp.copy(point).add(vel.clone().multiplyScalar(0.2)), vel, rand(1.8, 3.2), 2 * g, rand(6, 11) * g, dust, '#d8d3ca', { drag: 1.4, g: -0.4 });
    }
    for (let k = 0; k < count(12); k++) { // 솟구치는 검은 연기 기둥
      vel.set(rand(-0.3, 0.3), 1, rand(-0.3, 0.3)).normalize().multiplyScalar(rand(7, 15) * g);
      spawn(smoke, tmp.copy(point), vel, rand(2.2, 3.6), 1.5 * g, rand(5, 9) * g, '#4b4742', '#8c8780', { drag: 0.9 });
    }
    for (let k = 0; k < count(45); k++) { // 튀는 작은 파편 조각 (물리 없이 보기용)
      vel.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(10, 30) * Math.sqrt(f));
      const size = rand(0.25, 0.9);
      const c = pick();
      spawn(chips, tmp.copy(point).add(vel.clone().multiplyScalar(0.05)), vel, rand(2, 3.5), size, size, c, c, { g: 20, drag: 0.2, bounce: true, w: rand(-12, 12) });
    }
    flash.position.copy(point).y += 4 * g;
    flash.distance = 90 * g;
    flashPeak = 4e4 * f;
    flashT = 0;
    const dist = camera.position.distanceTo(point);
    shake = Math.max(shake, 2.2 * Math.sqrt(f) * Math.exp(-dist / (260 * Math.sqrt(f))));
    if (volume > 0) boomSound(dist);
  }

  // --- 미사일 ---
  const white = new THREE.MeshLambertMaterial({ color: '#e9ecef' });
  const red = new THREE.MeshLambertMaterial({ color: '#d62f2f' });
  const dark = new THREE.MeshLambertMaterial({ color: '#3b3f45' });
  const flame = new THREE.MeshBasicMaterial({ color: '#ffb347' });
  const model = new THREE.Group(); // 앞이 +Z
  model.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 5, 10).rotateX(Math.PI / 2), white));
  model.add(new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.8, 10).rotateX(Math.PI / 2).translate(0, 0, 3.4), red));
  for (let k = 0; k < 4; k++) {
    model.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 1.3).translate(0, 0.95, -1.9).rotateZ((k * Math.PI) / 2 + Math.PI / 4), dark));
  }
  model.add(new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.4, 8).rotateX(-Math.PI / 2).translate(0, 0, -3.7), flame));
  model.traverse((o) => (o.castShadow = true));
  const missiles = [];
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  function fire(hit) {
    if (!hit || missiles.length >= 12) return;
    camera.matrixWorld.extractBasis(camRight, camUp, camFwd); // camFwd = 카메라 뒤쪽(+Z)
    // 카메라 조금 뒤·위에서 쏘아 올려 포물선으로 날아간다
    const p0 = camera.position.clone().addScaledVector(camUp, 18).addScaledVector(camRight, rand(-14, 14)).addScaledVector(camFwd, 12);
    const p2 = hit.point.clone();
    const dist = p0.distanceTo(p2);
    const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, dist * 0.22, 0));
    const mesh = model.clone();
    mesh.position.copy(p0);
    scene.add(mesh);
    missiles.push({ mesh, p0, p1, p2, t: 0, T: THREE.MathUtils.clamp(dist / SPEED, 0.4, 2) / speed, trail: 0 });
    spawn(smoke, p0, vel.set(0, 0, 0), 0.9, 1.5, 4, '#e7e4de', '#c9c5bd', {});
    if (volume > 0) launchSound();
  }
  const bezier = (o, a, b, c, t) => o.copy(a).multiplyScalar((1 - t) ** 2).addScaledVector(b, 2 * (1 - t) * t).addScaledVector(c, t * t);
  const next = new THREE.Vector3();
  function updateMissiles(dt) {
    for (let n = missiles.length - 1; n >= 0; n--) {
      const ms = missiles[n];
      ms.t += dt / ms.T;
      if (ms.t >= 1) { // 착탄
        scene.remove(ms.mesh);
        missiles.splice(n, 1);
        explode(ms.p2);
        continue;
      }
      // ponytail: 경로 중간에 다른 건물이 있어도 뚫고 지나간다. 막히게 하려면 매 프레임 이동 구간을 레이 검사.
      bezier(ms.mesh.position, ms.p0, ms.p1, ms.p2, ms.t);
      bezier(next, ms.p0, ms.p1, ms.p2, Math.min(1, ms.t + 0.01));
      ms.mesh.lookAt(next);
      for (ms.trail += dt; ms.trail > 0.012; ms.trail -= 0.012) { // 연기 꼬리
        tmp.set(0, 0, -4.5).applyQuaternion(ms.mesh.quaternion).add(ms.mesh.position);
        spawn(smoke, tmp, vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)), rand(0.8, 1.4), 0.8, rand(2.5, 4), '#f1efea', '#bdb8af', { drag: 1 });
      }
    }
  }

  function update(dt) {
    updateMissiles(dt);
    for (const p of physics.drainPoofs()) { // 가루가 된 잔해 자리에 작은 먼지
      const dust = new THREE.Color(p.color).lerp(new THREE.Color('#b8b1a5'), 0.55);
      for (let k = 0; k < 3; k++) {
        vel.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4));
        spawn(smoke, tmp.set(p.x, p.y, p.z), vel, rand(1.2, 2), p.size * 0.3, p.size * rand(0.5, 0.8), dust, '#d8d3ca', { drag: 1.5 });
      }
    }
    updatePool(smoke, dt);
    updatePool(fireballs, dt);
    updatePool(chips, dt);
    flashT += dt;
    flash.intensity = flashT < 0.25 ? flashPeak * (1 - flashT / 0.25) : 0;
    shake *= Math.exp(-dt * 5);
    return shakeOffset.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake < 0.01 ? 0 : shake);
  }

  function reset() {
    for (const ms of missiles) scene.remove(ms.mesh);
    missiles.length = 0;
    for (const set of [smoke, fireballs, chips]) {
      set.items.length = 0;
      set.mesh.count = 0;
    }
    shake = 0;
  }

  function setVolume(v) {
    volume = v;
    if (master) master.gain.value = volume;
  }

  const setSpeed = (v) => (speed = v);

  return { aim, fire, update, reset, setVolume, setRadius, setSpeed };
}
