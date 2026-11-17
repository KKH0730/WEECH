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

  const W = 14, D = 10, H = 3.4;
  const WALL = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };
  const BOUND = { x0: -6.55, x1: 6.55, z0: -4.55, z1: 4.55 };   // 사람이 걸을 수 있는 범위

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

  const TV = { w: 4.2, h: 2.3625, wall: 'north', u: 0, y: 1.95 };      // 16:9 — 정면 벽
  const BOARD = { w: 2.6, h: 1.72, wall: 'right', u: 0.2, y: 1.8 };    // 재생목록 — 오른쪽 벽

  // 실버 · 골드 버튼 — 왼쪽 벽
  const plaques = [
    { kind: 'silver', wall: 'left', u: -2.7, y: 2.16, s: 0.76, label: '100K' },
    { kind: 'gold', wall: 'left', u: -1.55, y: 2.16, s: 0.76, label: '1M' }
  ];

  // 액자 — 전부 왼쪽 벽에 모아 건다
  const frames = [
    { wall: 'left', u: -2.7, y: 1.22, w: 0.86, h: 0.62, hue: 20 },
    { wall: 'left', u: -1.55, y: 1.22, w: 0.62, h: 0.86, hue: 205 },
    { wall: 'left', u: 0.1, y: 1.85, w: 1.0, h: 0.7, hue: 285 },
    { wall: 'left', u: 0.1, y: 1.0, w: 0.7, h: 0.5, hue: 150 },
    { wall: 'left', u: 1.5, y: 1.55, w: 0.66, h: 0.92, hue: 330 },
    { wall: 'left', u: 2.9, y: 1.5, w: 0.92, h: 0.66, hue: 45 }
  ];

  /* ---- 바닥에 놓인 것들 ------------------------------------------ */
  const CARPET = { x: 0, z: 0.7, w: 9.4, d: 5.8 };

  //  rot = y축 회전(라디안). 0 이면 등받이가 +z 쪽(남쪽), 즉 TV 를 바라본다.
  const furniture = [
    { id: 'sofaL', type: 'sofa', x: -2.75, z: 1.25, rot: 0, w: 2.5, d: 1.05 },
    { id: 'sofaR', type: 'sofa', x: 2.75, z: 1.25, rot: 0, w: 2.5, d: 1.05 },
    { id: 'sofaB', type: 'sofa', x: 0, z: 3.5, rot: 0, w: 3.0, d: 1.05 },
    { id: 'table', type: 'table', x: 0, z: 0.5, rot: 0, w: 1.9, d: 0.95 },
    { id: 'chairL', type: 'chair', x: -5.1, z: 0.2, rot: 0.6, w: 0.85, d: 0.85 },
    { id: 'chairR', type: 'chair', x: 5.1, z: 0.2, rot: -0.6, w: 0.85, d: 0.85 },
    { id: 'shelf', type: 'shelf', x: -6.3, z: -2.6, rot: 0, w: 0.5, d: 2.4 },
    { id: 'plantA', type: 'plant', x: 6.0, z: -2.8, rot: 0, w: 0.8, d: 0.8 },
    { id: 'plantB', type: 'plant', x: -6.0, z: 3.6, rot: 0, w: 0.8, d: 0.8 },
    { id: 'standA', type: 'speaker', x: -5.9, z: -4.2, rot: 0.4, w: 0.5, d: 0.5 },
    { id: 'standB', type: 'speaker', x: 5.9, z: -4.2, rot: -0.4, w: 0.5, d: 0.5 }
  ];

  const lamps = [
    { x: -5.9, z: -0.8, h: 1.45 },
    { x: 5.9, z: -0.8, h: 1.45 },
    { x: -2.2, z: 4.3, h: 1.2 },
    { x: 2.2, z: 4.3, h: 1.2 }
  ];

  const spawn = { x: 0, z: 2.3 };   // 소파들 사이, TV 를 마주 보는 자리

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
      const n = f.w > 2.7 ? 3 : 2;
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
    CARPET: CARPET, furniture: furniture, lamps: lamps, solids: solids,
    seats: seats, spawn: spawn, collide: collide, moveVector: moveVector
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ROOM3D;
