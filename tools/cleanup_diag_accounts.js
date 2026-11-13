/* 清理诊断脚本创建的临时账号与房间（只删白名单里的测试名，不碰真实数据）
 * 用法：node tools/cleanup_diag_accounts.js
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

const emailOf = u => crypto.createHash('sha256')
  .update('travel-memory:' + u.trim().toLowerCase()).digest('hex') + '@users.travel-memory.app';

// 只清理本会话诊断脚本用的前缀，避免误删任何真实账号
const NAMES = process.argv.slice(2);

(async () => {
  if (!NAMES.length) { console.log('用法: node tools/cleanup_diag_accounts.js <用户名...>'); return; }
  for (const name of NAMES) {
    const email = emailOf(name);
    const li = await req('POST', '/auth/v1/token?grant_type=password',
      { body: { email, password: 'Test123456' } });
    if (!li.json || !li.json.access_token) {
      console.log(`- ${name}: 登录失败（可能已不存在）${li.status} ${li.text.slice(0, 80)}`);
      continue;
    }
    const auth = { Authorization: 'Bearer ' + li.json.access_token };
    const uid = li.json.user.id;

    // 该账号名下的房间（房主）→ 逐个删（照片行随级联删除，文件由 delete_own_account 清）
    const rm = await req('GET', '/rest/v1/rooms?select=id,name&owner_id=eq.' + uid, { headers: auth });
    const rooms = (rm.json || []);
    for (const room of rooms) {
      const d = await req('DELETE', '/rest/v1/rooms?id=eq.' + room.id, { headers: auth });
      console.log(`- ${name}: 删除房间「${room.name}」→ ${d.status}`);
    }

    const del = await req('POST', '/rest/v1/rpc/delete_own_account', { headers: auth, body: {} });
    console.log(`- ${name}: 注销账号 → ${del.status === 204 || del.status === 200 ? '✅' : del.status + ' ' + del.text.slice(0, 80)}`);
  }

  const left = await req('POST', '/rest/v1/rpc/search_rooms', { body: { p_q: '' } });
  console.log('\n剩余房间:', (left.json || []).map(r => r.name + `(${r.member_count}人)`).join(', ') || '(无)');
})().catch(e => console.error('清理异常:', e.message));
