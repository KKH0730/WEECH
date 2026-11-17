/* ------------------------------------------------------------------
 *  youtube.js — 벽에 걸린 TV (CSS3D)
 *
 *  유튜브 영상은 iframe 이라 WebGL 텍스처로 못 가져온다.
 *  그래서 WebGL 은 TV 자리에 '구멍'만 뚫고, 그 뒤에서 CSS3DRenderer 가
 *  똑같은 카메라 행렬로 iframe 을 3D 변환해 놓는다.
 *  → 비스듬히 봐도 원근이 맞는, 진짜 벽에 걸린 화면이 된다.
 *
 *  재생 동기화: 서버는 {몇 번째, 재생중, 위치, 기록한 서버 시각} 만 들고 있고
 *  각자 '지금 있어야 할 위치'를 계산해 1.5초 이상 어긋나면 따라붙는다.
 * ------------------------------------------------------------------ */
import * as THREE from 'three';
import { CSS3DObject } from './vendor/CSS3DRenderer.js';

const PX_W = 1280, PX_H = 720;      // iframe 의 픽셀 크기 (16:9)
const DEFAULT_VOL = 25;             // 처음 입장 시 기본 볼륨 (%)

let player = null;
let ready = false;
let loadedId = null;
let onEnded = null, onBlocked = null;

let base = { idx: 0, id: null, playing: false, position: 0, serverNow: 0 };
let clockOffset = 0;

const serverTime = () => Date.now() - clockOffset;

function targetTime() {
  if (!base.playing) return base.position;
  return base.position + (serverTime() - base.serverNow) / 1000;
}

/* TV 를 3D 공간에 만들어 CSS3D 씬에 넣는다 */
export function mountScreen(cssScene, tvAt, tvSize) {
  const holder = document.createElement('div');
  holder.style.width = PX_W + 'px';
  holder.style.height = PX_H + 'px';
  holder.style.background = '#000';
  holder.style.overflow = 'hidden';

  const slot = document.createElement('div');
  slot.id = 'tv-player';
  slot.style.width = '100%';
  slot.style.height = '100%';
  holder.appendChild(slot);

  const obj = new CSS3DObject(holder);
  obj.position.set(tvAt.x + tvAt.nx * 0.02, tvAt.y, tvAt.z + tvAt.nz * 0.02);
  obj.rotation.y = tvAt.ry;
  obj.scale.setScalar(tvSize.w / PX_W);     // 픽셀 → 미터
  cssScene.add(obj);
  return obj;
}

export function init(opts) {
  onEnded = opts.onEnded;
  onBlocked = opts.onBlocked;

  window.onYouTubeIframeAPIReady = function () {
    player = new window.YT.Player('tv-player', {
      width: String(PX_W), height: String(PX_H),
      playerVars: {
        controls: 0, disablekb: 1, modestbranding: 1, rel: 0,
        playsinline: 1, fs: 0, iv_load_policy: 3, origin: location.origin
      },
      events: {
        onReady: function () { ready = true; try { player.setVolume(DEFAULT_VOL); } catch (e) { /* ignore */ } apply(true); },
        onStateChange: function (e) {
          if (e.data === 0 && onEnded) onEnded();
          // 자막 설정을 새 영상에 다시 적용 (영상마다 초기화되므로)
          if (e.data === 1 && ccOn) applyCaptions();
        },
        onError: function () { if (onEnded) onEnded(); }
      }
    });
  };

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.onerror = function () {
    if (onBlocked) onBlocked('유튜브 플레이어를 불러오지 못했습니다. 네트워크를 확인해 주세요.');
  };
  document.head.appendChild(tag);

  setInterval(tick, 1000);
}

export function setState(st, id) {
  if (st.serverNow) clockOffset = Date.now() - st.serverNow;
  base = {
    idx: st.idx | 0,
    id: id || base.id,
    playing: !!st.playing,
    position: Number(st.position) || 0,
    serverNow: st.serverNow || serverTime()
  };
  apply(true);
}

let playTimer = null;
let lastLoadAt = 0;

/* 영상을 플레이어에 건다. play=true 면 로드(자동재생 시도), false 면 예고만 한다. */
function doLoad(play) {
  loadedId = base.id;
  lastLoadAt = Date.now();
  const start = Math.max(0, targetTime());
  try {
    if (play) player.loadVideoById({ videoId: base.id, startSeconds: start });
    else player.cueVideoById({ videoId: base.id, startSeconds: start });
  } catch (e) { /* ignore */ }
}

/* 재생 중이어야 하는데 안 돌고 있으면 돌린다.
 * 소리 있는 자동재생은 사용자 제스처(방장의 재생 클릭)가 없으면 브라우저가 막는다.
 * 방장은 그대로 소리가 나고, 그 외(입장자·동기화)는 음소거로라도 재생해 화면을 띄운다. */
