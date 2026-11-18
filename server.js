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
const GRACE_MS = 30000;     // 연결이 끊겨도 자리를 지켜주는 시간 (새로고침 복구용)
const MAX_SEATS = 200;      // 좌석 번호 상한 (roomdef 의 좌석 수보다 넉넉히)
const KICK_BAN_MS = 5 * 60 * 1000;   // 내보낸 사람이 같은 자리로 되돌아오지 못하는 시간
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

/* 믹스(라디오)인가 — RD… 로 시작하는 목록은 유튜브가 자동 생성하는 무한 재생목록이다.
 * 진짜 재생목록(PL·OL·FL·LL…)과 달리 고정된 곡 목록이 없다. */
function isMixList(id) {
  return /^RD/.test(String(id || ''));
}

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

const listCache = new Map();    // listId|seed -> { items:[{id,title}], ok }

// youtube.com 웹이 내부적으로 쓰는 InnerTube 키(공개 상수 — API 키 발급 불필요)
const YT_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const YT_CTX = { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'ko' } };

/* InnerTube /next — 재생목록 패널을 통째로 받는다 (제목까지, 최대 ~200곡 한 번에).
 * YouTube 가 재생목록 페이지를 클라이언트 렌더링으로 바꿔 HTML 긁기가 깨진 뒤의 정식 경로. */
async function expandViaInnerTube(ref) {
  const body = { context: YT_CTX, playlistId: ref.list };
  if (ref.seed) body.videoId = ref.seed;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  let j;
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/next?key=' + YT_KEY, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'accept-language': 'ko' },
      body: JSON.stringify(body)
    });
    if (!r.ok) return [];
    j = await r.json();
  } catch (e) { return []; } finally { clearTimeout(timer); }

  const panel = j && j.contents && j.contents.twoColumnWatchNextResults
    && j.contents.twoColumnWatchNextResults.playlist
    && j.contents.twoColumnWatchNextResults.playlist.playlist;
  const contents = (panel && panel.contents) || [];
  const seen = new Set();
  const list = [];
  for (const c of contents) {
    const v = c && c.playlistPanelVideoRenderer;
    if (!v || !v.videoId || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    let title = '';
    if (v.title) title = v.title.simpleText || (v.title.runs || []).map((x) => x.text).join('');
    list.push({ id: v.videoId, title: String(title).slice(0, 120) });
    if (list.length >= MAX_PLAYLIST) break;
  }
  return list;
}

/* 재생목록을 펼친다 — API 키 없이. 먼저 InnerTube, 실패하면 공개 페이지 긁기.
 *  돌려주는 값: { items, ok }
 *  ok=false 면 목록 자체를 못 읽어 씨앗 영상 한 곡으로 때운 것이다.
 *  (비공개·일부공개 재생목록은 로그인 없이는 읽을 수 없다 — 쓰는 사람에게 알려야 한다) */
