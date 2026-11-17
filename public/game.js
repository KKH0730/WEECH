/* ==================================================================
 *  game.js — 위치 WEECH (3D)
 *
 *  카메라 두 가지
 *    라운지 뷰 : 아바타를 내려다보며 공전. 드래그로 둘러보고 바닥을 눌러 이동.
 *    시청 모드 : 눈높이 1인칭. TV 를 바라보고 앉은 것처럼 본다.
 * ================================================================== */
import * as THREE from 'three';
import { CSS3DRenderer } from './vendor/CSS3DRenderer.js';
import { buildScene } from './scene3d.js';
import { makeAvatar, colorOf } from './avatar3d.js';
import * as TV from './youtube.js';

const R = ROOM3D;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* 렌더러                                                               */
/* ------------------------------------------------------------------ */
const webglHost = $('webgl'), cssHost = $('css3d');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = R.LIGHT.exposure;
webglHost.appendChild(renderer.domElement);

const cssRenderer = new CSS3DRenderer();
cssHost.appendChild(cssRenderer.domElement);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
const world = buildScene();
const scene = world.scene;
const cssScene = new THREE.Scene();

TV.mountScreen(cssScene, world.tvTransform, R.TV);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  cssRenderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ */
/* 상태                                                                 */
/* ------------------------------------------------------------------ */
let screen = 'lobby';
let ws = null, retry = null, myId = 0;
const outbox = [];
let lastJoin = null;

const me = {
  id: 0, name: '', x: R.spawn.x, z: R.spawn.z, dir: Math.PI, st: 0,
  y: 0, vy: 0, grounded: true
};
const others = new Map();
let myAvatar = null;
let room = null, isHost = false;

const darts = [];
let moveTarget = null;
let toastTimer = null;
let creating = false;

const cam = {
  mode: 'lounge',
  yaw: 0,
  pitch: 0.88,
  look: 0.0,
  dist: 12.5
};
const camPos = new THREE.Vector3(0, 6, 10);
const camAim = new THREE.Vector3(0, 1, 0);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hitToPlayer = new Map();

/* ------------------------------------------------------------------ */
/* UI 공통                                                              */
/* ------------------------------------------------------------------ */
function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2600);
}

/* 채팅은 서버에 저장하지 않는다. 이 패널이 들고 있는 동안만 남는다. */
const CHAT_KEEP = 200;          // 메모리에 쌓아 둘 최대 줄 수
let chatMin = false;            // 접힘 여부 — 기본은 펼침
let chatUnread = 0;

function nowHM() {
  const d = new Date();
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

function atBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

function logMsg(html, cls) {
  const log = $('chatlog');
  const stick = atBottom(log);       // 올려서 읽는 중이면 끌어내리지 않는다
  const d = document.createElement('div');
  d.className = 'msg' + (cls ? ' ' + cls : '');
  d.innerHTML = html;
  log.appendChild(d);
  while (log.children.length > CHAT_KEEP) log.removeChild(log.firstChild);
  if (stick) log.scrollTop = log.scrollHeight;
  if (chatMin || !stick) bumpUnread();
}

function bumpUnread() {
  chatUnread++;
  const el = $('chatUnread');
  el.textContent = chatUnread > 99 ? '99+' : chatUnread;
  el.hidden = false;
}

function clearUnread() {
  chatUnread = 0;
  $('chatUnread').hidden = true;
}

function setChatMin(min) {
  chatMin = min;
  $('chat').classList.toggle('min', min);
  if (!min) {
    const log = $('chatlog');
    log.scrollTop = log.scrollHeight;
    clearUnread();
  }
}

$('chatHead').addEventListener('click', () => setChatMin(!chatMin));
$('chatlog').addEventListener('scroll', () => {
  if (!chatMin && atBottom($('chatlog'))) clearUnread();
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => { $(b.dataset.close).hidden = true; });
});

/* ------------------------------------------------------------------ */
/* 로비                                                                 */
/* ------------------------------------------------------------------ */
let roomList = [];

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
    tab.classList.add('on');
    $('panel-join').hidden = tab.dataset.tab !== 'join';
    $('panel-create').hidden = tab.dataset.tab !== 'create';
    $('lobbyErr').hidden = true;
  });
});

function renderRooms() {
  const box = $('roomList');
  $('roomCount').textContent = roomList.length ? roomList.length + '개' : '—';
  if (!roomList.length) {
    box.innerHTML = '<div class="empty">아직 열린 방이 없습니다. 직접 만들어 보세요.</div>';
    return;
  }
  box.innerHTML = '';
  roomList.forEach((r) => {
    const b = document.createElement('button');
    b.className = 'room';
    b.innerHTML =
      '<div class="rt"><div class="rname">' + esc(r.title) + '</div>' +
      '<div class="rsub">' + (r.playing ? '<span class="live">재생중</span> ' : '') +
      esc(r.now || ('영상 ' + r.count + '개')) + ' · 방장 ' + esc(r.host) + '</div></div>' +
      '<div class="rn">' + r.n + '/' + r.cap + '</div>';
    b.addEventListener('click', () => joinRoom(r.code));
    box.appendChild(b);
  });
}

