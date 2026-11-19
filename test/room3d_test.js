#!/usr/bin/env node
/* ------------------------------------------------------------------
 *  room3d_test.js — 공간이 실제로 쓸 만한가.
 *
 *  roomdef.js 는 three.js 를 쓰지 않는 순수 데이터 + 계산이라 Node 에서
 *  그대로 돌려 볼 수 있다. 눈으로 보고 '괜찮네' 하고 넘기면 1열이 너무
 *  가까운 것 같은 일을 놓친다 — 숫자로 잡는다.
 * ------------------------------------------------------------------ */
'use strict';

const R = require('../public/roomdef.js');

/* 자주 쓰는 것 — 노래방 자리 치수와 소파 네 토막 */
const K = R.KARA;
const sofas = R.furniture.filter((f) => f.type === 'sofa');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' → ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

/* ---- 화면이 눈에 들어오나 ---------------------------------------- */
/* game.js 의 카메라와 같은 값이어야 한다 (FOV_BASE).
 * 60 으로 적어 두었다가 실제 52 와 어긋나, 가로 점유율을 6%p 낮게 보고 있었다.
 * 1인칭 휠 확대는 이 값을 FOV_MIN(21°)까지 좁힌다 — 아래 숫자는 당기지 않은 기준. */
const FOV = 52, ASPECT = 16 / 9;
const FOV_MIN = 21;                      // 끝까지 당겼을 때
const halfV = Math.tan(FOV / 2 * Math.PI / 180);
const halfH = halfV * ASPECT;
const needDist = Math.max(R.TV.w / 2 / halfH, R.TV.h / 2 / halfV);

console.log('\n── 시야 ──');
R.setMode('cinema');
const rowDist = [];
for (let r = 0; r < R.CINEMA.rows; r++) {
  const z = R.CINEMA.z0 + r * R.CINEMA.rowGap;
  rowDist.push(z - (-R.D / 2));
}
ok('1열에서 화면이 다 들어온다',
  rowDist[0] >= needDist,
  rowDist[0].toFixed(2) + 'm (필요 ' + needDist.toFixed(2) + 'm)');

/* '들어오기는 한다' 와 '편하게 보인다' 는 다르다.
 * 답답함을 가르는 건 가로 폭보다 '얼마나 올려다보느냐' 다 —
 * 스크린 윗변이 20° 를 넘어가면 목을 젖혀야 한다. */
const EYE = 1.56;                                   // 선 눈높이
const tvTop = R.TV.y + R.TV.h / 2;
const lookUp = (d) => Math.atan((tvTop - EYE) / d) * 180 / Math.PI;
const lookMid = (d) => Math.atan((R.TV.y - EYE) / d) * 180 / Math.PI;
const fillAt = (d) => Math.tan(Math.atan(R.TV.w / 2 / d)) / halfH;

/* 극장이 보는 건 화면 '한가운데' 를 올려다보는 각이다 — 12~15°.
 * 윗변은 화면이 클수록 가팔라지게 마련이라 따로, 느슨하게 본다. */
ok('1열에서 화면 한가운데를 올려다보는 각이 편하다 (15° 이하)',
  lookMid(rowDist[0]) <= 15, lookMid(rowDist[0]).toFixed(0) + '°');
ok('화면 윗변까지도 목을 젖힐 정도는 아니다 (30° 이하)',
  lookUp(rowDist[0]) <= 30, lookUp(rowDist[0]).toFixed(0) + '°');
ok('1열에서 화면이 시야를 다 먹지 않는다 (60% 이하)',
  fillAt(rowDist[0]) <= 0.60, (fillAt(rowDist[0]) * 100).toFixed(0) + '%');
ok('맨 뒷줄에서도 화면이 보일 만큼은 된다 (가로 18% 이상)',
  fillAt(rowDist[rowDist.length - 1]) >= 0.18,
  (fillAt(rowDist[rowDist.length - 1]) * 100).toFixed(0) + '%');

