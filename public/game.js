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
import { makeAvatar, colorOf, WARDROBE, sanitizeLook, lookOf } from './avatar3d.js';
import * as TV from './youtube.js';
import * as Voice from './voice.js';
import * as Pitch from './pitch.js';
import * as Npc from './npc.js';

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
/* ACES 를 쓴다. 한때 '셀 셰이딩의 단을 뭉갠다' 고 보고 Linear 로 바꿨는데,
 * 실제로 일어난 일은 방이 통째로 밝아진 것이었다. ACES 는 어두운 쪽을
 * 0.2 배 가까이 눌러 주는데, 그걸 걷으니 어둑하던 극장이 대낮이 됐다.
 * 단은 ACES 아래에서도 또렷하다 — 눌러도 칸 사이 간격은 남는다. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = R.LIGHT.exposure;
webglHost.appendChild(renderer.domElement);

const cssRenderer = new CSS3DRenderer();
cssHost.appendChild(cssRenderer.domElement);

/* 화각(시야각). 좁힐수록 멀리 당겨 보인다 — 1인칭에는 '거리' 가 없으니
 * 확대·축소를 이걸로 한다. 3인칭은 거리(cam.dist)를 쓴다. */
const FOV_BASE = 52, FOV_MIN = 21, FOV_MAX = 70;
const camera = new THREE.PerspectiveCamera(FOV_BASE, 1, 0.1, 120);
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

/* ---- 내가 꾸민 모습 --------------------------------------------------
 *  번호 일곱 개짜리 배열. 이 브라우저에 저장하고, 방에 들어갈 때 같이
 *  보내 남들 화면에서도 같은 모습으로 선다. */
const LOOK_KEY = 'weech.look';
let myLook = null;
try { myLook = sanitizeLook(JSON.parse(localStorage.getItem(LOOK_KEY) || 'null')); } catch (e) { /* 무시 */ }

function saveLook() {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(myLook)); } catch (e) { /* 사생활 모드 등 */ }
}
let room = null, isHost = false;
let mode = 'cinema';                               // Play 모드 — 'cinema' | 'karaoke'
let karaoke = false;                               // mode === 'karaoke' 를 줄여 쓴 것
let micOn = false;                                 // 내 마이크를 켰나
let pgame = false;                                 // 음정 게임모드 (노래방 안에서만)
let melodyNotes = null;                            // 이 곡의 기준선 (없으면 null)
let melodyFor = '';                                // 그 기준선이 어느 영상 것인지
let melodyState = '';                              // '' | pending | ready | none | off
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
  dist: 12.5,
  fov: FOV_BASE        // 1인칭에서 휠로 당긴 화각
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
      esc(r.now || (r.count ? '영상 ' + r.count + '개' : '재생목록 비어 있음')) + ' · 방장 ' + esc(r.host) + '</div></div>' +
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
  if (!String(text || '').trim()) return '비워 두면 빈 방으로 시작합니다';
  if (!c.v && !c.p) return '알아보지 못한 링크입니다';
  const parts = [];
  if (c.p) parts.push('재생목록 ' + c.p + '개');
  if (c.v) parts.push('영상 ' + c.v + '개');
  return '인식됨 — ' + parts.join(' + ');
}

$('newLinks').addEventListener('input', () => { $('linkCount').textContent = linkLabel($('newLinks').value); });
$('linkCount').textContent = linkLabel('');

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
  // 링크는 없어도 된다 — 빈 방으로 열고 들어가서 채우면 된다.
  // 다만 뭔가 적었는데 알아보지 못했다면 그건 짚어 준다.
  if (links && !countIds(links)) { lobbyErr('유튜브 링크를 알아보지 못했습니다. 비워 두면 빈 방으로 시작합니다.'); return; }
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
    // 소파는 돌아가 있다 — 그 자리가 바라보는 쪽으로 물러나야 한다
    const fx = -Math.sin(st.rot || 0), fz = -Math.cos(st.rot || 0);
    const p = R.collide(st.zx + fx * 0.3, st.zz + fz * 0.3, 0.26, st.y);
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
      ws.send(JSON.stringify({ t: 'join', code: lastJoin.code, name: lastJoin.name, token: lastJoin.token, look: myLook }));
      return;
    }
    const seat = loadSeat();
    if (screen === 'lobby' && seat) {
      // 새로고침 직후 — 로비를 거치지 않고 있던 방으로 돌아간다
      rejoining = true;
      me.name = seat.name;
      lastJoin = seat;
      ws.send(JSON.stringify({ t: 'join', code: seat.code, name: seat.name, token: seat.token, look: myLook }));
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
        Voice.setMyId(myId);
        setMode((room && room.mode) || 'cinema');  // 이미 노래방인 방일 수도 있다
        setPgame(!!(room && room.pgame));
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
          // a[7] a[8] 은 옛 고개 각도 자리 — 이제 늘 0 이다. 뒤의 번호가
          // 밀리지 않게 자리만 남겨 둔다.
          if (a[5] && a[5] !== g.name) { g.name = a[5]; g.av.setName(a[5]); }
          const gone = !!a[9];
          if (g.gone !== gone) { g.gone = gone; g.av.setGone(gone); }
        });
        for (const id of Array.from(others.keys())) if (!seen.has(id)) removeOther(id);
        peopleCache = (m.u || []).map((a) => ({
          id: a[0], name: a[5], gone: !!a[9], mic: !!a[10]
        }));
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

      case 'look': {
        if (m.id === myId) break;            // 내 것은 이미 입었다
        const g = others.get(m.id);
        if (g) redress(g, m.v);
        break;
      }

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

      case 'mode':
        setMode(m.v, m.by);
        break;

      case 'pgame':
        setPgame(m.on);
        logMsg(m.on ? '🎯 <b>음정 게임모드</b>가 켜졌습니다 — MR 에서 기준선을 뽑습니다.'
          : '음정 게임모드가 꺼졌습니다.', 'sys');
        break;

      case 'melody': {
        const it = currentItem();
        if (!it || m.v !== it.id) break;          // 지난 곡에 대한 답은 버린다
        if (m.state === 'pending') { melodyState = 'pending'; melodyNotes = null; break; }
        if (m.state === 'off') {
          melodyState = 'off'; melodyNotes = null;
          world.setLoadVisible(false);
          toast('이 서버에서는 음정 분석을 쓸 수 없습니다 — ' + (m.msg || ''), 6000);
          break;
        }
        melodyNotes = (m.notes && m.notes.length) ? m.notes : null;
        melodyState = melodyNotes ? 'ready' : 'none';
        fitPitchRange();
        world.setLoadVisible(false);
        logMsg(melodyNotes
          ? '기준선 준비 완료 — <b>' + melodyNotes.length + '음</b>. 파란 선을 따라 불러 보세요.'
          : '이 곡에서는 주선율을 찾지 못했습니다 — 내 음정만 보여 줍니다.', 'sys');
        break;
      }

      case 'mic': {
        // 명단 갱신(주기적)을 기다리지 않고 바로 고친다 — 안 그러면 아이콘과 ⋯ 메뉴가 옛 상태로 남는다
        const pm = peopleCache.find((x) => x.id === m.id);
        if (pm) pm.mic = !!m.on;
        if (m.id === myId) { micOn = !!m.on; updateMicBtn(); }
        peopleSig = '';
        renderPeople();
        break;
      }

      // 연결용 쪽지 — 내용은 voice.js 가 푼다
      case 'rtc':
        Voice.signal(m.from, m.data);
        break;

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

      case 'play': {
        if (!room) break;
        const was = room.idx;
        room.idx = m.idx; room.playing = m.playing;
        room.position = m.position; room.serverNow = m.serverNow;
        syncClock(m.serverNow);
        applyPlayback();
        if (was !== room.idx) { pitchReset(); requestMelody(); }
        break;
      }

      case 'room':
        if (!room) break;
        room.title = m.title; room.playlist = m.playlist;
        $('roomTitle').textContent = room.title;
        updatePlTip();
        updateNowPlaying();
        drawBoard();
        renderPlTracks();
        break;
    }
  };
}

function scheduleRetry() { clearTimeout(retry); retry = setTimeout(connect, 2500); }

/* ---- 노래방 모드 ---------------------------------------------------
 *  방장이 켜면 천장에서 미러볼이 내려오고, 서로 목소리를 주고받을 수 있다.
 *  목소리는 브라우저끼리 직접(P2P) 오가고 서버는 연결용 쪽지만 중계한다.
 * ------------------------------------------------------------------ */
Voice.init({
  signal: (to, data) => send({ t: 'rtc', to: to, data: data }),
  notice: (msg) => toast(msg, 4600)
});

const meInList = () => peopleCache.find((p) => p.id === myId) || null;
function syncVoicePeers() {
  if (karaoke) Voice.setPeers(Array.from(others.keys()));
}

/* 내 마이크 상태가 바뀌었다 — 참여자 목록의 내 마이크 아이콘과 마이크 창을 다시 그린다 */
function updateMicBtn() {
  peopleSig = '';
  renderPeople();
  if (micMenuOpen()) renderMicList();
}

/* Play 모드 — 영화관(영사기) · 노래방(미러볼) 둘 중 하나.
 * 영화관이 기본이고, 노래방에서만 목소리·음정 기능이 열린다. */
