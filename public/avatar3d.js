/* ------------------------------------------------------------------
 *  avatar3d.js — 둥근 카툰 2등신, 3D 버전
 *
 *  키 1.7m. 머리가 크고 몸이 작다. 입은 없고 눈만 있다.
 *  이름표와 말풍선은 늘 카메라를 보는 스프라이트.
 * ------------------------------------------------------------------ */
import * as THREE from 'three';
import { mat, outlineOf, RAMP_SOFT } from './toon.js';

/* 윗옷 · 아랫도리 · 머리카락. 색은 이름에서 뽑으므로 늘 같은 사람이 같은 옷이다.
 * 0번(윗옷)은 참여자 목록의 점 색과 화살 색으로도 쓰인다 — 자리를 바꾸지 말 것. */
const PALETTE = [
  [0xff6b5c, 0x3f8ecc, 0x4a3327],   // 빨강 셔츠
  [0x4fc3f7, 0xf2f2f2, 0x2b2a33],   // 하늘
  [0x7ddc7d, 0xe8d36a, 0x8a5a2b],   // 연두
  [0xffd166, 0x6fbf8f, 0xd9a441],   // 노랑
  [0xc792ea, 0xf2f2f2, 0x5c3f7a],   // 보라
  [0xff9ec4, 0xf7f3ea, 0xe06f9c],   // 분홍
  [0x6fe3d4, 0xf2f2f2, 0x3a3f4a],   // 민트
  [0xf2f2f2, 0x5f78e0, 0x6b4a2f],   // 흰 셔츠
  [0xffb86b, 0x7a6ad9, 0x2b2a33],   // 주황
  [0x8fa6ff, 0xf0a0b8, 0xb98a55]    // 파랑
];

/* 얼굴은 메시로 깎지 않고 그려서 붙인다.
 *  눈동자의 흰 점, 볼터치, 입 — 이런 건 작은 구를 붙여 봐야 지저분해지기만 하고,
 *  멀리서 보면 뭉개진다. 캔버스에 그려 머리 앞쪽 구면 조각에 감는 쪽이 또렷하다.
 *  깜빡임도 눈꺼풀 메시 없이 '감은 얼굴' 텍스처로 바꿔 끼우면 된다.
 *  seed 에 따라 눈매와 입이 조금씩 달라진다 — 다 같은 얼굴이면 인형 같다. */
export function colorOf(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/* 글자를 그려 넣은 판때기 스프라이트 */
function labelSprite(text, opts) {
  const o = opts || {};
  const pad = 18, font = (o.bold ? 'bold ' : '') + (o.size || 34) + 'px "Noto Sans KR",sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const lines = String(text).split('\n');
  const tw = Math.max(...lines.map((l) => probe.measureText(l).width));
  const c = document.createElement('canvas');
  c.width = Math.ceil(tw + pad * 2);
  c.height = Math.ceil(lines.length * (o.size || 34) * 1.3 + pad * 1.2);
  const g = c.getContext('2d');
  g.font = font;
  g.fillStyle = o.bg || 'rgba(22,20,28,.78)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, o.radius || 16);
  g.fill();
  if (o.border) {
    g.strokeStyle = o.border; g.lineWidth = 3;
    g.beginPath(); g.roundRect(1.5, 1.5, c.width - 3, c.height - 3, o.radius || 16); g.stroke();
  }
  g.fillStyle = o.fg || '#f2eee8';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    g.fillText(l, c.width / 2, pad * 0.6 + (i + 0.5) * (o.size || 34) * 1.3);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false
  }));
  const scale = (o.worldHeight || 0.2) / c.height;
  spr.scale.set(c.width * scale, c.height * scale, 1);
  spr.renderOrder = 10;
  spr.userData.dispose = () => { tex.dispose(); spr.material.dispose(); };
  return spr;
}

