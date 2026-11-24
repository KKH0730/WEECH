/* ------------------------------------------------------------------
 *  avatar3d.js — 둥근 카툰 2등신, 3D 버전
 *
 *  키 1.7m. 머리가 크고 몸이 작다. 입은 없고 눈만 있다.
 *  이름표와 말풍선은 늘 카메라를 보는 스프라이트.
 * ------------------------------------------------------------------ */
import * as THREE from 'three';
import { mat, outlineOf, ramp, RAMP_SOFT } from './toon.js';

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

/* eyeKind 0~6 — 레퍼런스(동물의 숲) 스타일의 맑고 아기자기한 눈매 일곱 가지 */
function faceTexture(eyeKind, shut, hairHex) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const kind = Math.abs(eyeKind | 0) % 7;    // 눈매 수 — PARTS.eyes 와 같아야 한다

  const chan = (v, i) => (v >> (16 - 8 * i)) & 255;
  const rgb = (r, gg, b) => (r << 16) | (gg << 8) | b;
  const shade = (v, k) => rgb(...[0, 1, 2].map((i) => {
    const x = chan(v, i);
    return Math.max(0, Math.min(255, Math.round(k < 0 ? x * (1 + k) : x + (255 - x) * k)));
  }));
  const mix = (a, b, t) => rgb(...[0, 1, 2].map((i) => Math.round(chan(a, i) * (1 - t) + chan(b, i) * t)));
  const css = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');

  /* 레퍼런스 동물의 숲 얼굴 비율과 작화법:
   *   - 흰자   윗선이 둥근 아치, 아랫선은 완만하고 깔끔하게 (밑 테두리 없음!)
   *   - 홍채   맑은 단색 원이 눈 아래쪽에 내려앉아 안쪽·위쪽 흰자가 시원히 남는다
   *   - 동공   홍채를 짙게 누른 원 + 왼쪽 위 동그란 흰 반짝점 한 알
   *   - 눈꺼풀 윗선에만 따뜻한 갈색 아이라인 + 눈꼬리 작은 속눈썹
   *   - 코     3D 버튼 코가 눈 아랫부분 사이(0.545)에 올라가고,
   *            입(0.765)은 코 아래로 넉넉히 띄워 붙어 보이지 않게 한다. */
  const IRIS = [0x3b8c94, 0x4584c8, 0x8c623d, 0x4e9b68, 0x4d3422, 0x3b8c94, 0x3b8c94];
  const LINE = kind === 4 ? '#4a3225' : css(mix(shade(hairHex, -0.45), 0x523629, 0.62));
  const iris = IRIS[kind];
  const CAT = kind === 5;
  const HALF_LID = kind === 0;               // 바다 — 윗선이 살짝 차분한 동숲 반달 큰 눈

  const EY = S * 0.455, EX = S * 0.248;
  const rx = S * 0.120, ry = S * 0.168;      // 위아래로 길쭉한 동물의 숲 아치 눈 비율

  /* 포근한 동물의 숲 볼터치 — 눈 바깥 아래 */
  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * S * 0.34, y = S * 0.655;
    const grd = g.createRadialGradient(x, y, 0, x, y, S * 0.082);
    grd.addColorStop(0, 'rgba(248,154,142,.52)');
    grd.addColorStop(0.6, 'rgba(248,154,142,.32)');
    grd.addColorStop(1, 'rgba(248,154,142,0)');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(x, y, S * 0.082, S * 0.052, 0, 0, 6.2832); g.fill();
  }

  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * EX;
    const out = sx;                            // 눈꼬리가 있는 쪽

    if (shut) {
      // 감은 눈 — 순하게 웃는 동숲 선
      g.strokeStyle = LINE;
      g.lineWidth = S * 0.024;
      g.beginPath();
      g.moveTo(x - rx * 0.85, EY - ry * 0.06);
      g.quadraticCurveTo(x, EY + ry * 0.56, x + rx * 0.85, EY - ry * 0.06);
      g.stroke();
      continue;
    }

    if (CAT) {
      /* 고양이 눈매 — 동숲 스타일로 깔끔하게(밑 테두리 없이) 눈꼬리만 앙증맞게 올린다 */
      const rxC = rx * 1.08, ryC = ry * 0.88;
      const xin = x - out * rxC * 0.96, yin = EY + ryC * 0.36;
      const xout = x + out * rxC * 1.0, yout = EY - ryC * 0.36;
      const path = () => {
        g.beginPath();
        g.moveTo(xin, yin);
        g.bezierCurveTo(x - out * rxC * 0.45, EY - ryC * 1.22, x + out * rxC * 0.45, EY - ryC * 1.15, xout, yout);
        g.quadraticCurveTo(x + out * rxC * 0.1, EY + ryC * 0.92, xin, yin);
        g.closePath();
      };
      g.fillStyle = '#ffffff';
      path(); g.fill();
      g.save();
      path(); g.clip();
      const irC = rxC * 0.68;
      const cx = x + out * rxC * 0.06, cy = EY + ryC * 0.14;
      g.fillStyle = css(iris);
      g.beginPath(); g.arc(cx, cy, irC, 0, 6.2832); g.fill();
      g.fillStyle = css(shade(iris, -0.58));
      g.beginPath(); g.arc(cx, cy + irC * 0.02, irC * 0.48, 0, 6.2832); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(cx - irC * 0.34, cy - irC * 0.32, irC * 0.25, 0, 6.2832); g.fill();
      g.restore();
      g.strokeStyle = LINE;
      g.lineWidth = S * 0.024;
      g.beginPath();
      g.moveTo(xin, yin);
      g.bezierCurveTo(x - out * rxC * 0.45, EY - ryC * 1.22, x + out * rxC * 0.45, EY - ryC * 1.15, xout, yout);
      g.lineTo(xout + out * S * 0.026, yout - S * 0.022);
      g.stroke();
      continue;
    }

    /* 위아래로 긴 동물의 숲 눈 — 상단 왼쪽·오른쪽만 둥글게 라운딩하고
     * 하단은 라운딩 없이 반듯한 직선으로 마무리한다 (밑 테두리 없음). */
    const rxA = rx * (kind === 3 ? 1.04 : 1.0);
    const ryA = ry * (kind === 6 ? 1.04 : 1.0);
    const L = x - rxA, R = x + rxA;
    const T = HALF_LID ? (EY - ryA * 0.68) : (EY - ryA);
    const B = EY + ryA * 0.88;
    const rad = HALF_LID ? rxA * 0.68 : rxA * 0.94;   // 상단 좌·우 라운딩 반지름 (하단은 0)

    const path = () => {
      g.beginPath();
      g.moveTo(L, B);                                  // 하단 왼쪽 (라운딩 없음)
      g.lineTo(L, T + rad);
      g.quadraticCurveTo(L, T, L + rad, T);            // 상단 왼쪽 라운딩
      g.lineTo(R - rad, T);
      g.quadraticCurveTo(R, T, R, T + rad);            // 상단 오른쪽 라운딩
      g.lineTo(R, B);                                  // 하단 오른쪽 (라운딩 없음)
      g.closePath();                                   // 하단 직선
    };

    //  순백 흰자 (밑 테두리 없음 — 피부와 깔끔하게 맞닿는다)
    g.fillStyle = '#ffffff';
    path(); g.fill();

    g.save();
    path(); g.clip();

    //  맑은 단색 동숲 홍채 — 사진처럼 코 쪽(안쪽)으로 모여 바깥쪽 흰자가 시원하게 드러난다
    const isDanchu = kind === 4;
    const irX = rxA * (isDanchu ? 0.72 : (kind === 3 ? 0.84 : 0.80));
    const irY = isDanchu ? ryA * 0.78 : irX;
    const cx = x - out * rxA * (isDanchu ? 0.26 : 0.14);
    const cy = B - irY * (isDanchu ? 0.84 : 0.82);
    g.fillStyle = css(iris);
    g.beginPath(); g.ellipse(cx, cy, irX, irY, 0, 0, 6.2832); g.fill();

    //  동공 — 홍채보다 진한 단색 원/타원
    g.fillStyle = css(shade(iris, -0.58));
    g.beginPath(); g.ellipse(cx, cy + irY * 0.02, irX * 0.48, irY * 0.48, 0, 0, 6.2832); g.fill();

    //  깔끔한 원형 흰 반짝점 한 알
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(cx - irX * 0.24, cy - irY * 0.32, irX * 0.25, 0, 6.2832); g.fill();
    g.restore();

    //  윗눈꺼풀 라운딩 테두리만 또렷하게 (따뜻한 갈색, 하단 선 없음)
    g.strokeStyle = LINE;
    g.lineWidth = S * 0.025;
    g.beginPath();
    g.moveTo(L, T + rad * 1.15);
    g.lineTo(L, T + rad);
    g.quadraticCurveTo(L, T, L + rad, T);
    g.lineTo(R - rad, T);
    g.quadraticCurveTo(R, T, R, T + rad);
    g.lineTo(R, T + rad * 1.15);
    g.stroke();

    //  눈꼬리 바깥쪽에 앙증맞은 속눈썹 1~2가닥
    const lashN = (HALF_LID || kind === 4) ? 1 : 2;
    g.lineWidth = S * 0.018;
    const edgeX = out > 0 ? R : L;
    for (let k = 0; k < lashN; k++) {
      const lx0 = edgeX - out * (k * rxA * 0.14);
      const ly0 = T + rad * (0.92 - k * 0.36);
      g.beginPath();
      g.moveTo(lx0, ly0);
      g.lineTo(lx0 + out * S * 0.032, ly0 - S * (0.014 + k * 0.014));
      g.stroke();
    }
  }

  // 입 — 코(0.565) 아래로 넉넉히 띄운(0.775) 동물의 숲 특유의 귀여운 U자 미소
  const mx = S / 2, my = kind === 4 ? S * 0.77 : S * 0.78;
  g.strokeStyle = LINE;
  g.lineWidth = S * 0.023;
  if (kind === 4) {
    //  단추 — 코 아래 적당한 간격을 둔 잔잔하고 상냥한 닫힌 미소
    g.beginPath();
    g.moveTo(mx - S * 0.056, my - S * 0.010);
    g.quadraticCurveTo(mx, my + S * 0.056, mx + S * 0.056, my - S * 0.010);
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(mx - S * 0.052, my - S * 0.012);
    g.quadraticCurveTo(mx, my + S * 0.062, mx + S * 0.052, my - S * 0.012);
    g.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---- 머리 모양 ------------------------------------------------------
 *  정구면이면 공을 얹은 것처럼 보인다. 사람 머리는 광대뼈께가 가장 넓고
 *  턱으로 갈수록 좁아진다. 각도(theta)마다 반지름을 달리해 짠다.
 *      theta 0     정수리
 *      theta 90°   광대 — 가장 넓다
 *      theta 180°  턱 — 좁다
 * ------------------------------------------------------------------ */
/* 두상 — 정수리(th 0)에서 턱(th π)까지, 반지름을 몇 배로 할지.
 *
 *  볼이 빵빵해야 그 동네 얼굴이 된다. 적도(sin)를 부풀리면 이마가
 *  같이 넓어질 뿐이라 통통해 보이지 않는다 — 가장 볼록한 데가 눈
 *  아래(t 0.62 언저리)여야 한다. 턱도 많이 좁히면 어른 얼굴이 되므로
 *  살짝만 여민다.
 *
 *  **머리카락(longHair)도 이걸 쓴다.** 머리통만 부풀리고 머리카락을
 *  맨 구로 두면 볼이 옆머리를 뚫고 나와, 귀 옆에 살색 날개가 돋은
 *  것처럼 보인다. 한쪽만 고치지 말 것. */
function headProf(th) {
  const t = th / Math.PI;
  /* 모동숲 특유의 '살짝 찌그러진 찹쌀떡' 두상 —
   * 완전한 동그라미 공이 아니라, 정수리·이마 쪽은 살짝 좁고
   * 눈 아래 양 볼(t 0.66)이 옆으로 포동포동 볼록하며, 턱 밑은 부드럽게 눌려 있다. */
  const topT = Math.max(0, 1 - t / 0.46);
  const topNarrow = 1 - 0.075 * topT * topT;
  const cheek = 1 + 0.115 * Math.exp(-(((t - 0.66) / 0.20) ** 2));
  const chin = 1 - 0.145 * Math.max(0, (t - 0.80) / 0.20) ** 1.55;
  return topNarrow * cheek * chin;
}

function headShape(r, patch) {
  /* patch 를 주면 그 범위만 떼어낸다. 얼굴 그림을 붙일 면은 두상과
   * 똑같은 곡면이어야 한다 — 따로 만든 구를 겹치면 광대께에서 묻힌다. */
  const q = patch || { p0: 0, pLen: Math.PI * 2, t0: 0, tLen: Math.PI, mul: 1 };
  const NP = patch ? 40 : 48, NT = patch ? 28 : 36;
  const pos = [], nor = [], uv = [], idx = [];
  for (let it = 0; it <= NT; it++) {
    const th = q.t0 + (it / NT) * q.tLen;
    const rr = r * headProf(th) * (q.mul || 1);
    for (let ip = 0; ip <= NP; ip++) {
      const phi = q.p0 + (ip / NP) * q.pLen;
      const sx = Math.sin(th) * Math.sin(phi);
      const sy = Math.cos(th);
      const sz = Math.sin(th) * Math.cos(phi);
      /* 세로로 긴 머리는 어른처럼 보이고, 정구면은 공처럼 보인다.
       * 눌림은 HEAD_S* 가 정한다 — 볼 부풀림과 겹으로 넓히지 말 것. */
      pos.push(sx * rr * HEAD_SX, sy * rr * HEAD_SY, sz * rr * HEAD_SZ);
      nor.push(sx, sy, sz);
      uv.push(ip / NP, 1 - it / NT);
    }
  }
  for (let it = 0; it < NT; it++) for (let ip = 0; ip < NP; ip++) {
    const i0 = it * (NP + 1) + ip;
    idx.push(i0, i0 + NP + 1, i0 + 1, i0 + 1, i0 + NP + 1, i0 + NP + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ---- 머리카락 덩어리 ------------------------------------------------
 *  얇은 껍질 하나로 덮으면 머리통에 색칠한 것처럼 보인다 — 두께가 0이라
 *  옆에서 보면 종이다. 진짜 머리카락은 두피에서 떠 있는 '덩어리' 라서
 *  밑단에 단면이 보인다.
 *
 *  그래서 겉면과 속면을 따로 짜고 밑단에서 둘을 이어 붙인다.
 *      겉면  두피보다 OUT 배 (머리보다 확실히 크다 — 부피가 보여야 한다)
 *      속면  두피 바로 위
 *      밑단  둘을 잇는 띠 — 여기가 보여야 '깎은 단면' 이 생긴다
 *
 *  내려오는 깊이는 각도마다 다르다. 앞은 눈썹까지, 귀 옆은 올라가고,
 *  뒤는 목덜미까지.
 * ------------------------------------------------------------------ */
function hairMass(rIn, rOut, base, front, back) {
  const NP = 64, NT = 20;
  const pos = [], nor = [], idx = [];
  const tMaxAt = (phi) => {
    const f = Math.cos(phi);
    return base + front * Math.max(0, f) * Math.abs(f) + back * Math.max(0, -f) * Math.abs(f);
  };
  // 겉면은 정수리 쪽이 더 도톰하다 — 머리카락이 쌓인 만큼
  const puff = (t) => 1 + 0.07 * (1 - t) * (1 - t);

  const ring = (r, flip, puffed) => {
    const base0 = pos.length / 3;
    for (let it = 0; it <= NT; it++) {
      for (let ip = 0; ip <= NP; ip++) {
        const phi = (ip / NP) * Math.PI * 2;
        const th = (it / NT) * tMaxAt(phi);
        const k = puffed ? puff(it / NT) : 1;
        const sx = Math.sin(th) * Math.sin(phi);
        const sy = Math.cos(th);
        const sz = Math.sin(th) * Math.cos(phi);
        pos.push(sx * r * k, sy * r * k * 1.03, sz * r * k * 0.95);
        nor.push(flip ? -sx : sx, flip ? -sy : sy, flip ? -sz : sz);
      }
    }
    for (let it = 0; it < NT; it++) for (let ip = 0; ip < NP; ip++) {
      const i0 = base0 + it * (NP + 1) + ip;
      const i1 = i0 + 1, i2 = i0 + NP + 1, i3 = i2 + 1;
      if (flip) idx.push(i0, i1, i2, i1, i3, i2);
      else idx.push(i0, i2, i1, i1, i2, i3);
    }
    return base0;
  };
  const outBase = ring(rOut, false, true);     // 겉면
  const inBase = ring(rIn, true, false);       // 속면 (뒤집어서)

  // 밑단 — 겉과 속을 잇는 띠. 이게 '깎은 단면' 으로 보인다
  const lastRow = NT * (NP + 1);
  for (let ip = 0; ip < NP; ip++) {
    const o0 = outBase + lastRow + ip, o1 = o0 + 1;
    const i0 = inBase + lastRow + ip, i1 = i0 + 1;
    idx.push(o0, i0, o1, o1, i0, i1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeVertexNormals();                    // 밑단 모서리가 또렷해진다
  return g;
}

/* ---- 긴 생머리 ------------------------------------------------------
 *  짧은 덮개만 씌우면 반삭으로 보인다. 긴 머리는 두피를 덮고 내려오다가
 *  어깨 아래까지 '늘어진다' — 그 늘어진 부분이 실루엣의 절반이다.
 *
 *  한 가닥의 길은 두 토막이다.
 *     u 0 ~ 0.42   두피를 따라 내려온다 (여기까지가 덮개)
 *     u 0.42 ~ 1   머리 끝에서 아래로 떨어진다 (늘어진 부분)
 *
 *  얼굴 쪽(앞)은 늘어뜨리지 않는다 — 앞머리는 눈썹에서 끊는다.
 *  옆과 뒤로 갈수록 길어져 얼굴을 감싸는 모양이 된다.
 *  겉면·속면·밑단을 모두 짜서 두께를 준다.
 * ------------------------------------------------------------------ */
function longHair(rIn, rOut, len, capMul, rampW, hemY, sculpt) {
  /* capMul — 머리선(두피를 덮는 한계각)을 줄인다. 1이면 눈썹까지
   * 내려오는 앞머리, 0.8이면 이마가 드러나는 짧은 머리선이다.
   * rampW — 커튼이 얼굴 앞에서 제 길이가 되기까지의 구간. 기본 0.42는
   * 긴 생머리용이다(옆 갈래가 그 빈자리를 채운다).
   * hemY — 주면 밑단을 '한 높이' 로 자른다(머리 로컬 y). 두피 가장자리는
   * 뒤가 낮고 앞이 높아서, 상대 길이(len)로 늘어뜨리면 밑단이 그 높이차를
   * 그대로 물려받아 들쭉날쭉해진다 — 단발은 둘레가 같은 높이로 떨어져야
   * 단발이지, 아니면 바가지다.
   * sculpt — 'leaf'(세미 리프컷: 6:4 가르마 굴곡 + 목선 레이어드) |
   *          'wolf'(웨이브 울프컷: 풍성한 윗볼륨 + 목·어깨로 뻗치는 층진 뒷머리). */
  const CM = capMul || 1;
  const RW = rampW || 0.42;
  const LEAF = sculpt === 'leaf';
  const WOLF = sculpt === 'wolf';
  const BUN = sculpt === 'bun';
  /* 면 수를 아주 많이 둘 이유가 없다 — 매 프레임 꼭짓점을 흔들어야 하므로
   * 사람 수(최대 스무 명)를 곱한 만큼 계산이 된다.
   * 단, 올림머리(bun) 사각 일자 3블록 앞머리의 반듯한 모서리와 좁은 슬릿은 촘촘해야 각이 산다. */
  const NP = BUN ? 180 : 56, NU = 20;
  const pos = [], nor = [], uv = [], idx = [], sway = [];
  const SPLIT = 0.42;
  const wrapPhi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // 앞(phi=0)은 짧고, 옆·뒤는 길다
  const capAt = (phi) => {
    const f = Math.cos(phi);
    /* 옆(귀 위)도 72° 까지 내려와야 한다. 60° 에서 끊으면 옆으로
     * 떨어지는 장이 머리 반폭보다 안쪽에 떠서(0.363 < 0.374) 머리통에
     * 묻힌다 — 귀 뒤 두피가 그대로 드러난다. 앞머리는 그대로 눈썹에서. */
    let base = (Math.PI * 0.40 + Math.PI * 0.02 * Math.max(0, f) * Math.abs(f)
                               + Math.PI * 0.14 * Math.max(0, -f) * Math.abs(f)) * CM;
    if (BUN) {
      /* 모동숲 올림머리 — 앞은 사각 일자 3블록 풀뱅, 옆은 귀 앞을 감싸고
       * 귀 위를 매끈한 아치로 넘어간 뒤, 뒤통수 목덜미(0.77π)까지 꽉 감싼다. */
      const p0 = wrapPhi(phi);
      const ap = Math.abs(p0);
      const sm = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };
      const BANG_TH = Math.PI * 0.472;         // 눈 바로 위 수평 일자 컷선
      const TEMPLE_TH = Math.PI * 0.435;       // 앞머리 바깥 관자놀이
      if (ap <= 0.56) {
        //  앞머리 영역 — 가장자리(0.50~0.56)만 사각 모서리처럼 빠르게 올라간다
        const edge = Math.min(1, Math.max(0, (ap - 0.50) / 0.06));
        base = BANG_TH * (1 - edge) + TEMPLE_TH * edge;
        //  블록 사이 두 곳의 좁고 깊은 슬릿(반폭 0.042) — 물결이 아닌 반듯한 사각 블록 유지
        const slit = (c) => Math.max(0, 1 - Math.abs(p0 - c) / 0.042);
        base -= 0.36 * (slit(-0.18) + slit(0.18));
      } else {
        //  관자놀이(0.56) → 귀 앞 옆머리(1.18) → 귀 위 아치(1.57) → 귀 뒤·목덜미(π)
        const toBack = sm(1.68, 2.38, ap);
        base = TEMPLE_TH * (1 - toBack) + Math.PI * 0.77 * toBack;
        //  귀 앞 옆머리(구레나룻) — 얼굴 옆과 귀 사이를 자연스럽게 감싼다
        base += 0.36 * Math.exp(-(((ap - 1.18) / 0.22) ** 2));
        //  귀 위 아치 — 귀를 뚫지 않고 귀 윗선을 매끈하게 따라 넘어간다
        base -= 0.14 * Math.exp(-(((ap - 1.56) / 0.20) ** 2));
        //  뒷목 한가운데 아주 살짝 올라간 자연 목선
        base -= 0.04 * Math.exp(-(((Math.PI - ap) / 0.38) ** 2));
      }
    } else if (LEAF || WOLF) {
      //  가르마 자리에서 이마선이 부드럽게 아치를 그리며 갈라진다
      const partPhi = LEAF ? 0.16 : 0;
      const dp = wrapPhi(phi + partPhi);
      base -= (LEAF ? 0.11 : 0.13) * Math.exp(-((dp / 0.34) ** 2));
    }
    return base;
  };
  const dropAt = (phi) => {
    if (BUN) return 0;                       // 올림머리는 늘어뜨리지 않고 목덜미까지 두피를 감싼다
    const f = Math.cos(phi);                 // 1 앞, -1 뒤
    const back = (1 - f) / 2;                // 0 앞, 1 뒤
    if (hemY !== undefined) {
      /* 얼굴 틈만 비우고, 어디서 내려오든 밑단은 hemY 에 맞춘다.
       * 틈은 얼굴판(FACE_PHI, ±40°) 가장자리까지 — 좁히면 커튼이 볼과
       * 볼터치를 덮어 커튼 사이로 내다보는 꼴이 된다.
       * 경계는 거의 수직으로 뚝 — 넓게(0.06) 뭉개면 눈꼬리와 귀 사이에
       * 반 토막 머리카락이 걸려 관자놀이가 맨살로 보인다. */
      const o = Math.min(1, Math.max(0, (back - 0.105) / 0.02));
      const e = o * o * (3 - 2 * o);
      const th = capAt(phi);
      const capY = Math.cos(th) * rOut * headProf(th) * HEAD_SY;
      return Math.max(0, capY - hemY) * e;
    }
    /* 얼굴 앞만 짧고, 귀 옆부터 뒤까지는 고르게 길다.
     * 지수로만 깎으면 뒤 한가운데만 뾰족하게 길어져 날개처럼 보인다.
     * 0~RW 구간에서 빠르게 올라가고 그 뒤로는 평평하게 둔다. */
    const t = Math.min(1, back / RW);
    let d = len * (t * t * (3 - 2 * t));
    if (WOLF) {
      //  반묶음 뒷머리 — 귀 옆은 깔끔하게 넘기고 뒷목만 살짝 내려온다
      d *= Math.max(0, (back - 0.35) / 0.65);
    }
    return d;
  };

  const sheet = (r, flip) => {
    const base0 = pos.length / 3;
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU;
      for (let ip = 0; ip <= NP; ip++) {
        const phi = (ip / NP) * Math.PI * 2;
        const tMax = capAt(phi), drop = dropAt(phi);
        let x, y, z, nx, ny, nz;
        if (BUN || u <= SPLIT || drop < 1e-4) {
          //  올림머리(BUN)는 NU 전체 링(0~1)을 정수리~목덜미 곡면에 고르게 펼쳐 매끈하게 깎는다
          const uFrac = BUN ? u : Math.min(u, SPLIT) / SPLIT;
          const th = uFrac * tMax;
          const sx = Math.sin(th) * Math.sin(phi);
          const sy = Math.cos(th);
          const sz = Math.sin(th) * Math.cos(phi);
          let rr = r * headProf(th);           // 머리통과 같은 두상을 쓴다
          if (!flip && BUN) {
            /* 올림머리 3D 볼륨 — 앞머리(사각 3블록)는 도톰한 3D 단면을 유지하고,
             * 옆머리·뒷머리는 목덜미 끝으로 갈수록 두피에 착 감기듯 부드럽게 얇아진다. */
            const p0 = wrapPhi(phi);
            const ap = Math.abs(p0);
            const frontW = Math.max(0, 1 - ap / 0.74);
            const sDip = Math.max(0, 1 - Math.abs(p0 + 0.18) / 0.05)
              + Math.max(0, 1 - Math.abs(p0 - 0.18) / 0.05);
            const puff = (0.026 * Math.sin(uFrac * Math.PI * 0.85) + 0.014 * uFrac * uFrac) * frontW;
            const topW = Math.max(0, 1 - th / (Math.PI * 0.36));
            //  옆·뒤 헤어라인 끝단(uFrac > 0.72)은 두피 쪽으로 부드럽게 밀착해 뚜껑 턱을 없앤다
            const sideBack = Math.min(1, Math.max(0, (ap - 0.56) / 0.32));
            const napeT = Math.max(0, (uFrac - 0.72) / 0.28);
            const napeBlend = sideBack * napeT * napeT;
            const rEff = r * (1 - napeBlend) + (rIn * 1.012) * napeBlend;
            //  뒤통수 중간(당고 아래)은 둥글고 포근한 볼륨 유지
            const backFill = 0.018 * sideBack * Math.sin(uFrac * Math.PI);
            rr = rEff * headProf(th) * (1 + puff - 0.022 * sDip * frontW * uFrac + 0.010 * topW * topW + backFill);
          } else if (!flip && WOLF) {
            //  울프컷 — 구름처럼 폭신한 윗볼륨
            const topW = Math.max(0, 1 - th / (Math.PI * 0.42));
            rr *= 1 + 0.045 * topW * topW;
          } else if (!flip && LEAF) {
            //  리프컷 — 정수리 자연 볼륨, 귀 옆은 가볍게 정돈
            const topW = Math.max(0, 1 - th / (Math.PI * 0.36));
            rr *= 1 + 0.035 * topW * topW;
          }
          x = sx * rr * HEAD_SX; y = sy * rr * HEAD_SY; z = sz * rr * HEAD_SZ;
          nx = sx; ny = sy; nz = sz;
        } else {
          // 머리 끝에서 아래로. 끝으로 갈수록 살짝 모인다
          const v = (u - SPLIT) / (1 - SPLIT);
          const sx = Math.sin(tMax) * Math.sin(phi);
          const sy = Math.cos(tMax);
          const sz = Math.sin(tMax) * Math.cos(phi);
          /* 아래로 갈수록 몸 쪽으로 모이되, 끝이 뾰족해지지 않게
           * 조금만. 많이 모으면 볼이 가장 넓은 높이에서 옆머리보다
           * 안쪽으로 들어와 볼이 머리카락을 뚫는다.
           * 밑단을 맞추는 단발(hemY)은 세 토막이다 — 내려가며 벌어져서
           * 뺨과 귀를 덮고(얇은 머리는 그대로 떨어뜨리면 통째로 뚫고
           * 나온다), 귀 밑부터는 안쪽으로 감긴다(C컬). 끝까지 직선으로
           * 떨어뜨리면 클레오파트라 투구가 된다. */
          const rr = r * headProf(tMax);
          let taper;
          if (hemY !== undefined) {
            const bell = 0.10 * Math.min(1, v * 2.5);          // 뺨·귀 덮기
            const roll = Math.max(0, (v - 0.62) / 0.38);       // 귀 밑부터
            taper = 1 + bell - 0.17 * roll * roll;             // 끝은 턱 쪽으로
          } else if (LEAF) {
            //  리프컷 뒷목 — 가볍게 감싸며 안쪽으로 자연스럽게 모아진다
            taper = 1 + 0.03 * Math.sin(v * Math.PI) - 0.14 * v * v;
          } else if (WOLF) {
            //  중단발 댄디·울프 뒷목 — 목선을 감싸며 자연스럽게 안쪽으로 모인다
            taper = 1 + 0.02 * Math.sin(v * Math.PI) - 0.11 * v * v;
          } else taper = 1 + 0.04 * Math.sin(v * Math.PI) - 0.06 * v;
          x = sx * rr * HEAD_SX * taper;
          y = sy * rr * HEAD_SY - drop * v;
          z = sz * rr * HEAD_SZ * taper;
          const h = Math.hypot(sx, sz) || 1;
          nx = sx / h; ny = -0.25; nz = sz / h;   // 옆을 보는 면
        }
        pos.push(x, y, z);
        nor.push(flip ? -nx : nx, flip ? -ny : ny, flip ? -nz : nz);
        uv.push(ip / NP, 1 - u);
        /* 흔들림 가중치 — 두피에 붙은 데는 0, 끝으로 갈수록 1.
         * 머리카락을 통째로 돌리면 두피에서 미끄러진다. 뿌리는 붙들고
         * 끝만 흔들려야 머리카락처럼 보인다. 제곱으로 두어 중간보다
         * 끝이 훨씬 많이 움직이게 한다. */
        const w = u <= SPLIT ? 0 : Math.pow((u - SPLIT) / (1 - SPLIT), 1.4);
        sway.push(w * (drop > 1e-4 ? 1 : 0));
      }
    }
    for (let iu = 0; iu < NU; iu++) for (let ip = 0; ip < NP; ip++) {
      const i0 = base0 + iu * (NP + 1) + ip;
      const i1 = i0 + 1, i2 = i0 + NP + 1, i3 = i2 + 1;
      if (flip) idx.push(i0, i1, i2, i1, i3, i2);
      else idx.push(i0, i2, i1, i1, i2, i3);
    }
    return base0;
  };
  const o = sheet(rOut, false), i = sheet(rIn, true);
  // 밑단 — 겉과 속을 이어 자른 단면을 만든다
  const last = NU * (NP + 1);
  for (let ip = 0; ip < NP; ip++) {
    idx.push(o + last + ip, i + last + ip, o + last + ip + 1,
             o + last + ip + 1, i + last + ip, i + last + ip + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 흔들 때마다 되돌아갈 자리를 따로 간직한다
  g.userData.rest = Float32Array.from(g.attributes.position.array);
  return g;
}

/* ---- 끝이 가늘어지는 자연 머리카락 가닥 ------------------------------
 *  원뿔(Cone)이나 굵기가 일정한 관(Tube)을 머리에 얹으면 고깔이나 호스를
 *  붙여 놓은 것처럼 보인다. 뿌리는 머리 덮개 속에 묻혀 자연스럽게 이어지고,
 *  두상 곡면을 따라 납작하게 흐르다가 끝에서 날렵하게 모이는 가닥을 짠다. */
function headPt(th, phi, mul) {
  const rr = HEAD_R * headProf(th) * mul;
  return new THREE.Vector3(
    Math.sin(th) * Math.sin(phi) * rr * HEAD_SX,
    Math.cos(th) * rr * HEAD_SY,
    Math.sin(th) * Math.cos(phi) * rr * HEAD_SZ
  );
}

function taperedLock(pts, maxW, maxT) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const NS = 16, NC = 10;
  const pos = [], idx = [];
  const origin = new THREE.Vector3(0, 0.02, 0);
  const tmpN = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpP = new THREE.Vector3();

  for (let is = 0; is <= NS; is++) {
    const u = is / NS;
    const p = curve.getPoint(u);
    const tan = curve.getTangent(u).normalize();
    tmpN.copy(p).sub(origin);
    if (tmpN.lengthSq() < 1e-6) tmpN.set(0, 1, 0);
    tmpN.normalize();
    tmpN.addScaledVector(tan, -tmpN.dot(tan));
    if (tmpN.lengthSq() < 1e-6) tmpN.set(0, 0, 1);
    tmpN.normalize();
    tmpB.crossVectors(tan, tmpN).normalize();

    /* 동물의 숲 앞머리·옆머리 가닥 — 중간이 부풀어 소시지처럼 되지 않고
     * 뿌리에서 끝까지 매끈하고 앙증맞게 가늘어지는 단정한 실루엣. */
    const w = maxW * Math.pow(1 - u, 0.72);
    const t = maxT * Math.pow(1 - u, 0.85);

    for (let ic = 0; ic <= NC; ic++) {
      const a = (ic / NC) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      tmpP.copy(p).addScaledVector(tmpB, ca * w).addScaledVector(tmpN, sa * t);
      pos.push(tmpP.x, tmpP.y, tmpP.z);
    }
  }
  for (let is = 0; is < NS; is++) {
    for (let ic = 0; ic < NC; ic++) {
      const i0 = is * (NC + 1) + ic;
      const i1 = i0 + 1, i2 = i0 + NC + 1, i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---- 천 짜기 ---------------------------------------------------------
 *  옷의 차이는 소매 길이가 아니라 '무엇이 그려져 있나' 다. 단춧줄, 주머니,
 *  절개선, 시보리 — 전부 캔버스에 그려 몸통(캡슐)에 감는다.
 *
 *  ★ 보이는 자리에 그릴 것.
 *  몸통 천은 거의 다 가려진다. 위는 깃과 턱이, 아래는 치마·바지 허리가
 *  덮어서 **실제로 보이는 띠는 캔버스의 y 42~74%, x 28~72% 뿐이다**
 *  (test 의 uvmap 으로 실측). 처음엔 이걸 모르고 0~100% 에 고루 그려서
 *  요크도 시보리도 모자 끈도 전부 안 보이는 자리에 놓였었다.
 *  그래서 아래의 그림은 전부 '보이는 띠' 안의 비율(0~1, -1~1)로 적고
 *  ty()/tx() 가 캔버스 좌표로 옮긴다. 몸을 한 바퀴 두르는 것(요크,
 *  허리밴드, 시보리)만 가로로 꽉 채운다 — 등 뒤에서도 이어져야 한다.
 *
 *  그림은 지어내지 말고 실물 도면을 따랐다.
 *    청자켓 : Type III 트러커. 앞 요크, 여섯 단추 앞섶, 끝이 뾰족한
 *             플랩 주머니 둘, 그 옆을 타고 내려오는 V자 절개선, 밑단
 *             허리밴드. V자 절개선이 Type III 를 Type II 와 가르는
 *             표식이라, 없으면 그냥 '파란 자켓' 으로 보인다.
 *    후드티 : 양옆이 트인 캥거루 주머니, 모자 끈, 밑단 시보리.
 *    맨투맨 : 목 밑 V 삽입(브이거싯), 가슴 로고, 밑단 시보리.
 *    블라우스: 앞 단춧줄과 단추, 흩뿌린 꽃.
 *
 *  가로(u)가 몸통을 한 바퀴 돈다. 캡슐은 u 0 이 정면에서 시작하므로
 *  기하를 180° 돌려 그림을 앞가슴에, 이음새를 등 뒤로 보낸다.
 * ------------------------------------------------------------------ */
/* 캡슐의 v 는 '몇 번째 띠냐' 로 매겨진다. 둥근 뚜껑이 띠를 거의 다
 * 가져가는 탓에, 높이의 3분의 1을 차지하는 가운데 원통이 v 의 3% 만
 * 받는다. 그대로 천을 감으면 가슴에 그린 그림이 종잇장처럼 눌려 세로
 * 줄무늬가 되고, 고르게 찍은 단추가 위쪽에서만 뭉친다.
 * v 를 '높이에 비례' 로 다시 매겨 이 왜곡을 없앤다. */
function evenV(geo) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) - lo) / (hi - lo));
  uv.needsUpdate = true;
  return geo;
}

/* 몸통에서 실제로 눈에 보이는 천의 범위 — test/room3d 가 다시 잰다.
 * 위는 깃과 턱이, 아래는 치마·바지 허리가 덮는다. */
const SEEN = { y0: 0.258, y1: 0.890, xr: 0.222 };

function clothTexture(style, colorHex) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const hex = '#' + (colorHex >>> 0).toString(16).padStart(6, '0');
  const shade = (f) => {
    const r = Math.min(255, (colorHex >> 16 & 255) * f);
    const gg = Math.min(255, (colorHex >> 8 & 255) * f);
    const b = Math.min(255, (colorHex & 255) * f);
    return 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (b | 0) + ')';
  };
  g.fillStyle = hex;
  g.fillRect(0, 0, S, S);

  //  보이는 띠 안의 비율 → 캔버스 좌표
  const ty = (t) => (SEEN.y0 + (SEEN.y1 - SEEN.y0) * t) * S;   // t 0(가슴)~1(허리)
  const tx = (t) => (0.5 + t * SEEN.xr) * S;                   // t -1(왼)~1(오)
  const th = (a, b) => ty(b) - ty(a);                          // 띠 높이

  const line = (x1, y1, x2, y2, col, w) => {
    g.strokeStyle = col; g.lineWidth = w;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };
  //  몸을 한 바퀴 두르는 띠 — 가로로 꽉 채운다
  const band = (a, b, f) => { g.fillStyle = shade(f); g.fillRect(0, ty(a), S, th(a, b)); };
  const rib = (a, b, f) => {                 // 시보리 — 짙은 띠에 세로 골
    band(a, b, f);
    g.fillStyle = 'rgba(0,0,0,.09)';
    for (let x = 0; x < S; x += 5) g.fillRect(x, ty(a), 2, th(a, b));
  };

  if (style === 1) {
    /* 맨투맨 — 목 밑 V 삽입 · 가슴 로고 · 밑단 시보리 */
    g.fillStyle = shade(0.8);
    g.beginPath();
    g.moveTo(tx(-0.34), ty(0));
    g.lineTo(tx(0.34), ty(0));
    g.lineTo(tx(0), ty(0.2));
    g.closePath(); g.fill();

    g.fillStyle = 'rgba(255,255,255,.95)';     // 가슴 로고 (별)
    const R1 = S * 0.082, R2 = S * 0.034, sy = ty(0.48), sx = tx(0);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? R2 : R1;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      g[i ? 'lineTo' : 'moveTo'](sx + Math.cos(a) * r, sy + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    rib(0.85, 1, 0.7);

  } else if (style === 2) {
    /* 후드티 — 모자 끈 · 캥거루 주머니 · 밑단 시보리 */
    g.fillStyle = 'rgba(252,250,245,.98)';     // 끈 두 가닥
    g.fillRect(tx(-0.3), ty(0), S * 0.022, th(0, 0.3));
    g.fillRect(tx(0.25), ty(0), S * 0.022, th(0, 0.3));
    g.fillStyle = 'rgba(135,125,110,.95)';     // 끝에 꿴 쇠고리
    g.fillRect(tx(-0.31), ty(0.28), S * 0.03, th(0, 0.06));
    g.fillRect(tx(0.24), ty(0.28), S * 0.03, th(0, 0.06));

    g.fillStyle = shade(0.7);                  // 주머니 — 양옆이 트여 아래가 넓다
    g.beginPath();
    g.moveTo(tx(-0.62), ty(0.42));
    g.lineTo(tx(0.62), ty(0.42));
    g.lineTo(tx(0.78), ty(0.86));
    g.lineTo(tx(-0.78), ty(0.86));
    g.closePath(); g.fill();
    line(tx(-0.62), ty(0.42), tx(0.62), ty(0.42), shade(0.54), 2.4);
    line(tx(-0.62), ty(0.42), tx(-0.78), ty(0.86), shade(0.54), 2.2);
    line(tx(0.62), ty(0.42), tx(0.78), ty(0.86), shade(0.54), 2.2);
    g.fillStyle = shade(0.88);                 // 주머니 입구
    g.fillRect(tx(-0.62), ty(0.42), tx(0.62) - tx(-0.62), th(0, 0.06));
    rib(0.86, 1, 0.66);

  } else if (style === 3) {
    /* 빈티지 워싱 데님 자켓 (오픈 레이어드 + 실버 체인 목걸이) */
    const stitch = 'rgba(234,216,172,.88)';    // 노란 박음질 — 데님의 표식
    const seam = shade(0.62);

    //  빈티지 워싱 하이라이트 — 가슴과 절개선을 따라 자연스럽게 바랜 결
    const wash = g.createRadialGradient(tx(0), ty(0.38), S * 0.02, tx(0), ty(0.38), S * 0.24);
    wash.addColorStop(0, 'rgba(170,192,224,.22)');
    wash.addColorStop(1, 'rgba(170,192,224,0)');
    g.fillStyle = wash;
    g.fillRect(0, ty(0.05), S, th(0.05, 0.85));

    band(0, 0.16, 1.12);                       // 앞 요크 — 몸을 두른다
    line(0, ty(0.16), S, ty(0.16), seam, 2.4);
    line(0, ty(0.185), S, ty(0.185), stitch, 1.2);

    //  V자 절개선 — 요크에서 허리밴드로. Type III 의 표식
    for (let sg = -1; sg <= 1; sg += 2) {
      line(tx(sg * 0.44), ty(0.16), tx(sg * 0.74), ty(0.86), seam, 2.2);
      line(tx(sg * 0.49), ty(0.16), tx(sg * 0.79), ty(0.86), stitch, 1);
    }

    //  가슴 주머니 둘 — 끝이 뾰족한 플랩이 요크 밑에서 나온다
    for (let sg = -1; sg <= 1; sg += 2) {
      const px = tx(sg * 0.58), w = S * 0.05;
      g.fillStyle = shade(0.9);
      g.fillRect(px - w, ty(0.16), w * 2, th(0.16, 0.54));
      g.fillStyle = shade(1.08);               // 플랩
      g.beginPath();
      g.moveTo(px - w, ty(0.16));
      g.lineTo(px + w, ty(0.16));
      g.lineTo(px + w, ty(0.35));
      g.lineTo(px, ty(0.46));                  // 뾰족한 끝
      g.lineTo(px - w, ty(0.35));
      g.closePath(); g.fill();
      g.strokeStyle = stitch; g.lineWidth = 1.1; g.stroke();
      g.fillStyle = 'rgba(232,236,242,.95)';   // 실버 플랩 단추
      g.beginPath(); g.arc(px, ty(0.35), S * 0.011, 0, 6.2832); g.fill();
    }

    //  오픈 앞섶 안쪽 — 화이트 레이어드 티 + 실버 팬던트 목걸이
    g.fillStyle = '#f4f1ec';
    g.fillRect(tx(-0.18), ty(0), tx(0.18) - tx(-0.18), th(0, 0.94));
    //  자켓 여밈 경계선 + 실버 단추
    for (let sg = -1; sg <= 1; sg += 2) {
      line(tx(sg * 0.2), ty(0), tx(sg * 0.2), ty(0.92), seam, 2.4);
      line(tx(sg * 0.24), ty(0), tx(sg * 0.24), ty(0.86), stitch, 1);
    }
    g.fillStyle = 'rgba(224,230,238,.96)';
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.arc(tx(0.28), ty(0.14 + i * 0.2), S * 0.013, 0, 6.2832); g.fill();
    }
    //  실버 체인 목걸이 & 바 팬던트
    g.strokeStyle = '#c8d2de';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(tx(-0.14), ty(0.02));
    g.quadraticCurveTo(tx(0), ty(0.34), tx(0.14), ty(0.02));
    g.stroke();
    g.fillStyle = '#e4ebf4';
    g.fillRect(tx(-0.022), ty(0.22), tx(0.022) - tx(-0.022), th(0.22, 0.34));

    band(0.86, 1, 0.85);                       // 밑단 허리밴드
    line(0, ty(0.86), S, ty(0.86), seam, 2.2);
    line(0, ty(0.885), S, ty(0.885), stitch, 1.1);

  } else if (style === 4) {
    /* 블라우스 — 앞 단춧줄 · 흩뿌린 다섯잎 꽃 */
    for (let i = 0; i < 16; i++) {
      const fx = ((i * 61 + 13) % 100) / 100 * S;
      const fy = ty(((i * 37) % 95) / 100);
      const fr = S * 0.023;
      g.fillStyle = 'rgba(255,253,248,.96)';
      for (let k = 0; k < 5; k++) {
        const a = k * 1.2566;
        g.beginPath();
        g.ellipse(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, fr * 0.85, fr * 0.6, a, 0, 6.2832);
        g.fill();
      }
      g.fillStyle = '#edc45e';
      g.beginPath(); g.arc(fx, fy, fr * 0.46, 0, 6.2832); g.fill();
    }
    g.fillStyle = shade(1.07);                 // 앞 단춧줄
    g.fillRect(tx(-0.11), 0, tx(0.11) - tx(-0.11), S);
    g.fillStyle = 'rgba(255,255,255,.92)';
    for (let i = 0; i < 5; i++) {
      g.beginPath(); g.arc(tx(0), ty(0.08 + i * 0.21), S * 0.013, 0, 6.2832); g.fill();
    }
  } else if (style === 6) {
    /* 고양이 티 — 가슴 한가운데 고양이 얼굴, 허리께 양옆에 발자국.
     * 얼굴은 선으로만 그린다 — 칠해 넣으면 멀리서 얼룩이 된다. */
    const ink = '#4a3a30';
    const cx = tx(0), cyf = ty(0.42), r = S * 0.1;
    g.strokeStyle = ink;
    g.lineWidth = S * 0.014;
    //  얼굴 — 아래가 통통한 원
    g.beginPath(); g.ellipse(cx, cyf, r, r * 0.88, 0, 0, 6.2832); g.stroke();
    //  귀 — 세모 둘
    for (const sg of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sg * r * 0.38, cyf - r * 0.76);
      g.lineTo(cx + sg * r * 0.82, cyf - r * 1.28);
      g.lineTo(cx + sg * r * 0.95, cyf - r * 0.5);
      g.stroke();
    }
    //  자는 눈 · 분홍 코 · w 입
    g.lineWidth = S * 0.012;
    for (const sg of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sg * r * 0.52, cyf - r * 0.12);
      g.quadraticCurveTo(cx + sg * r * 0.32, cyf + r * 0.06, cx + sg * r * 0.12, cyf - r * 0.12);
      g.stroke();
    }
    g.fillStyle = '#d98a7e';
    g.beginPath();
    g.moveTo(cx - r * 0.1, cyf + r * 0.2);
    g.lineTo(cx + r * 0.1, cyf + r * 0.2);
    g.lineTo(cx, cyf + r * 0.34);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(cx - r * 0.22, cyf + r * 0.52);
    g.quadraticCurveTo(cx - r * 0.11, cyf + r * 0.64, cx, cyf + r * 0.5);
    g.quadraticCurveTo(cx + r * 0.11, cyf + r * 0.64, cx + r * 0.22, cyf + r * 0.52);
    g.stroke();
    //  수염 — 양옆 세 가닥
    g.lineWidth = S * 0.009;
    for (const sg of [-1, 1]) for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(cx + sg * r * 1.06, cyf + k * r * 0.17);
      g.lineTo(cx + sg * r * 1.5, cyf + k * r * 0.26);
      g.stroke();
    }
    //  발자국 — 허리께 양옆
    g.fillStyle = 'rgba(74,58,48,.55)';
    for (const sg of [-1, 1]) {
      const px = tx(sg * 0.6), py = ty(0.78), pr = S * 0.016;
      g.beginPath(); g.ellipse(px, py + pr, pr * 1.3, pr, 0, 0, 6.2832); g.fill();
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(px + (k - 1) * pr * 1.3, py - pr * 0.9 - (k === 1 ? pr * 0.4 : 0), pr * 0.55, 0, 6.2832);
        g.fill();
      }
    }
  } else if (style === 7) {
    /* 코지 바시티/스트릿 블루종 — 스카이블루 몸판 + 크림 스트라이프 + 귀여운 구름 와펜 */
    line(0, ty(0.18), S, ty(0.18), 'rgba(255,255,255,.16)', 1.6);
    //  살짝 열린 상단 안쪽 — 크림 레이어드 이너 티
    g.fillStyle = '#faf7f0';
    g.beginPath();
    g.moveTo(tx(-0.22), ty(0));
    g.lineTo(tx(0.22), ty(0));
    g.lineTo(tx(0), ty(0.26));
    g.closePath(); g.fill();
    //  중앙 스냅 버튼 줄 (동물의 숲 감성의 아기자기한 단추)
    g.fillStyle = shade(0.86);
    g.fillRect(tx(-0.08), ty(0.22), tx(0.08) - tx(-0.08), th(0.22, 0.84));
    g.fillStyle = '#faf7f0';
    for (let k = 0; k < 4; k++) {
      g.beginPath(); g.arc(tx(0), ty(0.3 + k * 0.15), S * 0.016, 0, 6.2832); g.fill();
    }
    //  오른쪽 가슴 귀여운 작은 구름 와펜
    g.fillStyle = '#fffdf8';
    const cx = tx(0.46), cy = ty(0.36), r = S * 0.028;
    g.beginPath();
    g.arc(cx - r * 0.7, cy + r * 0.15, r * 0.72, 0, 6.2832);
    g.arc(cx, cy - r * 0.15, r * 0.92, 0, 6.2832);
    g.arc(cx + r * 0.75, cy + r * 0.15, r * 0.72, 0, 6.2832);
    g.fill();
    //  귀여운 사선 포켓 둘 + 크림 웰트 트림
    for (let sg = -1; sg <= 1; sg += 2) {
      line(tx(sg * 0.34), ty(0.56), tx(sg * 0.68), ty(0.75), '#f7f3ea', 3.0);
    }
    //  밑단 크림 스트라이프 시보리
    rib(0.84, 1, 0.78);
    g.fillStyle = '#faf7f0';
    g.fillRect(0, ty(0.89), S, th(0.89, 0.94));
  } else if (style === 8) {
    /* 유카타 상의 — 따뜻한 크림 바탕에 연두·초록 & 로즈핑크 나팔꽃/바람개비 문양,
     * Y자 교차 기모노 깃(우임), 허리를 감싸는 선명한 로즈핑크 오비. */
    const flowers = [
      [0.12, 0.28, 0.088, true], [0.30, 0.50, 0.094, false],
      [0.50, 0.22, 0.082, false], [0.70, 0.48, 0.092, true],
      [0.88, 0.28, 0.088, false], [0.52, 0.56, 0.076, false]
    ];
    for (const [fx, fy, fr, isPink] of flowers) {
      drawYukataFlower(g, fx * S, ty(fy), fr * S, isPink);
    }
    //  Y자 교차 기모노 깃 (흰 속깃 + 크림 겉깃, 오른쪽 위에서 왼쪽 아래로 겹침)
    g.lineCap = 'round';
    line(tx(0.56), ty(0.02), tx(-0.18), ty(0.68), '#fffdf8', S * 0.044);
    line(tx(0.56), ty(0.02), tx(-0.18), ty(0.68), '#d9cca9', S * 0.012);
    line(tx(-0.56), ty(0.02), tx(0.18), ty(0.68), '#fffdf8', S * 0.048);
    line(tx(-0.56), ty(0.02), tx(0.18), ty(0.68), '#f4efd4', S * 0.030);
    line(tx(-0.56), ty(0.02), tx(0.18), ty(0.68), '#d2c39d', S * 0.010);
    //  허리 상단 — 선명한 로즈핑크 오비 띠
    g.fillStyle = '#df5a8f';
    g.fillRect(0, ty(0.68), S, th(0.68, 1));
    line(0, ty(0.68), S, ty(0.68), '#b93f72', 2.4);
    g.fillStyle = '#f5acc8';
    g.fillRect(0, ty(0.82), S, th(0.82, 0.88));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 유카타 나팔꽃(아사가오) · 바람개비 원형 문양 — 상의 · 소매 · 롱 치마 공용 */
function drawYukataFlower(g, cx, cy, r, isPink) {
  //  바깥 꽃잎 원 (로즈핑크 또는 싱그러운 연두/초록)
  g.fillStyle = isPink ? '#e77ca6' : '#83bc54';
  g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
  //  안쪽 밝은 링
  g.fillStyle = isPink ? '#f3adc8' : '#b2da7a';
  g.beginPath(); g.arc(cx, cy, r * 0.72, 0, 6.2832); g.fill();
  //  가운데 방사형 크림 별/바람개비 결 (5방향)
  g.fillStyle = '#f6f2dc';
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566 - 0.3;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * r * 0.44, cy + Math.sin(a) * r * 0.44, r * 0.42, r * 0.14, a, 0, 6.2832);
    g.fill();
  }
  //  중앙 작은 둥근 꽃술
  g.fillStyle = isPink ? '#df5a8f' : '#639b3d';
  g.beginPath(); g.arc(cx, cy, r * 0.16, 0, 6.2832); g.fill();
}

