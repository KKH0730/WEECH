#!/usr/bin/env node
/* ------------------------------------------------------------------
 *  client_test.mjs — 브라우저 모듈이 '뜨기는 하는지' 본다.
 *
 *  여기서 막히면 화면에 아무것도 안 나온다. 버튼이 안 눌리는 게 아니라
 *  스크립트가 통째로 죽어서 누를 것이 없는 상태가 된다 — 겉보기엔
 *  '방 만들기가 안 됨' 으로 보이고, 원인은 한참 떨어진 곳에 있다.
 *
 *  실제로 이 테스트를 만들게 된 계기가 그랬다. scene3d 안에 이미 쓰고 있던
 *  이름(C)과 새로 들여온 색판 이름이 겹쳐, 선언 전에 쓴 꼴이 되어 모듈이
 *  통째로 죽었다. 구문 검사(node --check)로는 절대 안 잡힌다.
 *
 *  브라우저 흉내는 얇게만 낸다 — 캔버스에 무엇이 그려지는지는 보지 않고,
 *  '끝까지 터지지 않고 지어지는가' 만 본다.
 * ------------------------------------------------------------------ */
import { register } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');

// 'three' 를 동봉 파일로 — 브라우저의 importmap 과 같은 일
register('./_three_hook.mjs', import.meta.url);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' → ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
async function step(name, fn) {
  try { const r = await fn(); ok(name, true, r); return true; }
  catch (e) {
    ok(name, false);
    console.log('     ' + e.message);
    console.log((e.stack || '').split('\n').slice(1, 4).map((l) => '     ' + l.trim()).join('\n'));
    return false;
  }
}

/* ---- 아주 얇은 브라우저 흉내 ---------------------------------------
 *  2D 컨텍스트는 무엇을 호출하든 받아 주는 허수아비다. 다만 '어느
 *  높이에 그렸는지' 만 적어 둔다 — 옷 무늬가 가려지는 자리에 그려지는
 *  사고가 한 번 있었기 때문이다(아래 '보이는 자리에 그렸나' 참조). */
const noop = () => {};
const drawLog = [];                      // 그린 세로 범위 (0~1, 캔버스 기준)
let logOn = false;
const C256 = 256;                        // 옷 천의 크기
const note = (y0, y1) => { if (logOn) drawLog.push([y0 / C256, (y1 === undefined ? y0 : y1) / C256]); };
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return { width: C256, height: C256 };
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (k === 'fillRect') return (x, y, w, h) => note(y, y + h);
    if (k === 'arc') return (x, y, r) => note(y - r, y + r);
    if (k === 'ellipse') return (x, y, rx, ry) => note(y - ry, y + ry);
    if (k === 'moveTo' || k === 'lineTo') return (x, y) => note(y);
    return typeof k === 'string' ? noop : undefined;
  },
  set() { return true; }
});
const fakeCanvas = () => ({ width: C256, height: C256, getContext: () => ctx2d, style: {}, toDataURL: () => '' });
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? fakeCanvas() : {
    style: {}, dataset: {}, appendChild: noop, setAttribute: noop,
    classList: { add: noop, toggle: noop, remove: noop, contains: () => false }
  }),
  createElementNS: () => ({ style: {} }),
  body: { appendChild: noop },
  getElementById: () => null,
  addEventListener: noop
};
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  addEventListener: noop, matchMedia: () => ({ matches: false })
};
globalThis.self = globalThis.window;

/* roomdef.js 는 모듈이 아니라 그냥 스크립트다 — 브라우저도 <script> 로 싣고
 * 전역 ROOM3D 를 남긴다. import 로 읽으면 내보내기가 없어 비어 버린다. */
vm.runInThisContext(
  fs.readFileSync(path.join(PUBLIC, 'roomdef.js'), 'utf8') + '\n;globalThis.ROOM3D = ROOM3D;'
);

const mod = (f) => import(pathToFileURL(path.join(PUBLIC, f)).href);

console.log('\n── 모듈이 뜨는가 ──');
ok('roomdef 가 전역에 올라온다', globalThis.ROOM3D && globalThis.ROOM3D.W > 0,
  globalThis.ROOM3D ? globalThis.ROOM3D.W + ' x ' + globalThis.ROOM3D.D : '없음');

