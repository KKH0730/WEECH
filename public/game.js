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
let rejoining = false;      // 새로고침 직후 자동 복구 중인가
let mySeat = -1;            // 내가 앉은 좌석 번호 (-1 이면 서 있음)
let sitArmed = true;        // 일어선 뒤 구역을 한 번 벗어나야 다시 앉는다
let sitRetryAt = 0;         // 거절당했을 때 잠깐 쉬는 시각

/* 방 코드·닉네임·재입장 토큰을 탭에 묶어 둔다.
 * sessionStorage 라 탭을 닫으면 사라지고, 다른 탭에 새어 나가지도 않는다. */
const SKEY = 'weech.seat';
function saveSeat(v) {
  try { sessionStorage.setItem(SKEY, JSON.stringify(v)); } catch (e) { /* 사생활 모드 등 */ }
}
function loadSeat() {
  try {
    const v = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
    return (v && v.code && v.token) ? v : null;
  } catch (e) { return null; }
}
function clearSeat() {
  try { sessionStorage.removeItem(SKEY); } catch (e) { /* 무시 */ }
}

const me = {
  id: 0, name: '', x: R.spawn.x, z: R.spawn.z, dir: Math.PI, st: 0,
  y: 0, vy: 0, grounded: true
};
const others = new Map();
let myAvatar = null;
let room = null, isHost = false;
let coHosts = [];                                  // 부방장 id 목록
const canCtl = () => isHost || coHosts.includes(myId);   // 재생·설정을 조작할 수 있는가

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
let chatMin = true;             // 접힘 여부 — 기본은 접힘 (최근 2줄만 보인다)
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
  // 접어 두어도 최근 두 줄은 보이므로, '못 본 것' 은 올려서 읽는 중일 때만이다
  if (!stick) bumpUnread();
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

/* 접기 = 내역을 두 줄로 줄인다 (입력칸은 그대로). 펴기 = 제 높이로 늘려 스크롤. */
function setChatMin(min) {
  chatMin = min;
  $('chat').classList.toggle('min', min);
  const log = $('chatlog');
  // 높이가 바뀌는 동안에도 맨 아래(최근 줄)에 붙여 둔다
  log.scrollTop = log.scrollHeight;
  setTimeout(() => { log.scrollTop = log.scrollHeight; }, 200);
  if (!min) clearUnread();
}

$('chatToggle').addEventListener('click', () => setChatMin(!chatMin));
$('chatlog').addEventListener('scroll', () => {
  if (atBottom($('chatlog'))) clearUnread();
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
  const title = $('newTitle').value.trim();
  const links = $('newLinks').value.trim();
  if (!links || !countIds(links)) { lobbyErr('유튜브 링크를 하나 이상 넣어 주세요.'); return; }
  if (creating) return;
  $('lobbyErr').hidden = true;
  setCreating(true, '방을 만드는 중…');
  send({ t: 'create', title: title, links: links });        // 이름은 서버가 지어 준다
});

$('joinByCode').addEventListener('click', () => joinRoom($('joinCode').value.trim().toUpperCase()));
$('joinCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom($('joinCode').value.trim().toUpperCase());
});

function joinRoom(code) {
  if (!code) { lobbyErr('방 코드를 입력하거나 목록에서 고르세요.'); return; }
  send({ t: 'join', code: code });                          // 이름은 서버가 지어 준다
}

/* ------------------------------------------------------------------ */
/* 앉기                                                                  */
/* ------------------------------------------------------------------ */
/* 의자 앞 구역에 들어서면 자동으로 앉는다. 자리는 서버가 배정하므로
 * 여기서는 '앉겠다' 고 보내고, 서버가 허락(seat)하면 그때 자세를 바꾼다. */
function trySit() {
  if (mySeat >= 0 || screen !== 'room') return;
  const i = R.seatAt(me.x, me.z, me.y);
  if (i < 0) { sitArmed = true; return; }         // 구역을 벗어났다 — 다시 앉을 준비
  if (!sitArmed) return;                          // 방금 일어선 그 자리다
  if (!me.grounded) return;                       // 뛰어넘는 중에는 앉지 않는다
  if (performance.now() < sitRetryAt) return;
  send({ t: 'sit', i: i });
}

/* 서버가 자리를 내줬다 — 의자에 딱 맞춰 앉힌다 */
function sitAt(i) {
  const st = R.seats[i];
  if (!st) return;
  mySeat = i;
  sitArmed = false;
  me.x = st.x; me.z = st.z; me.dir = st.rot;
  me.y = st.y; me.vy = 0; me.grounded = true;
  me.st = 2;
  moveTarget = null;
  toast('앉았습니다 — 움직이면 일어섭니다.', 2200);
}

