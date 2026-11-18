/* ------------------------------------------------------------------
 *  avatar3d.js — 둥근 카툰 2등신, 3D 버전
 *
 *  키 1.7m. 머리가 크고 몸이 작다. 입은 없고 눈만 있다.
 *  이름표와 말풍선은 늘 카메라를 보는 스프라이트.
 * ------------------------------------------------------------------ */
import * as THREE from 'three';

const PALETTE = [
  [0xff8a5c, 0xe5643a], [0x5cb8ff, 0x3a8ddb], [0x7ddc7d, 0x4caf50],
  [0xffd166, 0xe0a92c], [0xc792ea, 0x9b6fd4], [0xff9ec4, 0xe06f9c],
  [0x6fe3d4, 0x35b3a4], [0xb0b7c3, 0x848c99], [0xffb86b, 0xd98f3c],
  [0x8fa6ff, 0x5f78e0]
];

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

export function makeAvatar(opts) {
  const col = colorOf(opts.seed);
  const main = new THREE.MeshStandardMaterial({ color: col[0], roughness: 0.78 });
  const dark = new THREE.MeshStandardMaterial({ color: col[1], roughness: 0.82 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xffe0c2, roughness: 0.85 });
  const eye = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.4 });

  const root = new THREE.Group();
  const body = new THREE.Group();     // 걸을 때 위아래로 들썩이는 부분
  root.add(body);

  // 몸통
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 6, 14), main);
  torso.position.y = 0.72;
  body.add(torso);

  // 다리
  const legGeo = new THREE.CapsuleGeometry(0.075, 0.2, 4, 10);
  const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.1, 0.2, 0);
  const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.1, 0.2, 0);
  body.add(legL, legR);
  const legY = legL.position.y, legZ = legL.position.z;

  // 팔
  const armGeo = new THREE.CapsuleGeometry(0.058, 0.2, 4, 10);
  const armL = new THREE.Mesh(armGeo, dark); armL.position.set(-0.235, 0.76, 0);
  const armR = new THREE.Mesh(armGeo, dark); armR.position.set(0.235, 0.76, 0);
  body.add(armL, armR);

  // 머리
  const head = new THREE.Group();
  head.position.y = 1.28;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.235, 20, 16), skin);
  head.add(skull);
  // 머리카락 — 윗부분을 덮는 모자 모양
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.245, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
    dark
  );
  hair.position.y = 0.012;
  head.add(hair);
  // 눈
  const eyeGeo = new THREE.SphereGeometry(0.035, 10, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eye); eyeL.position.set(-0.085, 0.01, 0.208);
  const eyeR = new THREE.Mesh(eyeGeo, eye); eyeR.position.set(0.085, 0.01, 0.208);
  eyeL.scale.z = 0.6; eyeR.scale.z = 0.6;
  head.add(eyeL, eyeR);
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
  let hYaw = 0, hPitch = 0;          // 부드럽게 따라가는 고개 각도 (몸 기준)

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
      for (const mt of [main, dark, skin, eye]) {
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
      stride += dt * (walking ? 11 : 0);
      const sw = Math.sin(stride);
      legL.rotation.x = walking ? sw * 0.6 : 0;
      legR.rotation.x = walking ? -sw * 0.6 : 0;
      armL.rotation.x = walking ? -sw * 0.5 : 0;
      armR.rotation.x = walking ? sw * 0.5 : 0;
      const air = !sitting && ((p.y || 0) - (p.fy || 0)) > 0.03;
      body.position.y = air ? 0.02 : (walking ? Math.abs(Math.sin(stride)) * 0.045 : Math.sin(t * 1.6 + ph) * 0.012);
      if (air) {                                 // 공중에서는 다리를 모으고 팔을 든다
        legL.rotation.x = -0.35; legR.rotation.x = 0.2;
        armL.rotation.x = -0.9; armR.rotation.x = -0.9;
      }
      if (sitting) {
        // 엉덩이를 방석 높이로 내리고 허벅지를 앞으로 접는다
        body.position.y = -0.235;
        legL.position.set(-0.1, legY + 0.2, legZ - 0.14);
        legR.position.set(0.1, legY + 0.2, legZ - 0.14);
        legL.rotation.x = legR.rotation.x = -1.32;
        armL.rotation.x = armR.rotation.x = -0.22;
      } else if (legL.position.z !== legZ) {
        legL.position.set(-0.1, legY, legZ);
        legR.position.set(0.1, legY, legZ);
      }
      head.rotation.z = walking ? sw * 0.04 : Math.sin(t * 1.2 + ph) * 0.02;

      // 시선(카메라 회전)에 따라 고개를 돌린다 — p.hy: 좌우(몸 기준), p.hp: 상하
      const thy = Math.max(-1.3, Math.min(1.3, p.hy || 0));
      const thp = Math.max(-0.6, Math.min(0.6, p.hp || 0));
      const hk = Math.min(1, dt * 12);
      hYaw += (thy - hYaw) * hk;
      hPitch += (thp - hPitch) * hk;
      head.rotation.y = hYaw;
      head.rotation.x = hPitch;

      // 눈 깜빡임
      const blink = Math.sin(t * 0.8 + ph * 3) > 0.985 ? 0.12 : 1;
      eyeL.scale.y = eyeR.scale.y = blink;

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
      main.dispose(); dark.dispose(); skin.dispose(); eye.dispose();
    }
  };

  return api;
}