let toon, scene3d, avatar3d;
if (!await step('toon.js', async () => {
  toon = await mod('toon.js');
  return Object.keys(toon).sort().join(' ');
})) process.exit(1);

ok('칠하는 법이 다 나와 있다',
  ['mat', 'box', 'C', 'RAMP_SOFT', 'outlineOf'].every((k) => k in toon));

if (!await step('scene3d.js 읽기', async () => { scene3d = await mod('scene3d.js'); })) process.exit(1);
if (!await step('avatar3d.js 읽기', async () => { avatar3d = await mod('avatar3d.js'); })) process.exit(1);
await step('pitch.js 읽기', async () => { await mod('pitch.js'); });
await step('voice.js 읽기', async () => { await mod('voice.js'); });
await step('youtube.js 읽기', async () => { await mod('youtube.js'); });
let npc = null;
await step('npc.js 읽기', async () => { npc = await mod('npc.js'); });

console.log('\n── 방이 지어지는가 ──');
let world = null;
if (!await step('buildScene()', () => {
  world = scene3d.buildScene();
  return world.scene.children.length + '덩이';
})) process.exit(1);

ok('화살이 꽂힐 것들이 모였다', world.collidables.length > 10, world.collidables.length + '개');
ok('스크린 자리가 잡혔다', !!world.tvTransform);
ok('조명이 달렸다', world.lampLights.length > 0, world.lampLights.length + '개');

await step('두 모드를 오가도 안 터진다', () => {
  world.setMode('karaoke');
  world.update(1.0, true);
  world.setMode('cinema');
  world.update(2.0, false);
  return world.getMode();
});

