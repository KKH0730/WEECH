/* ------------------------------------------------------------------
 *  voice.js — 노래방 모드의 목소리 (WebRTC)
 *
 *  목소리는 브라우저끼리 직접(P2P) 오간다. 서버는 연결을 맺는 쪽지만 중계하고
 *  소리 자체는 지나가지 않는다 — 녹음도, 중계 비용도 없다.
 *
 *  연결 구조는 그물(mesh). 방 정원이 20명이라 모두가 동시에 부르면 무겁지만,
 *  노래방은 보통 한두 사람이 부르고 나머지는 듣기만 한다. 듣기만 하는 쪽은
 *  보낼 트랙이 없으므로 올려보내는 대역은 0 이다.
 *
 *  재협상(renegotiation)을 피하려고, 연결을 맺을 때 미리 'sendrecv' 자리를
 *  하나 만들어 두고 마이크를 켜고 끌 때는 그 자리의 트랙만 갈아 끼운다
 *  (replaceTrack). 그래서 마이크 토글이 즉각적이고 SDP 를 다시 주고받지 않는다.
 * ------------------------------------------------------------------ */
'use strict';

/* 같은 공유기 안이라면 STUN 없이도 붙는다. 바깥 망끼리 붙을 때를 위해 공개 STUN 하나만 둔다.
 * (오프라인에서 쓰려면 이 배열을 비우면 된다 — 같은 망 안에서는 그대로 동작한다) */
const RTC_CONF = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/* 어느 마이크를 쓸지 — 이 브라우저에만 기억한다 (비어 있으면 시스템 기본값) */
const MIC_KEY = 'weech.mic';
let micDevice = '';
try { micDevice = localStorage.getItem(MIC_KEY) || ''; } catch (e) { /* 사생활 모드 등 */ }

/* 소리를 다듬을 것인가, 빨리 보낼 것인가.
 *  에코 제거·잡음 제거·자동 음량은 말소리에는 좋지만 셋 다 소리를 모아 두고
 *  일한다 — 그만큼 늦는다. 게다가 잡음 제거는 길게 끄는 음을 잡음으로 보고
 *  깎아내고, 자동 음량은 지른 부분을 눌러 버린다. 노래에는 둘 다 독이다.
 *  헤드셋을 꼈다면 에코가 돌 일이 없으므로 전부 끄는 쪽이 낫다.
 *  스피커로 듣는 사람은 꺼 두면 소리가 되돌아 울므로 켠 채로 둔다. */
const LOW_KEY = 'weech.lowlat';
let lowLat = true;
try { const v = localStorage.getItem(LOW_KEY); if (v !== null) lowLat = (v === '1'); } catch (e) { /* 사생활 모드 등 */ }

export const lowLatency = () => lowLat;

function micConstraints(dev) {
  const a = lowLat
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 1, latency: 0 }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (dev) a.deviceId = { exact: dev };
  return { audio: a, video: false };
}

/* 고른 마이크가 빠져 있으면(헤드셋을 뽑았다 등) 기본값으로 물러선다 */
function openMic() {
  return navigator.mediaDevices.getUserMedia(micConstraints(micDevice)).catch((e) => {
    const n = (e && e.name) || '';
    if (micDevice && (n === 'OverconstrainedError' || n === 'NotFoundError' || n === 'NotReadableError')) {
      onNotice('고른 마이크를 찾지 못해 기본 마이크를 씁니다.');
      return navigator.mediaDevices.getUserMedia(micConstraints(''));
    }
    throw e;
  });
}

/* ---- 받는 쪽 버퍼 ---------------------------------------------------
 *  브라우저는 받은 소리를 바로 내보내지 않고 조금 쌓아 둔다(지터 버퍼).
 *  망이 들쭉날쭉해도 끊기지 않게 하려는 것인데, 기본값은 말을 주고받는 데
 *  맞춰져 있어 100ms 를 훌쩍 넘기곤 한다. 노래는 박자가 어긋나면 못 쓰므로
 *  '되도록 쌓지 말라' 고 일러둔다 — 어디까지나 바람이라, 망이 나빠지면
 *  브라우저가 알아서 다시 늘린다. */
