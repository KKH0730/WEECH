/* ------------------------------------------------------------------
 *  scene3d.js — 방을 실제 3D 로 짓는다
 *
 *  WebGL 캔버스는 투명하게 두고, TV 자리에는 '구멍'만 뚫는다.
 *  그 뒤에 CSS3DRenderer 가 같은 카메라 행렬로 YouTube iframe 을 놓는다.
 *  → 벽에 걸린 TV 가 원근까지 맞아떨어진다.
 * ------------------------------------------------------------------ */
import * as THREE from 'three';

const R = ROOM3D;

/* 작은 캔버스 텍스처 만들기 */
function canvasTex(THREE_, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, canvas: c };
}

function mat(color, rough, metal) {
  return new THREE.MeshStandardMaterial({
    color: color,
    roughness: rough === undefined ? 0.92 : rough,
    metalness: metal === undefined ? 0.02 : metal
  });
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

/* 발밑/가구 밑에 깔리는 가짜 그림자.
 * 무늬는 어디나 같으므로 한 장만 만들어 모두가 나눠 쓴다 — 가구마다
 * 새로 그리면 128×128 캔버스가 백 장 넘게 생긴다. */
let blobTex = null;
function blob(radius, opacity) {
  if (!blobTex) {
    blobTex = canvasTex(THREE, 128, 128, (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grd.addColorStop(0, 'rgba(0,0,0,.6)');
      grd.addColorStop(0.55, 'rgba(0,0,0,.26)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    }).tex;
  }
  const tex = blobTex;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opacity || 0.7 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  return m;
}

export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(0x14121a, 32, 72);   // 넓고 높은 방 — 안개를 더 멀리

  const collidables = [];     // 화살이 꽂힐 수 있는 것들
  const api = { scene: scene, collidables: collidables, lampLights: [], tvLight: null };

  /* ---------------- 바닥 ---------------- */
  const floorTex = canvasTex(THREE, 512, 512, (g, w, h) => {
    g.fillStyle = '#4a3b33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#523f36' : '#45372f';
      g.fillRect(0, i * (h / 8), w, h / 8 - 2);
    }
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(0, i * (h / 8)); g.lineTo(w, i * (h / 8)); g.stroke();
    }
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = 'rgba(0,0,0,.08)';
      const x = Math.random() * w, y = Math.floor(Math.random() * 8) * (h / 8);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h / 8); g.stroke();
    }
  });
  floorTex.tex.wrapS = floorTex.tex.wrapT = THREE.RepeatWrapping;
  floorTex.tex.repeat.set(4, 3);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(R.W, R.D),
    new THREE.MeshStandardMaterial({ map: floorTex.tex, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  scene.add(floor);
  collidables.push(floor);

  /* ---------------- 벽 / 천장 ---------------- */
  const wallMat = mat(0x262031, 0.95);
  const wallDefs = [
    { w: R.W, x: 0, y: R.H / 2, z: -R.D / 2, ry: 0 },             // 북 (TV)
    { w: R.W, x: 0, y: R.H / 2, z: R.D / 2, ry: Math.PI },        // 남
    { w: R.D, x: -R.W / 2, y: R.H / 2, z: 0, ry: Math.PI / 2 },   // 서
    { w: R.D, x: R.W / 2, y: R.H / 2, z: 0, ry: -Math.PI / 2 }    // 동
  ];
  wallDefs.forEach((d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, R.H), wallMat);
    m.position.set(d.x, d.y, d.z);
    m.rotation.y = d.ry;
    m.name = 'wall';
    scene.add(m);
    collidables.push(m);
  });

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(R.W, R.D), mat(0x241f2d, 0.95));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = R.H;
  scene.add(ceil);

  // 걸레받이
  const baseMat = mat(0x201b28, 0.9);
  scene.add(box(R.W, 0.14, 0.06, baseMat, 0, 0.07, -R.D / 2 + 0.03));
  scene.add(box(R.W, 0.14, 0.06, baseMat, 0, 0.07, R.D / 2 - 0.03));
  scene.add(box(0.06, 0.14, R.D, baseMat, -R.W / 2 + 0.03, 0.07, 0));
  scene.add(box(0.06, 0.14, R.D, baseMat, R.W / 2 - 0.03, 0.07, 0));

  /* ---------------- 카펫 ---------------- */
  const carpetTex = canvasTex(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = '#6d272c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(226,178,120,.28)'; g.lineWidth = 6;
    g.strokeRect(16, 16, w - 32, h - 32);
    g.strokeStyle = 'rgba(226,178,120,.14)'; g.lineWidth = 3;
    g.strokeRect(30, 30, w - 60, h - 60);
  });
  const carpetMat = new THREE.MeshStandardMaterial({ map: carpetTex.tex, roughness: 1 });
  (R.CARPETS || [R.CARPET]).forEach((c) => {
    if (!c) return;
    const rug = new THREE.Mesh(new THREE.BoxGeometry(c.w, 0.02, c.d), carpetMat);
    rug.position.set(c.x, (c.y || 0) + 0.011, c.z);   // 단상·계단 위에도 깐다
    scene.add(rug);
  });

  /* 벽에 거는 물건의 자리 — 벽면에서 안쪽(방 쪽)으로 off 만큼 띄운다 */
  function onWall(item, off) {
    const p = R.placeOnWall(item);
    const nx = Math.sin(p.ry), nz = Math.cos(p.ry);
    return {
      x: p.x + nx * (off || 0), y: p.y, z: p.z + nz * (off || 0),
      ry: p.ry, nx: nx, nz: nz
    };
  }
  api.onWall = onWall;

  /* ---------------- TV (정면 벽) ---------------- */
  const T = R.TV;
  const tvAt = onWall(T, 0);
  api.tvTransform = tvAt;

  const bezel = box(T.w + 0.18, T.h + 0.18, 0.1, mat(0x101014, 0.6, 0.3), 0, 0, -0.04);
  const tvGrp = new THREE.Group();
  tvGrp.position.set(tvAt.x, tvAt.y, tvAt.z);
  tvGrp.rotation.y = tvAt.ry;
  tvGrp.add(bezel);
  // 사운드바
  tvGrp.add(box(T.w * 0.62, 0.12, 0.15, mat(0x17151c, 0.7), 0, -T.h / 2 - 0.24, 0.02));
  bezel.name = 'tv';
  scene.add(tvGrp);
  collidables.push(bezel);

  // CSS3D iframe 이 비쳐 나올 '구멍'
  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(T.w, T.h),
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending })
  );
  hole.position.set(tvAt.x + tvAt.nx * 0.02, tvAt.y, tvAt.z + tvAt.nz * 0.02);
  hole.rotation.y = tvAt.ry;
  hole.renderOrder = 1;
  scene.add(hole);
  api.tvHole = hole;

  /* 음정 띠 — 노래방에서 스크린 아랫부분에 겹쳐 띄운다.
   *  구멍(hole)은 renderOrder 1 로 알파를 0 으로 덮어쓴다. 이 띠는 그보다
   *  4cm 앞에 두고 renderOrder 를 더 뒤로 줘, 구멍이 뚫린 자리를 다시 칠한다.
   *  캔버스 2048×256 = 8:1 이라 가로 12m 에 맞추면 높이가 정확히 1.5m 가 된다. */
  const pitchRes = canvasTex(THREE, 2048, 256, (g, w, h) => { g.clearRect(0, 0, w, h); });
  const PB_H = T.w * 256 / 2048;
  const pitchMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(T.w, PB_H),
    new THREE.MeshBasicMaterial({ map: pitchRes.tex, transparent: true, depthWrite: false })
  );
  pitchMesh.position.set(
    tvAt.x + tvAt.nx * 0.06,
    T.y - T.h / 2 + PB_H / 2 + 0.15,        // 스크린 아랫변에서 조금 띄운다
    tvAt.z + tvAt.nz * 0.06
  );
  pitchMesh.rotation.y = tvAt.ry;
  pitchMesh.renderOrder = 4;
  pitchMesh.visible = false;
  scene.add(pitchMesh);
  api.pitchCanvas = pitchRes.canvas;
  api.pitchTexture = pitchRes.tex;
  api.setPitchVisible = function (v) { pitchMesh.visible = !!v; };

  /* 음정 게임모드 로딩 — 분석이 끝날 때까지 스크린 전체를 덮는다.
   *  구멍보다 앞(5cm)에 두고 renderOrder 를 뒤로 줘, 뚫린 자리를 다시 칠한다. */
  const loadRes = canvasTex(THREE, 1024, 576, (g, w, h) => { g.clearRect(0, 0, w, h); });
  const loadMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(T.w, T.h),
    new THREE.MeshBasicMaterial({ map: loadRes.tex, transparent: true, depthWrite: false })
  );
  loadMesh.position.set(tvAt.x + tvAt.nx * 0.05, T.y, tvAt.z + tvAt.nz * 0.05);
  loadMesh.rotation.y = tvAt.ry;
  loadMesh.renderOrder = 3;
  loadMesh.visible = false;
  scene.add(loadMesh);
  api.loadCanvas = loadRes.canvas;
  api.loadTexture = loadRes.tex;
  api.setLoadVisible = function (v) { loadMesh.visible = !!v; };

  // 화면이 뿜는 빛
  const tvLight = new THREE.PointLight(0x88aaff, R.LIGHT.tv, 14, 2);
  tvLight.position.set(tvAt.x + tvAt.nx * 1.2, tvAt.y, tvAt.z + tvAt.nz * 1.2);
  scene.add(tvLight);
  api.tvLight = tvLight;

  /* ---------------- 재생목록 전광판 (오른쪽 벽) ---------------- */
  const boardRes = canvasTex(THREE, 560, 1200, (g, w, h) => {
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, w, h);
  });
  const bAt = onWall(R.BOARD, 0);
  const boardGrp = new THREE.Group();
  boardGrp.position.set(bAt.x, bAt.y, bAt.z);
  boardGrp.rotation.y = bAt.ry;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(R.BOARD.w, R.BOARD.h),
    new THREE.MeshBasicMaterial({ map: boardRes.tex })
  );
  board.position.z = R.FACE_Z;       // 상자 앞면보다 앞 — Z-파이팅 방지
  board.name = 'board';
  boardGrp.add(board);
  boardGrp.add(box(R.BOARD.w + 0.1, R.BOARD.h + 0.1, R.BOX_DEPTH, mat(0x15131a, 0.7), 0, 0, 0));
  scene.add(boardGrp);
  collidables.push(board);
  // 전광판이 뿜는 푸른빛
  const boardLight = new THREE.PointLight(0x6ec8ff, R.LIGHT.board, 7, 2);
  boardLight.position.set(bAt.x + bAt.nx * 0.8, bAt.y, bAt.z + bAt.nz * 0.8);
  scene.add(boardLight);
  api.boardCanvas = boardRes.canvas;
  api.boardTexture = boardRes.tex;

  /* ---------------- 스크린 위 네온 간판 ----------------
   *  지금 트는 곡을 띄운다. 글자는 캔버스로 그리고 MeshBasicMaterial 로 붙여
   *  방 조명과 무관하게 스스로 빛난다. 벽에는 PointLight 로 분홍빛이 번진다. */
  const neonRes = canvasTex(THREE, 2048, 160, (g, w, h) => { g.clearRect(0, 0, w, h); });
  neonRes.tex.premultiplyAlpha = false;
  const nAt = onWall(R.NEON, 0);
  const neonGrp = new THREE.Group();
  neonGrp.position.set(nAt.x, nAt.y, nAt.z);
  neonGrp.rotation.y = nAt.ry;
  // 간판 바탕 — 글자가 떠 보이게 어둡게 깐다
  neonGrp.add(box(R.NEON.w + 0.3, R.NEON.h + 0.24, R.BOX_DEPTH, mat(0x100d15, 0.55), 0, 0, 0));
  const neon = new THREE.Mesh(
    new THREE.PlaneGeometry(R.NEON.w, R.NEON.h),
    new THREE.MeshBasicMaterial({ map: neonRes.tex, transparent: true, depthWrite: false })
  );
  neon.position.z = R.FACE_Z;        // 바탕 앞면보다 앞 — Z-파이팅 방지
  neon.name = 'neon';
  neonGrp.add(neon);
  scene.add(neonGrp);

  const neonLight = new THREE.PointLight(0xff58b0, R.LIGHT.neon, 9, 2);
  neonLight.position.set(nAt.x + nAt.nx * 0.9, nAt.y - 0.2, nAt.z + nAt.nz * 0.9);
  scene.add(neonLight);

  api.neonCanvas = neonRes.canvas;
  api.neonTexture = neonRes.tex;
  api.neonLight = neonLight;
  api.neonMesh = neon;
  collidables.push(neon);

  /* ---------------- 실버 / 골드 버튼 (왼쪽 벽) ---------------- */
  R.plaques.forEach((p) => {
    const gold = p.kind === 'gold';
    const at = onWall(p, 0);
    const plate = canvasTex(THREE, 256, 256, (g, w, h) => {
      g.fillStyle = '#131117'; g.fillRect(0, 0, w, h);
      g.strokeStyle = gold ? 'rgba(226,178,74,.85)' : 'rgba(198,202,210,.75)';
      g.lineWidth = 8; g.strokeRect(12, 12, w - 24, h - 24);
      const grd = g.createLinearGradient(50, 70, 210, 190);
      if (gold) { grd.addColorStop(0, '#f7dd95'); grd.addColorStop(0.5, '#d9a93c'); grd.addColorStop(1, '#8a6418'); }
      else { grd.addColorStop(0, '#f2f4f7'); grd.addColorStop(0.5, '#b9bec8'); grd.addColorStop(1, '#787f8b'); }
      g.fillStyle = grd;
      g.beginPath(); g.roundRect(56, 74, 144, 100, 22); g.fill();
      g.fillStyle = '#14121a';
      g.beginPath(); g.moveTo(108, 100); g.lineTo(156, 124); g.lineTo(108, 148); g.closePath(); g.fill();
      g.fillStyle = gold ? 'rgba(226,178,74,.9)' : 'rgba(198,202,210,.85)';
      g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
      g.fillText(p.label, w / 2, 212);
    });
    const grp = new THREE.Group();
    grp.position.set(at.x, at.y, at.z);
    grp.rotation.y = at.ry;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(p.s, p.s),
      new THREE.MeshStandardMaterial({ map: plate.tex, roughness: 0.4, metalness: 0.35 })
    );
    m.position.z = R.FACE_Z;
    m.name = 'plaque';
    grp.add(m);
    grp.add(box(p.s + 0.07, p.s + 0.07, R.PLATE_DEPTH, mat(0x0f0d13, 0.8), 0, 0, 0));
    scene.add(grp);
    collidables.push(m);
  });

  /* ---------------- 액자 (왼쪽 벽) ---------------- */
  R.frames.forEach((f, i) => {
    const at = onWall(f, 0);
    const art = canvasTex(THREE, 256, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'hsl(' + f.hue + ',42%,38%)');
      grd.addColorStop(1, 'hsl(' + ((f.hue + 45) % 360) + ',34%,16%)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.16)';
      if (i % 2) {
        g.beginPath(); g.arc(w * 0.66, h * 0.33, w * 0.14, 0, 6.2832); g.fill();
        g.fillRect(0, h * 0.64, w, h * 0.36);
      } else {
        g.beginPath();
        g.moveTo(w * 0.1, h * 0.88); g.lineTo(w * 0.5, h * 0.26); g.lineTo(w * 0.9, h * 0.88);
        g.closePath(); g.fill();
      }
    });
    const pic = new THREE.Mesh(
      new THREE.PlaneGeometry(f.w * 0.84, f.h * 0.84),
      new THREE.MeshStandardMaterial({ map: art.tex, roughness: 0.8 })
    );
    pic.position.z = R.FACE_Z;
    const frame = box(f.w, f.h, R.BOX_DEPTH, mat(0x6a5540, 0.75), 0, 0, 0);
    const grp = new THREE.Group();
    grp.add(pic); grp.add(frame);
    grp.position.set(at.x, at.y, at.z);
    grp.rotation.y = at.ry;
    grp.name = 'frame';
    scene.add(grp);
    collidables.push(pic, frame);
  });

  /* ---------------- 가구 ---------------- */
  const fabric = mat(0x5e4a6b, 0.95);
  const fabric2 = mat(0x6f5880, 0.95);
  const dark = mat(0x3b3146, 0.9);
  const wood = mat(0x5a4132, 0.85);
  const riser = mat(0x2a2430, 0.95);
  const wood2 = mat(0x75563f, 0.8);

  /* 모드에 따라 오르내리는 가구를 여기 모은다.
   *   영화관 : 의자는 바닥 아래로 내려가고, 단은 높이가 0 으로 줄어든다
   *   노래방 : 소파와 테이블이 바닥에서 올라온다
   * 충돌은 roomdef 가 모드 바뀌는 즉시 갈아 끼우고, 여기서는 보이는 것만 맡는다. */
  const modeFurn = [];
  const doors = [];           // 의자가 내려갈 때 바닥에 열리는 어두운 구멍

  R.furniture.forEach((f) => {
    const g = new THREE.Group();
    g.position.set(f.x, f.y || 0, f.z);
    g.rotation.y = f.rot;
    g.name = f.type;

    if (f.type === 'chair') {
      // 영화관 의자 — 방석 · 등받이 · 팔걸이 둘 · 받침대
      const w = f.w, d = f.d;
      g.add(box(w - 0.22, 0.14, d - 0.2, fabric2, 0, 0.4, -0.03));          // 방석
      g.add(box(w - 0.16, 0.66, 0.16, fabric, 0, 0.72, d / 2 - 0.08));      // 등받이
      g.add(box(0.11, 0.3, d - 0.12, dark, -w / 2 + 0.055, 0.56, 0));       // 팔걸이
      g.add(box(0.11, 0.3, d - 0.12, dark, w / 2 - 0.055, 0.56, 0));
      g.add(box(w - 0.3, 0.33, 0.22, dark, 0, 0.165, 0));                   // 받침대
    } else if (f.type === 'step' || f.type === 'stair') {
      // 뒷줄을 한 단 올리는 단, 그리고 통로를 오르내리는 작은 계단.
      // 윗면만 보이면 되므로 상자 하나에 코끝 유도등을 붙인다.
      g.add(box(f.w, Math.max(0.02, f.top), f.d, riser, 0, f.top / 2, 0));
      g.add(box(f.w, 0.02, 0.05, mat(0xd98d4e, 0.4), 0, f.top + 0.01, -f.d / 2 + 0.03));
    } else if (f.type === 'stage') {
      /* 스크린 아래 단상. 옆면은 어둡게 두고 모서리에만 놋쇠 띠를 둘러
       * 붉은 카펫과 경계가 서게 한다. 윗면은 카펫이 덮으므로 비워 둔다. */
      g.add(box(f.w, f.top, f.d, riser, 0, f.top / 2, 0));
      const brass = mat(0xb08a4e, 0.45, 0.6);
      g.add(box(f.w + 0.06, 0.05, f.d + 0.06, brass, 0, f.top - 0.025, 0));   // 테두리
      g.add(box(f.w + 0.04, 0.03, 0.04, mat(0xd98d4e, 0.4), 0, 0.09, f.d / 2));  // 발치 유도등
    } else if (f.type === 'sofa') {
      /* 노래방 소파 — 길게 뻗은 한 토막. 로컬 x 가 길이, +z 쪽이 등받이.
       * 앉는 면 0.44, 등받이 꼭대기 0.95 (roomdef 의 KARA 와 맞춰 둔다) */
      const w = f.w, d = f.d;
      g.add(box(w, 0.28, d, dark, 0, 0.14, 0));                            // 받침
      g.add(box(w - 0.12, 0.17, d - 0.2, fabric2, 0, 0.355, -0.03));       // 방석
      g.add(box(w, 0.52, 0.22, fabric, 0, 0.69, d / 2 - 0.11));            // 등받이
      g.add(box(0.16, 0.3, d - 0.06, dark, -w / 2 + 0.08, 0.59, 0));       // 팔걸이
      g.add(box(0.16, 0.3, d - 0.06, dark, w / 2 - 0.08, 0.59, 0));
      // 방석 사이 이음새 — 한 덩이로 보이지 않게
      const n = Math.max(2, Math.round(w / 1.2));
      for (let i = 1; i < n; i++) {
        g.add(box(0.04, 0.19, d - 0.2, dark, -w / 2 + i * (w / n), 0.36, -0.03));
      }
      // 등받이에 기대 둔 쿠션 몇 개
      for (let i = 0; i < n; i++) {
        if (i % 2) continue;
        const c = box(0.34, 0.34, 0.14, fabric2, -w / 2 + (i + 0.5) * (w / n), 0.6, d / 2 - 0.27);
        c.rotation.x = 0.22; g.add(c);
      }
    } else if (f.type === 'rtable') {
      /* 노래방 원형 테이블 — 소파 한가운데. 위에 마이크 두 대를 얹어 둔다. */
      const rad = f.w / 2, h = f.top;
      const topM = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.08, 40), wood2);
      topM.position.y = h - 0.04; g.add(topM);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.035, 8, 44), mat(0x2c2531, 0.6, 0.3));
      rim.rotation.x = Math.PI / 2; rim.position.y = h - 0.04; g.add(rim);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, h - 0.1, 16), wood);
      post.position.y = (h - 0.1) / 2; g.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.07, 24), mat(0x2c2531, 0.7, 0.3));
      foot.position.y = 0.035; g.add(foot);
      // 마이크 두 대
      for (let i = 0; i < 2; i++) {
        const mic = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.26, 10), mat(0x1d1a22, 0.5, 0.4));
        body.rotation.z = Math.PI / 2; mic.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), mat(0x8e8e96, 0.4, 0.7));
        head.position.x = 0.15; mic.add(head);
        mic.position.set(i ? 0.55 : -0.55, h + 0.05, i ? -0.3 : 0.3);
        mic.rotation.y = i ? 0.6 : -0.6;
        g.add(mic);
      }
    } else if (f.type === 'table') {
      g.add(box(f.w, 0.07, f.d, wood2, 0, 0.42, 0));
      [[-f.w / 2 + 0.14, -f.d / 2 + 0.14], [f.w / 2 - 0.14, -f.d / 2 + 0.14],
       [-f.w / 2 + 0.14, f.d / 2 - 0.14], [f.w / 2 - 0.14, f.d / 2 - 0.14]].forEach((p) => {
        g.add(box(0.08, 0.4, 0.08, wood, p[0], 0.2, p[1]));
      });
      // 올려둔 컵과 리모컨
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.1, 12), mat(0xe8e2d6, 0.5));
      cup.position.set(-0.4, 0.5, 0.1); g.add(cup);
      g.add(box(0.06, 0.02, 0.17, mat(0x23202a, 0.6), 0.35, 0.46, 0));
    } else if (f.type === 'shelf') {
      g.add(box(f.w, 1.5, f.d, wood, 0, 0.75, 0));
      for (let s = 0; s < 3; s++) {
        g.add(box(f.w + 0.04, 0.03, f.d, wood2, 0, 0.42 + s * 0.42, 0));
        const cols = [0xc9553f, 0x4a7fb5, 0xd9a93c, 0x6b9a5f, 0x9b6fd4];
        for (let b = 0; b < 6; b++) {
          g.add(box(0.1, 0.26, 0.05,
            mat(cols[(s * 6 + b) % cols.length], 0.9),
            0, 0.57 + s * 0.42, -f.d / 2 + 0.2 + b * 0.33));
        }
      }
    } else if (f.type === 'plant') {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.16, 0.34, 14), mat(0x8a5436, 0.9));
      pot.position.y = 0.17; g.add(pot);
      const leafMat = mat(0x3f7a4a, 0.95);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), leafMat);
        leaf.position.set(Math.cos(a) * 0.17, 0.56 + (i % 3) * 0.14, Math.sin(a) * 0.17);
        leaf.scale.set(1, 0.7, 1);
        g.add(leaf);
      }
    } else if (f.type === 'speaker') {
      g.add(box(0.34, 1.0, 0.3, mat(0x1d1a22, 0.8), 0, 0.5, 0));
      const cone = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), mat(0x0d0c10, 0.6));
      cone.position.set(0, 0.68, 0.151); g.add(cone);
      const cone2 = cone.clone(); cone2.position.y = 0.36; cone2.scale.setScalar(0.7); g.add(cone2);
    }

    g.traverse((o) => { if (o.isMesh) collidables.push(o); });

    /* 그림자는 묶음 안에 넣는다 — 가구가 바닥으로 내려갈 때 같이 따라가야 한다.
     * 광선 검사(collidables)에 들어가면 안 되므로 traverse 뒤에 붙인다. */
    if (f.type !== 'step' && f.type !== 'stair') {
      const rad = Math.max(f.w, f.d) * 0.6;
      const sh = blob(rad, 0.55);
      sh.scale.set(f.w * 0.8 / (rad * 2), f.d * 1.1 / (rad * 2), 1);
      sh.position.set(0, 0.013, 0);
      g.add(sh);
    }
    scene.add(g);

    if (f.mode) {
      const y0 = f.y || 0;
      modeFurn.push({
        g: g, mode: f.mode, y0: y0,
        tier: (f.type === 'step' || f.type === 'stair'),
        // 영화관 것은 제 단 높이만큼 더 내려가야 바닥 밑으로 완전히 숨는다
        sink: (f.mode === 'cinema') ? y0 + 1.7 : 1.5
      });
      // 의자가 내려가는 자리 — 바닥이 열린 것처럼 어둡게 뚫린다
      if (f.type === 'chair') {
        const d = blob(Math.max(f.w, f.d) * 0.62, 0);
        d.material.color.setScalar(0);
        d.position.set(f.x, y0 + 0.016, f.z);
        d.visible = false;
        scene.add(d);
        doors.push({ m: d, y0: y0 });
      }
    }
  });

  /* ---------------- 천장 코브 조명 ---------------- */
  const C = R.COVE;
  const coveMat = new THREE.MeshBasicMaterial({ color: 0xcdb896 });
  const coveLipMat = mat(0x241f2c, 0.9);
  const ci = C.inset;
  [
    { w: R.W - ci * 2, d: C.w, x: 0, z: -R.D / 2 + ci },
    { w: R.W - ci * 2, d: C.w, x: 0, z: R.D / 2 - ci },
    { w: C.w, d: R.D - ci * 2, x: -R.W / 2 + ci, z: 0 },
    { w: C.w, d: R.D - ci * 2, x: R.W / 2 - ci, z: 0 }
  ].forEach((b) => {
    // 빛나는 띠
    scene.add(box(b.w, 0.05, b.d, coveMat, b.x, C.y, b.z));
    // 아래를 가리는 턱 — 광원이 직접 보이지 않고 천장만 밝아 보이게
    scene.add(box(b.w + 0.1, 0.16, b.d + 0.1, coveLipMat, b.x, C.y - 0.12, b.z));
  });

  R.CEIL_LIGHTS.forEach((p) => {
    const l = new THREE.PointLight(0xffe9d0, R.LIGHT.ceil, 30, 2);
    l.userData.base = R.LIGHT.ceil;        // 재생 중에 낮출 때 돌아올 자리
    l.position.set(p.x, C.y + 0.18, p.z);
    scene.add(l);
    api.lampLights.push(l);
  });

  /* ---------------- 하단 간접 조명 (영화관 통로등) ---------------- */
  const S = R.STRIP;
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xd98d4e });
  const si = S.inset;
  [
    { w: R.W - 0.3, d: 0.05, x: 0, z: -R.D / 2 + si },
    { w: R.W - 0.3, d: 0.05, x: 0, z: R.D / 2 - si },
    { w: 0.05, d: R.D - 0.3, x: -R.W / 2 + si, z: 0 },
    { w: 0.05, d: R.D - 0.3, x: R.W / 2 - si, z: 0 }
  ].forEach((b) => {
    scene.add(box(b.w, S.h, b.d, stripMat, b.x, S.y, b.z));
    // 위를 살짝 덮어 광원이 직접 보이지 않게
    scene.add(box(b.w + 0.04, 0.03, b.d + 0.06, mat(0x1d1826, 0.85), b.x, S.y + S.h / 2 + 0.02, b.z));
  });

  R.FLOOR_LIGHTS.forEach((p) => {
    const l = new THREE.PointLight(0xff9e52, R.LIGHT.floor, 10, 2);
    l.userData.base = R.LIGHT.floor;
    l.position.set(p.x, S.y + 0.1, p.z);
    scene.add(l);
    api.lampLights.push(l);
  });

  /* ---------------- 영사기 (뒷쪽 중앙 천장) ---------------- */
  const PJ = R.PROJECTOR;
  const lensZ = PJ.z - PJ.d / 2 - 0.04;                  // 렌즈가 나온 자리
  const screenY = tvAt.y, screenZ = tvAt.z;

  const projGrp = new THREE.Group();
  projGrp.position.set(PJ.x, PJ.y, PJ.z);
  // 화면 쪽으로 살짝 숙인다
  projGrp.rotation.x = -Math.atan2(PJ.y - screenY, PJ.z - screenZ);

  const metal = mat(0x262430, 0.45, 0.5);
  projGrp.add(box(PJ.w, PJ.h, PJ.d, metal, 0, 0, 0));
  projGrp.add(box(PJ.w * 0.72, 0.04, PJ.d * 0.5, mat(0x15141a, 0.6), 0, PJ.h / 2 + 0.02, 0));
  // 방열구
  for (let i = 0; i < 4; i++) {
    projGrp.add(box(0.02, PJ.h * 0.5, PJ.d * 0.6, mat(0x101017, 0.7), PJ.w / 2 + 0.005, 0, -0.02 + i * 0.0));
  }
  // 렌즈
  const lensRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.095, 0.095, 0.09, 18),
    mat(0x1a1920, 0.4, 0.6)
  );
  lensRing.rotation.x = Math.PI / 2;
  lensRing.position.z = -PJ.d / 2 - 0.03;
  projGrp.add(lensRing);
  const lensGlass = new THREE.Mesh(
    new THREE.CircleGeometry(0.07, 18),
    new THREE.MeshBasicMaterial({ color: 0xbfd8ff })
  );
  lensGlass.position.z = -PJ.d / 2 - 0.08;
  lensGlass.rotation.y = Math.PI;
  projGrp.add(lensGlass);
  api.projectorLens = lensGlass;

  // 천장에 매단 봉
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, R.H - PJ.y - PJ.h / 2, 10), metal);
  rod.position.set(PJ.x, (R.H + PJ.y + PJ.h / 2) / 2, PJ.z);

  /* 영사기 한 벌(본체·봉·천장판·빔)을 한 묶음으로 묶는다.
   * 모드가 바뀌면 이 묶음째 천장으로 걷혀 올라갔다 다시 내려온다. */
  const cineGrp = new THREE.Group();
  cineGrp.add(rod);
  cineGrp.add(box(0.26, 0.04, 0.26, metal, PJ.x, R.H - 0.02, PJ.z));
  cineGrp.add(projGrp);
  scene.add(cineGrp);
  api.cineGroup = cineGrp;
  projGrp.traverse((o) => { if (o.isMesh) collidables.push(o); });

  /* 빔 — 렌즈에서 화면까지 퍼지는 빛기둥 */
  const beam = (function () {
    const nw = 0.1, nh = 0.06;                           // 렌즈 쪽
    const fw = R.TV.w / 2, fh = R.TV.h / 2;              // 화면 쪽
    const near = [
      [PJ.x - nw, PJ.y + nh, lensZ], [PJ.x + nw, PJ.y + nh, lensZ],
      [PJ.x + nw, PJ.y - nh, lensZ], [PJ.x - nw, PJ.y - nh, lensZ]
    ];
    const far = [
      [tvAt.x - fw, screenY + fh, screenZ + 0.02], [tvAt.x + fw, screenY + fh, screenZ + 0.02],
      [tvAt.x + fw, screenY - fh, screenZ + 0.02], [tvAt.x - fw, screenY - fh, screenZ + 0.02]
    ];
    const pos = [], col = [];
    const pushV = (p, c) => { pos.push(p[0], p[1], p[2]); col.push(c[0], c[1], c[2]); };
    const NEAR_C = [0.85, 0.92, 1.0], FAR_C = [0.12, 0.16, 0.26];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pushV(near[i], NEAR_C); pushV(far[i], FAR_C); pushV(far[j], FAR_C);
      pushV(near[i], NEAR_C); pushV(far[j], FAR_C); pushV(near[j], NEAR_C);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.075,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    m.renderOrder = 2;
    scene.add(m);
    return m;
  })();
  cineGrp.add(beam);          // 빔도 함께 걷힌다
  api.beam = beam;

  /* ---------------- 조명 ---------------- */
  const ambient = new THREE.AmbientLight(0x322e42, R.LIGHT.ambient);
  scene.add(ambient);
  api.ambient = ambient;
  const hemi = new THREE.HemisphereLight(0x5e5e82, 0x3a2d26, R.LIGHT.hemi);
  scene.add(hemi);

  /* ---------------- 미러볼 (노래방 모드) ----------------
   *  평소에는 천장에 숨어 있다가, 노래방 모드를 켜면 줄을 타고 내려오며 커진다.
   *  면을 각지게(flatShading) 깎아 돌 때마다 면마다 빛을 다르게 튕긴다.
   *  빛은 공을 중심으로 도는 색 광원 둘 + 덧셈으로 그리는 빔 다발로 낸다.
   *  광원을 둘로 묶어 둔 건 방 전체 광원 수를 지키기 위해서다. */
  const M = R.MIRROR;
  const mirrorGrp = new THREE.Group();
  mirrorGrp.position.set(M.x, M.y, M.z);
  mirrorGrp.visible = false;
  scene.add(mirrorGrp);

  // 천장까지 올라가는 줄
  const cordLen = R.H - M.y;
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, cordLen, 6),
    mat(0x2a2630, 0.9)
  );
  cord.position.y = cordLen / 2;
  mirrorGrp.add(cord);

  // 공 — 돌아가는 부분만 따로 묶는다
  const ballGrp = new THREE.Group();
  mirrorGrp.add(ballGrp);
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(M.r, 3),
    new THREE.MeshStandardMaterial({
      color: 0xb8c4d8, metalness: 1.0, roughness: 0.16, flatShading: true,
      emissive: 0x1b2436, emissiveIntensity: 0.75
    })
  );
  ballGrp.add(ball);

  // 공 둘레의 번짐 — 덧셈으로 올린 둥근 빛무리
  const haloTex = canvasTex(THREE, 128, 128, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,.95)');
    grd.addColorStop(0.25, 'rgba(255,190,235,.5)');
    grd.addColorStop(1, 'rgba(255,120,210,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  }).tex;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  halo.scale.setScalar(M.r * 7);
  mirrorGrp.add(halo);

  // 빔 다발 — 공에서 뻗어 나가는 얇고 긴 판. 덧셈으로 그려 빛처럼 보인다.
  // 두 벌을 서로 반대로 돌려 교차하게 한다.
  const beamMats = [
    new THREE.MeshBasicMaterial({ color: 0xffc6ec, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0xb6e8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  ];
  const beamSets = [new THREE.Group(), new THREE.Group()];
  beamSets.forEach((set, si) => {
    const n = M.beams;
    for (let i = 0; i < n; i++) {
      const len = 8.4 + (i % 4) * 1.3;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.13 + (i % 3) * 0.05, len), beamMats[si]);
      b.position.y = -len / 2;
      const arm = new THREE.Group();
      arm.add(b);
      arm.rotation.y = (i / n) * Math.PI * 2 + si * 0.2;
      arm.rotation.z = 0.3 + (i % 5) * 0.22;       // 벌어지는 각을 조금씩 달리한다
      set.add(arm);
    }
    ballGrp.add(set);
  });

  /* ---- 벽·바닥을 쓸고 지나가는 빛 점 ----
   *  진짜 미러볼의 핵심은 공 자체가 아니라 '방에 흩뿌려진 점' 이다.
   *  공 중심에서 쏜 방향을 방 상자(x·y·z 여섯 면)에 투영해 맞은 자리에 점을 놓는다.
   *  면을 맞히는 계산은 축마다 나눗셈 한 번이라 56개를 매 프레임 돌려도 가볍다.
   *  점은 덧셈으로 그리고 깊이를 쓰지 않아 벽 위에 빛처럼 얹힌다. */
  const dotTex = canvasTex(THREE, 64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  }).tex;
  const DOT_HUES = [0xff5ab0, 0x5ad2ff, 0xffe08a];      // 분홍 · 하늘 · 금빛
  const dotMats = DOT_HUES.map((c) => new THREE.SpriteMaterial({
    map: dotTex, color: c, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  const dotGrp = new THREE.Group();
  dotGrp.visible = false;
  scene.add(dotGrp);

  const dots = [];
  for (let i = 0; i < M.dots; i++) {
    // 피보나치 구면 분포 — 방향이 뭉치지 않고 고르게 퍼진다
    const k = (i + 0.5) / M.dots;
    const phi = Math.acos(1 - 2 * k);
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)
    );
    const s = new THREE.Sprite(dotMats[i % dotMats.length]);
    dotGrp.add(s);
    dots.push({ dir: dir, spr: s, ph: Math.random() * 6.28 });
  }

  /* 공 중심 p 에서 방향 d 로 쏘아 방 상자에 맞는 거리. 못 맞히면 0 */
  const HB = { x: R.W / 2 - 0.06, z: R.D / 2 - 0.06, yTop: R.H - 0.06, yBot: 0.06 };
  function hitRoom(px, py, pz, d) {
    let best = Infinity;
    if (d.x > 1e-6 || d.x < -1e-6) {
      const t = ((d.x > 0 ? HB.x : -HB.x) - px) / d.x;
      if (t > 0.1 && t < best) best = t;
    }
    if (d.z > 1e-6 || d.z < -1e-6) {
      const t = ((d.z > 0 ? HB.z : -HB.z) - pz) / d.z;
      if (t > 0.1 && t < best) best = t;
    }
    if (d.y > 1e-6 || d.y < -1e-6) {
      const t = ((d.y > 0 ? HB.yTop : HB.yBot) - py) / d.y;
      if (t > 0.1 && t < best) best = t;
    }
    return best === Infinity ? 0 : best;
  }

  // 색 광원 둘 — 공 주위를 서로 반대로 돈다
  const mLightA = new THREE.PointLight(0xff5ab0, 0, 18, 2);
  const mLightB = new THREE.PointLight(0x5ad2ff, 0, 18, 2);
  mirrorGrp.add(mLightA, mLightB);

  const _d = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  api.mirrorGroup = mirrorGrp;
  api.mirrorBall = ballGrp;
  api.mirrorLights = [mLightA, mLightB];
  api.mirrorDots = dotGrp;

  /* Play 모드 — 'cinema' 면 영사기, 'karaoke' 면 미러볼.
   * 어느 쪽이든 재생 중에는 방 조명을 낮춰 화면·미러볼이 도드라지게 한다. */
  let mode = 'cinema';
  let mirrorT = 0;             // 0 = 천장에 숨음, 1 = 다 내려옴
  let dimT = 1;                // 1 = 환하게, LIGHT.dim = 어둑하게
  api.setMode = function (m) {
    mode = (m === 'karaoke') ? 'karaoke' : 'cinema';
    R.setMode(mode);        // 충돌·바닥높이·앉을 자리는 즉시 갈아 끼운다
  };
  api.getMode = function () { return mode; };
  // 예전 이름 — 쓰는 곳이 남아 있어도 깨지지 않게
  api.setKaraoke = function (on) { api.setMode(on ? 'karaoke' : 'cinema'); };

  /* 0 = 영화관 가구, 1 = 노래방 가구. 둘 사이를 천천히 건너간다. */
  let furnT = 0;
  let cineT = 1;               // 0 = 천장에 걷힘, 1 = 다 내려옴 (영화관이 기본이라 1)
  let spinT = 0;               // 돌아간 각도를 쌓아 둔다 (멈추면 그대로 선다)
  let runT = 0;                // 0 = 멎음, 1 = 돌아감
  let lastT = 0;

  api.update = function (t, tvOn) {
    const dt0 = lastT ? Math.min(0.05, Math.max(0, t - lastT)) : 0;
    lastT = t;
    // TV 가 켜져 있으면 화면빛이 미세하게 일렁인다
    const target = tvOn
      ? R.LIGHT.tv + Math.sin(t * 2.3) * 1.2 + Math.sin(t * 7.1) * 0.5
      : 0.5;
    api.tvLight.intensity += (target - api.tvLight.intensity) * 0.08;

    /* ---- 바닥 가구가 자리를 주고받는다 ----
     *  영화관 → 노래방 : 단은 높이가 0 으로 주저앉고, 의자는 열린 바닥으로
     *                    내려간다. 그 사이 소파와 테이블이 바닥에서 솟는다.
     *  다 건너가면 반대쪽은 아예 그리지 않는다. */
    {
      const want = (mode === 'karaoke') ? 1 : 0;
      furnT += (want - furnT) * 0.045;
      if (Math.abs(want - furnT) < 0.002) furnT = want;
      const e = furnT * furnT * (3 - 2 * furnT);      // 부드럽게

      for (let i = 0; i < modeFurn.length; i++) {
        const it = modeFurn[i];
        if (it.mode === 'cinema') {
          if (it.tier) {
            it.g.scale.y = Math.max(0.0012, 1 - e);   // 단은 납작해진다
          } else {
            it.g.position.y = it.y0 - e * it.sink;    // 의자는 가라앉는다
          }
          it.g.visible = e < 0.995;
        } else {
          it.g.position.y = it.y0 - (1 - e) * it.sink;
          it.g.visible = e > 0.005;
        }
      }

      // 바닥이 열린 구멍 — 건너가는 동안에만, 한가운데서 가장 짙다
      const open = Math.sin(Math.PI * e);
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (open < 0.01) { d.m.visible = false; continue; }
        d.m.visible = true;
        d.m.material.opacity = open * 0.85;
        d.m.position.y = d.y0 * (1 - e) + 0.016;      // 주저앉는 단을 따라간다
      }
    }

    /* ---- 영사기 등장·퇴장 ----
     *  영화관 모드면 천장에서 내려오고, 노래방 모드면 천장으로 걷힌다.
     *  미러볼과 똑같은 방식(한 값으로 높이·크기를 함께 끈다)이라 둘이 자연스럽게
     *  자리를 주고받는다. 다 올라가면 아예 그리지 않는다. */
    {
      const want = (mode === 'cinema') ? 1 : 0;
      cineT += (want - cineT) * 0.055;
      if (cineT < 0.004 && want === 0) {
        cineT = 0;
        if (cineGrp.visible) cineGrp.visible = false;
      } else {
        cineGrp.visible = true;
        const e = cineT * cineT * (3 - 2 * cineT);
        cineGrp.position.y = (1 - e) * 1.4;        // 천장 속으로 들어간다
        cineGrp.scale.setScalar(0.25 + e * 0.75);
      }
    }

    /* 영사기 빛 — 영화관 모드에서, 재생 중에만 켜진다 */
    const cineOn = (mode === 'cinema') && tvOn && cineT > 0.5;
    if (api.beam) {
      api.beam.visible = cineOn;
      if (cineOn) {
        api.beam.material.opacity = 0.062 + Math.sin(t * 2.3) * 0.012 + Math.sin(t * 9.7) * 0.006;
      }
    }
    if (api.projectorLens) {
      api.projectorLens.material.color.setScalar(cineOn ? 0.75 + Math.sin(t * 7.1) * 0.12 : 0.1);
    }

    /* 방 조명 — 재생 중에는 어둑하게, 멈추면 다시 환하게.
     * 한 값(dimT)으로 환경광·반구광·건축 조명을 한꺼번에 끌고 간다. */
    {
      const want = tvOn ? R.LIGHT.dim : 1;
      dimT += (want - dimT) * 0.035;                 // 눈이 적응할 만큼 천천히
      ambient.intensity = R.LIGHT.ambient * dimT;
      hemi.intensity = R.LIGHT.hemi * dimT;
      for (let i = 0; i < api.lampLights.length; i++) {
        const l = api.lampLights[i];
        l.intensity = l.userData.base * dimT;
      }
    }

    // 네온 간판 — 진짜 네온관처럼 미세하게 흔들린다
    if (api.neonLight) {
      const fl = 0.88 + Math.sin(t * 1.9) * 0.08 + Math.sin(t * 13.7) * 0.04;
      api.neonLight.intensity = R.LIGHT.neon * fl;
      api.neonMesh.material.opacity = 0.92 + (fl - 0.88) * 0.6;
    }

    /* ---- 미러볼 ----
     *  mirrorT 를 0↔1 로 부드럽게 옮기고, 그 값 하나로 내려온 높이·크기·밝기를
     *  모두 끌고 간다. 다 숨으면 아예 그리지 않는다. */
    {
      const kara = (mode === 'karaoke');
      const want = kara ? 1 : 0;
      mirrorT += (want - mirrorT) * 0.055;
      if (mirrorT < 0.003 && !kara) {
        mirrorT = 0;
        if (mirrorGrp.visible) { mirrorGrp.visible = false; dotGrp.visible = false; }
      } else {
        mirrorGrp.visible = true;
        const e = mirrorT * mirrorT * (3 - 2 * mirrorT);        // 부드럽게 (smoothstep)
        mirrorGrp.position.y = M.y + (1 - e) * M.drop;          // 천장에서 내려온다
        ballGrp.scale.setScalar(0.08 + e * 0.92);
        /* 재생 중에만 돌고 빛난다. 멈추면 돌던 자리에 서서 빛이 잦아든다 —
         * 공은 매달린 채 남아 '지금 노래방이다' 를 계속 알려 준다. */
        spinT += (tvOn ? 1 : 0) * dt0 * 0.55;                   // 멈추면 각도가 유지된다
        runT += ((tvOn ? 1 : 0) - runT) * 0.06;                 // 빛의 세기
        const act = e * runT;
        ballGrp.rotation.y = spinT;
        ballGrp.rotation.z = Math.sin(spinT * 0.38) * 0.1;
        cord.scale.y = Math.max(0.001, 1 - (1 - e) * (M.drop / cordLen));
        cord.position.y = (cordLen * cord.scale.y) / 2;

        // 반짝임 — 면이 돌며 빛을 튕기는 느낌
        const tw = 0.82 + Math.sin(t * 5.3) * 0.12 + Math.sin(t * 11.9) * 0.06;
        ball.material.emissiveIntensity = 1.5 * tw * (0.18 * e + 0.82 * act);
        halo.material.opacity = 0.5 * act * tw;
        halo.scale.setScalar(M.r * (6.4 + Math.sin(t * 2.6) * 0.8));

        // 빔 두 벌 — 서로 반대로 돌며 밝기도 엇갈리게 뛴다
        beamSets[0].rotation.y = spinT * 0.76;
        beamSets[1].rotation.y = -spinT * 1.2;
        beamSets[1].rotation.x = 0.26;
        beamMats[0].opacity = 0.14 * act * (0.72 + Math.sin(t * 3.1) * 0.28);
        beamMats[1].opacity = 0.11 * act * (0.72 + Math.sin(t * 2.3 + 1.6) * 0.28);

        const amp = R.LIGHT.mirror * act;
        mLightA.intensity = amp * (0.75 + Math.sin(t * 2.7) * 0.25);
        mLightB.intensity = amp * (0.75 + Math.sin(t * 2.7 + 2.1) * 0.25);
        mLightA.position.set(Math.cos(t * 0.9) * 1.5, -0.5, Math.sin(t * 0.9) * 1.5);
        mLightB.position.set(Math.cos(-t * 0.7 + 1.7) * 1.5, -0.5, Math.sin(-t * 0.7 + 1.7) * 1.5);

        /* ---- 벽·바닥 위를 쓸고 가는 빛 점 ----
         *  공과 같은 속도로 방향 다발을 돌리고, 각 방향이 방에 맞는 자리에 점을 놓는다.
         *  멀리 맞을수록 점이 커지고 옅어진다 — 실제로 퍼지는 빛과 같은 방향이다. */
        const px = mirrorGrp.position.x, py = mirrorGrp.position.y, pz = mirrorGrp.position.z;
        const spin = spinT;
        const tilt = Math.sin(spinT * 0.38) * 0.1;
        dotGrp.visible = true;
        for (let i = 0; i < dots.length; i++) {
          const dt = dots[i];
          _d.copy(dt.dir).applyAxisAngle(Y_AXIS, spin);
          _d.y += tilt * 0.35;
          _d.normalize();
          const hit = hitRoom(px, py, pz, _d);
          if (!hit) { dt.spr.visible = false; continue; }
          dt.spr.visible = true;
          // 맞은 자리에서 3cm 앞으로 빼 벽면과 겹쳐 깜빡이지 않게 한다
          dt.spr.position.set(px + _d.x * (hit - 0.03), py + _d.y * (hit - 0.03), pz + _d.z * (hit - 0.03));
          const sz = 0.16 + hit * 0.075;
          dt.spr.scale.setScalar(sz);
          dt.spr.material.needsUpdate = false;
          dt.spr.material.rotation = 0;
        }
        // 점 밝기는 색깔 묶음 단위로 — 재질 셋이라 반짝임도 셋으로 엇갈린다
        for (let i = 0; i < dotMats.length; i++) {
          const fl = 0.62 + Math.sin(t * (3.4 + i * 1.1) + i * 2.1) * 0.38;
          dotMats[i].opacity = 0.9 * act * fl;
        }
      }
    }
  };

  return api;
}
