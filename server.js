#!/usr/bin/env node
/*
 * 위치 (WEECH) — 유튜브를 같이 보는 3D 라운지
 * 의존성 없는 정적 서버 + WebSocket 룸 서버.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_CAP = 20;        // 방 하나 정원
const MAX_ROOMS = 50;       // 동시 운영 가능한 방 수
const MAX_PLAYLIST = 50;    // 재생목록 최대 곡 수
const TICK_MS = 100;        // 10Hz 위치 브로드캐스트
const PUBLIC_DIR = path.join(__dirname, 'public');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

/* ================================================================== */
/* 유튜브 링크 파싱 + 제목 조회 (API 키 없이 oembed 사용)                */
/* ================================================================== */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* 링크 뭉치를 적힌 순서대로 훑어 '영상' 과 '재생목록' 으로 나눈다 */
function parseLinks(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  for (const raw of tokens) {
    const t = raw.trim();
    let m;
    // 재생목록(list=)이 붙어 있으면 재생목록으로 본다. v= 가 함께 있으면 그게 씨앗 영상.
    const list = t.match(/[?&]list=([A-Za-z0-9_-]{2,60})/);
    if (list) {
      const seedParam = t.match(/[?&]v=([A-Za-z0-9_-]{11})/);
      // 믹스(RD…)는 목록 ID 안에 씨앗 영상이 들어 있다 — RD8jYOsAHgOTw → 8jYOsAHgOTw
      const seedInList = list[1].match(/^(?:RD|RDMM|RDAMVM|RDCLAK)?([A-Za-z0-9_-]{11})$/);
      out.push({
        kind: 'list',
        list: list[1],
        seed: seedParam ? seedParam[1] : (seedInList ? seedInList[1] : null)
      });
      continue;
    }
    let id = null;
    if ((m = t.match(/[?&]v=([A-Za-z0-9_-]{11})/))) id = m[1];
    else if ((m = t.match(/youtu\.be\/([A-Za-z0-9_-]{11})/))) id = m[1];
    else if ((m = t.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/))) id = m[1];
    else if (/^[A-Za-z0-9_-]{11}$/.test(t)) id = t;
    if (id) out.push({ kind: 'video', id: id });
  }
  return out;
}

/* 호환용 — 재생목록을 뺀 순수 영상 ID 목록 */
function extractVideoIds(text) {
  const seen = new Set();
  const out = [];
  for (const ref of parseLinks(text)) {
    if (ref.kind !== 'video' || seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref.id);
    if (out.length >= MAX_PLAYLIST) break;
  }
  return out;
}

/* HTML 안에서 특정 항목 블록을 찾아 그 안의 첫 videoId 와 제목을 뽑는다 */
function itemsAfter(html, key) {
  const out = [];
  const parts = html.split('"' + key + '"');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 2500);
    const id = chunk.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    if (!id) continue;
    const t1 = chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){1,160})"/);
    const t2 = chunk.match(/"title":\{"simpleText":"((?:[^"\\]|\\.){1,160})"/);
    let title = (t1 && t1[1]) || (t2 && t2[1]) || '';
    try { title = JSON.parse('"' + title + '"'); } catch (e) { /* 그대로 둔다 */ }
    out.push({ id: id[1], title: title.slice(0, 120) });
  }
  return out;
}

const listCache = new Map();    // listId -> [{id,title}]

