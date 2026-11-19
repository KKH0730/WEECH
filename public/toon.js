/* ------------------------------------------------------------------
 *  toon.js — 지브리 풍으로 칠하고 깎는 법
 *
 *  방(scene3d)과 사람(avatar3d)이 같은 띠로 칠해져야 한 그림이 된다.
 *  그래서 '무엇을 그리나' 가 아니라 '어떻게 칠하나' 만 여기 모아 둔다.
 * ------------------------------------------------------------------ */
import * as THREE from 'three';

/* ---- 손으로 칠한 듯이 -----------------------------------------------
 *  사진처럼 매끈하게 비추면 지브리가 안 된다. 빛을 몇 단으로 뚝뚝 끊어
 *  칠해야 한다. MeshToonMaterial 에 '몇 단으로 끊을지' 를 적은 띠를 물린다.
 *
 *  NearestFilter 가 핵심이다 — 기본값(Linear)으로 두면 단 사이를 부드럽게
 *  이어 버려서 결국 보통 셰이딩과 똑같아진다.
 *
 *  맨 아래 칸을 0 으로 두지 않는 것도 중요하다. 지브리의 그늘은 검지 않고
 *  언제나 색이 돈다 — lift 만큼 들어 올려 어두운 쪽에도 색을 남긴다.
 * ------------------------------------------------------------------ */
export function ramp(steps, lift) {
  const d = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const v = lift + (1 - lift) * (i / (steps - 1));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(v * 255);
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, steps, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
/* 바닥값(lift)은 그늘의 깊이다. 올릴수록 그늘에 색이 남지만 방이
 * 평평해진다. 그리고 띠로 끊어 받으면 매끈하게 받던 때보다 평균이
 * 올라간다 — 0.15 면 ×1.52 다. 그만큼 색판을 깎아 균형을 맞췄다. */
export const RAMP_SOFT = ramp(4, 0.15);     // 보통 물건 — 네 단
export const RAMP_SHINY = ramp(5, 0.08);    // 놋쇠·금속 — 한 단 더, 더 깊게 떨어뜨려 반짝이게

/* 색조는 지브리(따뜻한 흙빛·꿀빛 나무·청록), 밝기는 예전 그대로.
 * 처음에 색조만 보고 밝은 값을 골랐더니 방이 대낮이 됐다. 면마다
 * '예전 그 자리의 색이 화면에 찍히던 밝기' 를 목표로 되맞춘 값이다. */
export const C = {
  plaster: 0x221b12, plasterTop: 0x282117,   // 벽 (아래가 짙고 위가 밝다)
  ceiling: 0x211911, base: 0x1e150e,
  plankA: 0x4a3321, plankB: 0x402b1b, plankLine: 0x2c1c11,
  seat: 0x244b43, seatHi: 0x30594e,          // 극장 의자 — 붉은 카펫과 맞선다
  frame: 0x352920, riser: 0x261d16,
  /* 객석 단 — 바닥 널과 같은 밝기다. 단이 걸을 수 있는 바닥의 57% 를
   * 덮기 때문에, 여기가 어두우면 영화관 모드만 통째로 어둑해 보인다. */
  tier: 0x4b3321,
  wood: 0x4f351d, woodHi: 0x63482a,
  brass: 0x75592a, iron: 0x2b241f,
  pot: 0x774528,
  leaf: [0x3e6536, 0x416535, 0x446438, 0x3e6537],
  /* 크리스마스. 방보다 한참 밝다 — 장식이니까 그래야 눈에 든다. */
  pine: 0x24482a, pineHi: 0x33603a, trunk: 0x3a2617,
  xRed: 0xb03a2e, xRedHi: 0xd1584a, xGold: 0xd9a63f,
  xSnow: 0xe8e4da, xBlue: 0x4a7fae, xPink: 0xd98aa8,
  deerCoat: 0x9a6a44, deerBelly: 0xc9a179, antler: 0x7a5a3c,
  skin: 0xffdfbe, belt: 0x2a2420
};

export function mat(color, rough, metal) {
  /* 거칠기·금속도는 옛 호출부와 맞추려고 그대로 받는다. 툰 셰이딩에는
   * 거칠기라는 것이 없으므로, 금속도는 '어느 띠를 쓸지' 고르는 데만 쓴다. */
  return new THREE.MeshToonMaterial({
    color: color,
    gradientMap: (metal || 0) > 0.25 ? RAMP_SHINY : RAMP_SOFT
  });
}

/* ---- 모서리를 깎은 상자 ---------------------------------------------
 *  지브리의 물건은 각이 서 있지 않다. 손으로 깎은 것처럼 모서리가 조금씩
 *  둥글고, 그래서 빛이 모서리를 타고 돌며 한 줄 밝게 선다. 각진 상자는
 *  그 선이 없어 CG 티가 난다.
 *
 *  둥근 사각형을 뽑아내고(extrude) 끝을 깎아(bevel) 만든다. 상자보다
 *  무거우므로 같은 치수는 한 번만 만들어 돌려 쓴다 — 의자 50개가 모두
 *  같은 치수라 실제로 만드는 건 몇 개 안 된다.
 * ------------------------------------------------------------------ */
const softCache = new Map();

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function softGeo(w, h, d) {
  const key = w.toFixed(3) + ',' + h.toFixed(3) + ',' + d.toFixed(3);
  const hit = softCache.get(key);
  if (hit) return hit;

  const min = Math.min(w, h, d);
  const b = Math.min(min * 0.22, 0.07);          // 깎는 깊이 — 너무 깊으면 비누처럼 된다
  let g;
  if (b < 0.006) {
    g = new THREE.BoxGeometry(w, h, d);          // 얇은 판은 깎아 봐야 안 보인다
  } else {
    const r = Math.min(Math.min(w, h) * 0.3, 0.1);
    g = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
      depth: Math.max(0.001, d - 2 * b),
      bevelEnabled: true, bevelThickness: b, bevelSize: b,
      bevelSegments: 2, curveSegments: 3
    });
    g.center();
  }
  softCache.set(key, g);
  return g;
}

export function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(softGeo(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

/* ---- 테두리 ---------------------------------------------------------
 *  사람에게만 두르는 손그림 선. 같은 모양을 조금 부풀려 '안쪽 면만'
 *  그리면, 가장자리에서만 비어져 나와 선처럼 보인다.
 *  방에는 두르지 않는다 — 지브리도 배경에는 선을 긋지 않는다.
 * ------------------------------------------------------------------ */
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x3b2a20, side: THREE.BackSide });

export function outlineOf(mesh, thick) {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  o.scale.copy(mesh.scale).multiplyScalar(1 + (thick === undefined ? 0.08 : thick));
  o.position.copy(mesh.position);
  o.rotation.copy(mesh.rotation);
  o.renderOrder = -1;
  o.userData.isOutline = true;
  return o;
}
