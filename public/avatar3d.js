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
  const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');

  /* 눈은 얼굴의 거의 전부다. 크고, 눈꼬리가 살짝 올라간 아몬드꼴이고,
   * 안에 색 있는 홍채와 흰 점이 있다. 검은 타원만 찍으면 단추가 된다. */
  const IRIS = [0x4a86d8, 0x5aa36b, 0x8a6a3f, 0x6b5ad0, 0x3f8f92];
  const iris = IRIS[kind];
  const EY = S * 0.5, EX = S * 0.245;         // 눈 높이 · 가운데서 벌어진 거리
  /* 세로로 길쭉한 타원이다. 동그라미로 두면 단추처럼 보인다 —
   * 높이가 너비의 1.5배쯤 되어야 그 동네 눈매가 된다. */
  const rx = S * 0.118, ry = S * 0.182;

  // 볼터치 — 눈 바깥 아래. 가장자리가 흐려야 분칠처럼 보인다
  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * S * 0.355, y = S * 0.625;
    const grd = g.createRadialGradient(x, y, 0, x, y, S * 0.105);
    grd.addColorStop(0, 'rgba(243,139,160,.6)');
    grd.addColorStop(1, 'rgba(255,146,146,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, S * 0.105, 0, 6.2832); g.fill();
  }

  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * EX;

    if (shut) {
      // 감은 눈 — 아래로 휜 굵은 선
      g.strokeStyle = '#2e3550';
      g.lineWidth = S * 0.034;
      g.beginPath();
      g.moveTo(x - rx * 0.92, EY - ry * 0.1);
      g.quadraticCurveTo(x, EY + ry * 0.62, x + rx * 0.92, EY - ry * 0.1);
      g.stroke();
      continue;
    }

    // 흰자 — 아주 조금만 보인다
    g.fillStyle = '#2e3550';
    g.beginPath(); g.ellipse(x, EY, rx, ry, 0, 0, 6.2832); g.fill();
    // 홍채 — 흰자를 거의 채운다
    g.fillStyle = '#2e3550';
    g.beginPath(); g.ellipse(x, EY + ry * 0.05, rx * 0.86, ry * 0.86, 0, 0, 6.2832); g.fill();
    // 동공
    g.fillStyle = '#2e3550';
    g.beginPath(); g.ellipse(x, EY + ry * 0.1, rx * 0.52, ry * 0.58, 0, 0, 6.2832); g.fill();
    // 흰 점 — 이것 하나로 눈이 살아난다
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.beginPath();
    g.ellipse(x + rx * 0.3, EY - ry * 0.42, rx * 0.26, ry * 0.22, -0.4, 0, 6.2832);
    g.fill();
    // 윗눈꺼풀 — 위쪽을 덮어 눈매를 만든다
    g.strokeStyle = '#2e3550';
    g.lineWidth = S * 0.03;
    g.beginPath();
    g.moveTo(x - rx * 1.02, EY - ry * 0.52);
    g.quadraticCurveTo(x, EY - ry * 1.18, x + rx * 1.02, EY - ry * 0.52);
    g.stroke();
  }

  // 눈썹 — 머리카락과 같은 색, 가늘게
  g.strokeStyle = '#2e3550';                   // 눈썹도 눈과 같은 남색
  g.lineWidth = S * 0.02;
  for (const sx of [-1, 1]) {
    const x = S / 2 + sx * EX;
    g.beginPath();
    g.moveTo(x - rx * 0.78, EY - ry * 1.62);
    g.quadraticCurveTo(x, EY - ry * 1.92, x + rx * 0.78, EY - ry * 1.62);
    g.stroke();
  }

  /* 코는 그리지 않는다 — 작은 혹을 따로 붙였다(makeAvatar).
   * 그림과 혹이 겹치면 얼룩처럼 보인다. */

  // 입 — 눈 가까이, 작고 부드러운 웃음
  const mx = S / 2, my = S * 0.71;
  g.strokeStyle = '#2e3550';
  g.lineWidth = S * 0.03;
  if (kind === 4) {                            // 벌린 입
    g.fillStyle = '#7a4a46';
    g.beginPath(); g.ellipse(mx, my + S * 0.006, S * 0.03, S * 0.026, 0, 0, 6.2832); g.fill();
  } else {
    g.beginPath();
    g.moveTo(mx - S * 0.07, my - S * 0.014);
    g.quadraticCurveTo(mx, my + S * 0.058, mx + S * 0.07, my - S * 0.014);
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
function headShape(r, patch) {
  /* patch 를 주면 그 범위만 떼어낸다. 얼굴 그림을 붙일 면은 두상과
   * 똑같은 곡면이어야 한다 — 따로 만든 구를 겹치면 광대께에서 묻힌다. */
  const q = patch || { p0: 0, pLen: Math.PI * 2, t0: 0, tLen: Math.PI, mul: 1 };
  const NP = patch ? 40 : 48, NT = patch ? 28 : 36;
  const pos = [], nor = [], uv = [], idx = [];
  const prof = (th) => {
    const t = th / Math.PI;
    const wide = 1 + 0.05 * Math.sin(th);                 // 광대께를 살짝 부풀린다
    const chin = 1 - 0.22 * Math.max(0, (t - 0.60) / 0.40) ** 1.6;   // 턱으로 좁아진다
    return wide * chin;
  };
  for (let it = 0; it <= NT; it++) {
    const th = q.t0 + (it / NT) * q.tLen;
    const rr = r * prof(th) * (q.mul || 1);
    for (let ip = 0; ip <= NP; ip++) {
      const phi = q.p0 + (ip / NP) * q.pLen;
      const sx = Math.sin(th) * Math.sin(phi);
      const sy = Math.cos(th);
      const sz = Math.sin(th) * Math.cos(phi);
      /* 가로로 넓고 위아래로 낮은 둥근 꼴. 세로로 긴 머리는 어른처럼
       * 보이고, 정구면은 공처럼 보인다. 앞뒤는 눌러 얼굴을 평평하게. */
      pos.push(sx * rr * 1.1, sy * rr * 0.9, sz * rr * 0.97);
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
function longHair(rIn, rOut, len) {
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
    return Math.PI * 0.40 + Math.PI * 0.02 * Math.max(0, f) * Math.abs(f)
                          + Math.PI * 0.14 * Math.max(0, -f) * Math.abs(f);
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
          x = sx * r * 1.1; y = sy * r * 0.9; z = sz * r * 0.97;
          nx = sx; ny = sy; nz = sz;
        } else {
          // 머리 끝에서 아래로. 끝으로 갈수록 살짝 모인다
          const v = (u - SPLIT) / (1 - SPLIT);
          const sx = Math.sin(tMax) * Math.sin(phi);
          const sy = Math.cos(tMax);
          const sz = Math.sin(tMax) * Math.cos(phi);
          // 아래로 갈수록 몸 쪽으로 모인다. 안 모으면 치마처럼 퍼진다
          // 아래로 갈수록 몸 쪽으로 모이되, 끝이 뾰족해지지 않게 조금만
          const taper = 1 - 0.1 * v;
          x = sx * r * 1.1 * taper;
          y = sy * r * 0.9 - drop * v;
          z = sz * r * 0.97 * taper;
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
const HEAD_Y = 1.30;
const FACE_PHI = Math.PI * 0.44;
const FACE_THETA = Math.PI * 0.40;
const FACE_TOP = Math.PI * 0.34;


/* ---- 옷장 ----------------------------------------------------------
 *  꾸미기 창이 보여 주는 선택지다. 서버와 다른 사람 화면은 '몇 번을
 *  골랐나'(번호 여섯 개)만 주고받으므로, 여기 순서를 바꾸면 이미 저장된
 *  모습이 전부 어긋난다 — 늘리는 건 되지만 끼워 넣거나 빼지 말 것.
 *      look = [눈, 머리모양, 피부, 상의, 하의, 신발]
 * ------------------------------------------------------------------ */
export const WARDROBE = {
  eyes: 5,                                     // faceTexture 의 눈매 가짓수
  hairs: ['긴 생머리', '단발', '올림머리'],
  topStyles: ['티셔츠', '맨투맨', '후드티', '청자켓', '블라우스', '민소매'],
  bottomStyles: ['치마', '체크치마', '바지', '청바지', '반바지'],
  hairColors: [0x2b2a33, 0x4a3327, 0x8a5a2b, 0xb98a55, 0x6b4a6e, 0x9a9aa4],
  skins: [0xffd8a9, 0xffe6c8, 0xf0be8a, 0xd99e6a, 0xa9754c],
  /* 옷마다 제 색이 박혀 있다 — 청자켓은 청색이고 끝이다.
   * 순서는 topStyles / bottomStyles 와 한 몸이니 같이 움직일 것. */
  tops: [0xff6b5c, 0x3b4a6b, 0x9aa3ad, 0x7191b8, 0xf2bcc8, 0xf2f2f2],
  //      티셔츠      맨투맨      후드티      청자켓      블라우스    민소매
  bottoms: [0xd98a9e, 0x8a7a68, 0xc9b48f, 0x46597e, 0x8a9a6b],
  //        치마       체크치마    바지(치노)  청바지      반바지(카키)
  shoes: [0x4a4038, 0xf4f1ea, 0xc0392b, 0x3f8ecc, 0x6fbf8f, 0xe0a92c]
};
/* look = [눈, 머리모양, 피부, 상의색, 하의색, 신발, 머리색, 상의모양, 하의모양] */
const LOOK_MAX = [
  WARDROBE.eyes, WARDROBE.hairs.length, WARDROBE.skins.length,
  WARDROBE.tops.length, WARDROBE.bottoms.length, WARDROBE.shoes.length,
  WARDROBE.hairColors.length, WARDROBE.topStyles.length, WARDROBE.bottomStyles.length
];

/* 번호 여섯(또는 일곱) 개로 줄 세운다 — 밖에서 온 값은 늘 이걸 거친다 */
export function sanitizeLook(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (let i = 0; i < LOOK_MAX.length; i++) {
    let n = Number(v[i]);
    if (!isFinite(n)) n = 0;
    n = n | 0;
    out.push(n < 0 ? 0 : (n >= LOOK_MAX[i] ? 0 : n));
  }
  return out;
}

/* 아무것도 안 고른 사람의 기본 모습 — 이름에서 뽑아 늘 같게 */
export function lookOf(seed) {
  let h = 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  h = Math.abs(h);
  return [
    h % WARDROBE.eyes,
    h % WARDROBE.hairs.length,
    (h >> 3) % 2,                              // 기본은 밝은 피부 둘 중 하나
    h % WARDROBE.tops.length,
    (h >> 2) % WARDROBE.bottoms.length,
    (h >> 4) % WARDROBE.shoes.length,
    h % WARDROBE.hairColors.length,
    (h >> 5) % WARDROBE.topStyles.length,
    (h >> 6) % WARDROBE.bottomStyles.length
  ];
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
  /* 입을 것 — 직접 고른 look 이 있으면 그걸, 없으면 이름에서 뽑는다 */
  const look = sanitizeLook(opts.look) || lookOf(opts.seed);
  const W = WARDROBE;
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
        0.145 + 0.165 * Math.pow(t, 1.2),      // 반지름 — 아래로 갈수록 벌어진다
        0.74 - 0.36 * t                         // 높이 0.74 → 0.38 (무릎께)
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
    pelvis.position.y = 0.6;
    pelvis.scale.set(1.02, 1, 0.9);
    body.add(pelvis);
  }
  //  다리 색 — 바지·청바지면 발목까지, 반바지면 허벅지만 하의 색
  const thighMat = SKIRTED ? skin : dark;
  const shinMat = (bottomStyle === 2 || bottomStyle === 3) ? dark : skin;

  /* 윗옷 — 무늬를 그린 천을 몸통에 감는다. 기하를 180° 돌려 두는 건
   *  그림(u 0.5)이 앞가슴에 오고 이음새가 등 뒤로 가게 하려는 것이다.
   *  돌림을 mesh 회전으로 하면 납작하게 누른 축까지 돌아가 버린다. */
  const torsoGeo = evenV(new THREE.CapsuleGeometry(0.16, 0.16, 14, 36));
  torsoGeo.rotateY(Math.PI);          // 캡슐은 u 0 이 정면(+z)에서 시작한다(실측) — 이음새를 등으로
  const torsoMat = topStyle === 0 || topStyle === 5
    ? main : flatCloth(clothTexture(topStyle, W.tops[topStyle]));
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 0.93;
  torso.scale.set(1.02, 1, 0.88);
  body.add(torso);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.055, 24), white);
  collar.position.y = 1.075;
  body.add(collar);

  if (topStyle === 2) {
    //  후드 — 목 뒤에 접어 둔 모자 덩이
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), main);
    hood.scale.set(1.25, 0.62, 0.8);
    hood.position.set(0, 1.06, -0.15);
    body.add(hood);
  } else if (topStyle === 3) {
    /* 자켓 깃 — 트러커는 '목을 두르는 칼라밴드 위에 끝이 뾰족한 깃' 이
     * 얹힌 구조다. 가슴에 두 장만 붙이면 수트 라펠처럼 보인다. */
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.128, 0.045, 24), main);
    band.position.y = 1.098;
    body.add(band);
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const pt = new THREE.Shape();            // 끝이 뾰족한 깃 한 장
      pt.moveTo(0, 0); pt.lineTo(sgn * 0.085, 0.012);
      pt.lineTo(sgn * 0.075, -0.062); pt.lineTo(0, -0.05);
      const leaf = new THREE.Mesh(new THREE.ShapeGeometry(pt), main);
      leaf.position.set(0, 1.1, 0.085);
      leaf.rotation.x = -0.72;
      body.add(leaf);
    }
  } else if (topStyle === 4) {
    //  블라우스 — 봉긋한 어깨 소매
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), main);
      puff.position.set(sgn * 0.175, 1.0, 0);
      body.add(puff);
    }
  }

  /* 다리 — 치마 밑으로 살짝. 관절은 두되 짧다 */
  const legs = [];
  for (let sgn = -1; sgn <= 1; sgn += 2) {
    /* 발바닥이 y=0 에 닿아야 한다. 엉덩이(0.5)에서 무릎(-0.20),
     * 무릎에서 발(-0.26), 발 반높이(0.039)를 빼면 바닥이 0.001 —
     * 토막을 줄이면 그만큼 발이 공중에 뜬다. */
    const hip = joint(sgn * 0.068, 0.5, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.12, 8, 20), thighMat);
    thigh.position.y = -0.09; hip.add(thigh);
    const knee = joint(0, -0.20, 0);
    knee.rotation.x = 0.06;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.14, 8, 20), shinMat);
    shin.position.y = -0.11; knee.add(shin);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), shoe);
    foot.scale.set(1, 0.6, 1.5);
    foot.position.set(0, -0.26, 0.025); knee.add(foot);
    if (bottomStyle === 3) {
      //  청바지 — 발목에서 밝게 접어 올린 밑단
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 14), lightDark);
      cuff.position.y = -0.2; knee.add(cuff);
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
    const sh = joint(sgn * 0.175, 1.0, 0);
    sh.rotation.z = sgn * 0.12;
    sh.rotation.x = -0.05;
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.07, 8, 20), sleeveMat);
    sleeve.position.y = -0.06; sh.add(sleeve);
    const el = joint(0, -0.13, 0);
    el.rotation.x = 0.14;
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.05, 8, 20), foreMat);
    fore.position.y = -0.045; el.add(fore);
    if (topStyle === 1 || topStyle === 2) {
      //  손목 시보리 — 맨투맨·후드티의 소맷부리는 골진 띠로 조여 있다
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.046, 0.032, 14), cuffMat);
      cuff.position.y = -0.082; el.add(cuff);
    }
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 18, 14), skin);
    hand.position.y = -0.1; el.add(hand);
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
    ear.position.set(sgn * HEAD_R * 1.16, 0.0, -0.01);
    ear.rotation.z = sgn * -0.22;                // 윗부분이 바깥을 보게 — 쫑긋
    ear.rotation.y = sgn * 0.25;                 // 살짝 앞을 보게
    head.add(ear);
  }

  /* 머리카락 — 세 가지 모양. 어느 쪽이든 두께 있는 덩어리다.
   *   0 긴 생머리  어깨 아래까지, 옆 갈래가 얼굴을 감싼다
   *   1 단발      턱선에서 끝난다
   *   2 올림머리  짧게 덮고 정수리에 묶는다 */
  const hairStyle = look[1];
  const hairLen = hairStyle === 0 ? 0.44 : (hairStyle === 1 ? 0.13 : 0.03);
  const hair = new THREE.Mesh(
    longHair(HEAD_R * 1.015, HEAD_R * 1.17, hairLen),
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
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 18), hairMat);
    bun.scale.set(1, 0.9, 1);
    bun.position.set(0, HEAD_R * 0.92, -0.06);
    head.add(bun);
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
  tag.position.y = 1.78;
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
      if (sitting) body.position.y = -0.235;
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
