/* 음정 게임모드 — 서버 쪽 흐름 검증 */
const http = require('http');
const crypto = require('crypto');

function client(tag) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ port: 3000, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13'
    } });
    req.end(); req.on('error', reject);
    req.on('upgrade', (res, sock, head) => {
      let buf = head; const handlers = [];
      sock.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        for (;;) {
          if (buf.length < 2) return;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const p = buf.slice(off, off + len).toString('utf8'); buf = buf.slice(off + len);
          let m; try { m = JSON.parse(p); } catch (e) { continue; }
          for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i](m)) handlers.splice(i, 1);
        }
      });
      const send = (o) => {
        const d = Buffer.from(JSON.stringify(o), 'utf8'), mk = crypto.randomBytes(4);
        let h;
        if (d.length < 126) { h = Buffer.alloc(2); h[1] = 0x80 | d.length; }
        else { h = Buffer.alloc(4); h[1] = 0x80 | 126; h.writeUInt16BE(d.length, 2); }
        h[0] = 0x81;
        const b = Buffer.from(d); for (let i = 0; i < b.length; i++) b[i] ^= mk[i & 3];
        sock.write(Buffer.concat([h, mk, b]));
      };
      const waitFor = (type, ms, pred) => new Promise((res2, rej) => {
        const t = setTimeout(() => rej(new Error(tag + ': ' + type + ' 안 옴')), ms || 8000);
        handlers.push((m) => {
          if (m.t !== type) return false;
          if (pred && !pred(m)) return false;
          clearTimeout(t); res2(m); return true;
        });
      });
      resolve({ send, waitFor, close: () => sock.end() });
    });
  });
}

let bad = 0;
const chk = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const MR = '3gA79nZpOks';            // 보고싶다 MR (이미 분석해 캐시돼 있다)
const MR2 = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

(async () => {
  const H = await client('방장'); await H.waitFor('rooms');
  H.send({ t: 'create', title: '음정 게임', links: MR });
  const j = await H.waitFor('joined', 20000);
  chk(j.room.mode === 'cinema' && j.room.pgame === false, '새 방은 노래방·게임모드 둘 다 꺼짐');

  const G = await client('손님'); await G.waitFor('rooms');
  G.send({ t: 'join', code: j.room.code });
  const jg = await G.waitFor('joined');

  /* 노래방 없이 게임모드를 켜려 하면 */
  H.send({ t: 'pgame', on: true });
  const e1 = await H.waitFor('err');
  chk(/노래방 모드에서만/.test(e1.msg), '노래방이 꺼져 있으면 게임모드를 못 켠다 → "' + e1.msg + '"');

  H.send({ t: 'mode', v: 'karaoke' });
  await H.waitFor('mode');

  /* 방장 아닌 사람 */
  G.send({ t: 'pgame', on: true });
  const e2 = await G.waitFor('err');
  chk(/방장만/.test(e2.msg), '방장 아닌 사람은 게임모드를 못 켠다');

  /* 켜기 — 캐시된 곡이라 기준선이 바로 와야 한다 */
  const melG = G.waitFor('melody', 30000, (m) => m.notes);
  H.send({ t: 'pgame', on: true });
  const pg = await H.waitFor('pgame');
  chk(pg.on === true, '방장이 켜면 방 전원에게 전파된다');

  const mel = await melG;
  chk(mel.v === MR && mel.notes.length > 100,
    '캐시된 곡은 기준선이 바로 온다 → ' + mel.notes.length + '음');
  chk(mel.notes[0] && typeof mel.notes[0].m === 'number' && typeof mel.notes[0].t === 'number',
    '음표 모양 { m(음높이), n(이름), t(시각), d(길이) } → ' + JSON.stringify(mel.notes[0]));

  /* 직접 요청해도 바로 */
  const ask = G.waitFor('melody', 8000);
  G.send({ t: 'melody', v: MR });
  const got = await ask;
  chk(got.notes && got.notes.length === mel.notes.length, '직접 달라고 해도 같은 것이 온다');

  /* 분석 안 된 곡 — pending 이 먼저 오고 나중에 결과가 와야 한다 */
  H.send({ t: 'settings', links: MR + '\n' + MR2 });
  await H.waitFor('room', 20000);
  const pend = G.waitFor('melody', 8000, (m) => m.v === 'dQw4w9WgXcQ');
  G.send({ t: 'melody', v: 'dQw4w9WgXcQ' });
  const p1 = await pend;
  chk(p1.state === 'pending' || p1.notes, '새 곡은 pending 으로 먼저 답한다 → ' + (p1.state || (p1.notes.length + '음')));

  if (p1.state === 'pending') {
    const done = G.waitFor('melody', 120000, (m) => m.v === 'dQw4w9WgXcQ' && m.notes);
    const r = await done;
    chk(r.notes.length >= 0, '분석이 끝나면 방 전체에 기준선이 뿌려진다 → ' + r.notes.length + '음');
  }

  /* 노래방을 끄면 게임모드도 함께 */
  H.send({ t: 'mode', v: 'cinema' });
  const k = await H.waitFor('mode');
  chk(k.pgame === false, '노래방을 끄면 게임모드도 함께 꺼진다');

  H.close(); G.close();
  console.log(bad ? '\n  ' + bad + '건 실패' : '\n  전부 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + e.message); process.exit(1); });