console.log('\n── 산타와 루돌프 ──');
if (npc) {
  ok('둘 다 있다', npc.NPCS.length === 2, npc.NPCS.map((n) => n.name).join(' · '));

  /* 자리가 '시각의 함수' 여야 한다 — 같은 시각을 넣으면 누구 화면에서든
   * 같은 자리가 나와야 한다. 여기가 깨지면 사람마다 산타가 다른 데 선다. */
  let same = true;
  for (const t of [0, 7.3, 61.2, 1234.5, 98765.4]) {
    for (const n of npc.NPCS) {
      const a = npc.poseAt(n, t), b = npc.poseAt(n, t);
      if (a.x !== b.x || a.z !== b.z || a.yaw !== b.yaw) same = false;
    }
  }
  ok('같은 시각이면 늘 같은 자리', same);

  /* 마당 밖으로 나가거나 트리 속으로 걸어 들어가면 안 된다 */
  const T = globalThis.ROOM3D.XMAS.tree;
  let out = 0, intoTree = 0, moved = 0, prev = null;
  for (let t = 0; t < 2000; t += 0.37) {
    for (const n of npc.NPCS) {
      const p = npc.poseAt(n, t);
      if (p.x < npc.YARD.x0 - 0.01 || p.x > npc.YARD.x1 + 0.01 ||
          p.z < npc.YARD.z0 - 0.01 || p.z > npc.YARD.z1 + 0.01) out++;
      if (Math.hypot(p.x - T.x, p.z - T.z) < T.r) intoTree++;
    }
    const p0 = npc.poseAt(npc.NPCS[0], t);
    if (prev && Math.hypot(p0.x - prev.x, p0.z - prev.z) > 0.001) moved++;
    prev = p0;
  }
  ok('마당 밖으로 안 나간다', out === 0, out ? out + '번 벗어남' : '늘 안쪽');
  ok('트리를 뚫고 가지 않는다', intoTree === 0, intoTree ? intoTree + '번 겹침' : '비켜 간다');
  ok('가만히 있지 않고 돌아다닌다', moved > 2000, moved + '번 움직임');

  /* 한 걸음에 순간이동하면 안 된다 — 끊기지 않고 이어져야 한다 */
  let jump = 0;
  for (let t = 0; t < 600; t += 0.05) {
    const a = npc.poseAt(npc.NPCS[0], t), b = npc.poseAt(npc.NPCS[0], t + 0.05);
    if (Math.hypot(b.x - a.x, b.z - a.z) > 0.3) jump++;
  }
  ok('걸음이 이어진다 (순간이동 없음)', jump === 0, jump ? jump + '번 튐' : '매끄러움');

  /* 문답은 갈래로 나뉜다 — kids 가 있으면 갈래, a 가 있으면 답.
   * 둘 다 없는 항목이 하나라도 있으면 눌렀을 때 아무 일도 안 일어난다. */
  const walk = (list, depth, out) => {
    for (const t of list) {
      out.all++;
      if (!t.q || typeof t.q !== 'string') out.noLabel++;
      if (t.kids) { out.branch++; walk(t.kids, depth + 1, out); }
      else if (Array.isArray(t.a) && t.a.length &&
        t.a.every((l) => typeof l === 'string' && l.length)) {
        out.leaf++;
        for (const l of t.a) out.lines.push(l);
      } else out.dead++;
      if (depth > out.deep) out.deep = depth;
    }
    return out;
  };
  const fresh = () => ({ all: 0, branch: 0, leaf: 0, dead: 0, noLabel: 0, deep: 0, lines: [] });

  const trees = npc.NPCS.map((n) => ({ n: n, list: npc.topicsOf(n) }));
  for (const t of trees) t.tree = walk(t.list, 0, fresh());

  ok('첫 목록이 말풍선에 들어갈 만큼 짧다',
    trees.every((t) => t.list.length <= 6),
    trees.map((t) => t.n.name + ' ' + t.list.length + '줄').join(' · '));
  ok('갈래마다도 짧다',
    trees.every((t) => t.list.every((x) => !x.kids || x.kids.length <= 6)));
  ok('둘 다 물어볼 것이 넉넉하다',
    trees.every((t) => t.tree.leaf >= 8),
    trees.map((t) => t.n.name + ' ' + t.tree.leaf + '가지').join(' · '));
  ok('고르면 아무 일도 안 하는 항목이 없다',
    trees.every((t) => t.tree.dead === 0 && t.tree.noLabel === 0));
  ok('너무 깊이 파고들지 않는다 (두 겹까지)',
    trees.every((t) => t.tree.deep <= 1));
  ok('둘 다 대화를 끝낼 길이 있다',
    trees.every((t) => t.list.some((x) => x.bye)));

  /* 둘이 같은 말을 하면 둘일 이유가 없다. 같은 글을 양쪽에 복사해 두면
   * 한쪽만 고쳤을 때 둘이 서로 다른 말을 하게 되는 것도 문제고. */
  const santa = new Set(trees[0].tree.lines);
  const dup = trees[1].tree.lines.filter((l) => santa.has(l));
  ok('산타와 루돌프가 같은 문장을 말하지 않는다', dup.length === 0,
    dup.length ? dup.length + '줄 겹침: ' + dup[0].slice(0, 24) : '겹치는 줄 없음');

  const topQ = (t) => t.list.map((x) => x.q).join('|');
  ok('첫 목록도 서로 다르다', topQ(trees[0]) !== topQ(trees[1]));
  ok('걸음새가 서로 다르다',
    trees[0].n.speed !== trees[1].n.speed,
    trees.map((t) => t.n.name + ' ' + t.n.speed + 'm/s').join(' · '));
  ok('인사말이 여러 개라 녹음기 같지 않다',
    npc.NPCS.every((n) => n.hellos.length >= 2 && typeof npc.helloOf(n) === 'string'));
}