function tuneReceiver(r) {
  if (!r) return;
  try { r.jitterBufferTarget = 0; } catch (e) { /* 모르는 브라우저 */ }
  try { r.playoutDelayHint = 0; } catch (e) { /* 옛 크롬 */ }
}

/* ---- 보내는 쪽 묶음 -------------------------------------------------
 *  Opus 는 기본으로 20ms 씩 모아 한 덩이로 보낸다. 10ms 로 줄이면 그만큼
 *  먼저 출발한다. DTX(조용하면 안 보내기)는 노래의 첫 음을 갉아먹으므로 끈다.
 *  FEC 는 켜 둔다 — 버퍼를 줄인 만큼 한 덩이 잃는 게 더 아프다. */
const OPUS_WANT = ['minptime=10', 'useinbandfec=1', 'usedtx=0', 'stereo=0', 'sprop-stereo=0'];

function tuneSdp(sdp) {
  const pt = (sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i) || [])[1];
  if (!pt) return sdp;
  const drop = /^\s*(minptime|useinbandfec|usedtx|stereo|sprop-stereo)\s*=/;
  let hit = false;
  let out = sdp.replace(new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)'), (m, params) => {
    hit = true;
    const keep = params.split(';').filter((x) => x && !drop.test(x));
    return 'a=fmtp:' + pt + ' ' + keep.concat(OPUS_WANT).join(';');
  });
  if (!hit) return sdp;                     // 모양이 낯설다 — 손대지 않는다
  if (!/^a=ptime:/m.test(out)) {
    out = out.replace(/(a=rtpmap:\d+\s+opus\/48000[^\r\n]*\r?\n)/i, '$1a=ptime:10\r\n');
  }
  return out;
}

/* 고친 SDP 가 거부되면 원본 그대로 쓴다 — 지연을 줄이려다 연결을 깨뜨리지 않는다 */
function setLocal(pc, desc) {
  let sdp;
  try { sdp = tuneSdp(desc.sdp); } catch (e) { sdp = desc.sdp; }
  if (sdp === desc.sdp) return pc.setLocalDescription(desc);
  return pc.setLocalDescription({ type: desc.type, sdp: sdp })
    .catch(() => pc.setLocalDescription(desc));
}

let myId = 0;
let sendSignal = null;       // (to, data) => void
let onNotice = null;         // (msg) => void  — 사람에게 보여줄 말
let enabled = false;         // 노래방 모드가 켜져 있나
let micWanted = false;       // 내가 마이크를 켜려 하나
let micStream = null;

const peers = new Map();     // id -> { pc, sender, audio, meter }
const blocked = new Set();   // 내가 소리를 막은 사람
const helloed = new Set();   // 다시 걸어 달라고 이미 부른 사람 (같은 사람을 거듭 부르지 않게)

/* ---- 말하는 중인가 --------------------------------------------------
 *  들어오는 소리의 세기(RMS)만 본다. 음정까지 볼 필요가 없다.
 *  말소리는 끊겼다 이어지므로, 조용해져도 잠깐(TALK_HOLD) 켜 둔 채로 두어야
 *  표시가 깜빡이지 않는다.
 * ------------------------------------------------------------------ */
const TALK_GATE = 0.016;     // 이보다 커야 '말한다' 로 본다
const TALK_HOLD = 280;       // 조용해져도 이만큼(ms) 더 켜 둔다
let meterCtx = null;

function audioCtx() {
  try {
    if (!meterCtx) meterCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (meterCtx.state === 'suspended') meterCtx.resume().catch(() => {});
    return meterCtx;
  } catch (e) { return null; }
}

function makeMeter(stream) {
  const ctx = audioCtx();
  if (!ctx) return null;
  try {
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.2;
    src.connect(an);          // 출력에는 잇지 않는다 — 소리는 <audio> 가 낸다
    return { src: src, an: an, buf: new Float32Array(an.fftSize), last: 0, on: false };
  } catch (e) { return null; }
}

