/* ------------------------------------------------------------------
 *  pitch.js — 마이크에서 '지금 내는 음' 과 파형을 읽는다
 *
 *  자기상관(autocorrelation). 소리를 자기 자신과 조금씩 밀어 가며 겹쳐 보고
 *  가장 잘 겹치는 밀기 양을 찾는다. 그게 한 주기의 길이다.
 *      주파수 = 표본율 / 주기
 *
 *  사람 목소리처럼 음 하나만 나는 소리(단선율)에는 이 방법이면 충분하다.
 *  반주가 섞인 소리에는 쓸 수 없다 — 여러 음이 동시에 겹쳐 주기가 하나가 아니다.
 *
 *  밀기 양을 사람 목소리 범위로 묶어 두는 것이 중요하다. 전 구간을 다 보면
 *  O(n²) 이라 매 프레임 돌릴 수 없지만, 70~1100Hz 로 묶으면 한참 줄어든다.
 *
 *  소리를 다루는 부분(detect)과 브라우저를 다루는 부분(start/read)을 갈라
 *  두었다. detect 는 순수 계산이라 Node 에서 그대로 시험할 수 있다.
 * ------------------------------------------------------------------ */
'use strict';

const FFT_SIZE = 2048;        // 파형 버퍼
const ACF_SIZE = 1024;        // 자기상관에 실제로 쓰는 표본 수
const MIN_HZ = 70;            // 남성 저음보다 조금 아래
const MAX_HZ = 1100;          // 여성 고음보다 조금 위
const RMS_GATE = 0.012;       // 이보다 조용하면 '소리 없음'
const CLARITY_GATE = 0.72;    // 겹침이 이만큼은 돼야 음으로 친다 (잡음 거르기)
const PEAK_K = 0.88;          // 가장 높은 봉우리의 이 비율만 넘으면 '그 봉우리로 친다'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

let ctx = null;
let analyser = null;
let source = null;
let buf = null;
let lastHz = 0;
let smoothHz = 0;

/* A4 = 440Hz 를 기준으로 몇 번째 반음인지 */
export function noteOf(hz) {
  if (!hz) return null;
  const n = 69 + 12 * Math.log2(hz / 440);          // MIDI 번호
  const near = Math.round(n);
  return {
    midi: near,
    name: NOTE_NAMES[((near % 12) + 12) % 12],
    octave: Math.floor(near / 12) - 1,
    cents: Math.round((n - near) * 100)             // -50 ~ +50
  };
}
export const hzOfMidi = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ---- 소리 계산 (순수) ---------------------------------------------- */

/* 표본 뭉치 하나에서 음을 찾는다. hz 가 0 이면 '음이라 할 만한 게 없다'. */
export function detect(samples, sampleRate) {
  const N = Math.min(ACF_SIZE, samples.length);
  let energy = 0;
  for (let i = 0; i < N; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / N);
  if (rms < RMS_GATE) return { rms: rms, hz: 0, clarity: 0 };

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(N - 2, Math.floor(sampleRate / MIN_HZ));
  if (maxLag <= minLag) return { rms: rms, hz: 0, clarity: 0 };

  /* 밀기 양 lag 에서 얼마나 잘 겹치는가 (-1 ~ 1).
   * 겹친 길이로 정규화한다 — 안 하면 짧은 주기(높은 음)가 늘 이긴다. */
  const acf = (lag) => {
    let sum = 0, e1 = 0, e2 = 0;
    const n = N - lag;
    for (let i = 0; i < n; i++) {
      const a = samples[i], b = samples[i + lag];
      sum += a * b; e1 += a * a; e2 += b * b;
    }
    const norm = Math.sqrt(e1 * e2);
    return norm > 1e-9 ? sum / norm : 0;
  };

  /* 가장 잘 겹치는 자리를 그냥 고르면 안 된다.
   * 주기가 T 면 2T·3T·4T 에서도 똑같이 잘 겹쳐서(겹침값이 다 1에 가깝다)
   * 자칫 한두 옥타브 아래를 집는다. 그래서 '가장 높은 봉우리' 가 아니라
   * '충분히 높은 봉우리 중 가장 왼쪽(= 가장 짧은 주기)' 을 고른다. */
  const nsdf = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) nsdf[lag] = acf(lag);

  const isPeak = (lag) => nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1];
  let vmax = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) if (isPeak(lag) && nsdf[lag] > vmax) vmax = nsdf[lag];
  if (vmax < CLARITY_GATE) return { rms: rms, hz: 0, clarity: vmax };

  const thres = vmax * PEAK_K;
  let bestLag = -1, bestVal = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (isPeak(lag) && nsdf[lag] >= thres) { bestLag = lag; bestVal = nsdf[lag]; break; }
  }
  if (bestLag < 0) return { rms: rms, hz: 0, clarity: vmax };

  // 포물선으로 꼭짓점을 더 정확히 — 표본과 표본 사이의 값까지 집어낸다
  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = nsdf[bestLag - 1], y1 = bestVal, y2 = nsdf[bestLag + 1];
    const d = y0 + y2 - 2 * y1;
    if (Math.abs(d) > 1e-9) lag = bestLag - 0.5 * (y2 - y0) / d;
  }
  const hz = sampleRate / lag;
  if (hz < MIN_HZ || hz > MAX_HZ) return { rms: rms, hz: 0, clarity: bestVal };
  return { rms: rms, hz: hz, clarity: bestVal };
}

/* ---- 브라우저 쪽 ---------------------------------------------------- */

export function start(stream) {
  if (!stream) return false;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    stop(true);                                      // 이전 연결만 끊고 컨텍스트는 둔다
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);     // 출력에는 잇지 않는다 — 이으면 제 목소리가 되돌아온다
    buf = new Float32Array(analyser.fftSize);
    lastHz = 0; smoothHz = 0;
    return true;
  } catch (e) {
    analyser = null;
    return false;
  }
}

export function stop(keepCtx) {
  if (source) { try { source.disconnect(); } catch (e) { /* 무시 */ } }
  source = null;
  analyser = null;
  lastHz = 0; smoothHz = 0;
  if (!keepCtx && ctx) { try { ctx.close(); } catch (e) { /* 무시 */ } ctx = null; }
}

export const isOn = () => !!analyser;
export const waveform = () => buf;

/* 지금 한 순간을 읽는다 → { rms, hz, clarity } */
export function read() {
  if (!analyser || !buf) return { rms: 0, hz: 0, clarity: 0 };
  analyser.getFloatTimeDomainData(buf);
  const r = detect(buf, ctx.sampleRate);
  if (!r.hz) { lastHz = 0; smoothHz = 0; return r; }

  // 한 옥타브 튀는 흔한 오검출을 눌러 준다 — 한 프레임 만에 두 배로 뛰진 않는다
  if (lastHz) {
    const ratio = r.hz / lastHz;
    const jump = (ratio > 1.9 && ratio < 2.1) || (ratio > 0.47 && ratio < 0.53);
    if (jump) { lastHz = r.hz; return { rms: r.rms, hz: smoothHz || r.hz, clarity: r.clarity }; }
  }
  lastHz = r.hz;
  smoothHz = smoothHz ? smoothHz + (r.hz - smoothHz) * 0.45 : r.hz;   // 조금 다듬는다
  return { rms: r.rms, hz: smoothHz, clarity: r.clarity };
}
