/* 음정 감지 검증 — 아는 음을 만들어 넣고 제대로 집어내는지 본다 */
import { detect, noteOf, hzOfMidi } from '../public/pitch.js';

const SR = 48000;
const N = 1024;

/* 사람 목소리처럼 배음이 실린 소리를 만든다 (기음 + 2·3·4배음 + 잡음) */
function voice(hz, amp, noise) {
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    b[i] = amp * (
      1.00 * Math.sin(2 * Math.PI * hz * t) +
      0.50 * Math.sin(2 * Math.PI * hz * 2 * t + 0.7) +
      0.30 * Math.sin(2 * Math.PI * hz * 3 * t + 1.9) +
      0.15 * Math.sin(2 * Math.PI * hz * 4 * t + 2.6)
    ) / 1.95 + (noise ? (Math.random() - 0.5) * noise : 0);
  }
  return b;
}

let bad = 0;
const chk = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

console.log('[음 이름 환산]');
chk(noteOf(440).name === 'A' && noteOf(440).octave === 4 && noteOf(440).cents === 0, '440Hz → A4, 0센트');
chk(noteOf(261.6256).name === 'C' && noteOf(261.6256).octave === 4, '261.63Hz → C4');
chk(Math.abs(hzOfMidi(69) - 440) < 1e-9, 'MIDI 69 → 440Hz');
chk(Math.abs(noteOf(440 * Math.pow(2, 25 / 1200)).cents - 25) <= 1, '25센트 올린 A4 → +25센트');

console.log('\n[깨끗한 소리 — 음역 전체]');
const cases = [
  ['A2 (저음 남성)', 110],
  ['C3', 130.81],
  ['G3', 196.00],
  ['C4 (가온다)', 261.63],
  ['A4 (기준음)', 440],
  ['C5', 523.25],
  ['A5 (고음 여성)', 880]
];
for (const [label, hz] of cases) {
  const r = detect(voice(hz, 0.25, 0), SR);
  const cents = r.hz ? Math.round(1200 * Math.log2(r.hz / hz)) : 9999;
  chk(r.hz > 0 && Math.abs(cents) <= 12,
    label.padEnd(14) + hz.toFixed(2).padStart(7) + 'Hz → ' +
    (r.hz ? r.hz.toFixed(2).padStart(7) + 'Hz (' + (cents >= 0 ? '+' : '') + cents + '센트)' : '못 찾음'));
}

console.log('\n[잡음이 섞여도]');
for (const noise of [0.02, 0.06, 0.12]) {
  const r = detect(voice(440, 0.25, noise), SR);
  const cents = r.hz ? Math.round(1200 * Math.log2(r.hz / 440)) : 9999;
  chk(r.hz > 0 && Math.abs(cents) <= 20,
    '잡음 ' + noise.toFixed(2) + ' → ' + (r.hz ? r.hz.toFixed(1) + 'Hz (' + cents + '센트) 선명도 ' + r.clarity.toFixed(2) : '못 찾음'));
}

console.log('\n[소리가 아닌 것은 걸러낸다]');
const silence = new Float32Array(N);
chk(detect(silence, SR).hz === 0, '무음 → 0');
const hiss = new Float32Array(N);
for (let i = 0; i < N; i++) hiss[i] = (Math.random() - 0.5) * 0.5;
const h = detect(hiss, SR);
chk(h.hz === 0, '잡음만 → 0 (선명도 ' + h.clarity.toFixed(2) + ' < 0.72)');
const quiet = voice(440, 0.004, 0);
chk(detect(quiet, SR).hz === 0, '너무 작은 소리 → 0');

console.log('\n[비용]');
const big = voice(220, 0.25, 0.03);
const t0 = process.hrtime.bigint();
const LOOPS = 200;
for (let i = 0; i < LOOPS; i++) detect(big, SR);
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / LOOPS;
chk(ms < 8, '한 번에 ' + ms.toFixed(2) + 'ms (25Hz 로 돌리면 프레임의 ' + (ms / 40 * 100).toFixed(1) + '%)');

console.log(bad ? '\n  ' + bad + '건 실패' : '\n  전부 통과');
process.exit(bad ? 1 : 0);
