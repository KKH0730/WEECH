/* ------------------------------------------------------------------
 *  melody.js — MR 에서 주선율을 뽑아 둔다 (서버 쪽)
 *
 *    ① yt-dlp 로 오디오를 받고
 *    ② ffmpeg 으로 16kHz 모노 PCM 으로 풀고
 *    ③ 배음 합산 + Viterbi 로 주선율을 찾고
 *    ④ 영상 ID 로 캐시해 둔다
 *
 *  곡 하나에 받기 1~2초 + 분석 2초 남짓. 한 번 해 두면 다시 하지 않는다.
 *
 *  yt-dlp 나 ffmpeg 이 없으면 이 기능만 조용히 꺼지고 나머지는 그대로 돈다.
 *  저장소를 받아 간 사람이 아무것도 설치하지 않아도 되게 하려는 것이다.
 *
 *  ※ 보컬이 들어 있는 원곡에는 쓸 수 없다. 여러 음이 동시에 나면 '주기가 하나'
 *     라는 전제가 깨진다. 노래방 MR 처럼 주선율이 한 가닥일 때를 전제한다.
 * ------------------------------------------------------------------ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SR = 16000;
const FFT = 2048, HOP = 256;
const LO_MIDI = 50, HI_MIDI = 84;      // D3 ~ C6
const PER_SEMI = 3;                    // 반음을 3칸으로 나눠 본다
const JUMP_PENALTY = 0.18;             // 음정이 뛸 때 주는 벌점
const MIN_NOTE = 0.08;                 // 이보다 짧은 음은 버린다 (초)
const MAX_SECONDS = 12 * 60;           // 너무 긴 영상은 건드리지 않는다

let cacheDir = null;
let log = function () {};
let tools = { ytdlp: null, ffmpeg: null };

const memo = new Map();                // videoId -> chart (파일을 매번 읽지 않게)
const inflight = new Map();            // videoId -> Promise
const queue = [];                      // 한 번에 하나씩만 돌린다
let busy = false;

/* ---- 도구 찾기 ---------------------------------------------------- */

function findTool(cands) {
  for (const c of cands) {
    try {
      const r = spawnSync(c.cmd, c.args, { timeout: 8000 });
      if (r.status === 0) return c;
    } catch (e) { /* 다음 후보로 */ }
  }
  return null;
}

function init(opts) {
  cacheDir = (opts && opts.dir) || path.join(__dirname, 'cache', 'melody');
  log = (opts && opts.log) || function () {};
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* 무시 */ }

  tools.ytdlp = findTool([
    { cmd: 'yt-dlp', args: ['--version'], run: 'yt-dlp', pre: [] },
    { cmd: 'python', args: ['-m', 'yt_dlp', '--version'], run: 'python', pre: ['-m', 'yt_dlp'] },
    { cmd: 'py', args: ['-m', 'yt_dlp', '--version'], run: 'py', pre: ['-m', 'yt_dlp'] }
  ]);
  tools.ffmpeg = findTool([{ cmd: 'ffmpeg', args: ['-version'], run: 'ffmpeg', pre: [] }]);
  return ready();
}

const ready = () => !!(tools.ytdlp && tools.ffmpeg);

function reason() {
  if (ready()) return '';
  const miss = [];
  if (!tools.ytdlp) miss.push('yt-dlp');
  if (!tools.ffmpeg) miss.push('ffmpeg');
  return miss.join(' · ') + ' 이(가) 없습니다';
}

/* ---- 캐시 ---------------------------------------------------------- */

const okId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
const fileOf = (id) => path.join(cacheDir, id + '.json');

function cached(id) {
  if (!okId(id)) return null;
  if (memo.has(id)) return memo.get(id);
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
    memo.set(id, j);
    return j;
  } catch (e) { return null; }
}

/* ---- 바깥에서 부르는 것 -------------------------------------------- */

/* 차트를 얻는다. 이미 있으면 바로, 없으면 줄을 서서 분석한다.
 * 분석이 안 되는 곡이면 { notes: [] } 를 캐시해 두고 다시 시도하지 않는다. */
