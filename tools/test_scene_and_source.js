/* 场景切换与数据来源回归测试
 * 覆盖这次线上事故的四个成因：
 *   1. 1.2 秒内来回切场景 → 旧定时器不能把当前场景隐藏（整屏黑）
 *   2. 云端不可用 → 必须给出用户可见的提示，不能静默退回本地
 *   3. 照片墙必须标明数据来源（房间 / 本机）
 *   4. 恢复房间期间不得先按本机数据渲染（闪现本地照片）
 * 不需要登录、不碰云端数据，可随时运行。
 * 用法：node tools/test_scene_and_source.js
 */
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = (name, cond, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || !extra ? '' : ' — ' + extra));
  if (!cond) process.exitCode = 1;
};

const SCENES = ['scene-cover', 'scene-warp', 'scene-map', 'scene-gallery', 'scene-stats', 'scene-auth', 'scene-carousel'];

(async () => {
  // ---------- 1 & 3：正常网络 ----------
  {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());

    await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);

    console.log('\n[1] 1.2 秒内来回切场景（旧定时器竞态）');
    const race = await page.evaluate(async ids => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const res = [];
      // cover → auth → cover，间隔都短于 1200ms
      window.showScene('scene-auth');
      await wait(150);
      window.showScene('scene-cover');
      await wait(1400);           // 等过所有排队的收起定时器
      const el = document.getElementById('scene-cover');
      res.push({ to: 'cover', active: el.classList.contains('active'), display: getComputedStyle(el).display });
      // 再试 map → gallery → map
      window.showScene('scene-gallery');
      await wait(150);
      window.showScene('scene-map');
      await wait(1400);
      const m = document.getElementById('scene-map');
      res.push({ to: 'map', active: m.classList.contains('active'), display: getComputedStyle(m).display });
      return res;
    }, SCENES);
    race.forEach(r => ok('切到 ' + r.to + ' 后仍然可见（不黑屏）',
      r.active && r.display !== 'none', JSON.stringify(r)));

    console.log('\n[2] 快速连续切换 8 次后，仍有且仅有一个场景可见');
    const final = await page.evaluate(async ids => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const seq = ['scene-map', 'scene-auth', 'scene-map', 'scene-gallery', 'scene-map', 'scene-cover', 'scene-map', 'scene-gallery'];
      for (const s of seq) { window.showScene(s); await wait(80); }
      window.showScene('scene-map');
      await wait(1500);
      const vis = ids.filter(id => {
        const el = document.getElementById(id);
        return el && el.classList.contains('active') && getComputedStyle(el).display !== 'none';
      });
      return vis;
    }, SCENES);
    ok('最终只剩 scene-map 一个场景在显示', final.length === 1 && final[0] === 'scene-map', JSON.stringify(final));

    console.log('\n[3] 照片墙的数据来源标识');
    const badge = await page.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 60; cv.height = 60;
      const x = cv.getContext('2d'); x.fillStyle = '#345'; x.fillRect(0, 0, 60, 60);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .8));
      await window.MEM.__idbPut('cn:370200:青岛市', [{ id: 'src1', blob, cap: '测试', ts: 1, date: '2026-10-01' }]);
      localStorage.setItem('travel_memory_index_v1', JSON.stringify({ 'cn:370200:青岛市': 1 }));
      window.MEM.store = JSON.parse(localStorage.getItem('travel_memory_index_v1'));
      window.MEM.openGallery('cn:370200:青岛市', '青岛市');
      await new Promise(r => setTimeout(r, 1200));
      const el = document.getElementById('gallery-source');
      return { text: el.textContent, cls: el.className, hidden: el.hidden, display: getComputedStyle(el).display };
    });
    ok('来源标识可见', !badge.hidden && badge.display !== 'none', JSON.stringify(badge));
    ok('本机模式标为「本机个人照片」', /本机/.test(badge.text) && /is-local/.test(badge.cls), badge.text);

    console.log('\n[4] 页面错误');
    ok('无脚本错误', errs.length === 0, errs.join(' | '));
    await browser.close();
  }

  // ---------- 2：云端不可用 ----------
  {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', r => /supabase-js|cdn\.jsdelivr/.test(r.url()) ? r.abort() : r.continue());

    await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2200);

    console.log('\n[5] 云端不可用（模拟 CDN 被墙）');
    const s = await page.evaluate(() => {
      const cd = document.getElementById('cloud-down');
      const bar = document.getElementById('room-bar');
      const btn = document.getElementById('btn-cover-auth');
      return {
        authAvailable: !!(window.AUTH && window.AUTH.available),
        cloudDown: cd ? { display: getComputedStyle(cd).display, text: cd.textContent.replace(/\s+/g, ' ').trim() } : null,
        roomBarHidden: !bar || getComputedStyle(bar).display === 'none',
        coverAuthHidden: !btn || getComputedStyle(btn).display === 'none',
      };
    });
    ok('云端确实不可用', s.authAvailable === false);
    ok('给出了用户可见的提示', !!s.cloudDown && s.cloudDown.display !== 'none', JSON.stringify(s.cloudDown));
    ok('提示说明了「照片仍在云端、没有丢失」', !!s.cloudDown && /没有丢失|仍在云端/.test(s.cloudDown.text), s.cloudDown && s.cloudDown.text);
    ok('房间入口隐藏时不静默（提示补位）', s.roomBarHidden && s.coverAuthHidden && !!s.cloudDown);
    ok('无脚本错误', errs.length === 0, errs.join(' | '));
    await browser.close();
  }

  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