/* 1인칭에서 휠로 끝까지 당기면 맨 뒷줄에서도 화면이 꽉 차야 쓸모가 있다. */
const zoomHalfH = Math.tan(FOV_MIN / 2 * Math.PI / 180) * ASPECT;
const zoomFill = Math.tan(Math.atan(R.TV.w / 2 / rowDist[rowDist.length - 1])) / zoomHalfH;
ok('맨 뒷줄에서 끝까지 당기면 화면이 꽉 찬다 (가로 70% 이상)',
  zoomFill >= 0.70, (zoomFill * 100).toFixed(0) + '%  (배율 ×' +
  (Math.tan(FOV / 2 * Math.PI / 180) / Math.tan(FOV_MIN / 2 * Math.PI / 180)).toFixed(1) + ')');

// 1열을 22m 로 물린 만큼 맨 뒷줄은 30m 가 된다. 극장 맨 뒷자리 정도다.
const backAngle = 2 * Math.atan(R.TV.w / 2 / rowDist[rowDist.length - 1]) * 180 / Math.PI;
ok('맨 뒷줄도 화면이 너무 작지 않다 (20° 이상)',
  backAngle >= 20, backAngle.toFixed(0) + '°');

ok('뒷줄로 갈수록 멀어진다',
  rowDist.every((d, i) => i === 0 || d > rowDist[i - 1]),
  rowDist.map((d) => d.toFixed(1)).join(' · '));

/* ---- 단차 ---------------------------------------------------------- */
console.log('\n── 단차 ──');
ok('단이 눈에 보일 만큼 높다 (25cm 이상)',
  R.CINEMA.rise >= 0.25, (R.CINEMA.rise * 100).toFixed(0) + 'cm');

ok('앞사람 머리를 넘겨다본다 (단 > 앉은키 차의 절반)',
  R.CINEMA.rise >= 0.25, (R.CINEMA.rise * 100).toFixed(0) + 'cm');

// 통로를 따라 입구에서 1열까지 걸어 내려갈 수 있나 — 한 걸음에 STEP 이상 떨어지면 막힌다
function walkAisle() {
  const jumps = [];
  let prev = R.groundAt(0, R.spawn.z);
  for (let z = R.spawn.z; z > R.CINEMA.z0 - 2.0; z -= 0.05) {
    const g = R.groundAt(0, z);
    const d = Math.abs(g - prev);
    if (d > 0.0001) jumps.push({ z: z, from: prev, to: g, d: d });
    prev = g;
  }
  return jumps;
}
const jumps = walkAisle();
const tooBig = jumps.filter((j) => j.d > R.STEP + 0.0005);
ok('가운데 통로로 입구에서 1열까지 걸어 내려간다',
  tooBig.length === 0,
  tooBig.length ? tooBig.map((j) => 'z=' + j.z.toFixed(2) + ' 에서 ' + (j.d * 100).toFixed(0) + 'cm') .join(', ')
    : jumps.length + '칸 모두 ' + (R.STEP * 100) + 'cm 이하');

ok('입구는 맨 윗단 위에 있다',
  Math.abs(R.groundAt(R.spawn.x, R.spawn.z) - R.CINEMA.topY) < 0.001,
  R.groundAt(R.spawn.x, R.spawn.z).toFixed(2) + 'm');

// 옆으로 돌아 올라가지 못해야 한다 (단이 걸을 수 있는 폭을 다 덮는지).
// 줄 자리를 박아 두면 배치를 옮길 때마다 엉뚱하게 깨진다 — 끌어다 쓴다.
const backRowZ = R.CINEMA.z0 + (R.CINEMA.rows - 1) * R.CINEMA.rowGap;
let sideBypass = 0;
for (let x = R.BOUND.x0; x <= R.BOUND.x1; x += 0.2) {
  if (Math.abs(x) < R.CINEMA.aisle) continue;       // 통로는 계단이 있으니 제외
  if (R.groundAt(x, backRowZ) < R.CINEMA.topY - 0.001) sideBypass++;
}
ok('옆구리로 단을 피해 올라갈 틈이 없다', sideBypass === 0,
  'z=' + backRowZ + ' 에서 ' + (sideBypass ? sideBypass + '곳 뚫림' : '전부 단 위'));