/* 재생목록을 펼친다 — API 키 없이 공개 페이지에서 긁는다 */
async function expandPlaylist(ref) {
  const key = ref.list + '|' + (ref.seed || '');
  if (listCache.has(key)) return listCache.get(key);

  // 믹스(RD…)는 목록 페이지가 비어 있다. 씨앗 영상의 시청 페이지에서만 목록이 만들어진다.
  const urls = [];
  if (ref.seed) urls.push('https://www.youtube.com/watch?v=' + ref.seed + '&list=' + ref.list);
  urls.push('https://www.youtube.com/playlist?list=' + ref.list);

  for (const url of urls) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(url, {
        signal: ctl.signal,
        headers: { 'user-agent': UA, 'accept-language': 'ko,en-US;q=0.8' }
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const html = await r.text();

      let items = itemsAfter(html, 'playlistVideoRenderer');
      if (!items.length) items = itemsAfter(html, 'playlistPanelVideoRenderer');
      if (!items.length) {
        // 마지막 수단 — 페이지에 등장하는 videoId 를 순서대로
        const ids = [...new Set([...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]))];
        items = ids.map((id) => ({ id: id, title: '' }));
      }
      // 중복 제거 + 상한
      const seen = new Set();
      const list = [];
      for (const it of items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        list.push(it);
        if (list.length >= MAX_PLAYLIST) break;
      }
      // 씨앗 영상이 있으면 그 곡부터 — 링크를 공유한 사람이 들려주려던 곡이다
      if (ref.seed) {
        const at = list.findIndex((it) => it.id === ref.seed);
        if (at > 0) list.unshift(list.splice(at, 1)[0]);
        else if (at < 0) list.unshift({ id: ref.seed, title: '' });
      }
      if (list.length) {
        listCache.set(key, list);
        setTimeout(() => listCache.delete(key), 10 * 60 * 1000);   // 10분 뒤 잊는다
        return list;
      }
    } catch (e) { /* 다음 후보 URL 로 */ }
  }
  // 아무것도 못 얻었지만 씨앗이라도 있으면 그 한 곡이라도
  const fallback = ref.seed ? [{ id: ref.seed, title: '' }] : [];
  listCache.set(key, fallback);
  return fallback;
}

/* 링크 뭉치 → 적힌 순서 그대로의 재생목록 */
async function resolveLinks(text) {
  const refs = parseLinks(text);
  const seen = new Set();
  const out = [];
  let truncated = false;
  for (const ref of refs) {
    const items = ref.kind === 'video'
      ? [{ id: ref.id, title: '' }]
      : await expandPlaylist(ref);
    for (const it of items) {
      if (seen.has(it.id)) continue;
      if (out.length >= MAX_PLAYLIST) { truncated = true; break; }
      seen.add(it.id);
      out.push({ id: it.id, title: it.title || '', author: '' });
    }
    if (out.length >= MAX_PLAYLIST) { truncated = true; break; }
  }
  return { items: out, truncated: truncated };
}

const titleCache = new Map();   // videoId -> { title, author }

function fetchTitle(id) {
  if (titleCache.has(id)) return Promise.resolve(titleCache.get(id));
  const url = 'https://www.youtube.com/oembed?url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  return fetch(url, { signal: ctl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const info = j && j.title
        ? { title: String(j.title).slice(0, 120), author: String(j.author_name || '').slice(0, 60) }
        : { title: '', author: '' };
      titleCache.set(id, info);
      return info;
    })
    .catch(() => {
      const info = { title: '', author: '' };   // 오프라인이면 제목 없이 간다
      titleCache.set(id, info);
      return info;
    })
    .finally(() => clearTimeout(timer));
}

/* 재생목록에 제목을 채워 넣고, 다 차면 방에 알린다 */
function hydrateTitles(room) {
  const pending = room.playlist.filter((it) => !it.title);
  if (!pending.length) return;
  Promise.all(pending.map((it) => fetchTitle(it.id).then((info) => {
    it.title = info.title || ('영상 ' + it.id);
    it.author = info.author;
  }))).then(() => {
    if (rooms.has(room.code)) broadcast(room, { t: 'room', title: room.title, playlist: room.playlist });
  });
}

/* ================================================================== */
/* 정적 파일                                                           */
/* ================================================================== */

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/stat') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ rooms: rooms.size, users: totalUsers(), cap: ROOM_CAP }));
    return;
  }
  const target = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!target.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(target, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('없는 길입니다.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
});

/* ================================================================== */
/* 최소 구현 WebSocket (RFC6455)                                       */
/* ================================================================== */

const MAX_FRAME = 200 * 1024;

function encodeFrame(payload, opcode) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | (opcode === undefined ? 0x1 : opcode);
  return Buffer.concat([head, data]);
}