console.log('\n── 옷장 (아바타 꾸미기) ──');
{
  const W = avatar3d.WARDROBE;
  ok('옷장이 열려 있다', !!W && Array.isArray(W.tops),
    W ? '상의 ' + W.tops.length + ' · 하의 ' + W.bottoms.length + ' · 피부 ' + W.skins.length : '없음');

  /* 밖에서 온 값은 뭐가 와도 줄 세워져야 한다 — 서버가 범위를 느슨하게
   * 중계하므로 어긋난 번호를 접는 건 전적으로 이쪽 몫이다. */
  const dirty = avatar3d.sanitizeLook([99, -3, 'x', null, 2.7, 1e9, NaN]);
  ok('어긋난 번호를 접는다', Array.isArray(dirty) &&
    dirty.every((n, i) => Number.isInteger(n) && n >= 0), JSON.stringify(dirty));
  ok('배열이 아니면 null', avatar3d.sanitizeLook('abc') === null && avatar3d.sanitizeLook(null) === null);
  ok('기본 모습은 이름에서 늘 같게',
    JSON.stringify(avatar3d.lookOf('가나다')) === JSON.stringify(avatar3d.lookOf('가나다')));

  /* 고른 대로 입는가 — 상의 색과 머리 모양이 실제로 갈리는지 */
  const colorsOf = (av) => {
    const set = new Set();
    av.root.traverse((o) => { if (o.isMesh && o.material && o.material.color) set.add(o.material.color.getHex()); });
    return set;
  };
  /* 색은 옷이 정한다 — 옛 색 칸(3·4번)을 바꿔도 아무 일 없어야 하고,
   * 옷(7번)을 바꾸면 그 옷의 색이 입혀져야 한다 */
  const a1 = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0, 0, 0, 0, 0, 0, 0, 0, 2] });
  const a2 = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0, 0, 0, 5, 7, 0, 0, 0, 2] });
  const a3 = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0, 0, 0, 0, 0, 0, 0, 5, 2] });
  ok('옛 색 칸은 읽히지 않는다',
    colorsOf(a1).has(W.tops[0]) && colorsOf(a2).has(W.tops[0]));
  ok('옷을 바꾸면 그 옷의 색이 입혀진다',
    colorsOf(a3).has(W.tops[5]) && !colorsOf(a3).has(W.tops[0]));
  ok('청자켓의 색은 청색이다', ((W.tops[3] >> 16 & 255) < (W.tops[3] & 255)),
    '0x' + W.tops[3].toString(16));

  const count = (av) => { let n = 0; av.root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const long1 = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0, 0, 0, 0, 0, 0, 0] });
  const bob = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0, 1, 0, 0, 0, 0, 0] });
  const bun = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0, 2, 0, 0, 0, 0, 0] });
  ok('머리 모양마다 생김이 다르다 (긴머리=갈래, 올림=묶음)',
    count(long1) === count(bob) + 2 && count(bun) === count(bob) + 1,
    '긴 ' + count(long1) + ' · 단발 ' + count(bob) + ' · 올림 ' + count(bun));
  /* 옷 모양 — 치마·바지·반바지가 기하부터 다른지. 치마만 돌림판이 있다 */
  const skirted = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0,0,0,0,0,0,0,0,0] });
  const pants = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0,0,0,0,0,0,0,0,2] });
  const hasLathe = (av) => { let n = false; av.root.traverse((o) => { if (o.isMesh && o.geometry.type === 'LatheGeometry') n = true; }); return n; };
  const plaid = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0,0,0,0,0,0,0,0,1] });
  ok('치마(민무늬·체크)에만 돌림판이 있다', hasLathe(skirted) && hasLathe(plaid) && !hasLathe(pants));
  /* 옷이 '색만 다른 같은 물건' 이 아니라 진짜 다른 물건인지.
   * 개수를 박아 두면 디테일 하나 늘릴 때마다 엉뚱하게 깨지므로,
   * 무엇이 어디에 붙었는지를 본다. */
  const parts = (av) => {
    const out = [];
    av.root.updateMatrixWorld(true);
    av.root.traverse((o) => {
      if (!o.isMesh || (o.userData && o.userData.isOutline)) return;
      const e = o.matrixWorld.elements;        // 12·13·14 가 자리다
      out.push({ kind: o.geometry.type, y: e[13], z: e[14] });
    });
    return out;
  };
  const tee = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0,0,0,0,0,0,0,0,2] });
  const hoodie = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0,0,0,0,0,0,0,2,2] });
  const jacket = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0,0,0,0,0,0,0,3,2] });
  const teeP = parts(tee), hoodP = parts(hoodie), jackP = parts(jacket);
  //  후드 — 목 뒤(z 음수)에 얹힌 구
  const hood = (ps) => ps.some((q) => q.kind.indexOf('Sphere') >= 0 && q.y > 0.95 && q.z < -0.08);
  ok('후드티엔 목 뒤에 모자가 얹힌다', hood(hoodP) && !hood(teeP));
  //  자켓 깃 — 끝이 뾰족한 판(ShapeGeometry) 두 장
  const leaves = (ps) => ps.filter((q) => q.kind.indexOf('Shape') >= 0).length;
  ok('청자켓엔 깃이 두 장 선다', leaves(jackP) === 2 && leaves(teeP) === 0);
  //  시보리 — 손목께의 원통
  const cuffs = (ps) => ps.filter((q) => q.kind.indexOf('Cylinder') >= 0 && q.y > 0.6 && q.y < 0.95).length;
  ok('맨투맨·후드티 소맷부리엔 시보리가 있다',
    cuffs(hoodP) === cuffs(teeP) + 2, '티 ' + cuffs(teeP) + ' · 후드 ' + cuffs(hoodP));
  const hasMap = (av) => { let n = false; av.root.traverse((o) => { if (o.isMesh && o.material && o.material.map && o.geometry.type.indexOf('Capsule') >= 0) n = true; }); return n; };
  ok('무늬 옷은 천(텍스처)을 입는다', !hasMap(tee) && hasMap(hoodie));
  [plaid, tee, hoodie, jacket].forEach((a) => a.dispose());
  ok('모양 칸까지 아홉 칸이다', avatar3d.sanitizeLook([]).length === 9);
  [a1, a2, a3, long1, bob, bun, skirted, pants].forEach((a) => a.dispose());
}

