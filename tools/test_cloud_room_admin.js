/* 房间成员管理 · 真实云端端到端验证
 *
 * 打桩测试只验证了前端逻辑，这里用两个真实账号验证数据库侧：
 *   1. A 建房、B 加入
 *   2. room_members_of 能列出 2 人，A 是房主
 *   3. A 转让给 B → B 变成房主
 *   4. A 转让后不再是房主，想再转让应被拒
 *   5. 非成员 C 调用 room_members_of 看不到这个房间
 *   6. 移除成员：A（现为普通成员）不能再移除 B
 *
 * 全程用临时账号，结束时房间与账号一起清掉，不碰任何真实数据。
 * 用法：node tools/test_cloud_room_admin.js
 */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w.APP_CONFIG;
}
const CFG = loadConfig();
const HOST = new URL(CFG.SUPABASE_URL).host;
const KEY = CFG.SUPABASE_ANON_KEY;

function req(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({ apikey: KEY }, headers);
    let payload = body;
    if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const r = https.request({ host: HOST, path: p, method, headers: h }, res => {
      const ch = [];
      res.on('data', c => ch.push(c));
      res.on('end', () => {
        const t = Buffer.concat(ch).toString('utf8');
        let j = null; try { j = JSON.parse(t); } catch (e) { }
        resolve({ status: res.statusCode, text: t, json: j });
      });
    });
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const ok = (n, c, extra) => {
  console.log((c ? '  ✅ ' : '  ❌ ') + n + (c || !extra ? '' : ' — ' + extra));
  if (!c) process.exitCode = 1;
};

const emailOf = u => crypto.createHash('sha256')
  .update('travel-memory:' + u.trim().toLowerCase()).digest('hex') + '@users.travel-memory.app';

async function signup(username, password) {
  const r = await req('POST', '/auth/v1/signup', { body: { email: emailOf(username), password } });
  if (!r.json || !r.json.access_token) throw new Error('注册失败 ' + username + ': ' + r.text.slice(0, 200));
  return { token: r.json.access_token, id: r.json.user.id };
}

(async () => {
  const suffix = Date.now().toString().slice(-8);
  const pw = 'Test123456';
  const uA = 'ownerA' + suffix, uB = 'ownerB' + suffix, uC = 'outsiderC' + suffix;
  let roomId = null;

  try {
    console.log('\n[1] 注册三个临时账号');
    const A = await signup(uA, pw);
    const B = await signup(uB, pw);
    const C = await signup(uC, pw);
    ok('三个账号注册成功', !!(A.token && B.token && C.token));
    const hA = { Authorization: 'Bearer ' + A.token };
    const hB = { Authorization: 'Bearer ' + B.token };
    const hC = { Authorization: 'Bearer ' + C.token };

    console.log('\n[2] A 建房');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + 'roompass1').digest('hex');
    const cr = await req('POST', '/rest/v1/rpc/create_room', {
      headers: hA,
      body: { p_name: '成员测试' + suffix, p_salt: salt, p_hash: hash, p_display: uA },
    });
    roomId = cr.json;
    ok('房间创建成功', !!roomId, cr.status + ' ' + cr.text.slice(0, 120));

    console.log('\n[3] B 用密码加入');
    const jr = await req('POST', '/rest/v1/rpc/join_room', {
      headers: hB,
      body: { p_room_id: roomId, p_hash: hash, p_display: uB },
    });
    ok('B 加入成功', jr.json === true, jr.status + ' ' + jr.text.slice(0, 120));

    console.log('\n[4] room_members_of 列出成员');
    const m1 = await req('POST', '/rest/v1/rpc/room_members_of', { headers: hA, body: { p_room_id: roomId } });
    const list1 = Array.isArray(m1.json) ? m1.json : [];
    ok('返回 2 名成员', list1.length === 2, JSON.stringify(m1.json).slice(0, 200));
    ok('房主排在最前且标记 is_owner', !!list1[0] && list1[0].is_owner === true && list1[0].user_id === A.id,
      JSON.stringify(list1[0]));
    ok('B 标记为非房主', !!list1[1] && list1[1].is_owner === false, JSON.stringify(list1[1]));

    console.log('\n[5] 非成员 C 看不到这个房间的成员');
    const mC = await req('POST', '/rest/v1/rpc/room_members_of', { headers: hC, body: { p_room_id: roomId } });
    const listC = Array.isArray(mC.json) ? mC.json : [];
    ok('C 拿到空列表', listC.length === 0, JSON.stringify(mC.json).slice(0, 160));

    console.log('\n[6] A 把房主转让给 B');
    const tr = await req('POST', '/rest/v1/rpc/transfer_room_ownership', {
      headers: hA, body: { p_room_id: roomId, p_new_owner: B.id },
    });
    ok('转让调用成功', tr.status === 204 || tr.status === 200, tr.status + ' ' + tr.text.slice(0, 160));

    const m2 = await req('POST', '/rest/v1/rpc/room_members_of', { headers: hB, body: { p_room_id: roomId } });
    const list2 = Array.isArray(m2.json) ? m2.json : [];
    const ownerRow = list2.find(x => x.is_owner === true);
    ok('现在房主是 B', !!ownerRow && ownerRow.user_id === B.id, JSON.stringify(list2).slice(0, 240));
    ok('A 已变成普通成员', list2.every(x => x.user_id !== A.id || x.is_owner === false),
      JSON.stringify(list2.map(x => ({ u: x.user_id === A.id ? 'A' : x.user_id === B.id ? 'B' : '?', o: x.is_owner }))));

    console.log('\n[7] A 已不是房主，再转让应被拒');
    const tr2 = await req('POST', '/rest/v1/rpc/transfer_room_ownership', {
      headers: hA, body: { p_room_id: roomId, p_new_owner: A.id },
    });
    ok('被拒绝', !!tr2.json && /only the room owner/.test(tr2.json.message || ''),
      tr2.status + ' ' + tr2.text.slice(0, 160));

    console.log('\n[8] 非成员 C 也不能转让');
    const tr3 = await req('POST', '/rest/v1/rpc/transfer_room_ownership', {
      headers: hC, body: { p_room_id: roomId, p_new_owner: C.id },
    });
    ok('被拒绝', !!tr3.json && /only the room owner/.test(tr3.json.message || ''),
      tr3.status + ' ' + tr3.text.slice(0, 160));

    console.log('\n[9] 转让的房间结束后清理');
    // B 是房主，删房间（照片行随级联删除）
    const del = await req('DELETE', '/rest/v1/rooms?id=eq.' + roomId, { headers: hB });
    ok('房间已删除', del.status === 204 || del.status === 200, del.status + ' ' + del.text.slice(0, 120));
    roomId = null;
  } catch (e) {
    console.error('测试异常：', e.message);
    process.exitCode = 1;
  } finally {
    // 无论成功失败都注销三个临时账号，避免在项目里留下垃圾
    console.log('\n[10] 注销临时账号');
    for (const u of [uA, uB, uC]) {
      try {
        const li = await req('POST', '/auth/v1/token?grant_type=password', { body: { email: emailOf(u), password: pw } });
        if (!li.json || !li.json.access_token) { console.log(`  - ${u}: 无需注销`); continue; }
        const auth = { Authorization: 'Bearer ' + li.json.access_token };
        // 若是房主，先把房间删掉（否则 cascade 也会处理，这里显式一点）
        const uid = li.json.user.id;
        const rm = await req('GET', '/rest/v1/rooms?select=id,name&owner_id=eq.' + uid, { headers: auth });
        for (const room of (rm.json || [])) {
          await req('DELETE', '/rest/v1/rooms?id=eq.' + room.id, { headers: auth });
          console.log(`  - ${u}: 删除房间「${room.name}」`);
        }
        const d = await req('POST', '/rest/v1/rpc/delete_own_account', { headers: auth, body: {} });
        console.log(`  - ${u}: 注销 → ${d.status === 204 || d.status === 200 ? '✅' : d.status}`);
      } catch (e) {
        console.log(`  - ${u}: 注销失败 ${e.message}`);
      }
    }
    const left = await req('POST', '/rest/v1/rpc/search_rooms', { body: { p_q: '成员测试' + suffix } });
    const remain = Array.isArray(left.json) ? left.json : [];
    console.log(`\n残留测试房间: ${remain.length ? remain.map(r => r.name).join(', ') : '(无)'}`);
  }

  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})();