function readMeter(m, now) {
  if (!m) return false;
  m.an.getFloatTimeDomainData(m.buf);
  let e = 0;
  for (let i = 0; i < m.buf.length; i++) e += m.buf[i] * m.buf[i];
  const rms = Math.sqrt(e / m.buf.length);
  if (rms > TALK_GATE) m.last = now;
  m.on = !!(m.last && now - m.last < TALK_HOLD);
  return m.on;
}

/* 한 번에 모두 갱신한다 — 줄마다 따로 재면 같은 일을 여러 번 하게 된다 */
export function tickMeters() {
  if (!enabled) return;
  const now = Date.now();
  for (const p of peers.values()) readMeter(p.meter, now);
}

/* 이 사람이 지금 말하고 있나 (tickMeters 가 재 둔 값을 읽는다) */
export function speaking(id) {
  const p = peers.get(id | 0);
  return !!(p && p.meter && p.meter.on);
}

/* 마이크를 쓸 수 있는 자리인가.
 * getUserMedia 는 보안 컨텍스트(https 또는 localhost)에서만 열린다.
 * 같은 공유기에서 http://192.168.x.x 로 들어오면 아예 없는 API 가 된다. */
export function micAvailable() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
export function micUnavailableReason() {
  if (micAvailable()) return '';
  if (!window.isSecureContext) {
    return '마이크를 열 수 없는 주소입니다 (' + location.origin + '). ' +
      '브라우저는 localhost 나 https 에서만 마이크를 내줍니다 — ' +
      'http://localhost:3000 으로 들어오면 됩니다. (지금도 듣기는 됩니다)';
  }
  return '이 브라우저에서 마이크를 쓸 수 없습니다. (듣기는 됩니다)';
}

/* 지금 상태를 한 줄로 — 왜 안 되는지 사람에게 보여 줄 때 쓴다 */
export function diagnose() {
  return '노래방 ' + (enabled ? '켜짐' : '꺼짐') +
    ' · 마이크 API ' + (micAvailable() ? '있음' : '없음') +
    ' · 보안 컨텍스트 ' + (window.isSecureContext ? '예' : '아니오') +
    ' · 연결 ' + peers.size + '개';
}

export function init(opts) {
  sendSignal = opts.signal;
  onNotice = opts.notice || function () {};
}

export function setMyId(id) { myId = id | 0; }

const myTrack = () => (micStream ? micStream.getAudioTracks()[0] || null : null);

/* ---- 연결 한 가닥 ------------------------------------------------- */

/* 연결마다 이름표(sid)를 붙인다. 상대가 새로고침하면 옛 연결의 쪽지(answer·ice)가
 * 뒤늦게 도착할 수 있는데, 이름표가 다르면 버린다. */
const newSid = () => Math.random().toString(36).slice(2, 10);

function makePeer(id, sid) {
  const pc = new RTCPeerConnection(RTC_CONF);
  const p = { pc: pc, sid: sid, sender: null, audio: null, made: false };
  peers.set(id, p);

  pc.onicecandidate = (e) => {
    if (e.candidate && peers.get(id) === p) sendSignal(id, { sid: p.sid, ice: e.candidate.toJSON() });
  };
  pc.ontrack = (e) => {
    tuneReceiver(e.receiver);
    const stream = e.streams[0] || new MediaStream([e.track]);
    attachAudio(id, stream);
  };
  pc.onconnectionstatechange = () => {
    if (peers.get(id) !== p) return;            // 이미 새 연결로 바뀌었다
    if (pc.connectionState === 'failed') {
      // 한 번 끊어졌다 — 다시 맺어 본다 (낮은 id 쪽만 다시 건다)
      dropPeer(id);
      if (enabled && myId < id) setTimeout(() => { if (enabled) connect(id); }, 600);
    }
  };
  return p;
}

