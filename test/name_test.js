/* 닉네임 자동부여 + 이름 바꾸기 연기 테스트 — 생 WebSocket 클라이언트 */
const http = require('http');
const crypto = require('crypto');

function client(name) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ port: 3000, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13'
    } });
    req.end();
    req.on('error', reject);
    req.on('upgrade', (res, sock, head) => {
      const handlers = [];
      let buf = head;
      sock.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        for (;;) {
          if (buf.length < 2) return;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.slice(off, off + len).toString('utf8');
          buf = buf.slice(off + len);
          if ((head[0] & 0x0f) === 0x9) continue;
          let m; try { m = JSON.parse(payload); } catch (e) { continue; }
          for (let i = handlers.length - 1; i >= 0; i--) {
            if (handlers[i](m)) handlers.splice(i, 1);
          }
        }
      });
      const send = (obj) => {
        const data = Buffer.from(JSON.stringify(obj), 'utf8');
        const mask = crypto.randomBytes(4);
        let head2;
        if (data.length < 126) { head2 = Buffer.alloc(2); head2[1] = 0x80 | data.length; }
        else { head2 = Buffer.alloc(4); head2[1] = 0x80 | 126; head2.writeUInt16BE(data.length, 2); }
        head2[0] = 0x81;
        const masked = Buffer.from(data);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
        sock.write(Buffer.concat([head2, mask, masked]));
      };
      const waitFor = (type, ms) => new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(name + ': ' + type + ' 안 옴')), ms || 6000);
        handlers.push((m) => {
          if (m.t !== type) return false;
          clearTimeout(timer); res(m); return true;
        });
      });
      resolve({ send, waitFor, close: () => sock.end(), name });
    });
  });
}

const ok = (c, msg) => console.log((c ? '  ✓ ' : '  ✗ ') + msg) || c;
let bad = 0;
const chk = (c, msg) => { if (!ok(c, msg)) bad++; };

(async () => {
  /* 1. 이름 없이 방 만들기 */
  const a = await client('A');
  await a.waitFor('rooms');
  a.send({ t: 'create', title: '', links: 'dQw4w9WgXcQ' });
  const ja = await a.waitFor('joined', 12000);
  chk(typeof ja.name === 'string' && ja.name.length > 0, '방 만들 때 이름 자동 부여 → "' + ja.name + '"');
  chk(ja.name !== '익명', "'익명' 이 아니다");
  const code = ja.room.code;
  chk(ja.room.title === ja.name + '의 방', '제목 기본값에 지어준 이름이 쓰인다 → "' + ja.room.title + '"');

  /* 2. 이름 없이 참여 */
  const b = await client('B');
  await b.waitFor('rooms');
  b.send({ t: 'join', code: code });
  const jb = await b.waitFor('joined');
  chk(typeof jb.name === 'string' && jb.name.length > 0, '참여할 때 이름 자동 부여 → "' + jb.name + '"');
  chk(jb.name !== ja.name, '같은 방 안에서 이름이 겹치지 않는다');

  /* 3. 내 이름 바꾸기 — 방 전원에게 전파 */
  const seenByA = a.waitFor('rename');
  b.send({ t: 'rename', name: '김경호' });
  const rb = await b.waitFor('rename');
  const ra = await seenByA;
  chk(rb.name === '김경호' && rb.was === jb.name, '바꾼 사람에게 rename 도착 (was="' + rb.was + '")');
  chk(ra.id === jb.you && ra.name === '김경호', '같은 방 다른 사람에게도 전파된다');

  /* 4. 위치 브로드캐스트에 새 이름이 실린다 */
  const s = await a.waitFor('s');
  const row = (s.u || []).find((x) => x[0] === jb.you);
  chk(row && row[5] === '김경호', '10Hz 위치 패킷의 이름도 갱신된다');

  /* 5. 겹치는 이름은 거절 */
  a.send({ t: 'rename', name: '김경호' });
  const e = await a.waitFor('err');
  chk(/같은 이름/.test(e.msg), '이미 쓰는 이름은 거절 → "' + e.msg + '"');

  /* 6. 남의 이름은 못 바꾼다 (rename 에 id 가 없다 = 자기 것만) */
  a.send({ t: 'rename', name: '박방장' });
  const ra2 = await a.waitFor('rename');
  chk(ra2.id === ja.you, 'rename 은 늘 자기 자신에게만 적용된다');

  a.close(); b.close();
  console.log(bad ? '\n  ' + bad + '건 실패' : '\n  전부 통과');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + e.message); process.exit(1); });
