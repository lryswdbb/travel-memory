/* PC 复现：已有房间+照片的账号，会话恢复后点「继续」/「点击进入」观察地图是否消失 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const JPG = 'data/raw/pc_test.jpg';

(async () => {
  fs.mkdirSync('data/raw', { recursive: true });
  fs.writeFileSync(JPG, Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKpgAAAAAP/Z',
    'base64'));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 5).join('\n')));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.AUTH && window.AUTH.available, { timeout: 30000 });

  // 1) 注册 + 建房 + 上传一张照片（完整还原用户账号状态）
  const ts = Date.now().toString().slice(-6);
  const uname = 'pc' + ts;
  const roomId = await page.evaluate(async (room, u) => {
    const reg = await window.AUTH.register(u, 'test123456');
    if (!reg.ok) throw new Error('注册失败 ' + reg.error);
    const hex = a => [...new Uint8Array(a)].map(b => b.toString(16).padStart(2, '0')).join('');
    const s = new Uint8Array(16); crypto.getRandomValues(s);
    const salt = hex(s);
    const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + 'roompass1')));
    const { data, error } = await window.AUTH.sb.rpc('create_room',
      { p_name: room, p_salt: salt, p_hash: hash, p_display: u });
    if (error) throw new Error('建房失败 ' + error.message);
    const me = await window.AUTH.getUser();
    await window.ROOMS.enter(data, room, me.id);
    return data;
  }, 'pc房' + ts, uname);
  await page.evaluate(() => window.MEM.openGallery('prov:JP:Kyōto', '日本 · 京都府'));
  await new Promise(r => setTimeout(r, 600));
  const input = await page.$('#file-input');
  await input.uploadFile(JPG);
  await page.waitForSelector('.up-dialog .up-ok', { timeout: 8000 });
  await page.click('.up-dialog .up-ok');
  await page.waitForFunction(() => (window.MEM.store['prov:JP:Kyōto'] || 0) >= 1, { timeout: 30000 });
  console.log('账号状态就绪：房间+1张照片');

  const probe = () => page.evaluate(() => {
    const act = [...document.querySelectorAll('.scene')].filter(s => s.className.includes('active')).map(s => s.id).join(',') || '(none!)';
    const c = document.querySelector('#map-chart canvas');
    return `active=[${act}] canvas=${c ? c.width + 'x' + c.height : 'NONE'}`;
  });

  // 2) 刷新：会话+房间恢复（用户开网站的常态）
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  console.log('刷新后(封面):', await probe());

  // 3) 点封面「登录/房间」→ 面板应显示已登录 → 点「继续」
  await page.click('#btn-cover-auth');
  await new Promise(r => setTimeout(r, 1200));
  const step = await page.evaluate(() =>
    !document.getElementById('auth-step-user').hidden ? 'user' : 'login');
  console.log('面板步骤:', step);
  if (step === 'user') {
    await page.click('#auth-continue');
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 1000));
      console.log(`c+${i + 1}s`, await probe());
    }
  }

  // 4) 再走一次 点击进入→跳过→进入地图
  console.log('--- 点击进入路径 ---');
  await page.evaluate(() => { document.getElementById('btn-enter').click(); });
  await new Promise(r => setTimeout(r, 1200));
  const skip = await page.$('#warp-skip');
  if (skip) await skip.click();
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => { const b = document.getElementById('warp-enter'); if (b) b.click(); });
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 1000));
    console.log(`w+${i + 1}s`, await probe());
  }

  console.log('--- errors ---');
  console.log(errs.length ? errs.join('\n---\n') : '(none)');
  await page.screenshot({ path: 'tools/dbg_pc.png' });

  // 清理
  await page.evaluate(async rid => {
    const { data: rows } = await window.AUTH.sb.from('photos').select('storage_path').eq('room_id', rid);
    if (rows && rows.length) await window.AUTH.sb.storage.from('room-photos').remove(rows.map(r => r.storage_path));
    await window.AUTH.sb.rpc('delete_own_account');
  }, roomId);
  console.log('测试账号已注销清理');
  fs.unlinkSync(JPG);
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
