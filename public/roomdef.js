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

  const W = 22, D = 16, H = 4.4;
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

  const TV = { w: 6.0, h: 3.375, wall: 'north', u: 0, y: 2.4 };      // 16:9 — 정면 벽
  const BOARD = { w: 3.2, h: 2.12, wall: 'right', u: 0.4, y: 2.1 };   // 재생목록 — 오른쪽 벽

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
    { wall: 'left', u: 5.9, y: 1.9, w: 0.96, h: 1.3, hue: 15 }
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

  const lamps = [
    { x: -9.6, z: -3.0, h: 1.5 },
    { x: 9.6, z: -3.0, h: 1.5 },
    { x: -9.6, z: 2.0, h: 1.5 },
    { x: 9.6, z: 2.0, h: 1.5 },
    { x: -3.2, z: 7.0, h: 1.3 },
    { x: 3.2, z: 7.0, h: 1.3 }
  ];

  const spawn = { x: 0, z: 3.6 };   // 두 자리 사이, TV 를 마주 보는 통로

  /* ---- 충돌 (xz 평면의 사각형들) --------------------------------- */
  const solids = [];
  furniture.forEach((f) => {
    // 회전한 가구는 넉넉한 외접 사각형으로 근사한다
    const c = Math.abs(Math.cos(f.rot)), s = Math.abs(Math.sin(f.rot));
    const w = f.w * c + f.d * s, d = f.w * s + f.d * c;
    solids.push({ x: f.x, z: f.z, w: w, d: d, id: f.id });
  });
  lamps.forEach((l, i) => solids.push({ x: l.x, z: l.z, w: 0.5, d: 0.5, id: 'lamp' + i }));

  function collide(x, z, r) {
    // 가구에서 밀어낸 결과가 벽을 뚫을 수 있으므로 몇 번 번갈아 풀어 준다
    for (let pass = 0; pass < 3; pass++) {
      x = Math.max(BOUND.x0 + r, Math.min(BOUND.x1 - r, x));
      z = Math.max(BOUND.z0 + r, Math.min(BOUND.z1 - r, z));
      let moved = false;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        const left = s.x - s.w / 2 - r, right = s.x + s.w / 2 + r;
        const front = s.z - s.d / 2 - r, back = s.z + s.d / 2 + r;
        if (x > left && x < right && z > front && z < back) {
          const dl = x - left, dr = right - x, df = z - front, db = back - z;
          const m = Math.min(dl, dr, df, db);
          if (m === dl) x = left; else if (m === dr) x = right;
          else if (m === df) z = front; else z = back;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // 마지막엔 반드시 방 안에 둔다
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
    seats: seats, spawn: spawn, collide: collide, moveVector: moveVector
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ROOM3D;