function Conn(socket) {
  this.socket = socket;
  this.buf = Buffer.alloc(0);
  this.fragOp = 0;
  this.frags = [];
  this.alive = true;
}
Conn.prototype.send = function (obj) {
  if (!this.alive) return;
  try { this.socket.write(encodeFrame(typeof obj === 'string' ? obj : JSON.stringify(obj), 0x1)); }
  catch (e) { this.close(); }
};
Conn.prototype.close = function () {
  if (!this.alive) return;
  this.alive = false;
  try { this.socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch (e) { /* ignore */ }
  try { this.socket.end(); } catch (e) { /* ignore */ }
};
Conn.prototype.feed = function (chunk, onMessage) {
  this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
  for (;;) {
    const b = this.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) {
      if (b.length < 10) return;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(MAX_FRAME)) { this.close(); return; }
      len = Number(big); off = 10;
    }
    if (len > MAX_FRAME) { this.close(); return; }
    let mask = null;
    if (masked) { if (b.length < off + 4) return; mask = b.slice(off, off + 4); off += 4; }
    if (b.length < off + len) return;
    const payload = Buffer.from(b.slice(off, off + len));
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    this.buf = b.slice(off + len);

    if (opcode === 0x8) { this.close(); return; }
    if (opcode === 0x9) { try { this.socket.write(encodeFrame(payload, 0xA)); } catch (e) { /* ignore */ } continue; }
    if (opcode === 0xA) continue;
    if (opcode === 0x0) {
      this.frags.push(payload);
      if (fin) {
        const full = Buffer.concat(this.frags);
        this.frags = [];
        if (this.fragOp === 0x1) onMessage(full.toString('utf8'));
      }
      continue;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      if (!fin) { this.fragOp = opcode; this.frags = [payload]; continue; }
      if (opcode === 0x1) onMessage(payload.toString('utf8'));
    }
  }
};

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  handleSocket(socket);
});

/* ================================================================== */
/* 방                                                                  */
/* ================================================================== */

const rooms = new Map();      // code -> room
const sockets = new Set();    // 로비에 있는 사람 포함 전체 연결
let nextUserId = 1;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자 제외

function makeCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function clean(s, max) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c === 0x7f) { out += ' '; continue; }
    if (c >= 0x200b && c <= 0x200f) continue;
    if (c >= 0x202a && c <= 0x202e) continue;
    if (c === 0x2028 || c === 0x2029 || c === 0xfeff) continue;
    out += ch;
  }
  out = out.replace(/[ \t]+/g, ' ').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function totalUsers() {
  let n = 0;
  for (const r of rooms.values()) n += r.users.size;
  return n;
}

function broadcast(room, obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const u of room.users.values()) if (u.id !== exceptId) u.conn.send(msg);
}

function roomSummary(r) {
  const cur = r.playlist[r.idx];
  const host = r.users.get(r.hostId);
  return {
    code: r.code,
    title: r.title,
    host: host ? host.name : '—',
    n: r.users.size,
    cap: ROOM_CAP,
    playing: r.playing,
    now: cur ? (cur.title || cur.id) : '',
    count: r.playlist.length
  };
}

function lobbyList() {
  const list = [];
  for (const r of rooms.values()) list.push(roomSummary(r));
  list.sort((a, b) => b.n - a.n);
  return list;
}

function pushLobby() {
  const msg = JSON.stringify({ t: 'rooms', list: lobbyList() });
  for (const s of sockets) if (!s.user || !s.user.room) s.conn.send(msg);
}

function roomPayload(r) {
  return {
    code: r.code, title: r.title, hostId: r.hostId, cap: ROOM_CAP,
    playlist: r.playlist, idx: r.idx,
    playing: r.playing, position: currentPosition(r), serverNow: Date.now()
  };
}

/* 지금 이 순간의 재생 위치 (초) */
function currentPosition(r) {
  if (!r.playing) return r.position;
  return r.position + (Date.now() - r.updatedAt) / 1000;
}