function attachAudio(id, stream) {
  let p = peers.get(id);
  if (!p) return;
  if (!p.audio) {
    const el = document.createElement('audio');
    el.autoplay = true;
    el.playsInline = true;
    el.style.display = 'none';
    el.dataset.peer = String(id);
    document.body.appendChild(el);
    p.audio = el;
  }
  p.audio.srcObject = stream;
  p.audio.muted = blocked.has(id);
  p.audio.volume = volumeOf(id);
  if (!p.meter) p.meter = makeMeter(stream);     // 말하는지 재는 귀
  const played = p.audio.play();
  if (played && played.catch) {
    played.catch(() => {
      // 자동재생이 막혔다 — 화면을 한 번 누르면 풀린다
      onNotice('소리를 켜려면 화면을 한 번 눌러 주세요.');
    });
  }
}

/* 낮은 id 쪽이 먼저 건다 — 양쪽이 동시에 걸어 엉키는 일을 없앤다 */
function connect(id) {
  if (!enabled || id === myId || peers.has(id)) return;
  const p = makePeer(id, newSid());
  const tr = p.pc.addTransceiver('audio', { direction: 'sendrecv' });
  p.sender = tr.sender;
  if (myTrack()) p.sender.replaceTrack(myTrack());
  p.pc.createOffer()
    .then((o) => setLocal(p.pc, o))
    .then(() => { if (peers.get(id) === p) sendSignal(id, { sid: p.sid, sdp: p.pc.localDescription }); })
    .catch(() => { if (peers.get(id) === p) dropPeer(id); });
}

function dropPeer(id) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
  if (p.meter) { try { p.meter.src.disconnect(); } catch (e) { /* 무시 */ } p.meter = null; }
  try { p.pc.close(); } catch (e) { /* 무시 */ }
  if (p.audio) {
    p.audio.srcObject = null;
    if (p.audio.parentNode) p.audio.parentNode.removeChild(p.audio);
  }
}

/* ---- 서버가 중계해 준 쪽지 ---------------------------------------- */

export function signal(from, data) {
  if (!enabled || !data) return;
  let p = peers.get(from);

  /* 상대(나보다 높은 id)가 새로 들어왔거나 새로고침했다 — 다시 걸어 달란다.
   * 내 쪽에 남은 옛 연결은 이미 죽은 것이므로 버리고 새로 건다. */
  if (data.hello) {
    if (myId < from) { dropPeer(from); connect(from); }
    return;
  }

  if (data.sdp) {
    const desc = data.sdp;
    if (desc.type === 'offer') {
      // 재협상은 하지 않으므로 offer 는 언제나 '새 연결' 이다 — 옛것은 버린다
      if (p) dropPeer(from);
      p = makePeer(from, data.sid);
      const cur = p;
      p.pc.setRemoteDescription(desc)
        .then(() => {
          // 상대가 만들어 준 자리에 내 트랙을 끼운다
          const tr = p.pc.getTransceivers()[0];
          if (tr) {
            // 받는 쪽 자리는 기본이 'recvonly' 라 그대로 두면 이쪽 목소리가 영영 안 간다
            tr.direction = 'sendrecv';
            tuneReceiver(tr.receiver);
            p.sender = tr.sender;
            if (myTrack()) p.sender.replaceTrack(myTrack());
          }
          return p.pc.createAnswer();
        })
        .then((a) => setLocal(p.pc, a))
        .then(() => { if (peers.get(from) === cur) sendSignal(from, { sid: cur.sid, sdp: cur.pc.localDescription }); })
        .catch(() => { if (peers.get(from) === cur) dropPeer(from); });
    } else if (desc.type === 'answer' && p && p.sid === data.sid) {
      p.pc.setRemoteDescription(desc).catch(() => { if (peers.get(from) === p) dropPeer(from); });
    }
    return;
  }

  if (data.ice && p && p.sid === data.sid) {
    p.pc.addIceCandidate(data.ice).catch(() => { /* 늦게 온 후보는 버린다 */ });
  }
}

/* ---- 바깥에서 부르는 것들 ------------------------------------------ */

