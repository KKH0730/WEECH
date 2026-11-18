#!/usr/bin/env node
/* ------------------------------------------------------------------
 *  test/run.js — 서버를 띄우고 모든 묶음을 돌린 뒤 내린다.
 *
 *      node test/run.js        전부
 *      node test/run.js pitch  이름에 'pitch' 가 든 것만
 *
 *  외부 패키지는 쓰지 않는다. 서버가 이미 떠 있으면 그걸 그대로 쓴다.
 * ------------------------------------------------------------------ */
'use strict';

const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const SUITES = [
  { file: 'pitch_test.mjs', name: '음정 감지', needsServer: false },
  { file: 'name_test.js', name: '이름 자동부여·바꾸기', needsServer: true },
  { file: 'room_test.js', name: 'Play 모드·마이크·권한', needsServer: true },
  { file: 'pgame_test.js', name: '음정 게임모드', needsServer: true, needsNet: true }
];

const alive = () => new Promise((res) => {
  const s = net.connect(PORT, '127.0.0.1');
  s.on('connect', () => { s.destroy(); res(true); });
  s.on('error', () => res(false));
  setTimeout(() => { s.destroy(); res(false); }, 1200);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(tries) {
  for (let i = 0; i < (tries || 40); i++) {
    if (await alive()) return true;
    await sleep(250);
  }
  return false;
}

function run(file) {
  return new Promise((res) => {
    const ps = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: ROOT, stdio: 'inherit'
    });
    ps.on('close', (code) => res(code === 0));
    ps.on('error', () => res(false));
  });
}

(async () => {
  const only = process.argv[2];
  const picked = SUITES.filter((s) => !only || s.file.indexOf(only) >= 0 || s.name.indexOf(only) >= 0);
  if (!picked.length) { console.log('  그런 묶음이 없습니다: ' + only); process.exit(1); }

  let server = null;
  const needServer = picked.some((s) => s.needsServer);
  if (needServer && !(await alive())) {
    console.log('  서버를 띄웁니다 (포트 ' + PORT + ')…');
    server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env)
    });
    if (!(await waitUp())) {
      console.log('  ✗ 서버가 뜨지 않았습니다');
      try { server.kill(); } catch (e) { /* 무시 */ }
      process.exit(1);
    }
  } else if (needServer) {
    console.log('  이미 떠 있는 서버를 씁니다 (포트 ' + PORT + ')');
  }

  const results = [];
  for (const s of picked) {
    console.log('\n──────── ' + s.name + '  (' + s.file + ') ────────');
    const ok = await run(s.file);
    results.push({ name: s.name, ok: ok, net: !!s.needsNet });
  }

  if (server) { try { server.kill(); } catch (e) { /* 무시 */ } }

  console.log('\n════════ 정리 ════════');
  let bad = 0;
  for (const r of results) {
    console.log('  ' + (r.ok ? '✓' : '✗') + '  ' + r.name + (r.net && !r.ok ? '   (인터넷·yt-dlp 가 필요한 묶음입니다)' : ''));
    if (!r.ok) bad++;
  }
  console.log(bad ? '\n  ' + bad + '묶음 실패' : '\n  전부 통과');
  process.exit(bad ? 1 : 0);
})();