function request(id) {
  if (!ready() || !okId(id)) return Promise.resolve(null);
  const hit = cached(id);
  if (hit) return Promise.resolve(hit);
  if (inflight.has(id)) return inflight.get(id);

  const p = new Promise((resolve) => { queue.push({ id: id, resolve: resolve }); pump(); });
  inflight.set(id, p);
  return p;
}

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const job = queue.shift();
  const t0 = Date.now();
  build(job.id)
    .then((chart) => {
      try { fs.writeFileSync(fileOf(job.id), JSON.stringify(chart)); } catch (e) { /* 무시 */ }
      memo.set(job.id, chart);
      log('  멜로디 분석 [' + job.id + '] ' + chart.notes.length + '음 / ' +
        ((Date.now() - t0) / 1000).toFixed(1) + '초');
      job.resolve(chart);
    })
    .catch((e) => {
      log('  멜로디 분석 실패 [' + job.id + '] ' + ((e && e.message) || e));
      const empty = { v: job.id, notes: [], failed: true };
      memo.set(job.id, empty);     // 같은 곡으로 계속 붙들리지 않게 — 파일로는 남기지 않는다
      job.resolve(empty);
    })
    .then(() => { inflight.delete(job.id); busy = false; pump(); });
}

/* ---- ①받기 ②풀기 ③분석 --------------------------------------------- */

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, Object.assign({ windowsHide: true }, opts || {}));
    const chunks = [];
    let err = '';
    if (ps.stdout) ps.stdout.on('data', (c) => chunks.push(c));
    if (ps.stderr) ps.stderr.on('data', (c) => { err += c.toString(); if (err.length > 4000) err = err.slice(-2000); });
    const timer = setTimeout(() => { try { ps.kill(); } catch (e) { /* 무시 */ } reject(new Error('시간 초과')); }, 180000);
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(cmd + ' 종료코드 ' + code + (err ? ' — ' + err.split('\n').filter(Boolean).pop() : '')));
    });
  });
}

async function build(id) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weech-mr-'));
  try {
    // ① 받기 — 오디오만, 재생목록 무시
    const out = path.join(tmp, 'a.%(ext)s');
    await run(tools.ytdlp.run, tools.ytdlp.pre.concat([
      '--no-warnings', '--no-playlist', '--no-progress',
      '--match-filter', 'duration < ' + MAX_SECONDS,
      '-f', 'bestaudio/best', '-o', out,
      'https://www.youtube.com/watch?v=' + id
    ]));
    const got = fs.readdirSync(tmp).filter((f) => f.startsWith('a.'));
    if (!got.length) throw new Error('받은 파일이 없습니다 (너무 길거나 받을 수 없는 영상)');

    // ② 풀기 — 16kHz 모노 PCM. 멜로디는 1.1kHz 아래라 이걸로 충분하다
    const pcm = await run(tools.ffmpeg.run, [
      '-v', 'error', '-i', path.join(tmp, got[0]),
      '-ac', '1', '-ar', String(SR), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'
    ]);
    if (pcm.length < SR * 2 * 5) throw new Error('오디오가 너무 짧습니다');

    // ③ 분석
    const notes = extract(pcm);
    return { v: id, sr: SR, notes: notes };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
  }
}

/* ---- 주선율 뽑기 ---------------------------------------------------- */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = (midi) => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