function setMode(v, byName) {
  v = (v === 'karaoke') ? 'karaoke' : 'cinema';
  const was = mode;
  mode = v;
  const on = (v === 'karaoke');
  karaoke = on;
  if (room) room.mode = v;
  world.setMode(v);                           // 영사기와 미러볼이 자리를 주고받는다
  /* 바닥에 놓인 것이 통째로 바뀌었다 (단·의자 ↔ 소파·테이블).
   * 사라진 자리에 앉아 있었다면 일어서고, 없어진 단 위에 서 있었다면
   * 새 바닥으로 발을 내린다. 안 하면 허공에 뜬 채로 남는다. */
  if (mySeat >= 0 && !R.seatUsable(mySeat)) { mySeat = -1; me.st = 0; sitArmed = false; }
  {
    const p = R.collide(me.x, me.z, 0.26, me.y);
    me.x = p.x; me.z = p.z;
    const g = R.groundAt(me.x, me.z);
    if (me.y < g) { me.y = g; me.vy = 0; me.grounded = true; }
  }
  document.body.classList.toggle('karaoke', on);
  $('miCinema').classList.toggle('on', !on);
  $('miKaraoke').classList.toggle('on', on);
  world.setPitchVisible(on);                    // 스크린 아래 음정 띠
  if (!on) { Pitch.stop(true); setPgame(false); }
  // 노래방이 켜져야 '음정 게임모드' 항목이 나타난다 — 메뉴를 열어 둔 채
  // 켜는 경우가 많으므로 여기서 바로 다시 그린다
  applyHostUI();
  pitchReset();
  try {
    if (on) {
      Voice.setMyId(myId);
      Voice.setEnabled(true, Array.from(others.keys()));
    } else {
      Voice.setEnabled(false);
      micOn = false;
    }
  } catch (e) {
    // 목소리가 안 열려도 미러볼과 UI 는 그대로 — 여기서 멈추면 안 된다
    toast('목소리를 준비하지 못했습니다 — ' + ((e && e.message) || e), 5000);
  }
  updateMicBtn();
  peopleSig = '';
  renderPeople();
  if (was === v || screen !== 'room') return;
  showModePill(v);
  if (on) {
    logMsg('🪩 <b>노래방 모드</b>' + (byName ? ' — ' + esc(byName) : '') +
      '. 미러볼이 내려옵니다. 왼쪽 <b>참여자</b> 목록에서 내 마이크를 눌러 켜세요.', 'sys');
    if (!Voice.micAvailable()) logMsg(esc(Voice.micUnavailableReason()), 'sys');
  } else {
    logMsg('🎬 <b>영화관 모드</b>' + (byName ? ' — ' + esc(byName) : '') + '. 영사기가 내려옵니다.', 'sys');
  }
}

/* 모드를 바꾸면 위 가운데에 '🎬 영화관 모드' / '🪩 노래방 모드' 를 5초 동안 띄운다 */
const MODE_PILL_MS = 5000;
const MODE_PILL_FADE_MS = 700;                  // CSS mpFade 와 같은 길이
let modePillTimer = 0;
/* 확대하는 방법을 기기에 맞춰 한 마디로. 마우스가 없는 기기에서
 * '휠' 이라고 하면 쓸 수 있는 줄을 모른다. */
function zoomHow() {
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  return coarse ? '두 손가락으로 확대·축소' : '휠로 확대·축소';
}

/* 지금 몇 배로 당겨 보고 있나. 화면 오른쪽에 잠깐 떴다 사라진다.
 * 배율은 기본 화각 대비 — tan 비로 재야 눈에 보이는 크기와 맞는다. */
let zoomTimer = null;
function zoomFactor() {
  return Math.tan(FOV_BASE * Math.PI / 360) / Math.tan(cam.fov * Math.PI / 360);
}
function showZoom() {
  const el = $('zoomPill');
  if (!el) return;
  const z = zoomFactor();
  el.textContent = '×' + (z < 9.95 ? z.toFixed(1) : Math.round(z));
  el.classList.toggle('wide', z < 0.995);        // 기본보다 넓게 펼친 상태
  el.classList.remove('out');
  el.hidden = false;
  void el.offsetWidth;
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { if (el.classList.contains('out')) el.hidden = true; }, 700);
  }, 1100);
}
function hideZoom() {
  const el = $('zoomPill');
  if (!el) return;
  clearTimeout(zoomTimer);
  el.hidden = true;
  el.classList.remove('out');
}

function showModePill(v) {
  const on = v === 'karaoke';
  const el = $('modePill');
  $('mpIc').textContent = on ? '🪩' : '🎬';
  $('mpT').textContent = on ? '노래방 모드' : '영화관 모드';
  el.classList.toggle('karaoke', on);
  el.classList.remove('out');
  el.hidden = false;
  document.body.classList.add('modeshow');
  void el.offsetWidth;                            // 다시 띄울 때 애니메이션을 처음부터
  clearTimeout(modePillTimer);
  modePillTimer = setTimeout(() => {
    el.classList.add('out');                      // 스르르 사라진 뒤 숨긴다
    modePillTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('out');
      document.body.classList.remove('modeshow');
    }, MODE_PILL_FADE_MS);
  }, MODE_PILL_MS);
}

/* 내 마이크 켜기/끄기 — 참여자 목록의 내 마이크를 누르면 뜨는 창의 '음소거' 버튼이 부른다.
 * 어떤 길로 실패하든 왜 그런지 말해 준다. 처음 켤 때는 브라우저 권한 창이 떠
 * 몇 초 걸릴 수 있어 그동안 '여는 중' 을 보여 준다. */
let micBusy = false;

function toggleMic() {
  if (micBusy) return;                                    // 권한 창을 기다리는 중
  if (!karaoke) { toast('노래방 모드에서만 마이크를 쓸 수 있습니다.', 3000); return; }
  const want = !micOn;
  if (want && !Voice.micAvailable()) { toast(Voice.micUnavailableReason(), 8000); return; }

  const mb = $('mmMute');
  if (want) { micBusy = true; mb.textContent = '여는 중…'; mb.disabled = true; }
  const done = () => { micBusy = false; mb.disabled = false; };
  Voice.setMic(want).then((ok) => {
    done();
    if (want && !ok) { updateMicBtn(); return; }          // 이유는 voice.js 가 이미 띄웠다
    micOn = want;
    // 음정 분석기도 같은 스트림을 문다 (출력에는 잇지 않아 내 목소리가 되돌아오지 않는다)
    if (micOn) { pitchReset(); Pitch.start(Voice.micMedia()); } else { Pitch.stop(true); pitchReset(); }
    updateMicBtn();
    send({ t: 'mic', on: micOn });
    toast(want ? '🎙 마이크 켜짐 · ' + Voice.activeMicName() : '마이크를 껐습니다', 2400);
  }).catch((e) => {
    done();
    updateMicBtn();
    toast('마이크 오류 — ' + ((e && e.message) || e), 6000);
  });
}

/* ---- 내 마이크 창 --------------------------------------------------
 *  참여자 목록의 내 마이크를 누르면 음소거 버튼과 마이크 목록이 뜬다. 같은 PC 에 마이크가 여럿이면(헤드셋 · 본체 단자 ·
 *  가상 장치) 엉뚱한 것이 잡혀 무음만 보낼 수 있어, 입력 크기 막대로 바로 확인하게 한다.
 * ------------------------------------------------------------------ */
let micMenuRaf = 0;

function micMenuOpen() { return !$('micMenu').hidden; }

function renderMicList() {
  Voice.listMics().then((list) => {
    const cur = Voice.currentMic();
    const box = $('micList');
    const named = list.filter((d) => d.label);
    if (!named.length) {
      box.innerHTML = '<div class="mm-hint">마이크를 한 번 켜면 이름이 보입니다.</div>';
      return;
    }
    // 별칭('default')으로 열렸으면 같은 묶음(groupId)의 실제 장치에 표시한다
    const isCur = (d) => d.id === cur.id ||
      (cur.group && (!cur.id || cur.id === 'default') && d.group === cur.group);
    box.innerHTML = named.map((d) =>
      '<button class="mm-item' + (isCur(d) ? ' on' : '') + '" data-dev="' + esc(d.id) + '">' +
      '<span class="mm-chk">' + (isCur(d) ? '✓' : '') + '</span>' +
      '<span class="mm-name" title="' + esc(d.label) + '">' + esc(Voice.shortMicName(d.label)) +
      '</span></button>').join('');
  });
  $('micHint').textContent = micOn
    ? '말해 보세요 — 막대가 움직이지 않으면 다른 마이크를 고르세요.'
    : '음소거를 풀면 입력 크기가 보입니다.';
  const mb = $('mmMute');
  mb.textContent = micOn ? '음소거' : '음소거 풀기';
  mb.classList.toggle('on', !micOn);
  $('mmLow').checked = Voice.lowLatency();
  $('mmState').textContent = micOn ? '마이크 켜짐' : '음소거 중';
  $('micMenu').classList.toggle('muted', !micOn);
}

function tickMicMeter() {
  if (!micMenuOpen()) { micMenuRaf = 0; return; }
  $('micMeterFill').style.width = Math.round(Voice.micLevel() * 100) + '%';
  micMenuRaf = requestAnimationFrame(tickMicMeter);
}

/* ---- 얼마나 늦나 ----------------------------------------------------
 *  브라우저가 센 값만 보여 준다. 마이크·스피커 장치가 먹는 시간은 여기
 *  안 잡히므로 '적어도 이만큼' 이다. 초마다 한 번이면 충분하다. */
let latTimer = 0;

function tickLatency() {
  const el = $('mmLat');
  if (!el || !micMenuOpen()) { clearInterval(latTimer); latTimer = 0; return; }
  Voice.latency().then((rows) => {
    if (!micMenuOpen()) return;
    if (!rows.length) {
      el.hidden = true;
      return;
    }
    // 여럿이면 가장 늦는 사람이 기준이다 — 제일 답답한 쪽이 체감이다
    let worst = 0, net = 0;
    for (const r of rows) {
      const t = r.buf + (r.net > 0 ? r.net : 0);
      if (t > worst) { worst = t; net = r.net; }
    }
    el.hidden = false;
    el.classList.toggle('warn', worst > 150);
    el.innerHTML = '지연 <b>' + Math.round(worst) + 'ms</b> ' +
      '<span>(버퍼 ' + Math.round(worst - (net > 0 ? net : 0)) + ' · 망 ' +
      (net > 0 ? Math.round(net) : '?') + ')</span>';
  }, () => { /* 통계를 못 읽는 브라우저 */ });
}

$('mmLow').addEventListener('change', (e) => {
  const on = e.target.checked;
  Voice.setLowLatency(on).then((s) => {
    if (s) { pitchReset(); Pitch.start(s); }       // 새 스트림이라 음정 분석기도 다시 물린다
    renderMicList();
  });
  toast(on
    ? '낮은 지연 — 에코·잡음 제거를 끕니다. 스피커로 들으면 소리가 되울릴 수 있습니다.'
    : '에코·잡음 제거를 켭니다. 스피커로 들을 때 알맞지만 조금 늦습니다.', 4200);
});

