/* GPS 自动归位测试
 * 覆盖：
 *   1. EXIF 解析器能从 JPEG 里读出 GPS（含 S/W 负号）
 *   2. 无 GPS 的照片返回 null，不误判
 *   3. 坐标 → 地点 key 正确（中国市/省、美国县/州、外国省、国家兜底）
 *   4. 上传时按 GPS 分批归位：青岛照片 + 上海照片一起选，分别存进各自地点
 *   5. 选择「还是存到当前位置」时不按 GPS 归位
 * 用法：node tools/test_gps.js
 */
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = (name, cond, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || !extra ? '' : ' — ' + extra));
  if (!cond) process.exitCode = 1;
};

// 在页面里造一个带 GPS 的 JPEG（手写最小 EXIF 段）
const MAKE_JPEG = `
window.__makeGpsJpeg = async function (lat, lng) {
  // 1x1 白色 JPEG 的最小帧（直接用 canvas 生成，再插入 EXIF 段）
  const cv = document.createElement('canvas');
  cv.width = 24; cv.height = 24;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#88aadd'; ctx.fillRect(0, 0, 24, 24);
  const base = new Uint8Array(await new Promise(r => cv.toBlob(b => b.arrayBuffer().then(a => r(new Uint8Array(a))), 'image/jpeg', .9)));

  // 构造 GPS IFD（小端 'II'）
  const deg = v => {
    const d = Math.floor(Math.abs(v));
    const mFull = (Math.abs(v) - d) * 60;
    const m = Math.floor(mFull);
    const s = (mFull - m) * 60;
    return [[d, 1], [m, 1], [Math.round(s * 10000), 10000]];
  };
  const latV = deg(lat), lngV = deg(lng);
  const latRef = lat >= 0 ? 'N' : 'S';
  const lngRef = lng >= 0 ? 'E' : 'W';

  // TIFF 头(8) + IFD0(1个条目指向 GPS IFD) + GPS IFD + 数据区
  const ifd0Off = 8;
  const ifd0Len = 2 + 1 * 12 + 4;          // 1 个条目：GPS IFD 指针
  const gpsOff = ifd0Off + ifd0Len;
  const gpsEntries = 4;
  const gpsLen = 2 + gpsEntries * 12 + 4;
  const dataStart = gpsOff + gpsLen;

  const ratLatOff = dataStart;
  const ratLngOff = ratLatOff + 24;
  const total = ratLngOff + 24;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let p = 0;
  dv.setUint16(p, 0x4949, true); p += 2;        // II
  dv.setUint16(p, 42, true); p += 2;
  dv.setUint32(p, ifd0Off, true); p += 4;        // IFD0 偏移

  // ---- IFD0：只有一条，0x8825 → GPS IFD ----
  dv.setUint16(p, 1, true); p += 2;
  dv.setUint16(p, 0x8825, true); p += 2;
  dv.setUint16(p, 4, true); p += 2;              // LONG
  dv.setUint32(p, 1, true); p += 4;              // count
  dv.setUint32(p, gpsOff, true); p += 4;         // 指向 GPS IFD
  dv.setUint32(p, 0, true); p += 4;              // next IFD = 0

  // ---- GPS IFD ----
  dv.setUint16(p, gpsEntries, true); p += 2;
  const putEntry = (tag, type, count, valueOffset, inlineChar) => {
    dv.setUint16(p, tag, true); p += 2;
    dv.setUint16(p, type, true); p += 2;
    dv.setUint32(p, count, true); p += 4;
    if (inlineChar !== undefined) {
      u8[p] = inlineChar; u8[p + 1] = 0; u8[p + 2] = 0; u8[p + 3] = 0;
    } else {
      dv.setUint32(p, valueOffset, true);
    }
    p += 4;
  };
  // ASCII type=2, count=2 → 2 字节，内联在 4 字节槽
  putEntry(0x0001, 2, 2, 0, latRef.charCodeAt(0));
  putEntry(0x0002, 5, 3, ratLatOff);
  putEntry(0x0003, 2, 2, 0, lngRef.charCodeAt(0));
  putEntry(0x0004, 5, 3, ratLngOff);
  dv.setUint32(p, 0, true);   // next IFD = 0

  const writeRat = (off, arr) => {
    let q = off;
    arr.forEach(([n, d]) => { dv.setUint32(q, n, true); dv.setUint32(q + 4, d, true); q += 8; });
  };
  writeRat(ratLatOff, latV);
  writeRat(ratLngOff, lngV);

  const exif = new Uint8Array(buf);
  const app1Payload = new Uint8Array(6 + exif.length);   // "Exif\\0\\0" + TIFF
  app1Payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  app1Payload.set(exif, 6);

  const segLen = app1Payload.length + 2;
  const seg = new Uint8Array(4 + app1Payload.length);
  seg[0] = 0xFF; seg[1] = 0xE1;
  seg[2] = (segLen >> 8) & 0xFF; seg[3] = segLen & 0xFF;
  seg.set(app1Payload, 4);

  // 插到 SOI(2 字节) 之后
  const out = new Uint8Array(base.length + seg.length);
  out.set(base.slice(0, 2), 0);
  out.set(seg, 2);
  out.set(base.slice(2), 2 + seg.length);
  return new File([out], 'gps_test.jpg', { type: 'image/jpeg' });
};
`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 300000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  await page.evaluate(MAKE_JPEG);

  console.log('\n[1] EXIF 解析（青岛 36.06N 120.38E）');
  const g1 = await page.evaluate(async () => {
    const f = await window.__makeGpsJpeg(36.06, 120.38);
    return await window.EXIF.readGps(f);
  });
  ok('读出了坐标', !!g1, JSON.stringify(g1));
  ok('纬度正确', !!g1 && Math.abs(g1.lat - 36.06) < 0.02, g1 && String(g1.lat));
  ok('经度正确', !!g1 && Math.abs(g1.lng - 120.38) < 0.02, g1 && String(g1.lng));

  console.log('\n[2] 南纬 / 西经（负号处理）');
  const g2 = await page.evaluate(async () => {
    const f = await window.__makeGpsJpeg(-33.87, -151.21);   // 悉尼
    return await window.EXIF.readGps(f);
  });
  ok('南纬为负', !!g2 && g2.lat < 0 && Math.abs(g2.lat + 33.87) < 0.02, g2 && String(g2.lat));
  ok('西经为负', !!g2 && g2.lng < 0 && Math.abs(g2.lng + 151.21) < 0.02, g2 && String(g2.lng));

  console.log('\n[3] 无 GPS 的照片不应误判');
  const g3 = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 30; cv.height = 30;
    cv.getContext('2d').fillRect(0, 0, 30, 30);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    return await window.EXIF.readGps(new File([blob], 'plain.jpg', { type: 'image/jpeg' }));
  });
  ok('返回 null', g3 === null, JSON.stringify(g3));

  console.log('\n[4] 坐标 → 地点');
  const locs = await page.evaluate(async () => {
    const cases = [
      ['青岛', 36.06, 120.38, 'cn:370000:青岛市'],
      ['北京', 39.9087, 116.3975, 'cn:110000:东城区'],
      ['纽约', 40.7128, -74.006, 'us:New York:New York County'],
      ['东京', 35.68, 139.69, 'prov:JP:Tokyo'],
      ['海洋', 0, -160, null],
    ];
    const out = [];
    for (const [n, la, ln, want] of cases) {
      const r = await window.GEO_LOCATE.locate(la, ln);
      out.push({ n, got: r ? r.key : null, want, pass: (r ? r.key : null) === want });
    }
    return out;
  });
  locs.forEach(l => ok(l.n + ' → ' + (l.want || '无结果'), l.pass, l.got));

  console.log('\n[5] 上传时按 GPS 自动归位（青岛 + 上海一起选）');
  const up = await page.evaluate(async () => {
    // 清空本地索引，从干净状态开始
    localStorage.setItem('travel_memory_index_v1', '{}');
    window.MEM.store = {};
    window.MEM.openGallery('cn:370000:济南市', '山东省 · 济南市');
    await new Promise(r => setTimeout(r, 800));

    const f1 = await window.__makeGpsJpeg(36.06, 120.38);    // 青岛
    const f2 = await window.__makeGpsJpeg(31.24, 121.49);    // 上海
    window.MEM.__handleFiles([f1, f2]);   // 不 await：它要等用户点「保存」
    // 等弹窗出现
    for (let i = 0; i < 40 && !document.querySelector('.up-panel'); i++) {
      await new Promise(r => setTimeout(r, 150));
    }
    await new Promise(r => setTimeout(r, 400));

    // 弹窗里应出现 GPS 建议
    const gpsBox = document.querySelector('.up-gps');
    const gpsText = gpsBox ? gpsBox.textContent.replace(/\s+/g, ' ').trim() : '';
    const radios = [...document.querySelectorAll('input[name=gpsdest]')].map(r => r.value);

    // 选择「存到 GPS 地点」并确认
    const useGps = document.querySelector('input[name=gpsdest][value=gps]');
    if (useGps) useGps.checked = true;
    document.querySelector('.up-panel .up-ok').click();

    // 等保存完成（弹窗关闭 + 索引写好）
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 200));
      const idx = JSON.parse(localStorage.getItem('travel_memory_index_v1') || '{}');
      if (!document.querySelector('.up-panel') && Object.keys(idx).length) break;
    }
    await new Promise(r => setTimeout(r, 400));

    const idx = JSON.parse(localStorage.getItem('travel_memory_index_v1') || '{}');
    return { gpsText, radios, idx };
  });
  ok('弹窗提示了 GPS 识别结果', /GPS/.test(up.gpsText), up.gpsText.slice(0, 90));
  ok('给了两个选项', up.radios.length === 2, JSON.stringify(up.radios));
  ok('青岛照片归到青岛', (up.idx['cn:370000:青岛市'] || 0) === 1, JSON.stringify(up.idx));
  ok('上海照片归到上海', (up.idx['cn:310000:黄浦区'] || 0) === 1, JSON.stringify(up.idx));
  ok('济南（当前位置）没有多出照片', !up.idx['cn:370000:济南市'], JSON.stringify(up.idx));

  console.log('\n[6] 选「还是存到当前位置」时不按 GPS 归位');
  const up2 = await page.evaluate(async () => {
    localStorage.setItem('travel_memory_index_v1', '{}');
    window.MEM.store = {};
    window.MEM.openGallery('cn:370000:济南市', '山东省 · 济南市');
    await new Promise(r => setTimeout(r, 800));
    const f = await window.__makeGpsJpeg(36.06, 120.38);
    window.MEM.__handleFiles([f]);        // 不 await
    for (let i = 0; i < 40 && !document.querySelector('.up-panel'); i++) {
      await new Promise(r => setTimeout(r, 150));
    }
    await new Promise(r => setTimeout(r, 400));
    const cur = document.querySelector('input[name=gpsdest][value=current]');
    if (cur) cur.checked = true;
    document.querySelector('.up-panel .up-ok').click();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 200));
      const idx = JSON.parse(localStorage.getItem('travel_memory_index_v1') || '{}');
      if (!document.querySelector('.up-panel') && Object.keys(idx).length) break;
    }
    return JSON.parse(localStorage.getItem('travel_memory_index_v1') || '{}');
  });
  ok('照片留在济南（当前位置）', (up2['cn:370000:济南市'] || 0) === 1, JSON.stringify(up2));
  ok('没有被挪去青岛', !up2['cn:370000:青岛市'], JSON.stringify(up2));

  console.log('\n[7] 页面错误');
  ok('无脚本错误', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
