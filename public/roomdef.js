/* ------------------------------------------------------------------
 *  roomdef.js — 위치 WEECH 의 3D 공간 정의 (단위: 미터)
 *
 *  바닥 한가운데가 원점. 사람 키 1.7m 기준.
 *    x : 좌우 (-11 ~ +11)
 *    y : 높이 (0 ~ 11)
 *    z : 앞뒤 (-15 북쪽/스크린 벽 ~ +15 남쪽/입구)
 *
 *  Play 모드에 따라 바닥에 놓이는 것이 통째로 바뀐다.
 *    영화관 : 뒤로 갈수록 한 단씩 올라가는 계단식 좌석
 *    노래방 : 단이 사라진 평평한 바닥에 ㄴ ◯ ㄱ 모양 소파와 원형 테이블
 *  가구마다 mode 를 달아 두고, 지금 모드가 아닌 것은 충돌·바닥높이·앉기에서
 *  모두 빠진다. 보이는 것(모양이 오르내리는 애니메이션)은 scene3d 가 맡는다.
 *
 *  three.js 를 쓰지 않는 순수 데이터 + 충돌 계산이라 Node 에서 그대로 검증된다.
 * ------------------------------------------------------------------ */
'use strict';

const ROOM3D = (function () {

  const W = 22, D = 30, H = 11.0;       // 스크린을 올려다보지 않아도 되게 뒤로 길게, 위로 높게
  const WALL = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };
  //  걸을 수 있는 범위 — 벽에서 한 뼘 띄운다. 깊이를 바꾸면 따라온다.
  const BOUND = { x0: -W / 2 + 0.55, x1: W / 2 - 0.55, z0: -D / 2 + 0.55, z1: D / 2 - 0.55 };

  /* 지금 켜져 있는 Play 모드. 가구·좌석·충돌이 이 값을 따른다.
   * 보이는 모양은 천천히 오르내리지만 충돌은 바뀌는 즉시 갈아 끼운다 —
   * 중간 상태를 만들면 가라앉는 의자에 사람이 끼인다. */
  let activeMode = 'cinema';
  function setMode(m) { activeMode = (m === 'karaoke') ? 'karaoke' : 'cinema'; }
  function getMode() { return activeMode; }
  const inMode = (m) => !m || m === activeMode;

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

  /*  스크린은 단상(0.84m) 위에 얹힌 것처럼 띄운다 — 아랫변이 단상에서
   *  1.2m 떠 있어, 단상에 선 사람이 화면을 가리지 않는다. */
  const TV = { w: 12.0, h: 6.75, wall: 'north', u: 0, y: 5.4 };      // 16:9 — 2.03 ~ 8.78m
  //  스크린 바로 오른쪽, 같은 정면 벽에 세로로 길게 세운다.
  const BOARD = { w: 2.8, h: 6.0, wall: 'north', u: 8.1, y: 5.775 }; // 재생목록 — 스크린 오른쪽, 윗변 맞춤
  //  스크린 윗변(8.78)과 천장(11) 사이에 거는 네온 간판. 지금 트는 곡을 띄운다.
  const NEON = { w: 9.0, h: 0.80, wall: 'north', u: 0, y: 9.75 };

  // 실버 · 골드 버튼 — 왼쪽 벽
  const plaques = [
    { kind: 'silver', wall: 'left', u: -(D / 2 - 1.6) * 0.56, y: 2.7, s: 0.95, label: '100K' },
    { kind: 'gold', wall: 'left', u: -(D / 2 - 1.6) * 0.33, y: 2.7, s: 0.95, label: '1M' }
  ];

  /* 벽에 거는 것은 리스뿐이다. 액자를 죽 걸어 두었다가 걷었다 —
   * 크리스마스 장식과 겹쳐 벽이 어수선했다.
   * (WALL_U 는 리스·명판이 벽 길이에 맞춰 퍼지는 데 쓴다) */
  const WALL_U = D / 2 - 1.6;

  const furniture = [];
  const CARPETS = [];

  /* ---- 단상과 붉은 카펫 ------------------------------------------
   *  스크린 아래를 비워 두면 객석 앞이 허허벌판으로 보인다. 단상을 놓아
   *  무대가 선 곳처럼 만든다. 붉은 카펫은 단상과 그 계단에만 깐다 —
   *  객석까지 이으면 바닥이 온통 붉어져 스크린이 묻힌다.
   *  노래방 모드에서도 그대로 남는다 — 올라가서 부르라고 둔 자리다.
   *
   *     ┌──────── 스크린 ────────┐
   *     ███████ 단상 0.84m ███████     ← 붉은 카펫
   *            ▄▄▄▄ 계단 ▄▄▄▄          ← 여기까지만
   *
   *               (맨바닥)              ← 객석까지 13m
   * ---------------------------------------------------------------- */
  const STAGE = {
    w: 15.0, d: 3.6, h: 0.84,
    steps: 6, stepW: 4.2, stepD: 0.32, stepH: 0.12   // 0.12 = STEP — 걸어서 오른다
  };
  STAGE.z = -D / 2 + STAGE.d / 2;          // 벽에 붙인다
  STAGE.front = STAGE.z + STAGE.d / 2;     // 객석 쪽 모서리

  furniture.push({
    id: 'stage', type: 'stage', x: 0, z: STAGE.z, rot: 0,
    w: STAGE.w, d: STAGE.d, y: 0, top: STAGE.h
  });
  CARPETS.push({ x: 0, z: STAGE.z, w: STAGE.w - 0.5, d: STAGE.d - 0.3, y: STAGE.h });

  //  단상 계단 — 객석 쪽으로 한 칸씩 낮아진다
  for (let k = 1; k <= STAGE.steps; k++) {
    const z = STAGE.front + (k - 0.5) * STAGE.stepD;
    const top = STAGE.h - k * STAGE.stepH;
    furniture.push({
      id: 'stageStep' + k, type: 'stair', x: 0, z: z, rot: 0,
      w: STAGE.stepW, d: STAGE.stepD, y: 0, top: top
    });
    CARPETS.push({ x: 0, z: z, w: STAGE.stepW - 0.5, d: STAGE.stepD, y: top });
  }

  /* ---- 영화관 좌석 ------------------------------------------------
   *  폭 넓은 1인용 의자를 한쪽에 넷씩, 뒷줄로 갈수록 한 단(34cm)씩 올린다.
   *
   *          ┌──────── 스크린 ────────┐
   *          ███████ 단상 + 붉은 카펫 ███████
   *                 ▄▄▄ 계단 ▄▄▄
   *                    (맨바닥)                  거리   중앙 올려봄
   *       ▪ ▪ ▪ ▪ ┊ 계단 ┊ ▪ ▪ ▪ ▪       1열  바닥    16.0m     13°
   *       ▪ ▪ ▪ ▪ ┊ 계단 ┊ ▪ ▪ ▪ ▪       2열  +0.34   18.0m     12°
   *       ▪ ▪ ▪ ▪ ┊ 계단 ┊ ▪ ▪ ▪ ▪       3열  +0.68   20.0m     11°
   *       ▪ ▪ ▪ ▪ ┊ 계단 ┊ ▪ ▪ ▪ ▪       4열  +1.02   22.0m     10°
   *       ▪ ▪ ▪ ▪ ┊ 계단 ┊ ▪ ▪ ▪ ▪       5열  +1.36   24.0m      9°
   *      ╰─────── 입구 단 (5열과 같은 높이) ───────╯
   *
   *  '올려봄' 은 선 눈높이에서 스크린 한가운데까지 올려다보는 각.
   *  극장은 12~15° 안에 둔다. 11m 면 19° 라 목이 아프고, 22m 면 10° 로
   *  편하지만 화면이 멀어진다 — 그 사이가 16m 다.
   *
   *  단이 34cm 라 그냥은 못 올라간다. 가운데 통로에만 11.3cm 짜리 작은
   *  계단을 두 칸씩 깔아 걸어서 오르내리게 한다 (STEP=12cm 보다 낮다).
   *  맨 윗단은 뒷벽까지 이어 붙여 입구 단으로 쓴다 — 들어오면 바로
   *  맨 윗줄 뒤에 서게 되고, 통로를 따라 내려가며 자리를 고른다.
   * ---------------------------------------------------------------- */
  const CINEMA = {
    rows: 5,                 // 줄 수
    perSide: 4,              // 통로 한쪽당 좌석 수
    z0: 1.0,                 // 맨 앞줄 z — 스크린에서 16m.
                             //  11m 은 올려다보는 각이 가팔라 답답하고(화면 중앙 19°),
                             //  22m 은 화면이 멀어진다(27%). 16m 이 그 사이다 —
                             //  화면 중앙 13°, 가로 37%. 극장 기준이 중앙 12~15° 다.
    rowGap: 2.0,             // 줄 간격 — 의자 깊이 0.85 를 빼면 1.15 가 다리 공간
    aisle: 1.1,              // 가운데 통로 반폭
    //  5석을 4석으로 줄이면서 의자를 넓혔다. 좌석 구역의 바깥 끝(6.76m)은
    //  그대로라 통로·단 폭은 손댈 것이 없다. 간격에서 의자 폭을 뺀 0.35m 가
    //  팔걸이 사이 틈이고, 이 여유는 전과 같게 두었다.
    seatGap: 1.44,           // 좌석 간격
    rise: 0.34,              // 한 단 높이 (계단으로 오른다)
    stepUp: 0.113,           // 통로 계단 한 칸 (STEP 12cm 보다 낮아야 걸어 올라간다)
    seat: { w: 1.09, d: 0.85 },
    top: 0.46,               // 의자 앉는 면 높이
    tierW: 21.4              // 단 폭 — 걸을 수 있는 폭을 다 덮어 옆으로 못 돌아간다
  };

  CINEMA.topY = (CINEMA.rows - 1) * CINEMA.rise;      // 맨 윗단 높이

  /* 단상과 객석 사이는 맨바닥으로 둔다 — 붉은 카펫은 단상과 그 계단에만.
   * 통로까지 깔면 바닥이 온통 붉어져 스크린이 묻힌다. */

  for (let r = 0; r < CINEMA.rows; r++) {
    const z = CINEMA.z0 + r * CINEMA.rowGap;
    const y = r * CINEMA.rise;                     // 이 줄의 바닥 높이
    const front = z - 1.2;                         // 이 단의 앞(스크린 쪽) 모서리

    // 단 — 줄마다 한 장. 1열은 바닥이라 깔지 않는다.
    // 맨 윗줄은 뒷벽까지 늘려 입구 단으로 쓴다.
    if (r > 0) {
      const last = (r === CINEMA.rows - 1);
      const back = last ? BOUND.z1 + 0.6 : z + 1.0;
      furniture.push({
        id: 'tier' + r, type: 'step', mode: 'cinema',
        x: 0, z: (front + back) / 2, rot: 0,
        w: CINEMA.tierW, d: back - front, y: 0, top: y
      });

      /* 통로 계단 — 아랫단 위에, 윗단 모서리 바로 앞에 두 칸.
       * 내려올 때 11.3cm 씩 세 번에 나눠 떨어진다. */
      for (let s = 1; s <= 2; s++) {
        furniture.push({
          id: 'stair' + r + '_' + s, type: 'stair', mode: 'cinema',
          x: 0, z: front - (s - 0.5) * 0.5, rot: 0,
          w: CINEMA.aisle * 2, d: 0.5, y: 0,
          top: y - s * CINEMA.stepUp
        });
      }
    }

    // 좌석 — 가운데 통로를 비우고 좌우 대칭으로
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      for (let i = 0; i < CINEMA.perSide; i++) {
        const x = sgn * (CINEMA.aisle + CINEMA.seat.w / 2 + 0.25 + i * CINEMA.seatGap);
        furniture.push({
          id: 'seat' + r + (sgn < 0 ? 'L' : 'R') + i, type: 'chair', mode: 'cinema',
          x: x, z: z, rot: 0, w: CINEMA.seat.w, d: CINEMA.seat.d,
          y: y, top: y + CINEMA.top, row: r
        });
      }
    }
  }

  /* ---- 노래방 자리 ------------------------------------------------
   *  단과 의자가 바닥으로 사라지고, 평평해진 자리에 ㄴ ◯ ㄱ 이 올라온다.
   *
   *              ┌────────────┐   ㄱ 의 가로
   *      │                      │
   *      │          ◯           │   ㄴ 의 세로 · ㄱ 의 세로
   *      │                      │
   *      └────────────┘             ㄴ 의 가로
   *
   *  두 소파가 돌아가며 맞물려 테이블을 감싼다. 모두 안쪽(테이블)을 본다.
   *  w = 소파를 따라간 길이, d = 앉는 깊이. rot 이 이를 월드로 돌린다.
   * ---------------------------------------------------------------- */
  const KARA = {
    cx: 0, cz: 5.0,          // 자리 한가운데 (= 테이블 중심) — 영화관 좌석 한복판과 맞춘다
    long: 8.8,               // 긴 변 길이
    short: 4.8,              // 짧은 변 길이
    deep: 1.1,               // 소파 깊이
    armX: 5.4,               // 세로 소파의 x
    armZ: 4.4,               // 가로 소파까지의 z 거리
    seatY: 0.44,             // 앉는 면
    backY: 0.95,             // 등받이 꼭대기
    table: { r: 1.9, h: 0.45 }
  };

  const HALF = Math.PI / 2;
  [
    // id,          x,            z,             rot,    길이
    ['sofaLside', -KARA.armX, KARA.cz, -HALF, KARA.long],   // ㄴ 세로 — 오른쪽(테이블)을 본다
    ['sofaLfoot', -3.0, KARA.cz + KARA.armZ, 0, KARA.short],   // ㄴ 가로 — 앞(-z)을 본다
    ['sofaRhead', 3.0, KARA.cz - KARA.armZ, Math.PI, KARA.short],   // ㄱ 가로 — 뒤(+z)를 본다
    ['sofaRside', KARA.armX, KARA.cz, HALF, KARA.long]    // ㄱ 세로 — 왼쪽(테이블)을 본다
  ].forEach((s) => {
    furniture.push({
      id: s[0], type: 'sofa', mode: 'karaoke',
      x: s[1], z: s[2], rot: s[3],
      w: s[4], d: KARA.deep, y: 0, top: KARA.seatY,
      back: KARA.backY
    });
  });

  furniture.push({
    id: 'karaTable', type: 'rtable', mode: 'karaoke',
    x: KARA.cx, z: KARA.cz, rot: 0,
    w: KARA.table.r * 2, d: KARA.table.r * 2, y: 0, top: KARA.table.h
  });

  /* ---- 크리스마스 ------------------------------------------------
   *  모드와 무관하게 늘 있다. 자리는 스크린과 1열 사이 빈 바닥 —
   *  16m 나 비어 있어 뭘 놓아도 길을 막지 않고, 객석 어디서나 보인다.
   *
   *        ┌──── 스크린 ────┐
   *        ███ 단상 ███
   *   🎄        🎅  🦌           ← 여기 (z = -9 쯤)
   *
   *        · · ┊ · ·   1열 (z = 1)
   *
   *  트리는 왼쪽 벽 가까이 붙이되, 벽과의 틈이 사람 폭(0.64m)보다
   *  넓어야 지나다닐 수 있다. x = -8.3, 폭 2.2 → 벽까지 1.05m 남는다.
   * ---------------------------------------------------------------- */
  const XMAS = {
    tree: { x: -8.3, z: -9.0, r: 2.1, h: 5.6 },   // r = 맨 아래 가지 반지름
    gifts: 9
  };

  /* 트리만 가구다. 산타와 루돌프는 돌아다니므로 여기 넣지 않는다 —
   * 막아서는 물건으로 두면 걸어오는 NPC 에 사람이 끼인다. 자리는
   * npc.js 가 시각으로부터 계산한다. */
  furniture.push(
    { id: 'tree', type: 'tree', x: XMAS.tree.x, z: XMAS.tree.z, rot: 0,
      w: XMAS.tree.r * 1.05, d: XMAS.tree.r * 1.05, y: 0, top: 2.2 }
  );

  /* 선물 — 트리 밑동을 빙 둘러 쌓는다. 크기와 각도를 조금씩 어긋나게
   * 두어야 쌓아 둔 것처럼 보인다. 고르게 놓으면 진열대가 된다. */
  for (let i = 0; i < XMAS.gifts; i++) {
    const a = i * 2.399;                        // 황금각 — 뭉치지 않는다
    const far = XMAS.tree.r * (0.72 + (i % 3) * 0.16);
    const s = 0.42 + ((i * 37) % 5) * 0.09;     // 상자 크기
    furniture.push({
      id: 'gift' + i, type: 'gift',
      x: XMAS.tree.x + Math.cos(a) * far,
      z: XMAS.tree.z + Math.sin(a) * far,
      rot: a * 0.7, w: s, d: s * 0.86, y: 0, top: s * 0.8,
      hue: i % 5
    });
  }

  /* 벽에 거는 리스. 액자와 같은 자리잡기(placeOnWall)를 쓴다. */
  const wreaths = [
    { wall: 'left', f: -0.74, y: 3.2, r: 0.62 },
    { wall: 'left', f: 0.18, y: 3.2, r: 0.52 },
    { wall: 'left', f: 0.9, y: 3.2, r: 0.58 },
    { wall: 'right', f: -0.62, y: 3.2, r: 0.6 },
    { wall: 'right', f: 0.1, y: 3.2, r: 0.54 },
    { wall: 'right', f: 0.82, y: 3.2, r: 0.62 },
    { wall: 'south', f: -0.42, y: 3.4, r: 0.66 },
    { wall: 'south', f: 0.42, y: 3.4, r: 0.66 }
  ].map((w) => ({
    wall: w.wall, y: w.y, r: w.r,
    u: w.f * ((w.wall === 'south' ? W : D) / 2 - 1.8)
  }));

  // ── 가장자리 (모드와 무관하게 늘 있다)
  furniture.push(
    { id: 'shelf1', type: 'shelf', x: -10.6, z: -D * 0.26, rot: 0, w: 0.55, d: 3.2 },
    { id: 'shelf2', type: 'shelf', x: -10.6, z: -D * 0.08, rot: 0, w: 0.55, d: 3.2 },
    { id: 'standA', type: 'speaker', x: -8.6, z: -D / 2 + 0.8, rot: 0.35, w: 0.55, d: 0.55 },
    { id: 'standB', type: 'speaker', x: 8.6, z: -D / 2 + 0.8, rot: -0.35, w: 0.55, d: 0.55 }
  );

  /* 화분 — 네 귀퉁이와 양 옆 중간. 방 깊이가 바뀌어도 알아서 따라온다. */
  [-D / 2 + 1.6, -D * 0.17, D / 2 - 1.4].forEach((z, i) => {
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      furniture.push({
        id: 'plant' + i + (sgn < 0 ? 'L' : 'R'), type: 'plant',
        x: sgn * 10.0, z: z, rot: 0, w: 0.9, d: 0.9
      });
    }
  });

  const CARPET = CARPETS[0];               // 호환용

  /* ---- 간접 조명 --------------------------------------------------
   *  세워 두는 스탠드 대신 건축 조명만 쓴다. 바닥에 장애물이 없어진다.
   *    천장 코브 : 벽에서 COVE.inset 만큼 들어온 자리에 띠를 두르고 천장을 비춘다
   *    하단 스트립 : 영화관 통로등처럼 벽 아래를 따라 낮고 따뜻하게 깔린다
   * ------------------------------------------------------------------ */
  /* 천장 한가운데 매단 미러볼 — 노래방 모드에서만 내려온다.
   *  y 는 '내려온 뒤' 공의 중심. 천장(H)에서 짧은 줄로 매단다.
   *  노래방 자리 한가운데(KARA) 위로 온다. */
  const MIRROR = {
    x: KARA.cx, y: H - 3.4, z: KARA.cz, r: 0.58, drop: 1.1,
    dots: 56,          // 벽·바닥을 쓸고 지나가는 빛 점 개수
    beams: 16          // 공에서 뻗는 빔 개수
  };

  /* 뒷쪽 중앙 천장에 매단 영사기. 천장(H) 바로 아래에 짧은 마운트로 붙인다.
     여기서 화면 쪽으로 빔이 비스듬히 내려 뻗는다. */
  const PROJECTOR = { x: 0, y: H - 0.55, z: D / 2 - 1.2, w: 0.52, h: 0.28, d: 0.66 };

  /* 밝기 — 여기 숫자만 바꾸면 방 전체 분위기가 바뀐다.
   *  영화관처럼 어둑하게 두고, 화면이 가장 밝은 것이 되도록 맞췄다. */
  /*  조명은 손대지 않는다. 한때 '지브리의 빛' 이라며 햇빛을 더하고 몫을
   *  나눠 봤는데, 방향광은 거리에 상관없이 방 전체를 똑같이 비춘다.
   *  점광원이 닿지 않아 어둡던 구석까지 환해져 방이 평평해졌고,
   *  재생 전후로 어두워지는 맛도 묻혔다. 지브리다움은 빛이 아니라
   *  칠하는 법(띠)·색조·모양으로 낸다. */
  const LIGHT = {
    /* 파스텔 색판은 그 자체로 밝다. 노출로 끌어내려 균형을 잡는다 —
     * 여기 한 줄이 방 전체 밝기 손잡이다. (재생 중 어두워지는 폭은 dim) */
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
  //  천장 조명 — 깊이를 셋으로 나눠 고르게 (방이 길어져도 어두운 구간이 안 생긴다)
  const CEIL_LIGHTS = [];
  [-0.68, 0, 0.68].forEach((f) => {
    CEIL_LIGHTS.push({ x: -5.5, z: f * (D / 2 - 2) }, { x: 5.5, z: f * (D / 2 - 2) });
  });
  const FLOOR_LIGHTS = [
    // 스크린 바로 아래(정중앙) 조명은 뺀다 — 화면이 가장 밝아 보이도록
    { x: 0, z: D / 2 - 0.5 },
    { x: -W / 2 + 0.5, z: 0 }, { x: W / 2 - 0.5, z: 0 }
  ];

  const lamps = [];   // 스탠드 없음 (옛 코드 호환용)

  // 입구 — 맨 윗단 위. 들어서면 전체가 내려다보인다.
  const spawn = { x: 0, z: (CINEMA.z0 + (CINEMA.rows - 1) * CINEMA.rowGap + BOUND.z1) / 2 };

  /* ---- 충돌 ------------------------------------------------------
   *  가구를 '회전한 사각형(OBB)' 그대로 다룬다. 외접 사각형으로 근사하면
   *  비스듬한 의자 주변에 보이지 않는 벽이 생겨 걸리적거린다.
   *  top = 그 가구의 올라설 수 있는 높이. 그보다 높이 떠 있으면 통과한다.
   *  mode = 그 모드에서만 존재한다 (없으면 늘 있다).
   * ---------------------------------------------------------------- */
  const TOP = {            // 가구별 윗면 높이 (m)
    chair: 0.46, step: 0.12, stair: 0.11, stage: 0.84,
    tree: 2.2, gift: 0.4,
    sofa: 0.44, rtable: 0.45,
    shelf: 1.55, plant: 1.10, speaker: 1.05
  };

  const solids = [];
  furniture.forEach((f) => {
    const top = (f.top !== undefined) ? f.top : (TOP[f.type] || 1.0);
    solids.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rot, top: top, id: f.id, mode: f.mode });
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
      if (!inMode(s.mode)) continue;
      const l = toLocal(s, x, z);
      if (Math.abs(l.x) < s.w / 2 && Math.abs(l.z) < s.d / 2 && s.top > g) g = s.top;
    }
    return g;
  }

  /* 이 정도 턱은 그냥 넘어간다.
   *  EPS 를 두는 이유 — 계단 높이는 0.84 - 6 * 0.12 같은 식으로 나오는데
   *  부동소수점이라 결과가 0.12000000000000011 이 된다. 눈에는 딱 한 칸인
   *  계단이 "0.12 보다 높다" 는 이유로 벽이 되어 버린다. */
  const STEP = 0.12;
  const STEP_EPS = 1e-6;

  /* 몸이 딛고 설 수 있는 가장 높은 윗면.
   *
   *  발밑 한 점만 보면 계단을 영영 못 올라간다 — 계단 한 칸 깊이(32cm)가
   *  사람 몸 반지름(32cm)보다 얕아서, 발이 아랫칸에 닿기도 전에 몸이 윗칸에
   *  걸리기 때문이다. 그래서 몸 둘레에 닿는 것까지 보고, 한 칸씩 올라설 수
   *  있는 것들은 디딤대로 쳐 준다.
   *
   *        ┌───┐ ← 몸이 여기 걸린다
   *     ┌──┤   │    발은 아직 아랫칸     → 한 점만 보면 '벽'
   *     │  └───┘                        → 둘레를 보면 '디딤대'
   *
   *  한 칸(STEP)씩만 타고 오르므로, 계단 없는 단이나 의자는 그대로 막힌다. */
  function supportAt(x, z, r, feet) {
    let sup = feet;
    for (let pass = 0; pass < 4; pass++) {
      let grew = false;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (!inMode(s.mode)) continue;
        if (s.top <= sup || s.top > sup + STEP + STEP_EPS) continue;
        const l = toLocal(s, x, z);
        if (Math.abs(l.x) < s.w / 2 + r && Math.abs(l.z) < s.d / 2 + r) { sup = s.top; grew = true; }
      }
      if (!grew) break;                 // 더 올라탈 것이 없다
    }
    return sup;
  }

  /* y = 발바닥 높이. 가구 윗면보다 높이 떠 있으면 그 가구는 통과한다. */
  function collide(x, z, r, y) {
    const feet = supportAt(x, z, r, y || 0);
    for (let pass = 0; pass < 3; pass++) {
      x = Math.max(BOUND.x0 + r, Math.min(BOUND.x1 - r, x));
      z = Math.max(BOUND.z0 + r, Math.min(BOUND.z1 - r, z));
      let moved = false;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (!inMode(s.mode)) continue;
        if (s.top <= feet + STEP + STEP_EPS) continue;   // 뛰어넘는 중이거나 이미 위에 올라섬
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
   *  영화관은 의자 하나가 자리 하나, 노래방은 소파를 일정 간격으로 나눈다.
   *  각 자리 앞(다리 공간)에 '들어서면 앉는 구역' 을 둔다. 가구 자체는
   *  막혀 있어 걸어 들어갈 수 없으므로, 구역은 가구 바로 앞에 깐다.
   *
   *        ┌──────┐   ← 의자·소파 (막힘)
   *        ┊ 구역 ┊   ← 여기 들어서면 자동으로 앉는다
   *          통로
   *
   *  자리 번호는 두 모드를 통틀어 한 번만 매긴다. 서버가 들고 있는 번호가
   *  모드가 바뀌어도 다른 자리를 가리키지 않게 하려는 것이다 —
   *  지금 모드가 아닌 자리는 seatAt 이 그냥 건너뛴다.
   * ------------------------------------------------------------------ */
  //  의자가 넓어진 만큼 앉는 구역도 같이 넓힌다 — 안 그러면 넓은 의자
  //  가장자리에 서 있어도 앉히지 않는다.
  const SEAT_ZONE = { w: 0.55, d: 0.14, off: 0.78 };   // 반폭 · 반깊이 · 의자에서 앞으로

  const seats = [];
  furniture.forEach((f) => {
    if (f.type === 'chair') {
      seats.push({
        i: seats.length, id: f.id, mode: f.mode,
        x: f.x, z: f.z - 0.04, rot: f.rot,      // 앉았을 때 설 자리
        y: f.y || 0,                            // 그 줄의 바닥 높이
        row: f.row || 0,
        zx: f.x, zz: f.z - SEAT_ZONE.off,       // 감지 구역 한가운데
        zw: SEAT_ZONE.w, zd: SEAT_ZONE.d
      });
      return;
    }
    if (f.type !== 'sofa') return;

    /* 소파 — 길이를 1.2m 쯤으로 나눠 그만큼 자리를 둔다.
     * 로컬(소파를 따라 lx, 앞뒤 lz)로 잡은 뒤 월드로 돌린다. */
    const n = Math.max(2, Math.round(f.w / 1.2));
    for (let i = 0; i < n; i++) {
      const lx = -f.w / 2 + (i + 0.5) * (f.w / n);
      const sit = toWorld(f, lx, -0.06);
      const zone = toWorld(f, lx, -(f.d / 2 + 0.34));
      seats.push({
        i: seats.length, id: f.id + '_' + i, mode: f.mode,
        x: sit.x, z: sit.z, rot: f.rot,
        y: f.y || 0, row: 0,
        zx: zone.x, zz: zone.z,
        zw: (f.w / n) / 2 - 0.05, zd: 0.22
      });
    }
  });

  /* 발밑 (x,z) 가 어느 자리의 감지 구역 안인가 — 없으면 -1.
   *  y 는 발 높이. 단이 다른 줄의 구역에 잘못 걸리지 않게 같은 높이만 본다.
   *  소파는 돌아가 있으므로 구역도 같이 돌려 놓고 본다. */
  function seatAt(x, z, y) {
    const feet = y || 0;
    for (let i = 0; i < seats.length; i++) {
      const st = seats[i];
      if (!inMode(st.mode)) continue;
      if (Math.abs(st.y - feet) > 0.09) continue;
      let dx = x - st.zx, dz = z - st.zz;
      if (st.rot) {
        const c = Math.cos(st.rot), sn = Math.sin(st.rot);
        const nx = dx * c + dz * sn;
        dz = -dx * sn + dz * c;
        dx = nx;
      }
      if (Math.abs(dx) <= st.zw && Math.abs(dz) <= st.zd) return i;
    }
    return -1;
  }

  /* 이 자리가 지금 모드에서 쓸 수 있나 — 모드가 바뀌면 서버가 일으켜 세운다 */
  function seatUsable(i) {
    const st = seats[i | 0];
    return !!st && inMode(st.mode);
  }

  return {
    W: W, D: D, H: H, WALL: WALL, BOUND: BOUND,
    placeOnWall: placeOnWall,
    TV: TV, BOARD: BOARD, NEON: NEON, plaques: plaques,
    CARPET: CARPET, CARPETS: CARPETS, furniture: furniture, lamps: lamps, solids: solids,
    LIGHT: LIGHT,
    COVE: COVE, STRIP: STRIP, CEIL_LIGHTS: CEIL_LIGHTS, FLOOR_LIGHTS: FLOOR_LIGHTS,
    PROJECTOR: PROJECTOR, MIRROR: MIRROR, STAGE: STAGE,
    XMAS: XMAS, wreaths: wreaths,
    seats: seats, seatAt: seatAt, seatUsable: seatUsable,
    SEAT_ZONE: SEAT_ZONE, CINEMA: CINEMA, KARA: KARA,
    setMode: setMode, getMode: getMode,
    spawn: spawn, collide: collide, moveVector: moveVector,
    groundAt: groundAt, TOP: TOP, STEP: STEP,
    BOX_DEPTH: BOX_DEPTH, PLATE_DEPTH: PLATE_DEPTH, FACE_Z: FACE_Z
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ROOM3D;