/* 방에 있는 사람 목록이 바뀌었다 — 없어진 연결은 끊고 새 사람에게는 건다 */
export function setPeers(ids) {
  if (!enabled) return;
  const want = new Set(ids.filter((id) => id !== myId));
  for (const id of Array.from(peers.keys())) if (!want.has(id)) dropPeer(id);
  for (const id of want) {
    if (myId < id) connect(id);
    // 나보다 낮은 id 는 그쪽이 걸어 온다. 다만 내가 새로고침했다면 그쪽은 옛 연결이
    // 아직 살아 있다고 믿고 다시 걸지 않으므로, 연결이 없을 때 한 번 불러 준다.
    else if (!peers.has(id) && !helloed.has(id)) { helloed.add(id); sendSignal(id, { hello: 1 }); }
  }
}

/* 노래방 모드 켜기/끄기 */
export function setEnabled(on, ids) {
  on = !!on;
  if (on === enabled) return;
  enabled = on;
  if (on) {
    // 연결을 못 맺더라도 모드 자체는 켜져 있어야 한다 (듣기·마이크 UI 가 살아 있게)
    try { setPeers(ids || []); }
    catch (e) { onNotice('목소리 연결을 시작하지 못했습니다: ' + ((e && e.message) || e)); }
  } else {
    helloed.clear();
    for (const id of Array.from(peers.keys())) dropPeer(id);
    stopMic();
    micWanted = false;
    if (meterCtx) { try { meterCtx.close(); } catch (e) { /* 무시 */ } meterCtx = null; }
    myMeter = null; myMeterFor = null;
  }
}

function stopMic() {
  if (!micStream) return;
  micStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* 무시 */ } });
  micStream = null;
  for (const p of peers.values()) if (p.sender) p.sender.replaceTrack(null).catch(() => {});
}

/* 마이크 켜기/끄기. 성공하면 true.
 * 켤 때 처음 한 번은 브라우저가 권한을 묻는다. */
export function setMic(on) {
  on = !!on;
  if (!enabled) {
    onNotice('노래방 모드가 켜져 있어야 마이크를 쓸 수 있습니다.');
    return Promise.resolve(false);
  }
  micWanted = on;

  if (!on) { stopMic(); return Promise.resolve(true); }
  if (!micAvailable()) { onNotice(micUnavailableReason()); micWanted = false; return Promise.resolve(false); }
  if (micStream) { pushTrack(); return Promise.resolve(true); }

  return openMic()
    .then(preferHeadset)
    .then((s) => {
      if (!micWanted || !enabled) { s.getTracks().forEach((t) => t.stop()); return false; }
      micStream = s;
      pushTrack();
      return true;
    })
    .catch((e) => {
      micWanted = false;
      const name = (e && e.name) || '';
      onNotice(name === 'NotAllowedError'
        ? '마이크 권한이 거부되었습니다. 주소창 왼쪽 자물쇠에서 허용해 주세요.'
        : (name === 'NotFoundError' ? '마이크를 찾지 못했습니다.' : '마이크를 열지 못했습니다.'));
      return false;
    });
}

function pushTrack() {
  const t = myTrack();
  for (const p of peers.values()) if (p.sender) p.sender.replaceTrack(t).catch(() => {});
}

/* 이 사람 소리만 내 쪽에서 막는다 (나만의 설정 — 상대는 모른다) */
export function setBlocked(id, on) {
  id = id | 0;
  if (on) blocked.add(id); else blocked.delete(id);
  applyMute(id);
}

function applyMute(id) {
  const p = peers.get(id);
  if (p && p.audio) p.audio.muted = blocked.has(id);
}
export function isBlocked(id) { return blocked.has(id | 0); }

/* 이 사람 소리 크기(0~1) — 역시 내 귀에만 적용된다. 다시 연결돼도 유지된다.
 * 기본은 절반 — 영상 소리와 섞여도 목소리가 너무 튀지 않게. */
