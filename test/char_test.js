/* 캐릭터 고르기(char) 중계 테스트 — 생 WebSocket 클라이언트
 *
 *  내가 고른 캐릭터 번호가 ① 들어갈 때 실려 가고 ② 바꾸면 방에 퍼지고
 *  ③ 엉터리 값은 서버가 줄 세우는지 본다. 서버는 몇 번이 누구인지를
 *  모른 채 숫자만 중계하므로, 여기가 깨지면 남들 화면에서 딴 사람이
 *  서 있게 된다. */
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

const gap = () => new Promise((r) => setTimeout(r, 450));   // 연타 방지 틈

(async () => {
  const A = await client('A');
  const MYCHAR = 5;

  //  방을 만들 때 고른 캐릭터를 실어 보낸다 (방장도 제 캐릭터로 서야 한다)
  A.send({ t: 'create', title: '캐릭터 시험', links: '', char: MYCHAR });
  const joinedA = await A.waitFor('joined');
  chk(joinedA.you > 0, '방이 만들어졌다');

  //  둘째 사람 — 아직 안 골랐다
  const B = await client('B');
  B.send({ t: 'join', code: joinedA.room.code });
  const joinedB = await B.waitFor('joined');

  //  B 가 받은 명단에 A 의 캐릭터가 실려 있어야 한다
  const aInList = joinedB.users.find((u) => u.id === joinedA.you);
  chk(aInList && aInList.char === MYCHAR,
    '방을 만들며 실은 캐릭터가 명단에 실린다 → ' + (aInList && aInList.char));

  //  A 에게는 B 의 입장이 user+ 로 온다 — 안 골랐으니 빈 채로
  const plus = await A.waitFor('user+');
  chk(plus.user.char === null || plus.user.char === undefined,
    '안 고른 사람은 빈 채로 온다 (받는 쪽이 이름에서 뽑는다)');

  //  캐릭터를 바꾸면 전원에게 퍼진다
  B.send({ t: 'char', v: 3 });
  const relay = await A.waitFor('char');
  chk(relay.id === joinedB.you && relay.v === 3,
    '바꾸면 방 전원에게 전해진다 → ' + relay.v);

  //  범위 밖 번호 — 서버는 몇 번까지 있는지 모르므로 0~63 으로만 접는다
  await gap();
  B.send({ t: 'char', v: 9999 });
  const big = await A.waitFor('char');
  chk(big.v === 63, '너무 큰 번호는 63 으로 접힌다 → ' + big.v);

  await gap();
  B.send({ t: 'char', v: -7 });
  const neg = await A.waitFor('char');
  chk(neg.v === 0, '음수는 0 으로 접힌다 → ' + neg.v);

  //  숫자가 아니면 중계 자체를 안 한다
  await gap();
  B.send({ t: 'char', v: 'hack' });
  B.send({ t: 'char', v: 2 });                       // 뒤이어 멀쩡한 것
  const after = await A.waitFor('char');
  chk(after.v === 2, '숫자가 아닌 값은 버려진다 (다음 멀쩡한 것만 옴)');

  A.close(); B.close();
  console.log(bad ? (String.fromCharCode(10) + '  ' + bad + '건 실패') : (String.fromCharCode(10) + '  전부 통과'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + e.message); process.exit(1); });