/* ---- 자리 ---------------------------------------------------------- */
console.log('\n── 자리 ──');
const cine = R.seats.filter((s) => s.mode === 'cinema');
const kara = R.seats.filter((s) => s.mode === 'karaoke');
ok('영화관 자리 = 줄 × 좌우 × 한쪽당',
  cine.length === R.CINEMA.rows * 2 * R.CINEMA.perSide, cine.length + '석');
ok('노래방 자리가 방 정원(20명)을 받아낸다', kara.length >= 16, kara.length + '석');
ok('자리 번호가 통틀어 하나씩', R.seats.every((s, i) => s.i === i));

// 감지 구역에 들어서면 그 자리가 잡히나
function zoneHits(list) {
  let miss = [];
  for (const st of list) {
    const got = R.seatAt(st.zx, st.zz, st.y);
    if (got !== st.i) miss.push(st.id + '(' + got + '≠' + st.i + ')');
  }
  return miss;
}
R.setMode('cinema');
let miss = zoneHits(cine);
ok('영화관 — 구역에 들어서면 그 자리가 잡힌다', miss.length === 0, miss.slice(0, 4).join(' '));

R.setMode('karaoke');
miss = zoneHits(kara);
ok('노래방 — 돌아간 소파에서도 자리가 잡힌다', miss.length === 0, miss.slice(0, 4).join(' '));

// 모드가 다른 자리는 안 잡혀야 한다
R.setMode('cinema');
ok('영화관에서는 소파 자리가 안 잡힌다',
  kara.every((st) => R.seatAt(st.zx, st.zz, st.y) !== st.i));
ok('영화관에서 소파 자리는 쓸 수 없다고 답한다',
  kara.every((st) => !R.seatUsable(st.i)) && cine.every((st) => R.seatUsable(st.i)));

R.setMode('karaoke');
ok('노래방에서는 영화관 자리가 안 잡힌다',
  cine.every((st) => R.seatAt(st.zx, st.zz, st.y) !== st.i));

/* ---- 모드별 바닥 --------------------------------------------------- */
console.log('\n── 모드별 바닥 ──');
R.setMode('karaoke');
let bumpy = 0;
for (let z = -8; z <= 11; z += 0.25) {
  for (let x = -9; x <= 9; x += 0.5) {
    const g = R.groundAt(x, z);
    // 소파(0.44)·테이블(0.45) 위는 빼고, 나머지는 평평해야 한다
    if (g > 0.001 && g < 0.4) bumpy++;
  }
}
ok('노래방에서는 단이 사라져 바닥이 평평하다', bumpy === 0, bumpy ? bumpy + '곳이 울퉁불퉁' : '평평');

ok('노래방 입구도 평지', Math.abs(R.groundAt(R.spawn.x, R.spawn.z)) < 0.001);

/* 소파와 영화관 단은 같은 자리를 나눠 쓴다. 그래서 '그 점의 바닥 높이'
 * 로는 어느 쪽이 빠졌는지 가릴 수 없다 — 걸어 보고 가린다.
 *
 * 영화관이 소파를 무시한다는 건 이미 위의 '통로로 1열까지' 가 증명한다.
 * 그 길이 소파 한복판을 지나기 때문이다. 여기서는 나머지 둘을 본다. */

/* 한 점을 향해 곧장 걸어가 어디서 멈추는지 */
function walkInto(mode, x0, z0, x1, z1) {
  R.setMode(mode);
  let x = x0, z = z0;
  for (let i = 0; i < 600; i++) {
    const dx = x1 - x, dz = z1 - z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) break;
    const step = Math.min(0.06, len);
    const p = R.collide(x + dx / len * step, z + dz / len * step, 0.32, R.groundAt(x, z));
    if (Math.hypot(p.x - x, p.z - z) < 0.002) break;
    x = p.x; z = p.z;
  }
  return Math.hypot(x - x1, z - z1);      // 목표까지 남은 거리
}

// 소파는 바깥에서 걸어 들어가면 막아서야 한다 (한복판까지 못 간다)
const sofaStops = sofas.map((f) => {
  const fx = -Math.sin(f.rot), fz = -Math.cos(f.rot);     // 소파가 보는 쪽
  return walkInto('karaoke', f.x + fx * 3.0, f.z + fz * 3.0, f.x, f.z);
});
ok('노래방 — 소파가 사람을 막아선다',
  sofaStops.every((d) => d > 0.4), sofaStops.map((d) => d.toFixed(2)).join(' · '));