export const DEFAULT_VOLUME = 0.5;
const volumes = new Map();
function volumeOf(id) { const v = volumes.get(id | 0); return v === undefined ? DEFAULT_VOLUME : v; }
export function setVolume(id, v) {
  id = id | 0;
  v = Math.max(0, Math.min(1, Number(v) || 0));
  if (v === DEFAULT_VOLUME) volumes.delete(id); else volumes.set(id, v);
  const p = peers.get(id);
  if (p && p.audio) p.audio.volume = v;
}
export const getVolume = (id) => volumeOf(id);
export function blockedList() { return Array.from(blocked); }

/* 음정 분석기가 같은 스트림을 물어 갈 수 있게 내준다 */
export const micMedia = () => micStream;

export const isEnabled = () => enabled;
export const isMicOn = () => !!(micStream && micWanted);


/* ---- 마이크 고르기 ------------------------------------------------- */

/* 헤드셋처럼 보이는 마이크인가 — 이름으로만 가린다 */
const HEADSET_RE = /headset|헤드셋|headphone|헤드폰|earbud|airpods|buds|hands-?free|핸즈프리|bluetooth|블루투스/i;

/* 마이크를 직접 고른 적이 없으면 헤드셋을 먼저 잡는다.
 * 브라우저가 사이트마다 기억해 둔 마이크가 아무것도 안 꽂힌 본체 단자일 때가 있어,
 * 그대로 두면 연결은 되는데 무음만 간다. 헤드셋이 있으면 그쪽이 거의 늘 맞다.
 * 이름(label)은 권한을 받은 뒤에만 보이므로, 일단 연 다음에 확인하고 갈아 끼운다.
 * 자동으로 고른 것은 저장하지 않는다 — 사람이 고른 것만 기억한다. */
function preferHeadset(stream) {
  if (micDevice || !navigator.mediaDevices.enumerateDevices) return stream;
  const cur = stream.getAudioTracks()[0];
  if (!cur || HEADSET_RE.test(cur.label)) return stream;
  return navigator.mediaDevices.enumerateDevices().then((ds) => {
    const hs = ds.find((d) => d.kind === 'audioinput' && d.deviceId !== 'default' &&
      d.deviceId !== 'communications' && HEADSET_RE.test(d.label));
    if (!hs) return stream;
    return navigator.mediaDevices.getUserMedia(micConstraints(hs.deviceId)).then((s2) => {
      stream.getTracks().forEach((t) => t.stop());
      return s2;
    }, () => stream);                               // 헤드셋을 못 열면 처음 것을 그대로 쓴다
  }, () => stream);
}

/* 사람에게 보여 줄 짧은 이름 — '기본값 - 마이크(Logitech G733 Gaming Headset) (046d:0b1f)'
 * 같은 윈도 이름에서 군더더기를 걷어 낸다. */
export function shortMicName(label) {
  let n = String(label || '').trim();
  n = n.replace(/^(기본값|default|커뮤니케이션|communications)\s*-\s*/i, '');
  n = n.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
  const m = n.match(/^(?:마이크|microphone|mic)\s*\((.+)\)$/i);
  if (m) n = m[1];
  return n || '마이크';
}

/* 지금 실제로 쓰고 있는 마이크 이름 (꺼져 있으면 빈 문자열) */
export const activeMicName = () => { const t = myTrack(); return t ? shortMicName(t.label) : ''; };

/* 고를 수 있는 마이크 목록. 이름(label)은 마이크 권한을 받은 뒤에만 보인다.
 * 'default' · 'communications' 는 윈도가 만드는 별칭(실제 장치와 같은 것)이라 목록만 어지럽혀 뺀다. */
export function listMics() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
  return navigator.mediaDevices.enumerateDevices().then((ds) => ds
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && d.deviceId !== 'default')
    .map((d) => ({ id: d.deviceId, label: d.label, group: d.groupId })));
}