function faceTexture(seed, shut, hairHex) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const kind = Math.abs(seed) % 5;
  const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');

  /* 눈은 얼굴의 거의 전부다. 크고, 눈꼬리가 살짝 올라간 아몬드꼴이고,
   * 안에 색 있는 홍채와 흰 점이 있다. 검은 타원만 찍으면 단추가 된다. */
  const IRIS = [0x4a86d8, 0x5aa36b, 0x8a6a3f, 0x6b5ad0, 0x3f8f92];
  const iris = IRIS[kind];
  const EY = S * 0.455, EX = S * 0.205;       // 눈 높이 · 가운데서 벌어진 거리
  const rx = S * 0.098, ry = S * 0.125;

  // 볼터치 — 눈 바깥 아래. 가장자리가 흐려야 분칠처럼 보인다
  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * S * 0.305, y = S * 0.565;
    const grd = g.createRadialGradient(x, y, 0, x, y, S * 0.082);
    grd.addColorStop(0, 'rgba(255,146,146,.55)');
    grd.addColorStop(1, 'rgba(255,146,146,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, S * 0.082, 0, 6.2832); g.fill();
  }

  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * EX;

    if (shut) {
      // 감은 눈 — 아래로 휜 굵은 선
      g.strokeStyle = '#2a2018';
      g.lineWidth = S * 0.034;
      g.beginPath();
      g.moveTo(x - rx * 0.92, EY - ry * 0.1);
      g.quadraticCurveTo(x, EY + ry * 0.62, x + rx * 0.92, EY - ry * 0.1);
      g.stroke();
      continue;
    }

    // 흰자 — 아주 조금만 보인다
    g.fillStyle = '#fbf7f2';
    g.beginPath(); g.ellipse(x, EY, rx, ry, 0, 0, 6.2832); g.fill();
    // 홍채 — 흰자를 거의 채운다
    g.fillStyle = hex(iris);
    g.beginPath(); g.ellipse(x, EY + ry * 0.04, rx * 0.82, ry * 0.88, 0, 0, 6.2832); g.fill();
    // 동공
    g.fillStyle = '#241c16';
    g.beginPath(); g.ellipse(x, EY + ry * 0.08, rx * 0.46, ry * 0.56, 0, 0, 6.2832); g.fill();
    // 흰 점 — 이것 하나로 눈이 살아난다
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.beginPath();
    g.ellipse(x + rx * 0.3, EY - ry * 0.42, rx * 0.26, ry * 0.22, -0.4, 0, 6.2832);
    g.fill();
    // 윗눈꺼풀 — 위쪽을 덮어 눈매를 만든다
    g.strokeStyle = '#2a2018';
    g.lineWidth = S * 0.03;
    g.beginPath();
    g.moveTo(x - rx * 1.02, EY - ry * 0.52);
    g.quadraticCurveTo(x, EY - ry * 1.18, x + rx * 1.02, EY - ry * 0.52);
    g.stroke();
  }

  // 눈썹 — 머리카락과 같은 색, 가늘게
  g.strokeStyle = hex(hairHex || 0x4a3327);
  g.lineWidth = S * 0.02;
  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * EX;
    g.beginPath();
    g.moveTo(x - rx * 0.78, EY - ry * 1.62);
    g.quadraticCurveTo(x, EY - ry * 1.92, x + rx * 0.78, EY - ry * 1.62);
    g.stroke();
  }

  /* 코 — 있는지 없는지 모를 만큼 작다. 크게 그리면 금세 사람 얼굴이 되어
   * 그 동네 사람다움이 사라진다. */
  g.fillStyle = 'rgba(214,142,120,.75)';
  g.beginPath();
  g.ellipse(S / 2, S * 0.545, S * 0.016, S * 0.013, 0, 0, 6.2832);
  g.fill();

  // 입 — 눈 가까이, 작고 부드러운 웃음
  const mx = S / 2, my = S * 0.63;
  g.strokeStyle = '#3a2a22';
  g.lineWidth = S * 0.022;
  if (kind === 4) {                            // 벌린 입
    g.fillStyle = '#7a4a46';
    g.beginPath(); g.ellipse(mx, my + S * 0.006, S * 0.03, S * 0.026, 0, 0, 6.2832); g.fill();
  } else {
    g.beginPath();
    g.moveTo(mx - S * 0.042, my - S * 0.008);
    g.quadraticCurveTo(mx, my + S * 0.034, mx + S * 0.042, my - S * 0.008);
    g.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* 머리가 커야 그 동네 사람처럼 보인다. 키 1.7m 에 머리 지름 0.6m —
 * 2.8등신쯤이다. 목은 없고, 손발은 둥근 덩어리로만 둔다. */
const HEAD_R = 0.30;
/* 얼굴판 — 좁게 잡아야 이목구비가 옆으로 끌려가지 않는다.
 * 넓게 감으면 눈이 관자놀이까지 퍼져 사람이 아니라 가면처럼 보인다. */
const FACE_PHI = Math.PI * 0.46;      // 좌우 83°
const FACE_THETA = Math.PI * 0.40;    // 위아래 72°
const FACE_TOP = Math.PI * 0.36;      // 정수리에서 65° 아래부터

export function makeAvatar(opts) {
  const col = colorOf(opts.seed);
  /* 방과 같은 띠로 칠한다 — 사람만 매끈하면 붙여 넣은 것처럼 겉돈다 */
  const main = mat(col[0]);                    // 윗옷
  const dark = mat(col[1]);                    // 아랫도리
  const hairMat = mat(col[2] || col[1]);
  const skin = mat(0xffe0c0);
  const shoe = mat(0xf4f1ea);

  /* 얼굴 — 뜬 눈과 감은 눈 두 장을 만들어 두고 갈아 끼운다.
   * 어둑한 방에서도 이목구비가 보여야 하므로 제가 조금 빛나게 둔다.
   * 빛나는 정도를 같은 그림으로 눌러 줘서 눈동자는 검게 남는다. */
  let seedNum = 0;
  const sstr = String(opts.seed);
  for (let i = 0; i < sstr.length; i++) seedNum = (seedNum * 31 + sstr.charCodeAt(i)) | 0;
  const faceOpen = faceTexture(seedNum, false, col[2] || col[1]);
  const faceShut = faceTexture(seedNum, true, col[2] || col[1]);
  const faceMat = new THREE.MeshToonMaterial({
    map: faceOpen, emissive: 0xffffff, emissiveMap: faceOpen, emissiveIntensity: 0.3,
    gradientMap: RAMP_SOFT, transparent: true, depthWrite: false
  });

  const root = new THREE.Group();
  const body = new THREE.Group();     // 걸을 때 위아래로 들썩이는 부분
  root.add(body);

  // 몸통 — 작고 동그랗게. 목 없이 머리가 바로 얹힌다
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.195, 0.2, 6, 16), main);
  torso.position.y = 0.79;
  body.add(torso);
  // 옷단 — 윗옷과 아랫도리가 갈리는 자리
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.195, 0.07, 16), dark);
  hem.position.y = 0.63;
  body.add(hem);

  // 다리 — 짧고 통통하게. 끝에 둥근 신발
  const legGeo = new THREE.CapsuleGeometry(0.082, 0.14, 4, 12);
  const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.095, 0.24, 0);
  const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.095, 0.24, 0);
  body.add(legL, legR);
  const legY = legL.position.y, legZ = legL.position.z;
  const shoeGeo = new THREE.SphereGeometry(0.095, 12, 10);
  const shoeL = new THREE.Mesh(shoeGeo, shoe); shoeL.scale.set(1, 0.72, 1.3);
  const shoeR = new THREE.Mesh(shoeGeo, shoe); shoeR.scale.set(1, 0.72, 1.3);
  shoeL.position.set(0, -0.12, 0.022); shoeR.position.set(0, -0.12, 0.022);
  legL.add(shoeL); legR.add(shoeR);          // 다리에 붙여 같이 움직이게

  // 팔 — 짧고, 끝에 벙어리장갑 같은 손
  const armGeo = new THREE.CapsuleGeometry(0.062, 0.12, 4, 12);
  const armL = new THREE.Mesh(armGeo, main); armL.position.set(-0.225, 0.84, 0);
  const armR = new THREE.Mesh(armGeo, main); armR.position.set(0.225, 0.84, 0);
  armL.rotation.z = 0.16; armR.rotation.z = -0.16;
  body.add(armL, armR);
  const handGeo = new THREE.SphereGeometry(0.083, 12, 10);
  const handL = new THREE.Mesh(handGeo, skin); handL.position.y = -0.135;
  const handR = new THREE.Mesh(handGeo, skin); handR.position.y = -0.135;
  armL.add(handL); armR.add(handR);

  // 머리
  const head = new THREE.Group();
  head.position.y = 1.33;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 24, 18), skin);
  head.add(skull);

  // 얼굴 — 머리 앞쪽 구면에 감는다 (살갗보다 아주 조금 바깥)
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_R * 1.012, 28, 20,
      Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_TOP, FACE_THETA),
    faceMat
  );
  face.renderOrder = 1;
  head.add(face);

  /* 머리카락 — 두건처럼 덮기만 하면 가발이 된다. 셋으로 나눈다.
   *    덮개   정수리에서 옆머리까지 통으로
   *    뒷머리 뒤통수만 더 길게
   *    앞머리 이마선에 뾰족한 가닥을 둘러 붙인다 — 이게 제일 티가 난다
   *  가닥 끝은 눈 바로 위에서 멈춘다. 더 내려오면 눈을 가린다. */
  const HAIR_R = HEAD_R * 1.035;
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(HAIR_R, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.345),
    hairMat
  );
  head.add(hair);
  const nape = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_R * 1.028, 22, 16,
      Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.2, Math.PI * 0.42),
    hairMat
  );
  head.add(nape);

  // 앞머리 가닥 — 이마선(정수리에서 62°)을 따라 아래로 뾰족하게
  const FRINGE_T = Math.PI * 0.345;
  const fy = HAIR_R * Math.cos(FRINGE_T);
  const fr = HAIR_R * Math.sin(FRINGE_T);
  for (let i = -4; i <= 4; i++) {
    const a = i * 0.26;                       // 앞쪽 ±60° 에 아홉 가닥
    const len = 0.17 - Math.abs(i) * 0.012;   // 가운데가 길다
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.062, len, 7), hairMat);
    tuft.position.set(Math.sin(a) * fr, fy - len * 0.34, Math.cos(a) * fr);
    tuft.rotation.x = Math.PI;                // 끝이 아래를 보게 뒤집는다
    tuft.rotation.z = -Math.sin(a) * 0.5;     // 옆가닥은 바깥으로 눕는다
    head.add(tuft);
  }

  /* 올림머리 — 다섯 중 둘은 정수리에 묶는다. 실루엣이 갈려야
   * 멀리서도 누가 누군지 보인다. */
  if (seedNum % 5 < 2) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), hairMat);
    bun.position.set(0, HEAD_R * 0.96, -0.03);
    head.add(bun);
  }
  body.add(head);

  /* 손그림 선 — 몸피가 되는 덩어리에만 두른다. 머리카락·얼굴까지 두르면
   * 이목구비가 뭉개진다. 방에는 두르지 않는다(배경에는 선을 긋지 않는다). */
  [torso, legL, legR, armL, armR].forEach((m) => body.add(outlineOf(m, 0.085)));
  head.add(outlineOf(skull, 0.055));

  // 발밑 그림자
  const shTex = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.72),
    new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.014;
  root.add(shadow);

  // 내 캐릭터 발밑 고리
  let ring = null;
  if (opts.isMe) {
    ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.37, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc14d, transparent: true, opacity: 0.85, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.018;
    root.add(ring);
  }

  // 이름표
  let tag = labelSprite(opts.name || '익명', {
    size: 30, worldHeight: 0.19, bold: true,
    bg: opts.isMe ? 'rgba(255,186,80,.92)' : 'rgba(22,20,28,.78)',
    fg: opts.isMe ? '#2b1d05' : '#f2eee8'
  });
  tag.position.y = 1.78;
  root.add(tag);

  let bubble = null, bubbleT = 0;
  const ph = Math.random() * 6.28;
  let stride = 0;

  const api = {
    root: root,
    body: body,
    head: head,
    name: opts.name || '익명',
    gone: false,
    hitMeshes: [torso, skull],

    setName(n) {
      if (n === api.name) return;
      api.name = n;
      root.remove(tag);
      tag.userData.dispose();
      tag = labelSprite(n || '익명', {
        size: 30, worldHeight: 0.19, bold: true,
        bg: opts.isMe ? 'rgba(255,186,80,.92)' : 'rgba(22,20,28,.78)',
        fg: opts.isMe ? '#2b1d05' : '#f2eee8'
      });
      tag.position.y = 1.78;
      tag.material.opacity = api.gone ? 0.35 : 1;
      root.add(tag);
    },

    /* 연결이 끊긴 사람 — 돌아올 수도 있으니 지우지 않고 흐리게 둔다 */
    setGone(on) {
      on = !!on;
      if (api.gone === on) return;
      api.gone = on;
      for (const mt of [main, dark, hairMat, skin, shoe, faceMat]) {
        mt.transparent = on;
        mt.opacity = on ? 0.26 : 1;
        mt.depthWrite = !on;
        mt.needsUpdate = true;
      }
      tag.material.opacity = on ? 0.35 : 1;
    },

    say(text) {
      if (bubble) { root.remove(bubble); bubble.userData.dispose(); }
      // 너무 길면 줄을 나눈다
      const t = String(text);
      const lines = [];
      for (let i = 0; i < t.length && lines.length < 3; i += 16) lines.push(t.slice(i, i + 16));
      bubble = labelSprite(lines.join('\n'), {
        size: 30, worldHeight: 0.2 * lines.length + 0.06,
        bg: 'rgba(250,247,242,.96)', fg: '#241f2b', radius: 18
      });
      bubble.position.y = 2.06 + lines.length * 0.08;
      root.add(bubble);
      bubbleT = 0;
    },

    /* p = {x, z, dir, st}  (dir: y축 회전, st: 1 걷는 중 · 2 앉은 중)
     *  p.fy = 발이 딛고 선 바닥 높이. 영화관 단 위에서도 '점프 중' 으로 보지 않으려면
     *  p.y 를 그대로 보지 말고 바닥과의 차이를 봐야 한다. */
    update(p, dt, t, hidden) {
      root.visible = !hidden;
      root.position.x = p.x;
      root.position.y = p.y || 0;
      root.position.z = p.z;
      root.rotation.y = p.dir;

      const sitting = p.st === 2;
      const walking = p.st === 1 && !sitting;
      stride += dt * (walking ? 11 : 0);
      const sw = Math.sin(stride);
      legL.rotation.x = walking ? sw * 0.6 : 0;
      legR.rotation.x = walking ? -sw * 0.6 : 0;
      armL.rotation.x = walking ? -sw * 0.5 : 0;
      armR.rotation.x = walking ? sw * 0.5 : 0;
      const air = !sitting && ((p.y || 0) - (p.fy || 0)) > 0.03;
      body.position.y = air ? 0.02 : (walking ? Math.abs(Math.sin(stride)) * 0.045 : Math.sin(t * 1.6 + ph) * 0.012);
      if (air) {                                 // 공중에서는 다리를 모으고 팔을 든다
        legL.rotation.x = -0.35; legR.rotation.x = 0.2;
        armL.rotation.x = -0.9; armR.rotation.x = -0.9;
      }
      if (sitting) {
        // 엉덩이를 방석 높이로 내리고 허벅지를 앞으로 접는다
        body.position.y = -0.235;
        legL.position.set(-0.095, legY + 0.16, legZ - 0.13);
        legR.position.set(0.095, legY + 0.16, legZ - 0.13);
        legL.rotation.x = legR.rotation.x = -1.32;
        armL.rotation.x = armR.rotation.x = -0.22;
      } else if (legL.position.z !== legZ) {
        legL.position.set(-0.095, legY, legZ);
        legR.position.set(0.095, legY, legZ);
      }
      /* 고개는 몸을 따라간다 — 늘 걸어가는 쪽을 본다.
       * 걸을 때 좌우로 아주 조금 갸웃하는 것만 남긴다. */
      head.rotation.z = walking ? sw * 0.04 : Math.sin(t * 1.2 + ph) * 0.02;

      /* 눈 깜빡임 — 눈꺼풀을 따로 두지 않고 '감은 얼굴' 로 바꿔 끼운다 */
      const shut = Math.sin(t * 0.8 + ph * 3) > 0.985;
      if (shut !== (faceMat.map === faceShut)) {
        faceMat.map = shut ? faceShut : faceOpen;
        faceMat.emissiveMap = faceMat.map;
        faceMat.needsUpdate = true;
      }

      const h = Math.max(0, (p.y || 0) - (p.fy || 0));
      shadow.position.y = 0.014 - h;             // 월드 기준으로는 늘 바닥
      const sh = Math.max(0.35, 1 - h * 0.55);
      shadow.scale.set(sh, sh, 1);
      shadow.material.opacity = Math.max(0.25, 1 - h * 0.5) * (api.gone ? 0.3 : 1);
      if (ring) {
        ring.position.y = 0.018 - h;
        ring.material.opacity = (0.55 + Math.sin(t * 2.4) * 0.25) * (h > 0.03 ? 0.4 : 1);
      }

      if (bubble) {
        bubbleT += dt;
        if (bubbleT > 6.5) { root.remove(bubble); bubble.userData.dispose(); bubble = null; }
        else if (bubbleT > 5.5) bubble.material.opacity = 1 - (bubbleT - 5.5);
      }
    },

    dispose() {
      root.traverse((o) => {
        if (o.isMesh) { o.geometry.dispose(); }
        if (o.userData && o.userData.dispose) o.userData.dispose();
      });
      main.dispose(); dark.dispose(); hairMat.dispose();
      skin.dispose(); shoe.dispose(); faceMat.dispose();
      faceOpen.dispose(); faceShut.dispose();
    }
  };

  return api;
}
