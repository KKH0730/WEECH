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
        onReady: function () { ready = true; apply(true); },
        onStateChange: function (e) {
          if (e.data === 0 && onEnded) onEnded();
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

function apply(force) {
  if (!ready || !player || !base.id) return;
  const want = Math.max(0, targetTime());

  if (loadedId !== base.id) {
    loadedId = base.id;
    try {
      if (base.playing) player.loadVideoById({ videoId: base.id, startSeconds: want });
      else player.cueVideoById({ videoId: base.id, startSeconds: want });
    } catch (e) { /* ignore */ }
    return;
  }

  let actual = 0;
  try { actual = player.getCurrentTime() || 0; } catch (e) { return; }
  if (force && Math.abs(actual - want) > 1.0) {
    try { player.seekTo(want, true); } catch (e) { /* ignore */ }
  }

  let st = -1;
  try { st = player.getPlayerState(); } catch (e) { /* ignore */ }
  if (base.playing && st !== 1 && st !== 3) {
    try { player.playVideo(); } catch (e) { /* ignore */ }
    setTimeout(function () {
      try {
        const s2 = player.getPlayerState();
        if (base.playing && s2 !== 1 && s2 !== 3) {
          player.mute();
          player.playVideo();
          if (onBlocked) onBlocked('mute');
        }
      } catch (e) { /* ignore */ }
    }, 1200);
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
  try { player.unMute(); player.setVolume(80); player.playVideo(); } catch (e) { /* ignore */ }
}

export function currentTime() {
  try { return player && ready ? (player.getCurrentTime() || 0) : targetTime(); }
  catch (e) { return targetTime(); }
}

export const isReady = () => ready;
export const isPlaying = () => base.playing;
