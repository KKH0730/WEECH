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

const MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false
};

let myId = 0;
let sendSignal = null;       // (to, data) => void
let onNotice = null;         // (msg) => void  — 사람에게 보여줄 말
let enabled = false;         // 노래방 모드가 켜져 있나
let micWanted = false;       // 내가 마이크를 켜려 하나
let micStream = null;

const peers = new Map();     // id -> { pc, sender, audio, pending:[] }
const blocked = new Set();   // 내가 소리를 막은 사람

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

function makePeer(id) {
  const pc = new RTCPeerConnection(RTC_CONF);
  const p = { pc: pc, sender: null, audio: null, made: false };
  peers.set(id, p);

  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(id, { ice: e.candidate.toJSON() });
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    attachAudio(id, stream);
  };
  pc.onconnectionstatechange = () => {
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
  const p = makePeer(id);
  const tr = p.pc.addTransceiver('audio', { direction: 'sendrecv' });
  p.sender = tr.sender;
  if (myTrack()) p.sender.replaceTrack(myTrack());
  p.pc.createOffer()
    .then((o) => p.pc.setLocalDescription(o))
    .then(() => sendSignal(id, { sdp: p.pc.localDescription }))
    .catch(() => dropPeer(id));
}

function dropPeer(id) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
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

  if (data.sdp) {
    const desc = data.sdp;
    if (desc.type === 'offer') {
      if (!p) p = makePeer(from);
      p.pc.setRemoteDescription(desc)
        .then(() => {
          // 상대가 만들어 준 자리에 내 트랙을 끼운다
          const tr = p.pc.getTransceivers()[0];
          if (tr) {
            p.sender = tr.sender;
            if (myTrack()) p.sender.replaceTrack(myTrack());
          }
          return p.pc.createAnswer();
        })
        .then((a) => p.pc.setLocalDescription(a))
        .then(() => sendSignal(from, { sdp: p.pc.localDescription }))
        .catch(() => dropPeer(from));
    } else if (desc.type === 'answer' && p) {
      p.pc.setRemoteDescription(desc).catch(() => dropPeer(from));
    }
    return;
  }

  if (data.ice && p) {
    p.pc.addIceCandidate(data.ice).catch(() => { /* 늦게 온 후보는 버린다 */ });
  }
}

/* ---- 바깥에서 부르는 것들 ------------------------------------------ */

/* 방에 있는 사람 목록이 바뀌었다 — 없어진 연결은 끊고 새 사람에게는 건다 */
export function setPeers(ids) {
  if (!enabled) return;
  const want = new Set(ids.filter((id) => id !== myId));
  for (const id of Array.from(peers.keys())) if (!want.has(id)) dropPeer(id);
  for (const id of want) if (myId < id) connect(id);
  // 나보다 낮은 id 는 그쪽이 걸어 온다 — 여기서는 기다린다
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
    for (const id of Array.from(peers.keys())) dropPeer(id);
    stopMic();
    micWanted = false;
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

  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
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
  const p = peers.get(id);
  if (p && p.audio) p.audio.muted = !!on;
}
export function isBlocked(id) { return blocked.has(id | 0); }
export function blockedList() { return Array.from(blocked); }

/* 음정 분석기가 같은 스트림을 물어 갈 수 있게 내준다 */
export const micMedia = () => micStream;

export const isEnabled = () => enabled;
export const isMicOn = () => !!(micStream && micWanted);