function standUp() {
  if (mySeat < 0) return;
  const st = R.seats[mySeat];
  mySeat = -1;
  me.st = 0;
  sitArmed = false;                               // 구역을 벗어나기 전엔 다시 앉지 않는다
  if (st) {                                        // 의자 앞으로 한 걸음 물러난다
    const p = R.collide(st.zx, st.zz - 0.3, 0.26, st.y);
    me.x = p.x; me.z = p.z;
  }
  send({ t: 'stand' });
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
      // 소켓만 끊겼던 경우 — 토큰이 있으면 원래 자리로 돌아간다
      ws.send(JSON.stringify({ t: 'join', code: lastJoin.code, name: lastJoin.name, token: lastJoin.token }));
      return;
    }
    const seat = loadSeat();
    if (screen === 'lobby' && seat) {
      // 새로고침 직후 — 로비를 거치지 않고 있던 방으로 돌아간다
      rejoining = true;
      me.name = seat.name;
      lastJoin = seat;
      ws.send(JSON.stringify({ t: 'join', code: seat.code, name: seat.name, token: seat.token }));
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
        if (m.stale) {
          // 있던 자리가 사라졌다 — 보관해 둔 좌석을 버리고 로비로
          clearSeat();
          lastJoin = null;
          rejoining = false;
          if (screen === 'room') leaveToLobby();
          lobbyErr(m.msg + ' 로비에서 다시 들어와 주세요.');
          break;
        }
        if (screen === 'lobby') lobbyErr(m.msg); else toast(m.msg, 3000);
        break;

      case 'joined': {
        setCreating(false);
        myId = m.you; me.id = m.you;
        if (m.name) me.name = m.name;          // 서버가 지어 준 이름
        room = m.room;
        isHost = (m.host === myId);
        coHosts = (room && room.coHosts) || [];
        rejoining = false;
        lastJoin = { code: room.code, name: me.name, token: m.token || (lastJoin && lastJoin.token) };
        saveSeat(lastJoin);
        clearAvatars();
        mySeat = -1; me.st = 0;
        (m.users || []).forEach((u) => {
          if (u.id === myId) { me.x = u.x / 100; me.z = u.y / 100; return; }
          addOther(u);
        });
        // 새로고침으로 돌아왔다면 앉아 있던 의자도 그대로
        const seated = m.seats || {};
        if (seated[myId] !== undefined && seated[myId] >= 0) sitAt(seated[myId]);
        enterRoom();
        break;
      }

      case 'left': leaveToLobby(); break;

      case 'kicked':
        // 보관해 둔 자리를 버려야 새로고침해도 다시 끌려 들어가지 않는다
        clearSeat();
        lastJoin = null;
        rejoining = false;
        leaveToLobby();
        lobbyErr(m.msg || '방장이 회원님을 내보냈습니다.');
        break;

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
          g.hy = a[7] || 0; g.hp = a[8] || 0;        // 고개 각도 (시선)
          if (a[5] && a[5] !== g.name) { g.name = a[5]; g.av.setName(a[5]); }
          const gone = !!a[9];
          if (g.gone !== gone) { g.gone = gone; g.av.setGone(gone); }
        });
        for (const id of Array.from(others.keys())) if (!seen.has(id)) removeOther(id);
        peopleCache = (m.u || []).map((a) => ({ id: a[0], name: a[5], gone: !!a[9] }));
        peopleCache.sort((a, b) => (b.id === myId) - (a.id === myId) || a.id - b.id);
        renderPeopleHead();
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

      case 'seat': {
        if (m.id === myId) {
          if (m.seat >= 0) sitAt(m.seat); else { mySeat = -1; me.st = 0; }
        } else {
          const g = others.get(m.id);
          if (g) g.seat = m.seat;
        }
        break;
      }

      case 'seatno':
        // 그새 다른 사람이 앉았다 — 잠깐 쉬었다 다시 시도한다
        sitRetryAt = performance.now() + 700;
        break;

      case 'gone': {
        const g = others.get(m.id);
        if (g) { g.gone = !!m.on; g.av.setGone(m.on); }
        logMsg(esc(m.name || '누군가') + (m.on
          ? ' 님의 연결이 끊어졌습니다. 잠시 자리를 비워 둡니다.'
          : ' 님이 돌아왔습니다.'), 'sys');
        peopleSig = ''; headSig = '';      // 명단을 다시 그리게 한다
        renderPeopleHead();
        renderPeople();
        break;
      }

      case 'host':
        isHost = (m.id === myId);
        if (room) room.hostId = m.id;
        applyHostUI();
        renderPeople();
        logMsg(esc(m.name) + ' 님이 방장이 되었습니다.', 'sys');
        if (isHost) toast('방장이 되었습니다. 재생을 조작할 수 있습니다.', 3400);
        break;

      case 'roles': {
        if (room) room.hostId = m.hostId;
        isHost = (m.hostId === myId);
        const wasCo = coHosts.includes(myId);
        coHosts = m.coHosts || [];
        if (!wasCo && coHosts.includes(myId) && !isHost) toast('부방장이 되었습니다. 재생을 조작할 수 있습니다.', 3400);
        if (wasCo && !coHosts.includes(myId) && !isHost) toast('부방장에서 해제되었습니다.', 2600);
        applyHostUI();
        renderPeople();
        break;
      }

      case 'chat': {
        const g = others.get(m.id);
        const av = m.id === myId ? myAvatar : (g ? g.av : null);
        if (av) av.say(m.txt);
        logMsg('<b>' + esc(m.name) + '</b>' + esc(m.txt) +
          '<span class="tm">' + nowHM() + '</span>', m.id === myId ? 'me' : '');
        break;
      }

      case 'rename': {
        if (m.id === myId) {
          me.name = m.name;
          if (myAvatar) myAvatar.setName(m.name);
          if (lastJoin) { lastJoin.name = m.name; saveSeat(lastJoin); }
          toast('이름을 ' + m.name + ' 으로 바꿨습니다.', 2600);
        } else {
          const g = others.get(m.id);
          if (g) { g.name = m.name; g.av.setName(m.name); }
        }
        logMsg(esc(m.was) + ' 님이 이름을 <b>' + esc(m.name) + '</b> 으로 바꿨습니다.', 'sys');
        peopleSig = ''; headSig = '';
        renderPeopleHead();
        renderPeople();
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
        renderPlTracks();
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
  if (u.gone) av.setGone(true);
  const g = {
    id: u.id, name: u.name || '익명', gone: !!u.gone, seat: (u.seat === undefined ? -1 : u.seat),
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

  $('peopleToggle').classList.toggle('open', peopleOpen);
  $('peopleList').hidden = !peopleOpen;
  headSig = ''; headCount = -1; peopleSig = '';
  applyHostUI();
  applyPlayback();
  drawBoard();
  logMsg('<b>' + esc(me.name) + '</b> 님으로 들어왔습니다. 이름은 왼쪽 <b>참여자</b> 목록에서 바꿀 수 있습니다.', 'sys');
  logMsg('<b>Space</b> 점프 · <b>V</b> 시청 모드 · <b>?</b> 전체 조작.', 'sys');
}

function leaveToLobby() {
  openShare(false);
  openSet(false);
  closePMenu();
  screen = 'lobby';
  room = null; isHost = false;
  clearAvatars();
  darts.forEach((d) => scene.remove(d.obj));
  darts.length = 0;
  $('hud').hidden = true;
  $('lobby').hidden = false;
  $('chatlog').innerHTML = '';
  clearUnread();
  setChatMin(true);               // 기본 상태(접힘)로 되돌린다
  cssHost.style.display = 'none';
  setWatchMode(false);
  renderRooms();
}

$('leaveBtn').addEventListener('click', () => {
  if (confirm('방에서 나갈까요?')) { clearSeat(); lastJoin = null; send({ t: 'leave' }); }
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

/* ---- 설정(톱니바퀴) — 방 제목 수정 · 도움말 · 공유를 하나로 묶는다 ----
 *  상단 막대에 버튼을 늘어놓는 대신 ⚙ 하나만 두고 아래로 펼친다.
 *  공유는 입장 코드 칩이 넓어 별도 패널로 띄우되, 같은 ⚙ 아래에 붙인다.
 * ------------------------------------------------------------------ */
const shareDrop = $('shareDrop');
const setBtn = $('setBtn'), setDrop = $('setDrop');

function syncSetBtn() {
  const on = !setDrop.hidden || !shareDrop.hidden;
  setBtn.classList.toggle('open', on);
  setBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
}
function openSet(open) {
  setDrop.hidden = !open;
  if (open) shareDrop.hidden = true;        // 둘이 겹쳐 뜨지 않게
  syncSetBtn();
}
function openShare(open) {
  shareDrop.hidden = !open;
  if (open) setDrop.hidden = true;
  syncSetBtn();
}

setBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openView(false);                                       // 시점 메뉴와 겹치지 않게
  if (!shareDrop.hidden) { openShare(false); return; }   // 공유가 펼쳐져 있으면 접는다
  openSet(setDrop.hidden);
});
setDrop.addEventListener('click', (e) => e.stopPropagation());
shareDrop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { openSet(false); openShare(false); });

$('miTitle').addEventListener('click', () => { openSet(false); startTitleEdit(); });
$('miHelp').addEventListener('click', () => { openSet(false); $('helpModal').hidden = false; });
$('miShare').addEventListener('click', () => { openShare(true); });

$('codeBtn').addEventListener('click', () => {
  if (!room) return;
  copyText(room.code).then((ok) => {
    if (!ok) { toast('복사하지 못했습니다. 코드: ' + room.code, 4000); return; }
    const chip = $('codeBtn');
    chip.classList.add('copied');
    setTimeout(() => { chip.classList.remove('copied'); openShare(false); }, 900);
    toast('입장 코드 ' + room.code + ' 를 복사했습니다', 2400);
  });
});

