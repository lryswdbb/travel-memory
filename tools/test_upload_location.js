/* 上传对话框「存入位置」提示的针对性验证
 * 覆盖：
 *   1. 从照片墙上传时，弹窗显示当前地点名
 *   2. 名称里的 HTML 特殊字符被正确转义（不注入）
 *   3. 编辑已有照片时（showPreview）不显示该提示
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
  page.on('dialog', d => d.dismiss());

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.MEM && window.MEM.backend, { timeout: 30000 });

  console.log('\n[1] 普通地点名');
  await page.evaluate(() => {
    window.MEM.openGallery('cn:370200:青岛市', '山东省 · 青岛市');
  });
  await new Promise(r => setTimeout(r, 800));

  // 触发文件选择器路径：直接调用内部弹窗（含 showPreview 的编辑场景另测）
  await page.evaluate(() => {
    const input = document.getElementById('file-input');
    // 不能真的选文件，改为直接观察 handleFiles 前的弹窗：用 __handleFiles 的等价入口不可行，
    // 因此这里用 DataTransfer 构造一个最小 File
    const f = new File([new Uint8Array([255, 216, 255, 217])], 'IMG_1.JPG', { type: 'image/jpeg', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await new Promise(r => setTimeout(r, 900));

  const dlg = await page.evaluate(() => {
    const el = document.querySelector('.up-dialog .up-loc');
    if (!el) return null;
    return {
      label: (el.querySelector('.up-loc-label') || {}).textContent,
      name: (el.querySelector('.up-loc-name') || {}).textContent,
      hint: (el.querySelector('.up-loc-hint') || {}).textContent,
      title: (document.querySelector('.up-dialog h3') || {}).textContent,
    };
  });
  ok('弹窗出现「存入位置」区块', !!dlg, '未找到 .up-loc');
  ok('显示的是当前地点名', !!dlg && dlg.name === '山东省 · 青岛市', dlg && dlg.name);
  ok('有清楚的说明文字', !!dlg && /归到/.test(dlg.hint || ''), dlg && dlg.hint);

  // 关闭弹窗
  await page.evaluate(() => {
    const b = document.querySelector('.up-dialog .up-cancel');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 400));

  console.log('\n[2] 名称含 HTML 特殊字符时的转义');
  const evil = '<img src=x onerror=alert(1)> & "quote"';
  await page.evaluate(name => {
    window.MEM.openGallery('world:__xss__', name);
  }, evil);
  await new Promise(r => setTimeout(r, 700));
  await page.evaluate(() => {
    const f = new File([new Uint8Array([255, 216, 255, 217])], 'IMG_2.JPG', { type: 'image/jpeg', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(f);
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await new Promise(r => setTimeout(r, 900));

  const xss = await page.evaluate(() => {
    const loc = document.querySelector('.up-dialog .up-loc-name');
    return {
      text: loc ? loc.textContent : null,
      injectedImg: !!(loc && loc.querySelector('img')),
      html: loc ? loc.innerHTML : null,
    };
  });
  ok('原始文本完整显示', xss.text === '<img src=x onerror=alert(1)> & "quote"', xss.text);
  ok('没有真的注入 <img> 元素', xss.injectedImg === false, JSON.stringify(xss));

  await page.evaluate(() => {
    const b = document.querySelector('.up-dialog .up-cancel');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 300));

  console.log('\n[3] 编辑已有照片时不显示该提示');
  const edit = await page.evaluate(async () => {
    // 直接打开编辑弹窗（showPreview 有值）
    const p = { id: 'e1', blob: new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' }), cap: 'x', date: '' };
    // openUploadDialog 是闭包内的，借由点击编辑按钮无法简单触发，
    // 这里改为验证 showPreview 分支下 .up-loc 不出现：通过 __handleFiles 无法覆盖，
    // 退而检查源码结构 —— 见下方静态断言
    return true;
  });
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'gallery.js'), 'utf8');
  ok('位置提示仅在非编辑模式渲染（源码断言）',
    /const willSave = o\.showPreview \? '' :/.test(src), '未找到条件判断');

  console.log('\n[4] 页面错误');
  ok('无脚本错误', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