ok('노래방 — 원형 테이블도 막아선다',
  walkInto('karaoke', K.cx, K.cz + K.table.r + 3.0, K.cx, K.cz) > 0.4);

/* 영화관 의자가 노래방에서 사라졌는지.
 * '어느 줄' 을 콕 집으면 소파와 겹치는 날 테스트가 엉뚱하게 깨진다 —
 * 소파가 닿지 않는 의자를 코드로 골라내서 본다. */
function standable(mode, x, z) {
  R.setMode(mode);
  const p = R.collide(x, z, 0.3, 0);
  return Math.hypot(p.x - x, p.z - z) < 0.01;
}
const chairs = R.furniture.filter((f) => f.type === 'chair');
const clear = chairs.filter((f) => standable('karaoke', f.x, f.z));
ok('노래방 — 의자 자리 대부분이 빈 바닥이 된다',
  clear.length >= chairs.length * 0.5,
  clear.length + '/' + chairs.length + '석 (나머지는 소파가 들어선 자리)');
ok('영화관 — 그 자리들은 전부 의자가 막아선다',
  clear.every((f) => !standable('cinema', f.x, f.z)));

/* ---- ㄴ ◯ ㄱ 모양 --------------------------------------------------- */
console.log('\n── ㄴ ◯ ㄱ ──');
ok('소파 네 토막 (ㄴ 둘 + ㄱ 둘)', sofas.length === 4);

// 네 소파가 모두 테이블(KARA 중심)을 바라보는가.
// rot=θ 일 때 바라보는 쪽은 월드 (-sinθ, -cosθ).
const facing = sofas.map((f) => {
  const fx = -Math.sin(f.rot), fz = -Math.cos(f.rot);
  const tx = K.cx - f.x, tz = K.cz - f.z;
  const len = Math.hypot(tx, tz) || 1;
  return (fx * tx + fz * tz) / len;              // 1 이면 정면으로 바라봄
});
// ㄴ·ㄱ 의 짧은 변은 테이블에서 옆으로 비껴 있으니 정면까지는 아니다.
// 안쪽(테이블 쪽)을 보고 있으면 된다 — 등을 돌린 소파가 없어야 한다는 뜻이다.
ok('네 소파가 모두 안쪽 테이블 쪽을 본다',
  facing.every((d) => d > 0.75), facing.map((d) => d.toFixed(2)).join(' · '));

const table = R.furniture.find((f) => f.type === 'rtable');
ok('원형 테이블이 소파 한가운데 있다',
  !!table && Math.abs(table.x - K.cx) < 0.01 && Math.abs(table.z - K.cz) < 0.01);

// 소파에 앉은 사람이 테이블에 걸리지 않나 (자리와 테이블 가장자리 사이 간격)
const gap = Math.min.apply(null, kara.map((s) => Math.hypot(s.x - K.cx, s.z - K.cz))) - K.table.r;
ok('앉은 자리와 테이블 사이가 벌어져 있다', gap > 0.8, gap.toFixed(2) + 'm');

// 소파에서도 화면이 보이나 (스크린을 등지고 앉는 자리가 없어야 한다)
R.setMode('karaoke');
const screenZ = -R.D / 2;
const backToScreen = kara.filter((s) => {
  const fx = -Math.sin(s.rot), fz = -Math.cos(s.rot);
  const tz = screenZ - s.z, tx = 0 - s.x;
  const len = Math.hypot(tx, tz) || 1;
  return (fx * tx + fz * tz) / len < -0.75;      // 거의 정반대를 보고 있다
});
ok('화면을 완전히 등지고 앉는 자리는 없다',
  backToScreen.length <= kara.length / 3,
  backToScreen.length + '/' + kara.length + '석');

/* ---- 걸어 다닐 수 있나 --------------------------------------------- */
console.log('\n── 통행 ──');
/* 사람은 막히면 비켜 간다. 곧장만 밀면 모서리마다 멈춰서, 멀쩡히
 * 걸어 다닐 수 있는 길도 '막혔다' 고 나온다 — 옆으로 틀어 가며 본다. */