function setPlayback(r, patch) {
  if (patch.idx !== undefined) r.idx = patch.idx;
  if (patch.position !== undefined) r.position = Math.max(0, patch.position);
  if (patch.playing !== undefined) r.playing = !!patch.playing;
  r.updatedAt = Date.now();
  broadcast(r, {
    t: 'play', idx: r.idx, playing: r.playing,
    position: r.position, serverNow: r.updatedAt
  });
}

function leaveRoom(user) {
  const r = user.room;
  if (!r) return;
  r.users.delete(user.id);
  user.room = null;
  if (r.users.size === 0) {
    rooms.delete(r.code);
    console.log('  방이 비어 닫혔습니다. [' + r.code + '] ' + r.title);
  } else {
    if (r.hostId === user.id) {
      // 가장 오래 있던 사람에게 방장을 넘긴다
      let next = null;
      for (const u of r.users.values()) if (!next || u.joinedAt < next.joinedAt) next = u;
      r.hostId = next.id;
      broadcast(r, { t: 'host', id: r.hostId, name: next.name });
    }
    broadcast(r, { t: 'user-', id: user.id, name: user.name });
  }
  pushLobby();
}

/* ================================================================== */
/* 연결 처리                                                           */
/* ================================================================== */

function handleSocket(socket) {
  const conn = new Conn(socket);
  const entry = { conn: conn, user: null };
  sockets.add(entry);

  let msgCount = 0, windowStart = Date.now();

  const drop = () => {
    if (entry.user) leaveRoom(entry.user);
    sockets.delete(entry);
    conn.alive = false;
  };

  socket.on('data', (chunk) => {
    try {
      conn.feed(chunk, (text) => {
        const now = Date.now();
        if (now - windowStart > 1000) { windowStart = now; msgCount = 0; }
        if (++msgCount > 120) { conn.close(); return; }

        let m;
        try { m = JSON.parse(text); } catch (e) { return; }
        if (!m || typeof m.t !== 'string') return;
        handleMessage(entry, m, now);
      });
    } catch (e) { conn.close(); }
  });

  socket.on('close', drop);
  socket.on('end', drop);
  socket.on('error', drop);

  conn.send({ t: 'rooms', list: lobbyList() });
}

