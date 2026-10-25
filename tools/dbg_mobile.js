/* 移动端复现：世界 → 朝鲜 → 咸镜北道 → 照片墙，捕获 echarts innerHTML 报错栈 */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));
  const authOk = await page.evaluate(() => !!(window.supabase && window.AUTH && window.AUTH.available));
  console.log('cdn:', authOk);

  // 封面 → 进入 → 跳过 → 地图
  await page.tap('#btn-enter');
  await new Promise(r => setTimeout(r, 1200));
  const skip = await page.$('#warp-skip');
  if (skip) await skip.tap();
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => { const b = document.getElementById('warp-enter'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 1500));
  console.log('map level:', await page.evaluate(() => window.MAP.level));

  // 真实触摸点击朝鲜（世界图）
  async function tapRegion(lon, lat) {
    const pt = await page.evaluate(([lo, la]) => {
      const el = document.getElementById('map-chart');
      const inst = window.echarts.getInstanceByDom(el);
      const p = inst.convertToPixel({ seriesIndex: 0 }, [lo, la]);
      return p ? { x: p[0], y: p[1] } : null;
    }, [lon, lat]);
    if (!pt) { console.log('convertToPixel failed for', lon, lat); return false; }
    await page.touchscreen.tap(pt.x, pt.y);
    return true;
  }
  console.log('tap KP:', await tapRegion(127.5, 40.3));
  await new Promise(r => setTimeout(r, 2500));
  console.log('after tap KP level:', await page.evaluate(() => window.MAP.level));

  // 真实触摸点击咸镜北道（约 129.7E, 41.8N）
  console.log('tap Hamgyongbuk-to:', await tapRegion(129.7, 41.8));
  await new Promise(r => setTimeout(r, 2000));
  console.log('gallery name:', await page.evaluate(() => (document.getElementById('gallery-name') || {}).textContent));
  console.log('scene active:', await page.evaluate(() =>
    [...document.querySelectorAll('.scene')].filter(s => s.className.includes('active')).map(s => s.id).join(',')));

  // 再回地图 + 开走马灯 + 统计页，尽量多触发路径
  await page.evaluate(() => { document.getElementById('btn-back').click(); });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { document.getElementById('btn-carousel').click(); });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => { document.getElementById('car-back').click(); });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => { document.getElementById('btn-stats').click(); });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => { document.getElementById('stats-back').click(); });
  await new Promise(r => setTimeout(r, 1000));

  console.log('--- errors captured ---');
  console.log(errs.length ? errs.join('\n---\n') : '(none)');
  await page.screenshot({ path: 'tools/dbg_mobile.png' });
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
