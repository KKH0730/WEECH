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

/* 발밑/가구 밑에 깔리는 가짜 그림자 */
function blob(radius, opacity) {
  const { tex } = canvasTex(THREE, 128, 128, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,.6)');
    grd.addColorStop(0.55, 'rgba(0,0,0,.26)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
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
    const rug = new THREE.Mesh(new THREE.BoxGeometry(c.w, 0.02, c.d), carpetMat);
    rug.position.set(c.x, 0.011, c.z);
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
  const wood2 = mat(0x75563f, 0.8);

  R.furniture.forEach((f) => {
    const g = new THREE.Group();
    g.position.set(f.x, 0, f.z);
    g.rotation.y = f.rot;
    g.name = f.type;

    if (f.type === 'sofa') {
      const w = f.w, d = f.d;
      g.add(box(w, 0.34, d, fabric, 0, 0.17, 0));                       // 몸체
      g.add(box(w - 0.3, 0.16, d - 0.24, fabric2, 0, 0.42, -0.04));     // 방석
      g.add(box(w, 0.52, 0.22, fabric, 0, 0.6, d / 2 - 0.11));          // 등받이
      g.add(box(0.22, 0.46, d, dark, -w / 2 + 0.11, 0.45, 0));          // 팔걸이
      g.add(box(0.22, 0.46, d, dark, w / 2 - 0.11, 0.45, 0));
      [[-w / 2 + 0.2, d / 2 - 0.2], [w / 2 - 0.2, d / 2 - 0.2],
       [-w / 2 + 0.2, -d / 2 + 0.2], [w / 2 - 0.2, -d / 2 + 0.2]].forEach((p) => {
        g.add(box(0.08, 0.1, 0.08, wood, p[0], 0.05, p[1]));
      });
    } else if (f.type === 'chair') {
      g.add(box(f.w, 0.12, f.d, fabric2, 0, 0.42, 0));
      g.add(box(f.w, 0.5, 0.12, fabric, 0, 0.7, f.d / 2 - 0.06));
      [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].forEach((p) => {
        g.add(box(0.07, 0.42, 0.07, wood, p[0], 0.21, p[1]));
      });
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
    const sh = blob(Math.max(f.w, f.d) * 0.75, 0.55);
    sh.position.set(f.x, 0.013, f.z);
    scene.add(sh);
    scene.add(g);
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
  scene.add(rod);
  scene.add(box(0.26, 0.04, 0.26, metal, PJ.x, R.H - 0.02, PJ.z));
  scene.add(projGrp);
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
  api.beam = beam;

  /* ---------------- 조명 ---------------- */
  scene.add(new THREE.AmbientLight(0x322e42, R.LIGHT.ambient));
  const hemi = new THREE.HemisphereLight(0x5e5e82, 0x3a2d26, R.LIGHT.hemi);
  scene.add(hemi);

  api.update = function (t, tvOn) {
    // TV 가 켜져 있으면 화면빛이 미세하게 일렁인다
    const target = tvOn
      ? R.LIGHT.tv + Math.sin(t * 2.3) * 1.2 + Math.sin(t * 7.1) * 0.5
      : 0.5;
    api.tvLight.intensity += (target - api.tvLight.intensity) * 0.08;

    // 영사기 빔은 재생 중에만, 밝기도 함께 일렁인다
    if (api.beam) {
      api.beam.visible = tvOn;
      if (tvOn) {
        api.beam.material.opacity = 0.062 + Math.sin(t * 2.3) * 0.012 + Math.sin(t * 9.7) * 0.006;
      }
    }
    if (api.projectorLens) {
      api.projectorLens.material.color.setScalar(tvOn ? 0.75 + Math.sin(t * 7.1) * 0.12 : 0.1);
    }
  };

  return api;
}
