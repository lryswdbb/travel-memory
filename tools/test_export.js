/* 导出备份冒烟测试
 * 覆盖：
 *   1. 导出弹窗能打开，显示数据来源
 *   2. 本地模式下 collect 能收集到照片（含实况视频）
 *   3. 生成的 ZIP 是合法 zip（结构、CRC、文件名、内容逐字节一致）
 *   4. 目录名可读（中国-青岛市），文件名带序号/日期/备注
 *   5. backup.json 字段完整
 * 用法：node tools/test_export.js
 */
const puppeteer = require('puppeteer');
const zlib = require('zlib');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ok = (name, cond, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || !extra ? '' : ' — ' + extra));
  if (!cond) process.exitCode = 1;
};

// 简易 ZIP 解析：只支持 store（method 0）与 deflate(8)，用于校验
function parseZip(buf) {
  const entries = [];
  // 找中央目录结束记录
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('找不到 ZIP 中央目录结束记录');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录条目签名错误 @' + off);
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');

    // 读本地文件头定位数据
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lnlen + lelen;
    const raw = buf.slice(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('不支持的压缩方式 ' + method);

    entries.push({ name, method, crc, usize, data });
    off += 46 + nlen + elen + clen;
  }
  return entries;
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);

  console.log('\n[1] 造两个地点的照片（含 1 张实况）');
  await page.evaluate(async () => {
    const mk = async c => {
      const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
      const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 40, 40);
      return await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
    };
    const qd = 'cn:370200:青岛市';
    const sh = 'cn:310000:上海市';
    await window.MEM.__idbPut(qd, [
      { id: 'e1', blob: await mk('#112233'), cap: '栈桥', ts: 1, date: '2026-10-01' },
      { id: 'e2', blob: await mk('#445566'), cap: '海边', ts: 2, date: '2026-10-02', video: new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], { type: 'video/mp4' }) }
    ]);
    await window.MEM.__idbPut(sh, [{ id: 'e3', blob: await mk('#778899'), cap: '外滩', ts: 3, date: '2026-09-05' }]);
    localStorage.setItem('travel_memory_index_v1', JSON.stringify({ [qd]: 2, [sh]: 1 }));
    window.MEM.store = JSON.parse(localStorage.getItem('travel_memory_index_v1'));
  });

  console.log('\n[2] 打开导出弹窗');
  await page.evaluate(k => window.MEM.openGallery(k, '青岛市'), 'cn:370200:青岛市');
  await sleep(900);
  await page.click('#btn-export');
  await sleep(600);
  const dlg = await page.evaluate(() => {
    const el = document.querySelector('.mv-panel');
    return el ? { title: el.querySelector('h3').textContent, src: (el.querySelector('.mv-cur') || {}).textContent } : null;
  });
  ok('弹窗打开', !!dlg && /导出/.test(dlg.title), JSON.stringify(dlg));
  ok('显示数据来源', !!dlg && /本机/.test(dlg.src || ''), dlg && dlg.src);
  await page.evaluate(() => document.querySelector('.up-cancel').click());
  await sleep(300);

  console.log('\n[3] 收集照片并生成 ZIP');
  const res = await page.evaluate(async () => {
    const items = await window.EXPORT.__collect(() => { });
    const manifest = {
      app: 'test', count: items.length,
      photos: items.map(i => ({ file: i.path, locKey: i.meta.locKey, caption: i.meta.cap, date: i.meta.date, isVideo: !!i.isVideo }))
    };
    const zip = await window.EXPORT.__makeZip(
      items.map(i => ({ path: i.path, blob: i.blob }))
        .concat([{ path: 'backup.json', blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) }])
    );
    const buf = new Uint8Array(await zip.arrayBuffer());
    // 转 base64 传回 Node 端校验
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { b64: btoa(bin), count: items.length, names: items.map(i => i.path), size: zip.size };
  });

  ok('收集到 4 个文件（3 图 + 1 视频）', res.count === 4, 'got ' + res.count + ': ' + JSON.stringify(res.names));
  ok('目录名可读（中国-青岛市）', res.names.some(n => n.startsWith('中国-青岛市/')), JSON.stringify(res.names));
  ok('文件名含序号与备注', res.names.some(n => /001_2026-10-01_栈桥\.jpg$/.test(n)), JSON.stringify(res.names));
  ok('实况视频单独成 .mp4', res.names.some(n => n.endsWith('.mp4')), JSON.stringify(res.names));

  console.log('\n[4] 校验 ZIP 结构（Node 端独立解析）');
  const buf = Buffer.from(res.b64, 'base64');
  let entries = [];
  let parseErr = null;
  try { entries = parseZip(buf); } catch (e) { parseErr = e.message; }
  ok('ZIP 可解析', !parseErr, parseErr);
  ok('条目数 = 5（4 文件 + backup.json）', entries.length === 5, 'got ' + entries.length);
  ok('包含 backup.json', entries.some(e => e.name === 'backup.json'), entries.map(e => e.name).join(', '));

  const bad = entries.filter(e => crc32(e.data) !== e.crc);
  ok('所有条目 CRC 校验通过', bad.length === 0, bad.map(e => e.name).join(', '));

  const bj = entries.find(e => e.name === 'backup.json');
  if (bj) {
    const m = JSON.parse(bj.data.toString('utf8'));
    ok('backup.json 含 4 条照片记录', m.count === 4 && m.photos.length === 4, 'count=' + m.count);
    ok('记录里有地点/备注/日期', m.photos.every(p => p.locKey && p.caption && p.date),
      JSON.stringify(m.photos[0]));
  }
  const jpg = entries.find(e => e.name.endsWith('.jpg'));
  ok('JPEG 内容有效（FFD8 开头）', !!jpg && jpg.data[0] === 0xFF && jpg.data[1] === 0xD8,
    jpg && jpg.data.slice(0, 4).toString('hex'));

  console.log('\n[5] 页面错误');
  ok('无脚本错误', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