/* 참여자 목록의 내 마이크 아래에 띄운다. 목록이 스크롤 상자라 메뉴는 바깥(fixed)에 있다 */
function setMicMenu(open, anchor) {
  const menu = $('micMenu');
  menu.hidden = !open;
  const mine = $('peopleList').querySelector('button.mysel');
  if (mine) mine.classList.toggle('open', open);
  if (!open) { clearInterval(latTimer); latTimer = 0; return; }
  renderMicList();
  if (!micMenuRaf) micMenuRaf = requestAnimationFrame(tickMicMeter);
  if (!latTimer) { tickLatency(); latTimer = setInterval(tickLatency, 1000); }
  const a = anchor || mine;
  if (!a) return;
  const r = a.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left, top = r.bottom + 6;
  if (left + mw > innerWidth - 8) left = innerWidth - 8 - mw;
  if (left < 8) left = 8;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - 6 - mh);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}
$('mmMute').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMic();                                     // 노래방 막대의 마이크 버튼과 같은 일 — 끝나면 창도 다시 그린다
});
$('micMenu').addEventListener('click', (e) => {
  e.stopPropagation();
  const it = e.target.closest('.mm-item');
  if (!it) return;
  Voice.setMicDevice(it.dataset.dev).then((s) => {
    if (s) { pitchReset(); Pitch.start(s); }        // 음정 분석기도 새 마이크로
    renderMicList();
    toast('🎙 ' + (Voice.activeMicName() || Voice.shortMicName(it.querySelector('.mm-name').textContent)) + ' 으로 바꿨습니다', 2400);
  }).catch(() => { toast('그 마이크를 열지 못했습니다.', 3600); renderMicList(); });
});
document.addEventListener('click', (e) => {
  if (micMenuOpen() && !e.target.closest('#micMenu, button.mysel')) setMicMenu(false);
});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => { if (micMenuOpen()) renderMicList(); });
}

/* 음정 게임모드 — 노래방 안에서만, 방장만 */
function setPgame(on) {
  pgame = !!on;
  if (room) room.pgame = pgame;
  $('miPgame').classList.toggle('on', pgame);
  if (!pgame) {
    melodyNotes = null; melodyState = ''; melodyFor = '';
    world.setLoadVisible(false);
    fitPitchRange();
  } else {
    requestMelody();
  }
  applyHostUI();
}

/* 지금 곡의 기준선을 서버에 달라고 한다. 이미 받아 둔 곡이면 아무것도 안 한다. */
function requestMelody() {
  if (!karaoke || !pgame || screen !== 'room') return;
  const it = currentItem();
  if (!it) return;
  if (melodyFor === it.id && (melodyState === 'ready' || melodyState === 'pending')) return;
  melodyFor = it.id;
  melodyNotes = null;
  melodyState = 'pending';
  fitPitchRange();
  send({ t: 'melody', v: it.id });
}

/* 켜고 끄는 항목은 메뉴를 닫지 않는다 — 노래방을 켠 바로 그 자리에서
 * 음정 게임모드가 나타나므로, 닫히면 다시 열어야 한다. */
$('miPgame').addEventListener('click', () => {
  if (!isHost) { toast('방장만 음정 게임모드를 켤 수 있습니다.', 2800); return; }
  if (!karaoke) { toast('노래방 모드에서만 쓸 수 있습니다.', 3000); return; }
  send({ t: 'pgame', on: !pgame });
});

function pickMode(v) {
  if (!isHost) { toast('방장만 Play 모드를 바꿀 수 있습니다.', 2800); return; }
  if (mode === v) return;
  send({ t: 'mode', v: v });
}
$('miCinema').addEventListener('click', () => pickMode('cinema'));
$('miKaraoke').addEventListener('click', () => pickMode('karaoke'));

function send(obj) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return; }
  if (ws && ws.readyState === 0) { if (outbox.length < 20) outbox.push(obj); return; }
  toast('서버에 연결되어 있지 않습니다. 다시 잇는 중…', 2400);
}

/* ------------------------------------------------------------------ */
/* 아바타 관리                                                           */
/* ------------------------------------------------------------------ */
function addOther(u) {
  if (karaoke) setTimeout(syncVoicePeers, 0);
  const av = makeAvatar({ name: u.name, seed: u.id, isMe: false, look: u.look });
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

/* 모습이 바뀌면 통째로 다시 짓는다. 재질·머리 모양이 다 달라지므로
 * 부분만 갈아 끼우는 것보다 명료하다 — 자리·이름·상태는 그대로 넘긴다. */
function redress(g, look) {
  const old = g.av;
  old.hitMeshes.forEach((m) => hitToPlayer.delete(m.uuid));
  scene.remove(old.root);
  old.dispose();
  g.look = look;
  g.av = makeAvatar({ name: g.name, seed: g.id, isMe: false, look: look });
  scene.add(g.av.root);
  g.av.hitMeshes.forEach((m) => hitToPlayer.set(m.uuid, g.id));
  if (g.gone) g.av.setGone(true);
}

function redressMe() {
  if (!myAvatar) return;
  scene.remove(myAvatar.root);
  myAvatar.dispose();
  myAvatar = makeAvatar({ name: me.name, seed: myId, isMe: true, look: myLook });
  scene.add(myAvatar.root);
}

function removeOther(id) {
  if (karaoke) setTimeout(syncVoicePeers, 0);
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

  myAvatar = makeAvatar({ name: me.name, seed: myId, isMe: true, look: myLook });
  scene.add(myAvatar.root);

  cam.yaw = 0; cam.pitch = 0.88; cam.dist = 12.5; cam.fov = FOV_BASE; cam.mode = 'lounge';
  camPos.set(me.x, 10, me.z + 10);

  plTipOff = false;                  // 새 방에서는 다시 알려 준다
  $('peopleToggle').classList.toggle('open', peopleOpen);
  $('peopleList').hidden = !peopleOpen;
  headSig = ''; headCount = -1; peopleSig = '';
  applyHostUI();
  applyPlayback();
  drawBoard();
  logMsg('<b>' + esc(me.name) + '</b> 님으로 들어왔습니다. 이름은 왼쪽 <b>참여자</b> 목록에서 바꿀 수 있습니다.', 'sys');
  logMsg('<b>Space</b> 점프 · <b>V</b> 시청 모드 · <b>?</b> 전체 조작.', 'sys');
  if (room && (!room.playlist || !room.playlist.length)) {
    logMsg(canCtl()
      ? '재생목록이 비어 있습니다 — 아래 <b>☰</b> 로 유튜브 링크를 넣어 주세요.'
      : '재생목록이 비어 있습니다 — 방장이 채우기를 기다리는 중입니다.', 'sys');
  }
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
  setMode('cinema');                 // 목소리 연결을 모두 끊는다
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
/* ---- 아바타 꾸미기 (탈의실) -------------------------------------------
 *  버튼 왼쪽으로 창이 열린다. 왼쪽 칸에는 '입어 보는 중' 인 내 모습이
 *  천천히 돌고, 오른쪽 칸에는 선택지가 실물 사진(그 모습을 입힌 아바타를
 *  작게 찍은 것)으로 늘어선다. 누르면 왼쪽 모습에만 임시로 입혀지고,
 *  [입기] 를 눌러야 방 전원에게 퍼진다 — 취소하면 없던 일이 된다.
 *
 *  선택지는 옷장(WARDROBE)에서 읽어 와 그리므로 옷장을 늘리면 창이
 *  저절로 따라온다.
 * ------------------------------------------------------------------ */
const lookBtn = $('lookBtn'), lookDrop = $('lookDrop');

let draft = null;                    // 입어 보는 중인 모습 (입기 전까지 나만 본다)
let prR = null, thR = null;          // 무대 · 사진기 렌더러 (열 때 한 번 만든다)
let prScene = null, prCam = null, prAv = null, prRaf = 0;

function prInit() {
  if (prR) return;
  prR = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  prR.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  prR.outputColorSpace = THREE.SRGBColorSpace;
  $('lookStage').appendChild(prR.domElement);
  prScene = new THREE.Scene();
  /* 방 조명과 무관하게 밝게 — 탈의실 거울은 환해야 한다 */
  prScene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dl = new THREE.DirectionalLight(0xfff2e0, 0.65);
  dl.position.set(-1.5, 2.5, 2);
  prScene.add(dl);
  prCam = new THREE.PerspectiveCamera(32, 0.8, 0.1, 10);

  thR = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  thR.setSize(76, 76);
  thR.outputColorSpace = THREE.SRGBColorSpace;
}

/* 무대 위 모습을 draft 로 갈아입힌다 */
function prDress() {
  if (prAv) { prScene.remove(prAv.root); prAv.dispose(); prAv = null; }
  prAv = makeAvatar({ seed: myId || 1, name: '', look: draft });
  prAv.root.traverse((o) => { if (o.isSprite) o.visible = false; });   // 이름표는 거울에 안 비친다
  prScene.add(prAv.root);
}

/* 그 선택지를 입힌 모습을 작게 찍는다 — 눈은 얼굴을, 옷은 몸통을 당겨 찍는다 */
const TH_SHOT = {
  face: { y: 1.34, z: 0.9, ty: 1.3, fov: 26 },
  head: { y: 1.3, z: 1.5, ty: 1.15, fov: 32 },
  torso: { y: 0.95, z: 1.25, ty: 0.88, fov: 30 },
  lower: { y: 0.5, z: 1.45, ty: 0.4, fov: 32 }
};

function thumb(look, focus) {
  const sc = new THREE.Scene();
  sc.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dl = new THREE.DirectionalLight(0xfff2e0, 0.5);
  dl.position.set(-1, 2, 2);
  sc.add(dl);
  const av = makeAvatar({ seed: myId || 1, name: '', look: look });
  av.root.traverse((o) => { if (o.isSprite) o.visible = false; });
  av.root.rotation.y = 0.25;
  sc.add(av.root);
  const f = TH_SHOT[focus];
  const cam = new THREE.PerspectiveCamera(f.fov, 1, 0.1, 10);
  cam.position.set(0.1, f.y, f.z);
  cam.lookAt(0, f.ty, 0);
  thR.render(sc, cam);
  const url = thR.domElement.toDataURL();
  av.dispose();
  return url;
}

/*  slot — look 배열에서 몇 번째 칸을 바꾸는가 */
const LOOK_ROWS = [
  { slot: 0, label: '눈 모양', kind: 'thumb', focus: 'face', n: WARDROBE.eyes },
  { slot: 1, label: '헤어스타일', kind: 'thumb', focus: 'head', n: WARDROBE.hairs.length },
  { slot: 6, label: '머리 색', kind: 'color', colors: WARDROBE.hairColors },
  { slot: 2, label: '피부색', kind: 'color', colors: WARDROBE.skins },
  { slot: 7, label: '상의', kind: 'thumb', focus: 'torso', n: WARDROBE.topStyles.length },
  { slot: 3, label: '상의 색', kind: 'color', colors: WARDROBE.tops },
  { slot: 8, label: '하의', kind: 'thumb', focus: 'lower', n: WARDROBE.bottomStyles.length },
  { slot: 4, label: '하의 색', kind: 'color', colors: WARDROBE.bottoms },
  { slot: 5, label: '신발', kind: 'color', colors: WARDROBE.shoes }
];

function renderLookRows() {
  const hx = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
  $('lookRows').innerHTML = LOOK_ROWS.map(function (row) {
    const cur = draft[row.slot] || 0;
    let opts = '';
    if (row.kind === 'color') {
      opts = row.colors.map(function (c, k) {
        return '<button class="lk-sw' + (k === cur ? ' on' : '') + '" data-s="' + row.slot +
          '" data-k="' + k + '" style="background:' + hx(c) + '"></button>';
      }).join('');
    } else {
      for (let k = 0; k < row.n; k++) {
        const v = draft.slice();
        v[row.slot] = k;
        opts += '<button class="lk-th' + (k === cur ? ' on' : '') + '" data-s="' + row.slot +
          '" data-k="' + k + '"><img src="' + thumb(v, row.focus) + '" alt=""></button>';
      }
    }
    return '<div class="lk-row"><div class="lk-label">' + row.label + '</div>' +
      '<div class="lk-opts">' + opts + '</div></div>';
  }).join('');
}

function prLoop(ts) {
  if (lookDrop.hidden) { prRaf = 0; return; }
  const t = ts / 1000;
  if (prAv) {
    //  좌우로 천천히 몸을 틀어 가며 보여 준다
    prAv.update({ x: 0, y: 0, z: 0, dir: Math.sin(t * 0.6) * 0.55 + 0.1, st: 0, fy: 0 }, 0.016, t, false);
  }
  prR.render(prScene, prCam);
  prRaf = requestAnimationFrame(prLoop);
}

function openLook(open) {
  lookDrop.hidden = !open;
  lookBtn.classList.toggle('open', open);
  lookBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) {
    if (prAv) { prScene.remove(prAv.root); prAv.dispose(); prAv = null; }
    return;
  }
  openSet(false); openShare(false);
  prInit();
  //  지금 실제 모습에서 시작한다 — 안 꾸몄으면 이름이 정해 준 그 모습
  draft = sanitizeLook(myLook) || lookOf(myId || 1);
  const box = $('lookStage').getBoundingClientRect();
  prR.setSize(Math.max(140, box.width), Math.max(180, box.height));
  prCam.aspect = Math.max(140, box.width) / Math.max(180, box.height);
  prCam.position.set(0, 1.0, 3.2);
  prCam.lookAt(0, 0.9, 0);
  prCam.updateProjectionMatrix();
  prDress();
  renderLookRows();
  if (!prRaf) prRaf = requestAnimationFrame(prLoop);
}

lookBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  openLook(lookDrop.hidden);
});
lookDrop.addEventListener('click', function (e) { e.stopPropagation(); });
document.addEventListener('click', function () { if (!lookDrop.hidden) openLook(false); });