function countLinks(text) {
  const seen = new Set();
  let lists = 0;
  String(text || '').split(/[\s,]+/).filter(Boolean).forEach((t) => {
    if (/[?&]list=[A-Za-z0-9_-]{2,}/.test(t)) { lists++; return; }
    let m, id = null;
    if ((m = t.match(/[?&]v=([A-Za-z0-9_-]{11})/))) id = m[1];
    else if ((m = t.match(/youtu\.be\/([A-Za-z0-9_-]{11})/))) id = m[1];
    else if ((m = t.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/))) id = m[1];
    else if (/^[A-Za-z0-9_-]{11}$/.test(t)) id = t;
    if (id) seen.add(id);
  });
  return { v: seen.size, p: lists };
}
const countIds = (t) => { const c = countLinks(t); return c.v + c.p; };
function linkLabel(text) {
  const c = countLinks(text);
  if (!c.v && !c.p) return '인식된 영상 0개';
  const parts = [];
  if (c.p) parts.push('재생목록 ' + c.p + '개');
  if (c.v) parts.push('영상 ' + c.v + '개');
  return '인식됨 — ' + parts.join(' + ');
}

$('newLinks').addEventListener('input', () => { $('linkCount').textContent = linkLabel($('newLinks').value); });

function setCreating(on, msg) {
  creating = on;
  $('createBtn').disabled = on;
  $('createBtn').textContent = on ? (msg || '불러오는 중…') : '방 만들고 들어가기';
  $('joinByCode').disabled = on;
}
function lobbyErr(msg) { const el = $('lobbyErr'); el.textContent = msg; el.hidden = false; }

$('createBtn').addEventListener('click', () => {
  const name = $('newName').value.trim();
  const title = $('newTitle').value.trim();
  const links = $('newLinks').value.trim();
  if (!name) { lobbyErr('닉네임을 입력해 주세요.'); return; }
  if (!links || !countIds(links)) { lobbyErr('유튜브 링크를 하나 이상 넣어 주세요.'); return; }
  if (creating) return;
  me.name = name;
  $('lobbyErr').hidden = true;
  setCreating(true, '방을 만드는 중…');
  send({ t: 'create', name: name, title: title, links: links });
});

$('joinByCode').addEventListener('click', () => joinRoom($('joinCode').value.trim().toUpperCase()));
$('joinCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom($('joinCode').value.trim().toUpperCase());
});

function joinRoom(code) {
  const name = $('joinName').value.trim();
  if (!name) { lobbyErr('닉네임을 먼저 입력해 주세요.'); return; }
  if (!code) { lobbyErr('방 코드를 입력하거나 목록에서 고르세요.'); return; }
  me.name = name;
  send({ t: 'join', code: code, name: name });
}