async function expandPlaylist(ref) {
  const key = ref.list + '|' + (ref.seed || '');
  if (listCache.has(key)) return listCache.get(key);

  const save = (items, ok, ttl) => {
    const got = { items: items, ok: ok };
    listCache.set(key, got);
    if (ttl) setTimeout(() => listCache.delete(key), ttl);
    return got;
  };

  // 믹스(RD…)는 고정된 목록이 아니다. 유튜브가 씨앗 영상을 기준으로 호출할 때마다
  // 새로 만들어내는 무한 라디오(isInfinite)라, 같은 링크라도 곡 구성과 순서가 매번 다르다.
  // 공유한 사람이 들려주려던 건 씨앗 영상 한 곡이므로 그것만 담는다.
  if (isMixList(ref.list) && ref.seed) {
    return save([{ id: ref.seed, title: '' }], true, 0);   // 일부러 한 곡 — 실패가 아니다
  }

  // 1순위: InnerTube /next (제목 포함, 순서 유지)
  const via = await expandViaInnerTube(ref);
  if (via.length) {
    // 씨앗 영상이 있으면 그 곡부터
    if (ref.seed) {
      const at = via.findIndex((it) => it.id === ref.seed);
      if (at > 0) via.unshift(via.splice(at, 1)[0]);
      else if (at < 0) via.unshift({ id: ref.seed, title: '' });
    }
    return save(via, true, 10 * 60 * 1000);
  }

  // 2순위: 믹스(RD…)는 목록 페이지가 비어 있다. 씨앗 영상의 시청 페이지에서만 목록이 만들어진다.
  const urls = [];
  if (ref.seed) urls.push('https://www.youtube.com/watch?v=' + ref.seed + '&list=' + ref.list);
  urls.push('https://www.youtube.com/playlist?list=' + ref.list);

  for (const url of urls) {
    const isWatch = url.indexOf('/watch?') >= 0;
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
      if (!items.length && !isWatch) {
        // 마지막 수단 — 재생목록 페이지에 한해서만. 그 페이지의 videoId 는 목록 자체다.
        //
        // 시청 페이지에는 절대 쓰지 않는다. 유튜브가 재생목록 패널을 클라이언트에서
        // 그리도록 바꾼 뒤로, 시청 페이지 HTML 에 남은 videoId 는 전부 '추천 영상'
        // (secondaryResults) 이다. 실제로 세어 보면 49개가 모두 추천이었다.
        // 그걸 담으면 내 재생목록 대신 남의 추천이 들어간다.
        //
        // 재생목록 페이지에는 지금 추천 묶음이 없지만, 언제 생겨도 새지 않도록
        // 추천 묶음이 시작되는 자리에서 잘라내고 그 앞쪽만 훑는다.
        const cut = ['"secondaryResults"', '"watchNextEndScreenRenderer"']
          .map((k) => html.indexOf(k)).filter((i) => i > 0);
        const body = cut.length ? html.slice(0, Math.min.apply(null, cut)) : html;
        const ids = [...new Set([...body.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]))];
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
      // 아무것도 못 얻었으면 다음 후보 URL 로. 여기서 씨앗을 먼저 끼워 넣으면
      // '한 곡짜리 목록' 이 되어 성공으로 기록되고, 못 펼쳤다는 사실이 묻힌다.
      if (!list.length) continue;
      // 씨앗 영상이 있으면 그 곡부터 — 링크를 공유한 사람이 들려주려던 곡이다
      if (ref.seed) {
        const at = list.findIndex((it) => it.id === ref.seed);
        if (at > 0) list.unshift(list.splice(at, 1)[0]);
        else if (at < 0) list.unshift({ id: ref.seed, title: '' });
      }
      return save(list, true, 10 * 60 * 1000);                      // 10분 뒤 잊는다
    } catch (e) { /* 다음 후보 URL 로 */ }
  }
  // 목록을 못 읽었다. 씨앗이라도 있으면 그 한 곡이라도 담되, 실패로 표시한다.
  // 짧게만 기억한다 — 비공개 재생목록을 공개로 바꾸고 다시 넣는 일이 흔하다.
  return save(ref.seed ? [{ id: ref.seed, title: '' }] : [], false, 60 * 1000);
}

/* 재생목록을 못 펼쳤을 때 보여줄 안내 */
function listNote(n) {
  return '재생목록 ' + n + '개를 펼치지 못했습니다 — 지금은 링크에 들어 있던 영상만 담았습니다. ' +
    '유튜브가 잠시 응답하지 않았을 수 있으니 잠시 뒤 다시 넣어 보세요. ' +
    '계속 안 되면 비공개(나만 보기) 목록일 수 있습니다 — 공개 범위를 "공개" 나 "일부공개" 로 바꿔 주세요.';
}

/* 믹스를 한 곡으로 줄였을 때 보여줄 안내 */
function mixNote(n) {
  return '믹스(RD…) 링크 ' + n + '개는 유튜브가 매번 새로 만드는 목록이라 ' +
    '공유한 영상 한 곡만 담았습니다. 순서를 지키려면 PL… 재생목록 링크를 써 주세요.';
}

