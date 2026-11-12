/* 云端实况照片端到端验证
 * 流程：注册临时账号 → 建房 → 上传 jpg + mp4 → 写 photos 行（带 video_path）
 *       → 读回元数据 → 取签名 URL → 完全清理（删房间/文件/账号）
 * 只验证存储策略与表结构，不碰用户已有数据。
 *
 * 配置从 js/config.js 读取（与网站同源），脚本里不保存任何密钥。
 * 用法：node tools/test_cloud_live.js
 */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 读取 js/config.js：它在浏览器里是 script，这里用 vm 沙箱取 window.APP_CONFIG
function loadConfig() {
  const file = path.join(__dirname, '..', 'js', 'config.js');
  const src = fs.readFileSync(file, 'utf8');
  const window = {};
  // eslint-disable-next-line no-new-func
  new Function('window', src)(window);
  const c = window.APP_CONFIG || {};
  if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) {
    throw new Error('js/config.js 里缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY，无法测试云端功能');
  }
  return c;
}

const CFG = loadConfig();
const HOST = new URL(CFG.SUPABASE_URL).host;
const KEY = CFG.SUPABASE_ANON_KEY;

function req(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, headers);
    let payload = body;
    if (body && !Buffer.isBuffer(body) && typeof body !== 'string') {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const r = https.request({ host: HOST, path, method, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { }
        resolve({ status: res.statusCode, text, json });
      });
    });
    r.setTimeout(30000, () => { r.destroy(new Error('timeout')); });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const ok = (n, c, extra) => {
  console.log((c ? '  ✅ ' : '  ❌ ') + n + (c || !extra ? '' : ' — ' + extra));
  if (!c) process.exitCode = 1;
};

(async () => {
  const suffix = Date.now().toString().slice(-8);
  const username = 'livetest' + suffix;
  const password = 'Test123456';
  const email = crypto.createHash('sha256').update('travel-memory:' + username).digest('hex')
    + '@users.travel-memory.app';

  let userId = null, roomId = null, jpgPath = null, mp4Path = null, photoId = null;
  let token = KEY;

  try {
    console.log('\n[1] 注册临时账号');
    const su = await req('POST', '/auth/v1/signup', { body: { email, password } });
    ok('signup 成功', su.status === 200 && su.json && su.json.access_token, su.status + ' ' + su.text.slice(0, 160));
    if (!su.json || !su.json.access_token) throw new Error('注册失败，无法继续');
    token = su.json.access_token;
    userId = su.json.user && su.json.user.id;
    console.log('     user id: ' + userId);

    const auth = { Authorization: 'Bearer ' + token };

    console.log('\n[2] 创建房间');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + 'roompass1').digest('hex');
    const cr = await req('POST', '/rest/v1/rpc/create_room', {
      headers: auth,
      body: { p_name: '实况测试' + suffix, p_salt: salt, p_hash: hash, p_display: username }
    });
    ok('create_room 成功', cr.status === 200 && typeof cr.json === 'string', cr.status + ' ' + cr.text.slice(0, 160));
    roomId = cr.json;
    if (!roomId) throw new Error('建房失败');

    console.log('\n[3] 上传文件到 room-photos 桶（验证存储策略）');
    const jpgBytes = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKpgAAAAAP/Z',
      'base64');
    // 内容不参与策略判定，只验证扩展名放行
    const mp4Bytes = Buffer.concat([Buffer.from('00000018667479706d703432', 'hex'), Buffer.alloc(64, 0)]);

    jpgPath = `${roomId}/${crypto.randomUUID()}.jpg`;
    mp4Path = `${roomId}/${crypto.randomUUID()}.mp4`;

    const up1 = await req('POST', '/storage/v1/object/room-photos/' + jpgPath, {
      headers: Object.assign({ 'Content-Type': 'image/jpeg' }, auth), body: jpgBytes
    });
    ok('jpg 上传被放行', up1.status === 200, up1.status + ' ' + up1.text.slice(0, 200));

    const up2 = await req('POST', '/storage/v1/object/room-photos/' + mp4Path, {
      headers: Object.assign({ 'Content-Type': 'video/mp4' }, auth), body: mp4Bytes
    });
    ok('mp4 上传被放行（迁移核心目标）', up2.status === 200, up2.status + ' ' + up2.text.slice(0, 200));

    console.log('\n[4] 写入 photos 行（带 video_path）');
    photoId = crypto.randomUUID();
    const ins = await req('POST', '/rest/v1/photos', {
      headers: Object.assign({ Prefer: 'return=representation' }, auth),
      body: {
        id: photoId, room_id: roomId, loc_key: 'world:__livetest__',
        uploader_id: userId, uploader_name: username,
        cap: '实况端到端测试', shoot_date: '2026-11-12', ts: Date.now(),
        storage_path: jpgPath, video_path: mp4Path
      }
    });
    ok('插入成功（video_path 已落库）', ins.status === 201, ins.status + ' ' + ins.text.slice(0, 200));

    console.log('\n[5] 读回元数据');
    const sel = await req('GET',
      `/rest/v1/photos?select=id,loc_key,storage_path,video_path&room_id=eq.${roomId}`, { headers: auth });
    const row = sel.json && sel.json[0];
    ok('能读回且 video_path 非空', sel.status === 200 && row && row.video_path === mp4Path,
      JSON.stringify(sel.json));

    console.log('\n[6] 取签名 URL（成员浏览路径）');
    const sg = await req('POST', '/storage/v1/object/sign/room-photos/' + mp4Path, {
      headers: auth, body: { expiresIn: 120 }
    });
    ok('视频可签发访问链接', sg.status === 200 && sg.json && sg.json.signedURL,
      sg.status + ' ' + sg.text.slice(0, 160));

    console.log('\n[7] 清理');
    await req('DELETE', `/rest/v1/photos?id=eq.${photoId}`, { headers: auth });
    await req('DELETE', '/storage/v1/object/room-photos', {
      headers: auth, body: { prefixes: [jpgPath, mp4Path] }
    });
    const dr = await req('DELETE', `/rest/v1/rooms?id=eq.${roomId}`, { headers: auth });
    ok('房间已删除', dr.status === 204, dr.status + ' ' + dr.text.slice(0, 120));

    const da = await req('POST', '/rest/v1/rpc/delete_own_account', { headers: auth, body: {} });
    ok('临时账号已注销（含视频文件清理）', da.status === 204 || da.status === 200,
      da.status + ' ' + da.text.slice(0, 200));

  } catch (e) {
    console.error('\n异常：', e.message);
    process.exitCode = 1;
    if (userId) console.log('\n⚠ 临时账号未清理：' + username + ' (id ' + userId + ')');
  }

  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})();
