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

  const TV = { w: 12.0, h: 6.75, wall: 'north', u: 0, y: 4.5 };      // 16:9 — 극장 스크린 크기
  //  스크린 바로 오른쪽, 같은 정면 벽에 세로로 길게 세운다.
  const BOARD = { w: 2.8, h: 6.0, wall: 'north', u: 8.1, y: 4.875 };  // 재생목록 — 스크린 오른쪽, 윗변 맞춤
  //  스크린 윗변(7.875)과 천장(8.8) 사이 0.925m 에 거는 네온 간판. 지금 트는 곡을 띄운다.
  const NEON = { w: 9.0, h: 0.70, wall: 'north', u: 0, y: 8.30 };

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

  /* ---- 바닥에 놓인 것들 ------------------------------------------
   *  영화관 좌석. 1인용 의자만 줄줄이 놓고, 뒷줄로 갈수록 한 단씩 올린다.
   *
   *          ┌─────── 스크린 ───────┐
   *      ·  · · · ·   통로   · · · ·  ·     1열  바닥
   *      ·  · · · ·   통로   · · · ·  ·     2열  +12cm
   *      ·  · · · ·   통로   · · · ·  ·     3열  +24cm
   *      ·  · · · ·   통로   · · · ·  ·     4열  +36cm
   *      ·  · · · ·   통로   · · · ·  ·     5열  +48cm
   *
   *  단 높이를 STEP(12cm)에 맞춰 두어 그냥 걸어 올라갈 수 있다.
   *  rot = y축 회전(라디안). 0 이면 등받이가 +z 쪽, 즉 TV 를 바라본다.
   * ---------------------------------------------------------------- */
  const CINEMA = {
    rows: 5,                 // 줄 수
    perSide: 5,              // 통로 한쪽당 좌석 수
    z0: -2.4,                // 맨 앞줄 z
    rowGap: 1.6,             // 줄 간격 — 의자 깊이 0.85 를 빼면 0.75 가 다리 공간
    aisle: 1.0,              // 가운데 통로 반폭
    seatGap: 1.15,           // 좌석 간격
    rise: 0.12,              // 한 단 높이 (STEP 과 같아 걸어서 올라간다)
    seat: { w: 0.8, d: 0.85 },
    top: 0.46                // 의자 앉는 면 높이
  };

  const furniture = [];
  const CARPETS = [];

  for (let r = 0; r < CINEMA.rows; r++) {
    const z = CINEMA.z0 + r * CINEMA.rowGap;
    const y = r * CINEMA.rise;                     // 이 줄의 바닥 높이
    // 단 — 줄마다 한 장. 1열은 바닥이라 깔지 않는다
    if (r > 0) {
      furniture.push({
        id: 'tier' + r, type: 'step', x: 0, z: z - 0.1, rot: 0,
        w: 15.0, d: CINEMA.rowGap + 0.2, y: 0, top: y
      });
    }
    // 좌석 — 가운데 통로를 비우고 좌우 대칭으로
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      for (let i = 0; i < CINEMA.perSide; i++) {
        const x = sgn * (CINEMA.aisle + CINEMA.seat.w / 2 + 0.25 + i * CINEMA.seatGap);
        furniture.push({
          id: 'seat' + r + (sgn < 0 ? 'L' : 'R') + i, type: 'chair',
          x: x, z: z, rot: 0, w: CINEMA.seat.w, d: CINEMA.seat.d,
          y: y, top: y + CINEMA.top, row: r
        });
      }
    }
  }

  // ── 가장자리 (좌석과 무관하게 벽을 따라 둔다)
  furniture.push(
    { id: 'shelf1', type: 'shelf', x: -10.6, z: -3.5, rot: 0, w: 0.55, d: 3.2 },
    { id: 'shelf2', type: 'shelf', x: -10.6, z: 3.5, rot: 0, w: 0.55, d: 3.2 },
    { id: 'plantA', type: 'plant', x: 10.0, z: -6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'plantB', type: 'plant', x: -10.0, z: -6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'plantC', type: 'plant', x: 10.0, z: 6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'plantD', type: 'plant', x: -10.0, z: 6.6, rot: 0, w: 0.9, d: 0.9 },
    { id: 'standA', type: 'speaker', x: -8.6, z: -7.2, rot: 0.35, w: 0.55, d: 0.55 },
    { id: 'standB', type: 'speaker', x: 8.6, z: -7.2, rot: -0.35, w: 0.55, d: 0.55 }
  );

  const CARPET = CARPETS[0];               // 호환용

  /* ---- 간접 조명 --------------------------------------------------
   *  세워 두는 스탠드 대신 건축 조명만 쓴다. 바닥에 장애물이 없어진다.
   *    천장 코브 : 벽에서 COVE.inset 만큼 들어온 자리에 띠를 두르고 천장을 비춘다
   *    하단 스트립 : 영화관 통로등처럼 벽 아래를 따라 낮고 따뜻하게 깔린다
   * ------------------------------------------------------------------ */
  /* 천장 한가운데 매단 미러볼 — 노래방 모드에서만 내려온다.
   *  y 는 '내려온 뒤' 공의 중심. 천장(H)에서 짧은 줄로 매단다. */
  const MIRROR = {
    x: 0, y: H - 1.9, z: 0, r: 0.58, drop: 1.1,
    dots: 56,          // 벽·바닥을 쓸고 지나가는 빛 점 개수
    beams: 16          // 공에서 뻗는 빔 개수
  };

  /* 뒷쪽 중앙 천장에 매단 영사기. 천장(H) 바로 아래에 짧은 마운트로 붙인다.
     여기서 화면 쪽으로 빔이 비스듬히 내려 뻗는다. */
  const PROJECTOR = { x: 0, y: H - 0.55, z: D / 2 - 1.2, w: 0.52, h: 0.28, d: 0.66 };

  /* 밝기 — 여기 숫자만 바꾸면 방 전체 분위기가 바뀐다.
   *  영화관처럼 어둑하게 두고, 화면이 가장 밝은 것이 되도록 맞췄다. */
  const LIGHT = {
    exposure: 1.0,      // 전체 노출 (낮출수록 어둡다)
    ambient: 0.52,      // 환경광 — 그늘이 완전히 까맣지 않을 정도만
    hemi: 0.32,         // 위아래 색조
    ceil: 46,           // 천장 코브
    floor: 6.5,         // 하단 간접 (영화관 통로등)
    tv: 6.5,            // 화면이 뿜는 빛 — 방에서 가장 밝은 것
    board: 1.9,         // 전광판
    neon: 2.4,          // 스크린 위 네온 간판
    mirror: 5.4,        // 미러볼이 뿌리는 빛 (노래방 모드)
    dim: 0.34           // 재생 중 방 조명을 이 비율까지 낮춘다 (1 = 그대로)
  };

  const COVE = { inset: 0.75, y: H - 0.3, w: 0.14 };       // 천장 코브 띠
  const STRIP = { y: 0.1, h: 0.055, inset: 0.05 };          // 하단 간접 스트립

  // 실제 광원 자리 (너무 많으면 느려지므로 최소한으로)
  const CEIL_LIGHTS = [
    { x: -5.5, z: -4.0 }, { x: 5.5, z: -4.0 },
    { x: -5.5, z: 4.0 }, { x: 5.5, z: 4.0 }
  ];
  const FLOOR_LIGHTS = [
    // 스크린 바로 아래(정중앙) 조명은 뺀다 — 화면이 가장 밝아 보이도록
    { x: 0, z: D / 2 - 0.5 },
    { x: -W / 2 + 0.5, z: 0 }, { x: W / 2 - 0.5, z: 0 }
  ];

  const lamps = [];   // 스탠드 없음 (옛 코드 호환용)

  const spawn = { x: 0, z: 6.2 };   // 맨 뒷줄 뒤, 전체가 보이는 입구 쪽

  /* ---- 충돌 ------------------------------------------------------
   *  가구를 '회전한 사각형(OBB)' 그대로 다룬다. 외접 사각형으로 근사하면
   *  비스듬한 의자 주변에 보이지 않는 벽이 생겨 걸리적거린다.
   *  top = 그 가구의 올라설 수 있는 높이. 그보다 높이 떠 있으면 통과한다.
   * ---------------------------------------------------------------- */
  const TOP = {            // 가구별 윗면 높이 (m)
    chair: 0.46, step: 0.12,
    shelf: 1.55, plant: 1.10, speaker: 1.05
  };

  const solids = [];
  furniture.forEach((f) => {
    const top = (f.top !== undefined) ? f.top : (TOP[f.type] || 1.0);
    solids.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rot, top: top, id: f.id });
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

  /* ---- 앉는 자리 --------------------------------------------------
   *  의자 하나가 자리 하나. 각 자리 앞(다리 공간)에 '들어서면 앉는 구역'을 둔다.
   *  의자 자체는 막혀 있어 걸어 들어갈 수 없으므로, 구역은 의자 바로 앞에 깐다.
   *
   *        ┌──────┐   ← 의자 (막힘)
   *        ┊ 구역 ┊   ← 여기 들어서면 자동으로 앉는다
   *          통로
   * ------------------------------------------------------------------ */
  const SEAT_ZONE = { w: 0.42, d: 0.14, off: 0.78 };   // 반폭 · 반깊이 · 의자에서 앞으로

  const seats = [];
  furniture.forEach((f) => {
    if (f.type !== 'chair') return;
    seats.push({
      i: seats.length,
      id: f.id,
      x: f.x, z: f.z - 0.04, rot: f.rot,      // 앉았을 때 설 자리
      y: f.y || 0,                            // 그 줄의 바닥 높이
      row: f.row || 0,
      zx: f.x, zz: f.z - SEAT_ZONE.off,       // 감지 구역 한가운데
      zw: SEAT_ZONE.w, zd: SEAT_ZONE.d
    });
  });

  /* 발밑 (x,z) 가 어느 자리의 감지 구역 안인가 — 없으면 -1.
   *  y 는 발 높이. 단이 다른 줄의 구역에 잘못 걸리지 않게 같은 높이만 본다. */
  function seatAt(x, z, y) {
    const feet = y || 0;
    for (let i = 0; i < seats.length; i++) {
      const st = seats[i];
      if (Math.abs(st.y - feet) > 0.09) continue;
      if (Math.abs(x - st.zx) <= st.zw && Math.abs(z - st.zz) <= st.zd) return i;
    }
    return -1;
  }

  return {
    W: W, D: D, H: H, WALL: WALL, BOUND: BOUND,
    placeOnWall: placeOnWall,
    TV: TV, BOARD: BOARD, NEON: NEON, plaques: plaques, frames: frames,
    CARPET: CARPET, CARPETS: CARPETS, furniture: furniture, lamps: lamps, solids: solids,
    LIGHT: LIGHT,
    COVE: COVE, STRIP: STRIP, CEIL_LIGHTS: CEIL_LIGHTS, FLOOR_LIGHTS: FLOOR_LIGHTS,
    PROJECTOR: PROJECTOR, MIRROR: MIRROR,
    seats: seats, seatAt: seatAt, SEAT_ZONE: SEAT_ZONE, CINEMA: CINEMA,
    spawn: spawn, collide: collide, moveVector: moveVector,
    groundAt: groundAt, TOP: TOP, STEP: STEP,
    BOX_DEPTH: BOX_DEPTH, PLATE_DEPTH: PLATE_DEPTH, FACE_Z: FACE_Z
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ROOM3D;