/* ------------------------------------------------------------------ */
/* 네트워크                                                              */
/* ------------------------------------------------------------------ */
const toNet = (v) => Math.round(v * 100);

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  try { ws = new WebSocket(proto + location.host); } catch (e) { scheduleRetry(); return; }

  ws.onopen = () => {
    clearTimeout(retry);
    while (outbox.length) ws.send(JSON.stringify(outbox.shift()));
    if (screen === 'room' && lastJoin) {
      ws.send(JSON.stringify({ t: 'join', code: lastJoin.code, name: lastJoin.name }));
    }
  };
  ws.onclose = () => { if (screen === 'room') toast('연결이 끊어졌습니다. 다시 잇는 중…', 4000); scheduleRetry(); };
  ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };

  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    switch (m.t) {
      case 'rooms':
        roomList = m.list || [];
        if (screen === 'lobby') renderRooms();
        break;

      case 'busy':
        if (screen === 'lobby') setCreating(true, m.msg); else toast(m.msg, 3000);
        break;

      case 'info':
        toast(m.msg, 4000);
        break;

      case 'err':
        setCreating(false);
        if (screen === 'lobby') lobbyErr(m.msg); else toast(m.msg, 3000);
        break;

      case 'joined': {
        setCreating(false);
        myId = m.you; me.id = m.you;
        room = m.room;
        isHost = (m.host === myId);
        lastJoin = { code: room.code, name: me.name };
        clearAvatars();
        (m.users || []).forEach((u) => {
          if (u.id === myId) { me.x = u.x / 100; me.z = u.y / 100; return; }
          addOther(u);
        });
        enterRoom();
        break;
      }

      case 'left': leaveToLobby(); break;

      case 's': {
        const seen = new Set();
        (m.u || []).forEach((a) => {
          const id = a[0];
          seen.add(id);
          if (id === myId) return;
          let g = others.get(id);
          if (!g) g = addOther({ id: id, name: a[5], x: a[1], y: a[2] });
          g.tx = a[1] / 100; g.tz = a[2] / 100; g.tdir = a[3]; g.st = a[4];
          g.ty = (a[6] || 0) / 100;
          if (a[5] && a[5] !== g.name) { g.name = a[5]; g.av.setName(a[5]); }
        });
        for (const id of Array.from(others.keys())) if (!seen.has(id)) removeOther(id);
        peopleCache = (m.u || []).map((a) => ({ id: a[0], name: a[5] }));
        peopleCache.sort((a, b) => (b.id === myId) - (a.id === myId) || a.id - b.id);
        $('roomPeople').textContent = peopleCache.length || 1;
        renderPeople();
        break;
      }

      case 'user+':
        addOther(m.user);
        logMsg(esc(m.user.name) + ' 님이 들어왔습니다.', 'sys');
        break;

      case 'user-':
        removeOther(m.id);
        logMsg(esc(m.name || '누군가') + ' 님이 나갔습니다.', 'sys');
        break;

      case 'host':
        isHost = (m.id === myId);
        if (room) room.hostId = m.id;
        applyHostUI();
        renderPeople();
        logMsg(esc(m.name) + ' 님이 방장이 되었습니다.', 'sys');
        if (isHost) toast('방장이 되었습니다. 재생을 조작할 수 있습니다.', 3400);
        break;

      case 'chat': {
        const g = others.get(m.id);
        const av = m.id === myId ? myAvatar : (g ? g.av : null);
        if (av) av.say(m.txt);
        logMsg('<b>' + esc(m.name) + '</b>' + esc(m.txt) +
          '<span class="tm">' + nowHM() + '</span>', m.id === myId ? 'me' : '');
        break;
      }

      case 'arrow':
        spawnDart(m);
        break;

      case 'play':
        if (!room) break;
        room.idx = m.idx; room.playing = m.playing;
        room.position = m.position; room.serverNow = m.serverNow;
        applyPlayback();
        break;

      case 'room':
        if (!room) break;
        room.title = m.title; room.playlist = m.playlist;
        $('roomTitle').textContent = room.title;
        updateNowPlaying();
        drawBoard();
        break;
    }
  };
}

function scheduleRetry() { clearTimeout(retry); retry = setTimeout(connect, 2500); }

function send(obj) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return; }
  if (ws && ws.readyState === 0) { if (outbox.length < 20) outbox.push(obj); return; }
  toast('서버에 연결되어 있지 않습니다. 다시 잇는 중…', 2400);
}

/* ------------------------------------------------------------------ */
/* 아바타 관리                                                           */
/* ------------------------------------------------------------------ */
function addOther(u) {
  const av = makeAvatar({ name: u.name, seed: u.id, isMe: false });
  scene.add(av.root);
  av.hitMeshes.forEach((mesh) => hitToPlayer.set(mesh.uuid, u.id));
  const g = {
    id: u.id, name: u.name || '익명',
    x: u.x / 100, z: u.y / 100, tx: u.x / 100, tz: u.y / 100,
    dir: Math.PI, tdir: Math.PI, st: 0, y: 0, ty: 0, av: av
  };
  others.set(u.id, g);
  return g;
}

function removeOther(id) {
  const g = others.get(id);
  if (!g) return;
  g.av.hitMeshes.forEach((mesh) => hitToPlayer.delete(mesh.uuid));
  scene.remove(g.av.root);
  g.av.dispose();
  others.delete(id);
}

function clearAvatars() {
  for (const id of Array.from(others.keys())) removeOther(id);
  if (myAvatar) { scene.remove(myAvatar.root); myAvatar.dispose(); myAvatar = null; }
}

/* ------------------------------------------------------------------ */
/* 방 입장 / 퇴장                                                        */
/* ------------------------------------------------------------------ */
function enterRoom() {
  screen = 'room';
  $('lobby').hidden = true;
  $('hud').hidden = false;
  cssHost.style.display = '';
  $('roomTitle').textContent = room.title;
  $('roomCode').textContent = room.code;

  myAvatar = makeAvatar({ name: me.name, seed: myId, isMe: true });
  scene.add(myAvatar.root);

  cam.yaw = 0; cam.pitch = 0.88; cam.dist = 12.5; cam.mode = 'lounge';
  camPos.set(me.x, 10, me.z + 10);

  applyHostUI();
  applyPlayback();
  drawBoard();
  logMsg('방에 들어왔습니다. <b>Space</b> 점프 · <b>V</b> 시청 모드 · <b>?</b> 전체 조작.', 'sys');
}

function hostName() {
  if (!room) return '—';
  if (room.hostId === myId) return me.name;
  const g = others.get(room.hostId);
  return g ? g.name : '—';
}

function leaveToLobby() {
  screen = 'lobby';
  room = null; isHost = false;
  clearAvatars();
  darts.forEach((d) => scene.remove(d.obj));
  darts.length = 0;
  $('hud').hidden = true;
  $('lobby').hidden = false;
  $('chatlog').innerHTML = '';
  clearUnread();
  setChatMin(false);
  cssHost.style.display = 'none';
  setWatchMode(false);
  renderRooms();
}