$('lookRows').addEventListener('click', function (e) {
  const b = e.target.closest('button[data-s]');
  if (!b) return;
  draft[+b.dataset.s] = +b.dataset.k;
  draft = sanitizeLook(draft);
  prDress();                 // 무대 위에만 입혀 본다 — 방에는 아직 안 퍼진다
  renderLookRows();          // 사진들도 새 조합 기준으로 다시 찍는다
});

$('lookSave').addEventListener('click', function () {
  myLook = draft.slice();
  saveLook();
  redressMe();
  send({ t: 'look', v: myLook });
  openLook(false);
  toast('새 모습으로 갈아입었습니다', 2200);
});
$('lookCancel').addEventListener('click', function () { openLook(false); });

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

/* 헤드셋 — 소리 차단 버튼의 그림. 막아 두면 CSS 가 빗금을 긋는다 */
/* 연필 — 방 제목 수정 버튼과 같은 그림·방향을 쓴다 */
const PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>' +
  '</svg>';

/* 참여자 줄의 마이크 아이콘 — 켬 / 끔 / 방장이 음소거(빗금) */
const MIC_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 2.5a3 3 0 0 1 3 3v5.5a3 3 0 0 1-6 0V5.5a3 3 0 0 1 3-3Z"/>' +
  '<path d="M5.5 10.5v.5a6.5 6.5 0 0 0 13 0v-.5"/><path d="M12 17.5V21"/>' +
  '</svg>';
const MIC_MUTED_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M15 9.3V5.5a3 3 0 0 0-5.8-1"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1"/>' +
  '<path d="M18.5 10.5v.5a6.4 6.4 0 0 1-.9 3.3"/><path d="M5.5 10.5v.5a6.5 6.5 0 0 0 10.6 5"/>' +
  '<path d="M12 17.5V21"/><path d="m3 3 18 18"/>' +
  '</svg>';

const HEADSET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/>' +
  '<rect x="2.2" y="14.2" width="4.4" height="6.4" rx="1.7"/>' +
  '<rect x="17.4" y="14.2" width="4.4" height="6.4" rx="1.7"/>' +
  '</svg>';

/* 말하는 사람의 헤드셋을 칠한다.
 *  명단 전체를 다시 그리지 않고 클래스만 바꾼다 — 10Hz 로 다시 그리면
 *  마우스 밑 버튼이 깜빡이고 입력칸도 날아간다. */
let talkTick = 0;

function paintTalking(dt) {
  if (!karaoke || !peopleOpen) return;
  talkTick += dt;
  if (talkTick < 0.1) return;
  talkTick = 0;
  Voice.tickMeters();
  const box = $('peopleList');
  if (!box) return;
  const btns = box.querySelectorAll('button.pblk');
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    const id = +b.dataset.blk;
    // 막아 둔 사람은 칠하지 않는다 — 빨간 빗금이 먼저다
    b.classList.toggle('talk', Voice.speaking(id) && !Voice.isBlocked(id));
  }
}

/* ---- 사람별 소리 크기 · 차단 -------------------------------------
 *  헤드셋을 누르면 작은 창이 뜬다. 서버를 거치지 않으므로 상대는 모르고,
 *  내 귀에만 적용된다. 창은 pmenu 처럼 목록 바깥에 하나만 두고 옮겨 띄운다.
 * ------------------------------------------------------------------ */
const volPop = $('volPop');
let volPopId = -1;

function closeVolPop() {
  if (volPopId < 0) return;
  volPopId = -1;
  volPop.hidden = true;
}

function syncVolPop() {
  const id = volPopId;
  const off = Voice.isBlocked(id);
  const pct = Math.round(Voice.getVolume(id) * 100);
  $('vpVol').value = pct;
  $('vpPct').textContent = pct + '%';
  $('vpBlock').textContent = off ? '차단 풀기' : '소리 차단';
  $('vpBlock').classList.toggle('on', off);
  volPop.classList.toggle('blocked', off);
}

function openVolPop(id, anchor) {
  const p = peopleCache.find((x) => x.id === id);
  if (!p || id === myId) return;
  volPopId = id;
  $('vpName').textContent = p.name || '익명';
  syncVolPop();
  volPop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mw = volPop.offsetWidth, mh = volPop.offsetHeight;
  let left = r.right - mw, top = r.bottom + 6;
  if (left < 8) left = 8;
  if (left + mw > innerWidth - 8) left = innerWidth - 8 - mw;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - 6 - mh);
  volPop.style.left = left + 'px';
  volPop.style.top = top + 'px';
}

function refreshPeopleIcons() { peopleSig = ''; renderPeople(); }

$('vpVol').addEventListener('input', () => {
  if (volPopId < 0) return;
  Voice.setVolume(volPopId, $('vpVol').value / 100);
  $('vpPct').textContent = $('vpVol').value + '%';
});
$('vpVol').addEventListener('change', () => { const id = volPopId; refreshPeopleIcons(); if (id >= 0) volPopId = id; });
$('vpBlock').addEventListener('click', () => {
  const id = volPopId;
  if (id < 0) return;
  const p = peopleCache.find((x) => x.id === id);
  const on = !Voice.isBlocked(id);
  Voice.setBlocked(id, on);
  toast((p ? p.name : '이 사람') +
    (on ? ' 님의 소리를 차단했습니다 (나에게만 적용)' : ' 님의 소리를 다시 듣습니다.'), 2800);
  syncVolPop();
  refreshPeopleIcons();
  volPopId = id;
});
volPop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', (e) => {
  if (volPopId >= 0 && !e.target.closest('#volPop, button.pblk')) closeVolPop();
});