$('inviteBtn').addEventListener('click', () => {
  if (!room) return;
  const url = inviteUrl();
  copyText(url).then((ok) => {
    openShare(false);
    toast(ok ? '초대 링크를 복사했습니다 — 붙여넣기만 하면 바로 입장합니다' : url, ok ? 3200 : 6000);
  });
});

/* 참여자 목록 — 기본은 펼쳐 둔다 (접힘 여부는 탭에 기억해 둔다) */
let peopleOpen = (() => {
  try { return sessionStorage.getItem('weech.people') !== '0'; } catch (e) { return true; }
})();
let peopleCache = [];

$('peopleToggle').addEventListener('click', () => {
  peopleOpen = !peopleOpen;
  try { sessionStorage.setItem('weech.people', peopleOpen ? '1' : '0'); } catch (e) { /* 무시 */ }
  $('peopleToggle').classList.toggle('open', peopleOpen);
  $('peopleList').hidden = !peopleOpen;
  if (peopleOpen) renderPeople();
});

/* 머리말 — 목록을 접어 두어도 인원수와 색 점은 늘 보인다.
 * 위치 브로드캐스트가 10Hz 로 들어오므로 바뀐 때만 다시 그린다. */
let headSig = '', headCount = -1;
function renderPeopleHead() {
  const sig = peopleCache.map((p) => p.id + (p.gone ? 'x' : '')).join(',');
  if (sig === headSig) return;
  headSig = sig;

  const n = peopleCache.length || 1;
  $('roomPeople').textContent = n;

  // 인원이 바뀌었으면 잠깐 반짝여 눈에 띄게 한다
  if (headCount >= 0 && n !== headCount) {
    const el = $('peopleToggle');
    el.classList.remove('bump');
    void el.offsetWidth;                 // 애니메이션을 다시 태우려면 한 번 끊어줘야 한다
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 800);
  }
  headCount = n;
}

let peopleSig = '';
function renderPeople() {
  if (!peopleOpen) return;
  if (renaming) return;              // 이름을 고치는 중에는 입력칸을 지우지 않는다
  // 명단·역할이 실제로 바뀐 경우에만 DOM 을 다시 만든다.
  // (위치 브로드캐스트가 10Hz 로 들어와 매번 다시 그리면 커서 밑 버튼이 깜빡인다)
  const sig = JSON.stringify([
    peopleCache.map((p) => [p.id, p.name, p.gone ? 1 : 0]),
    room && room.hostId, coHosts, isHost, myId
  ]);
  if (sig === peopleSig) return;
  peopleSig = sig;
  closePMenu();                      // 기대고 있던 ⋯ 버튼이 다시 만들어진다

  const box = $('peopleList');
  if (!peopleCache.length) { box.innerHTML = '<div class="person"><span class="nm dim">—</span></div>'; return; }
  box.innerHTML = peopleCache.map((p) => {
    const c = colorOf(p.id)[0].toString(16).padStart(6, '0');
    const isP = room && room.hostId === p.id;
    const isCo = coHosts.includes(p.id);
    const badges =
      (isP ? '<span class="badge host">방장</span>' : '') +
      (isCo ? '<span class="badge cohost">부방장</span>' : '') +
      (p.id === myId ? '<span class="badge me">나</span>' : '') +
      (p.gone ? '<span class="badge gone">연결 끊김</span>' : '');
    // 내 줄에는 ✎ (이름 바꾸기), 남의 줄에는 방장만 쓸 수 있는 ⋯ (관리)
    const acts = p.id === myId
      ? '<button class="pedit" title="이름 바꾸기" aria-label="이름 바꾸기">✎</button>'
      : ((isHost && !isP)
        ? '<button class="pmore" data-more="' + p.id + '" title="관리" aria-label="관리">⋯</button>'
        : '');
    return '<div class="person' + (p.gone ? ' isgone' : '') + '"><span class="swatch" style="background:#' + c + '"></span>' +
           '<span class="nm">' + esc(p.name || '익명') + '</span>' + badges + acts + '</div>';
  }).join('');
}

/* ---- 사람 관리 메뉴 (방장만) --------------------------------------
 *  목록 상자가 overflow:auto 라 그 안에 드롭다운을 넣으면 잘린다.
 *  메뉴는 하나만 만들어 목록 바깥에 두고, 누른 ⋯ 버튼 아래로 옮겨 띄운다.
 * ------------------------------------------------------------------ */
const pmenu = $('pmenu');
let pmenuId = -1;

function closePMenu() {
  if (pmenuId < 0) return;
  pmenuId = -1;
  pmenu.hidden = true;
  const open = $('peopleList').querySelector('.pmore.open');
  if (open) open.classList.remove('open');
}

function openPMenu(id, anchor) {
  const p = peopleCache.find((x) => x.id === id);
  if (!p || !isHost) return;
  const isCo = coHosts.includes(id);
  pmenuId = id;
  pmenu.innerHTML =
    '<button class="pmi" data-act="cohost" data-on="' + (isCo ? '0' : '1') + '">' +
      (isCo ? '부방장 해제' : '부방장 지정') + '</button>' +
    '<button class="pmi" data-act="makehost">방장 넘기기</button>' +
    '<div class="sep"></div>' +
    '<button class="pmi danger" data-act="kick">내보내기</button>';
  pmenu.hidden = false;
  anchor.classList.add('open');

  // 버튼 아래에 붙이되, 화면 밖으로 나가면 안쪽으로 당긴다
  const r = anchor.getBoundingClientRect();
  const mw = pmenu.offsetWidth, mh = pmenu.offsetHeight;
  let left = r.right - mw;
  let top = r.bottom + 6;
  if (left < 8) left = 8;
  if (left + mw > innerWidth - 8) left = innerWidth - 8 - mw;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - 6 - mh);   // 자리가 없으면 위로
  pmenu.style.left = left + 'px';
  pmenu.style.top = top + 'px';
}

/* ---- 내 이름 바꾸기 — 참여자 목록의 내 줄에서만 ----------------------
 *  이름은 입장할 때 서버가 지어 준다. 마음에 안 들면 여기서 고친다.
 *  고치는 동안에는 10Hz 로 들어오는 명단 갱신이 입력칸을 지우지 않게 막는다.
 * ------------------------------------------------------------------ */
let renaming = false;

function startRename(btn) {
  if (renaming) return;
  const row = btn.closest('.person');
  const nm = row && row.querySelector('.nm');
  if (!nm) return;
  renaming = true;
  btn.hidden = true;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'nminput';
  inp.maxLength = 12;
  inp.value = me.name || '';
  nm.replaceWith(inp);
  inp.focus();
  inp.select();

  const done = (save) => {
    if (!renaming) return;
    renaming = false;
    const v = inp.value.trim();
    if (save && v && v !== me.name) send({ t: 'rename', name: v });
    peopleSig = '';                  // 원래 모양으로 다시 그린다
    renderPeople();
  };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
  });
  inp.addEventListener('blur', () => done(true));
}

