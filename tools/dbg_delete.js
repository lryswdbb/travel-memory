/* 注销账号端到端：注册 → 注销 → 同用户名登录应失败（账号已删） */
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('dialog', d => { console.log('DIALOG:', d.message().slice(0, 60)); d.accept(); });

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.AUTH && window.AUTH.available, { timeout: 30000 });

  const uname = 'del' + Date.now().toString().slice(-6);
  const reg = await page.evaluate(u => window.AUTH.register(u, 'test123456'), uname);
  console.log('注册:', reg.ok ? '✅' : '❌ ' + reg.error);

  // 账号面板里点注销（走真实 UI 路径）
  await page.evaluate(() => window.AUTH.openAccount());
  await page.waitForSelector('.acct-del', { timeout: 8000 });
  await page.click('.acct-del');
  await new Promise(r => setTimeout(r, 4000));
  const chipHidden = await page.evaluate(() => document.getElementById('user-chip').hidden);
  console.log('注销后头像隐藏:', chipHidden ? '✅' : '❌');

  // 同用户名登录应失败
  const login = await page.evaluate(u => window.AUTH.login(u, 'test123456'), uname);
  console.log('注销后登录:', login.ok ? '❌ 账号居然还在！' : '✅ 已删除（' + login.error + '）');

  await browser.close();
  process.exit(login.ok ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