/* 링크 뭉치 → 적힌 순서 그대로의 재생목록 */
async function resolveLinks(text) {
  const refs = parseLinks(text);
  const seen = new Set();
  const out = [];
  let truncated = false;
  let mixes = 0;
  let failed = 0;
  for (const ref of refs) {
    if (ref.kind === 'list' && isMixList(ref.list) && ref.seed) mixes++;
    let items;
    if (ref.kind === 'video') items = [{ id: ref.id, title: '' }];
    else {
      const got = await expandPlaylist(ref);
      items = got.items;
      if (!got.ok) failed++;
    }
    for (const it of items) {
      if (seen.has(it.id)) continue;
      if (out.length >= MAX_PLAYLIST) { truncated = true; break; }
      seen.add(it.id);
      out.push({ id: it.id, title: it.title || '', author: '' });
    }
    if (out.length >= MAX_PLAYLIST) { truncated = true; break; }
  }
  return { items: out, truncated: truncated, mixes: mixes, failed: failed };
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

/* 유예 중인 사람의 자리에 꽂아두는 빈 연결 — broadcast 가 그냥 지나가게 한다 */
const DEAD_CONN = { alive: false, send: function () {}, close: function () {} };

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

/* 들어온 사람에게 지어 주는 이름 — 로비에서 닉네임을 묻지 않는다.
 * 같은 방 안에서 겹치지 않게 고르고, 들어온 뒤에 본인이 바꿀 수 있다. */
const NICK_ADJ = ['졸린', '신난', '느긋한', '조용한', '수줍은', '용감한', '엉뚱한', '나른한',
  '상냥한', '씩씩한', '새침한', '덤덤한', '귀여운', '심심한', '발랄한', '점잖은'];
const NICK_NOUN = ['수달', '너구리', '고라니', '부엉이', '해달', '다람쥐', '고슴도치', '펭귄',
  '물범', '여우', '두더지', '담비', '까치', '햄스터', '알파카', '청설모'];

function randomName(room) {
  const taken = new Set();
  if (room) for (const u of room.users.values()) taken.add(u.name);
  for (let i = 0; i < 60; i++) {
    const n = NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)] + ' ' +
      NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)];
    if (!taken.has(n)) return n;
  }
  return '손님' + (100 + Math.floor(Math.random() * 900));
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

/* 유예 중(연결 끊김)이 아닌 실제 접속자 수 */
function liveCount(r) {
  let n = 0;
  for (const u of r.users.values()) if (!u.gone) n++;
  return n;
}

function totalUsers() {
  let n = 0;
  for (const r of rooms.values()) n += liveCount(r);
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
    n: liveCount(r),
    cap: ROOM_CAP,
    playing: r.playing,
    now: cur ? (cur.title || cur.id) : '',
    count: r.playlist.length
  };
}

function lobbyList() {
  const list = [];
  for (const r of rooms.values()) if (liveCount(r)) list.push(roomSummary(r));
  list.sort((a, b) => b.n - a.n);
  return list;
}

function pushLobby() {
  const msg = JSON.stringify({ t: 'rooms', list: lobbyList() });
  for (const s of sockets) if (!s.user || !s.user.room) s.conn.send(msg);
}

function roomPayload(r) {
  return {
    code: r.code, title: r.title, hostId: r.hostId, coHosts: Array.from(r.coHosts || []), cap: ROOM_CAP,
    playlist: r.playlist, idx: r.idx,
    playing: r.playing, position: currentPosition(r), serverNow: Date.now(),
    karaoke: !!r.karaoke
  };
}

/* 재생·설정을 조작할 수 있는 사람 = 방장 또는 부방장 */
function privileged(r, user) {
  return user && (r.hostId === user.id || (r.coHosts && r.coHosts.has(user.id)));
}

