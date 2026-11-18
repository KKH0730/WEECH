/* 링크 없이 만든 빈 방이 제대로 서고, 나중에 채울 수 있는가 */
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
      const never = (type, ms) => new Promise((res2) => {
        let got = null;
        const h = (m) => { if (m.t === type) { got = m; return true; } return false; };
        handlers.push(h);
        setTimeout(() => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); res2(got); }, ms || 900);
      });
      resolve({ send, waitFor, never, close: () => sock.end() });
    });
  });
}

let bad = 0;
const chk = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

(async () => {
  const H = await client('방장'); await H.waitFor('rooms');

  /* 링크 없이 만들기 */
  H.send({ t: 'create', title: '빈 방', links: '' });
  const j = await H.waitFor('joined', 10000);
  chk(Array.isArray(j.room.playlist) && j.room.playlist.length === 0, '링크 없이도 방이 만들어진다 (0곡)');
  chk(j.room.title === '빈 방', '제목은 그대로');
  chk(j.room.playing === false && j.room.idx === 0, '재생 상태가 멀쩡하다');

  /* 로비 목록에 보인다 */
  H.send({ t: 'rooms' });
  const list = await H.waitFor('rooms');
  const mine = (list.list || []).find((r) => r.code === j.room.code);
  chk(!!mine && mine.count === 0 && mine.now === '', '로비 목록에 0곡으로 보인다');

  /* 빈 상태에서 재생을 눌러도 아무 일 없어야 한다 */
  H.send({ t: 'ctrl', op: 'play', v: 0 });
  const played = await H.never('play', 900);
  chk(played === null, '빈 재생목록에서는 재생이 무시된다');

  /* 손님도 들어올 수 있다 */
  const G = await client('손님'); await G.waitFor('rooms');
  G.send({ t: 'join', code: j.room.code });
  const jg = await G.waitFor('joined');
  chk(jg.room.playlist.length === 0, '빈 방에 손님이 들어온다');

  /* 나중에 채우기 */
  H.send({ t: 'settings', links: 'kJQP7kiw5Fk' });
  const filled = await G.waitFor('room', 20000, (m) => m.playlist && m.playlist.length > 0);
  chk(filled.playlist.length === 1 && filled.playlist[0].id === 'kJQP7kiw5Fk', '들어와서 채우면 전원에게 전파된다');

  /* 이제는 재생된다 */
  H.send({ t: 'ctrl', op: 'play', v: 0 });
  const p2 = await H.waitFor('play', 4000);
  chk(p2.playing === true, '채운 뒤에는 재생이 먹는다');

  /* 알아보지 못하는 링크를 넣으면 그건 막는다 */
  const K = await client('딴사람'); await K.waitFor('rooms');
  K.send({ t: 'create', title: '엉뚱', links: 'https://example.com/없는것' });
  const e = await K.waitFor('err', 8000);
  chk(/찾지 못했습니다|링크/.test(e.msg), '링크를 넣었는데 못 알아들으면 알려 준다 → "' + e.msg + '"');

  H.close(); G.close(); K.close();
  console.log(bad ? '\n  ' + bad + '건 실패' : '\n  전부 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + e.message); process.exit(1); });
