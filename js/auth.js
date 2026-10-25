/* ============ 认证模块（Supabase 用户名 + 密码） ============
 * 设计：
 *   - 用户只需「用户名 + 密码」，无需邮箱。内部把用户名经 SHA-256 派生成一个
 *     唯一的伪邮箱（<hash>@users.travel-memory.app）作为 Supabase 账号主键，
 *     用户名本身存进 user_metadata.display_name 用于展示。
 *   - 派生是确定性的：同一用户名在任何设备都映射到同一账号，故可直接密码登录。
 *   - 会话由 supabase-js 持久化到 localStorage，自动续期。
 *   - CDN 加载失败 / 配置未填时：AUTH.available = false，房间功能隐藏，
 *     网站其余部分（个人模式）完全正常。
 *   - ⚠️ 需在 Supabase 后台关闭「Confirm email」，否则注册/登录拿不到会话。
 * 依赖：window.supabase（CDN UMD）、window.APP_CONFIG（js/config.js）、
 *       window.showScene（gallery.js）。
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const EMAIL_DOMAIN = 'users.travel-memory.app';

  let sb = null;
  let available = false;
  let _cachedUser = null;
  const listeners = [];
  let returnScene = 'scene-map';   // 登录成功后「继续」回到的场景

  function configured() {
    const c = window.APP_CONFIG || {};
    return !!(window.supabase && c.SUPABASE_URL && c.SUPABASE_ANON_KEY
      && !/YOUR_PROJECT_REF|YOUR_ANON_KEY/.test(c.SUPABASE_URL + c.SUPABASE_ANON_KEY));
  }

  // 用户名 → 确定性伪邮箱（SHA-256 hex 作 local part，纯 ASCII，永不冲突邮箱格式）
  async function sha256Hex(str) {
    if (!crypto || !crypto.subtle) throw new Error('no-webcrypto');
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function deriveEmail(username) {
    const norm = String(username).trim().toLowerCase();   // 用户名大小写不敏感
    const h = await sha256Hex('travel-memory:' + norm);
    return h + '@' + EMAIL_DOMAIN;
  }

  // 8 位随机数字 UID（展示用账号编号，注册时生成，存 user_metadata.uid）
  function genUid() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return String(10000000 + (a[0] % 90000000));
  }

  // ---------- 初始化 ----------
  function init() {
    if (configured()) {
      try {
        sb = window.supabase.createClient(
          window.APP_CONFIG.SUPABASE_URL,
          window.APP_CONFIG.SUPABASE_ANON_KEY,
          { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
        );
        available = true;
      } catch (e) {
        console.warn('Supabase 客户端创建失败，仅个人模式：', e);
        sb = null; available = false;
      }
    } else {
      console.warn('未检测到有效的 Supabase 配置（js/config.js），仅个人模式可用。');
    }

    if (available) {
      sb.auth.onAuthStateChange((event, session) => {
        const u = session && session.user;
        _cachedUser = u;
        if (!u) closeAccount();   // 登出时收起账号面板
        updateUserChip();
        listeners.forEach(cb => { try { cb(u); } catch (e) { console.error(e); } });
        if (window.ROOMS && window.ROOMS.onAuthChanged) window.ROOMS.onAuthChanged(u);
      });
    }

    buildUserChip();
    bindUI();
    refreshUserStep();
  }

  // ---------- 对外 API ----------
  async function getUser() {
    if (!available) return null;
    const { data } = await sb.auth.getUser();
    return data && data.user ? data.user : null;
  }
  function displayName(u) {
    const usr = u || _cachedUser;
    if (!usr) return '匿名';
    const md = usr.user_metadata || {};
    if (md.display_name) return String(md.display_name).slice(0, 24);
    const email = usr.email || '';
    return email.split('@')[0] || '旅人';
  }
  // 8 位 UID（老账号没有的话补生成一个并写回 metadata）
  function getUid(u) {
    const usr = u || _cachedUser;
    const md = (usr && usr.user_metadata) || {};
    return /^\d{8}$/.test(md.uid || '') ? md.uid : null;
  }
  async function ensureUid() {
    if (!available || !_cachedUser) return null;
    let uid = getUid(_cachedUser);
    if (!uid) {
      uid = genUid();
      const { data, error } = await sb.auth.updateUser({ data: { uid } });
      if (!error && data && data.user) _cachedUser = data.user;
    }
    return uid;
  }
  function avatarUrl(u) {
    const usr = u || _cachedUser;
    const md = (usr && usr.user_metadata) || {};
    return typeof md.avatar === 'string' && md.avatar.startsWith('data:image/') ? md.avatar : '';
  }
  // 上传头像：缩到 128px 存成 dataURL 进 user_metadata（几十 KB 内）
  async function setAvatar(file) {
    if (!available || !_cachedUser) return { ok: false, error: '未登录' };
    if (!/^image\//.test(file.type)) return { ok: false, error: '请选择图片文件' };
    if (file.size > 8 * 1024 * 1024) return { ok: false, error: '图片不能超过 8MB' };
    let dataUrl;
    try { dataUrl = await shrinkToDataUrl(file, 128, 0.85); }
    catch (e) { return { ok: false, error: '图片处理失败：' + (e.message || e) }; }
    if (dataUrl.length > 180 * 1024) return { ok: false, error: '图片过于复杂，换一张试试' };
    const { data, error } = await sb.auth.updateUser({ data: { avatar: dataUrl } });
    if (error) return { ok: false, error: '保存失败：' + mapErr(error.message) };
    if (data && data.user) _cachedUser = data.user;
    return { ok: true };
  }
  function shrinkToDataUrl(file, max, q) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const sc = Math.min(1, max / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', q));
        } catch (e) { reject(e); }
        finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片')); };
      img.src = url;
    });
  }
  // 修改密码（需当前已登录会话）
  async function changePassword(newPass) {
    if (!available) return { ok: false, error: '云服务未配置' };
    if (!newPass || newPass.length < 6) return { ok: false, error: '新密码至少 6 位' };
    const { error } = await sb.auth.updateUser({ password: newPass });
    if (error) return { ok: false, error: mapErr(error.message) };
    return { ok: true };
  }

  // 注销账号：服务端单事务删除本人上传照片(含存储文件)/成员关系/账号，
  // 本地再清会话、IndexedDB 缓存与个人照片、已存房间。不可逆。
  async function deleteAccount() {
    if (!available || !_cachedUser) return { ok: false, error: '未登录' };
    // 先退出房间模式，避免后端继续引用即将删除的数据
    if (window.ROOMS && window.ROOMS.current && window.ROOMS.current()) {
      try { window.ROOMS.exit({ silent: true }); } catch (e) { }
    }
    const { error } = await sb.rpc('delete_own_account');
    if (error) return { ok: false, error: '注销失败：' + mapErr(error.message) };
    try { await sb.auth.signOut(); } catch (e) { }   // 账号已删，会话失效报错可忽略
    _cachedUser = null;
    // 本地数据：关闭 IndexedDB 连接后整库删除（含个人模式照片与房间缓存）
    try {
      if (window.MEM && window.MEM.closeDB) window.MEM.closeDB();
      if (window.indexedDB) indexedDB.deleteDatabase('travel_memory_db');
    } catch (e) { }
    try { localStorage.removeItem('travel_memory_current_room'); } catch (e) { }
    return { ok: true };
  }

  // 注册：创建新账号并直接登录（需后台已关闭邮箱确认）
  async function register(username, password) {
    if (!available) return { ok: false, error: '云服务未配置，暂时只能使用个人模式' };
    let email;
    try { email = await deriveEmail(username); }
    catch (e) { return { ok: false, error: '当前浏览器不支持安全加密，请用最新版 Chrome/Edge' }; }
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { display_name: String(username).trim(), uid: genUid() } }
    });
    if (error) return { ok: false, error: mapErr(error.message, 'register') };
    if (!data.session) {
      // 后台仍开着邮箱确认 → 拿不到会话
      return { ok: false, error: '账号已创建，但云端要求邮箱确认。请站长在 Supabase 关闭 Confirm email 后重试。' };
    }
    _cachedUser = data.user;
    return { ok: true, user: _cachedUser };
  }

  // 登录：用户名 + 密码
  async function login(username, password) {
    if (!available) return { ok: false, error: '云服务未配置，暂时只能使用个人模式' };
    let email;
    try { email = await deriveEmail(username); }
    catch (e) { return { ok: false, error: '当前浏览器不支持安全加密，请用最新版 Chrome/Edge' }; }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: mapErr(error.message, 'login') };
    _cachedUser = data && data.user;
    return { ok: true, user: _cachedUser };
  }

  async function signOut() {
    if (!available) return;
    await sb.auth.signOut();
    _cachedUser = null;
    if (window.ROOMS && window.ROOMS.exit) { try { window.ROOMS.exit(); } catch (e) { } }
  }

  function onChange(cb) { listeners.push(cb); }

  function mapErr(msg, kind) {
    const m = String(msg || '');
    if (/already registered|already been registered/i.test(m))
      return '这个用户名已被注册，换一个，或直接登录';
    if (/invalid login credentials/i.test(m))
      return kind === 'login' ? '用户名或密码不对' : '注册失败：用户名或密码有问题';
    if (/email_not_confirmed|email not confirmed/i.test(m))
      return '该账号需邮箱确认后才能登录。请站长在 Supabase 关闭 Confirm email，或重新注册。';
    if (/password.*short|weak password|password should be/i.test(m))
      return '密码太弱，请至少 6 位';
    if (/rate limit|too many requests/i.test(m))
      return '操作太频繁，请稍后再试';
    if (/unable to validate email|invalid.*email/i.test(m))
      return '用户名派生的账号格式异常，请换一个用户名（避免特殊符号）';
    return m;
  }

  // ---------- UI 绑定 ----------
  function open(opts) {
    const o = opts || {};
    returnScene = o.returnTo || 'scene-map';
    // 已登录直接显示账号态，否则显示登录/注册
    refreshUserStep().then(() => {
      if (!_cachedUser) showStep('login');
    });
    setErr('');
    if (window.showScene) window.showScene('scene-auth');
    setTimeout(() => {
      const el = _cachedUser ? null : $('auth-username');
      if (el && !el.value) el.focus();
    }, 350);
  }

  function showStep(name) {
    ['login', 'user'].forEach(s => {
      const el = $('auth-step-' + s);
      if (el) el.hidden = (s !== name);
    });
  }

  function setErr(text) {
    const el = $('auth-err');
    if (el) el.textContent = text || '';
  }

  // 校验并返回 {username, password} 或弹错
  function readCreds(minPass) {
    const username = ($('auth-username').value || '').trim();
    const password = $('auth-password').value || '';
    if (username.length < 2) { setErr('用户名至少 2 个字符'); return null; }
    if (username.length > 20) { setErr('用户名最多 20 个字符'); return null; }
    if (password.length < minPass) { setErr(`密码至少 ${minPass} 位`); return null; }
    setErr('');
    return { username, password };
  }

  async function onRegister() {
    const creds = readCreds(6);
    if (!creds) return;
    const prev = lockBtns(true);
    const res = await register(creds.username, creds.password);
    lockBtns(false, prev);
    if (!res.ok) { setErr(res.error); return; }
    onAuthed(res.user);
  }

  async function onLogin() {
    const creds = readCreds(1);   // 登录时不强制长度，交给服务端判断
    if (!creds) return;
    const prev = lockBtns(true);
    const res = await login(creds.username, creds.password);
    lockBtns(false, prev);
    if (!res.ok) { setErr(res.error); return; }
    onAuthed(res.user);
  }

  function lockBtns(disabled, prev) {
    const reg = $('auth-register'), log = $('auth-login');
    if (disabled) {
      const p = { reg: reg && reg.textContent, log: log && log.textContent };
      if (reg) { reg.disabled = true; reg.textContent = '处理中…'; }
      if (log) { log.disabled = true; }
      return p;
    }
    if (reg) { reg.disabled = false; reg.textContent = (prev && prev.reg) || '注册新账号'; }
    if (log) { log.disabled = false; }
  }

  function onAuthed(user) {
    _cachedUser = user;
    setErr('');
    // 清空密码框（安全）
    const pw = $('auth-password'); if (pw) pw.value = '';
    refreshUserStep();
    showStep('user');
    updateUserChip();
    if (window.ROOMS && window.ROOMS.onAuthChanged) window.ROOMS.onAuthChanged(user);
  }

  // ---------- 右下角账号悬浮入口 ----------
  let chipBuilt = false;
  function buildUserChip() {
    if (chipBuilt) return;
    const chip = document.createElement('div');
    chip.id = 'user-chip';
    chip.className = 'user-chip';
    chip.hidden = true;
    chip.title = '账号设置';
    chip.innerHTML = '<span class="uc-avatar"></span><span class="uc-name"></span>';
    chip.onclick = () => openAccount();
    document.body.appendChild(chip);
    chipBuilt = true;
  }
  function updateUserChip() {
    buildUserChip();
    const chip = $('user-chip');
    if (!chip) return;
    const u = _cachedUser;
    if (!u || !available) { chip.hidden = true; return; }
    chip.hidden = false;
    const av = chip.querySelector('.uc-avatar');
    const url = avatarUrl(u);
    if (url) { av.style.backgroundImage = `url("${url}")`; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = displayName(u).slice(0, 1).toUpperCase(); }
    chip.querySelector('.uc-name').textContent = displayName(u);
  }

  // ---------- 账号设置面板 ----------
  let acctEl = null;
  function closeAccount() { if (acctEl) { acctEl.remove(); acctEl = null; } }

  async function openAccount() {
    if (!available || !_cachedUser) return;
    closeAccount();
    const u = _cachedUser;
    const uid = (await ensureUid()) || '—';
    acctEl = document.createElement('div');
    acctEl.className = 'up-dialog';
    acctEl.innerHTML = `
      <div class="up-panel acct-panel">
        <h3 class="acct-title">👤 我的账号</h3>
        <div class="acct-row">
          <label class="acct-avatar" title="点击更换头像">
            <span class="av"></span>
            <input type="file" accept="image/*" hidden>
          </label>
          <div class="acct-id">
            <div class="acct-name"></div>
            <div class="acct-uid">UID <b></b><button class="acct-copy" title="复制 UID">⧉</button></div>
            <div class="acct-hint">点击左侧头像可更换</div>
          </div>
        </div>
        <div class="acct-sec">
          <h4>🔑 修改密码</h4>
          <input class="auth-input acct-newpass" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password">
          <input class="auth-input acct-newpass2" type="password" placeholder="确认新密码" autocomplete="new-password">
          <button class="up-cancel danger acct-del" data-act="delete">🗑 注销账户（不可恢复）</button>
          <div class="acct-err"></div>
          <div class="up-btns">
            <button class="up-cancel" data-act="close">关闭</button>
            <button class="up-ok" data-act="savepass">保存新密码</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(acctEl);
    acctEl.onclick = e => { if (e.target === acctEl) closeAccount(); };

    // 填充头像 / 名称 / UID
    const av = acctEl.querySelector('.av');
    const url = avatarUrl(u);
    if (url) av.style.backgroundImage = `url("${url}")`;
    else av.textContent = displayName(u).slice(0, 1).toUpperCase();
    acctEl.querySelector('.acct-name').textContent = displayName(u);
    acctEl.querySelector('.acct-uid b').textContent = uid;
    const err = m => { acctEl.querySelector('.acct-err').textContent = m || ''; };

    acctEl.querySelector('.acct-copy').onclick = async () => {
      const t = acctEl.querySelector('.acct-uid b').textContent;
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(t);
        else throw new Error('no clipboard');
        err('✅ UID 已复制');
      } catch (e) { err('复制失败，请手动选择复制'); }
    };

    // 头像上传
    const fileIn = acctEl.querySelector('input[type=file]');
    fileIn.onchange = async () => {
      if (!fileIn.files || !fileIn.files[0]) return;
      err('头像上传中…');
      const res = await setAvatar(fileIn.files[0]);
      fileIn.value = '';
      if (!res.ok) { err(res.error); return; }
      err('✅ 头像已更新');
      const nu = avatarUrl();
      if (nu) { av.style.backgroundImage = `url("${nu}")`; av.textContent = ''; }
      updateUserChip();
    };

    // 修改密码
    acctEl.querySelector('[data-act=savepass]').onclick = async () => {
      const p1 = acctEl.querySelector('.acct-newpass').value;
      const p2 = acctEl.querySelector('.acct-newpass2').value;
      if (p1.length < 6) { err('新密码至少 6 位'); return; }
      if (p1 !== p2) { err('两次输入的密码不一致'); return; }
      err('保存中…');
      const res = await changePassword(p1);
      if (!res.ok) { err(res.error); return; }
      acctEl.querySelector('.acct-newpass').value = '';
      acctEl.querySelector('.acct-newpass2').value = '';
      err('✅ 密码已修改，下次登录请用新密码');
    };

    // 注销账户（两次确认，不可逆）
    const delBtn = acctEl.querySelector('[data-act=delete]');
    delBtn.onclick = async () => {
      if (!confirm(`确定注销账号「${displayName()}」吗？\n将永久删除：你上传的所有照片、房间成员关系、账号本身。\n此操作不可恢复！`)) return;
      if (!confirm('最后确认：删除后无法找回，同房间成员也将看不到你上传的照片。继续注销？')) return;
      delBtn.disabled = true; delBtn.textContent = '注销中…';
      err('');
      const res = await deleteAccount();
      if (!res.ok) { delBtn.disabled = false; delBtn.textContent = '🗑 注销账户（不可恢复）'; err(res.error); return; }
      closeAccount();
      showStep('login');
      updateUserChip();
      if (window.showScene) window.showScene('scene-cover');
      alert('账号已注销，你的数据已全部删除。');
    };
    acctEl.querySelector('[data-act=close]').onclick = closeAccount;
  }

  async function refreshUserStep() {
    const u = _cachedUser || await getUser();
    _cachedUser = u;
    if (u) {
      const who = $('auth-who');
      if (who) who.textContent = displayName(u);
      showStep('user');
    }
    updateUserChip();
    if (window.ROOMS && window.ROOMS.updateBar) window.ROOMS.updateBar();
    return u;
  }

  function bindUI() {
    const reg = $('auth-register'); if (reg) reg.onclick = onRegister;
    const log = $('auth-login'); if (log) log.onclick = onLogin;
    const cont = $('auth-continue');
    if (cont) cont.onclick = () => {
      // 登录后「继续」= 进入地图解锁房间功能。
      // 若来处本就是地图/照片墙/统计等内页则返回该页；若从封面进来（returnScene 仍是封面
      // 或地图尚未初始化）则用 __enterMap 正确初始化地图，避免退回封面。
      const inner = ['scene-map', 'scene-gallery', 'scene-stats', 'scene-carousel'];
      if (window.__enterMap && (!inner.includes(returnScene) || !window.__mapInited)) {
        window.__enterMap();
      } else if (window.showScene) {
        window.showScene(returnScene);
        if (returnScene === 'scene-map' && window.MAP && window.MAP.refreshHighlight) window.MAP.refreshHighlight();
      }
    };
    const back = $('auth-back');
    if (back) back.onclick = () => {
      // 地图未初始化（从封面直接进来的）→ 回封面；否则回来处
      if (!window.__mapInited) window.showScene('scene-cover');
      else window.showScene(returnScene);
    };
    const signout = $('auth-signout');
    if (signout) signout.onclick = async () => {
      await signOut();
      showStep('login');
      if (window.showScene) window.showScene('scene-cover');
    };
    // 回车提交：密码框回车 = 登录；用户名框回车也触发登录
    ['auth-username', 'auth-password'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') onLogin(); });
    });
  }

  window.AUTH = {
    init,
    open,
    get available() { return available; },
    get sb() { return sb; },
    getUser,
    displayName,
    getUid,
    avatarUrl,
    setAvatar,
    changePassword,
    deleteAccount,
    openAccount,
    register,
    login,
    signOut,
    onChange,
    refreshUserStep,
  };
})();