/* 역할(방장·부방장) 변경을 방 전원에게 알린다 */
function broadcastRoles(r) {
  broadcast(r, { t: 'roles', hostId: r.hostId, coHosts: Array.from(r.coHosts || []) });
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

/* ---- 영화관 좌석 ------------------------------------------------
 *  한 자리에 한 사람만. 누가 어디 앉았는지는 서버가 쥐고 있어야
 *  두 사람이 같은 의자를 동시에 집는 일이 없다.
 * ------------------------------------------------------------------ */
function sit(room, user, i) {
  if (!(i >= 0 && i < MAX_SEATS)) return false;
  if (user.seat === i) return true;
  for (const u of room.users.values()) if (u.seat === i) return false;   // 이미 앉은 사람이 있다
  user.seat = i;
  broadcast(room, { t: 'seat', id: user.id, seat: i });
  return true;
}

function stand(room, user) {
  if (user.seat < 0) return;
  user.seat = -1;
  broadcast(room, { t: 'seat', id: user.id, seat: -1 });
}

/* 지금 누가 어느 자리에 앉아 있는지 — 들어온 사람에게 한 번에 알려준다 */
function seatMap(r) {
  const out = {};
  for (const u of r.users.values()) if (u.seat >= 0) out[u.id] = u.seat;
  return out;
}

/* 소켓이 끊겼다 — 바로 내보내지 않고 GRACE_MS 동안 자리를 지켜준다.
 * 새로고침하면 같은 토큰으로 돌아와 자리·방장 권한까지 그대로 복구된다. */
function markGone(user) {
  const r = user.room;
  if (!r || user.gone) return;
  user.gone = Date.now();
  user.conn = DEAD_CONN;                       // 유예 중에는 보낼 곳이 없다
  clearTimeout(user.graceTimer);
  user.graceTimer = setTimeout(() => {
    if (user.gone) leaveRoom(user);            // 끝내 안 돌아왔다 — 이제 진짜 퇴장
  }, GRACE_MS);
  broadcast(r, { t: 'gone', id: user.id, name: user.name, on: true });
  pushLobby();
}

/* 유예 중이던 사람이 돌아왔다 */
function restore(entry, user) {
  const r = user.room;
  clearTimeout(user.graceTimer);
  user.graceTimer = null;
  user.gone = 0;
  user.conn = entry.conn;
  entry.user = user;
  broadcast(r, { t: 'gone', id: user.id, name: user.name, on: false }, user.id);
  pushLobby();
}

function leaveRoom(user) {
  const r = user.room;
  if (!r) return;
  user.mic = false; user.mmute = false;
  clearTimeout(user.graceTimer);
  user.graceTimer = null;
  user.gone = 0;
  if (user.seat >= 0) { user.seat = -1; broadcast(r, { t: 'seat', id: user.id, seat: -1 }); }
  r.users.delete(user.id);
  if (r.coHosts) r.coHosts.delete(user.id);
  user.room = null;
  if (r.users.size === 0) {
    rooms.delete(r.code);
    console.log('  방이 비어 닫혔습니다. [' + r.code + '] ' + r.title);
  } else {
    if (r.hostId === user.id) {
      // 부방장이 있으면 그 중 가장 오래 있던 사람, 없으면 전체에서 가장 오래 있던 사람에게 넘긴다
      let next = null;
      for (const u of r.users.values()) {
        if (!r.coHosts.has(u.id)) continue;
        if (!next || u.joinedAt < next.joinedAt) next = u;
      }
      if (!next) for (const u of r.users.values()) if (!next || u.joinedAt < next.joinedAt) next = u;
      r.hostId = next.id;
      r.coHosts.delete(next.id);
      broadcast(r, { t: 'host', id: r.hostId, name: next.name });
      broadcastRoles(r);
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
    if (entry.user) markGone(entry.user);      // 새로고침일 수 있으니 자리를 남겨둔다
    entry.user = null;
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
    const name = clean(m.name, 12) || randomName(null);
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
        code: code, title: title, hostId: 0, coHosts: new Set(), createdAt: Date.now(),
        kicked: new Map(),               // 재입장 토큰 -> 언제까지 막을지
        playlist: res.items,
        idx: 0, playing: false, position: 0, updatedAt: Date.now(),
        karaoke: false,                  // 노래방 모드 (방장만 켠다)
        users: new Map()
      };
      rooms.set(code, room);
      const u = admit(entry, room, name);
      room.hostId = u.id;
      conn.send({ t: 'joined', you: u.id, name: u.name, token: u.token, host: room.hostId, room: roomPayload(room), users: userList(room) });
      if (res.truncated) conn.send({ t: 'info', msg: '재생목록이 길어 ' + MAX_PLAYLIST + '곡까지만 담았습니다.' });
      if (res.mixes) conn.send({ t: 'info', msg: mixNote(res.mixes) });
      if (res.failed) conn.send({ t: 'info', msg: listNote(res.failed) });
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
    if (!room) {
      // 토큰을 들고 왔는데 방이 없다 — 유예가 지났거나 서버가 다시 떴다
      conn.send(m.token
        ? { t: 'err', msg: '있던 방이 닫혔습니다.', stale: true }
        : { t: 'err', msg: '그런 방이 없습니다. 코드를 확인해 주세요.' });
      return;
    }

    // 새로고침 복구 — 유예 중인 내 자리가 남아 있으면 그대로 돌아간다
    if (m.token) {
      const until = room.kicked.get(m.token);
      if (until !== undefined) {
        if (until > Date.now()) {
          conn.send({ t: 'err', msg: '이 방에서 내보내졌습니다.', stale: true });
          return;
        }
        room.kicked.delete(m.token);     // 기한이 지났다
      }
      let prev = null;
      for (const p of room.users.values()) if (p.gone && p.token === m.token) { prev = p; break; }
      if (prev) {
        restore(entry, prev);
        conn.send({ t: 'joined', you: prev.id, name: prev.name, token: prev.token, host: room.hostId, room: roomPayload(room), users: userList(room), seats: seatMap(room) });
        return;
      }
      conn.send({ t: 'err', msg: '자리가 이미 정리되었습니다.', stale: true });
      return;
    }

    if (room.users.size >= ROOM_CAP) { conn.send({ t: 'err', msg: '방이 가득 찼습니다. (' + ROOM_CAP + '명)' }); return; }
    const name = clean(m.name, 12) || randomName(room);
    const u = admit(entry, room, name);
    conn.send({ t: 'joined', you: u.id, name: u.name, token: u.token, host: room.hostId, room: roomPayload(room), users: userList(room), seats: seatMap(room) });
    broadcast(room, { t: 'user+', user: pubUser(u) }, u.id);
    pushLobby();
    return;
  }

  if (!user || !user.room) return;
  const room = user.room;
  const isHost = room.hostId === user.id;        // 방장 본인 (역할 변경 권한)
  const canCtl = privileged(room, user);         // 방장 또는 부방장 (재생·설정 권한)

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
      user.hy = clampNum(m.hy, -2, 2);         // 고개 좌우 (시선)
      user.hp = clampNum(m.hp, -2, 2);         // 고개 상하 (시선)
      return;

    case 'sit':
      if (!sit(room, user, m.i | 0)) conn.send({ t: 'seatno', i: m.i | 0 });
      return;

    case 'stand':
      stand(room, user);
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

    /* ---- 노래방 ------------------------------------------------------
     *  방장만 켜고 끈다. 켜지면 천장에 미러볼이 내려오고, 서로의 목소리를
     *  주고받을 수 있게 된다. 목소리 자체는 브라우저끼리 직접(P2P) 오가고,
     *  서버는 그 연결을 맺는 쪽지(rtc)만 중계한다 — 음성은 서버를 지나지 않는다.
     * ------------------------------------------------------------------ */
    case 'karaoke': {
      if (!isHost) { conn.send({ t: 'err', msg: '방장만 노래방 모드를 켤 수 있습니다.' }); return; }
      const on = !!m.on;
      if (room.karaoke === on) return;
      room.karaoke = on;
      if (!on) {
        // 끌 때는 모두의 마이크를 내린다 — 켜 둔 채로 다음 모드까지 새지 않게
        for (const u of room.users.values()) { u.mic = false; u.mmute = false; }
      }
      broadcast(room, { t: 'karaoke', on: on, by: user.name });
      return;
    }

    case 'mic': {
      if (!room.karaoke) return;
      const on = !!m.on;
      // 잠겼다는 사실은 쿨다운보다 먼저 알린다 — 연타 가드가 이 알림을 삼키면
      // 누른 사람은 왜 안 켜지는지 알 수 없다
      if (on && user.mmute) { conn.send({ t: 'err', msg: '방장이 회원님의 마이크를 꺼 두었습니다.' }); return; }
      if (user.mic === on) return;
      if (now - user.lastMic < 400) return;      // 연타로 재협상이 쏟아지지 않게
      user.lastMic = now;
      user.mic = on;
      broadcast(room, { t: 'mic', id: user.id, on: on });
      return;
    }

    case 'micmute': {
      if (!isHost) { conn.send({ t: 'err', msg: '방장만 남의 마이크를 끌 수 있습니다.' }); return; }
      const target = room.users.get(m.id | 0);
      if (!target || target.id === user.id) return;
      const on = !!m.on;                          // on = 잠근다
      if (target.mmute === on) return;
      target.mmute = on;
      if (on && target.mic) {
        target.mic = false;
        broadcast(room, { t: 'mic', id: target.id, on: false });
      }
      broadcast(room, { t: 'micmute', id: target.id, on: on, name: target.name });
      return;
    }

    /* 연결용 쪽지 중계 — 내용은 들여다보지 않고 받는 사람에게만 넘긴다 */
    case 'rtc': {
      if (!room.karaoke) return;
      const target = room.users.get(m.to | 0);
      if (!target || target.id === user.id || target.gone) return;
      target.conn.send({ t: 'rtc', from: user.id, data: m.data });
      return;
    }

    /* 이름 바꾸기 — 자기 이름만. 로비에서 닉네임을 묻지 않으므로
     * 지어 받은 이름이 마음에 안 들면 참여자 목록에서 고친다. */
    case 'rename': {
      if (now - user.lastRename < 800) return;
      const nm = clean(m.name, 12);
      if (!nm || nm === user.name) return;
      for (const u of room.users.values()) {
        if (u !== user && u.name === nm) {
          conn.send({ t: 'err', msg: '같은 이름을 쓰는 사람이 있습니다.' });
          return;
        }
      }
      user.lastRename = now;
      const was = user.name;
      user.name = nm;
      broadcast(room, { t: 'rename', id: user.id, was: was, name: nm });
      pushLobby();                 // 방장 이름이 로비 목록에 보인다
      return;
    }

    /* ---- 방장·부방장 전용 ---- */
    case 'ctrl': {
      if (!canCtl) { conn.send({ t: 'err', msg: '방장·부방장만 재생을 조작할 수 있습니다.' }); return; }
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
      if (!canCtl) { conn.send({ t: 'err', msg: '방장·부방장만 설정을 바꿀 수 있습니다.' }); return; }
      const title = clean(m.title, 40);
      if (title) room.title = title;
      if (typeof m.links === 'string' && parseLinks(m.links).length) {
        if (parseLinks(m.links).some((r) => r.kind === 'list')) {
          conn.send({ t: 'busy', msg: '재생목록을 펼치는 중…' });
        }
        resolveLinks(m.links).then((res) => {
          if (!rooms.has(room.code) || !privileged(room, user)) return;
          if (!res.items.length) { conn.send({ t: 'err', msg: '재생목록에서 영상을 찾지 못했습니다.' }); return; }
          const keep = new Map(room.playlist.map((it) => [it.id, it]));
          const curId = room.playlist[room.idx] ? room.playlist[room.idx].id : null;
          room.playlist = res.items.map((it) => keep.get(it.id) || it);
          const at = room.playlist.findIndex((it) => it.id === curId);
          room.idx = at >= 0 ? at : 0;
          if (at < 0) setPlayback(room, { idx: 0, position: 0, playing: false });
          if (res.truncated) conn.send({ t: 'info', msg: '재생목록이 길어 ' + MAX_PLAYLIST + '곡까지만 담았습니다.' });
          if (res.mixes) conn.send({ t: 'info', msg: mixNote(res.mixes) });
          if (res.failed) conn.send({ t: 'info', msg: listNote(res.failed) });
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

    /* ---- 방장 본인 전용: 역할 관리 ---- */
    case 'makehost': {
      if (!isHost) { conn.send({ t: 'err', msg: '방장만 방장을 넘길 수 있습니다.' }); return; }
      const target = room.users.get(m.id | 0);
      if (!target || target.id === room.hostId) return;
      room.hostId = target.id;
      room.coHosts.delete(target.id);     // 새 방장은 부방장 목록에서 뺀다
      broadcast(room, { t: 'host', id: room.hostId, name: target.name });
      broadcastRoles(room);
      pushLobby();
      return;
    }

    case 'kick': {
      if (!isHost) { conn.send({ t: 'err', msg: '방장만 내보낼 수 있습니다.' }); return; }
      const target = room.users.get(m.id | 0);
      if (!target || target.id === room.hostId || target.id === user.id) return;

      const tconn = target.conn;
      const tname = target.name;
      // 같은 창에서 곧장 되돌아오지 못하게 잠시 막는다
      room.kicked.set(target.token, Date.now() + KICK_BAN_MS);
      // 그 사람의 소켓이 더는 이 방 사람으로 취급되지 않게 끊어 둔다
      for (const e of sockets) if (e.user === target) { e.user = null; break; }

      leaveRoom(target);                 // 자리·부방장 정리 + 남은 사람에게 알림
      tconn.send({ t: 'kicked', msg: '방장이 회원님을 내보냈습니다.' });
      tconn.send({ t: 'rooms', list: lobbyList() });
      if (rooms.has(room.code)) broadcast(room, { t: 'info', msg: tname + ' 님을 내보냈습니다.' });
      pushLobby();
      console.log('  내보냄 [' + room.code + '] ' + tname + ' ← 방장 ' + user.name);
      return;
    }

    case 'cohost': {
      if (!isHost) { conn.send({ t: 'err', msg: '방장만 부방장을 지정할 수 있습니다.' }); return; }
      const target = room.users.get(m.id | 0);
      if (!target || target.id === room.hostId) return;
      if (m.on) room.coHosts.add(target.id);
      else room.coHosts.delete(target.id);
      broadcastRoles(room);
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
    token: crypto.randomBytes(12).toString('hex'), gone: 0, graceTimer: null, seat: -1,
    x: 600 + (Math.random() - 0.5) * 240, y: 760 + (Math.random() - 0.5) * 80,
    dir: -Math.PI / 2, st: 0, h: 0, joinedAt: Date.now(),
    mic: false,                      // 본인이 마이크를 켰나
    mmute: false,                    // 방장이 이 사람 마이크를 잠갔나
    lastChat: 0, lastArrow: 0, lastRename: 0, lastMic: 0
  };
  room.users.set(u.id, u);
  entry.user = u;
  return u;
}

const pubUser = (u) => ({
  id: u.id, name: u.name, x: Math.round(u.x), y: Math.round(u.y),
  gone: u.gone ? 1 : 0, seat: u.seat, mic: u.mic ? 1 : 0, mmute: u.mmute ? 1 : 0
});
const userList = (r) => Array.from(r.users.values()).map(pubUser);

/* 위치 브로드캐스트 */
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.users.size) continue;
    const arr = [];
    for (const u of r.users.values()) {
      arr.push([u.id, Math.round(u.x), Math.round(u.y), Math.round(u.dir * 100) / 100, u.st, u.name, Math.round(u.h || 0),
        Math.round((u.hy || 0) * 100) / 100, Math.round((u.hp || 0) * 100) / 100, u.gone ? 1 : 0,
        u.mic ? 1 : 0, u.mmute ? 1 : 0]);
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