$('peopleList').addEventListener('click', (e) => {
  const ed = e.target.closest('button.pedit');
  if (ed) { e.stopPropagation(); startRename(ed); return; }
  const b = e.target.closest('button.pmore');
  if (!b) return;
  e.stopPropagation();
  const id = +b.dataset.more;
  if (pmenuId === id) { closePMenu(); return; }    // 같은 버튼을 다시 누르면 닫는다
  closePMenu();
  openPMenu(id, b);
});

pmenu.addEventListener('click', (e) => {
  const b = e.target.closest('button.pmi');
  if (!b) return;
  e.stopPropagation();
  const id = pmenuId;
  const p = peopleCache.find((x) => x.id === id);
  const who = (p ? p.name : '이 사람');
  closePMenu();
  if (!isHost || id < 0) return;

  if (b.dataset.act === 'makehost') {
    if (confirm(who + ' 님에게 방장을 넘기시겠습니까?')) send({ t: 'makehost', id: id });
  } else if (b.dataset.act === 'cohost') {
    send({ t: 'cohost', id: id, on: b.dataset.on === '1' });
  } else if (b.dataset.act === 'kick') {
    if (confirm(who + ' 님을 방에서 내보낼까요? 잠시 동안 같은 창으로는 다시 들어오지 못합니다.')) {
      send({ t: 'kick', id: id });
    }
  }
});

document.addEventListener('click', closePMenu);
$('peopleList').addEventListener('scroll', closePMenu);
addEventListener('resize', closePMenu);

function applyHostUI() {
  const ctl = canCtl();
  $('hostCtl').hidden = !ctl;
  $('guestNote').hidden = ctl;
  $('playlistBtn').hidden = !ctl;
  $('miTitle').hidden = !ctl;          // 설정 메뉴의 '방 제목 수정'
  $('titleEdit').hidden = !ctl;        // 제목 옆 연필
  // 좌상단 제목도 같은 권한일 때만 눌린다 (#hud 가 pointer-events:none 이라 클래스로 켠다)
  const rt = $('roomTitle');
  rt.classList.toggle('editable', ctl);
  rt.title = ctl ? '눌러서 방 제목 수정' : '';
  $('playerbar').classList.toggle('host-seek', ctl);
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
  renderPlTracks();
}

/* 네온관처럼 — 번지는 빛을 여러 겹 쌓고 마지막에 밝은 심지를 올린다 */
function neonText(g, text, x, y, glow, core, blur) {
  g.shadowColor = glow;
  g.shadowOffsetX = 0; g.shadowOffsetY = 0;
  for (let i = 3; i >= 1; i--) {               // 바깥 번짐 → 안쪽으로
    g.shadowBlur = blur * i;
    g.fillStyle = glow;
    g.fillText(text, x, y);
  }
  g.shadowBlur = blur * 0.5;
  g.fillStyle = core;                          // 심지는 거의 흰색
  g.fillText(text, x, y);
  g.shadowBlur = 0; g.shadowColor = 'transparent';
}

/* 글자를 '보이는 높이' 기준으로 세로 가운데에 놓을 베이스라인 y.
 *  textBaseline:'middle' 은 em 상자 기준이라 내려쓰기(g·y·괄호)가 있으면 아래로 쏠린다.
 *  제목이 바뀔 때마다 높이가 들썩이지 않도록 '내용' 이 아니라 고정 기준 글자로 잰다. */
const VREF = '가힣AH';          // 내려쓰기(g·y)는 뺀다 — 글자 몸통을 기준으로 삼는다
function centerBaseline(g, mid) {
  const m = g.measureText(VREF);
  const a = m.actualBoundingBoxAscent, d = m.actualBoundingBoxDescent;
  if (!isFinite(a) || !isFinite(d)) return mid;        // 못 재는 환경이면 그대로
  return mid + (a - d) / 2;
}

/* ---- 스크린 위 네온 간판 ---------------------------------------
 *  재는 일(레이아웃)과 그리는 일을 나눈다. 제목이 간판보다 길면 흐르게 하는데,
 *  흐르는 동안 매 프레임 글자 폭을 다시 재면 낭비라 한 번 재서 들고 있는다.
 * ------------------------------------------------------------------ */
const NEON_PINK = 'rgba(255,88,176,.95)', NEON_PALE = '#fff0f8';
const NEON_PAD = 56;
const NEON_SPEED = 100;        // 흐르는 속도 (캔버스 px/초)
const neonFont = (px) => '700 ' + px + 'px "Noto Sans KR",sans-serif';

let neonLayout = null;         // 지금 간판에 뭘 어디에 그릴지
let neonPhase = 0;             // 흐른 거리 (px)
let neonTick = 0;              // 다시 그릴 때까지 모아 둔 시간

/* 간판 내용이 바뀌었다 — 자리를 다시 재고 한 번 그린다 */
function updateNowPlaying() {
  const c = world.neonCanvas;
  if (!c) return;
  const g = c.getContext('2d');
  const W = c.width;

  const it = currentItem();
  if (!it) { neonLayout = { empty: true }; neonPhase = 0; drawNeon(); return; }

  const total = room && room.playlist ? room.playlist.length : 0;
  const num = (room.idx + 1) + ' / ' + total;

  g.font = '500 46px "Noto Sans KR",sans-serif';     // 불러온 굵기(400·500·700) 안에서 고른다
  let left = NEON_PAD + g.measureText(num).width + 34;
  const barX = left;
  left += 34;

  // 제목 — 남는 폭에 맞춰 글자를 줄여 본다
  const avail = W - left - NEON_PAD;
  const title = it.title || it.id;
  let size = 88;
  g.font = neonFont(size);
  while (size > 46 && g.measureText(title).width > avail) { size -= 3; g.font = neonFont(size); }

  let marquee = false;
  if (g.measureText(title).width > avail) {
    // 46px 까지 줄여도 안 들어간다 — 말줄임 대신 흐르게 한다.
    // 흐를 거면 폭에 얽매일 필요가 없으니 글자를 다시 키워 읽기 좋게 둔다.
    marquee = true;
    size = 76;
    g.font = neonFont(size);
  }

  const w = g.measureText(title).width;
  neonLayout = {
    empty: false, num: num, barX: barX, left: left, avail: avail,
    title: title, font: neonFont(size), w: w,
    marquee: marquee,
    gap: Math.max(90, avail * 0.2)        // 꼬리와 다음 머리 사이 간격
  };
  neonPhase = 0;
  neonTick = 0;
  drawNeon();
}

