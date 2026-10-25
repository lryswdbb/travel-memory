/* M3 端到端：双用户房间实时同步测试（两个隔离浏览器上下文）
 * A 注册+建房+上传照片 → B 注册+加入 → B 应自动看到照片（Realtime 或 60s 轮询）
 * 结束自动删除测试房间与存储文件，不留垃圾数据。
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const JPG = 'data/raw/sync_test.jpg';

(async () => {
  fs.mkdirSync('data/raw', { recursive: true });
  fs.writeFileSync(JPG, Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKpgAAAAAP/Z',
    'base64'));

  const ts = Date.now().toString().slice(-6);
  const ROOM = 'sync房' + ts;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const mkPage = async () => {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    p.on('pageerror', e => console.log('PAGEERROR:', e.message));
    p.on('dialog', d => { console.log('ALERT:', d.message().slice(0, 200)); d.dismiss(); });
    await p.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
    await p.waitForFunction(() => window.AUTH && window.AUTH.available, { timeout: 30000 });
    return p;
  };

  const pageA = await mkPage();
  const pageB = await mkPage();
  console.log('两个会话就绪');

  // ---- A：注册 + 建房 + 进房 ----
  const roomId = await pageA.evaluate(async (room, uname) => {
    const reg = await window.AUTH.register(uname, 'test123456');
    if (!reg.ok) throw new Error('A 注册失败: ' + reg.error);
    const hex = a => [...new Uint8Array(a)].map(b => b.toString(16).padStart(2, '0')).join('');
    const saltArr = new Uint8Array(16); crypto.getRandomValues(saltArr);
    const salt = hex(saltArr);
    const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + 'roompass1')));
    const { data, error } = await window.AUTH.sb.rpc('create_room',
      { p_name: room, p_salt: salt, p_hash: hash, p_display: uname });
    if (error) throw new Error('建房失败: ' + error.message);
    const u = await window.AUTH.getUser();
    await window.ROOMS.enter(data, room, u.id);
    return data;
  }, ROOM, 'syncA' + ts);
  console.log('A 建房:', roomId);

  // ---- B：注册 + 加入 + 进房 ----
  await pageB.evaluate(async (roomId, room, uname) => {
    const reg = await window.AUTH.register(uname, 'test123456');
    if (!reg.ok) throw new Error('B 注册失败: ' + reg.error);
    const hex = a => [...new Uint8Array(a)].map(b => b.toString(16).padStart(2, '0')).join('');
    const { data: salt, error: e1 } = await window.AUTH.sb.rpc('room_salt', { p_room_id: roomId });
    if (e1 || !salt) throw new Error('取盐失败');
    const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + 'roompass1')));
    const { data: ok, error: e2 } = await window.AUTH.sb.rpc('join_room',
      { p_room_id: roomId, p_hash: hash, p_display: uname });
    if (e2) throw new Error('加入失败: ' + e2.message);
    if (ok !== true) throw new Error('密码被拒');
    await window.ROOMS.enter(roomId, room, null);
  }, roomId, ROOM, 'syncB' + ts);
  console.log('B 加入并进房 OK');

  // ---- A：打开照片墙并上传 ----
  await pageA.evaluate(() => window.MEM.openGallery('prov:JP:Kyōto', '日本 · 京都府'));
  await new Promise(r => setTimeout(r, 800));
  const input = await pageA.$('#file-input');
  await input.uploadFile(JPG);
  // 产品 UX：选文件后弹「添加照片」对话框（备注/日期），确认后才上传
  await pageA.waitForSelector('.up-dialog .up-ok', { timeout: 10000 });
  await pageA.click('.up-dialog .up-ok');
  try {
    await pageA.waitForFunction(() => (window.MEM.store['prov:JP:Kyōto'] || 0) >= 1, { timeout: 30000 });
  } catch (e) {
    console.log('A 上传未生效，诊断：', await pageA.evaluate(() => JSON.stringify({
      store: window.MEM.store,
      toast: (document.getElementById('rm-toast') || {}).textContent || '',
      backend: window.MEM.backendMode,
      currentKey: window.MEM.currentKey,
    })));
    throw e;
  }
  console.log('A 上传成功，A store =', await pageA.evaluate(() => window.MEM.store['prov:JP:Kyōto']));

  // ---- B：等待同步（Realtime 秒级 / 轮询 ≤60s） ----
  const t0 = Date.now();
  let synced = false;
  try {
    await pageB.waitForFunction(() => (window.MEM.store['prov:JP:Kyōto'] || 0) >= 1, { timeout: 75000 });
    synced = true;
  } catch (e) { }
  console.log(`B 同步: ${synced ? '✅' : '❌'} 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (synced) {
    // B 打开同一照片墙 → 点开第一张大图，说明文字应含「by syncA…」
    await pageB.evaluate(() => window.MEM.openGallery('prov:JP:Kyōto', '日本 · 京都府'));
    await pageB.waitForFunction(() => document.querySelectorAll('#gallery-grid .photo-card').length >= 1,
      { timeout: 30000 });
    await pageB.evaluate(() => document.querySelector('#gallery-grid .photo-card img').click());
    await new Promise(r => setTimeout(r, 800));
    const cap = await pageB.evaluate(() => (document.getElementById('lightbox-cap') || {}).textContent || '');
    console.log('B 大图说明:', cap, /by syncA/.test(cap) ? '✅ 上传者正确' : '⚠️ 未见上传者名');
    await pageB.evaluate(() => document.querySelector('.lightbox-close').click());
  }

  // ---- 清理：A 删存储文件 + 删房间（级联删元数据） ----
  await pageA.evaluate(async roomId => {
    const { data: rows } = await window.AUTH.sb.from('photos')
      .select('storage_path').eq('room_id', roomId);
    if (rows && rows.length) {
      await window.AUTH.sb.storage.from('room-photos').remove(rows.map(r => r.storage_path));
    }
    const { error } = await window.AUTH.sb.from('rooms').delete().eq('id', roomId);
    if (error) throw new Error('删房失败: ' + error.message);
  }, roomId);
  console.log('测试房间已清理');

  fs.unlinkSync(JPG);
  await browser.close();
  process.exit(synced ? 0 : 1);
})().catch(e => { console.error('SYNC TEST FAIL:', e.message); process.exit(1); });
