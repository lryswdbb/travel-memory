/* 调试：登录后地图消失问题 —— 追踪场景类变化 + 控制台错误 + 截图 */
const puppeteer = require('puppeteer');

let pageRef = null;   // 失败时也要清理测试账号/房间

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  pageRef = page;
  await page.setViewport({ width: 1280, height: 800 });

  const logs = [];
  page.on('console', m => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r => logs.push(`[reqfail] ${r.url().slice(0, 90)} ${r.failure() && r.failure().errorText}`));

  // 注入场景追踪器：记录每次 scene 类变化 + showScene 调用栈 + 404
  await page.evaluateOnNewDocument(() => {
    window.__sceneLog = [];
    window.__showSceneCalls = [];
    const obs = new MutationObserver(muts => {
      muts.forEach(m => {
        if (m.target.id && m.target.id.startsWith('scene-')) {
          window.__sceneLog.push(`${Date.now() % 100000} ${m.target.id} class="${m.target.className}"`);
        }
      });
    });
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.scene').forEach(el =>
        obs.observe(el, { attributes: true, attributeFilter: ['class'] }));
      // 包装 showScene 记录调用栈
      const orig = window.showScene;
      window.showScene = function (id) {
        window.__showSceneCalls.push(`${Date.now() % 100000} showScene("${id}")\n    ${(new Error()).stack.split('\n').slice(2, 5).join('\n    ')}`);
        return orig.apply(this, arguments);
      };
    });
  });

  page.on('response', r => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url().slice(0, 110)}`); });

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));

  // supabase CDN 大陆偶发失败 → AUTH 不可用 → 封面登录按钮隐藏。检测并重试一次
  let authOk = await page.evaluate(() => !!(window.supabase && window.AUTH && window.AUTH.available));
  if (!authOk) {
    logs.push('!! supabase CDN 首次加载失败，重试…');
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    authOk = await page.evaluate(() => !!(window.supabase && window.AUTH && window.AUTH.available));
  }
  logs.push('supabase CDN loaded: ' + authOk);
  if (!authOk) { console.log(logs.join('\n')); await browser.close(); process.exit(2); }

  // 走页面注册流程（新账号），再点「继续」进地图
  await page.click('#btn-cover-auth');
  await new Promise(r => setTimeout(r, 800));
  const uname = 'dbg' + Date.now().toString().slice(-6);
  await page.type('#auth-username', uname);
  await page.type('#auth-password', 'test123456');
  await page.click('#auth-register');
  await new Promise(r => setTimeout(r, 3000));
  logs.push('--- after register ---');
  logs.push('auth-err: ' + await page.evaluate(() => (document.getElementById('auth-err') || {}).textContent || '(none)'));
  logs.push('scenes: ' + await page.evaluate(() =>
    [...document.querySelectorAll('.scene')].filter(s => s.className.includes('active')).map(s => s.id).join(',') || '(none active!)'));
  await page.screenshot({ path: 'tools/dbg_after_login.png' });

  const contVisible = await page.evaluate(() => {
    const b = document.getElementById('auth-continue');
    return b && !b.closest('[hidden]');
  });
  logs.push('continue visible: ' + contVisible);
  if (contVisible) {
    await page.click('#auth-continue');
    // 追踪接下来 8 秒的场景变化与地图 canvas
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 1000));
      logs.push(`t+${i + 1}s ` + await page.evaluate(() => {
        const act = [...document.querySelectorAll('.scene')].filter(s => s.className.includes('active')).map(s => s.id).join(',') || '(none!)';
        const c = document.querySelector('#map-chart canvas');
        return `active=[${act}] canvas=${c ? c.width + 'x' + c.height : 'none'} chartBox=${(() => { const el = document.getElementById('map-chart'); return el ? el.clientWidth + 'x' + el.clientHeight : '?'; })()}`;
      }));
    }
  }
  await page.screenshot({ path: 'tools/dbg_after_continue.png' });

  // ===== 建一个房间（复现用户「带已保存房间」的状态） =====
  logs.push('===== CREATE ROOM =====');
  await page.click('#room-menu-btn');
  await page.waitForSelector('.up-dialog [data-act=create]', { timeout: 15000 });
  await page.click('.up-dialog [data-act=create]');
  await page.waitForSelector('.rm-in-name', { timeout: 10000 });
  await page.type('.rm-in-name', 'dbg房' + uname.slice(3));
  await page.type('.rm-in-pass', 'pass1234');
  await page.type('.rm-in-pass2', 'pass1234');
  await page.click('.up-dialog [data-act=ok]');
  await new Promise(r => setTimeout(r, 5000));
  logs.push('after create: ' + await page.evaluate(() => {
    const act = [...document.querySelectorAll('.scene')].filter(s => s.className.includes('active')).map(s => s.id).join(',') || '(none!)';
    const mode = document.getElementById('room-mode');
    const c = document.querySelector('#map-chart canvas');
    return `active=[${act}] roomMode=${mode ? mode.textContent : '?'} canvas=${c ? c.width + 'x' + c.height : 'none'}`;
  }));
  await page.screenshot({ path: 'tools/dbg_in_room.png' });

  // ===== 模拟用户 F5：带会话+已保存房间刷新 =====
  logs.push('===== RELOAD (F5 with session) =====');
  await page.evaluate(() => { window.__sceneLog = []; window.__showSceneCalls = []; });
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 1000));
    logs.push(`r+${i + 1}s ` + await page.evaluate(() => {
      const act = [...document.querySelectorAll('.scene')].filter(s => s.className.includes('active')).map(s => s.id).join(',') || '(none!)';
      const c = document.querySelector('#map-chart canvas');
      return `active=[${act}] canvas=${c ? c.width + 'x' + c.height : 'none'}`;
    }));
  }
  await page.screenshot({ path: 'tools/dbg_after_reload.png' });
  logs.push('--- reload sceneLog ---');
  logs.push(...(await page.evaluate(() => window.__sceneLog)).slice(-30));
  logs.push('--- reload showScene calls ---');
  logs.push(...(await page.evaluate(() => window.__showSceneCalls)).slice(-10));

  // ===== 刷新后点「点击进入」→ 跳过穿梭 → 观察地图 10 秒 =====
  logs.push('===== CLICK ENTER AFTER RELOAD =====');
  await page.evaluate(() => { window.__sceneLog = []; });
  await page.click('#btn-enter');
  await new Promise(r => setTimeout(r, 1500));
  const skipBtn = await page.$('#warp-skip');
  if (skipBtn) await skipBtn.click();
  await new Promise(r => setTimeout(r, 800));
  logs.push('after skip: arrived=' + await page.evaluate(() => window.WarpScene && window.WarpScene.arrived));
  // 抵达态出现后点「进入地图」；最多重试 6 次
  for (let k = 0; k < 6; k++) {
    const shown = await page.evaluate(() => {
      const ui = document.getElementById('warp-ui');
      return ui && ui.classList.contains('show');
    });
    if (shown) { await page.click('#warp-enter'); break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  logs.push('after enter click: mapInited=' + await page.evaluate(() => !!window.__mapInited));
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    logs.push(`e+${i + 1}s ` + await page.evaluate(() => {
      const act = [...document.querySelectorAll('.scene')].filter(s => s.className.includes('active')).map(s => s.id).join(',') || '(none!)';
      const c = document.querySelector('#map-chart canvas');
      const cs = c ? getComputedStyle(c) : null;
      return `active=[${act}] canvas=${c ? c.width + 'x' + c.height + ' disp=' + cs.display : 'NONE'}`;
    }));
  }
  await page.screenshot({ path: 'tools/dbg_after_enter.png' });
  logs.push('--- enter sceneLog ---');
  logs.push(...(await page.evaluate(() => window.__sceneLog)).slice(-25));
  logs.push('--- sceneLog ---');
  logs.push(...(await page.evaluate(() => window.__sceneLog)).slice(-40));
  logs.push('--- showScene calls ---');
  logs.push(...(await page.evaluate(() => window.__showSceneCalls)).slice(-12));
  logs.push('--- auth error text ---');
  logs.push(await page.evaluate(() => (document.getElementById('auth-err') || {}).textContent || '(none)'));
  logs.push('--- map state ---');
  logs.push(await page.evaluate(() => JSON.stringify({
    mapInited: !!window.__mapInited,
    level: window.MAP && window.MAP.level,
    chartDom: !!document.querySelector('#map-chart canvas'),
    chartSize: (() => { const c = document.querySelector('#map-chart canvas'); return c ? c.width + 'x' + c.height : 'none'; })(),
    mapChartVisible: (() => { const el = document.getElementById('map-chart'); return el ? getComputedStyle(el).display + '/' + el.clientWidth + 'x' + el.clientHeight : '?'; })(),
    roomBar: !!document.getElementById('room-bar'),
    userChipHidden: document.getElementById('user-chip') ? document.getElementById('user-chip').hidden : 'no-chip',
  })));

  // 清理：注销测试账号（级联删除其房间、成员关系与数据），不留垃圾房间
  try {
    await page.evaluate(() => window.AUTH.sb.rpc('delete_own_account'));
    logs.push('测试账号已注销清理');
  } catch (e) { logs.push('清理失败: ' + e.message); }

  console.log(logs.join('\n'));
  await browser.close();
})().catch(async e => {
  console.error('DEBUG FAIL:', e.message);
  if (pageRef) {
    try { await pageRef.evaluate(() => window.AUTH.sb.rpc('delete_own_account')); console.log('失败路径已清理测试账号'); }
    catch (_) { }
  }
  process.exit(1);
});