$('leaveBtn').addEventListener('click', () => {
  if (confirm('방에서 나갈까요?')) send({ t: 'leave' });
});

/* 클립보드 — 안 되면 옛 방식으로 */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

const inviteUrl = () => location.origin + '/?r=' + (room ? room.code : '');

$('codeBtn').addEventListener('click', () => {
  if (!room) return;
  copyText(room.code).then((ok) => {
    if (!ok) { toast('복사하지 못했습니다. 코드: ' + room.code, 4000); return; }
    const chip = $('codeBtn');
    chip.classList.add('copied');
    setTimeout(() => chip.classList.remove('copied'), 1200);
    toast('입장 코드 ' + room.code + ' 를 복사했습니다', 2400);
  });
});

$('inviteBtn').addEventListener('click', () => {
  if (!room) return;
  const url = inviteUrl();
  copyText(url).then((ok) => {
    toast(ok ? '초대 링크를 복사했습니다 — 붙여넣기만 하면 바로 입장합니다' : url, ok ? 3200 : 6000);
  });
});

/* 참여자 목록 — 기본은 접혀 있다 */
let peopleOpen = false;
let peopleCache = [];

$('peopleToggle').addEventListener('click', () => {
  peopleOpen = !peopleOpen;
  $('peopleToggle').classList.toggle('open', peopleOpen);
  $('peopleList').hidden = !peopleOpen;
  if (peopleOpen) renderPeople();
});

function renderPeople() {
  if (!peopleOpen) return;
  const box = $('peopleList');
  if (!peopleCache.length) { box.innerHTML = '<div class="person"><span class="nm dim">—</span></div>'; return; }
  box.innerHTML = peopleCache.map((p) => {
    const c = colorOf(p.id)[0].toString(16).padStart(6, '0');
    const badges =
      (room && room.hostId === p.id ? '<span class="badge host">방장</span>' : '') +
      (p.id === myId ? '<span class="badge me">나</span>' : '');
    return '<div class="person"><span class="swatch" style="background:#' + c + '"></span>' +
           '<span class="nm">' + esc(p.name || '익명') + '</span>' + badges + '</div>';
  }).join('');
}

function applyHostUI() {
  $('hostCtl').hidden = !isHost;
  $('guestNote').hidden = isHost;
  $('settingsBtn').hidden = !isHost;
  $('roomHost').textContent = (room && room.hostId === myId ? '나' : hostName());
}

/* ------------------------------------------------------------------ */
/* 재생                                                                 */
/* ------------------------------------------------------------------ */
function currentItem() {
  if (!room || !room.playlist || !room.playlist.length) return null;
  return room.playlist[Math.max(0, Math.min(room.playlist.length - 1, room.idx))];
}

function applyPlayback() {
  const it = currentItem();
  if (it) TV.setState(room, it.id);
  $('playBtn').textContent = room && room.playing ? '❚❚' : '▶';
  updateNowPlaying();
  drawBoard();
}

function updateNowPlaying() {
  const it = currentItem();
  const n = room && room.playlist ? room.playlist.length : 0;
  $('nowPlaying').textContent = it ? ((room.idx + 1) + '/' + n + '  ' + (it.title || it.id)) : '재생목록이 비어 있습니다';
}

$('playBtn').addEventListener('click', () => {
  if (!isHost || !room) return;
  send({ t: 'ctrl', op: room.playing ? 'pause' : 'play', v: TV.currentTime() });
});
$('prevBtn').addEventListener('click', () => { if (isHost) send({ t: 'ctrl', op: 'prev' }); });
$('nextBtn').addEventListener('click', () => { if (isHost) send({ t: 'ctrl', op: 'next' }); });

setInterval(() => {
  if (screen === 'room' && isHost && room && room.playing && TV.isReady()) {
    send({ t: 'sync', pos: TV.currentTime() });
  }
}, 5000);

TV.init({
  onEnded: () => { if (isHost) send({ t: 'ctrl', op: 'ended' }); },
  onBlocked: (why) => {
    if (why === 'mute') $('unmuteBtn').hidden = false;
    else toast(why, 5000);
  }
});
$('unmuteBtn').addEventListener('click', () => { TV.unmute(); $('unmuteBtn').hidden = true; });

/* ------------------------------------------------------------------ */
/* 방 설정                                                              */
/* ------------------------------------------------------------------ */
$('settingsBtn').addEventListener('click', () => {
  if (!isHost || !room) return;
  $('setTitle').value = room.title;
  $('setLinks').value = (room.playlist || []).map((it) => 'https://www.youtube.com/watch?v=' + it.id).join('\n');
  $('setCount').textContent = linkLabel($('setLinks').value);
  $('settingsModal').hidden = false;
});
$('setLinks').addEventListener('input', () => { $('setCount').textContent = linkLabel($('setLinks').value); });
$('saveSettings').addEventListener('click', () => {
  const title = $('setTitle').value.trim();
  const links = $('setLinks').value.trim();
  if (!countIds(links)) { toast('링크를 하나 이상 남겨 주세요.', 2600); return; }
  send({ t: 'settings', title: title, links: links });
  $('settingsModal').hidden = true;
  toast('방 설정을 저장했습니다.', 2200);
});