let peopleSig = '';
function renderPeople() {
  if (!peopleOpen) return;
  if (renaming) return;              // 이름을 고치는 중에는 입력칸을 지우지 않는다
  // 명단·역할이 실제로 바뀐 경우에만 DOM 을 다시 만든다.
  // (위치 브로드캐스트가 10Hz 로 들어와 매번 다시 그리면 커서 밑 버튼이 깜빡인다)
  const sig = JSON.stringify([
    peopleCache.map((p) => [p.id, p.name, p.gone ? 1 : 0, p.mic ? 1 : 0]),
    karaoke,
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
    const mine = p.id === myId;
    // 노래방일 때만 마이크 상태를 보여 준다
    // 마이크 아이콘 — 켬(분홍 마이크) · 끔(빗금 마이크).
    // 내 줄에서만 버튼이다: 누르면 음소거 · 마이크 고르기 창이 뜬다. 남의 마이크는 건드릴 수 없다.
    const micCls = 'micst ' + (p.mic ? 'on' : 'off');
    const micIc = p.mic ? MIC_SVG : MIC_MUTED_SVG;
    const state = p.mic ? '마이크 켬' : '음소거';
    const mic = !karaoke ? ''
      : mine
        ? '<button class="' + micCls + ' mysel' + (micMenuOpen() ? ' open' : '') + '" title="' + state +
          ' — 눌러서 음소거 · 마이크 고르기" aria-label="내 마이크">' + micIc + '</button>'
        : '<span class="' + micCls + '" title="' + state + '">' + micIc + '</span>';
    // 소리 차단 — 헤드셋 버튼 하나로 켜고 끈다. 내 귀에만 적용되므로 누구나 누른다.
    // 노래방 모드일 때만 보인다 — 평소에는 들을 소리 자체가 없다.
    const off = !mine && Voice.isBlocked(p.id);
    const vol = mine ? Voice.DEFAULT_VOLUME : Voice.getVolume(p.id);
    const blk = (mine || !karaoke) ? ''
      : '<button class="pblk' + (off ? ' off' : (vol !== Voice.DEFAULT_VOLUME ? ' quiet' : '')) + '" data-blk="' + p.id + '" title="' +
        (off ? '소리 차단 중' : '소리 크기 ' + Math.round(vol * 100) + '%') +
        ' — 눌러서 조절 (나에게만 적용)" aria-label="소리 크기">' + HEADSET + '</button>';
    // 내 줄에는 ✎ (이름 바꾸기), 남의 줄에는 방장만 쓰는 ⋯ (관리)
    const acts = mine
      ? '<button class="pedit" title="이름 바꾸기" aria-label="이름 바꾸기">' + PENCIL + '</button>'
      : (isHost ? '<button class="pmore" data-more="' + p.id + '" title="관리" aria-label="관리">⋯</button>' : '');
    // 이름과 배지(방장·나)는 한 덩어리로 왼쪽에, 마이크·헤드셋·⋯ 는 오른쪽 끝에
    return '<div class="person' + (p.gone ? ' isgone' : '') + '">' +
           '<span class="swatch" style="background:#' + c + '"></span>' +
           '<span class="pname"><span class="nm">' + esc(p.name || '익명') + '</span>' +
           '<span class="badges">' + badges + '</span></span>' +
           mic + blk + acts + '</div>';
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
  if (!p || id === myId || !isHost) return;
  const isCo = coHosts.includes(id);
  const targetIsHost = !!(room && room.hostId === id);
  pmenuId = id;

  // 소리 차단은 줄에 붙은 헤드셋이, 마이크 끄기는 줄에 붙은 🎤 가 맡는다 — 여기는 방장 권한만 모은다
  const rows = [];
  if (!targetIsHost) {
    rows.push('<button class="pmi" data-act="cohost" data-on="' + (isCo ? '0' : '1') + '">' +
      (isCo ? '부방장 해제' : '부방장 지정') + '</button>');
    rows.push('<button class="pmi" data-act="makehost">방장 넘기기</button>');
    rows.push('<div class="sep"></div>');
    rows.push('<button class="pmi danger" data-act="kick">내보내기</button>');
  }
  pmenu.innerHTML = rows.join('');
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
  const ms = e.target.closest('button.mysel');
  if (ms) {
    e.stopPropagation();
    closePMenu(); closeVolPop();
    setMicMenu(!micMenuOpen(), ms);
    return;
  }
  const bl = e.target.closest('button.pblk');
  if (bl) {
    e.stopPropagation();
    const id = +bl.dataset.blk;
    if (volPopId === id) { closeVolPop(); return; }   // 같은 헤드셋을 다시 누르면 닫는다
    closePMenu();
    openVolPop(id, bl);
    return;
  }
  const b = e.target.closest('button.pmore');
  if (!b) return;
  e.stopPropagation();
  const id = +b.dataset.more;
  if (pmenuId === id) { closePMenu(); return; }    // 같은 버튼을 다시 누르면 닫는다
  closePMenu();
  closeVolPop();
  openPMenu(id, b);
});

pmenu.addEventListener('click', (e) => {
  const b = e.target.closest('button.pmi');
  if (!b) return;
  e.stopPropagation();
  const id = pmenuId;
  const p = peopleCache.find((x) => x.id === id);
  const who = (p ? p.name : '이 사람');
  const act = b.dataset.act;
  closePMenu();
  if (id < 0) return;

  if (!isHost) return;
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

/* 재생목록이 비었다는 걸 ☰ 옆에서 알려 준다.
 *  조작할 수 있는 사람에게만, 한 곡이라도 담기면 저절로 사라진다. */
let plTipOff = false;        // 직접 닫았나 (방을 옮기면 다시 보여 준다)

function updatePlTip() {
  const el = $('plTip');
  if (!el) return;
  const empty = !(room && room.playlist && room.playlist.length);
  el.hidden = !(empty && canCtl() && screen === 'room' && !plTipOff);
}

$('plTipX').addEventListener('click', (e) => {
  e.stopPropagation();
  plTipOff = true;
  updatePlTip();
});

function applyHostUI() {
  const ctl = canCtl();
  applyBarDefault();
  $('hostCtl').hidden = !ctl;
  $('guestNote').hidden = ctl;
  $('playlistBtn').hidden = !ctl;
  $('modeHead').hidden = !isHost;      // Play 모드는 방장만 고른다
  $('miCinema').hidden = !isHost;
  $('miKaraoke').hidden = !isHost;
  $('miPgame').hidden = !(isHost && karaoke);   // 음정 게임모드는 노래방 안에서만
  const sep = $('setDrop').querySelector('.smi-sep');
  if (sep) sep.hidden = !isHost;
  $('miCinema').classList.toggle('on', !karaoke);
  $('miKaraoke').classList.toggle('on', karaoke);
  $('miTitle').hidden = !ctl;          // 설정 메뉴의 '방 제목 수정'
  $('titleEdit').hidden = !ctl;        // 제목 옆 연필
  // 좌상단 제목도 같은 권한일 때만 눌린다 (#hud 가 pointer-events:none 이라 클래스로 켠다)
  const rt = $('roomTitle');
  rt.classList.toggle('editable', ctl);
  rt.title = ctl ? '눌러서 방 제목 수정' : '';
  $('playerbar').classList.toggle('host-seek', ctl);
  updatePlTip();
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
  updatePlTip();
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

/* ---- 음정 띠 · 음정 게임모드 ----------------------------------------
 *  스크린 아랫부분에 겹쳐 띄우는 2048×256 캔버스.
 *    왼쪽 칸 : 지금 내고 있는 음 이름과 음정 오차
 *    가운데 : 기준선(MR 에서 뽑은 주선율)과 내 음정이 함께 흐른다
 *    아래 띠 : 목소리 파형
 *
 *  가로축은 '지금' 을 62% 지점에 두어 왼쪽은 지나간 소리, 오른쪽은 다가오는
 *  음이 보이게 했다. 부를 음을 미리 봐야 맞출 수 있다.
 *  세로축은 로그다 — 한 옥타브가 어디서나 같은 높이를 차지해야 자연스럽다.
 * ------------------------------------------------------------------ */
const PITCH_PAST = 3.6;              // 왼쪽에 남는 시간
const PITCH_FUT = 2.4;               // 오른쪽에 미리 보이는 시간
const PX0 = 168, PX1 = 2016;         // 그래프 좌우
const PY0 = 16, PY1 = 190;           // 그래프 위아래
const WY0 = 200, WY1 = 246;          // 파형 띠
const PX_SEC = (PX1 - PX0) / (PITCH_PAST + PITCH_FUT);
const NOW_X = PX0 + PITCH_PAST * PX_SEC;

const pitchHist = [];                // { t, hz } — 최근 PITCH_PAST 초
let pitchTick = 0;
let pitchIdle = true;

let pitchLo = 110, pitchHi = 880;    // 보이는 음역 (기준선이 들어오면 거기 맞춘다)

const pitchY = (hz) =>
  PY1 - (Math.log(hz / pitchLo) / Math.log(pitchHi / pitchLo)) * (PY1 - PY0);
const xOfAge = (age) => NOW_X - age * PX_SEC;

function pitchReset() {
  pitchHist.length = 0;
  pitchTick = 0;
  pitchIdle = true;
}

/* 기준선이 들어오면 그 곡의 음역에 맞춰 세로축을 다시 잡는다 */
function fitPitchRange() {
  if (!melodyNotes || !melodyNotes.length) { pitchLo = 110; pitchHi = 880; return; }
  let lo = 999, hi = 0;
  for (const n of melodyNotes) { if (n.m < lo) lo = n.m; if (n.m > hi) hi = n.m; }
  pitchLo = Pitch.hzOfMidi(Math.max(36, lo - 3));
  pitchHi = Pitch.hzOfMidi(Math.min(96, hi + 3));
}

/* 격자와 음 이름 */
function drawPitchGrid(g, W) {
  g.clearRect(0, 0, W, 256);
  g.fillStyle = 'rgba(10,8,16,.62)';
  g.fillRect(0, 0, W, 256);
  g.strokeStyle = 'rgba(255,90,176,.45)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, 253);

  g.textBaseline = 'middle';
  const loM = Math.ceil(69 + 12 * Math.log2(pitchLo / 440));
  const hiM = Math.floor(69 + 12 * Math.log2(pitchHi / 440));
  for (let m = loM; m <= hiM; m++) {
    const y = pitchY(Pitch.hzOfMidi(m));
    const n = Pitch.noteOf(Pitch.hzOfMidi(m));
    const mark = (n.name === 'C' || n.name === 'A');
    g.strokeStyle = mark ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.07)';
    g.lineWidth = mark ? 2 : 1;
    g.beginPath(); g.moveTo(PX0, y); g.lineTo(PX1, y); g.stroke();
    if (mark && hiM - loM < 40) {
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.font = '600 22px "Noto Sans KR",sans-serif';
      g.textAlign = 'right';
      g.fillText(n.name + n.octave, PX0 - 12, y);
    }
  }
  g.strokeStyle = 'rgba(255,255,255,.14)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(152, 18); g.lineTo(152, 238); g.stroke();
}

/* '지금' 세로선 */
function drawNowLine(g) {
  g.strokeStyle = 'rgba(255,255,255,.5)';
  g.lineWidth = 2;
  g.setLineDash([7, 6]);
  g.beginPath(); g.moveTo(NOW_X, PY0 - 4); g.lineTo(NOW_X, PY1 + 6); g.stroke();
  g.setLineDash([]);
}

/* 기준선 — MR 에서 뽑은 주선율. 다가오는 음은 옅게, 지금 음은 또렷하게. */
function drawReference(g, songNow) {
  if (!melodyNotes || !melodyNotes.length) return;
  const from = songNow - PITCH_PAST - 0.5, to = songNow + PITCH_FUT + 0.5;
  for (const n of melodyNotes) {
    const end = n.t + n.d;
    if (end < from || n.t > to) continue;
    const x0 = xOfAge(songNow - n.t), x1 = xOfAge(songNow - end);
    const y = pitchY(Math.max(pitchLo, Math.min(pitchHi, Pitch.hzOfMidi(n.m))));
    const live = n.t <= songNow && songNow < end;
    g.fillStyle = live ? 'rgba(125,230,255,.95)' : 'rgba(110,200,255,.34)';
    if (live) { g.shadowColor = 'rgba(125,230,255,.9)'; g.shadowBlur = 18; }
    const w = Math.max(5, x1 - x0);
    g.beginPath();
    if (g.roundRect) g.roundRect(x0, y - 7, w, 14, 7); else g.rect(x0, y - 7, w, 14);
    g.fill();
    g.shadowBlur = 0;
  }
}

function drawPitch(nowSec, songNow) {
  const c = world.pitchCanvas;
  if (!c) return;
  const g = c.getContext('2d');
  const W = c.width;
  drawPitchGrid(g, W);
  if (pgame && melodyNotes) drawReference(g, songNow);
  drawNowLine(g);

  if (!Pitch.isOn()) {
    // 기준선이 떠 있으면 아무 글자도 얹지 않는다 — 선 위를 글씨가 가린다
    if (!(pgame && melodyNotes)) {
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.font = '500 30px "Noto Sans KR",sans-serif';
      g.textAlign = 'center';
      g.fillText('마이크를 켜면 음정이 그려집니다', W / 2, 128);
    }
    world.pitchTexture.needsUpdate = true;
    return;
  }

  /* 내 음 높낮이 — 소리가 끊긴 자리에서는 선도 끊는다 */
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = pass === 0 ? 'rgba(255,88,176,.9)' : '#fff2fa';
    g.lineWidth = pass === 0 ? 13 : 4;
    g.shadowColor = 'rgba(255,88,176,.95)';
    g.shadowBlur = pass === 0 ? 22 : 6;
    let drawing = false;
    g.beginPath();
    for (let i = 0; i < pitchHist.length; i++) {
      const p = pitchHist[i];
      if (!p.hz) { drawing = false; continue; }
      const prev = pitchHist[i - 1];
      const gap = !prev || !prev.hz || (p.t - prev.t) > 0.25;
      const x = xOfAge(nowSec - p.t);
      const y = pitchY(Math.max(pitchLo, Math.min(pitchHi, p.hz)));
      if (gap || !drawing) { g.moveTo(x, y); drawing = true; } else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.shadowBlur = 0;

  /* 지금 이 순간 */
  const cur = pitchHist.length ? pitchHist[pitchHist.length - 1] : null;
  if (cur && cur.hz) {
    const y = pitchY(Math.max(pitchLo, Math.min(pitchHi, cur.hz)));
    g.fillStyle = '#fff2fa';
    g.shadowColor = 'rgba(255,88,176,1)';
    g.shadowBlur = 26;
    g.beginPath(); g.arc(NOW_X, y, 11, 0, 6.2832); g.fill();
    g.shadowBlur = 0;

    const n = Pitch.noteOf(cur.hz);
    g.textAlign = 'center';
    g.fillStyle = '#fff2fa';
    g.font = '700 78px "Noto Sans KR",sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillText(n.name, 66, 108);
    g.font = '500 34px "Noto Sans KR",sans-serif';
    g.fillStyle = 'rgba(255,255,255,.6)';
    g.fillText(String(n.octave), 122, 108);

    const bx = 24, bw = 104, by = 150;
    g.fillStyle = 'rgba(255,255,255,.14)';
    g.fillRect(bx, by, bw, 8);
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.fillRect(bx + bw / 2 - 1, by - 5, 2, 18);
    const off = Math.max(-50, Math.min(50, n.cents)) / 50;
    const near = Math.abs(n.cents) <= 12;
    g.fillStyle = near ? '#7dffb0' : '#ff9ad2';
    g.beginPath(); g.arc(bx + bw / 2 + off * (bw / 2), by + 4, 8, 0, 6.2832); g.fill();
    g.font = '500 20px "Noto Sans KR",sans-serif';
    g.fillStyle = near ? 'rgba(125,255,176,.9)' : 'rgba(255,154,210,.9)';
    g.fillText((n.cents > 0 ? '+' : '') + n.cents, bx + bw / 2, by + 44);
  }

  /* 파형 */
  const wf = Pitch.waveform();
  if (wf) {
    g.strokeStyle = 'rgba(140,220,255,.75)';
    g.lineWidth = 2;
    g.beginPath();
    const mid = (WY0 + WY1) / 2, amp = (WY1 - WY0) / 2;
    const step = Math.max(1, Math.floor(wf.length / (PX1 - PX0)));
    let first = true;
    for (let i = 0, x = PX0; i < wf.length && x <= PX1; i += step, x++) {
      const y = mid - Math.max(-1, Math.min(1, wf[i] * 3.2)) * amp;
      if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
    }
    g.stroke();
  }

  world.pitchTexture.needsUpdate = true;
}

/* ---- 분석 중 스크린을 덮는 로딩 화면 ---- */
let loadSpin = 0;

function drawLoading(t) {
  const c = world.loadCanvas;
  if (!c) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,6,14,.9)';
  g.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2 - 36;
  // 도는 고리
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.1)';
  g.lineWidth = 9;
  g.beginPath(); g.arc(cx, cy, 52, 0, 6.2832); g.stroke();
  g.strokeStyle = '#ff5ab0';
  g.shadowColor = 'rgba(255,90,176,.9)';
  g.shadowBlur = 22;
  g.beginPath(); g.arc(cx, cy, 52, t * 2.6, t * 2.6 + 1.9); g.stroke();
  g.shadowBlur = 0;

  g.textAlign = 'center';
  g.fillStyle = '#fff2fa';
  g.font = '700 42px "Noto Sans KR",sans-serif';
  g.fillText('음정 분석 중…', cx, cy + 128);

  const it = currentItem();
  if (it) {
    g.font = '500 25px "Noto Sans KR",sans-serif';
    g.fillStyle = 'rgba(255,255,255,.6)';
    let title = it.title || it.id;
    while (title.length > 1 && g.measureText(title).width > W - 160) title = title.slice(0, -1);
    g.fillText(title, cx, cy + 172);
  }
  g.font = '400 21px "Noto Sans KR",sans-serif';
  g.fillStyle = 'rgba(255,255,255,.38)';
  g.fillText('MR 에서 주선율을 뽑고 있습니다 · 한 번 해 두면 다음부터는 바로 시작합니다', cx, cy + 214);

  world.loadTexture.needsUpdate = true;
}

/* 프레임마다 한 점씩 쌓고 다시 그린다 (25Hz) */
function stepPitch(dt, nowSec) {
  if (!karaoke) { if (world.setLoadVisible) world.setLoadVisible(false); return; }

  // 음정 게임모드인데 아직 기준선이 없으면 스크린을 덮고 기다린다
  const waiting = pgame && melodyState === 'pending';
  world.setLoadVisible(waiting);
  if (waiting) {
    loadSpin += dt;
    if (loadSpin > 0.05) { loadSpin = 0; }
    drawLoading(nowSec);
  }

  const songNow = TV.currentTime();
  if (!Pitch.isOn()) {
    if (!pitchIdle) { pitchIdle = true; drawPitch(nowSec, songNow); }
    else if (pgame && melodyNotes && room && room.playing) drawPitch(nowSec, songNow);
    return;
  }
  pitchIdle = false;
  pitchTick += dt;
  if (pitchTick < 0.04) return;
  pitchTick = 0;
  const r = Pitch.read();
  pitchHist.push({ t: nowSec, hz: r.hz });
  while (pitchHist.length && nowSec - pitchHist[0].t > PITCH_PAST + 0.5) pitchHist.shift();
  drawPitch(nowSec, songNow);
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
  if (v > 0) lastVol = v;
  updateMuteIcon();
});
muteToggle.addEventListener('click', () => {
  if (+volSlider.value === 0 || TV.isMuted()) {
    const v = lastVol || 80; volSlider.value = v; TV.setVol(v);
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
    // 소리 있는 자동재생이 막혀 음소거로 틀었다 — 오른쪽 위 🔊 로 켜면 된다
    if (why === 'mute') { updateMuteIcon(); toast('소리가 꺼진 채 재생 중입니다 — 오른쪽 위 🔇 를 눌러 켜세요.', 5000); }
    else toast(why, 5000);
  },
  /* 넘어가기 전에 '왜' 를 남긴다. 조용히 다음 곡으로 가 버리면
   * 틀리지도 않은 링크를 붙들고 한참 헤매게 된다. */
  onVideoError: (code, id) => {
    const it = (room && room.playlist || []).find((x) => x.id === id);
    const name = it ? (it.title || it.id) : (id || '이 영상');
    const why = TV.errorText(code);
    logMsg('⚠ <b>' + esc(name) + '</b> — ' + esc(why) +
      (canCtl() ? ' 재생목록에서 빼 주세요.' : ''), 'sys');
    toast(why, 6500);
  }
});

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
  plTipOff = true;                   // 찾아왔으니 안내는 접는다
  updatePlTip();
  $('plAddInput').value = '';
  $('plAddHint').hidden = true;
  $('playlistPanel').hidden = false;   // 먼저 띄워야 renderPlTracks 가 그린다
  renderPlTracks();
  updatePlPh();                        // 띄운 뒤에 재야 폭이 잡힌다 (숨어 있으면 0)
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
  updatePlPh();
  $('plAddHint').hidden = true;
  toast(countLinks(v).p ? '재생목록을 펼치는 중…' : '추가하는 중…', 1800);
}
/* 겹쳐 둔 안내 글 — 뭔가 적으면 감추고, 칸에 다 들어가면 흐르지 않는다 */
function updatePlPh() {
  const ph = $('plAddPh'), inp = $('plAddInput');
  if (!ph || !inp) return;
  ph.hidden = !!inp.value;
  if (ph.hidden) return;
  const one = ph.firstElementChild;
  // 한 벌이 칸보다 좁으면 흐를 필요가 없다
  ph.classList.toggle('fits', !!one && one.scrollWidth <= ph.clientWidth);
}

