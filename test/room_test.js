/* 노래방 모드 서버 동작 검증 */
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
      const waitFor = (type, ms) => new Promise((res2, rej) => {
        const t = setTimeout(() => rej(new Error(tag + ': ' + type + ' 안 옴')), ms || 6000);
        handlers.push((m) => { if (m.t !== type) return false; clearTimeout(t); res2(m); return true; });
      });
      const never = (type, ms) => new Promise((res2) => {
        let got = null;
        const h = (m) => { if (m.t === type) { got = m; return true; } return false; };
        handlers.push(h);
        setTimeout(() => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); res2(got); }, ms || 900);
      });
      resolve({ send, waitFor, never, tag, close: () => sock.end() });
    });
  });
}

let bad = 0;
const chk = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const H = await client('방장'); await H.waitFor('rooms');
  H.send({ t: 'create', title: '노래방', links: 'kJQP7kiw5Fk' });
  const jh = await H.waitFor('joined', 15000);
  chk((jh.room.mode==='karaoke') === false, '새 방은 노래방 모드가 꺼져 있다');

  const G = await client('손님'); await G.waitFor('rooms');
  G.send({ t: 'join', code: jh.room.code });
  const jg = await G.waitFor('joined');

  /* 권한 */
  G.send({ t: 'mode', v: 'karaoke' });
  const e1 = await G.waitFor('err');
  chk(/방장만/.test(e1.msg), '방장 아닌 사람은 노래방을 켤 수 없다 → "' + e1.msg + '"');

  /* 켜기 */
  const seenByG = G.waitFor('mode');
  H.send({ t: 'mode', v: 'karaoke' });
  const kh = await H.waitFor('mode');
  const kg = await seenByG;
  chk(kh.v === 'karaoke' && kg.v === 'karaoke', '방장이 켜면 방 전원에게 전파된다');

  /* 늦게 들어온 사람도 켜진 상태를 받는다 */
  const L = await client('지각'); await L.waitFor('rooms');
  L.send({ t: 'join', code: jh.room.code });
  const jl = await L.waitFor('joined');
  chk(jl.room.mode === 'karaoke', '나중에 들어온 사람도 켜진 상태로 받는다');

  /* 마이크 */
  const micSeen = H.waitFor('mic');
  G.send({ t: 'mic', on: true });
  const mg = await micSeen;
  chk(mg.id === jg.you && mg.on === true, '마이크를 켜면 방 전원에게 알려진다');

  const s = await H.waitFor('s');
  const row = (s.u || []).find((x) => x[0] === jg.you);
  chk(!!row && row[10] === 1, '10Hz 묶음에도 마이크 상태가 실린다');

  /* 방장이 남의 마이크 끄기 */
  const offSeen = G.waitFor('mic');
  H.send({ t: 'micmute', id: jg.you, on: true });
  const forced = await offSeen;
  const mm = await G.waitFor('micmute');
  chk(forced.id === jg.you && forced.on === false, '방장이 끄면 그 사람 마이크가 바로 내려간다');
  chk(mm.id === jg.you && mm.on === true, '잠금 사실이 방 전원에게 전파된다');

  G.send({ t: 'mic', on: true });
  const e2 = await G.waitFor('err');
  chk(/방장이/.test(e2.msg), '잠긴 사람은 다시 켤 수 없다 → "' + e2.msg + '"');

  G.send({ t: 'micmute', id: jl.you, on: true });
  const e3 = await G.waitFor('err');
  chk(/방장만/.test(e3.msg), '방장 아닌 사람은 남의 마이크를 못 끈다');

  /* 연결용 쪽지 중계 */
  const toL = L.waitFor('rtc');
  const notToG = G.never('rtc', 900);
  H.send({ t: 'rtc', to: jl.you, data: { sdp: 'TEST' } });
  const got = await toL;
  chk(got.from === jh.you && got.data.sdp === 'TEST', 'rtc 쪽지가 지정한 사람에게 간다');
  chk((await notToG) === null, '다른 사람에게는 가지 않는다');

  /* 끄기 — 마이크가 모두 내려간다 */
  H.send({ t: 'mode', v: 'cinema' });
  await H.waitFor('mode');
  await sleep(250);
  const s2 = await H.waitFor('s');
  const anyMic = (s2.u || []).some((x) => x[10] === 1 || x[11] === 1);
  chk(!anyMic, '노래방을 끄면 모두의 마이크·잠금이 풀린다');

  H.send({ t: 'mic', on: true });
  const nope = await H.never('mic', 900);
  chk(nope === null, '꺼진 상태에서는 마이크 요청이 무시된다');

  H.close(); G.close(); L.close();
  console.log(bad ? '\n  ' + bad + '건 실패' : '\n  전부 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + e.message); process.exit(1); });