/* 잘린 자리에서 글자가 뚝 끊기지 않도록 양 끝을 투명으로 깎는다 */
function fadeNeonEdges(g, x, w, h) {
  const fw = Math.min(80, w * 0.12);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  let grd = g.createLinearGradient(x, 0, x + fw, 0);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(x, 0, fw, h);
  grd = g.createLinearGradient(x + w - fw, 0, x + w, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grd; g.fillRect(x + w - fw, 0, fw, h);
  g.restore();
}

/* 재 둔 자리대로 간판을 그린다 (흐르는 중이면 neonPhase 만큼 밀어서) */
function drawNeon() {
  const L = neonLayout;
  const c = world.neonCanvas;
  if (!L || !c) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height, mid = H / 2;

  g.clearRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';          // 실제 글자 높이로 가운데를 맞추기 위해
  g.textAlign = 'left';

  if (L.empty) {
    g.textAlign = 'center';
    g.font = neonFont(74);
    neonText(g, '재생목록이 비어 있습니다', W / 2, centerBaseline(g, mid), NEON_PINK, NEON_PALE, 16);
    world.neonTexture.needsUpdate = true;
    return;
  }

  // 왼쪽에 몇 번째 곡인지 작게
  g.font = '500 46px "Noto Sans KR",sans-serif';
  neonText(g, L.num, NEON_PAD, centerBaseline(g, mid), 'rgba(255,140,200,.8)', '#ffd8ec', 12);

  // 가는 구분선
  g.shadowColor = NEON_PINK; g.shadowBlur = 14;
  g.fillStyle = 'rgba(255,140,200,.75)';
  g.fillRect(L.barX, mid - 26, 3, 52);
  g.shadowBlur = 0; g.shadowColor = 'transparent';

  g.font = L.font;
  const base = centerBaseline(g, mid);

  if (!L.marquee) {
    neonText(g, L.title, L.left, base, NEON_PINK, NEON_PALE, 18);
    world.neonTexture.needsUpdate = true;
    return;
  }

  // 흐르는 제목 — 보이는 창 밖으로 번짐까지 새지 않게 잘라 두고 그린다
  const span = L.w + L.gap;
  g.save();
  g.beginPath();
  g.rect(L.left, 0, L.avail, H);
  g.clip();
  // 한 바퀴 돌면 제자리 — 꼬리가 나가는 동안 머리가 들어오도록 두 벌 이상 그린다
  let x = L.left - (neonPhase % span);
  while (x < L.left + L.avail) {
    neonText(g, L.title, x, base, NEON_PINK, NEON_PALE, 18);
    x += span;
  }
  g.restore();
  fadeNeonEdges(g, L.left, L.avail, H);

  world.neonTexture.needsUpdate = true;
}

/* 프레임마다 조금씩 밀어 준다 — 다시 그리는 건 20fps 면 충분하다 */
function stepNeon(dt) {
  if (!neonLayout || !neonLayout.marquee) return;
  neonPhase += NEON_SPEED * dt;
  neonTick += dt;
  if (neonTick < 0.05) return;
  neonTick = 0;
  drawNeon();
}

$('playBtn').addEventListener('click', () => {
  if (!canCtl() || !room) return;
  send({ t: 'ctrl', op: room.playing ? 'pause' : 'play', v: TV.currentTime() });
});
$('prevBtn').addEventListener('click', () => { if (canCtl()) send({ t: 'ctrl', op: 'prev' }); });
$('nextBtn').addEventListener('click', () => { if (canCtl()) send({ t: 'ctrl', op: 'next' }); });

/* ±10 / ±30초 탐색 — 지금 위치 기준으로 자리 이동 */
function seekBy(delta) {
  if (!canCtl() || !room) return;
  const dur = TV.duration();
  let pos = TV.currentTime() + delta;
  if (pos < 0) pos = 0;
  if (dur > 0 && pos > dur) pos = dur;
  send({ t: 'ctrl', op: 'seek', v: pos });
}
$('back30').addEventListener('click', () => seekBy(-30));
$('back10').addEventListener('click', () => seekBy(-10));
$('fwd10').addEventListener('click', () => seekBy(10));
$('fwd30').addEventListener('click', () => seekBy(30));

/* ------------------------------------------------------------------ */
/* 프로그레스 바 — 모두 진행 표시, 드래그 탐색은 방장만                  */
/* ------------------------------------------------------------------ */
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(ss).padStart(2, '0');
};

let dragging = false;

function ratioFromEvent(e) {
  const rect = $('progress').getBoundingClientRect();
  if (rect.width <= 0) return 0;
  let r = (e.clientX - rect.left) / rect.width;
  return r < 0 ? 0 : (r > 1 ? 1 : r);
}

function paintProgress(ratio) {
  $('progFill').style.width = (ratio * 100) + '%';
  $('progKnob').style.left = (ratio * 100) + '%';
}

/* 실제 재생 위치로 바를 갱신 — 드래그 중에는 건드리지 않는다 */
function refreshProgress() {
  if (dragging) return;
  const dur = TV.duration();
  const cur = TV.currentTime();
  paintProgress(dur > 0 ? Math.min(1, cur / dur) : 0);
  $('curTime').textContent = fmtTime(cur);
  $('durTime').textContent = dur > 0 ? fmtTime(dur) : '0:00';
}
setInterval(() => { if (screen === 'room' && TV.isReady()) { refreshProgress(); refreshMedia(); } }, 250);

const prog = $('progress');
prog.addEventListener('pointerdown', (e) => {
  if (!canCtl() || !room) return;
  dragging = true;
  prog.setPointerCapture(e.pointerId);
  const r = ratioFromEvent(e);
  paintProgress(r);
  const dur = TV.duration();
  if (dur > 0) $('curTime').textContent = fmtTime(r * dur);
});
prog.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const r = ratioFromEvent(e);
  paintProgress(r);
  const dur = TV.duration();
  if (dur > 0) $('curTime').textContent = fmtTime(r * dur);
});
function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  try { prog.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const dur = TV.duration();
  if (canCtl() && room && dur > 0) send({ t: 'ctrl', op: 'seek', v: ratioFromEvent(e) * dur });
}
prog.addEventListener('pointerup', endDrag);
prog.addEventListener('pointercancel', endDrag);

/* ------------------------------------------------------------------ */
/* 볼륨 · 화질 — 각자 자기 화면에만 적용 (동기화하지 않는다)            */
/* ------------------------------------------------------------------ */
const volSlider = $('volSlider'), muteToggle = $('muteToggle');
let lastVol = 25;

function updateMuteIcon() {
  const v = +volSlider.value;
  muteToggle.textContent = (v === 0 || TV.isMuted()) ? '🔇' : (v < 50 ? '🔉' : '🔊');
}
volSlider.addEventListener('input', () => {
  const v = +volSlider.value;
  TV.setVol(v);
  if (v > 0) { lastVol = v; $('unmuteBtn').hidden = true; }
  updateMuteIcon();
});
muteToggle.addEventListener('click', () => {
  if (+volSlider.value === 0 || TV.isMuted()) {
    const v = lastVol || 80; volSlider.value = v; TV.setVol(v); $('unmuteBtn').hidden = true;
  } else {
    lastVol = +volSlider.value || 80; volSlider.value = 0; TV.setMuted(true);
  }
  updateMuteIcon();
});

/* 자막 (로컬) — 켜기/끄기 + 언어 선택 */
const ccToggle = $('ccToggle'), ccLangSel = $('ccLangSel');
let ccLangSig = '';
ccToggle.addEventListener('click', () => {
  const on = TV.setCaptions();
  ccToggle.classList.toggle('on', on);
  ccLangSel.hidden = !on;
  ccLangSig = '';                 // 다시 채우도록
  if (on) refreshCaptions();
  toast(on ? '자막 켜기 — 영상에 자막이 있으면 표시됩니다' : '자막 끄기', 2200);
});
ccLangSel.addEventListener('change', () => TV.setCaptionLang(ccLangSel.value));