/* 지금 쓰는 마이크 — 켜져 있으면 실제 장치, 꺼져 있으면 골라 둔 것 */
export function currentMic() {
  const t = myTrack();
  if (t) {
    const st = t.getSettings ? t.getSettings() : {};
    return { id: micDevice || st.deviceId || '', group: st.groupId || '', label: t.label || '' };
  }
  return { id: micDevice, group: '', label: '' };
}

/* 마이크를 바꾼다. 켜져 있으면 그 자리에서 갈아 끼운다(상대와 다시 협상하지 않는다).
 * 새 스트림을 돌려준다 — 음정 분석기도 갈아 물려야 하므로. 꺼져 있으면 null. */
/* 켜져 있는 마이크를 새 조건으로 다시 연다 (꺼져 있으면 할 일이 없다) */
function reopenMic() {
  if (!micStream) return Promise.resolve(null);
  return openMic().then((s) => {
    if (!micStream || !micWanted) { s.getTracks().forEach((t) => t.stop()); return null; }
    const old = micStream;
    micStream = s;
    pushTrack();
    old.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* 무시 */ } });
    return s;
  }, () => null);
}

/* 낮은 지연을 켜고 끈다 — 마이크가 켜져 있으면 바로 새 조건으로 다시 연다 */
export function setLowLatency(on) {
  lowLat = !!on;
  try { localStorage.setItem(LOW_KEY, lowLat ? '1' : '0'); } catch (e) { /* 무시 */ }
  return reopenMic();
}

/* ---- 얼마나 늦나 ----------------------------------------------------
 *  브라우저가 세어 둔 값을 그대로 읽는다. 짐작이 아니라 잰 값이다.
 *    buf : 쌓아 둔 소리가 실제로 기다린 평균 시간
 *    net : 왕복 시간의 절반 (한쪽 방향)
 *  마이크·스피커 장치가 먹는 시간은 여기 안 잡힌다 — 그래서 '적어도 이만큼'
 *  으로 읽어야 한다. */
export function latency() {
  const jobs = [];
  peers.forEach((p, id) => {
    if (!p.pc || blocked.has(id)) return;
    jobs.push(p.pc.getStats().then((st) => {
      let buf = -1, rtt = -1;
      st.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio' && r.jitterBufferEmittedCount > 0) {
          buf = (r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000;
        } else if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime >= 0) {
          rtt = r.currentRoundTripTime * 1000;
        } else if (r.type === 'remote-inbound-rtp' && rtt < 0 && r.roundTripTime >= 0) {
          rtt = r.roundTripTime * 1000;
        }
      });
      return { id: id, buf: buf, net: rtt >= 0 ? rtt / 2 : -1 };
    }, () => null));
  });
  return Promise.all(jobs).then((rows) => rows.filter((r) => r && r.buf >= 0));
}

export function setMicDevice(id) {
  micDevice = id || '';
  try { if (micDevice) localStorage.setItem(MIC_KEY, micDevice); else localStorage.removeItem(MIC_KEY); } catch (e) { /* 무시 */ }
  if (!micStream) return Promise.resolve(null);
  return openMic().then((s) => {
    if (!micStream || !micWanted) { s.getTracks().forEach((t) => t.stop()); return null; }
    const old = micStream;
    micStream = s;
    pushTrack();
    old.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* 무시 */ } });
    return s;
  });
}

/* 내 마이크 소리 크기(0~1) — 고른 마이크로 소리가 들어오는지 눈으로 확인하게 */
let myMeter = null, myMeterFor = null;
export function micLevel() {
  if (!micStream) return 0;
  if (myMeterFor !== micStream) {
    if (myMeter) { try { myMeter.src.disconnect(); } catch (e) { /* 무시 */ } }
    myMeter = makeMeter(micStream);
    myMeterFor = micStream;
  }
  if (!myMeter) return 0;
  myMeter.an.getFloatTimeDomainData(myMeter.buf);
  let e = 0;
  for (let i = 0; i < myMeter.buf.length; i++) e += myMeter.buf[i] * myMeter.buf[i];
  return Math.min(1, Math.sqrt(e / myMeter.buf.length) * 4);
}