function canWalk(mode, x0, z0, x1, z1) {
  R.setMode(mode);
  const TRY = [0, 0.4, -0.4, 0.9, -0.9, 1.4, -1.4];     // 틀어 볼 각도(라디안)
  let x = x0, z = z0;
  for (let i = 0; i < 6000; i++) {
    const dx = x1 - x, dz = z1 - z;
    const len = Math.hypot(dx, dz);
    if (len < 0.35) return true;
    const y = R.groundAt(x, z);
    const a0 = Math.atan2(dx, dz);
    let best = null, bestGain = 0.002;
    for (let k = 0; k < TRY.length; k++) {
      const a = a0 + TRY[k];
      const p = R.collide(x + Math.sin(a) * 0.1, z + Math.cos(a) * 0.1, 0.32, y);
      const gain = len - Math.hypot(x1 - p.x, z1 - p.z);   // 목표에 얼마나 가까워졌나
      if (gain > bestGain) { bestGain = gain; best = p; }
    }
    if (!best) return false;                              // 어느 쪽으로도 못 간다
    x = best.x; z = best.z;
  }
  return false;
}
ok('영화관 — 입구에서 통로를 따라 1열 앞까지',
  canWalk('cinema', 0, R.spawn.z, 0, R.CINEMA.z0 - 1.6));
// 내려오는 길만 보면 반쪽이다. 올라가는 길에서 계단이 벽이 되는 일이 있다
ok('영화관 — 1열 앞에서 통로를 따라 입구까지 되올라온다',
  canWalk('cinema', 0, R.CINEMA.z0 - 1.6, 0, R.spawn.z));
ok('노래방 — 입구에서 테이블 옆까지',
  canWalk('karaoke', 0, R.spawn.z, K.cx + K.table.r + 1.2, K.cz));
// 노래방에서는 소파 한 벌이 가운데를 막고 있다 — 탐색이 아니라 '길이
// 있느냐' 를 보는 것이므로, 사람이 실제로 도는 바깥 길로 잰다.
ok('노래방 — 소파를 돌아 단상 위까지 올라간다',
  canWalkPath('karaoke', [[0, R.spawn.z], [-(K.armX + K.deep / 2 + 2.0), R.spawn.z],
                          [-(K.armX + K.deep / 2 + 2.0), -4.0], [0, -8.0], [0, R.STAGE.z]]));
ok('영화관 — 단상 위까지 올라간다',
  canWalk('cinema', 0, R.spawn.z, 0, R.STAGE.z));
/* 직선으로만 밀고 가면 모서리에서 멈춘다 — 사람이 실제로 걷는 길(모서리를
 * 돌아가는 꺾인 길)로 잰다. 길목이 좁으면 여기서 걸린다. */
function canWalkPath(mode, pts) {
  for (let i = 1; i < pts.length; i++) {
    if (!canWalk(mode, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])) return false;
  }
  return true;
}
// 소파 바깥 — 소파가 차지한 폭에서 2m 더 바깥으로 돈다
const outX = K.armX + K.deep / 2 + 2.0;
const frontZ = K.cz - K.armZ - K.deep / 2 - 4.0;      // 소파 앞 빈 바닥
ok('노래방 — 소파 왼쪽 바깥을 돌아 스크린 앞까지',
  canWalkPath('karaoke', [[0, R.spawn.z], [-outX, R.spawn.z], [-outX, frontZ], [0, frontZ]]));
ok('노래방 — 소파 오른쪽 바깥으로도 돌아간다',
  canWalkPath('karaoke', [[0, R.spawn.z], [outX, R.spawn.z], [outX, frontZ], [0, frontZ]]));
ok('노래방 — 소파 사이 틈으로 테이블까지 들어간다',
  canWalk('karaoke', 0, R.spawn.z, K.cx, K.cz + K.table.r + 0.8));

console.log('\n  ' + (fail ? fail + '건 실패 / ' : '') + pass + '건 통과');
process.exit(fail ? 1 : 0);
