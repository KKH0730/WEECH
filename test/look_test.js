/* 아바타 꾸미기(look) 중계 테스트 — 생 WebSocket 클라이언트
 *
 *  내가 고른 모습(번호 배열)이 ① 들어갈 때 실려 가고 ② 바꾸면 방에
 *  퍼지고 ③ 엉터리 값은 서버가 줄 세우는지 본다. 서버는 뜻을 모른 채
 *  숫자만 중계하므로, 여기가 깨지면 남들 화면에서 옷이 벗겨진다. */
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
  const A = await client('A');
  const MYLOOK = [1, 2, 3, 4, 5, 2, 1, 1, 2];

  //  방을 만들 때 look 을 실어 보낸다
  A.send({ t: 'create', title: 'look 시험', links: '' });
  const joinedA = await A.waitFor('joined');
  chk(joinedA.you > 0, '방이 만들어졌다');

  //  둘째 사람 — 들어가면서 제 모습을 싣는다
  const B = await client('B');
  B.send({ t: 'join', code: joinedA.room.code, look: MYLOOK });
  const joinedB = await B.waitFor('joined');

  //  A 에게는 B 의 입장이 user+ 로 오고, 거기 look 이 실려 있어야 한다
  const plus = await A.waitFor('user+');
  chk(JSON.stringify(plus.user.look) === JSON.stringify(MYLOOK),
    '들어올 때 실은 모습이 방에 퍼진다 → ' + JSON.stringify(plus.user.look));

  //  B 가 받은 명단에서 A 는 look 이 없다(안 꾸몄다) — null 로 와야 한다
  const aInList = joinedB.users.find((u) => u.id === joinedA.you);
  chk(aInList && (aInList.look === null || aInList.look === undefined),
    '안 꾸민 사람은 빈 모습으로 온다');

  //  옷을 갈아입으면 전원에게 퍼진다
  B.send({ t: 'look', v: [0, 1, 0, 2, 0, 3, 0] });
  const relay = await A.waitFor('look');
  chk(relay.id === joinedB.you && relay.v[3] === 2,
    '갈아입으면 방 전원에게 전해진다 → ' + JSON.stringify(relay.v));

  //  엉터리 값 — 서버가 숫자 일곱 개로 줄 세운다
  await new Promise((r) => setTimeout(r, 450));      // 연타 방지 틈
  B.send({ t: 'look', v: [999, -5, 'abc', {}, 3.9, null, 1e99] });
  const dirty = await A.waitFor('look');
  chk(dirty.v.length === 9 && dirty.v.every((n) => Number.isInteger(n) && n >= 0 && n <= 15),
    '엉터리 값은 아홉 칸 0~15 숫자로 줄 세워진다 → ' + JSON.stringify(dirty.v));

  //  배열이 아니면 중계 자체를 안 한다
  await new Promise((r) => setTimeout(r, 450));
  B.send({ t: 'look', v: 'hack' });
  B.send({ t: 'look', v: [7, 0, 0, 0, 0, 0, 0] });   // 뒤이어 멀쩡한 것
  const after = await A.waitFor('look');
  chk(after.v[0] === 7, '배열이 아닌 값은 버려진다 (다음 멀쩡한 것만 옴)');

    A.close(); B.close();
  console.log(bad ? (String.fromCharCode(10) + '  ' + bad + '건 실패') : (String.fromCharCode(10) + '  전부 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + e.message); process.exit(1); });