function handleMessage(entry, m, now) {
  const conn = entry.conn;
  const user = entry.user;

  /* ---- 로비 ---- */
  if (m.t === 'rooms') { conn.send({ t: 'rooms', list: lobbyList() }); return; }

  if (m.t === 'create') {
    if (user && user.room) return;
    if (rooms.size >= MAX_ROOMS) { conn.send({ t: 'err', msg: '방이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }); return; }
    const name = clean(m.name, 12) || '익명';
    const title = clean(m.title, 40) || (name + '의 방');
    const refs = parseLinks(m.links);
    if (!refs.length) { conn.send({ t: 'err', msg: '유튜브 링크를 하나 이상 넣어 주세요.' }); return; }

    const hasList = refs.some((r) => r.kind === 'list');
    if (hasList) conn.send({ t: 'busy', msg: '재생목록을 펼치는 중…' });

    resolveLinks(m.links).then((res) => {
      if (!conn.alive) return;
      if (entry.user && entry.user.room) return;          // 그 사이 다른 방에 들어갔으면 무시
      if (!res.items.length) {
        conn.send({ t: 'err', msg: '재생목록에서 영상을 찾지 못했습니다. 공개 재생목록인지 확인해 주세요.' });
        return;
      }
      if (rooms.size >= MAX_ROOMS) { conn.send({ t: 'err', msg: '방이 너무 많습니다.' }); return; }
      const code = makeCode();
      if (!code) { conn.send({ t: 'err', msg: '방 코드를 만들지 못했습니다.' }); return; }

      const room = {
        code: code, title: title, hostId: 0, createdAt: Date.now(),
        playlist: res.items,
        idx: 0, playing: false, position: 0, updatedAt: Date.now(),
        users: new Map()
      };
      rooms.set(code, room);
      const u = admit(entry, room, name);
      room.hostId = u.id;
      conn.send({ t: 'joined', you: u.id, host: room.hostId, room: roomPayload(room), users: userList(room) });
      if (res.truncated) conn.send({ t: 'info', msg: '재생목록이 길어 ' + MAX_PLAYLIST + '곡까지만 담았습니다.' });
      hydrateTitles(room);
      pushLobby();
      console.log('  방 생성 [' + code + '] ' + title + ' / ' + res.items.length + '곡 / 방장 ' + name);
    });
    return;
  }

  if (m.t === 'join') {
    if (user && user.room) return;
    const code = clean(m.code, 8).toUpperCase();
    const room = rooms.get(code);
    if (!room) { conn.send({ t: 'err', msg: '그런 방이 없습니다. 코드를 확인해 주세요.' }); return; }
    if (room.users.size >= ROOM_CAP) { conn.send({ t: 'err', msg: '방이 가득 찼습니다. (' + ROOM_CAP + '명)' }); return; }
    const name = clean(m.name, 12) || '익명';
    const u = admit(entry, room, name);
    conn.send({ t: 'joined', you: u.id, host: room.hostId, room: roomPayload(room), users: userList(room) });
    broadcast(room, { t: 'user+', user: pubUser(u) }, u.id);
    pushLobby();
    return;
  }

  if (!user || !user.room) return;
  const room = user.room;
  const isHost = room.hostId === user.id;

  /* ---- 방 안 ---- */
  switch (m.t) {
    case 'leave':
      leaveRoom(user);
      entry.user = null;
      conn.send({ t: 'left' });
      conn.send({ t: 'rooms', list: lobbyList() });
      return;

    case 'm':
      user.x = clampNum(m.x, -2000, 4000);
      user.y = clampNum(m.y, -2000, 4000);
      user.dir = clampNum(m.dir, -10, 10);
      user.st = (m.st | 0) & 3;
      user.h = clampNum(m.h, 0, 400);          // 점프 높이 (cm)
      return;

    case 'chat': {
      if (now - user.lastChat < 500) return;
      const txt = clean(m.txt, 120);
      if (!txt) return;
      user.lastChat = now;
      broadcast(room, { t: 'chat', id: user.id, name: user.name, txt: txt });
      return;
    }

    case 'arrow': {
      if (now - user.lastArrow < 220) return;
      user.lastArrow = now;
      // 쏜 사람이 계산한 '맞은 지점'을 그대로 중계한다 — 모두 같은 자리에 꽂힌다
      broadcast(room, {
        t: 'arrow', id: user.id,
        ox: clampNum(m.ox, -4000, 4000), oy: clampNum(m.oy, -1000, 4000), oz: clampNum(m.oz, -4000, 4000),
        hx: clampNum(m.hx, -4000, 4000), hy: clampNum(m.hy, -1000, 4000), hz: clampNum(m.hz, -4000, 4000),
        nx: clampNum(m.nx, -1000, 1000), ny: clampNum(m.ny, -1000, 1000), nz: clampNum(m.nz, -1000, 1000),
        pid: m.pid | 0
      });
      return;
    }

    /* ---- 방장 전용 ---- */
    case 'ctrl': {
      if (!isHost) { conn.send({ t: 'err', msg: '방장만 재생을 조작할 수 있습니다.' }); return; }
      const op = String(m.op || '');
      if (op === 'play') setPlayback(room, { playing: true, position: clampNum(m.v, 0, 86400) });
      else if (op === 'pause') setPlayback(room, { playing: false, position: clampNum(m.v, 0, 86400) });
      else if (op === 'seek') setPlayback(room, { position: clampNum(m.v, 0, 86400) });
      else if (op === 'track') {
        const i = m.v | 0;
        if (i >= 0 && i < room.playlist.length) setPlayback(room, { idx: i, position: 0, playing: true });
      } else if (op === 'next' || op === 'ended') {
        if (room.playlist.length) {
          const i = (room.idx + 1) % room.playlist.length;
          setPlayback(room, { idx: i, position: 0, playing: true });
        }
      } else if (op === 'prev') {
        if (room.playlist.length) {
          const i = (room.idx - 1 + room.playlist.length) % room.playlist.length;
          setPlayback(room, { idx: i, position: 0, playing: true });
        }
      }
      pushLobby();
      return;
    }

    case 'sync': {
      // 방장의 실제 재생 위치로 드리프트를 보정한다
      if (!isHost) return;
      const pos = clampNum(m.pos, 0, 86400);
      if (Math.abs(pos - currentPosition(room)) > 1.2) {
        setPlayback(room, { position: pos });
      } else {
        room.position = pos; room.updatedAt = Date.now();
      }
      return;
    }

    case 'settings': {
      if (!isHost) { conn.send({ t: 'err', msg: '방장만 설정을 바꿀 수 있습니다.' }); return; }
      const title = clean(m.title, 40);
      if (title) room.title = title;
      if (typeof m.links === 'string' && parseLinks(m.links).length) {
        if (parseLinks(m.links).some((r) => r.kind === 'list')) {
          conn.send({ t: 'busy', msg: '재생목록을 펼치는 중…' });
        }
        resolveLinks(m.links).then((res) => {
          if (!rooms.has(room.code) || room.hostId !== user.id) return;
          if (!res.items.length) { conn.send({ t: 'err', msg: '재생목록에서 영상을 찾지 못했습니다.' }); return; }
          const keep = new Map(room.playlist.map((it) => [it.id, it]));
          const curId = room.playlist[room.idx] ? room.playlist[room.idx].id : null;
          room.playlist = res.items.map((it) => keep.get(it.id) || it);
          const at = room.playlist.findIndex((it) => it.id === curId);
          room.idx = at >= 0 ? at : 0;
          if (at < 0) setPlayback(room, { idx: 0, position: 0, playing: false });
          if (res.truncated) conn.send({ t: 'info', msg: '재생목록이 길어 ' + MAX_PLAYLIST + '곡까지만 담았습니다.' });
          hydrateTitles(room);
          broadcast(room, { t: 'room', title: room.title, playlist: room.playlist });
          pushLobby();
        });
        broadcast(room, { t: 'room', title: room.title, playlist: room.playlist });
        return;
      }
      broadcast(room, { t: 'room', title: room.title, playlist: room.playlist });
      pushLobby();
      return;
    }
  }
}

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n < lo ? lo : (n > hi ? hi : n);
}

function admit(entry, room, name) {
  const u = {
    id: nextUserId++, name: name, conn: entry.conn, room: room,
    x: 600 + (Math.random() - 0.5) * 240, y: 760 + (Math.random() - 0.5) * 80,
    dir: -Math.PI / 2, st: 0, h: 0, joinedAt: Date.now(),
    lastChat: 0, lastArrow: 0
  };
  room.users.set(u.id, u);
  entry.user = u;
  return u;
}

const pubUser = (u) => ({ id: u.id, name: u.name, x: Math.round(u.x), y: Math.round(u.y) });
const userList = (r) => Array.from(r.users.values()).map(pubUser);

/* 위치 브로드캐스트 */
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.users.size) continue;
    const arr = [];
    for (const u of r.users.values()) {
      arr.push([u.id, Math.round(u.x), Math.round(u.y), Math.round(u.dir * 100) / 100, u.st, u.name, Math.round(u.h || 0)]);
    }
    const msg = JSON.stringify({ t: 's', u: arr });
    for (const u of r.users.values()) u.conn.send(msg);
  }
}, TICK_MS);

/* 로비 목록 갱신 + 연결 확인 */
setInterval(() => {
  pushLobby();
  for (const s of sockets) {
    try { s.conn.socket.write(encodeFrame(Buffer.alloc(0), 0x9)); } catch (e) { s.conn.close(); }
  }
}, 15000);

server.listen(PORT, () => {
  console.log('');
  console.log('  [ 위치 WEECH — 유튜브를 같이 보는 3D 라운지 ]');
  console.log('  ----------------------------------------');
  console.log('  문이 열렸습니다 :  http://localhost:' + PORT);
  console.log('  방 정원 ' + ROOM_CAP + '명 · 최대 ' + MAX_ROOMS + '개 방');
  console.log('');
});