function extract(pcm) {
  const N = pcm.length >> 1;
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = pcm.readInt16LE(i * 2) / 32768;

  const win = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1));

  const frames = Math.floor((N - FFT) / HOP);
  if (frames < 10) return [];
  const binHz = SR / FFT, HALF = FFT / 2;

  const C = (HI_MIDI - LO_MIDI) * PER_SEMI + 1;
  const candHz = new Float64Array(C);
  for (let c = 0; c < C; c++) candHz[c] = 440 * Math.pow(2, (LO_MIDI + c / PER_SEMI - 69) / 12);

  const sal = new Float32Array(frames * C);
  const frameE = new Float32Array(frames);
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  const mag = new Float64Array(HALF), flat = new Float64Array(HALF);
  const eLo = Math.floor(200 / binHz), eHi = Math.floor(1200 / binHz);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < HALF; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

    /* 평탄화 — 주변 평균으로 나눈다. 넓게 퍼진 큰 에너지(베이스·드럼)는 눌리고
     * 뾰족한 봉우리(음의 배음)만 남는다. 이게 없으면 베이스만 따라간다. */
    const Wn = 21;
    for (let k = 0; k < HALF; k++) {
      const a = Math.max(0, k - Wn), b = Math.min(HALF - 1, k + Wn);
      let s = 0, n = 0;
      for (let i = a; i <= b; i += 3) { s += mag[i]; n++; }
      flat[k] = Math.max(0, mag[k] / (s / n + 1e-9) - 1);
    }

    let e = 0;
    for (let k = eLo; k < eHi; k++) e += mag[k];
    frameE[f] = e;

    /* 배음 합산 + 옥타브 보정 */
    for (let c = 0; c < C; c++) {
      const f0 = candHz[c];
      let s = 0;
      for (let h = 1; h <= 6; h++) {
        const k = Math.round(f0 * h / binHz);
        if (k >= HALF - 1) break;
        s += Math.max(flat[k - 1], flat[k], flat[k + 1]) * Math.pow(0.86, h - 1);
      }
      // 홀수 배음(3·5배)이 비어 있으면 깎는다 — 옥타브 위를 잘못 집는 것을 막는다
      let odd = 0;
      for (let hi2 = 0; hi2 < 2; hi2++) {
        const h = hi2 ? 5 : 3;
        const k = Math.round(f0 * h / binHz);
        if (k < HALF - 1) odd += Math.max(flat[k - 1], flat[k], flat[k + 1]);
      }
      sal[f * C + c] = s * (0.55 + 0.45 * Math.min(1, odd / (s * 0.4 + 1e-9)));
    }
  }

  // 프레임마다 0~1 로 — 큰 소리 구간이 전체를 지배하지 않게
  for (let f = 0; f < frames; f++) {
    let mx = 0;
    for (let c = 0; c < C; c++) if (sal[f * C + c] > mx) mx = sal[f * C + c];
    if (mx > 0) for (let c = 0; c < C; c++) sal[f * C + c] /= mx;
  }

  /* Viterbi — 멜로디는 이어진다. 프레임마다 최고점만 고르면 코드 음 사이를
   * 널뛴다. 도약에 벌점을 주고 전체 경로를 한 번에 고르면 선율이 드러난다. */
  const dp = new Float32Array(frames * C);
  const bk = new Int16Array(frames * C);
  for (let c = 0; c < C; c++) dp[c] = sal[c];
  const SPAN = PER_SEMI * 9;
  for (let f = 1; f < frames; f++) {
    const pb = (f - 1) * C, cb = f * C;
    for (let c = 0; c < C; c++) {
      let best = -1e9, bi = 0;
      const lo = c - SPAN < 0 ? 0 : c - SPAN, hi = c + SPAN > C - 1 ? C - 1 : c + SPAN;
      for (let p = lo; p <= hi; p++) {
        const v = dp[pb + p] - JUMP_PENALTY * Math.abs(p - c) / PER_SEMI;
        if (v > best) { best = v; bi = p; }
      }
      dp[cb + c] = best + sal[cb + c];
      bk[cb + c] = bi;
    }
  }
  let endC = 0, endV = -1e9;
  for (let c = 0; c < C; c++) if (dp[(frames - 1) * C + c] > endV) { endV = dp[(frames - 1) * C + c]; endC = c; }
  const pathIdx = new Int16Array(frames);
  pathIdx[frames - 1] = endC;
  for (let f = frames - 1; f > 0; f--) pathIdx[f - 1] = bk[f * C + pathIdx[f]];

  // 소리가 있는 구간만 — 멜로디 대역이 바닥이면 쉼표로 본다
  const sorted = Array.from(frameE).sort((a, b) => a - b);
  const gate = sorted[Math.floor(frames * 0.35)];

  /* 프레임을 음표로 묶는다 */
  const notes = [];
  let st = -1, cur = -1;
  for (let f = 0; f <= frames; f++) {
    const on = f < frames && frameE[f] > gate && sal[f * C + pathIdx[f]] > 0.35;
    const midi = on ? Math.round(LO_MIDI + pathIdx[f] / PER_SEMI) : -1;
    if (midi !== cur) {
      if (st >= 0 && cur >= 0) {
        const len = (f - st) * HOP / SR;
        if (len >= MIN_NOTE) {
          notes.push({
            m: cur, n: nameOf(cur),
            t: Math.round(st * HOP / SR * 1000) / 1000,
            d: Math.round(len * 1000) / 1000
          });
        }
      }
      st = f; cur = midi;
    }
  }
  return notes;
}

module.exports = { init, ready, reason, cached, request, extract };
