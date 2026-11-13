/* 房间成员管理测试（打桩 Supabase，不依赖已跑迁移）
 * 覆盖：
 *   1. 成员列表渲染：房主标「房主」、自己标「（我）」、房主能看到别人的转让/移除按钮
 *   2. 普通成员看不到管理按钮
 *   3. 移除成员：二次确认后调用删除，并从列表移除
 *   4. 转让房主：调用 RPC，成功后重新打开管理面板
 *   5. RPC 不存在时回退到直接查表（未跑迁移的老项目也能看成员）
 * 用法：node tools/test_room_members.js
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
  // confirm 一律同意，记录被问了几次
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);

  // 注入可控的假 Supabase 与假房间状态
  await page.evaluate(() => {
    window.__calls = [];
    window.__members = [
      { user_id: 'u-me', display_name: '小明', joined_at: '2026-01-01', is_owner: true },
      { user_id: 'u-hong', display_name: '小红', joined_at: '2026-02-01', is_owner: false },
      { user_id: 'u-gang', display_name: '小刚', joined_at: '2026-03-01', is_owner: false },
    ];
    window.__rpcAvailable = true;
    // 造一个假 supabase 客户端，只实现成员管理用到的几个方法
    const fakeSb = {
      rpc(name, args) {
        window.__calls.push({ kind: 'rpc', name, args });
        if (name === 'room_members_of') {
          if (!window.__rpcAvailable) return Promise.resolve({ data: null, error: { message: 'no function' } });
          return Promise.resolve({ data: window.__members, error: null });
        }
        if (name === 'transfer_room_ownership') {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
      },
      from(table) {
        const q = {
          _t: table, _op: 'select', _filters: {},
          select() { return q; },
          eq(k, v) { q._filters[k] = v; return q; },
          delete() { q._op = 'delete'; return q; },
          then(res) {
            window.__calls.push({ kind: 'from', table: q._t, op: q._op, filters: { ...q._filters } });
            if (q._t === 'room_members' && q._op === 'delete') {
              const uid = q._filters.user_id;
              window.__members = window.__members.filter(m => m.user_id !== uid);
              return Promise.resolve({ data: null, error: null }).then(res);
            }
            if (q._t === 'room_members' && q._op === 'select') {
              return Promise.resolve({ data: window.__members.map(m => ({
                user_id: m.user_id, display_name: m.display_name, joined_at: m.joined_at,
              })), error: null }).then(res);
            }
            return Promise.resolve({ data: null, error: null }).then(res);
          },
        };
        return q;
      },
    };
    // 把 AUTH 的 sb 换成假的（AUTH.sb 是 getter，这里换整个 AUTH 引用上的内部变量不可行，
    // 所以直接替换 window.AUTH 对象上的 getter）
    Object.defineProperty(window.AUTH, 'sb', { get: () => fakeSb, configurable: true });
    window.__fakeSb = fakeSb;
  });

  console.log('\n[1] 成员列表渲染（我是房主）');
  const list = await page.evaluate(async () => {
    // 伪造「已登录 + 在房间里」
    const me = { id: 'u-me', user_metadata: { display_name: '小明' } };
    await window.ROOMS.onAuthChanged(me);
    // onAuthChanged 会尝试恢复房间；直接构造管理面板需要 current，
    // 通过私有入口不可达，这里用 onAuthChanged 后的公开入口：
    // 给 ROOMS 打一个测试钩子——用 enter() 需要真实房间，改为直接调用内部 openRoomManage 的等价路径。
    // 折中：用 __test 钩子（下面在 rooms.js 里暴露）
    return null;
  });
  console.log('  （改用页面内直接调用内部函数）');

  console.log('\n[2] 通过测试钩子渲染管理面板');
  const r2 = await page.evaluate(async () => {
    const res = await window.ROOMS.__test_openManage('我们一起走过的路', 'u-me');
    await new Promise(r => setTimeout(r, 800));
    const el = document.querySelector('.rm-panel');
    if (!el) return { err: '面板未打开' };
    return {
      title: el.querySelector('h3').textContent,
      count: el.querySelector('#rm-mcount').textContent,
      rows: [...el.querySelectorAll('.rm-member')].map(x => ({
        name: x.querySelector('.rm-member-name').textContent,
        role: (x.querySelector('.rm-role') || {}).textContent,
        ops: [...x.querySelectorAll('.rm-op')].map(b => b.textContent),
      })),
    };
  });
  ok('面板打开', !r2.err, r2.err);
  ok('成员数 3 人', r2.count === '3 人', r2.count);
  ok('自己标「（我）」且是房主', !!r2.rows && /小明（我）/.test(r2.rows[0].name) && r2.rows[0].role === '房主',
    JSON.stringify(r2.rows && r2.rows[0]));
  ok('房主对自己没有管理按钮', !!r2.rows && r2.rows[0].ops.length === 0, JSON.stringify(r2.rows && r2.rows[0].ops));
  ok('房主对其他成员有「转让/移除」', !!r2.rows && r2.rows[1].ops.join(',') === '转让,移除',
    JSON.stringify(r2.rows && r2.rows[1].ops));

  console.log('\n[3] 移除成员');
  const r3 = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll('.rm-op')];
    const kick = btns.find(b => b.dataset.op === 'kick' && b.dataset.name === '小红');
    if (!kick) return { err: '找不到移除按钮' };
    kick.click();
    await new Promise(r => setTimeout(r, 900));
    const el = document.querySelector('.rm-panel');
    return {
      count: el.querySelector('#rm-mcount').textContent,
      names: [...el.querySelectorAll('.rm-member-name')].map(x => x.textContent),
      calls: window.__calls.filter(c => c.kind === 'from' && c.op === 'delete'),
    };
  });
  ok('人数变成 2 人', r3.count === '2 人', r3.count);
  ok('小红已从列表移除', !!r3.names && !r3.names.some(n => /小红/.test(n)), JSON.stringify(r3.names));
  ok('确实发出了删除请求', !!r3.calls && r3.calls.length === 1
    && r3.calls[0].filters.user_id === 'u-hong', JSON.stringify(r3.calls));

  console.log('\n[4] 转让房主');
  const r4 = await page.evaluate(async () => {
    window.__calls = [];
    const btns = [...document.querySelectorAll('.rm-op')];
    const tr = btns.find(b => b.dataset.op === 'transfer');
    if (!tr) return { err: '找不到转让按钮' };
    tr.click();
    await new Promise(r => setTimeout(r, 1200));
    const el = document.querySelector('.rm-panel');
    return {
      calls: window.__calls.filter(c => c.kind === 'rpc' && c.name === 'transfer_room_ownership'),
      stillOpen: !!el,
      rows: el ? [...el.querySelectorAll('.rm-member')].map(x => ({
        name: x.querySelector('.rm-member-name').textContent,
        role: (x.querySelector('.rm-role') || {}).textContent,
        ops: [...x.querySelectorAll('.rm-op')].length,
      })) : [],
    };
  });
  ok('调用了转让 RPC', !!r4.calls && r4.calls.length === 1, JSON.stringify(r4.calls));
  ok('转让后我变成普通成员、失去管理按钮',
    !!r4.rows && r4.rows.length > 0 && r4.rows.every(x => x.ops === 0),
    JSON.stringify(r4.rows));

  console.log('\n[5] 未跑迁移时的回退（RPC 不存在）');
  const r5 = await page.evaluate(async () => {
    window.__rpcAvailable = false;
    window.__calls = [];
    // 重置成员（小明仍是房主）
    window.__members = [
      { user_id: 'u-me', display_name: '小明', joined_at: '2026-01-01', is_owner: true },
      { user_id: 'u-hong', display_name: '小红', joined_at: '2026-02-01', is_owner: false },
    ];
    document.querySelectorAll('.up-dialog').forEach(x => x.remove());
    const res = await window.ROOMS.__test_openManage('老房间', 'u-me');
    await new Promise(r => setTimeout(r, 900));
    const el = document.querySelector('.rm-panel');
    return {
      count: el ? el.querySelector('#rm-mcount').textContent : 'no panel',
      fellBack: window.__calls.some(c => c.kind === 'from' && c.op === 'select'),
      names: el ? [...el.querySelectorAll('.rm-member-name')].map(x => x.textContent) : [],
    };
  });
  ok('回退到直接查表', r5.fellBack);
  ok('成员仍能正常显示', r5.count === '2 人' && r5.names.length === 2, JSON.stringify(r5));

  console.log('\n[6] 页面错误');
  ok('无脚本错误', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n' + (process.exitCode ? '存在失败项' : '全部通过'));
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