$('plAddInput').addEventListener('input', updatePlPh);
$('plAddInput').addEventListener('input', updatePlHint);
addEventListener('resize', updatePlPh);
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

/* ---- 확대·축소 ------------------------------------------------------
 *  3인칭은 카메라를 멀리/가까이(cam.dist), 1인칭은 화각을 넓게/좁게(cam.fov).
 *  마우스는 휠, 손가락은 두 개로 오므리고 펼친다. 둘 다 여기를 거친다.
 * ------------------------------------------------------------------ */
const DIST_MIN = 5, DIST_MAX = 22;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* r > 1 이면 당겨 본다(확대). 바꾼 게 있으면 true */
function zoomBy(r) {
  if (!(r > 0) || !isFinite(r)) return false;
  if (cam.mode === 'watch') {
    const was = cam.fov;
    cam.fov = clamp(cam.fov / r, FOV_MIN, FOV_MAX);
    if (cam.fov !== was) showZoom();
    return true;
  }
  if (cam.mode === 'lounge') {
    cam.dist = clamp(cam.dist / r, DIST_MIN, DIST_MAX);
    return true;
  }
  return false;                       // 전체화면은 화면에 꽉 맞춘 상태라 손대지 않는다
}

/* 손가락이 두 개일 때만 핀치다. 하나는 둘러보기(드래그)로 남겨 둔다. */
const touches = new Map();            // pointerId -> {x, y}
const pinch = { on: false, d0: 0, dist0: 0, fov0: 0 };