/* 자막 언어 목록으로 드롭다운을 채운다 (자막이 켜져 있을 때만) */
function refreshCaptions() {
  if (!TV.captionsOn()) return;
  const tracks = TV.captionTracks();
  const sig = tracks.map((t) => t.code).join(',');
  if (sig === ccLangSig) return;
  ccLangSig = sig;
  const cur = TV.captionLang() || ccLangSel.value;
  if (!tracks.length) {
    ccLangSel.innerHTML = '<option value="">자막 없음</option>';
    return;
  }
  ccLangSel.innerHTML = tracks.map((t) => '<option value="' + t.code + '">' + t.label + '</option>').join('');
  if ([...ccLangSel.options].some((o) => o.value === cur)) ccLangSel.value = cur;
}

/* 볼륨 아이콘 · 자막 목록 주기 갱신 */
function refreshMedia() {
  updateMuteIcon();
  refreshCaptions();
}

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
/* 무엇으로 알아들었는지 입력하는 동안 바로 보여 준다.
 *  재생목록 링크는 '전체가 담긴다' 는 걸 눌러 보기 전에 알 수 있어야 한다. */
function updatePlHint() {
  const el = $('plAddHint');
  const v = $('plAddInput').value.trim();
  if (!v) { el.hidden = true; return; }
  const c = countLinks(v);
  if (!c.v && !c.p) {
    el.textContent = '유튜브 링크를 알아보지 못했습니다.';
    el.className = 'pl-hint warn';
    el.hidden = false;
    return;
  }
  const parts = [];
  if (c.p) parts.push('재생목록 <b>' + c.p + '개</b> — 목록 전체가 담깁니다');
  if (c.v) parts.push('영상 <b>' + c.v + '개</b>');
  el.innerHTML = parts.join(' + ');
  el.className = 'pl-hint';
  el.hidden = false;
}

function openPlaylist() {
  if (!canCtl() || !room) return;
  $('plAddInput').value = '';
  $('plAddHint').hidden = true;
  $('playlistPanel').hidden = false;   // 먼저 띄워야 renderPlTracks 가 그린다
  renderPlTracks();
}
$('playlistBtn').addEventListener('click', () => {
  // 토글 — 열려 있으면 닫는다
  if (!$('playlistPanel').hidden) { $('playlistPanel').hidden = true; return; }
  openPlaylist();
});

/* 현재 재생목록을 링크 문자열로 바꾼다 (서버는 settings 로 목록 전체를 교체한다) */
function currentIds() { return (room && room.playlist || []).map((it) => it.id); }

/* 재생목록 모달 — 제목 누르면 재생, ✕ 로 제거 (방장·부방장) */
function renderPlTracks() {
  const box = $('plTracks');
  if (!box || $('playlistPanel').hidden) return;
  const list = (room && room.playlist) || [];
  if (!list.length) { box.innerHTML = '<div class="pl-empty">재생목록이 비어 있습니다</div>'; return; }
  const cur = room ? room.idx : 0;
  box.innerHTML = list.map((it, i) =>
    '<div class="pl-row' + (i === cur ? ' on' : '') + '">' +
    '<button class="pl-play" data-idx="' + i + '" title="재생">' +
    '<span class="pl-num">' + (i === cur ? '▶' : (i + 1)) + '</span>' +
    '<span class="pl-title"><span class="pl-tin">' + esc(it.title || it.id) + '</span></span></button>' +
    '<button class="pl-del" data-del="' + i + '" title="제거" aria-label="제거">✕</button>' +
    '</div>'
  ).join('');
  // 선택곡은 항상, 호버한 곡은 호버하는 동안만 제목을 흐르게 한다 (넘칠 때)
  box.querySelectorAll('.pl-row').forEach((row) => {
    const title = row.querySelector('.pl-title');
    if (!title) return;
    if (row.classList.contains('on')) requestAnimationFrame(() => setTitleMarquee(title, true));
    row.addEventListener('mouseenter', () => setTitleMarquee(title, true));
    row.addEventListener('mouseleave', () => { if (!row.classList.contains('on')) setTitleMarquee(title, false); });
  });
}

/* 제목이 넘치면 두 벌로 이어 붙여 흐르게 한다 (on=켜기 / off=원래 말줄임) */
function setTitleMarquee(title, on) {
  const tin = title.querySelector('.pl-tin');
  if (!tin) return;
  if (on) {
    if (title.classList.contains('scroll')) return;
    if (tin.scrollWidth <= title.clientWidth + 2) return;        // 안 넘치면 그대로
    const label = tin.dataset.full || tin.textContent;
    tin.dataset.full = label;
    tin.textContent = '';
    for (let i = 0; i < 2; i++) {
      const seg = document.createElement('span');
      seg.className = 'pl-seg';
      seg.textContent = label;
      tin.appendChild(seg);
    }
    title.classList.add('scroll');
    tin.style.animationDuration = Math.max(6, label.length * 0.34) + 's';
  } else {
    if (!title.classList.contains('scroll')) return;
    title.classList.remove('scroll');
    tin.style.animationDuration = '';
    tin.textContent = tin.dataset.full || tin.textContent;
  }
}
$('plTracks').addEventListener('click', (e) => {
  if (!canCtl()) { toast('방장·부방장만 조작할 수 있습니다.', 2400); return; }
  const del = e.target.closest('button.pl-del');
  if (del) { removeTrack(+del.dataset.del); return; }
  const play = e.target.closest('button.pl-play');
  if (play) send({ t: 'ctrl', op: 'track', v: +play.dataset.idx });
});

function removeTrack(i) {
  if (!canCtl() || !room || !room.playlist) return;
  if (room.playlist.length <= 1) { toast('마지막 한 곡은 지울 수 없습니다.', 2600); return; }
  const links = currentIds().filter((_, idx) => idx !== i).join('\n');
  send({ t: 'settings', links: links });
}
function addTrack() {
  if (!canCtl() || !room) return;
  const v = $('plAddInput').value.trim();
  if (!v) return;
  if (!countIds(v)) { toast('유효한 유튜브 링크를 넣어 주세요.', 2600); return; }
  const links = currentIds().concat(v).join('\n');   // 기존 뒤에 덧붙인다
  send({ t: 'settings', links: links });
  $('plAddInput').value = '';
  $('plAddHint').hidden = true;
  toast(countLinks(v).p ? '재생목록을 펼치는 중…' : '추가하는 중…', 1800);
}
$('plAddInput').addEventListener('input', updatePlHint);
$('plAddBtn').addEventListener('click', addTrack);
$('plAddInput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); addTrack(); }
});

/* 방 제목 인라인 편집 — 들어가는 문이 셋이다.
 *   제목 옆 연필(고칠 수 있다는 표시) · 제목 글자 클릭 · 설정 메뉴의 '방 제목 수정' */
$('titleEdit').addEventListener('click', () => startTitleEdit());
$('roomTitle').addEventListener('click', () => startTitleEdit());

