/* 上传进度与失败重试测试
 * 覆盖：
 *   1. 后端 addPhotos 逐张回调 (n, total, item, 'ok'|'fail')，返回 {added, failed}
 *   2. 单张失败不中断整批，其余照片照常保存
 *   3. 进度面板：计数、百分比、失败变红、完成态
 *   4. 失败清单：条数、原因、重试按钮文案
 * 用法：node tools/test_upload_progress.js
 */
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = (name, cond, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || !extra ? '' : ' — ' + extra));
  if (!cond) process.exitCode = 1;
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);

  console.log('\n[1] 正常保存 3 张：逐张回调 + 返回结构');
  const normal = await page.evaluate(async () => {
    const mk = async c => {
      const cv = document.createElement('canvas'); cv.width = 30; cv.height = 30;
      const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 30, 30);
      return await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    };
    localStorage.setItem('travel_memory_index_v1', '{}');
    window.MEM.store = {};
    window.MEM.openGallery('cn:370000:青岛市', '青岛市');
    await new Promise(r => setTimeout(r, 400));
    const items = [];
    for (let i = 0; i < 3; i++) {
      items.push({ id: 'p' + i, blob: await mk('#356'), cap: '照片' + i, ts: Date.now() + i, date: '2026-10-0' + (i + 1) });
    }
    const calls = [];
    const res = await window.MEM.backend.addPhotos('cn:370000:青岛市', items, (n, t, item, st) => {
      calls.push({ n, t, cap: item && item.cap, st });
    });
    return { res, calls, idx: JSON.parse(localStorage.getItem('travel_memory_index_v1') || '{}') };
  });
  ok('返回 {added:3, failed:[]}', normal.res.added === 3 && normal.res.failed.length === 0, JSON.stringify(normal.res));
  ok('回调 3 次且带序号/总数/备注', normal.calls.length === 3
    && normal.calls.every((c, i) => c.n === i + 1 && c.t === 3 && c.cap),
    JSON.stringify(normal.calls));
  ok('索引记录 3 张', normal.idx['cn:370000:青岛市'] === 3, JSON.stringify(normal.idx));

  console.log('\n[2] 单张失败不中断整批');
  const partial = await page.evaluate(async () => {
    const mk = async c => {
      const cv = document.createElement('canvas'); cv.width = 30; cv.height = 30;
      const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 30, 30);
      return await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    };
    // 清干净：既清索引也清 IndexedDB（否则第 1 步的 3 张还在，计数会累加）
    localStorage.setItem('travel_memory_index_v1', '{}');
    window.MEM.store = {};
    await window.MEM.__idbPut('cn:370000:青岛市', []);
    window.MEM.openGallery('cn:370000:青岛市', '青岛市');
    await new Promise(r => setTimeout(r, 400));

    const backend = window.MEM.backend;
    const realAdd = backend.addPhotos.bind(backend);
    // 包一层：第 2 张强制失败
    backend.addPhotos = async function (key, items, cb) {
      const good = items.filter((it, i) => i !== 1);
      const bad = items[1];
      const r = await realAdd(key, good, cb);
      if (cb) cb(items.length, items.length, bad, 'fail');
      return { added: r.added, failed: [{ item: bad, message: '模拟网络中断' }] };
    };
    const items = [];
    for (let i = 0; i < 3; i++) {
      items.push({ id: 'q' + i, blob: await mk('#563'), cap: '第' + i + '张', ts: Date.now() + i, date: '2026-10-0' + (i + 1) });
    }
    const statuses = [];
    const res = await backend.addPhotos('cn:370000:青岛市', items, (n, t, item, st) => statuses.push(st));
    return { res: { added: res.added, failed: res.failed.map(f => f.item.cap) }, idx: JSON.parse(localStorage.getItem('travel_memory_index_v1') || '{}'), statuses };
  });
  ok('成功的 2 张已保存', partial.idx['cn:370000:青岛市'] === 2, JSON.stringify(partial.idx));
  ok('返回失败明细', partial.res.failed.length === 1 && partial.res.failed[0] === '第1张', JSON.stringify(partial.res));
  ok('失败项回调标记为 fail', partial.statuses.includes('fail'), JSON.stringify(partial.statuses));

  console.log('\n[3] 进度面板');
  const ui = await page.evaluate(() => {
    const pr = window.UPLOAD.start({ total: 4, mode: 'room' });
    const el = document.querySelector('.upl-panel');
    const snap = () => ({
      show: el.classList.contains('show'),
      title: el.querySelector('.upl-title').textContent,
      count: el.querySelector('.upl-count').textContent,
      sub: el.querySelector('.upl-sub').textContent,
      fill: el.querySelector('.upl-fill').style.width,
      failRed: el.querySelector('.upl-fill').classList.contains('is-fail'),
      done: el.classList.contains('is-done'),
    });
    pr.update(1, 4, null, { cap: '栈桥' }, 'ok');
    const s1 = snap();
    pr.update(3, 4, null, { cap: '海边' }, 'fail');
    const s3 = snap();
    pr.finish('3 张已保存，1 张失败');
    const s4 = snap();
    return { s1, s3, s4 };
  });
  ok('面板显示', ui.s1.show);
  ok('标题表明是云端上传', /云端/.test(ui.s1.title), ui.s1.title);
  ok('计数 1 / 4', ui.s1.count === '1 / 4', ui.s1.count);
  ok('进度条 25%', ui.s1.fill === '25%', ui.s1.fill);
  ok('显示当前照片备注', ui.s1.sub === '栈桥', ui.s1.sub);
  ok('失败时进度条变红', ui.s3.failRed);
  ok('计数 3 / 4、进度 75%', ui.s3.count === '3 / 4' && ui.s3.fill === '75%', ui.s3.count + ' ' + ui.s3.fill);
  ok('完成态文案', ui.s4.done && /1 张失败/.test(ui.s4.sub), ui.s4.sub);

  console.log('\n[4] 失败清单');
  const failUi = await page.evaluate(() => {
    document.querySelectorAll('.up-dialog').forEach(x => x.remove());
    window.UPLOAD.showFailures([
      { item: { cap: '栈桥' }, message: '网络超时' },
      { item: { cap: '海边' }, message: '存储已满' },
    ], async () => { });
    const el = document.querySelector('.upl-fail-panel');
    return el ? {
      title: el.querySelector('h3').textContent,
      rows: [...el.querySelectorAll('.upl-fail-row')].map(r => ({
        cap: r.querySelector('.upl-fail-cap').textContent,
        msg: r.querySelector('.upl-fail-msg').textContent,
      })),
      btn: el.querySelector('.up-ok').textContent,
    } : null;
  });
  ok('标题写明失败张数', !!failUi && /2 张/.test(failUi.title), failUi && failUi.title);
  ok('逐条列出备注与原因', !!failUi && failUi.rows.length === 2
    && failUi.rows[0].cap === '栈桥' && failUi.rows[0].msg === '网络超时'
    && failUi.rows[1].msg === '存储已满', JSON.stringify(failUi && failUi.rows));
  ok('按钮为「重试这 2 张」', !!failUi && /重试这 2 张/.test(failUi.btn), failUi && failUi.btn);

  console.log('\n[5] 页面错误');
  ok('无脚本错误', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