function ensurePlaying() {
  if (!ready || !player || !base.playing) return;
  let st = -1;
  try { st = player.getPlayerState(); } catch (e) { return; }
  if (st === 1) return;                       // 이미 재생 중
  // CUED(5)·UNSTARTED(-1) 은 아직 한 번도 안 돈 상태 — playVideo 로는 화면이 안 뜰 수 있다.
  // (방장은 영상을 '예고'만 해둔 cued 상태라 여기에 걸린다) 아예 로드해 강제로 띄운다.
  // 단, 방금 로드했으면 그 로드가 진행되게 둔다.
  if ((st === 5 || st === -1) && Date.now() - lastLoadAt > 1200) {
    doLoad(true);
  } else {
    try { player.playVideo(); } catch (e) { /* ignore */ }
  }
  if (playTimer) return;                      // 확인이 이미 예약돼 있다
  playTimer = setTimeout(function () {
    playTimer = null;
    if (!base.playing) return;
    let s2 = -1;
    try { s2 = player.getPlayerState(); } catch (e) { return; }
    if (s2 === 1) return;                      // 소리와 함께 재생됐다 (제스처 있었음)
    // 여기까지 왔으면 소리 있는 자동재생이 막힌 것 — 음소거로 띄우고 버튼을 내건다
    try {
      player.mute();
      player.playVideo();
      if (onBlocked) onBlocked('mute');
    } catch (e) { /* ignore */ }
  }, 1500);
}

function apply(force) {
  if (!ready || !player || !base.id) return;
  const want = Math.max(0, targetTime());

  if (loadedId !== base.id) {
    doLoad(base.playing);
    if (base.playing) ensurePlaying();         // 로드만으론 자동재생이 막힐 수 있다 — 재생을 보장한다
    return;
  }

  let actual = 0;
  try { actual = player.getCurrentTime() || 0; } catch (e) { return; }
  if (force && Math.abs(actual - want) > 1.0) {
    try { player.seekTo(want, true); } catch (e) { /* ignore */ }
  }

  let st = -1;
  try { st = player.getPlayerState(); } catch (e) { /* ignore */ }
  if (base.playing && st !== 1) {
    ensurePlaying();
  }
  if (!base.playing && st === 1) {
    try { player.pauseVideo(); } catch (e) { /* ignore */ }
  }
}

function tick() {
  if (!ready || !player || !base.id) return;
  try {
    const st = player.getPlayerState();
    if (base.playing && st === 1) {
      const drift = player.getCurrentTime() - targetTime();
      if (Math.abs(drift) > 1.5) player.seekTo(Math.max(0, targetTime()), true);
    } else {
      apply(false);
    }
  } catch (e) { /* ignore */ }
}

export function unmute() {
  if (!player) return;
  try { player.unMute(); player.setVolume(DEFAULT_VOL); player.playVideo(); } catch (e) { /* ignore */ }
}

/* ---- 볼륨 (각자 로컬) ---- */
export function setVol(v) {
  if (!player) return;
  v = Math.max(0, Math.min(100, v | 0));
  try {
    if (v > 0 && player.isMuted && player.isMuted()) player.unMute();
    player.setVolume(v);
  } catch (e) { /* ignore */ }
}
export function getVol() {
  try { return player && ready ? (player.getVolume() | 0) : 80; } catch (e) { return 80; }
}
export function setMuted(on) {
  if (!player) return;
  try { on ? player.mute() : player.unMute(); } catch (e) { /* ignore */ }
}
export function isMuted() {
  try { return player && ready ? !!player.isMuted() : false; } catch (e) { return false; }
}

/* ---- 자막 (각자 로컬) ---- */
let ccOn = false;
let ccLang = null;             // 선택한 자막 언어코드 (null = 첫 번째/기본)

/* 모듈 이름이 플레이어 버전에 따라 'captions' 또는 'cc' 라, 둘 다 시도한다 */
function ccModules() { return ['captions', 'cc']; }

/* 지금 영상이 제공하는 자막 트랙 목록 [{code, label, asr}] */
export function captionTracks() {
  if (!player || !ready) return [];
  let tracks = [];
  for (const mod of ccModules()) {
    try { const t = player.getOption(mod, 'tracklist'); if (t && t.length) { tracks = t; break; } } catch (e) { /* ignore */ }
  }
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const code = t.languageCode || t.vss_id || '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const name = t.languageName || t.displayName || code;
    out.push({ code: code, label: name + (t.kind === 'asr' ? ' (자동생성)' : ''), asr: t.kind === 'asr' });
  }
  return out;
}

function applyCaptions() {
  if (!player) return;
  try {
    if (ccOn) {
      for (const mod of ccModules()) { try { player.loadModule(mod); } catch (e) { /* ignore */ } }
      const tracks = captionTracks();
      if (tracks.length) {
        const pick = (ccLang && tracks.find((t) => t.code === ccLang)) || tracks[0];
        for (const mod of ccModules()) {
          try { player.setOption(mod, 'track', { languageCode: pick.code }); } catch (e) { /* ignore */ }
        }
      }
    } else {
      for (const mod of ccModules()) { try { player.unloadModule(mod); } catch (e) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}
export function setCaptions(on) {
  ccOn = (typeof on === 'boolean') ? on : !ccOn;
  applyCaptions();
  return ccOn;
}
export function setCaptionLang(code) {
  ccLang = code || null;
  if (ccOn) applyCaptions();
}
export function captionLang() { return ccLang; }
export function captionsOn() { return ccOn; }

export function currentTime() {
  try { return player && ready ? (player.getCurrentTime() || 0) : targetTime(); }
  catch (e) { return targetTime(); }
}

export function duration() {
  try { return player && ready ? (player.getDuration() || 0) : 0; }
  catch (e) { return 0; }
}

export const isReady = () => ready;
export const isPlaying = () => base.playing;