console.log('\n── 옷 무늬가 보이는 자리에 그려지는가 ──');
{
  /* three.js 캡슐의 v 는 '몇 번째 띠냐' 로 매겨진다. 둥근 뚜껑이 띠를
   * 거의 다 가져가는 탓에, 높이의 3분의 1인 가운데 원통이 v 의 3% 만
   * 받는다. 그대로 천을 감으면 가슴 그림이 세로로 짓눌려 줄무늬가 되고
   * 고르게 찍은 단추가 위쪽에서만 뭉친다. evenV() 가 v 를 높이에
   * 비례하게 다시 매겨 막는다 — 이게 풀리면 옷이 전부 뭉개진다. */
  const av = avatar3d.makeAvatar({ seed: 'x', name: 'x', look: [0, 0, 0, 0, 0, 0, 0, 3, 2] });
  let torso = null;
  av.root.traverse((o) => {
    if (!torso && o.isMesh && o.material && o.material.map && o.geometry.type.indexOf('Capsule') >= 0) torso = o;
  });
  ok('몸통에 천이 감겼다', !!torso);
  if (torso) {
    const pos = torso.geometry.attributes.position, uv = torso.geometry.attributes.uv;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    let worst = 0;
    for (let i = 0; i < pos.count; i++) {
      const want = (pos.getY(i) - lo) / (hi - lo);
      worst = Math.max(worst, Math.abs(uv.getY(i) - want));
    }
    ok('천이 높이에 비례해 감긴다 (안 그러면 가슴 그림이 짓눌린다)',
      worst < 0.01, '최대 어긋남 ' + (worst * 100).toFixed(2) + '%');
  }
  av.dispose();

  /* 몸통 천은 거의 다 가려진다 — 위는 깃과 턱이, 아래는 치마·바지
   * 허리가 덮어서 캔버스의 가운데 띠만 보인다. 한 번은 이걸 모르고
   * 요크·시보리·모자끈을 전부 안 보이는 자리에 그려 놓고 '왜 안
   * 보이나' 를 한참 헤맸다. 그린 자리의 과반이 띠 안에 들어야 한다. */
  const BAND = [0.2, 0.95];
  const GARMENTS = [[1, '맨투맨'], [2, '후드티'], [3, '청자켓'], [4, '블라우스']];
  for (const [st, name] of GARMENTS) {
    drawLog.length = 0;
    logOn = true;
    avatar3d.makeAvatar({ seed: 'x', name: '', look: [0, 0, 0, 0, 0, 0, 0, st, 2] }).dispose();
    logOn = false;
    const marks = drawLog.filter((d) => d[1] - d[0] < 0.6);   // 바탕 칠(전면)은 뺀다
    const inside = marks.filter((d) => d[1] > BAND[0] && d[0] < BAND[1]).length;
    ok(name + ' 무늬가 보이는 띠 안에 있다',
      marks.length >= 4 && inside / marks.length >= 0.75,
      marks.length + '군데 중 ' + inside + '군데');
  }
}

