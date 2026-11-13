/* 针对性复现：showScene 的 1200ms 定时器竞态导致整屏黑
 *
 * 代码：showScene(id) 对每个非目标场景执行
 *          el.classList.remove('visible');
 *          setTimeout(() => el.classList.remove('active'), 1200);
 *       这个 setTimeout 从不取消。若 1.2 秒内又切回该场景，
 *       它会把刚加回去的 'active' 摘掉 → display:none → 整屏黑，
 *       只剩 body 上的左下角账号 chip（它不在任何 scene 里）。
 *
 * 步骤：注册临时账号 → 重新加载（会话保持）→ 点「登录/房间」→ 立刻点「继续」
 *       → 检查 scene-map 是否还带 active
 */
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SCN = ['scene-cover', 'scene-warp', 'scene-map', 'scene-gallery', 'scene-stats', 'scene-auth', 'scene-carousel'];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  const snap = () => page.evaluate(ids => {
    const out = {};
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) { out[id] = '?'; return; }
      const cs = getComputedStyle(el);
      out[id] = (el.classList.contains('active') ? 'A' : '-') +
        (el.classList.contains('visible') ? 'V' : '-') +
        ' display=' + cs.display + ' opacity=' + cs.opacity;
    });
    const chip = document.getElementById('user-chip');
    out.__chip = chip ? 'visible=' + (chip.offsetParent !== null) : 'none';
    return out;
  }, SCN);

  const uname = 'race' + Date.now().toString().slice(-8);
  try {
    await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1000);

    console.log('[1] 注册临时账号 ' + uname);
    await page.click('#btn-cover-auth');
    await sleep(600);
    await page.type('#auth-username', uname);
    await page.type('#auth-password', 'Test123456');
    await page.click('#auth-register');
    await sleep(5000);
    const okReg = await page.evaluate(() => !document.getElementById('auth-step-user').hidden);
    console.log('    注册完成:', okReg);

    console.log('\n[2] 重新加载页面（模拟「再次进入网站」，会话仍在）');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2000);

    console.log('[3] 点「登录 / 房间」→ 立刻点「继续 → 解锁房间功能」（间隔 <1.2s）');
    await page.click('#btn-cover-auth');
    await sleep(250);                       // 关键：小于 1200ms
    const onAuth = await page.evaluate(() => !document.getElementById('auth-step-user').hidden);
    console.log('    已直接显示账号页（已登录）:', onAuth);
    await page.click('#auth-continue');
    await sleep(2800);                      // 等过 1200ms 定时器

    console.log('\n[4] 结果');
    const s = await snap();
    console.log(JSON.stringify(s, null, 2));
    await page.screenshot({ path: 'repro_race.png' });
    console.log('    截图: tools/repro_race.png');

    const black = s['scene-map'].startsWith('-') || /display=none/.test(s['scene-map']);
    console.log('\n    ' + (black ? '❌ 复现成功：地图场景被隐藏 → 整屏黑' : '✅ 未复现'));

    if (errs.length) { console.log('\n报错：'); errs.forEach(e => console.log('  ' + e)); }
  } catch (e) {
    console.error('异常：', e.message);
  } finally {
    await browser.close();
  }
})();