/* ------------------------------------------------------------------ */
/* 재생목록 전광판                                                       */
/* ------------------------------------------------------------------ */
let boardAnim = 0;

function drawBoard() {
  const c = world.boardCanvas;
  if (!c) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;

  g.fillStyle = '#080a0f'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(110,200,255,.3)'; g.lineWidth = 4;
  g.strokeRect(8, 8, W - 16, H - 16);

  const list = (room && room.playlist) || [];
  g.textAlign = 'left';
  g.font = 'bold 34px "Noto Sans KR",sans-serif';
  g.fillStyle = '#7fd4ff';
  g.fillText('▶  재생목록', 28, 60);
  g.font = '24px "Noto Sans KR",sans-serif';
  g.fillStyle = 'rgba(127,212,255,.6)';
  g.fillText(list.length + '곡', W - 96, 60);

  g.fillStyle = 'rgba(110,200,255,.25)';
  g.fillRect(24, 78, W - 48, 2);

  const cur = room ? room.idx : 0;
  const rows = 19;                       // 세로로 길어져 더 많이 보인다
  const rowH = 58;
  const start = Math.max(0, Math.min(Math.max(0, list.length - rows), cur - 4));
  g.font = '23px "Noto Sans KR",sans-serif';
  for (let i = 0; i < rows; i++) {
    const n = start + i;
    if (n >= list.length) break;
    const it = list[n];
    const y = 126 + i * rowH;
    const on = n === cur;
    if (on) {
      g.fillStyle = 'rgba(110,200,255,.16)';
      g.beginPath(); g.roundRect(20, y - 34, W - 40, 48, 8); g.fill();
    }
    g.fillStyle = on ? '#b9e6ff' : 'rgba(170,195,215,.5)';
    g.fillText(fit(g, (n + 1) + '. ' + (it.title || it.id), W - 112), 34, y);
    if (on && room && room.playing) {
      for (let k = 0; k < 3; k++) {
        const bh = 8 + Math.abs(Math.sin(boardAnim * 4 + k)) * 16;
        g.fillRect(W - 74 + k * 11, y - bh + 4, 7, bh);
      }
    }
  }
  if (list.length > start + rows) {
    g.fillStyle = 'rgba(127,212,255,.45)';
    g.font = '21px "Noto Sans KR",sans-serif';
    g.fillText('⋯ 외 ' + (list.length - start - rows) + '곡', 34, 126 + rows * rowH + 6);
  }
  if (!list.length) {
    g.fillStyle = 'rgba(170,195,215,.4)';
    g.font = '24px "Noto Sans KR",sans-serif';
    g.fillText('비어 있습니다', 34, 140);
  }
  world.boardTexture.needsUpdate = true;
}

function fit(g, s, maxW) {
  if (g.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid + 1; else hi = mid;
  }
  return s.slice(0, Math.max(1, lo - 1)) + '…';
}

/* ------------------------------------------------------------------ */
/* 입력                                                                 */
/* ------------------------------------------------------------------ */
const keys = Object.create(null);
let typing = false;
const drag = { on: false, moved: 0, lx: 0, ly: 0, t0: 0, button: 0 };

const chatInput = $('chatInput');
chatInput.addEventListener('focus', () => { typing = true; clearUnread(); });
chatInput.addEventListener('blur', () => { typing = false; });
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const v = chatInput.value.trim();
    if (v) send({ t: 'chat', txt: v });
    chatInput.value = ''; chatInput.blur();
  } else if (e.key === 'Escape') { chatInput.value = ''; chatInput.blur(); }
});

window.addEventListener('keydown', (e) => {
  if (screen !== 'room') return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'Escape') {
    if (!$('helpModal').hidden || !$('settingsModal').hidden) {
      $('helpModal').hidden = true; $('settingsModal').hidden = true;
    } else if (cam.mode === 'watch') setWatchMode(false);
    return;
  }
  if (e.key === 'Enter') {
    if (chatMin) setChatMin(false);
    chatInput.focus();
    e.preventDefault();
    return;
  }
  if (e.key === '?' || e.key === '/') { $('helpModal').hidden = false; e.preventDefault(); return; }
  if (e.key === ' ') { jump(); e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (k === 'f') { shootForward(); e.preventDefault(); return; }
  if (k === 'v') { setWatchMode(cam.mode !== 'watch'); return; }
  keys[k] = true;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; drag.on = false; });

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  if (screen !== 'room' || cam.mode === 'watch') return;
  e.preventDefault();
  cam.dist = Math.max(5, Math.min(22, cam.dist + Math.sign(e.deltaY) * 1.1));
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  if (screen !== 'room') return;
  drag.on = true; drag.moved = 0; drag.lx = e.clientX; drag.ly = e.clientY;
  drag.t0 = performance.now(); drag.button = e.button;
  if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
});