/* 유카타 롱 치마 천 — 위쪽 로즈핑크 오비 + 아래쪽 크림 바탕 초록·핑크 나팔꽃 반복 */
function yukataSkirtTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efd4';
  g.fillRect(0, 0, S, S);
  //  상단 오비 띠 (허리를 넓고 또렷하게 감싸는 로즈핑크)
  g.fillStyle = '#df5a8f';
  g.fillRect(0, 0, S, S * 0.25);
  g.fillStyle = '#f5acc8';
  g.fillRect(0, S * 0.11, S, S * 0.032);
  g.fillStyle = '#b93f72';
  g.fillRect(0, S * 0.238, S, S * 0.016);
  //  큼직하고 아기자기한 초록 · 핑크 나팔꽃 원형 문양 (둘레 3단 교차)
  const rows = [
    [0.38, [[0.08, true], [0.33, false], [0.58, true], [0.83, false]], 0.095],
    [0.61, [[0.20, false], [0.46, true], [0.71, false], [0.95, true]], 0.098],
    [0.82, [[0.09, false], [0.35, true], [0.60, false], [0.86, true]], 0.090]
  ];
  for (const [ry, cols, rr] of rows) {
    for (const [rx, isPink] of cols) {
      drawYukataFlower(g, rx * S, ry * S, rr * S, isPink);
      if (rx > 0.88) drawYukataFlower(g, (rx - 1) * S, ry * S, rr * S, isPink);
      if (rx < 0.12) drawYukataFlower(g, (rx + 1) * S, ry * S, rr * S, isPink);
    }
  }
  //  꽃 사이 작은 연두 잎사귀 포인트
  g.fillStyle = '#97ca66';
  for (const [lx, ly] of [[0.21, 0.46], [0.47, 0.34], [0.72, 0.48], [0.34, 0.72], [0.84, 0.68]]) {
    g.beginPath(); g.ellipse(lx * S, ly * S, S * 0.028, S * 0.014, 0.6, 0, 6.2832); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* 유카타 짧은 기모노 소매 천 — 상의·치마와 같은 크림 바탕 초록·핑크 나팔꽃 */
function yukataSleeveTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efd4';
  g.fillRect(0, 0, S, S);
  const items = [
    [0.18, 0.38, 0.13, true], [0.52, 0.36, 0.13, false], [0.86, 0.40, 0.12, true],
    [0.34, 0.70, 0.13, false], [0.70, 0.72, 0.13, true], [0.04, 0.72, 0.12, false]
  ];
  for (const [fx, fy, fr, isPink] of items) {
    drawYukataFlower(g, fx * S, fy * S, fr * S, isPink);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/* 동물의 숲 스타일 보드라운 머리카락 질감 — 흰색 기준 명암·광택 맵.
 * 재질의 color(hairHex)와 곱해져 머리카락 색을 유지하면서도
 * 세로 머릿결, 정수리 둘레의 은은한 엔젤링 광택, 앞머리 끝 음영을 입체적으로 살린다. */
function hairStrandTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  //  부드러운 세로 명암 그라데이션 (정수리 밝고, 끝으로 갈수록 살짝 차분)
  const bg = g.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#eee6ea');
  bg.addColorStop(0.26, '#ffffff');
  bg.addColorStop(0.58, '#f4eaee');
  bg.addColorStop(1, '#dfd1d7');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  //  촘촘한 세로 머릿결 스트랜드 (전체 높이로 그려 부드러운 빗결 형성)
  for (let i = 0; i < 64; i++) {
    const x = (i / 64) * S;
    const w = 1.5 + ((i * 19) % 4);
    const bright = (i * 13) % 3 === 0;
    g.fillStyle = bright ? 'rgba(255,255,255,.26)' : 'rgba(130,90,108,.12)';
    g.fillRect(x, 0, w, S);
  }
  //  정수리~이마 위쪽 모동숲 특유의 부드러운 엔젤링(물결 광택 띠)
  const halo = g.createLinearGradient(0, S * 0.22, 0, S * 0.44);
  halo.addColorStop(0, 'rgba(255,255,255,0)');
  halo.addColorStop(0.45, 'rgba(255,255,255,.42)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, S * 0.22, S, S * 0.22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(3, 1);
  return t;
}

/* 치마에 감는 체크 — 타탄에 나이프 주름을 얹는다.
 *  주름은 전부 한 방향으로 접혀 겹치므로, 접힌 자리마다 '어두운 골 +
 *  밝은 마루' 가 한 쌍으로 선다. 이 음영이 없으면 격자무늬를 두른
 *  원뿔일 뿐 치마로 안 보인다.
 *  치마는 돌림판이라 천이 고루 보인다 — 몸통과 달리 띠 보정이 필요 없다. */
function plaidTexture(colorHex) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#' + (colorHex >>> 0).toString(16).padStart(6, '0');
  g.fillRect(0, 0, S, S);

  //  타탄 — 굵은 흰 줄, 가는 검은 줄
  g.fillStyle = 'rgba(255,255,255,.2)';
  for (let i = 0; i < 6; i++) { g.fillRect(i * S / 6, 0, S * 0.055, S); g.fillRect(0, i * S / 6, S, S * 0.055); }
  g.fillStyle = 'rgba(0,0,0,.15)';
  for (let i = 0; i < 6; i++) { g.fillRect(i * S / 6 + S * 0.085, 0, S * 0.022, S); g.fillRect(0, i * S / 6 + S * 0.085, S, S * 0.022); }

  /* 나이프 주름 — 한 폭마다 '접혀 들어간 골 · 평평한 면 · 돌아 나오는
   * 마루' 세 단. 그라데이션 대신 단으로 끊는 건 셀 셰이딩과 결이 맞기도
   * 하거니와, 그라데이션은 눈으로 검사할 길이 없기 때문이다. */
  const PL = S / 8;
  for (let i = 0; i < 8; i++) {
    const x = i * PL;
    g.fillStyle = 'rgba(0,0,0,.3)';            // 골 — 접혀 가려진 자리
    g.fillRect(x, 0, PL * 0.16, S);
    g.fillStyle = 'rgba(0,0,0,.13)';           // 골에서 빠져나오는 비탈
    g.fillRect(x + PL * 0.16, 0, PL * 0.14, S);
    g.fillStyle = 'rgba(255,255,255,.15)';     // 마루 — 빛을 받는 모서리
    g.fillRect(x + PL * 0.86, 0, PL * 0.14, S);
  }
  //  허리밴드 — 주름을 눌러 박은 자리
  g.fillStyle = 'rgba(0,0,0,.12)';
  g.fillRect(0, 0, S, S * 0.1);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

/* 무늬 있는 천도 사람처럼 제 색을 절반쯤 낸다 */
function flatCloth(tex) {
  return new THREE.MeshToonMaterial({
    map: tex, gradientMap: RAMP_FLAT,
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5
  });
}

/* ---- 몸 치수 -------------------------------------------------------
 *  키 1.65m, 머리가 40%. 몸통은 윗옷 + A라인 치마 — 캡슐 두 개를
 *  포개는 것보다 실루엣이 훨씬 또렷하다.
 * ------------------------------------------------------------------ */
const HEAD_R = 0.31;
/* 두상 눌림 — 가로 · 세로 · 앞뒤. 머리통(headShape)과 머리카락(longHair),
 * 귀가 전부 이걸 쓴다 — 한쪽만 바꾸면 볼이 옆머리를 뚫는다.
 * 세로(0.90)를 살짝 눌러 동그라미 공이 아니라 모동숲 특유의
 * 위아래로 살짝 찌그러지고 볼이 통통한 찹쌀떡 실루엣을 만든다. */
const HEAD_SX = 0.96, HEAD_SY = 0.90, HEAD_SZ = 0.92;
/* 키를 낮출 때는 HEAD_Y 만 내리면 안 된다 — 몸통·깃·어깨·골반·치마가
 * 전부 절대 높이로 박혀 있어서 같이 내려야 한다. 아래에서 그 사슬이
 * 이어진다: 엉덩이 0.37 → 무릎 → 발바닥 0 이 바닥이다. */
const HEAD_Y = 0.955;
const FACE_PHI = Math.PI * 0.46;
const FACE_THETA = Math.PI * 0.40;
const FACE_TOP = Math.PI * 0.38;


/* ---- 부품 ----------------------------------------------------------
 *  아래 아홉 캐릭터를 짜 맞추는 재료다. 고르는 창이 아니다 — 손님이
 *  고르는 건 '몇 번 캐릭터' 하나뿐이고, 눈·머리·옷은 그 캐릭터가
 *  이미 정해 두었다. 그래서 여기를 늘려도 저절로 고를 수 있게 되지
 *  않는다. 새 옷을 보여 주고 싶으면 그 옷을 입은 캐릭터를 CHARACTERS
 *  끝에 덧붙여야 한다.
 * ------------------------------------------------------------------ */
export const PARTS = {
  eyes: 7,                                     // faceTexture 의 눈매·화장 가짓수
  hairs: ['긴 생머리', '단발', '올림머리', '리프컷', '양갈래', '반묶음', '더벅머리'],
  topStyles: ['티셔츠', '맨투맨', '후드티', '청자켓', '블라우스', '민소매', '고양이 티', '스트릿 자켓', '유카타'],
  bottomStyles: ['치마', '체크치마', '바지', '청바지', '반바지', '카고바지', '유카타 치마'],
  //  마지막 세 색 — 슬레이트블루(바다) · 샴페인 블론드(구름) · 스트로베리 로즈 핑크(단추)
  hairColors: [0x2b2a33, 0x4a3327, 0x8a5a2b, 0xb98a55, 0x6b4a6e, 0xc492a8, 0x3a475e, 0xe8cf9a, 0xf28ba6],
  skins: [0xffd8a9, 0xffe6c8, 0xf0be8a, 0xd99e6a, 0xa9754c],
  /* 옷마다 제 색이 박혀 있다 — 포근하고 아기자기한 동물의 숲 색감.
   * 순서는 topStyles / bottomStyles 와 한 몸이니 같이 움직일 것. */
  tops: [0xff6b5c, 0x3b4a6b, 0x7fc8b8, 0x6b92c4, 0xf2bcc8, 0xf2f2f2, 0xf2e3c8, 0x5c7ec2, 0xf4efd4],
  //      티셔츠      맨투맨      후드티(민트) 워싱청자켓   블라우스    민소매     고양이 티    스카이블루종  유카타
  bottoms: [0xd98a9e, 0x8a7a68, 0xc9b48f, 0x46597e, 0x8fb8e0, 0x768765, 0xf4efd4],
  //        치마       체크치마    바지(치노)  청바지      반바지     올리브카고  유카타 치마
  shoes: [0x4a4038, 0xf4f1ea, 0xc0392b, 0x3f8ecc, 0x6fbf8f, 0xe0a92c]
};

/* ---- 아홉 캐릭터 ----------------------------------------------------
 *  고르는 창이 3행 3열로 늘어놓는 그대로다. 손님이 고르는 것도, 서버가
 *  중계하는 것도 '몇 번' 하나뿐이다.
 *
 *  **순서를 바꾸면 이미 고른 사람이 전부 딴 사람이 된다** — 그 번호가
 *  이 브라우저에도 남아 있고 지금 방에 선 사람들에게도 가 있다.
 *  덧붙이는 건 되지만 끼워 넣거나 빼지 말 것.
 *
 *      look = [눈, 머리모양, 피부, (옛 상의색), (옛 하의색), 신발,
 *              머리색, 상의, 하의]
 *
 *  3·4번은 색을 따로 고르던 시절의 자리다. 지금은 옷이 제 색을 들고
 *  있어 읽지 않지만, 칸을 빼면 뒤의 번호가 한 칸씩 밀려 아홉이 전부
 *  엉뚱한 차림이 된다 — 자리만 남겨 둔다.
 *
 *  아홉이 한눈에 갈리도록 상의·하의·머리·눈매를 빠짐없이 돌려 쓰고,
 *  같은 (상의, 하의) 짝은 두 번 쓰지 않는다. 작은 사진 아홉 장으로
 *  고르는 자리라 비슷한 둘이 끼면 고를 이유가 사라진다.
 * ------------------------------------------------------------------ */
/*  hat   정수리에 얹는 것 — cap(야구모자) · beret(베레모) · straw(밀짚모자) · bow(리본) · band(머리띠) · cat(고양이 머리띠) · headphones(오버이어 헤드폰)
 *  specs 코에 걸치는 것 — round(둥근 테) · thick(뿔테) · shade(선글라스) · slim(긱시크 슬림 오벌)
 *  묶음이 위로 솟는 머리(올림머리)에는 모자를 씌우지 말 것 — 묶음을 뚫는다. */
export const CHARACTERS = [
  { name: '보리', look: [5, 1, 0, 0, 0, 1, 0, 6, 3], hat: ['cat', 0xe39a4a] },          // 고양이 눈 · 중단발 · 고양이 티 · 치즈냥이 머리띠
  { name: '하루', look: [1, 0, 1, 0, 0, 2, 1, 4, 0], hat: ['bow', 0xd04a4a] },          // 긴 생머리 · 블라우스 · 빨간 리본
  { name: '단추', look: [4, 2, 1, 0, 0, 1, 8, 8, 6], hairpin: 'flower' },               // 핑크 올림머리+풀뱅 · 흰 꽃 비녀 · 크림 나팔꽃 유카타 · 로즈핑크 오비
  { name: '노을', look: [3, 4, 0, 0, 0, 5, 4, 1, 0], hat: ['beret', 0xd9a441] },        // 양갈래 · 맨투맨 · 겨자 베레모
  { name: '바다', look: [0, 3, 1, 0, 0, 1, 6, 3, 5], specs: ['slim', 0xcfd6e2] },       // 남 · 슬레이트블루 리프컷 · 빈티지 청자켓 · 올리브 카고 · 슬림 안경
  { name: '구름', look: [6, 5, 0, 0, 0, 3, 7, 7, 3] },                                  // 남 · 금발 하이 반묶음+긴 커튼 앞머리 · 스카이 바시티 블루종 · 진청 · 파랑 스니커즈
  { name: '가람', look: [1, 0, 4, 0, 0, 2, 0, 5, 4], hat: ['cap', 0xc0392b] },          // 긴 생머리 · 민소매 · 하늘 반바지 · 빨간 캡
  { name: '소라', look: [2, 4, 0, 0, 0, 2, 3, 0, 1], hat: ['straw', 0xd9b36a] },        // 양갈래 · 티셔츠 · 체크치마 · 밀짚모자
  { name: '담이', look: [3, 6, 1, 0, 0, 3, 1, 2, 2], hat: ['band', 0xf2d16b] }          // 남 · 밤색 더벅머리 · 민트 후드티 · 치노 · 머리띠
];

/* 밖에서 온 번호는 늘 이걸 거친다.
 *  서버는 뜻을 모른 채 숫자만 중계하므로 범위를 접는 건 전적으로
 *  이쪽 몫이다. 모르는 번호(내 쪽보다 캐릭터가 많은 판에서 온 것)는
 *  0번으로 눌러 버리지 않고 null 로 돌려, 이름이 정해 준 캐릭터로
 *  서게 한다 — 안 그러면 새 캐릭터를 고른 사람들이 한 명도 빠짐없이
 *  같은 0번으로 겹쳐 보인다. */
export function sanitizeChar(v) {
  /* 안 고른 사람은 서버에서 null 로, 저장소에서도 null 로 온다.
   * Number(null) 은 0 이라 그냥 넘기면 안 고른 사람이 한 명도 빠짐없이
   * 0번으로 굳는다 — 방에 들어가면 똑같은 얼굴이 줄줄이 선다. */
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  const i = n | 0;
  return (i < 0 || i >= CHARACTERS.length) ? null : i;
}

/* 아직 안 고른 사람 — 이름에서 뽑아 늘 같은 캐릭터로 세운다.
 * 들어오자마자 아홉이 다 0번으로 서 있으면 누가 누군지 알 수 없다. */
export function charOf(seed) {
  let h = 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % CHARACTERS.length;
}

/* 동물의 숲 풍의 보드랍고 포근한 3D 인형 셰이딩.
 *  너무 납작하면 2D 종이처럼 보이고, 너무 어두우면 어둑한 극장에서
 *  피부가 탁해진다. 5단 부드러운 띠(0.64~1.0)에 따뜻한 자체 발광(0.34)을
 *  섞어 볼·손·옷의 동글동글한 입체감을 포근하게 살린다. */
const RAMP_FLAT = ramp(5, 0.64);
const RAMP_HAIR = ramp(5, 0.56);
const flat = (c) => new THREE.MeshToonMaterial({
  color: c, gradientMap: RAMP_FLAT,
  emissive: c, emissiveIntensity: 0.34
});

function joint(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

export function makeAvatar(opts) {
  /* 누구인가 — 고른 번호가 있으면 그 캐릭터, 없으면 이름이 정해 준 것.
   * 0번이 거짓값이라 || 로 고르면 보리가 영영 안 나온다. */
  const picked = sanitizeChar(opts.char);
  const who = CHARACTERS[picked === null ? charOf(opts.seed) : picked];
  const look = who.look;
  const W = PARTS;
  /* 색은 고르는 게 아니라 옷이 정한다 — look[3]·[4] 는 옛 색 칸인데
   * 자리만 남겨 두고 읽지 않는다 (배열 모양을 바꾸면 저장된 모습이 어긋난다) */
  const topStyle = look[7] || 0;
  const bottomStyle = look[8] || 0;
  const main = flat(W.tops[topStyle]);         // 상의 — 그 옷의 색
  const dark = flat(W.bottoms[bottomStyle]);   // 하의 — 그 옷의 색
  const hairHex = W.hairColors[look[6] || 0];
  const extraMats = [];
  const extraTexs = [];
  let hairMat;
  if (look[1] === 2) {
    /* 올림머리(단추) — 세로 머릿결 + 엔젤링 광택 텍스처에 부드러운 PBR 질감을 얹어
     * 플라스틱 공이 아닌 동물의 숲 특유의 포근하고 실키한 머리카락 질감을 만든다. */
    const hTex = hairStrandTexture();
    extraTexs.push(hTex);
    hairMat = new THREE.MeshStandardMaterial({
      color: hairHex, map: hTex,
      roughness: 0.56, metalness: 0.04,
      emissive: hairHex, emissiveMap: hTex, emissiveIntensity: 0.24
    });
  } else {
    hairMat = flat(hairHex);
  }
  const skin = flat(W.skins[look[2]]);
  /* 청바지 밑단처럼 '같은 색의 밝은 판' 이 필요할 때 */
  const lightDark = flat((() => {
    const c = W.bottoms[bottomStyle];
    const up = (v) => Math.min(255, ((v) | 0) + 52);
    return (up(c >> 16 & 255) << 16) | (up(c >> 8 & 255) << 8) | up(c & 255);
  })());
  const shoe = flat(W.shoes[look[5]]);
  const white = flat(0xf7f3ec);

  let seedNum = 0;
  const sstr = String(opts.seed);
  for (let i = 0; i < sstr.length; i++) seedNum = (seedNum * 31 + sstr.charCodeAt(i)) | 0;
  const faceOpen = faceTexture(look[0], false, hairHex);
  const faceShut = faceTexture(look[0], true, hairHex);
  const faceMat = new THREE.MeshToonMaterial({
    map: faceOpen, emissive: 0xffffff, emissiveMap: faceOpen, emissiveIntensity: 0.3,
    gradientMap: RAMP_FLAT, transparent: true, depthWrite: false
  });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  /* 하의 — 실루엣과 무늬가 갈린다.
   *   0 치마        A라인 돌림판, 민무늬
   *   1 체크치마    같은 돌림판에 체크 천
   *   2 바지        다리 전체가 하의 색
   *   3 청바지      바지 + 밝게 접어 올린 밑단
   *   4 반바지      허벅지만 하의 색
   *   5 카고바지    와이드 카고 + 옆 주머니
   *   6 유카타 치마 허리에서 발목까지 좁게 떨어지는 롱 유카타 + 3D 로즈핑크 오비 & 등 뒤 리본 */
  const YUKATA_SKIRT = bottomStyle === 6;
  const SKIRTED = bottomStyle <= 1 || YUKATA_SKIRT;
  if (SKIRTED) {
    const skirtPts = [];
    if (YUKATA_SKIRT) {
      //  허리(0.50)에서 발목 바로 위(0.055)까지 거의 일자로 떨어지는 좁은 롱 유카타 실루엣
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const bulge = 0.022 * Math.sin(t * Math.PI);
        const r = 0.172 + bulge - 0.004 * t;
        skirtPts.push(new THREE.Vector2(r, 0.50 - 0.445 * t));
      }
    } else {
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        skirtPts.push(new THREE.Vector2(
          0.17 + 0.13 * Math.pow(t, 1.2),        // 반지름 — 허리 0.17, 밑단 0.30
          0.50 - 0.28 * t                         // 높이 0.50(하이웨스트) → 0.22 (무릎 위)
        ));
      }
    }
    let skirtMat = dark;
    if (bottomStyle === 1) {
      const pTex = plaidTexture(W.bottoms[1]);
      extraTexs.push(pTex);
      skirtMat = flatCloth(pTex);
      extraMats.push(skirtMat);
    } else if (YUKATA_SKIRT) {
      const yTex = yukataSkirtTexture();
      extraTexs.push(yTex);
      skirtMat = flatCloth(yTex);
      extraMats.push(skirtMat);
    }
    const skirt = new THREE.Mesh(new THREE.LatheGeometry(skirtPts, 40), skirtMat);
    body.add(skirt);
    body.add(outlineOf(skirt, YUKATA_SKIRT ? 0.032 : 0.04)); // 밑단의 어두운 테

    if (YUKATA_SKIRT) {
      /* 3D 로즈핑크 오비 띠 + 등 뒤 3D 오비 리본 매듭.
       * 유카타 허리선을 입체적으로 감싸 사진 속 또렷한 분홍 허리띠를 살린다. */
      const obiMat = flat(0xdf5a8f);
      const obiCordMat = flat(0xf5acc8);
      extraMats.push(obiMat, obiCordMat);
      const obiPts = [
        new THREE.Vector2(0.181, 0.495),
        new THREE.Vector2(0.194, 0.475),
        new THREE.Vector2(0.198, 0.440),
        new THREE.Vector2(0.195, 0.402),
        new THREE.Vector2(0.184, 0.390)
      ];
      const obiBand = new THREE.Mesh(new THREE.LatheGeometry(obiPts, 36), obiMat);
      body.add(obiBand);
      //  오비 가운데를 감는 옅은 핑크 오비지메 끈
      const cord = new THREE.Mesh(new THREE.TorusGeometry(0.198, 0.008, 8, 32), obiCordMat);
      cord.rotation.x = Math.PI / 2;
      cord.position.y = 0.442;
      body.add(cord);
      //  등 뒤(-z) 3D 로즈핑크 오비 리본 매듭
      const obiBow = new THREE.Group();
      obiBow.position.set(0, 0.435, -0.198);
      const bKnot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), obiMat);
      bKnot.scale.set(1.05, 0.88, 0.72);
      obiBow.add(bKnot);
      for (const sgn of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.SphereGeometry(0.064, 16, 12), obiMat);
        wing.scale.set(1.15, 0.76, 0.46);
        wing.position.set(sgn * 0.064, 0.016, -0.012);
        wing.rotation.z = sgn * 0.24;
        wing.rotation.y = sgn * -0.18;
        obiBow.add(wing);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.115, 0.016), obiMat);
        tail.position.set(sgn * 0.036, -0.068, -0.008);
        tail.rotation.z = sgn * 0.22;
        obiBow.add(tail);
      }
      body.add(obiBow);
    }
  }
  if (!SKIRTED) {
    /* 치마가 없으면 골반이 비어 몸통과 다리가 떨어져 보인다 —
     * 바지 엉덩이로 그 사이를 메운다 */
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.1, 12, 30), dark);
    pelvis.position.y = 0.27;
    pelvis.scale.set(0.94, 1, 0.86);
    body.add(pelvis);
  }
  //  다리 색 — 바지·청바지·카고바지면 발목까지, 반바지면 허벅지만 하의 색
  const thighMat = SKIRTED ? skin : dark;
  const shinMat = (bottomStyle === 2 || bottomStyle === 3 || bottomStyle === 5) ? dark : skin;

  /* 윗옷 — 무늬를 그린 천을 몸통에 감는다. 기하를 180° 돌려 두는 건
   *  그림(u 0.5)이 앞가슴에 오고 이음새가 등 뒤로 가게 하려는 것이다.
   *  돌림을 mesh 회전으로 하면 납작하게 누른 축까지 돌아가 버린다. */
  const torsoGeo = evenV(new THREE.CapsuleGeometry(0.16, 0.25, 14, 36));
  /* 몸통 꼴 — 아래가 넓고 위로 갈수록 좁아진다. 어깨 쪽을 넓혔더니
   * 군인 같다는 말을 들었다 — 이 동네 몸은 아래가 퍼진 달걀이다.
   * 가로·앞뒤만 바꾸고 높이는 그대로 두므로 천(evenV)의 감김은 안
   * 흔들린다. */
  {
    const p = torsoGeo.attributes.position;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - lo) / (hi - lo);
      const s = 1.26 - 0.52 * t;                 // 밑단 1.26배 → 어깨 0.74배
      p.setX(i, p.getX(i) * s);
      p.setZ(i, p.getZ(i) * s);
    }
    torsoGeo.computeVertexNormals();
  }
  torsoGeo.rotateY(Math.PI);          // 캡슐은 u 0 이 정면(+z)에서 시작한다(실측) — 이음새를 등으로
  let torsoMat = main;
  if (topStyle !== 0 && topStyle !== 5) {
    const tTex = clothTexture(topStyle, W.tops[topStyle]);
    extraTexs.push(tTex);
    torsoMat = flatCloth(tTex);
    extraMats.push(torsoMat);
  }
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 0.565;
  torso.scale.set(1.02, 1, 0.88);
  body.add(torso);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(
      topStyle === 8 ? 0.098 : 0.105,
      topStyle === 8 ? 0.116 : 0.125,
      topStyle === 8 ? 0.038 : 0.055,
      24
    ),
    white
  );
  collar.position.y = topStyle === 8 ? 0.752 : 0.755;
  body.add(collar);

  if (topStyle === 2) {
    //  후드 — 목 뒤에 접어 둔 모자 덩이
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), main);
    hood.scale.set(1.25, 0.62, 0.8);
    hood.position.set(0, 0.74, -0.15);
    body.add(hood);
  } else if (topStyle === 3) {
    /* 자켓 깃 — 트러커는 '목을 두르는 칼라밴드 위에 끝이 뾰족한 깃' 이
     * 얹힌 구조다. 가슴에 두 장만 붙이면 수트 라펠처럼 보인다. */
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.128, 0.045, 24), main);
    band.position.y = 0.778;
    body.add(band);
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const pt = new THREE.Shape();            // 끝이 뾰족한 깃 한 장
      pt.moveTo(0, 0); pt.lineTo(sgn * 0.085, 0.012);
      pt.lineTo(sgn * 0.075, -0.062); pt.lineTo(0, -0.05);
      const leaf = new THREE.Mesh(new THREE.ShapeGeometry(pt), main);
      leaf.position.set(0, 0.78, 0.085);
      leaf.rotation.x = -0.72;
      body.add(leaf);
    }
  } else if (topStyle === 4) {
    //  블라우스 — 봉긋한 어깨 소매
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), main);
      puff.position.set(sgn * 0.16, 0.67, 0);
      body.add(puff);
    }
  } else if (topStyle === 7) {
    //  스트릿 크롭 블루종 — 세운 스탠드 립 칼라
    const ribCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.128, 0.052, 24), main);
    ribCollar.position.y = 0.778;
    body.add(ribCollar);
  }

  /* 다리 — 짧고 통통해야 그 동네 몸이 된다. 관절은 두되 토막은 굵게.
   *  길쭉하면 2등신이 아니라 그냥 '머리 큰 사람' 이 된다. */
  const legs = [];
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    /* 발바닥이 y=0 에 닿아야 한다. 엉덩이(0.10)에서 무릎(-0.035),
     * 무릎에서 발(-0.025), 발 반높이(0.039)를 빼면 바닥이 0.001 —
     * 토막을 줄이면 그만큼 발이 공중에 뜬다. */
    const hip = joint(sgn * 0.068, 0.10, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.01, 8, 20), thighMat);
    thigh.position.y = -0.02;
    if (bottomStyle === 5) thigh.scale.set(1.2, 1, 1.16);       // 와이드 벌룬 카고 실루엣
    hip.add(thigh);
    const knee = joint(0, -0.035, 0);
    knee.rotation.x = 0.06;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.01, 8, 20), shinMat);
    shin.position.y = -0.005;
    if (bottomStyle === 5) shin.scale.set(1.22, 1, 1.18);
    knee.add(shin);
    if (YUKATA_SKIRT) {
      /* 유카타 맨발 + 얇은 나무 조리/게타 샌들 + 로즈핑크 V자 끈 —
       * 롱 유카타 밑단 아래로 발끝이 아기자기하게 보인다. */
      const getaMat = flat(0xd8ad7a);
      const strapMat = flat(0xdf5a8f);
      extraMats.push(getaMat, strapMat);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.058, 18, 14), skin);
      foot.scale.set(0.98, 0.54, 1.44);
      foot.position.set(0, -0.024, 0.026); knee.add(foot);
      const sandal = new THREE.Mesh(new THREE.SphereGeometry(0.060, 16, 10), getaMat);
      sandal.scale.set(1.02, 0.18, 1.48);
      sandal.position.set(0, -0.048, 0.026); knee.add(sandal);
      for (const s of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.008, 0.058), strapMat);
        strap.position.set(s * 0.018, -0.002, 0.046);
        strap.rotation.y = s * -0.42;
        strap.rotation.x = 0.24;
        knee.add(strap);
      }
    } else {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.064, 20, 14), shoe);
      foot.scale.set(1, 0.62, 1.48);
      foot.position.set(0, -0.023, 0.024); knee.add(foot);
      /* 동물의 숲 캔버스 스니커즈 디테일 — 하얀 고무 밑창 · 앞코 캡 · 끈 두 줄.
       * 단색 덩어리 신발에 이것만 얹어도 아기자기한 동숲 인형 느낌이 살아난다. */
      const sole = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 10), white);
      sole.scale.set(1.02, 0.24, 1.5);
      sole.position.set(0, -0.048, 0.024); knee.add(sole);
      const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.046, 14, 10), white);
      toeCap.scale.set(1.06, 0.62, 0.86);
      toeCap.position.set(0, -0.032, 0.082); knee.add(toeCap);
      for (let li = 0; li < 2; li++) {
        const lace = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.008, 0.012), white);
        lace.position.set(0, 0.008 - li * 0.008, 0.044 + li * 0.022);
        lace.rotation.x = 0.28;
        knee.add(lace);
      }
      if (SKIRTED || bottomStyle === 4) {
        //  치마·반바지일 때는 발목에 귀여운 하얀 짧은 양말
        const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.056, 0.026, 14), white);
        sock.position.y = -0.012; knee.add(sock);
      }
    }
    if (bottomStyle === 3) {
      //  청바지 — 발목에서 밝게 접어 올린 밑단
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.025, 14), lightDark);
      cuff.position.y = -0.03; knee.add(cuff);
    } else if (bottomStyle === 5) {
      //  와이드 카고바지 — 바깥쪽 입체 카고 주머니
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.048, 0.046), lightDark);
      pocket.position.set(sgn * 0.066, -0.018, 0.006);
      hip.add(pocket);
    }
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }

  /* 팔 — 소매는 옷 종류가 정한다.
   *   맨투맨·후드티·청자켓·스트릿 자켓은 긴팔, 티셔츠·블라우스·고양이 티는 반팔, 민소매는 맨팔.
   *   바시티 스타일(7번)은 크림 화이트 소매로 아기자기한 배색을 준다. */
  const LONG_SLEEVE = topStyle === 1 || topStyle === 2 || topStyle === 3 || topStyle === 7;
  //  시보리는 같은 색을 어둡게 — 천에 그린 밑단 시보리와 같은 농도로
  const cuffMat = flat((() => {
    const c = W.tops[topStyle];
    const dn = (v) => ((v | 0) * 0.74) | 0;
    return (dn(c >> 16 & 255) << 16) | (dn(c >> 8 & 255) << 8) | dn(c & 255);
  })());
  const YUKATA_TOP = topStyle === 8;
  let sleeveMat = topStyle === 5 ? skin : (topStyle === 7 ? white : main);
  if (YUKATA_TOP) {
    const sTex = yukataSleeveTexture();
    extraTexs.push(sTex);
    sleeveMat = flatCloth(sTex);
    extraMats.push(sleeveMat);
  }
  const foreMat = LONG_SLEEVE ? (topStyle === 7 ? white : main) : skin;
  const arms = [];
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    const sh = joint(sgn * 0.155, 0.67, 0);
    sh.rotation.z = sgn * (YUKATA_TOP ? 0.24 : 0.18);
    sh.rotation.x = -0.05;
    if (YUKATA_TOP) {
      //  유카타 짧은 기모노 소매 — 어깨에서 살짝 통넓게 퍼지는 나팔꽃 무늬 반팔
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), sleeveMat);
      cap.position.y = -0.012; sh.add(cap);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.072, 0.128, 20), sleeveMat);
      sleeve.position.y = -0.075; sh.add(sleeve);
    } else {
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.10, 8, 20), sleeveMat);
      sleeve.position.y = -0.075; sh.add(sleeve);
    }
    const el = joint(0, -0.16, 0);
    el.rotation.x = 0.14;
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.07, 8, 20), foreMat);
    fore.position.y = -0.055; el.add(fore);
    if (topStyle === 1 || topStyle === 2 || topStyle === 7) {
      //  손목 시보리 — 맨투맨·후드티·바시티 블루종의 소맷부리는 골진 띠로 조여 있다
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.046, 0.032, 14), cuffMat);
      cuff.position.y = -0.10; el.add(cuff);
    }
    //  동물의 숲 특유의 포근하고 통통한 둥근 손
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.064, 18, 14), skin);
    hand.position.y = -0.125; el.add(hand);
    sh.add(el);
    body.add(sh);
    arms.push({ sh, el, rz: sh.rotation.z, rx: sh.rotation.x, erx: el.rotation.x });
  }

  /* 머리 */
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  const skull = new THREE.Mesh(headShape(HEAD_R), skin);
  head.add(skull);

  const face = new THREE.Mesh(
    headShape(HEAD_R, {
      p0: -FACE_PHI / 2, pLen: FACE_PHI,
      t0: FACE_TOP, tLen: FACE_THETA, mul: 1.006
    }),
    faceMat
  );
  face.renderOrder = 1;
  head.add(face);

  /* 3D 동물의 숲 버튼 코 — 두 눈 아랫부분 사이(0.565)에
   * 아담하고 볼록하게 올라가 입(0.78)과 넉넉히 떨어진다. */
  const noseMat = flat(0xef936b);
  {
    const thN = FACE_TOP + 0.565 * FACE_THETA;
    const rrN = HEAD_R * headProf(thN);
    const nose3d = new THREE.Mesh(new THREE.SphereGeometry(0.023, 16, 12), noseMat);
    nose3d.scale.set(1.18, 0.85, 0.88);
    nose3d.position.set(0, Math.cos(thN) * rrN * HEAD_SY, Math.sin(thN) * rrN * HEAD_SZ + 0.007);
    head.add(nose3d);
  }

  /* 귀 — 옆머리 갈래 사이로 빼꼼 보인다. 머리 곡면에 붙인다 */
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    /* 동물의 숲 귀 — 쫑긋하다. 머리에 묻히는 게 아니라 옆으로 내민
     * 둥근 원판이다. 앞에서 보면 머리 실루엣 밖으로 동그라미가 나오고,
     * 옆에서 보면 얇다. 뿌리만 머리에 심고 윗부분을 살짝 바깥으로 기울인다. */
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.066, 20, 16), skin);
    ear.scale.set(1, 1.08, 0.5);
    //  머리 옆면에 맞춰 심는다 — 두상을 부풀리면 같이 밀려 나가야 한다
    ear.position.set(sgn * HEAD_R * headProf(Math.PI / 2) * HEAD_SX, -0.025, -0.01);
    ear.rotation.z = sgn * -0.22;                // 윗부분이 바깥을 보게 — 쫑긋
    ear.rotation.y = sgn * 0.25;                 // 살짝 앞을 보게
    head.add(ear);
  }

  /* 머리카락 — 일곱 모양. 어느 쪽이든 두께 있는 덩어리다.
   *   0 긴 생머리  어깨 아래까지, 옆 갈래가 얼굴을 감싼다
   *   1 단발      턱선에서 끝난다
   *   2 올림머리  짧게 덮고 정수리에 묶는다 (남자가 하면 맨번이다)
   *   3 리프컷    2026 세미 리프컷 — 6:4 가르마 쉼표 앞머리 + 목선 레이어드
   *   4 양갈래    귀 밑에서 두 갈래로 묶는다
   *   5 울프컷    2026 웨이브 울프컷 — 볼륨 있는 중단발·어깨선 레이어드 + 폭신한 웨이브 앞머리
   *   6 더벅머리  앞머리 선을 따라 덩이가 삐죽삐죽하다 */
  const hairStyle = look[1];
  const hairLen = [0.44, 0.25, 0.02, 0.20, 0.08, 0.14, 0.06][hairStyle] || 0;
  const WOLF = hairStyle === 5;
  const LEAF = hairStyle === 3;
  const BUN = hairStyle === 2;
  const BOB = hairStyle === 1;
  const hairR = HEAD_R * (WOLF ? 1.11 : BOB ? 1.10 : LEAF ? 1.12 : BUN ? 1.075 : 1.17);
  /* 모든 머리가 같은 보드라운 동물의 숲 재질(hairMat)로 한 덩어리처럼 이어진다. */
  const lockMat = hairMat;
  const capMat = hairMat;
  /* 끈 — 머리색을 눌러 어둡게. 머리색 그대로면 묶은 티가 안 난다 */
  const tieMat = flat((() => {
    const dn = (v) => ((v | 0) * 0.55) | 0;
    return (dn(hairHex >> 16 & 255) << 16) | (dn(hairHex >> 8 & 255) << 8) | dn(hairHex & 255);
  })());
  const hair = new THREE.Mesh(
    longHair(HEAD_R * 1.015, hairR, hairLen,
      WOLF ? 0.95 : LEAF ? 0.92 : BUN ? 0.99 : 1, 0.42,
      BOB ? -0.30 : undefined,
      LEAF ? 'leaf' : (WOLF ? 'wolf' : (BUN ? 'bun' : undefined))),
    capMat
  );
  head.add(hair);

  if (hairStyle === 0) {
    //  옆 갈래 — 가슴 앞까지 내려와 얼굴을 감싼다
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.3, 10, 22), hairMat);
      lock.position.set(sgn * HEAD_R * 0.86, -0.32, 0.14);
      lock.rotation.z = sgn * 0.05;
      lock.scale.set(1, 1, 0.75);
      head.add(lock);
    }
  } else if (hairStyle === 2) {
    /* 올림머리 — 정수리 뒤쪽 뒤통수 곡면에 딱 뿌리내린 3D 당고 번.
     * 중심 높이는 머리 꼭대기(0.262)보다 높게 두어 정면에서도 또렷한 실루엣이 된다. */
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.064, 0.036, 16), tieMat);
    tie.position.set(0, HEAD_R * 0.88, -HEAD_R * 0.31);
    tie.rotation.x = 0.42;
    head.add(tie);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.114, 26, 20), hairMat);
    bun.scale.set(1.04, 0.95, 1.02);
    bun.position.set(0, HEAD_R * 1.09, -HEAD_R * 0.39);
    bun.rotation.x = 0.28;
    head.add(bun);
  } else if (hairStyle === 3) {
    /* 동물의 숲 스타일 세미 리프컷 — 과하게 부푼 관 대신 단정하고 깔끔하게
     * 가르마에서 이마 양옆으로 흐르는 앞머리 2가닥 + 가운데 쉼표 잔머리 1가닥. */
    const P = Math.PI;
    const leafLocks = [
      //  왼쪽(6) 앞머리 — 가르마에서 관자놀이로 부드럽게 흐르는 얇고 깔끔한 가닥
      [[headPt(0.16 * P, -0.15, 1.06), headPt(0.28 * P, -0.34, 1.15),
        headPt(0.41 * P, -0.56, 1.15), headPt(0.55 * P, -0.72, 1.11)], 0.046, 0.018],
      //  오른쪽(4) 앞머리 — 반대편 관자놀이로 쉼표처럼 흐른다
      [[headPt(0.16 * P, -0.06, 1.06), headPt(0.28 * P, 0.22, 1.15),
        headPt(0.41 * P, 0.48, 1.15), headPt(0.54 * P, 0.66, 1.11)], 0.044, 0.018],
      //  가르마 안쪽 작은 쉼표 잔머리 — 이마를 살짝 가로지른다
      [[headPt(0.18 * P, -0.16, 1.06), headPt(0.29 * P, -0.18, 1.15),
        headPt(0.39 * P, -0.06, 1.12)], 0.032, 0.014]
    ];
    for (const [pts, w, t] of leafLocks) {
      head.add(new THREE.Mesh(taperedLock(pts, w, t), lockMat));
    }
  } else if (hairStyle === 5) {
    /* 금발 하이 반묶음 꽁지 + 얼굴을 길게 감싸는 커튼 앞머리.
     * 정수리 뒤쪽으로 작은 묶음을 세우고 끝이 삐죽하게 퍼지는 꽁지 가닥 둘,
     * 앞쪽은 가운데 가르마에서 볼·턱선까지 부드럽게 흐르는 긴 앞머리 두 갈래와
     * 이마를 가볍게 스치는 시스루 잔머리 한 가닥. */
    const P = Math.PI;
    //  정수리 하이 반묶음 끈 + 매듭
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.042, 16), tieMat);
    tie.position.set(0, HEAD_R * 1.01, -HEAD_R * 0.28);
    tie.rotation.x = 0.36;
    head.add(tie);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.082, 20, 16), lockMat);
    knot.scale.set(1.04, 0.92, 0.96);
    knot.position.set(0, HEAD_R * 1.14, -HEAD_R * 0.32);
    head.add(knot);
    //  묶음 위로 자연스럽게 뻗어 나오는 삐죽 꽁지 가닥 둘
    const topTufts = [
      [[new THREE.Vector3(-0.01, HEAD_R * 1.10, -HEAD_R * 0.30),
        new THREE.Vector3(-0.03, HEAD_R * 1.26, -HEAD_R * 0.35),
        new THREE.Vector3(-0.07, HEAD_R * 1.38, -HEAD_R * 0.44)], 0.044, 0.026],
      [[new THREE.Vector3(0.01, HEAD_R * 1.10, -HEAD_R * 0.30),
        new THREE.Vector3(0.04, HEAD_R * 1.25, -HEAD_R * 0.32),
        new THREE.Vector3(0.09, HEAD_R * 1.36, -HEAD_R * 0.38)], 0.040, 0.024]
    ];
    for (const [pts, w, t] of topTufts) {
      head.add(new THREE.Mesh(taperedLock(pts, w, t), lockMat));
    }
    //  가운데 가르마에서 볼·턱선까지 길게 내려오는 커튼 앞머리 둘 + 시스루 잔머리 하나
    const curtainBangs = [
      //  왼쪽 긴 커튼 앞머리
      [[headPt(0.14 * P, -0.06, 1.07), headPt(0.27 * P, -0.32, 1.16),
        headPt(0.45 * P, -0.56, 1.16), headPt(0.62 * P, -0.60, 1.13),
        headPt(0.75 * P, -0.50, 1.09)], 0.048, 0.019],
      //  오른쪽 긴 커튼 앞머리
      [[headPt(0.14 * P, 0.06, 1.07), headPt(0.27 * P, 0.32, 1.16),
        headPt(0.45 * P, 0.56, 1.16), headPt(0.62 * P, 0.60, 1.13),
        headPt(0.75 * P, 0.50, 1.09)], 0.048, 0.019],
      //  이마를 사선으로 살짝 스치는 가느다란 시스루 잔머리
      [[headPt(0.15 * P, 0.02, 1.08), headPt(0.28 * P, -0.08, 1.16),
        headPt(0.42 * P, -0.22, 1.14), headPt(0.54 * P, -0.30, 1.10)], 0.024, 0.012]
    ];
    for (const [pts, w, t] of curtainBangs) {
      head.add(new THREE.Mesh(taperedLock(pts, w, t), lockMat));
    }
  } else if (hairStyle === 6) {
    /* 더벅머리 — 앞머리 선(눈썹 위)을 따라 덩이가 삐죽삐죽 붙는다.
     * 매끈한 모자에 덩이 몇 개만 얹어도 '깎다 만 머리' 가 된다. */
    for (let k = 0; k < 7; k++) {
      const phi = -2.2 + k * 0.735;
      const th = Math.PI * 0.42;
      const rr = HEAD_R * 1.17;
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.066, 12, 10), hairMat);
      tuft.scale.set(1, 0.72, 0.72);
      tuft.position.set(
        Math.sin(th) * Math.sin(phi) * rr * HEAD_SX,
        Math.cos(th) * rr * HEAD_SY - 0.01,
        Math.sin(th) * Math.cos(phi) * rr * HEAD_SZ);
      tuft.rotation.z = (k % 2 ? 0.4 : -0.3);
      head.add(tuft);
    }
  } else if (hairStyle === 4) {
    //  양갈래 — 귀 밑에서 묶어 턱 옆으로 드리운다
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const px = sgn * HEAD_R * headProf(Math.PI / 2) * HEAD_SX;
      const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.045, 12), tieMat);
      tie.position.set(px * 0.94, -0.1, -0.06);
      tie.rotation.z = sgn * 0.5;
      head.add(tie);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.16, 10, 16), hairMat);
      tail.scale.set(1, 1, 0.8);
      tail.position.set(px * 1.04, -0.27, -0.05);
      tail.rotation.z = sgn * -0.22;             // 끝이 바깥으로 벌어진다
      head.add(tail);
    }
  }
  /* ---- 쓰고 걸치는 것 --------------------------------------------------
   *  모자는 머리카락(바깥 r = HEAD_R*1.19) '위' 에 얹어야 한다 —
   *  머리통 치수로 만들면 머리카락 속에 파묻힌다. 묶음과 같은 병이다.
   *  안경은 얼굴 그림의 눈과 같은 식(θ·φ)으로 자리를 계산해 눈 위에
   *  정확히 겹친다 — 눈 위치를 옮기면 같이 따라온다. */
  if (who.hat) {
    const [kindH, colH] = who.hat;
    const hm = flat(colH);
    //  이름 붙인 그룹에 담는다 — 검사가 '선언한 캐릭터에게만 있나' 를 본다
    const hatG = new THREE.Group();
    hatG.name = 'hat';
    head.add(hatG);
    if (kindH === 'cap') {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(HEAD_R * 1.26, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.40), hm);
      dome.scale.set(HEAD_SX, HEAD_SY * 0.92, HEAD_SZ);
      dome.position.y = 0.025;
      hatG.add(dome);
      //  챙 — 앞으로 내민 납작한 판. 반쯤 머리에 묻혀도 앞만 보이면 된다
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.165, 0.02, 22), hm);
      brim.scale.set(1.05, 1, 1.25);
      brim.position.set(0, HEAD_R * 0.62, HEAD_R * 0.78);
      brim.rotation.x = 0.12;
      hatG.add(brim);
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 10), hm);
      btn.position.y = HEAD_R * 1.26 * HEAD_SY * 0.92 + 0.02;
      hatG.add(btn);
    } else if (kindH === 'beret') {
      const puffB = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.24, 24, 16), hm);
      puffB.scale.set(1.04 * HEAD_SX, 0.42, 0.98 * HEAD_SZ);
      puffB.position.set(0.05, HEAD_R * 0.82, -0.02);
      puffB.rotation.z = -0.14;                  // 한쪽으로 삐딱하게 — 베레모의 전부다
      hatG.add(puffB);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.04, 10), hm);
      stem.position.set(0.02, HEAD_R * 0.82 + 0.19, -0.02);
      hatG.add(stem);
    } else if (kindH === 'straw') {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(HEAD_R * 1.25, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.36), hm);
      dome.scale.set(HEAD_SX, HEAD_SY * 0.9, HEAD_SZ);
      dome.position.y = 0.035;
      hatG.add(dome);
      //  넓은 챙 — 바깥으로 갈수록 살짝 처진다
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R * 0.95, HEAD_R * 1.42, 0.045, 28), hm);
      brim.scale.set(HEAD_SX, 1, HEAD_SZ);
      brim.position.y = HEAD_R * 0.78;
      hatG.add(brim);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R * 1.1, HEAD_R * 1.14, 0.05, 24), flat(0xc0392b));
      band.scale.set(HEAD_SX, 1, HEAD_SZ);
      band.position.y = HEAD_R * 0.86;
      hatG.add(band);
    } else if (kindH === 'cat') {
      /* 고양이 머리띠 — 띠 위에 세모 귀 둘. 귀는 머리카락(r 1.19배)
       * 밖으로 솟아야 실루엣이 갈린다. 안쪽 분홍 세모가 포인트다. */
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(hairR + 0.02, 0.018, 10, 26, Math.PI * 0.84), hm);
      arc.scale.set(HEAD_SX * 1.05, HEAD_SY * 0.97, 1);   // 세로를 눌러야 정수리에 얹힌다 — 둥근 그대로면 헤드폰처럼 뜬다
      arc.position.set(0, -0.025, 0.05);          // 머리에 살짝 파묻혀야 띠다 — 띄우면 헤드폰이다
      arc.rotation.z = Math.PI * 0.08;           // 호(0~0.84π)의 가운데를 정수리로
      arc.rotation.x = -0.16;
      hatG.add(arc);
      /* 귀는 띠의 자식으로 붙인다 — 머리 그룹에 따로 띄우면 띠와
       * 귀가 각자 놀아 '붙어 있는 물건' 으로 안 보인다. 띠 원둘레의
       * 각도에서 자리를 뽑고, 뾰족한 끝이 그 반지름 방향을 보게 돌린다. */
      /* 귀 각도는 '호의 가운데(0.42π)' 기준으로 벌린다. 정수리(0.5π)
       * 기준으로 달면 호를 바로 세우는 회전(+0.08π)에 귀가 같이 밀려
       * 한쪽으로 삐뚤어진다 — 한 번 그랬다. */
      const RB = hairR + 0.02, MID = Math.PI * 0.42;
      for (const th of [MID - 0.55, MID + 0.55]) {
        const rz = th - Math.PI / 2;             // 원뿔(+y)을 반지름 방향으로
        const earO = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.18, 14), hm);
        earO.scale.set(1, 1, 0.55);
        earO.position.set(Math.cos(th) * (RB + 0.055), Math.sin(th) * (RB + 0.055), 0);
        earO.rotation.z = rz;
        arc.add(earO);
        const earI = new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.115, 12), flat(0xf0a0b8));
        earI.scale.set(1, 1, 0.5);
        earI.position.set(Math.cos(th) * (RB + 0.05), Math.sin(th) * (RB + 0.05), 0.028);
        earI.rotation.z = rz;
        arc.add(earI);
      }
    } else if (kindH === 'band') {
      /* 머리띠 — 머리카락 위를 넘어가는 호. 머리카락(r 1.19배) 밖으로
       * 둘러야 보인다. 실제 머리띠처럼 살짝 앞으로 기울인다. */
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(hairR + 0.02, 0.021, 10, 26, Math.PI * 0.84), hm);
      arc.scale.set(HEAD_SX * 1.05, HEAD_SY * 0.97, 1);   // 세로를 눌러야 정수리에 얹힌다 — 둥근 그대로면 헤드폰처럼 뜬다
      arc.position.set(0, -0.025, 0.05);          // 머리에 살짝 파묻혀야 띠다 — 띄우면 헤드폰이다
      arc.rotation.z = Math.PI * 0.08;           // 호가 정수리를 덮게 가운데로
      arc.rotation.x = -0.16;                    // 살짝 앞으로
      hatG.add(arc);
    } else if (kindH === 'bow') {
      /* 리본 — 정수리 옆에 큼직하게. 머리카락(r 1.19배) 밖으로 나와야
       * 보인다. 소심하게 달았다가 빨간 점으로밖에 안 보인 적이 있다. */
      const bx = HEAD_SX * HEAD_R * 0.52, by = HEAD_R * 1.02, bz = 0.1;
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), hm);
      knot.position.set(bx, by, bz);
      hatG.add(knot);
      for (const sgn of [-1, 1]) {
        //  날개 — 매듭에서 양옆 위로 벌어지는 납작한 덩이
        const wing = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), hm);
        wing.scale.set(1, 0.58, 0.45);
        const ang = 0.15 + sgn * 0.6;            // 매듭 기준 날개 방향
        wing.position.set(bx + Math.cos(ang) * sgn * 0.075, by + Math.sin(ang) * 0.06 * sgn + 0.02, bz);
        wing.rotation.z = ang * sgn;
        hatG.add(wing);
      }
    } else if (kindH === 'headphones') {
      /* 아기자기한 동물의 숲 스타일 헤드폰 — 머리에 딱 맞게 얹히는 얇은 밴드와
       * 앙증맞은 둥근 이어컵으로 머리카락 실루엣을 해치지 않는다. */
      const padM = flat(0x5c7ec2);
      const bandR = hairR + 0.018;
      const bandG = new THREE.Group();
      bandG.position.set(0, 0.01, -0.015);
      bandG.rotation.x = -0.12;
      bandG.scale.set(HEAD_SX * 0.99, HEAD_SY * 0.96, 1);
      const band = new THREE.Mesh(new THREE.TorusGeometry(bandR, 0.018, 10, 30, Math.PI), hm);
      bandG.add(band);
      hatG.add(bandG);
      const earX = bandR * HEAD_SX * 0.99;
      for (const sgn of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.078, 0.046, 20), hm);
        cup.rotation.z = sgn * Math.PI / 2;
        cup.position.set(sgn * (earX + 0.01), 0.0, -0.015);
        hatG.add(cup);
        const cushion = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.018, 10, 20), padM);
        cushion.rotation.y = Math.PI / 2;
        cushion.position.set(sgn * (earX - 0.012), 0.0, -0.015);
        hatG.add(cushion);
      }
    }
  }
  if (who.hairpin === 'flower') {
    /* 오른쪽 머리 위의 진짜 3D 입체 꽃 비녀(칸자시) —
     * 머리에 납작하게 붙인 2D 판이 아니라, 입체 꽃받침 위로 컵 모양 2겹 꽃잎 10장이
     * 활짝 솟아오르고 3D 나뭇잎·봉오리·비녀 막대·수술이 공간 밖으로 당당히 튀어나온다. */
    const pinG = new THREE.Group();
    pinG.name = 'hairpin';
    const anchor = headPt(0.24 * Math.PI, 0.88, 1.068);
    pinG.position.copy(anchor);
    pinG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), anchor.clone().normalize());

    const pbr = (col, rough) => new THREE.MeshStandardMaterial({
      color: col, roughness: rough || 0.52, metalness: 0.05,
      emissive: col, emissiveIntensity: 0.10
    });
    const petalMat = pbr(0xfffef8, 0.48);
    const innerPetalMat = pbr(0xf7ecd8, 0.52);
    const centerMat = pbr(0xf2bd38, 0.42);
    const leafMat = pbr(0x64b34a, 0.55);
    const stemMat = pbr(0xd8a64a, 0.40);
    extraMats.push(petalMat, innerPetalMat, centerMat, leafMat, stemMat);

    //  1. 입체 꽃받침 — 머리카락 밖으로 꽃송이를 3D로 받쳐 띄운다
    const calyx = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.038, 14), leafMat);
    calyx.rotation.x = -Math.PI / 2;
    calyx.position.z = 0.016;
    pinG.add(calyx);

    //  2. 바깥 큰 3D 컵 꽃잎 5장 — 각 꽃잎이 앞으로 오목하게 피어오른 입체 조형
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566;
      const pPivot = new THREE.Group();
      pPivot.rotation.z = a;
      const pet = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), petalMat);
      pet.scale.set(0.88, 1.32, 0.54);
      pet.position.set(0, 0.042, 0.036);
      pet.rotation.x = -0.58;                    // 컵처럼 앞으로 입체적으로 젖힘
      pPivot.add(pet);
      pinG.add(pPivot);
    }

    //  3. 안쪽 겹꽃잎 5장 — 36° 어긋나게 더 깊고 오목하게 솟아 겹꽃 입체감 형성
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566 + 0.6283;
      const pPivot = new THREE.Group();
      pPivot.rotation.z = a;
      const pet = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), innerPetalMat);
      pet.scale.set(0.84, 1.24, 0.52);
      pet.position.set(0, 0.028, 0.044);
      pet.rotation.x = -0.84;
      pPivot.add(pet);
      pinG.add(pPivot);
    }

    //  4. 볼록한 3D 황금 꽃술 돔 + 앞으로 톡톡 솟은 3D 수술 5개
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 12), centerMat);
    core.scale.set(1, 1, 0.85);
    core.position.set(0, 0, 0.042);
    pinG.add(core);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566 + 0.3;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), centerMat);
      dot.position.set(Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0.056);
      pinG.add(dot);
    }

    //  5. 공간 밖으로 휘어져 솟는 3D 입체 나뭇잎 3장
    for (const [ang, tilt] of [[-0.55, -0.52], [-2.15, -0.48], [2.45, -0.55]]) {
      const lPivot = new THREE.Group();
      lPivot.rotation.z = ang;
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), leafMat);
      lf.scale.set(0.62, 1.58, 0.38);
      lf.position.set(0, 0.056, 0.024);
      lf.rotation.x = tilt;
      lPivot.add(lf);
      pinG.add(lPivot);
    }

    //  6. 줄기 끝에 둥글게 매달린 3D 흰 꽃봉오리 2개
    for (const [bx, by, bz] of [[-0.054, 0.036, 0.036], [0.052, 0.042, 0.030]]) {
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 12), petalMat);
      bud.scale.set(0.92, 1.15, 0.92);
      bud.position.set(bx, by, bz);
      pinG.add(bud);
    }

    //  7. 머리에 사선으로 꽂혀 실루엣 밖으로 당당히 튀어나오는 3D 비녀 막대 + 솟은 수술 2가닥
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0045, 0.155, 10), stemMat);
    stick.position.set(0.012, 0.048, 0.022);
    stick.rotation.z = -0.36;
    stick.rotation.x = 0.24;
    pinG.add(stick);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 10), centerMat);
    bead.position.set(0.038, 0.118, 0.039);
    pinG.add(bead);

    for (const [sx, sy, sz, rz, rx] of [[0.024, 0.068, 0.044, -0.38, 0.34], [-0.018, 0.072, 0.046, 0.28, 0.38]]) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.068, 8), centerMat);
      stem.position.set(sx, sy, sz);
      stem.rotation.z = rz;
      stem.rotation.x = rx;
      pinG.add(stem);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.010, 10, 8), centerMat);
      tip.position.set(sx - Math.sin(rz) * 0.034, sy + Math.cos(rz) * 0.034, sz + Math.sin(rx) * 0.024);
      pinG.add(tip);
    }
    head.add(pinG);
  }
  if (who.specs) {
    const [kindS, colS] = who.specs;
    const sm = flat(colS);
    const specsG = new THREE.Group();
    specsG.name = 'specs';
    head.add(specsG);
    //  눈 자리 — 얼굴 천의 EY(0.465)·EX(0.248) 를 구면 좌표로 옮긴 것
    const thE = FACE_TOP + 0.465 * FACE_THETA;
    const phE = 0.248 * FACE_PHI;
    const rrE = HEAD_R * headProf(thE) * 1.04;
    const SLIM = kindS === 'slim';
    for (const sgn of [-1, 1]) {
      const p = new THREE.Vector3(
        Math.sin(thE) * Math.sin(sgn * phE) * rrE * HEAD_SX,
        Math.cos(thE) * rrE * HEAD_SY,
        Math.sin(thE) * Math.cos(sgn * phE) * rrE * HEAD_SZ);
      const n = p.clone().normalize();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(
          SLIM ? 0.075 : 0.066,
          SLIM ? 0.0055 : (kindS === 'round' ? 0.007 : 0.011), 10, 28), sm);
      if (SLIM) ring.scale.set(1.16, 0.88, 1);   // 커진 큰 눈을 여유 있게 감싸는 실버 슬림 오벌 테
      ring.position.copy(p);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      specsG.add(ring);
      if (kindS === 'shade') {
        //  색 렌즈 — 테 바로 밑에 깔린 어두운 판
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.062, 24),
          new THREE.MeshToonMaterial({ color: 0x232a3f, gradientMap: RAMP_FLAT }));
        lens.position.copy(p.clone().multiplyScalar(0.995));
        lens.quaternion.copy(ring.quaternion);
        specsG.add(lens);
      }
    }
    //  브리지 — 두 테를 콧등에서 잇는다
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(SLIM ? 0.0048 : 0.006, SLIM ? 0.0048 : 0.006, 0.075, 8), sm);
    bridge.position.set(0, Math.cos(thE) * rrE * HEAD_SY + (SLIM ? 0.006 : 0.012), Math.sin(thE) * rrE * HEAD_SZ * 0.99);
    bridge.rotation.z = Math.PI / 2;
    specsG.add(bridge);
  }
  body.add(head);

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
  tag.position.y = 1.70;   // 제일 높은 꼭대기(포니테일 밑동 1.57) 위 — 모자·묶음이 가리면 안 된다
  root.add(tag);

  let bubble = null, bubbleT = 0;
  const ph = Math.random() * 6.28;
  let stride = 0;

  /* ---- 머리카락 흩날림 --------------------------------------------
   *  걸으면 머리카락이 뒤로 끌리고, 돌면 바깥으로 쏠린다. 멈춰 있어도
   *  아주 조금 흔들린다 — 완전히 멎어 있으면 가발로 보인다.
   *
   *  쏠림을 바로 따라가게 두면 뻣뻣하다. 용수철처럼 늦게 따라가고
   *  지나쳤다 돌아오게 해야 '흩날린다' 로 보인다.
   * ---------------------------------------------------------------- */
  const swayAttr = hair.geometry.attributes.sway;
  const hairPos = hair.geometry.attributes.position;
  const hairRest = hair.geometry.userData.rest;
  const sway = { x: 0, y: 0, z: 0, vx: 0, vz: 0 };
  let lastDir = 0, lastX = 0, lastZ = 0, seeded = false;

  function swayHair(p, dt, t, walking) {
    /* 자세가 한 번이라도 어그러지면(NaN) 머리카락이 영영 사라진다 —
     * 꼭짓점이 NaN 이 되면 되돌릴 길이 없다. 들어올 때 막는다. */
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    const px = num(p && p.x), pz = num(p && p.z), pd = num(p && p.dir);
    if (!seeded) { lastDir = pd; lastX = px; lastZ = pz; seeded = true; }
    const h = Math.max(dt, 1 / 120);

    // 얼마나 빨리 도는가 (짧은 쪽으로)
    let dd = pd - lastDir;
    while (dd > Math.PI) dd -= Math.PI * 2;
    while (dd < -Math.PI) dd += Math.PI * 2;
    lastDir = pd;
    const turn = Math.max(-6, Math.min(6, dd / h));

    // 얼마나 빨리 걷는가
    const sp = Math.min(5, Math.hypot(px - lastX, pz - lastZ) / h);
    lastX = px; lastZ = pz;

    /* 가고 싶은 자리. 몸 기준이라 뒤는 -z 다.
     *   돌면 바깥(= 도는 반대쪽)으로 쏠리고
     *   걸으면 뒤로 끌리고
     *   걸음 박자에 맞춰 좌우로 조금 흔들린다 */
    const tx = -turn * 0.022 + (walking ? Math.sin(stride * 0.5) * 0.016 : 0)
      + Math.sin(t * 0.9 + ph) * 0.005;
    const tz = -sp * 0.03 + Math.sin(t * 1.1 + ph * 1.7) * 0.005;
    const ty = (walking ? -Math.abs(Math.sin(stride)) * 0.016 : 0)
      + Math.sin(t * 1.4 + ph) * 0.004;

    // 용수철 — 늦게 따라가고 지나쳤다 돌아온다
    const K = 48, D = 9;
    sway.vx += ((tx - sway.x) * K - sway.vx * D) * h;
    sway.vz += ((tz - sway.z) * K - sway.vz * D) * h;
    sway.x += sway.vx * h;
    sway.z += sway.vz * h;
    sway.y += (ty - sway.y) * Math.min(1, h * 10);
    // 너무 휘둘리지 않게
    sway.x = Math.max(-0.12, Math.min(0.12, sway.x));
    sway.z = Math.max(-0.12, Math.min(0.12, sway.z));

    const arr = hairPos.array, w = swayAttr.array;
    for (let i = 0; i < w.length; i++) {
      const k = i * 3, g = w[i];
      if (g === 0) continue;                 // 뿌리는 붙박이
      arr[k] = hairRest[k] + sway.x * g;
      arr[k + 1] = hairRest[k + 1] + sway.y * g;
      arr[k + 2] = hairRest[k + 2] + sway.z * g;
    }
    hairPos.needsUpdate = true;
  }

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
      tag.position.y = 1.70;   // 제일 높은 꼭대기(포니테일 밑동 1.57) 위 — 모자·묶음이 가리면 안 된다
      tag.material.opacity = api.gone ? 0.35 : 1;
      root.add(tag);
    },

    /* 연결이 끊긴 사람 — 돌아올 수도 있으니 지우지 않고 흐리게 둔다 */
    setGone(on) {
      on = !!on;
      if (api.gone === on) return;
      api.gone = on;
      const mats = new Set([main, dark, hairMat, lockMat, capMat, skin, noseMat, shoe, white, faceMat, ...extraMats]);
      for (const mt of mats) {
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
      bubble.position.y = 1.96 + lines.length * 0.08;   // 이름표(1.70) 위
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
      stride += dt * (walking ? 9.5 : 0);
      const sw = Math.sin(stride);
      const air = !sitting && ((p.y || 0) - (p.fy || 0)) > 0.03;
      const k = Math.min(1, dt * 14);
      const ease = (j, axis, want) => { j.rotation[axis] += (want - j.rotation[axis]) * k; };

      /* 걸음 — 넓적다리가 앞뒤로 흔들리고, 무릎은 '뒤로만' 접힌다.
       * 무릎을 안 접으면 막대가 흔들리는 꼴이라 로봇처럼 보인다.
       * 팔도 어깨와 팔꿈치를 엇갈린 박자로 움직인다. */
      legs.forEach((L, i) => {
        const ph2 = i ? Math.PI : 0;
        const sg = Math.sin(stride + ph2);
        if (sitting) {
          ease(L.hip, 'x', -1.32); ease(L.knee, 'x', 1.25);
        } else if (air) {
          ease(L.hip, 'x', i ? 0.18 : -0.3); ease(L.knee, 'x', 0.55);
        } else if (walking) {
          ease(L.hip, 'x', sg * 0.52);
          // 뒤로 간 다리일 때만 무릎이 접힌다 (앞으로 꺾이지 않게)
          ease(L.knee, 'x', 0.07 + Math.max(0, -Math.sin(stride + ph2 + 0.7)) * 0.72);
        } else {
          ease(L.hip, 'x', 0); ease(L.knee, 'x', 0.07);
        }
      });
      arms.forEach((A, i) => {
        const ph2 = i ? 0 : Math.PI;            // 팔은 다리와 반대
        const sg = Math.sin(stride + ph2);
        if (sitting) {
          ease(A.sh, 'x', -0.18); ease(A.el, 'x', 0.42);
        } else if (air) {
          ease(A.sh, 'x', -0.95); ease(A.el, 'x', 0.5);
        } else if (walking) {
          ease(A.sh, 'x', A.rx + sg * 0.42);
          ease(A.el, 'x', A.erx + Math.max(0, sg) * 0.3);
          // 흔들 때 팔이 몸에 붙었다 떨어졌다 한다
          ease(A.sh, 'z', A.rz + sg * 0.05 * (i ? -1 : 1));
        } else {
          ease(A.sh, 'x', A.rx); ease(A.el, 'x', A.erx); ease(A.sh, 'z', A.rz);
        }
      });

      body.position.y = air ? 0.02
        : (walking ? Math.abs(sw) * 0.042 : Math.sin(t * 1.6 + ph) * 0.012);
      if (sitting) body.position.y = 0;
      // 걸을 때 몸이 좌우로 아주 조금 기운다 — 이게 있어야 살아 움직인다
      body.rotation.z = walking ? sw * 0.035 : 0;
      body.rotation.y = walking ? sw * 0.07 : 0;
      /* 고개는 몸을 따라간다 — 늘 걸어가는 쪽을 본다.
       * 걸을 때 좌우로 아주 조금 갸웃하는 것만 남긴다. */
      head.rotation.z = walking ? sw * 0.04 : Math.sin(t * 1.2 + ph) * 0.02;
      if (!hidden) swayHair(p, dt, t, walking);   // 안 보이면 계산하지 않는다

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
      if (lockMat !== hairMat) lockMat.dispose();
      if (capMat !== hairMat) capMat.dispose();
      skin.dispose(); noseMat.dispose(); shoe.dispose(); white.dispose(); faceMat.dispose();
      faceOpen.dispose(); faceShut.dispose();
      for (const mt of extraMats) mt.dispose();
      for (const tx of extraTexs) tx.dispose();
    }
  };

  return api;
}