console.log('\n── 사람이 그려지는가 ──');
let who = null;
await step('makeAvatar()', () => {
  // 테두리는 치마 밑단에만 두르므로, 치마 차림으로 짓는다
  who = avatar3d.makeAvatar({ seed: 'abc', name: '가나다', look: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
  return who.root.children.length + '덩이';
});
ok('맞을 자리가 있다', !!who && who.hitMeshes.length > 0);
// 사람에게는 손그림 선이 둘린다 (방에는 두르지 않는다)
let lines = 0;
if (who) who.root.traverse((o) => { if (o.userData && o.userData.isOutline) lines++; });
ok('치마 밑단에 테두리가 둘렸다', lines > 0, lines + '줄');
/* 테두리는 '사람' 에게만 두른다. 배경에 두르면 지브리가 아니라 만화가 된다.
 * 산타와 루돌프도 사람 쪽이므로 둘러야 맞다 — 가구·벽에만 없으면 된다. */
const CHARACTERS = ['santa', 'deer'];
let onChar = 0, onRoom = 0;
world.scene.traverse((o) => {
  if (!(o.userData && o.userData.isOutline)) return;
  let p = o, kind = '';
  while (p) { if (p.name) { kind = p.name; break; } p = p.parent; }
  if (CHARACTERS.indexOf(kind) >= 0) onChar++; else onRoom++;
});
ok('산타·루돌프에는 테두리가 있다', onChar > 0, onChar + '줄');
ok('가구와 벽에는 테두리가 없다', onRoom === 0,
  onRoom ? onRoom + '줄이 배경에 붙었다' : '없음');
// update 는 자세 객체를 받는다. 숫자를 넘기면 조용히 NaN 이 번진다
await step('움직여도 안 터진다',
  () => { who.update({ x: 0, y: 0, z: 0, dir: 0, st: 1, fy: 0 }, 0.016, 1.0, false); });

/* 머리카락 흩날림 — 뿌리는 두피에 붙어 있고 끝만 흔들려야 한다.
 * 통째로 돌리면 머리카락이 두피에서 미끄러져 가발처럼 보인다. */
let hairMesh = null;
if (who) who.root.traverse((o) => { if (o.isMesh && o.geometry.attributes.sway) hairMesh = o; });
ok('머리카락에 흔들림 가중치가 있다', !!hairMesh,
  hairMesh ? hairMesh.geometry.attributes.sway.count + '꼭짓점' : '없음');
if (hairMesh) {
  const w = hairMesh.geometry.attributes.sway.array;
  const snap = () => Float32Array.from(hairMesh.geometry.attributes.position.array);
  for (let i = 0; i < 60; i++) who.update({ x: 0, y: 0, z: 0, dir: 0, st: 0, fy: 0 }, 0.016, i * 0.016, false);
  const still = snap();
  let x = 0, z = 0, dir = 0;
  for (let i = 0; i < 60; i++) {
    dir += 0.03; z += 0.05;
    who.update({ x: x, y: 0, z: z, dir: dir, st: 1, fy: 0 }, 0.016, (60 + i) * 0.016, false);
  }
  const moved = snap();
  let maxRoot = 0, maxTip = 0;
  for (let i = 0; i < w.length; i++) {
    const k = i * 3;
    const d = Math.hypot(moved[k] - still[k], moved[k + 1] - still[k + 1], moved[k + 2] - still[k + 2]);
    if (w[i] === 0) maxRoot = Math.max(maxRoot, d);
    else if (w[i] > 0.8) maxTip = Math.max(maxTip, d);
  }
  ok('뿌리는 두피에 붙어 있다', maxRoot < 1e-6, maxRoot.toFixed(5) + 'm');
  ok('걸으면 머리끝이 흩날린다', maxTip > 0.01, maxTip.toFixed(3) + 'm');
  ok('너무 휘둘리지는 않는다', maxTip < 0.3, maxTip.toFixed(3) + 'm');
}
/* 색은 이름에서 뽑는다 — 같은 이름이면 늘 같은 색이어야 하고(남의 화면에서도
 * 같아야 한다), 여러 이름이 한 색으로 몰리면 안 된다. 두 사람만 비교하면
 * 우연히 같은 색이 나와 애먼 실패가 난다. */
ok('같은 이름은 늘 같은 색',
  avatar3d.colorOf('가나다')[0] === avatar3d.colorOf('가나다')[0]);
const seen = new Set();
for (let i = 0; i < 60; i++) seen.add(avatar3d.colorOf('손님' + i)[0]);
ok('색이 고루 갈린다', seen.size >= 5, seen.size + '가지');

console.log('\n  ' + (fail ? fail + '건 실패 / ' : '') + pass + '건 통과');
process.exit(fail ? 1 : 0);