window.addEventListener('pointermove', (e) => {
  if (!drag.on || screen !== 'room') return;
  const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
  drag.lx = e.clientX; drag.ly = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.moved < 5) return;
  if (cam.mode === 'watch') {
    cam.yaw -= dx * 0.004;
    cam.look = Math.max(-0.6, Math.min(0.5, cam.look - dy * 0.003));
  } else {
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.max(0.35, Math.min(1.32, cam.pitch - dy * 0.004));
  }
});

window.addEventListener('pointerup', (e) => {
  if (!drag.on) return;
  drag.on = false;
  if (screen !== 'room') return;
  const quick = performance.now() - drag.t0 < 350 && drag.moved < 6;
  if (!quick) return;
  if (drag.button === 2) shootAtPointer(e.clientX, e.clientY);
  else clickFloor(e.clientX, e.clientY);
});

function pointerRay(cx, cy) {
  ndc.x = (cx / window.innerWidth) * 2 - 1;
  ndc.y = -(cy / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
}

function clickFloor(cx, cy) {
  pointerRay(cx, cy);
  const hits = raycaster.intersectObjects(world.collidables, false);
  const floor = hits.find((h) => h.object.name === 'floor');
  if (!floor) return;
  moveTarget = { x: floor.point.x, z: floor.point.z };
}

/* ------------------------------------------------------------------ */
/* 흡착 화살                                                            */
/* ------------------------------------------------------------------ */
function handPos() {
  return new THREE.Vector3(
    me.x + Math.sin(me.dir) * 0.25,
    1.15,
    me.z + Math.cos(me.dir) * 0.25
  );
}

function allTargets() {
  const targets = world.collidables.slice();
  others.forEach((g) => g.av.hitMeshes.forEach((mh) => targets.push(mh)));
  return targets;
}

function fireMessage(origin, point, normal, pid) {
  send({
    t: 'arrow',
    ox: toNet(origin.x), oy: toNet(origin.y), oz: toNet(origin.z),
    hx: toNet(point.x), hy: toNet(point.y), hz: toNet(point.z),
    nx: Math.round(normal.x * 1000), ny: Math.round(normal.y * 1000), nz: Math.round(normal.z * 1000),
    pid: pid || 0
  });
}

function shootAtPointer(cx, cy) {
  pointerRay(cx, cy);
  const hits = raycaster.intersectObjects(allTargets(), false);
  if (!hits.length) return;
  const h = hits[0];
  const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  fireMessage(handPos(), h.point, n, hitToPlayer.get(h.object.uuid));
}

function shootForward() {
  const o = handPos();
  const dir = new THREE.Vector3(Math.sin(me.dir), 0.1, Math.cos(me.dir)).normalize();
  raycaster.set(o, dir);
  const hits = raycaster.intersectObjects(allTargets(), false);
  const h = hits[0];
  const point = h ? h.point : o.clone().addScaledVector(dir, 12);
  const n = (h && h.face)
    ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
    : dir.clone().negate();
  fireMessage(o, point, n, h ? hitToPlayer.get(h.object.uuid) : 0);
}

const DART_SPEED = 16, DART_LIFE = 5, DART_FADE = 0.7;

function makeDart(color) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.24, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.6, transparent: true })
  );
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.03, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0xff6b5c, roughness: 0.45, transparent: true })
  );
  cup.rotation.x = -Math.PI / 2;
  cup.position.z = 0.14;
  g.add(cup);
  const fin = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.1, 8),
    new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, transparent: true })
  );
  fin.rotation.x = -Math.PI / 2;
  fin.position.z = -0.14;
  g.add(fin);
  return g;
}

const DART_AXIS = new THREE.Vector3(0, 0, 1);   // 화살촉이 바라보는 로컬 축

function spawnDart(m) {
  const from = new THREE.Vector3(m.ox / 100, m.oy / 100, m.oz / 100);
  const to = new THREE.Vector3(m.hx / 100, m.hy / 100, m.hz / 100);
  const obj = makeDart(colorOf(m.id)[0]);
  obj.position.copy(from);

  // 날아가는 방향으로 촉을 맞춘다.
  //   lookAt 은 로컬 -z 를 대상으로 향하게 하는데 촉은 +z 에 있고,
  //   도착한 순간에는 방향 벡터가 0 이 되어 엉뚱한 쪽을 보게 된다.
  //   그래서 쏠 때 한 번만 계산해 고정한다.
  const dir = to.clone().sub(from);
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
  dir.normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(DART_AXIS, dir);
  obj.quaternion.copy(quat);

  scene.add(obj);

  const d = {
    obj: obj, from: from, to: to, quat: quat,
    dist: Math.max(0.001, from.distanceTo(to)),
    travel: 0, stuck: false, t: 0,
    pid: m.pid || 0, offset: null
  };
  if (d.pid) {
    const g = d.pid === myId ? { x: me.x, z: me.z } : others.get(d.pid);
    if (g) d.offset = new THREE.Vector3(to.x - g.x, to.y, to.z - g.z);
  }
  darts.push(d);
  if (darts.length > 80) { const old = darts.shift(); scene.remove(old.obj); }
}