function startTitleEdit() {
  if (!canCtl() || !room) return;
  const inp = $('titleInput');
  inp.value = room.title || '';
  $('roomTitle').hidden = true;
  $('titleEdit').hidden = true;
  inp.hidden = false; inp.focus(); inp.select();
}
function commitTitle(save) {
  const inp = $('titleInput');
  if (inp.hidden) return;
  if (save) {
    const t = inp.value.trim();
    if (t && t !== room.title) send({ t: 'settings', title: t });
  }
  inp.hidden = true;
  $('roomTitle').hidden = false;
  $('titleEdit').hidden = !canCtl();
}
$('titleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitTitle(true); }
  else if (e.key === 'Escape') { e.preventDefault(); commitTitle(false); }
});
$('titleInput').addEventListener('blur', () => commitTitle(true));

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
/* keepFocus — 전송 버튼으로 보낼 땐 입력칸을 놓지 않는다.
 * 폰에서 한 줄 보낼 때마다 키보드가 내려가면 이어 치기가 번거롭다. */
function sendChat(keepFocus) {
  const v = chatInput.value.trim();
  if (v) send({ t: 'chat', txt: v });
  chatInput.value = '';
  if (!keepFocus) chatInput.blur();
}

chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') sendChat(false);          // Enter 는 보내고 조작으로 돌아간다
  else if (e.key === 'Escape') { chatInput.value = ''; chatInput.blur(); }
});

// mousedown 을 막아야 버튼을 눌러도 입력칸이 포커스를 잃지 않는다
$('chatSend').addEventListener('mousedown', (e) => e.preventDefault());
$('chatSend').addEventListener('click', (e) => {
  e.preventDefault();
  sendChat(true);
  chatInput.focus();
});

window.addEventListener('keydown', (e) => {
  if (screen !== 'room') return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'Escape') {
    if (!$('helpModal').hidden || !$('playlistPanel').hidden) {
      $('helpModal').hidden = true; $('playlistPanel').hidden = true;
    } else if (cam.mode === 'watch') setWatchMode(false);
    else if (cam.mode === 'cinema') setCinema(false);
    return;
  }
  if (e.key === 'Enter') {
    // 입력칸은 접혀 있어도 보이므로 굳이 펼치지 않는다
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
  if (screen !== 'room' || cam.mode !== 'lounge') return;
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
  if (cam.mode === 'cinema') return;           // 시네마 중엔 시점 고정
  if (cam.mode === 'watch') {
    cam.yaw -= dx * 0.004;
    cam.look = Math.max(-0.6, Math.min(1.5, cam.look - dy * 0.003));
  } else {
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.max(0.35, Math.min(2.95, cam.pitch - dy * 0.004));
  }
});

window.addEventListener('pointerup', (e) => {
  if (!drag.on) return;
  drag.on = false;
  if (screen !== 'room') return;
  const quick = performance.now() - drag.t0 < 350 && drag.moved < 6;
  if (!quick) return;
  if (cam.mode === 'cinema') return;           // 시네마 중엔 이동·화살 비활성
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

/* ---- 상단 컨트롤러 접기 --------------------------------------------
 *  아래쪽 화살표를 누르면 컨트롤러가 위로 빠지고 화살표 줄만 남는다.
 *  재생 중에도 방을 넓게 보고 싶을 때가 있다. 탭에 기억해 둔다.
 * ------------------------------------------------------------------ */
let barMin = (() => {
  try { return sessionStorage.getItem('weech.bar') === '1'; } catch (e) { return false; }
})();

function setBarMin(min) {
  barMin = min;
  $('playerbar').classList.toggle('min', min);
  $('barToggle').setAttribute('aria-expanded', min ? 'false' : 'true');
  try { sessionStorage.setItem('weech.bar', min ? '1' : '0'); } catch (e) { /* 무시 */ }
}
$('barToggle').addEventListener('click', (e) => { e.stopPropagation(); setBarMin(!barMin); });
setBarMin(barMin);                 // 새로고침해도 접어 둔 상태를 지킨다

/* ------------------------------------------------------------------ */
/* 시청 모드 (1인칭)                                                     */
/* ------------------------------------------------------------------ */
function jump() {
  if (screen !== 'room') return;
  if (mySeat >= 0) { standUp(); return; }
  if (!me.grounded) return;
  me.vy = JUMP_V;
  me.grounded = false;
}

/* 보기 모드 버튼(드롭다운)의 상태를 갱신 */
function updateViewUI() {
  const mode = cam.mode;
  const btn = $('viewBtn');
  const label = mode === 'watch' ? '1인칭 시점' : mode === 'cinema' ? '전체화면' : '3인칭 시점';
  btn.classList.toggle('on', mode !== 'lounge');
  // 눈 아이콘이라 글자가 없다 — 지금 시점은 툴팁과 드롭다운 표시로 알린다
  btn.title = '시점 — ' + label;
  btn.setAttribute('aria-label', '시점 — ' + label);
  $('viewDrop').querySelectorAll('button[data-view]').forEach((b) => {
    b.classList.toggle('active',
      (b.dataset.view === 'first' && mode === 'watch') ||
      (b.dataset.view === 'third' && mode === 'lounge') ||
      (b.dataset.view === 'cinema' && mode === 'cinema'));
  });
}

function setWatchMode(on) {
  if (on === (cam.mode === 'watch')) return;
  if (on && cam.mode === 'cinema') {        // 시네마와 겹치지 않게 먼저 해제
    document.body.classList.remove('cinema');
    exitFS();
  }
  cam.mode = on ? 'watch' : 'lounge';
  document.body.classList.toggle('watching', on);
  if (on) {
    const t = world.tvTransform;
    cam.yaw = Math.atan2(t.x - me.x, t.z - me.z);
    cam.look = 0.05;
    toast('1인칭 시점 — 드래그로 둘러보기, V 또는 Esc 로 나가기', 3600);
  } else {
    // 라운지 뷰는 카메라가 아바타를 '마주 보는' 구조라, 시청 모드에서 보던 방향을
    // 그대로 바라보려면 공전 각을 180° 돌려 준다.
    cam.yaw += Math.PI;
  }
  updateViewUI();
}

/* 보기 모드 드롭다운 */
const viewBtn = $('viewBtn'), viewDrop = $('viewDrop');
function openView(open) {
  viewDrop.hidden = !open;
  viewBtn.classList.toggle('open', open);
  viewBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
viewBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openSet(false); openShare(false);                      // 설정 메뉴와 겹치지 않게
  openView(viewDrop.hidden);
});
viewDrop.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  const v = b.dataset.view;
  if (v === 'first') setWatchMode(true);
  else if (v === 'third') { if (cam.mode === 'watch') setWatchMode(false); else if (cam.mode === 'cinema') setCinema(false); }
  else if (v === 'cinema') setCinema(true);
  openView(false);
});
document.addEventListener('click', () => openView(false));

/* 전체화면(시네마) — 유튜브 영상이 화면을 가득 채우도록 카메라가 TV 를 정면에서
 * 꽉 차게 프레이밍한다. (iframe 을 옮기면 재생이 끊기므로 기존 3D 파이프라인을 그대로 쓴다)
 * 동시에 브라우저 전체화면도 켜 실제로 화면 전체를 채운다. */