function pinchSpan() {
  const it = Array.from(touches.values());
  if (it.length < 2) return 0;
  return Math.hypot(it[0].x - it[1].x, it[0].y - it[1].y);
}
function pinchStart() {
  pinch.d0 = pinchSpan();
  if (pinch.d0 < 12) return;          // 너무 붙어 있으면 비율이 튄다
  pinch.on = true;
  pinch.dist0 = cam.dist;
  pinch.fov0 = cam.fov;
  drag.on = false;                    // 두 손가락은 확대지 둘러보기가 아니다
}
function pinchMove() {
  const d = pinchSpan();
  if (!pinch.on || !d) return;
  const r = d / pinch.d0;             // 벌리면 1보다 커진다 = 확대
  if (cam.mode === 'watch') {
    const was = cam.fov;
    cam.fov = clamp(pinch.fov0 / r, FOV_MIN, FOV_MAX);
    if (cam.fov !== was) showZoom();
  } else if (cam.mode === 'lounge') {
    cam.dist = clamp(pinch.dist0 / r, DIST_MIN, DIST_MAX);
  }
}

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
    if (talkWith) { endTalk(); return; }        // 대화부터 닫는다
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
  if (k === 'e') {                       // 산타·루돌프에게 말 걸기
    if (talkWith) endTalk(); else if (nearNpc) startTalk(nearNpc);
    return;
  }
  // 대화 중에는 숫자키로 고른다 — 목록에 번호를 붙여 둔 이유다
  if (talkWith && k >= '1' && k <= '9') {
    pickTopic(+k - 1);
    e.preventDefault();
    return;
  }
  if (k === 'v') { setWatchMode(cam.mode !== 'watch'); return; }
  if (k === 'm' && karaoke) { toggleMic(); return; }      // 노래방 — 마이크 토글
  keys[k] = true;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  drag.on = false;
  // 창 밖에서 손을 떼면 pointerup 이 안 온다 — 남은 기록을 털지 않으면
  // 다음에 한 손가락만 올려도 핀치로 잡힌다
  touches.clear(); pinch.on = false;
});

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* 휠 — 3인칭은 카메라를 멀리/가까이, 1인칭은 화각을 넓게/좁게.
 * 둘 다 '아래로 굴리면 멀어진다' 로 방향을 맞춘다.
 * 화각은 더하기가 아니라 곱하기로 움직인다 — 많이 당겨 놓았을수록
 * 한 칸이 곱게 들어와야 미세 조정이 된다. */
canvas.addEventListener('wheel', (e) => {
  if (screen !== 'room') return;
  // 위로 굴리면 당겨 보고, 아래로 굴리면 물러난다 (3인칭·1인칭 같은 방향)
  if (zoomBy(Math.exp(-Math.sign(e.deltaY) * 0.11))) e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  if (screen !== 'room') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) { pinchStart(); return; }        // 두 번째 손가락 — 확대로 바꾼다
  drag.on = true; drag.moved = 0; drag.lx = e.clientX; drag.ly = e.clientY;
  drag.t0 = performance.now(); drag.button = e.button;
  if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
});

window.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) {
    const t = touches.get(e.pointerId);
    t.x = e.clientX; t.y = e.clientY;
  }
  if (pinch.on) { pinchMove(); return; }
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

/* 손가락 하나가 떨어지면 핀치는 끝. 남은 하나로 둘러보기를 다시 시작하지는
 * 않는다 — 벌린 채로 떼는 중에 화면이 홱 돌아가 버린다. */
function pointerGone(e) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch.on = false;
}
window.addEventListener('pointercancel', pointerGone);

window.addEventListener('pointerup', (e) => {
  pointerGone(e);
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

/* ================================================================== */
/* 산타와 루돌프                                                       */
/* ================================================================== */

/* 서버 시계와의 차이. NPC 자리는 '시각의 함수' 라, 사람마다 시계가
 * 어긋나면 산타가 다른 자리에 서 있게 된다. 방 소식에 실려 오는
 * serverNow 로 한 번씩 맞춘다. */
let clockSkew = 0;
function syncClock(serverNow) {
  if (!serverNow) return;
  clockSkew = serverNow - Date.now();
}
const npcClock = () => (Date.now() + clockSkew) / 1000;

/* 화면에 보이는 자리 — 계산된 자리로 부드럽게 따라간다.
 * 말을 거는 동안에는 그 자리에 멈춰 선다. 내 화면에서만 멈추는 것이라
 * 남의 화면에서는 계속 걷지만, 대화가 끝나면 제자리로 돌아온다. */
const npcView = Npc.NPCS.map((n) => ({
  def: n, grp: null, x: 0, z: 0, yaw: 0, ready: false
}));
let talkWith = null;              // 지금 말 거는 상대 (없으면 null)
let nearNpc = null;               // 손 닿는 거리에 있는 상대

function stepNpcs(dt) {
  const t = npcClock();
  let best = null, bestD = Npc.REACH;

  for (const v of npcView) {
    if (!v.grp) v.grp = world.npcs && world.npcs[v.def.kind];
    if (!v.grp) continue;

    const held = (talkWith === v.def.id);
    const pose = Npc.poseAt(v.def, t);
    if (!v.ready) { v.x = pose.x; v.z = pose.z; v.yaw = pose.yaw; v.ready = true; }

    if (held) {
      // 말을 거는 동안에는 걸음을 멈추고 나를 본다
      const dx = me.x - v.x, dz = me.z - v.z;
      const want = Math.atan2(dx, dz);
      let d = want - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * 6);
    } else {
      // 계산된 자리로 따라붙는다 (대화 뒤 돌아올 때도 이 길로)
      const k = Math.min(1, dt * 2.6);
      v.x += (pose.x - v.x) * k;
      v.z += (pose.z - v.z) * k;
      let d = pose.yaw - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * 5);
    }

    v.grp.position.set(v.x, 0, v.z);
    v.grp.rotation.y = v.yaw;

    /* 걸음 — 다리를 앞뒤로 젓고 몸을 들썩인다.
     * 멈춰 있을 때는 다리를 제자리로 되돌리고 숨만 쉰다. */
    const moving = !held && pose.walking;
    const sw = Math.sin(pose.stride);
    const inner = v.grp.children[0];
    if (inner && inner.isGroup) {
      inner.position.y = moving ? Math.abs(sw) * 0.05 : Math.sin(t * 1.2 + v.def.seed) * 0.012;
    }
    const parts = v.grp.userData || {};
    const k = Math.min(1, dt * 9);
    (parts.legs || []).forEach((h, i) => {
      // 네 발이면 대각선끼리 짝지어(pair), 두 발이면 좌우 번갈아
      const phase = (h.userData.pair !== undefined ? h.userData.pair : i) % 2;
      const want = moving ? Math.sin(pose.stride + phase * Math.PI) * 0.55 : 0;
      h.rotation.x += (want - h.rotation.x) * k;
    });
    (parts.arms || []).forEach((h, i) => {
      const want = moving ? Math.sin(pose.stride + (i % 2) * Math.PI) * -0.45 : 0;
      h.rotation.x += (want - h.rotation.x) * k;
    });

    const dist = Math.hypot(me.x - v.x, me.z - v.z);
    if (dist < bestD) { bestD = dist; best = v; }
  }

  nearNpc = best ? best.def : null;
  updateNpcTip();
  placeBubble();

  // 너무 멀어지면 대화가 저절로 끝난다
  if (talkWith) {
    const v = npcView.find((n) => n.def.id === talkWith);
    if (v && Math.hypot(me.x - v.x, me.z - v.z) > Npc.REACH * 2.4) endTalk();
  }
}

/* 말풍선을 NPC 머리 위에 붙인다. 3D 자리를 화면 좌표로 옮기고,
 * 가장자리를 넘지 않게 민다. 민 만큼 꼬리는 반대로 당겨 NPC 를 계속
 * 가리키게 한다. 카메라 뒤로 돌아가면 왼쪽 아래에 내려앉힌다. */
