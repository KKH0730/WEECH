/* ------------------------------------------------------------------
 *  roomdef.js — 위치 WEECH 의 3D 공간 정의 (단위: 미터)
 *
 *  바닥 한가운데가 원점. 사람 키 1.7m 기준.
 *    x : 좌우 (-7 ~ +7)
 *    y : 높이 (0 ~ 3.4)
 *    z : 앞뒤 (-5 북쪽/TV 벽 ~ +5 남쪽/입구)
 *
 *  three.js 를 쓰지 않는 순수 데이터 + 충돌 계산이라 Node 에서 그대로 검증된다.
 * ------------------------------------------------------------------ */
'use strict';

const ROOM3D = (function () {

  const W = 22, D = 16, H = 8.8;        // 천장을 두 배로 — 영화관처럼 높은 공간
  const WALL = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };
  const BOUND = { x0: -10.45, x1: 10.45, z0: -7.45, z1: 7.45 };   // 사람이 걸을 수 있는 범위

  /* ---- 벽에 걸린 것들 --------------------------------------------
   *  wall : 'north' 정면 | 'left' 서쪽 | 'right' 동쪽 | 'south' 입구쪽
   *  u    : 그 벽을 따라간 위치 (north/south 는 x, left/right 는 z)
   *  벽마다 역할을 나눈다 — 정면엔 TV 만, 왼쪽엔 액자와 버튼, 오른쪽엔 전광판.
   * ---------------------------------------------------------------- */
  const WALL_INSET = 0.07;

  function placeOnWall(item) {
    const w = item.wall || 'north';
    if (w === 'north') return { x: item.u, y: item.y, z: -D / 2 + WALL_INSET, ry: 0 };
    if (w === 'south') return { x: item.u, y: item.y, z: D / 2 - WALL_INSET, ry: Math.PI };
    if (w === 'left') return { x: -W / 2 + WALL_INSET, y: item.y, z: item.u, ry: Math.PI / 2 };
    return { x: W / 2 - WALL_INSET, y: item.y, z: item.u, ry: -Math.PI / 2 };
  }

  /* 벽에 거는 물건의 두께.
   *  평면(그림·화면)은 반드시 뒤 상자의 앞면보다 앞에 둬야 한다.
   *  같은 평면에 놓으면 깊이 비교가 프레임마다 뒤집혀 화면이 깜빡인다(Z-파이팅).
   *  FACE_Z > BOX_DEPTH / 2 를 지킬 것. */
  const BOX_DEPTH = 0.06;      // 테두리 상자 두께
  const PLATE_DEPTH = 0.05;    // 버튼 받침 두께
  const FACE_Z = 0.055;        // 평면이 놓이는 위치 (상자 앞면 0.03 보다 2.5cm 앞)

  const TV = { w: 9.0, h: 5.0625, wall: 'north', u: 0, y: 3.8 };     // 16:9 — 정면 벽 가득
  //  스크린 바로 오른쪽, 같은 정면 벽에 세로로 길게 세운다.
  const BOARD = { w: 2.6, h: 4.6, wall: 'north', u: 7.2, y: 4.0 };    // 재생목록 — 스크린 오른쪽

  // 실버 · 골드 버튼 — 왼쪽 벽
  const plaques = [
    { kind: 'silver', wall: 'left', u: -3.4, y: 2.7, s: 0.95, label: '100K' },
    { kind: 'gold', wall: 'left', u: -2.0, y: 2.7, s: 0.95, label: '1M' }
  ];

  // 액자 — 왼쪽 벽에 길게 늘어놓는다
  const frames = [
    { wall: 'left', u: -5.6, y: 2.0, w: 1.1, h: 0.8, hue: 20 },
    { wall: 'left', u: -5.6, y: 1.0, w: 0.8, h: 0.6, hue: 150 },
    { wall: 'left', u: -3.4, y: 1.55, w: 1.0, h: 0.72, hue: 205 },
    { wall: 'left', u: -2.0, y: 1.55, w: 0.72, h: 1.0, hue: 285 },
    { wall: 'left', u: 0.0, y: 2.1, w: 1.3, h: 0.9, hue: 330 },
    { wall: 'left', u: 0.0, y: 1.0, w: 0.9, h: 0.64, hue: 45 },
    { wall: 'left', u: 2.1, y: 1.9, w: 0.84, h: 1.16, hue: 95 },
    { wall: 'left', u: 3.9, y: 1.7, w: 1.16, h: 0.84, hue: 255 },
    { wall: 'left', u: 5.9, y: 1.9, w: 0.96, h: 1.3, hue: 15 },
    // 높은 천장 — 위쪽에도 큰 그림을 건다
    { wall: 'left', u: -4.5, y: 4.6, w: 2.0, h: 1.4, hue: 200 },
    { wall: 'left', u: -1.2, y: 4.6, w: 1.4, h: 1.9, hue: 30 },
    { wall: 'left', u: 1.9, y: 4.7, w: 1.8, h: 1.25, hue: 300 },
    { wall: 'left', u: 4.9, y: 4.6, w: 1.5, h: 2.0, hue: 170 }
  ];

  /* ---- 바닥에 놓인 것들 ------------------------------------------ */
  const CARPETS = [
    { x: 0, z: 0.6, w: 15.0, d: 7.2 },     // TV 앞 큰 러그
    { x: 0, z: 5.5, w: 12.0, d: 4.2 }      // 뒤쪽 라운지 러그
  ];
  const CARPET = CARPETS[0];               // 호환용

  //  rot = y축 회전(라디안). 0 이면 등받이가 +z 쪽(남쪽), 즉 TV 를 바라본다.
  const furniture = [
    // ── TV 앞 자리
    { id: 'sofaL', type: 'sofa', x: -4.4, z: 0.6, rot: 0, w: 3.2, d: 1.15 },
    { id: 'sofaR', type: 'sofa', x: 4.4, z: 0.6, rot: 0, w: 3.2, d: 1.15 },
    { id: 'sofaC', type: 'sofa', x: 0, z: 2.1, rot: 0, w: 4.0, d: 1.15 },
    { id: 'table', type: 'table', x: 0, z: -0.4, rot: 0, w: 2.6, d: 1.2 },
    { id: 'chairL', type: 'chair', x: -8.2, z: -0.4, rot: 0.7, w: 0.95, d: 0.95 },
    { id: 'chairR', type: 'chair', x: 8.2, z: -0.4, rot: -0.7, w: 0.95, d: 0.95 },

    // ── 뒤쪽 라운지
    { id: 'sofaB1', type: 'sofa', x: -5.5, z: 5.4, rot: 0, w: 3.2, d: 1.15 },
    { id: 'sofaB2', type: 'sofa', x: 5.5, z: 5.4, rot: 0, w: 3.2, d: 1.15 },
    { id: 'table2', type: 'table', x: 0, z: 5.4, rot: 0, w: 2.2, d: 1.1 },
    { id: 'chairB1', type: 'chair', x: -2.4, z: 5.6, rot: 2.5, w: 0.95, d: 0.95 },
    { id: 'chairB2', type: 'chair', x: 2.4, z: 5.6, rot: -2.5, w: 0.95, d: 0.95 },

    // ── 가장자리
    { id: 'shelf1', type: 'shelf', x: -10.6, z: -3.5, rot: 0, w: 0.55, d: 3.2 },
    { id: 'shelf2', type: 'shelf', x: -10.6, z: 3.5, rot: 0, w: 0.55, d: 3.2 },
    { id: 'plantA', type: 'plant', x: 10.0, z: -6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'plantB', type: 'plant', x: -10.0, z: -6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'plantC', type: 'plant', x: 10.0, z: 6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'plantD', type: 'plant', x: -10.0, z: 6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'standA', type: 'speaker', x: -8.6, z: -7.2, rot: 0.35, w: 0.55, d: 0.55 },
    { id: 'standB', type: 'speaker', x: 8.6, z: -7.2, rot: -0.35, w: 0.55, d: 0.55 }
  ];

  /* ---- 간접 조명 --------------------------------------------------
   *  세워 두는 스탠드 대신 건축 조명만 쓴다. 바닥에 장애물이 없어진다.
   *    천장 코브 : 벽에서 COVE.inset 만큼 들어온 자리에 띠를 두르고 천장을 비춘다
   *    하단 스트립 : 영화관 통로등처럼 벽 아래를 따라 낮고 따뜻하게 깔린다
   * ------------------------------------------------------------------ */
  /* 뒷쪽 중앙 천장에 매단 영사기. 여기서 화면 쪽으로 빔이 뻗는다. */
  const PROJECTOR = { x: 0, y: 4.6, z: D / 2 - 1.2, w: 0.52, h: 0.28, d: 0.66 };

  const COVE = { inset: 0.75, y: H - 0.3, w: 0.14 };       // 천장 코브 띠
  const STRIP = { y: 0.1, h: 0.055, inset: 0.05 };          // 하단 간접 스트립

  // 실제 광원 자리 (너무 많으면 느려지므로 최소한으로)
  const CEIL_LIGHTS = [
    { x: -5.5, z: -4.0 }, { x: 5.5, z: -4.0 },
    { x: -5.5, z: 4.0 }, { x: 5.5, z: 4.0 }
  ];
  const FLOOR_LIGHTS = [
    { x: 0, z: -D / 2 + 0.5 }, { x: 0, z: D / 2 - 0.5 },
    { x: -W / 2 + 0.5, z: 0 }, { x: W / 2 - 0.5, z: 0 }
  ];

  const lamps = [];   // 스탠드 없음 (옛 코드 호환용)

  const spawn = { x: 0, z: 3.6 };   // 두 자리 사이, TV 를 마주 보는 통로

  /* ---- 충돌 ------------------------------------------------------
   *  가구를 '회전한 사각형(OBB)' 그대로 다룬다. 외접 사각형으로 근사하면
   *  비스듬한 의자 주변에 보이지 않는 벽이 생겨 걸리적거린다.
   *  top = 그 가구의 올라설 수 있는 높이. 그보다 높이 떠 있으면 통과한다.
   * ---------------------------------------------------------------- */
  const TOP = {            // 가구별 윗면 높이 (m)
    sofa: 0.45, chair: 0.46, table: 0.46,
    shelf: 1.55, plant: 1.10, speaker: 1.05
  };

  const solids = [];
  furniture.forEach((f) => {
    solids.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rot, top: TOP[f.type] || 1.0, id: f.id });
  });
  // 스탠드가 없으므로 바닥을 막는 것은 가구뿐이다

  /* 점 (x,z) 를 사각형 s 의 로컬 좌표로 */
  function toLocal(s, x, z) {
    const dx = x - s.x, dz = z - s.z;
    if (!s.rot) return { x: dx, z: dz };
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    return { x: dx * c + dz * sn, z: -dx * sn + dz * c };
  }
  function toWorld(s, lx, lz) {
    if (!s.rot) return { x: s.x + lx, z: s.z + lz };
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    return { x: s.x + lx * c - lz * sn, z: s.z + lx * sn + lz * c };
  }

  /* 발밑 바닥 높이 — 가구 위에 올라서 있으면 그 윗면 */
  function groundAt(x, z) {
    let g = 0;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const l = toLocal(s, x, z);
      if (Math.abs(l.x) < s.w / 2 && Math.abs(l.z) < s.d / 2 && s.top > g) g = s.top;
    }
    return g;
  }

  const STEP = 0.12;   // 이 정도 턱은 그냥 넘어간다

  /* y = 발바닥 높이. 가구 윗면보다 높이 떠 있으면 그 가구는 통과한다. */
  function collide(x, z, r, y) {
    const feet = y || 0;
    for (let pass = 0; pass < 3; pass++) {
      x = Math.max(BOUND.x0 + r, Math.min(BOUND.x1 - r, x));
      z = Math.max(BOUND.z0 + r, Math.min(BOUND.z1 - r, z));
      let moved = false;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (s.top <= feet + STEP) continue;        // 뛰어넘는 중이거나 이미 위에 올라섬
        const l = toLocal(s, x, z);
        const hw = s.w / 2 + r, hd = s.d / 2 + r;
        if (l.x > -hw && l.x < hw && l.z > -hd && l.z < hd) {
          const dl = l.x + hw, dr = hw - l.x, df = l.z + hd, db = hd - l.z;
          const m = Math.min(dl, dr, df, db);
          let nx = l.x, nz = l.z;
          if (m === dl) nx = -hw; else if (m === dr) nx = hw;
          else if (m === df) nz = -hd; else nz = hd;
          const w = toWorld(s, nx, nz);
          x = w.x; z = w.z;
          moved = true;
        }
      }
      if (!moved) break;
    }
    x = Math.max(BOUND.x0 + r, Math.min(BOUND.x1 - r, x));
    z = Math.max(BOUND.z0 + r, Math.min(BOUND.z1 - r, z));
    return { x: x, z: z };
  }

  /* 카메라가 camYaw 쪽을 볼 때, 입력(fx = 오른쪽, fz = 앞)을 월드 방향으로 바꾼다.
   *   앞     = (  sin θ,  cos θ )
   *   오른쪽 = 앞 × 위 = ( -cos θ,  sin θ )    ← y 가 위인 오른손 좌표계
   * 부호를 한 번만 틀려도 A/D 가 뒤바뀌므로 여기 모아 두고 따로 검증한다. */
  function moveVector(camYaw, fx, fz) {
    const s = Math.sin(camYaw), c = Math.cos(camYaw);
    return { x: s * fz - c * fx, z: c * fz + s * fx };
  }

  /* 앉을 수 있는 자리 — 소파/의자 앞쪽 가장자리 */
  const seats = [];
  furniture.forEach((f) => {
    if (f.type === 'sofa') {
      const n = Math.max(2, Math.round(f.w / 0.95));
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (f.w / n);
        seats.push({ x: f.x + off, z: f.z - 0.1, rot: f.rot });
      }
    } else if (f.type === 'chair') {
      seats.push({ x: f.x, z: f.z, rot: f.rot });
    }
  });

  return {
    W: W, D: D, H: H, WALL: WALL, BOUND: BOUND,
    placeOnWall: placeOnWall,
    TV: TV, BOARD: BOARD, plaques: plaques, frames: frames,
    CARPET: CARPET, CARPETS: CARPETS, furniture: furniture, lamps: lamps, solids: solids,
    COVE: COVE, STRIP: STRIP, CEIL_LIGHTS: CEIL_LIGHTS, FLOOR_LIGHTS: FLOOR_LIGHTS,
    PROJECTOR: PROJECTOR,
    seats: seats, spawn: spawn, collide: collide, moveVector: moveVector,
    groundAt: groundAt, TOP: TOP, STEP: STEP,
    BOX_DEPTH: BOX_DEPTH, PLATE_DEPTH: PLATE_DEPTH, FACE_Z: FACE_Z
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ROOM3D;