function requestFS() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
    try { req.call(el); } catch (e) { /* ignore */ }
  }
}
function exitFS() {
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
    try { exit.call(document); } catch (e) { /* ignore */ }
  }
}
function setCinema(on) {
  const want = !!on;
  if (want === (cam.mode === 'cinema')) return;
  if (want && cam.mode === 'watch') setWatchMode(false);   // 시청 모드와 겹치지 않게
  cam.mode = want ? 'cinema' : 'lounge';
  document.body.classList.toggle('cinema', want);
  if (want) { toast('전체화면 — 영상이 화면을 채웁니다. Esc 로 나가기', 3200); requestFS(); }
  else { exitFS(); }
  updateViewUI();
}
function onFsChange() {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  // 브라우저 전체화면을 Esc/F11 로 빠져나오면 시네마 모드도 함께 해제
  if (!on && cam.mode === 'cinema') setCinema(false);
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

/* 터치 기기용 — 키보드가 없는 환경에서 점프와 화살 */
$('touchJump').addEventListener('click', (e) => { e.preventDefault(); jump(); });
$('touchArrow').addEventListener('click', (e) => { e.preventDefault(); shootForward(); });

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

  // 앉은 채로 움직이려 하면 먼저 일어선다
  if (mySeat >= 0) {
    if (fx || fz || moveTarget) standUp();
    else { me.st = 2; me.vy = 0; me.grounded = true; }
  }

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
        cam.look = Math.max(-0.6, Math.min(1.5, cam.look + tilt * LOOK_RATE * dt));
      } else {
        cam.pitch = Math.max(0.35, Math.min(2.95, cam.pitch + tilt * TILT_RATE * dt));
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

  const seated = mySeat >= 0;
  const moving = !seated && !!(vx || vz);
  if (moving) {
    const l = Math.hypot(vx, vz) || 1;
    const nx = me.x + (vx / l) * SPEED * dt;
    const nz = me.z + (vz / l) * SPEED * dt;
    const p = R.collide(nx, nz, 0.26, me.y);
    if (Math.abs(p.x - me.x) < 0.0005 && Math.abs(p.z - me.z) < 0.0005) moveTarget = null;
    me.x = p.x; me.z = p.z;
    me.dir = Math.atan2(vx, vz);
    me.st = 1;
  } else if (!seated) me.st = 0;

  if (seated) {
    me.fy = me.y;                          // 앉아 있는 동안은 떨어지지 않는다
  } else {
    /* 점프 — 위아래 */
    me.vy -= GRAVITY * dt;
    me.y += me.vy * dt;
    const ground = R.groundAt(me.x, me.z);
    if (me.y <= ground) {                  // 착지
      me.y = ground;
      me.vy = 0;
      me.grounded = true;
    } else {
      me.grounded = false;
    }
    me.fy = ground;                        // 아바타가 단 위를 '공중' 으로 보지 않게
    trySit();                              // 의자 앞 구역에 겹치면 그대로 앉는다
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
  if (cam.mode === 'cinema') {
    // TV 를 정면에서 화면 가득(cover) 프레이밍한다
    const T = R.TV, tv = world.tvTransform;
    const vhalf = Math.tan((camera.fov * Math.PI / 180) / 2);
    const dV = (T.h / 2) / vhalf;
    const dH = (T.w / 2) / (vhalf * camera.aspect);
    const d = Math.min(dV, dH) * 0.995;
    pos.set(tv.x + tv.nx * d, tv.y, tv.z + tv.nz * d);
    aim.set(tv.x, tv.y, tv.z);
  } else if (cam.mode === 'watch') {
    // 구면 좌표 — 수평 거리를 cos(look) 으로 줄여야 실제로 위/아래를 끝까지 볼 수 있다
    const cl = Math.cos(cam.look);
    pos.set(me.x, 1.56 + me.y, me.z);
    aim.set(
      me.x + cl * Math.sin(cam.yaw) * 4,
      1.56 + me.y + Math.sin(cam.look) * 4,
      me.z + cl * Math.cos(cam.yaw) * 4
    );
  } else {
    // 라운지(3인칭) — 공전하며 내려다보다가, 수평을 넘기면 시선을 위로 들어 천장까지 본다
    const base = 1.05 + me.y * 0.6;
    const HORIZON = Math.PI / 2 - 0.02;
    const pOrbit = Math.min(cam.pitch, HORIZON);         // 공전 각은 수평까지만
    const sp = Math.sin(pOrbit), cp = Math.cos(pOrbit);
    pos.set(
      me.x + cam.dist * sp * Math.sin(cam.yaw),
      base + cam.dist * cp,
      me.z + cam.dist * sp * Math.cos(cam.yaw)
    );
    const upAngle = Math.min(1.4, Math.max(0, cam.pitch - HORIZON));   // 수평 너머 올려다보는 각
    aim.set(me.x, base + Math.tan(upAngle) * cam.dist, me.z);
  }
  const k = 1 - Math.pow(0.0015, dt);
  // 드래그 중에는 즉시 따라가 관성(가속도) 없이 1:1 로 돌게 한다
  const follow = drag.on ? 1 : (cam.mode === 'lounge' ? k : Math.min(1, k * 1.6));
  camPos.lerp(pos, follow);
  camAim.lerp(aim, follow);
  camera.position.copy(camPos);
  camera.lookAt(camAim);

  // 시선(카메라 회전)에 따라 고개를 돌린다 — 몸 기준 상대 각도로 계산
  {
    let lookYaw, lookPitch;
    if (cam.mode === 'watch') { lookYaw = cam.yaw; lookPitch = cam.look; }
    else if (cam.mode === 'cinema') {
      // 시네마 중엔 내 아바타가 TV 를 바라보게 (다른 사람 화면에서 보임)
      lookYaw = Math.atan2(world.tvTransform.x - me.x, world.tvTransform.z - me.z);
      lookPitch = 0;
    } else { lookYaw = cam.yaw + Math.PI; lookPitch = cam.pitch - Math.PI / 2; }
    let ry = lookYaw - me.dir;
    while (ry > Math.PI) ry -= Math.PI * 2;
    while (ry < -Math.PI) ry += Math.PI * 2;
    me.hy = Math.max(-1.3, Math.min(1.3, ry));
    me.hp = Math.max(-0.55, Math.min(0.55, -lookPitch));
  }

  if (myAvatar) myAvatar.update(me, dt, now / 1000, cam.mode !== 'lounge');
  for (const g of others.values()) {
    g.fy = R.groundAt(g.x, g.z);
    g.av.update(g, dt, now / 1000, false);
  }

  if (now - sendAt > 90) {
    sendAt = now;
    send({
      t: 'm', x: toNet(me.x), y: toNet(me.z),
      dir: Math.round(me.dir * 100) / 100, st: me.st, h: toNet(me.y),
      hy: Math.round(me.hy * 100) / 100, hp: Math.round(me.hp * 100) / 100
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
    if (screen === 'room') stepNeon(dt);      // 네온 간판의 긴 제목 흘리기

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
  $('inviteNote').textContent = '초대받은 방 ' + code + ' — 입장을 누르면 바로 들어갑니다.';
  $('inviteNote').hidden = false;
})();

/* 새로고침 직후라면 — 로비가 잠깐 비치는 대신 돌아가는 중임을 알린다 */
(function restoring() {
  const seat = loadSeat();
  if (!seat || !$('inviteNote').hidden) return;
  $('inviteNote').textContent = '있던 방 ' + seat.code + ' 으로 돌아가는 중…';
  $('inviteNote').hidden = false;
})();

cssHost.style.display = 'none';
connect();