const bubbleVec = new THREE.Vector3();
function placeBubble() {
  const el = $('npcTalk');
  if (!el || el.hidden) return;
  const v = npcView.find((n) => n.def.id === talkWith);
  if (!v) return;

  bubbleVec.set(v.x, v.def.headY || 2.0, v.z).project(camera);
  if (bubbleVec.z > 1) { el.classList.add('docked'); return; }   // 카메라 뒤
  el.classList.remove('docked');

  const sx = (bubbleVec.x * 0.5 + 0.5) * innerWidth;
  const sy = (-bubbleVec.y * 0.5 + 0.5) * innerHeight;
  const w = el.offsetWidth, h = el.offsetHeight;
  const pad = 12;
  const left = clamp(sx, pad + w / 2, innerWidth - pad - w / 2);
  const top = clamp(sy - 14, pad + h, innerHeight - pad);
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
  // 꼬리는 밀린 만큼 되돌려 NPC 를 가리킨다
  el.style.setProperty('--tail-x',
    Math.round(clamp(sx - (left - w / 2), 14, w - 14)) + 'px');
}

function updateNpcTip() {
  const el = $('npcTip');
  if (!el) return;
  const show = !!nearNpc && !talkWith && screen === 'room' && cam.mode !== 'cinema';
  if (!show) { el.hidden = true; return; }
  if (el.hidden || el.dataset.who !== nearNpc.id) {
    el.dataset.who = nearNpc.id;
    $('npcTipT').textContent = nearNpc.icon + ' ' + nearNpc.name + ' 에게 말 걸기';
  }
  el.hidden = false;
}

/* ---- 대화 ---- */
function startTalk(def) {
  if (!def) return;
  talkWith = def.id;
  $('ntIc').textContent = def.icon;
  $('ntName').textContent = def.name;
  talkPath = [];
  setSay([Npc.helloOf(def)]);
  renderAsk();
  $('npcTalk').hidden = false;
  updateNpcTip();
}

function endTalk() {
  talkWith = null;
  $('npcTalk').hidden = true;
  updateNpcTip();
}

/* 말풍선이라 쌓지 않고 갈아 끼운다. 쌓으면 금세 화면을 덮는다. */
function setSay(lines) {
  const box = $('ntSay');
  box.innerHTML = lines.map((l) => '<p>' + esc(l) + '</p>').join('');
  box.scrollTop = 0;
}

/* 지금 어느 갈래 안에 들어와 있나 (빈 배열이면 첫 목록) */
let talkPath = [];

function talkNode() {
  const def = Npc.NPCS.find((n) => n.id === talkWith);
  let list = def ? Npc.topicsOf(def) : [];
  for (const i of talkPath) {
    const t = list[i];
    if (!t || !t.kids) return list;
    list = t.kids;
  }
  return list;
}

/* 고를 것을 번호 붙여 늘어놓는다. 갈래 안이면 '돌아가기' 를 끝에 붙인다 —
 * 자료에 적어 두지 않고 여기서 붙이는 쪽이, 갈래를 늘릴 때 잊지 않는다. */
function renderAsk() {
  const box = $('ntList');
  const list = talkNode();
  let html = list.map((t, i) =>
    '<li><button data-i="' + i + '"' + (t.bye ? ' class="quiet"' : '') + '>' +
    '<b>' + (i + 1) + '</b><span>' + esc(t.q) + '</span></button></li>'
  ).join('');
  if (talkPath.length) {
    html += '<li><button data-back="1" class="quiet">' +
      '<b>' + (list.length + 1) + '</b><span>(돌아가기)</span></button></li>';
  }
  box.innerHTML = html;
}

/* n번째를 고른다 (0부터). 숫자키와 눌림이 모두 여기로 온다 */
function pickTopic(n) {
  if (!talkWith) return;
  const list = talkNode();
  if (n === list.length && talkPath.length) {      // 돌아가기
    talkPath.pop();
    renderAsk();
    return;
  }
  const t = list[n];
  if (!t) return;
  if (t.kids) {                                    // 한 겹 들어간다
    talkPath.push(n);
    setSay([t.q + ' 말이지. 어느 쪽이 궁금해?']);
    renderAsk();
    return;
  }
  setSay(t.a);
  renderAsk();
  if (t.bye) setTimeout(endTalk, 1100);
}

$('ntList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  pickTopic(b.dataset.back ? talkNode().length : +b.dataset.i);
});
$('ntClose').addEventListener('click', endTalk);
$('npcTip').addEventListener('click', () => startTalk(nearNpc));

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
 *  재생 중에도 방을 넓게 보고 싶을 때가 있다.
 *  기본값은 역할을 따른다 — 재생을 조작하지 못하는 참여자는 접힌 채로 시작하고,
 *  방장·부방장은 펼친 채로 시작한다. 직접 접거나 펴면 그 선택을 탭에 기억해 둔다.
 * ------------------------------------------------------------------ */
const savedBar = (() => {
  // 예전 'weech.bar' 는 손대지 않아도 들어올 때마다 저장돼 '직접 고른 값' 과 구별이 안 된다 — 새 키만 본다
  try { sessionStorage.removeItem('weech.bar'); return sessionStorage.getItem('weech.barPick'); } catch (e) { return null; }
})();
let barTouched = savedBar === '0' || savedBar === '1';   // 사람이 직접 고른 적이 있나
let barMin = savedBar === '1';

function setBarMin(min, remember) {
  barMin = min;
  $('playerbar').classList.toggle('min', min);
  // 접으면 노래방 막대·토스트가 빈자리만큼 올라온다
  document.body.classList.toggle('barmin', min);
  $('barToggle').setAttribute('aria-expanded', min ? 'false' : 'true');
  if (remember) {
    barTouched = true;
    try { sessionStorage.setItem('weech.barPick', min ? '1' : '0'); } catch (e) { /* 무시 */ }
  }
}
$('barToggle').addEventListener('click', (e) => { e.stopPropagation(); setBarMin(!barMin, true); });
setBarMin(barMin);                 // 새로고침해도 접어 둔 상태를 지킨다

/* 역할이 정해지거나 바뀔 때 — 직접 고른 적이 없으면 역할에 맞춰 접고 편다 */
function applyBarDefault() {
  if (!barTouched) setBarMin(!canCtl());
}

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
  // 어느 시점이든 켜진 모양으로 둔다. 3인칭만 꺼진 듯 보이면 기본값이 아니라
  // '시점 기능이 꺼져 있다' 로 읽힌다 — 지금 어느 시점인지는 툴팁과 드롭다운이 알린다.
  btn.classList.add('on');
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

function setWatchMode(on, quiet) {
  if (on === (cam.mode === 'watch')) return;
  if (on && cam.mode === 'cinema') {        // 시네마와 겹치지 않게 먼저 해제
    document.body.classList.remove('cinema');
    exitFS();
  }
  cam.mode = on ? 'watch' : 'lounge';
  document.body.classList.toggle('watching', on);
  cam.fov = FOV_BASE;                      // 들고 날 때 배율은 초기화
  hideZoom();
  if (on) {
    const t = world.tvTransform;
    cam.yaw = Math.atan2(t.x - me.x, t.z - me.z);
    cam.look = 0.05;
    toast('1인칭 시점 — 드래그로 둘러보기 · ' + zoomHow() + ' · V 또는 Esc 로 나가기', 3800);
  } else {
    // 라운지 뷰는 카메라가 아바타를 '마주 보는' 구조라, 시청 모드에서 보던 방향을
    // 그대로 바라보려면 공전 각을 180° 돌려 준다.
    cam.yaw += Math.PI;
    // 전체화면으로 건너가는 길에 잠깐 들르는 것뿐이면 안내하지 않는다
    if (!quiet) toast('3인칭 시점 — 드래그로 둘러보기 · ' + zoomHow(), 3200);
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
  if (want && cam.mode === 'watch') setWatchMode(false, true);   // 시청 모드와 겹치지 않게
  cam.mode = want ? 'cinema' : 'lounge';
  document.body.classList.toggle('cinema', want);
  if (want) { toast('전체화면 — 영상이 화면을 채웁니다. Esc 로 나가기', 3200); requestFS(); }
  else { exitFS(); toast('3인칭 시점 — 드래그로 둘러보기 · ' + zoomHow(), 3200); }
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
    /* 가는 쪽으로 몸을 돌린다. 곧바로 꺾으면 제자리에서 홱 도는 것처럼
     * 보이므로 짧은 쪽으로 조금씩 돌린다. */
    let turn = Math.atan2(vx, vz) - me.dir;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    me.dir += turn * Math.min(1, dt * 14);
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
  stepNpcs(dt);

  /* 화각을 목표치로 부드럽게 옮긴다. 1인칭이 아닐 때는 늘 기본값으로
   * 되돌아간다 — 당겨 둔 채로 3인칭·전체화면에 가면 프레이밍이 깨진다. */
  {
    const want = (cam.mode === 'watch') ? cam.fov : FOV_BASE;
    if (Math.abs(camera.fov - want) > 0.01) {
      camera.fov += (want - camera.fov) * Math.min(1, dt * 14);
      if (Math.abs(camera.fov - want) < 0.02) camera.fov = want;
      camera.updateProjectionMatrix();
    }
  }

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

  /* 고개는 돌리지 않는다. 한때 카메라가 보는 쪽을 따라가게 해 뒀는데,
   * 카메라는 아바타 둘레를 돌고 몸은 마지막으로 걸은 쪽을 보고 서 있어서
   * 그 차이만큼 고개가 '늘' 꺾여 있었다 — 등 뒤(180°)에서만 0° 였다.
   * 아바타는 언제나 제 몸이 보는 쪽, 곧 걸어가는 쪽을 본다. */

  if (myAvatar) myAvatar.update(me, dt, now / 1000, cam.mode !== 'lounge');
  for (const g of others.values()) {
    g.fy = R.groundAt(g.x, g.z);
    g.av.update(g, dt, now / 1000, false);
  }

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
    if (screen === 'room') {
      stepNeon(dt);                           // 네온 간판의 긴 제목 흘리기
      stepPitch(dt, now / 1000);              // 스크린 아래 음정 띠
      paintTalking(dt);                       // 말하는 사람의 헤드셋
    }

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
