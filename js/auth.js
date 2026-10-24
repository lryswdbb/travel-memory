/* ============ 认证模块（Supabase 邮箱验证码登录） ============
 * 设计：
 *   - 无密码体系。用户输入邮箱 → 收 6 位数字验证码 → 验证即登录（首次自动注册）。
 *   - 会话由 supabase-js 持久化到 localStorage，自动续期。
 *   - CDN 加载失败 / 配置未填时：AUTH.available = false，房间功能隐藏，
 *     网站其余部分（个人模式）完全正常。
 * 依赖：window.supabase（CDN UMD）、window.APP_CONFIG（js/config.js）、
 *       window.showScene（gallery.js）。
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  let sb = null;
  let available = false;
  const listeners = [];
  let returnScene = 'scene-map';   // 登录成功后回到的场景
  let resendTimer = null;

  function configured() {
    const c = window.APP_CONFIG || {};
    return !!(window.supabase && c.SUPABASE_URL && c.SUPABASE_ANON_KEY
      && !/YOUR_PROJECT_REF|YOUR_ANON_KEY/.test(c.SUPABASE_URL + c.SUPABASE_ANON_KEY));
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
        listeners.forEach(cb => { try { cb(u); } catch (e) { console.error(e); } });
        if (window.ROOMS && window.ROOMS.onAuthChanged) window.ROOMS.onAuthChanged(u);
      });
    }

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

  let _cachedUser = null;

  // 发送验证码（登录/注册同一个调用；未知邮箱在验证通过时自动建号）
  async function sendCode(email) {
    if (!available) return { ok: false, error: '云服务未配置，暂时只能使用个人模式' };
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }
    });
    if (error) return { ok: false, error: mapErr(error.message) };
    return { ok: true };
  }

  // 校验 6 位验证码
  async function verifyCode(email, token) {
    if (!available) return { ok: false, error: '云服务未配置' };
    const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) return { ok: false, error: mapErr(error.message) };
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

  function mapErr(msg) {
    const m = String(msg || '');
    if (/rate limit/i.test(m)) return '发送太频繁，请稍后再试';
    if (/invalid otp|otp expired|token has expired/i.test(m))
      return '验证码不正确或已过期。若你收到的是链接而非 6 位数字，请联系站长调整邮件模板';
    if (/email not confirmed/i.test(m)) return '该邮箱尚未确认，请重新获取验证码';
    if (/invalid login credentials/i.test(m)) return '验证码不正确';
    if (/unable to validate email/i.test(m)) return '邮箱格式不正确';
    return m;
  }

  // ---------- UI 绑定 ----------
  function open(opts) {
    const o = opts || {};
    returnScene = o.returnTo || 'scene-map';
    showStep('email');
    if (window.showScene) window.showScene('scene-auth');
    setTimeout(() => { const el = $('auth-email'); if (el && !el.value) el.focus(); }, 350);
  }

  function showStep(name) {
    ['email', 'code', 'user'].forEach(s => {
      const el = $('auth-step-' + s);
      if (el) el.hidden = (s !== name);
    });
  }

  function setErr(text) {
    const el = $('auth-err');
    if (el) el.textContent = text || '';
  }

  function startResendCooldown() {
    const btn = $('auth-resend');
    if (!btn) return;
    let n = 60;
    btn.disabled = true;
    btn.textContent = `重新发送 (${n}s)`;
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(resendTimer);
        btn.disabled = false;
        btn.textContent = '重新发送';
      } else {
        btn.textContent = `重新发送 (${n}s)`;
      }
    }, 1000);
  }

  let pendingEmail = '';

  async function onSend() {
    const email = ($('auth-email').value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('请输入有效的邮箱地址'); return; }
    setErr('');
    const btn = $('auth-send');
    btn.disabled = true; btn.textContent = '发送中…';
    const res = await sendCode(email);
    btn.disabled = false; btn.textContent = '获取验证码';
    if (!res.ok) { setErr(res.error); return; }
    pendingEmail = email;
    $('auth-sent-to').textContent = email;
    showStep('code');
    startResendCooldown();
    setTimeout(() => $('auth-code').focus(), 60);
  }

  async function onVerify() {
    const token = ($('auth-code').value || '').trim();
    if (!/^[0-9]{6}$/.test(token)) { setErr('请输入 6 位数字验证码'); return; }
    setErr('');
    const btn = $('auth-verify');
    btn.disabled = true; btn.textContent = '验证中…';
    const res = await verifyCode(pendingEmail, token);
    btn.disabled = false; btn.textContent = '登录';
    if (!res.ok) { setErr(res.error); return; }
    refreshUserStep();
    // 回到进入登录前的场景
    if (window.showScene) window.showScene(returnScene);
    if (window.ROOMS && window.ROOMS.onAuthChanged) window.ROOMS.onAuthChanged(res.user);
  }

  async function refreshUserStep() {
    const u = await getUser();
    _cachedUser = u;
    if (u) {
      const who = $('auth-who');
      if (who) who.textContent = displayName(u) + '（' + (u.email || '') + '）';
      showStep('user');
    }
    if (window.ROOMS && window.ROOMS.updateBar) window.ROOMS.updateBar();
  }

  function bindUI() {
    const send = $('auth-send'); if (send) send.onclick = onSend;
    const verify = $('auth-verify'); if (verify) verify.onclick = onVerify;
    const resend = $('auth-resend');
    if (resend) resend.onclick = () => { $('auth-email').value = pendingEmail; onSend(); };
    const back = $('auth-back');
    if (back) back.onclick = () => {
      const u = _cachedUser;
      window.showScene(u ? returnScene : 'scene-cover');
    };
    const signout = $('auth-signout');
    if (signout) signout.onclick = async () => {
      await signOut();
      showStep('email');
      if (window.showScene) window.showScene('scene-cover');
    };
    const code = $('auth-code');
    if (code) {
      code.addEventListener('input', () => {
        code.value = code.value.replace(/[^0-9]/g, '').slice(0, 6);
        if (code.value.length === 6) onVerify();   // 输满 6 位自动提交
      });
    }
    const emailIn = $('auth-email');
    if (emailIn) emailIn.addEventListener('keydown', e => { if (e.key === 'Enter') onSend(); });
  }

  window.AUTH = {
    init,
    open,
    get available() { return available; },
    get sb() { return sb; },
    getUser,
    displayName,
    sendCode,
    verifyCode,
    signOut,
    onChange,
    refreshUserStep,
  };
})();
