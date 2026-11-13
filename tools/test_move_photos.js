/* 照片搬家（整理位置）验证
 * 覆盖：
 *   1. 本地后端 movePhotos 把整桶照片从一个地点挪到另一个地点
 *   2. 搬家后源相册清空、目标相册增加、地图索引同步更新
 *   3. 弹窗列出其它地点、显示当前张数
 *   4. 目标与源相同时被拒绝
 */
const puppeteer = require('puppeteer');

function ok(name, cond, extra) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || !extra ? '' : ' — ' + extra));
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.MEM && window.MEM.backend, { timeout: 30000 });

  console.log('\n[1] 造两个地点：青岛 3 张，上海 1 张');
  const seed = await page.evaluate(async () => {
    const mk = async color => {
      const c = document.createElement('canvas');
      c.width = 120; c.height = 120;
      const x = c.getContext('2d');
      x.fillStyle = color; x.fillRect(0, 0, 120, 120);
      return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    };
    const src = 'cn:370200:青岛市';
    const dst = 'cn:310000:上海市';
    const list = [];
    for (let i = 0; i < 3; i++) {
      list.push({ id: 'mvsrc' + i, blob: await mk('#3355aa'), cap: '青岛 ' + i, ts: Date.now() + i, date: '2026-10-0' + (i + 1) });
    }
    await window.MEM.__idbPut(src, list);
    await window.MEM.__idbPut(dst, [{ id: 'mvdst', blob: await mk('#aa3355'), cap: '上海', ts: Date.now(), date: '2026-09-01' }]);
    localStorage.setItem('travel_memory_index_v1', JSON.stringify({ [src]: 3, [dst]: 1 }));
    window.MEM.store = JSON.parse(localStorage.getItem('travel_memory_index_v1'));
    return { src, dst };
  });
  const { src, dst } = seed;

  console.log('\n[2] 打开照片墙并查看搬家弹窗');
  await page.evaluate(k => window.MEM.openGallery(k, '山东省 · 青岛市'), src);
  await new Promise(r => setTimeout(r, 700));
  await page.click('#btn-move');
  await new Promise(r => setTimeout(r, 500));

  const dlg = await page.evaluate(() => {
    const el = document.querySelector('.mv-panel');
    if (!el) return null;
    return {
      cur: (el.querySelector('.mv-cur') || {}).textContent,
      count: (el.querySelector('.mv-count') || {}).textContent,
      options: [...el.querySelectorAll('.mv-sel option')].map(o => ({ v: o.value, t: o.textContent })),
    };
  });
  ok('弹窗打开', !!dlg);
  ok('显示当前地点', !!dlg && dlg.cur === '山东省 · 青岛市', dlg && dlg.cur);
  ok('显示当前张数 3', !!dlg && /3/.test(dlg.count || ''), dlg && dlg.count);
  const dstOpt = dlg && dlg.options.find(o => o.v === dst);
  ok('下拉框列出另一个地点', !!dstOpt, JSON.stringify(dlg && dlg.options));
  ok('另一个地点显示可读名称与张数', !!dstOpt && /上海/.test(dstOpt.t) && /1/.test(dstOpt.t), dstOpt && dstOpt.t);

  console.log('\n[3] 执行搬家：青岛 → 上海');
  await page.evaluate(sel => {
    const s = document.querySelector('.mv-sel');
    s.value = sel;
    s.dispatchEvent(new Event('change'));
  }, dst);
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => document.querySelector('.mv-panel .up-ok').click());
  await new Promise(r => setTimeout(r, 1500));

  const after = await page.evaluate(async ({ s, d }) => {
    const read = k => new Promise(res => {
      const rq = indexedDB.open('travel_memory_db');
      rq.onsuccess = () => {
        const db = rq.result;
        const g = db.transaction('photos', 'readonly').objectStore('photos').get(k);
        g.onsuccess = () => { db.close(); res(g.result || []); };
        g.onerror = () => { db.close(); res([]); };
      };
      rq.onerror = () => res([]);
    });
    const srcList = await read(s);
    const dstList = await read(d);
    return {
      srcN: srcList.length, dstN: dstList.length,
      dstCaps: dstList.map(x => x.cap).sort(),
      idx: JSON.parse(localStorage.getItem('travel_memory_index_v1') || '{}'),
      dialogGone: !document.querySelector('.mv-panel'),
    };
  }, { s: src, d: dst });

  ok('源相册已清空', after.srcN === 0, 'src=' + after.srcN);
  ok('目标相册变成 4 张', after.dstN === 4, 'dst=' + after.dstN);
  ok('照片内容完整（备注都在）',
    after.dstCaps.join(',') === '上海,青岛 0,青岛 1,青岛 2', after.dstCaps.join(','));
  ok('地图索引已更新（源无、目标 4）',
    !after.idx[src] && after.idx[dst] === 4, JSON.stringify(after.idx));
  ok('弹窗自动关闭', after.dialogGone);

  console.log('\n[4] 目标与源相同时应被拒绝');
  await page.evaluate(k => window.MEM.openGallery(k, '上海市'), dst);
  await new Promise(r => setTimeout(r, 600));
  await page.click('#btn-move');
  await new Promise(r => setTimeout(r, 400));
  const sameErr = await page.evaluate(() => {
    const c = document.querySelector('.mv-custom');
    const s = document.querySelector('.mv-sel');
    s.value = '__custom__';
    s.dispatchEvent(new Event('change'));
    c.value = 'cn:310000:上海市';
    document.querySelector('.mv-panel .up-ok').click();
    return new Promise(r => setTimeout(() => r({
      err: (document.querySelector('.mv-err') || {}).textContent,
      stillOpen: !!document.querySelector('.mv-panel'),
    }), 400));
  });
  ok('提示不能搬到同一地点', /相同/.test(sameErr.err || ''), JSON.stringify(sameErr));
  ok('弹窗保持打开', sameErr.stillOpen);

  console.log('\n[5] 页面错误');
  ok('无脚本错误', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