function updateDarts(dt) {
  for (let i = darts.length - 1; i >= 0; i--) {
    const d = darts[i];
    if (!d.stuck) {
      d.travel += DART_SPEED * dt;
      const k = Math.min(1, d.travel / d.dist);
      d.obj.position.lerpVectors(d.from, d.to, k);
      if (k >= 1) { d.stuck = true; d.t = 0; }
    } else {
      d.t += dt;
      if (d.pid && d.offset) {
        const g = d.pid === myId ? { x: me.x, z: me.z } : others.get(d.pid);
        if (g) d.obj.position.set(g.x + d.offset.x, d.offset.y, g.z + d.offset.z);
      }
      // 꽂히고 잠깐 떤다 — 원래 방향 위에 얹어서 틀어지지 않게
      const wob = Math.sin(d.t * 22) * Math.max(0, 1 - d.t * 2.4) * 0.09;
      d.obj.quaternion.copy(d.quat);
      d.obj.rotateX(wob);
      if (d.t > DART_LIFE) {
        const a = Math.max(0, 1 - (d.t - DART_LIFE) / DART_FADE);
        d.obj.traverse((o) => { if (o.isMesh) o.material.opacity = a; });
        if (a <= 0) { scene.remove(d.obj); darts.splice(i, 1); }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 시청 모드 (1인칭)                                                     */
/* ------------------------------------------------------------------ */
function jump() {
  if (screen !== 'room' || !me.grounded) return;
  me.vy = JUMP_V;
  me.grounded = false;
}

function setWatchMode(on) {
  if (on === (cam.mode === 'watch')) return;
  cam.mode = on ? 'watch' : 'lounge';
  $('watchBtn').classList.toggle('on', on);
  $('watchBtn').textContent = on ? '시청 모드 끄기' : '시청 모드';
  document.body.classList.toggle('watching', on);
  if (on) {
    const t = world.tvTransform;
    cam.yaw = Math.atan2(t.x - me.x, t.z - me.z);
    cam.look = 0.05;
    toast('시청 모드 — 드래그로 둘러보기, V 또는 Esc 로 나가기', 3600);
  }
}
$('watchBtn').addEventListener('click', () => setWatchMode(cam.mode !== 'watch'));

/* 터치 기기용 — 키보드가 없는 환경에서 점프와 화살 */
$('touchJump').addEventListener('click', (e) => { e.preventDefault(); jump(); });
$('touchArrow').addEventListener('click', (e) => { e.preventDefault(); shootForward(); });
$('helpBtn').addEventListener('click', () => { $('helpModal').hidden = false; });

/* ------------------------------------------------------------------ */
/* 갱신                                                                 */
/* ------------------------------------------------------------------ */
const SPEED = 3.2;                 // 방이 넓어져 걸음을 조금 빠르게
const GRAVITY = 16;                // m/s²
const JUMP_V = 4.6;                // 솟구치는 속도 → 최고 0.66m, 체공 0.58초
const TURN_RATE = 1.7;             // 방향키 좌우 회전 (rad/s)
const TILT_RATE = 1.0;             // 라운지 뷰 위아래
const LOOK_RATE = 0.9;             // 시청 모드 위아래
let sendAt = 0;

function update(dt, now) {
  if (screen !== 'room') return;

  let fx = 0, fz = 0;
  if (!typing) {
    if (keys['w']) fz += 1;
    if (keys['s']) fz -= 1;
    if (keys['a']) fx -= 1;
    if (keys['d']) fx += 1;
  }
  if (fx || fz) moveTarget = null;

  /* 방향키로 시점 회전 (마우스 드래그와 같은 방향) */
  if (!typing) {
    let turn = 0, tilt = 0;
    if (keys['arrowleft']) turn += 1;
    if (keys['arrowright']) turn -= 1;
    if (keys['arrowup']) tilt += 1;
    if (keys['arrowdown']) tilt -= 1;
    if (turn) cam.yaw += turn * TURN_RATE * dt;
    if (tilt) {
      if (cam.mode === 'watch') {
        cam.look = Math.max(-0.6, Math.min(0.5, cam.look + tilt * LOOK_RATE * dt));
      } else {
        cam.pitch = Math.max(0.35, Math.min(1.32, cam.pitch + tilt * TILT_RATE * dt));
      }
    }
  }

  let vx = 0, vz = 0;
  if (fx || fz) {
    // 카메라가 바라보는 수평 방향을 앞으로 삼는다
    const camYaw = cam.mode === 'watch' ? cam.yaw : cam.yaw + Math.PI;
    const mv = R.moveVector(camYaw, fx, fz);
    vx = mv.x;
    vz = mv.z;
  } else if (moveTarget) {
    const dx = moveTarget.x - me.x, dz = moveTarget.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) moveTarget = null;
    else { vx = dx / d; vz = dz / d; }
  }

  const moving = !!(vx || vz);
  if (moving) {
    const l = Math.hypot(vx, vz) || 1;
    const nx = me.x + (vx / l) * SPEED * dt;
    const nz = me.z + (vz / l) * SPEED * dt;
    const p = R.collide(nx, nz, 0.26, me.y);
    if (Math.abs(p.x - me.x) < 0.0005 && Math.abs(p.z - me.z) < 0.0005) moveTarget = null;
    me.x = p.x; me.z = p.z;
    me.dir = Math.atan2(vx, vz);
    me.st = 1;
  } else me.st = 0;

  /* 점프 — 위아래 */
  me.vy -= GRAVITY * dt;
  me.y += me.vy * dt;
  const ground = R.groundAt(me.x, me.z);
  if (me.y <= ground) {                    // 착지
    me.y = ground;
    me.vy = 0;
    me.grounded = true;
  } else {
    me.grounded = false;
  }

  for (const g of others.values()) {
    const k = 1 - Math.pow(0.0001, dt);
    g.x += (g.tx - g.x) * k;
    g.z += (g.tz - g.z) * k;
    g.y += (g.ty - g.y) * Math.min(1, dt * 18);
    let dd = g.tdir - g.dir;
    while (dd > Math.PI) dd -= Math.PI * 2;
    while (dd < -Math.PI) dd += Math.PI * 2;
    g.dir += dd * k;
  }

  updateDarts(dt);

  /* 카메라 */
  const aim = new THREE.Vector3();
  const pos = new THREE.Vector3();
  if (cam.mode === 'watch') {
    pos.set(me.x, 1.56 + me.y, me.z);
    aim.set(
      me.x + Math.sin(cam.yaw) * 4,
      1.56 + me.y + Math.sin(cam.look) * 4,
      me.z + Math.cos(cam.yaw) * 4
    );
  } else {
    aim.set(me.x, 1.05 + me.y * 0.6, me.z);
    const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    pos.set(
      me.x + cam.dist * sp * Math.sin(cam.yaw),
      1.05 + me.y * 0.6 + cam.dist * cp,
      me.z + cam.dist * sp * Math.cos(cam.yaw)
    );
  }
  const k = 1 - Math.pow(0.0015, dt);
  camPos.lerp(pos, cam.mode === 'watch' ? Math.min(1, k * 1.6) : k);
  camAim.lerp(aim, cam.mode === 'watch' ? Math.min(1, k * 1.6) : k);
  camera.position.copy(camPos);
  camera.lookAt(camAim);

  if (myAvatar) myAvatar.update(me, dt, now / 1000, cam.mode === 'watch');
  for (const g of others.values()) g.av.update(g, dt, now / 1000, false);

  if (now - sendAt > 90) {
    sendAt = now;
    send({
      t: 'm', x: toNet(me.x), y: toNet(me.z),
      dir: Math.round(me.dir * 100) / 100, st: me.st, h: toNet(me.y)
    });
  }
}

/* ------------------------------------------------------------------ */
/* 루프                                                                 */
/* ------------------------------------------------------------------ */
let last = performance.now(), errCount = 0, boardTick = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  try {
    update(dt, now);
    world.update(now / 1000, !!(room && room.playing));

    // 전광판은 재생 중일 때만 다시 그린다 (막대 애니메이션 때문)
    // 멈춰 있으면 내용이 바뀔 때만 그리므로 텍스처를 매번 올리지 않는다
    if (screen === 'room' && room && room.playing) {
      boardTick += dt;
      if (boardTick > 0.13) { boardTick = 0; boardAnim = now / 1000; drawBoard(); }
    }

    renderer.render(scene, camera);
    cssRenderer.render(cssScene, camera);
  } catch (e) {
    errCount++;
    window.__renderErrors = errCount;
    if (errCount < 4) console.error('render error', e);
  }
}
requestAnimationFrame(frame);

/* ?r=CODE 로 들어왔으면 코드를 채워 두고 안내한다 */
(function fromInvite() {
  const m = location.search.match(/[?&]r=([A-Za-z0-9]{1,8})/);
  if (!m) return;
  const code = m[1].toUpperCase();
  $('joinCode').value = code;
  $('inviteNote').textContent = '초대받은 방 ' + code + ' — 닉네임만 적고 입장하세요.';
  $('inviteNote').hidden = false;
  setTimeout(() => $('joinName').focus(), 100);
})();

cssHost.style.display = 'none';
connect();
