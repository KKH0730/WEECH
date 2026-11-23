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

/* eyeKind 0~4 — 눈매 번호를 그대로 받는다 (전에는 씨앗에서 뽑았다) */
function faceTexture(eyeKind, shut, hairHex) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const kind = Math.abs(eyeKind | 0) % 5;

  const chan = (v, i) => (v >> (16 - 8 * i)) & 255;
  const rgb = (r, gg, b) => (r << 16) | (gg << 8) | b;
  const shade = (v, k) => rgb(...[0, 1, 2].map((i) => {
    const x = chan(v, i);
    return Math.max(0, Math.min(255, Math.round(k < 0 ? x * (1 + k) : x + (255 - x) * k)));
  }));
  const mix = (a, b, t) => rgb(...[0, 1, 2].map((i) => Math.round(chan(a, i) * (1 - t) + chan(b, i) * t)));
  const css = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');

  /* 눈이 얼굴의 거의 전부다. 실물을 들여다보고 맞췄다 — 겹이 하나만
   * 빠져도 딴 동네 눈이 된다.
   *
   *    테두리   짙은 밤색의 '가는' 선. 두껍게 두르면 물안경이 된다 —
   *             한 번 그랬다. 귀여움은 선의 가늘기에서 온다.
   *    흰자     위쪽에 초승달로 또렷이 남는다. 이 초승달이 '아래를
   *             보는 순한 눈' 을 만든다.
   *    홍채     동그라미 하나. 눈 아래쪽에 내려앉는다.
   *    동공     검정이 아니라 홍채를 어둡게 한 색. 까맣게 찍으면
   *             구멍이 뚫린 것처럼 보인다.
   *    흰 점    위에 큰 것, 아래에 작은 것. 좌우 눈에 같은 쪽.
   *    속눈썹   눈꼬리에 한 가닥만. 여럿 뻗으면 거미발이 된다.
   *
   * 한동안 IRIS 를 적어 두고도 세 겹을 전부 같은 남색으로 칠하고
   * 있었다. 눈이 통째로 까만 덩어리가 되어, 눈매를 다섯으로 나눠
   * 두고도 다 똑같아 보였다. */
  const IRIS = [0x3f8f92, 0x4a86d8, 0x8a6a3f, 0x5aa36b, 0x6b5ad0];
  /* 눈매 다섯 — 속눈썹 가닥 수와 눈꼬리 각도만 다르다 */
  const EYE = [
    { lash: 1, tilt: 0.00 },
    { lash: 2, tilt: 0.10 },
    { lash: 1, tilt: -0.08 },
    { lash: 2, tilt: 0.04 },
    { lash: 1, tilt: 0.14 }
  ];
  const E = EYE[kind];
  const iris = IRIS[kind];
  /* 선은 검정이 아니라 짙은 밤색이고, 머리색을 조금 따라간다 —
   * 머리가 밝은데 눈만 새까맣면 눈이 얼굴에서 떠 보인다. */
  const LINE = css(mix(shade(hairHex, -0.5), 0x4a3028, 0.55));

  /* 눈은 조금 낮게, 서로 조금 멀게 — 이마가 넓고 눈 사이가 벌어져야
   * 아기 얼굴이 된다. 붙이면 야무진 어른 눈매가 된다. */
  const EY = S * 0.515, EX = S * 0.255;
  const rx = S * 0.112, ry = S * 0.158;
  const IR = rx * 0.98;                        // 홍채 반지름 — 동그라미다

  /* 볼터치 — 눈 바깥 아래. 흐릿하게 넓히면 얼룩이 되고, 또렷한
   * 작은 분홍빛 타원이어야 분칠처럼 보인다. */
  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * S * 0.345, y = S * 0.625;
    const grd = g.createRadialGradient(x, y, 0, x, y, S * 0.078);
    grd.addColorStop(0, 'rgba(247,151,142,.55)');
    grd.addColorStop(0.6, 'rgba(247,151,142,.44)');
    grd.addColorStop(1, 'rgba(247,151,142,0)');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(x, y, S * 0.078, S * 0.058, 0, 0, 6.2832); g.fill();
  }

  /* 코 — 그늘이 아니라 '세모' 다. 그 동네 코는 동글한 살굿빛
   * 세모 하나가 떡하니 붙어 있고, 이게 얼굴의 서명이다. */
  {
    const nx = S / 2, ny = S * 0.625, nw = S * 0.035, nh = S * 0.026;
    g.fillStyle = '#e8a06a';
    g.beginPath();
    g.moveTo(nx - nw, ny - nh * 0.5);
    g.quadraticCurveTo(nx, ny - nh * 1.3, nx + nw, ny - nh * 0.5);
    g.quadraticCurveTo(nx + nw * 0.7, ny + nh * 0.4, nx, ny + nh * 0.7);
    g.quadraticCurveTo(nx - nw * 0.7, ny + nh * 0.4, nx - nw, ny - nh * 0.5);
    g.fill();
  }

  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * EX;
    const out = sx;                            // 눈꼬리가 있는 쪽

    /* 속눈썹 — 눈꼬리 위 테두리에서 바깥으로 또르르 한 가닥.
     * 눈을 감아도 남는다. 뿌리를 테두리에서 띄우면 지푸라기가 되고,
     * 여러 가닥을 부채처럼 펴면 거미발이 된다. */
    const lashes = () => {
      g.strokeStyle = LINE;
      g.lineWidth = S * 0.016;
      const roots = E.lash === 1 ? [0.5] : [0.35, 0.72];
      for (const a of roots) {
        const px = x + out * rx * Math.cos(a), py = EY - ry * Math.sin(a);
        const len = S * 0.038;
        const ang = a + 0.55 + E.tilt;
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(
          px + out * len * 0.75 * Math.cos(ang - 0.25), py - len * 0.75 * Math.sin(ang - 0.25),
          px + out * len * Math.cos(ang), py - len * Math.sin(ang));
        g.stroke();
      }
    };

    if (shut) {
      // 감은 눈 — 아래로 휜 선. 가늘게, 순하게
      g.strokeStyle = LINE;
      g.lineWidth = S * 0.024;
      g.beginPath();
      g.moveTo(x - rx * 0.9, EY - ry * 0.16);
      g.quadraticCurveTo(x, EY + ry * 0.6, x + rx * 0.9, EY - ry * 0.16);
      g.stroke();
      lashes();
      continue;
    }

    /* 흰자 — 순백이어야 한다. 두 단짜리 셀 셰이딩에서 얼굴 윗부분은
     * 어두운 단에 떨어지는데, 살짝 누런 흰색을 쓰면 거기서 잿빛으로
     * 주저앉아 눈이 흐려 보인다. */
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(x, EY, rx, ry, 0, 0, 6.2832); g.fill();

    // 홍채 — 눈 아래쪽에 내려앉아 위에 흰자 초승달을 남긴다
    const cy = EY + (ry - IR) * 0.9;
    const grd = g.createLinearGradient(x, cy - IR, x, cy + IR);
    grd.addColorStop(0, css(shade(iris, -0.18)));
    grd.addColorStop(0.55, css(iris));
    grd.addColorStop(1, css(shade(iris, 0.34)));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, cy, IR, 0, 6.2832); g.fill();

    // 동공 — 홍채를 어둡게 한 색. 검정으로 찍으면 구멍이 된다
    g.fillStyle = css(shade(iris, -0.5));
    g.beginPath(); g.arc(x, cy + IR * 0.05, IR * 0.42, 0, 6.2832); g.fill();

    /* 흰 점 — 이것 하나로 눈이 살아난다. 좌우 눈에 같은 쪽으로 찍는다.
     * 바깥쪽끼리 대칭으로 두면 두 눈이 서로 다른 데를 보는 꼴이 된다 —
     * 빛은 한 쪽에서만 온다. */
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(x - IR * 0.36, cy - IR * 0.34, IR * 0.32, IR * 0.27, -0.45, 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.beginPath(); g.arc(x + IR * 0.4, cy + IR * 0.36, IR * 0.13, 0, 6.2832); g.fill();

    /* 테두리 — 가는 선 한 겹. 위쪽만 아주 살짝 굵다.
     * 여기를 두껍게 두르면 물안경이 된다. */
    g.strokeStyle = LINE;
    g.lineWidth = S * 0.013;
    g.beginPath(); g.ellipse(x, EY, rx, ry, 0, 0, 6.2832); g.stroke();
    g.lineWidth = S * 0.02;
    g.beginPath(); g.ellipse(x, EY, rx, ry, 0, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
    lashes();
  }

  // 입 — 코 바로 밑, 작고 동그란 웃음. 멀리 떨어뜨리면 멍해 보인다
  const mx = S / 2, my = S * 0.69;
  g.strokeStyle = LINE;
  g.lineWidth = S * 0.02;
  if (kind === 4) {
    //  벌린 입 — 위가 판판한 반달. 신난 얼굴
    g.fillStyle = '#8a4f4a';
    g.beginPath();
    g.moveTo(mx - S * 0.038, my);
    g.quadraticCurveTo(mx, my + S * 0.064, mx + S * 0.038, my);
    g.closePath(); g.fill();
    g.fillStyle = '#e4807e';
    g.beginPath(); g.ellipse(mx, my + S * 0.03, S * 0.018, S * 0.011, 0, 0, 6.2832); g.fill();
  } else {
    g.beginPath();
    g.moveTo(mx - S * 0.042, my - S * 0.008);
    g.quadraticCurveTo(mx, my + S * 0.038, mx + S * 0.042, my - S * 0.008);
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
  const cheek = 1 + 0.11 * Math.exp(-(((t - 0.62) / 0.23) ** 2));
  /* 턱 — 둥근 맛과 각진 맛의 중간. 좁힘을 늦게(0.80) 시작하고 조금만
   * (0.09) 줄이면 턱선이 아래까지 넓게 남아 각져 보이면서도 곡선은
   * 산다. 일찍(0.74)·많이(0.13) 깎으면 갸름한 달걀턱이 된다. */
  const chin = 1 - 0.09 * Math.max(0, (t - 0.80) / 0.20) ** 1.25;
  return cheek * chin;
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
function longHair(rIn, rOut, len, capMul) {
  /* capMul — 머리선(두피를 덮는 한계각)을 줄인다. 1이면 눈썹까지
   * 내려오는 앞머리, 0.8이면 이마가 드러나는 짧은 머리선이다. */
  const CM = capMul || 1;
  /* 면 수를 아주 많이 둘 이유가 없다 — 매 프레임 꼭짓점을 흔들어야 하므로
   * 사람 수(최대 스무 명)를 곱한 만큼 계산이 된다. */
  const NP = 56, NU = 20;
  const pos = [], nor = [], idx = [], sway = [];
  const SPLIT = 0.42;
  // 앞(phi=0)은 짧고, 옆·뒤는 길다
  const capAt = (phi) => {
    const f = Math.cos(phi);
    /* 옆(귀 위)도 72° 까지 내려와야 한다. 60° 에서 끊으면 옆으로
     * 떨어지는 장이 머리 반폭보다 안쪽에 떠서(0.363 < 0.374) 머리통에
     * 묻힌다 — 귀 뒤 두피가 그대로 드러난다. 앞머리는 그대로 눈썹에서. */
    return (Math.PI * 0.40 + Math.PI * 0.02 * Math.max(0, f) * Math.abs(f)
                           + Math.PI * 0.14 * Math.max(0, -f) * Math.abs(f)) * CM;
  };
  const dropAt = (phi) => {
    const f = Math.cos(phi);                 // 1 앞, -1 뒤
    const back = (1 - f) / 2;                // 0 앞, 1 뒤
    /* 얼굴 앞만 짧고, 귀 옆부터 뒤까지는 고르게 길다.
     * 지수로만 깎으면 뒤 한가운데만 뾰족하게 길어져 날개처럼 보인다.
     * 0~0.42 구간에서 빠르게 올라가고 그 뒤로는 평평하게 둔다. */
    const t = Math.min(1, back / 0.42);
    return len * (t * t * (3 - 2 * t));
  };

  const sheet = (r, flip) => {
    const base0 = pos.length / 3;
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU;
      for (let ip = 0; ip <= NP; ip++) {
        const phi = (ip / NP) * Math.PI * 2;
        const tMax = capAt(phi), drop = dropAt(phi);
        let x, y, z, nx, ny, nz;
        if (u <= SPLIT || drop < 1e-4) {
          const th = (Math.min(u, SPLIT) / SPLIT) * tMax;
          const sx = Math.sin(th) * Math.sin(phi);
          const sy = Math.cos(th);
          const sz = Math.sin(th) * Math.cos(phi);
          const rr = r * headProf(th);         // 머리통과 같은 두상을 쓴다
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
           * 안쪽으로 들어와 볼이 머리카락을 뚫는다. */
          const rr = r * headProf(tMax);
          const taper = 1 - 0.06 * v;
          x = sx * rr * HEAD_SX * taper;
          y = sy * rr * HEAD_SY - drop * v;
          z = sz * rr * HEAD_SZ * taper;
          const h = Math.hypot(sx, sz) || 1;
          nx = sx / h; ny = -0.25; nz = sz / h;   // 옆을 보는 면
        }
        pos.push(x, y, z);
        nor.push(flip ? -nx : nx, flip ? -ny : ny, flip ? -nz : nz);
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
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 흔들 때마다 되돌아갈 자리를 따로 간직한다
  g.userData.rest = Float32Array.from(g.attributes.position.array);
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
    /* 청자켓 (Type III 트러커) */
    const stitch = 'rgba(234,216,172,.92)';    // 노란 박음질 — 데님의 표식
    const seam = shade(0.68);

    band(0, 0.16, 1.1);                        // 앞 요크 — 몸을 두른다
    line(0, ty(0.16), S, ty(0.16), seam, 2.4);
    line(0, ty(0.185), S, ty(0.185), stitch, 1.2);

    //  V자 절개선 — 요크에서 허리밴드로. Type III 의 표식
    for (let sg = -1; sg <= 1; sg += 2) {
      line(tx(sg * 0.42), ty(0.16), tx(sg * 0.72), ty(0.86), seam, 2.2);
      line(tx(sg * 0.47), ty(0.16), tx(sg * 0.77), ty(0.86), stitch, 1);
    }

    //  가슴 주머니 둘 — 끝이 뾰족한 플랩이 요크 밑에서 나온다
    for (let sg = -1; sg <= 1; sg += 2) {
      const px = tx(sg * 0.56), w = S * 0.052;
      g.fillStyle = shade(0.92);
      g.fillRect(px - w, ty(0.16), w * 2, th(0.16, 0.55));
      g.fillStyle = shade(1.05);               // 플랩
      g.beginPath();
      g.moveTo(px - w, ty(0.16));
      g.lineTo(px + w, ty(0.16));
      g.lineTo(px + w, ty(0.36));
      g.lineTo(px, ty(0.47));                  // 뾰족한 끝
      g.lineTo(px - w, ty(0.36));
      g.closePath(); g.fill();
      g.strokeStyle = stitch; g.lineWidth = 1.1; g.stroke();
      g.fillStyle = 'rgba(238,230,214,.96)';   // 플랩 단추
      g.beginPath(); g.arc(px, ty(0.36), S * 0.012, 0, 6.2832); g.fill();
    }

    //  앞섶 — 여섯 단추
    g.fillStyle = shade(0.84);
    g.fillRect(tx(-0.13), 0, tx(0.13) - tx(-0.13), S);
    line(tx(-0.13), 0, tx(-0.13), S, stitch, 1);
    line(tx(0.13), 0, tx(0.13), S, stitch, 1);
    g.fillStyle = 'rgba(228,218,200,.98)';
    for (let i = 0; i < 6; i++) {
      g.beginPath(); g.arc(tx(0), ty(0.06 + i * 0.16), S * 0.016, 0, 6.2832); g.fill();
    }

    band(0.86, 1, 0.88);                       // 밑단 허리밴드
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
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
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
const HEAD_R = 0.34;
/* 두상 눌림 — 가로 · 세로 · 앞뒤. 머리통(headShape)과 머리카락(longHair),
 * 귀가 전부 이걸 쓴다 — 한쪽만 바꾸면 볼이 옆머리를 뚫는다.
 * 가로를 키울수록 얼굴이 옆으로 퍼진다. 1.1 로 두었더니 '옆으로 긴
 * 얼굴' 이 되어 1.02 로 줄였다 — 볼 부풀림(headProf)이 이미 옆을
 * 11% 키우므로 여기까지 넓히면 겹으로 퍼진다. */
const HEAD_SX = 1.02, HEAD_SY = 0.96, HEAD_SZ = 0.96;
/* 키를 낮출 때는 HEAD_Y 만 내리면 안 된다 — 몸통·깃·어깨·골반·치마가
 * 전부 절대 높이로 박혀 있어서 같이 내려야 한다. 아래에서 그 사슬이
 * 이어진다: 엉덩이 0.37 → 무릎 → 발바닥 0 이 바닥이다. */
const HEAD_Y = 0.98;
const FACE_PHI = Math.PI * 0.44;
const FACE_THETA = Math.PI * 0.40;
const FACE_TOP = Math.PI * 0.34;


/* ---- 부품 ----------------------------------------------------------
 *  아래 아홉 캐릭터를 짜 맞추는 재료다. 고르는 창이 아니다 — 손님이
 *  고르는 건 '몇 번 캐릭터' 하나뿐이고, 눈·머리·옷은 그 캐릭터가
 *  이미 정해 두었다. 그래서 여기를 늘려도 저절로 고를 수 있게 되지
 *  않는다. 새 옷을 보여 주고 싶으면 그 옷을 입은 캐릭터를 CHARACTERS
 *  끝에 덧붙여야 한다.
 * ------------------------------------------------------------------ */
export const PARTS = {
  eyes: 5,                                     // faceTexture 의 눈매 가짓수
  hairs: ['긴 생머리', '단발', '올림머리', '포니테일', '양갈래', '짧은 머리', '더벅머리'],
  topStyles: ['티셔츠', '맨투맨', '후드티', '청자켓', '블라우스', '민소매'],
  bottomStyles: ['치마', '체크치마', '바지', '청바지', '반바지'],
  //  마지막 하나는 재색이었는데 쓰는 둘(구름·담이)이 다 할머니로 보였다 — 로즈로
  hairColors: [0x2b2a33, 0x4a3327, 0x8a5a2b, 0xb98a55, 0x6b4a6e, 0xc492a8],
  skins: [0xffd8a9, 0xffe6c8, 0xf0be8a, 0xd99e6a, 0xa9754c],
  /* 옷마다 제 색이 박혀 있다 — 청자켓은 청색이고 끝이다.
   * 순서는 topStyles / bottomStyles 와 한 몸이니 같이 움직일 것. */
  tops: [0xff6b5c, 0x3b4a6b, 0x7fc8b8, 0x7191b8, 0xf2bcc8, 0xf2f2f2],
  //      티셔츠      맨투맨      후드티(민트) 청자켓      블라우스    민소매
  bottoms: [0xd98a9e, 0x8a7a68, 0xc9b48f, 0x46597e, 0x8fb8e0],
  //        치마       체크치마    바지(치노)  청바지      반바지(하늘)
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
 *  아홉이 한눈에 갈리도록 상의 여섯 · 하의 다섯 · 머리 셋 · 눈매
 *  다섯을 빠짐없이 돌려 쓰고, 같은 (상의, 하의) 짝은 두 번 쓰지
 *  않는다. 작은 사진 아홉 장으로 고르는 자리라 비슷한 둘이 끼면
 *  고를 이유가 사라진다.
 * ------------------------------------------------------------------ */
/*  hat   정수리에 얹는 것 — cap(야구모자) · beret(베레모) · straw(밀짚모자) · bow(리본) · band(머리띠)
 *  specs 코에 걸치는 것 — round(둥근 테) · thick(뿔테) · shade(선글라스)
 *  묶음이 위로 솟는 머리(올림머리·포니테일)에는 모자를 씌우지 말 것 — 묶음을 뚫는다. */
export const CHARACTERS = [
  { name: '보리', look: [0, 1, 0, 0, 0, 1, 0, 0, 3], hat: ['cap', 0x31486e] },      // 단발 · 티셔츠 · 남색 캡
  { name: '하루', look: [1, 0, 1, 0, 0, 2, 1, 4, 0], hat: ['bow', 0xd04a4a] },      // 긴 생머리 · 블라우스 · 빨간 리본
  { name: '단추', look: [4, 2, 2, 0, 0, 4, 1, 2, 2], specs: ['round', 0x6e4a2f] },  // 남 · 맨번 · 민트 후드티 · 치노 · 둥근 안경
  { name: '노을', look: [3, 4, 0, 0, 0, 5, 4, 1, 0], hat: ['beret', 0xd9a441] },    // 양갈래 · 맨투맨 · 겨자 베레모
  { name: '바다', look: [0, 3, 3, 0, 0, 1, 3, 3, 2] },                              // 남 · 모래색 꽁지머리 · 청자켓 · 치노
  { name: '구름', look: [2, 5, 1, 0, 0, 1, 3, 0, 4] },                              // 남 · 짧은 모래머리 · 티셔츠 · 하늘 반바지
  { name: '가람', look: [1, 0, 4, 0, 0, 2, 0, 5, 4], hat: ['cap', 0xc0392b] },      // 긴 생머리 · 민소매 · 하늘 반바지 · 빨간 캡
  { name: '소라', look: [2, 4, 0, 0, 0, 2, 3, 0, 1], hat: ['straw', 0xd9b36a] },    // 양갈래 · 티셔츠 · 체크치마 · 밀짚모자
  { name: '담이', look: [3, 6, 1, 0, 0, 3, 1, 1, 2], hat: ['band', 0xf2d16b] }      // 남 · 밤색 더벅머리 · 맨투맨 · 치노 · 머리띠
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

/* 사람은 방보다 훨씬 평평하게 칠한다.
 *  굴곡을 따라 명암이 줄줄 흐르면 깎은 나무처럼 보인다 — 목각인형 티의
 *  정체가 그것이다. 두 단짜리 띠로 '밝다 / 아주 살짝 어둡다' 만 남기면
 *  색종이를 오려 붙인 듯 평평해지고, 형태는 실루엣이 말해 준다. */
const RAMP_FLAT = ramp(2, 0.84);
/* 사람은 제 색을 절반쯤 스스로 낸다(emissive).
 *  어둑한 극장 조명을 그대로 받으면 복숭아빛 피부가 갈색으로 눌린다 —
 *  방 빛만으로는 화면에 0.57(중간 갈색)로 찍히고, 절반을 스스로 내면
 *  0.83(복숭아)으로 살아난다. 재생 중 방이 어두워져도 사람은 또렷하게
 *  남는데, 극장에서 캐릭터가 묻히지 않으니 오히려 바라던 쪽이다. */
const flat = (c) => new THREE.MeshToonMaterial({
  color: c, gradientMap: RAMP_FLAT,
  emissive: c, emissiveIntensity: 0.5
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
  const hairMat = flat(hairHex);
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
   *   0 치마     A라인 돌림판, 민무늬
   *   1 체크치마 같은 돌림판에 체크 천
   *   2 바지     다리 전체가 하의 색
   *   3 청바지   바지 + 밝게 접어 올린 밑단
   *   4 반바지   허벅지만 하의 색 */
  const SKIRTED = bottomStyle <= 1;
  if (SKIRTED) {
    const skirtPts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      skirtPts.push(new THREE.Vector2(
        0.17 + 0.13 * Math.pow(t, 1.2),        // 반지름 — 허리 0.17, 밑단 0.30
        0.50 - 0.28 * t                         // 높이 0.50(하이웨스트) → 0.22 (무릎 위)
      ));
    }
    const skirt = new THREE.Mesh(new THREE.LatheGeometry(skirtPts, 40),
      bottomStyle === 1 ? flatCloth(plaidTexture(W.bottoms[1])) : dark);
    body.add(skirt);
    body.add(outlineOf(skirt, 0.04));          // 밑단의 어두운 테
  }
  if (!SKIRTED) {
    /* 치마가 없으면 골반이 비어 몸통과 다리가 떨어져 보인다 —
     * 바지 엉덩이로 그 사이를 메운다 */
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.1, 12, 30), dark);
    pelvis.position.y = 0.27;
    pelvis.scale.set(0.94, 1, 0.86);
    body.add(pelvis);
  }
  //  다리 색 — 바지·청바지면 발목까지, 반바지면 허벅지만 하의 색
  const thighMat = SKIRTED ? skin : dark;
  const shinMat = (bottomStyle === 2 || bottomStyle === 3) ? dark : skin;

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
  const torsoMat = topStyle === 0 || topStyle === 5
    ? main : flatCloth(clothTexture(topStyle, W.tops[topStyle]));
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 0.565;
  torso.scale.set(1.02, 1, 0.88);
  body.add(torso);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.055, 24), white);
  collar.position.y = 0.755;
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
    thigh.position.y = -0.02; hip.add(thigh);
    const knee = joint(0, -0.035, 0);
    knee.rotation.x = 0.06;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.01, 8, 20), shinMat);
    shin.position.y = -0.005; knee.add(shin);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), shoe);
    foot.scale.set(1, 0.6, 1.5);
    foot.position.set(0, -0.025, 0.025); knee.add(foot);
    if (bottomStyle === 3) {
      //  청바지 — 발목에서 밝게 접어 올린 밑단
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.025, 14), lightDark);
      cuff.position.y = -0.03; knee.add(cuff);
    }
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }

  /* 팔 — 소매는 옷 종류가 정한다.
   *   맨투맨·후드티·청자켓 은 긴팔, 티셔츠·블라우스 는 반팔, 민소매는 맨팔 */
  const LONG_SLEEVE = topStyle === 1 || topStyle === 2 || topStyle === 3;
  //  시보리는 같은 색을 어둡게 — 천에 그린 밑단 시보리와 같은 농도로
  const cuffMat = flat((() => {
    const c = W.tops[topStyle];
    const dn = (v) => ((v | 0) * 0.74) | 0;
    return (dn(c >> 16 & 255) << 16) | (dn(c >> 8 & 255) << 8) | dn(c & 255);
  })());
  const sleeveMat = topStyle === 5 ? skin : main;
  const foreMat = LONG_SLEEVE ? main : skin;
  const arms = [];
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    const sh = joint(sgn * 0.155, 0.67, 0);
    sh.rotation.z = sgn * 0.18;
    sh.rotation.x = -0.05;
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.10, 8, 20), sleeveMat);
    sleeve.position.y = -0.075; sh.add(sleeve);
    const el = joint(0, -0.16, 0);
    el.rotation.x = 0.14;
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.07, 8, 20), foreMat);
    fore.position.y = -0.055; el.add(fore);
    if (topStyle === 1 || topStyle === 2) {
      //  손목 시보리 — 맨투맨·후드티의 소맷부리는 골진 띠로 조여 있다
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.046, 0.032, 14), cuffMat);
      cuff.position.y = -0.10; el.add(cuff);
    }
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 18, 14), skin);
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

  /* 귀 — 옆머리 갈래 사이로 빼꼼 보인다. 머리(x 1.1배)의 곡면에 붙인다 */
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    /* 동물의 숲 귀 — 쫑긋하다. 머리에 묻히는 게 아니라 옆으로 내민
     * 둥근 원판이다. 앞에서 보면 머리 실루엣 밖으로 동그라미가 나오고,
     * 옆에서 보면 얇다. 뿌리만 머리에 심고 윗부분을 살짝 바깥으로 기울인다. */
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 16), skin);
    ear.scale.set(1, 1.08, 0.5);
    //  머리 옆면에 맞춰 심는다 — 두상을 부풀리면 같이 밀려 나가야 한다
    ear.position.set(sgn * HEAD_R * headProf(Math.PI / 2) * HEAD_SX, 0.0, -0.01);
    ear.rotation.z = sgn * -0.22;                // 윗부분이 바깥을 보게 — 쫑긋
    ear.rotation.y = sgn * 0.25;                 // 살짝 앞을 보게
    head.add(ear);
  }

  /* 머리카락 — 일곱 모양. 어느 쪽이든 두께 있는 덩어리다.
   *   0 긴 생머리  어깨 아래까지, 옆 갈래가 얼굴을 감싼다
   *   1 단발      턱선에서 끝난다
   *   2 올림머리  짧게 덮고 정수리에 묶는다 (남자가 하면 맨번이다)
   *   3 포니테일  짧게 덮고 뒤통수에 꼬리를 드리운다 (남자가 하면 꽁지머리)
   *   4 양갈래    귀 밑에서 두 갈래로 묶는다
   *   5 짧은 머리  두피에 붙여 짧게 깎고 이마를 드러낸다
   *   6 더벅머리  앞머리 선을 따라 덩이가 삐죽삐죽하다
   *  묶는 머리(2~4)는 두피만 덮고 꼬리·묶음을 따로 단다 — 덮는 장을
   *  길게 두면 전부 같은 바가지로 보인다. */
  const hairStyle = look[1];
  const hairLen = [0.44, 0.16, 0.03, 0.05, 0.08, 0, 0.06][hairStyle] || 0;
  /* 짧은 머리는 두께(1.19배 헬멧)가 아니라 두피에 붙어야 한다 —
   * 두껍게 두면 그게 바로 밤톨머리다 */
  const TIGHT = hairStyle === 5;
  /* 끈 — 머리색을 눌러 어둡게. 머리색 그대로면 묶은 티가 안 난다 */
  const tieMat = flat((() => {
    const dn = (v) => ((v | 0) * 0.55) | 0;
    return (dn(hairHex >> 16 & 255) << 16) | (dn(hairHex >> 8 & 255) << 8) | dn(hairHex & 255);
  })());
  const hair = new THREE.Mesh(
    longHair(HEAD_R * 1.015, HEAD_R * (TIGHT ? 1.07 : 1.19), hairLen, TIGHT ? 0.8 : 1),
    hairMat
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
    /* 올림머리 — 묶음을 정수리 '위' 에 또렷이 얹는다.
     * 중심을 머리 꼭대기(0.326)보다 낮게 두면 속에 파묻혀 희미한
     * 둔덕이 되고, 앞에서는 밤톨머리와 구별이 안 된다 — 한 번 그랬다. */
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.045, 14), tieMat);
    tie.position.set(0, HEAD_R * 1.0, -0.02);
    head.add(tie);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 18), hairMat);
    bun.scale.set(1, 0.92, 1);
    bun.position.set(0, HEAD_R * 1.32, -0.02);
    head.add(bun);
  } else if (hairStyle === 3) {
    /* 포니테일 — 정수리 뒤에서 '높이' 묶는다. 뒤통수 아래에 달면
     * 앞에서 안 보여 밤톨머리와 구별이 안 된다 — 묶음이 정수리 위로
     * 솟았다가 떨어져야 앞모습에서도 실루엣이 갈린다. */
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.054, 0.05, 14), tieMat);
    tie.position.set(0, HEAD_R * 0.88, -HEAD_R * 0.52);
    tie.rotation.x = 0.9;
    head.add(tie);
    //  분수처럼 위로 솟는 밑동 — 앞에서 보이는 건 이 토막이다.
    //  소심하게 달면 정수리 혹으로밖에 안 보인다 — 또렷이 세운다
    const spout = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.13, 10, 16), hairMat);
    spout.position.set(0, HEAD_R * 1.26, -HEAD_R * 0.52);
    spout.rotation.x = -0.38;
    head.add(spout);
    //  떨어지는 꼬리
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.24, 10, 18), hairMat);
    tail.scale.set(0.85, 1, 0.85);
    tail.position.set(0, HEAD_R * 0.32, -HEAD_R * 1.18);
    tail.rotation.x = 0.38;
    head.add(tail);
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
    } else if (kindH === 'band') {
      /* 머리띠 — 머리카락 위를 넘어가는 호. 머리카락(r 1.19배) 밖으로
       * 둘러야 보인다. 실제 머리띠처럼 살짝 앞으로 기울인다. */
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(HEAD_R * 1.24, 0.021, 10, 26, Math.PI * 0.84), hm);
      arc.scale.set(HEAD_SX * 1.02, HEAD_SY * 1.04, 1);
      arc.position.set(0, 0.01, 0.05);
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
    }
  }
  if (who.specs) {
    const [kindS, colS] = who.specs;
    const sm = flat(colS);
    const specsG = new THREE.Group();
    specsG.name = 'specs';
    head.add(specsG);
    //  눈 자리 — 얼굴 천의 EY(0.515)·EX(0.255) 를 구면 좌표로 옮긴 것
    const thE = FACE_TOP + 0.515 * FACE_THETA;
    const phE = 0.255 * FACE_PHI;
    const rrE = HEAD_R * headProf(thE) * 1.04;
    for (const sgn of [-1, 1]) {
      const p = new THREE.Vector3(
        Math.sin(thE) * Math.sin(sgn * phE) * rrE * HEAD_SX,
        Math.cos(thE) * rrE * HEAD_SY,
        Math.sin(thE) * Math.cos(sgn * phE) * rrE * HEAD_SZ);
      const n = p.clone().normalize();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.066, kindS === 'round' ? 0.007 : 0.011, 10, 28), sm);
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
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.075, 8), sm);
    bridge.position.set(0, Math.cos(thE) * rrE * HEAD_SY + 0.012, Math.sin(thE) * rrE * HEAD_SZ * 0.99);
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
      skin.dispose(); shoe.dispose(); faceMat.dispose();
      faceOpen.dispose(); faceShut.dispose();
    }
  };

  return api;
}
