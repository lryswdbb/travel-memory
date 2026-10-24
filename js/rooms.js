/* ============ 云端房间模块 ============
 * 职责：
 *   1. 房间栏 UI（scene-map 右上角）：登录入口、我的房间、创建/加入房间
 *   2. 房间后端（roomBackend）：注册进 window.MEM，让照片墙/地图无缝切到云端数据
 *   3. 实时同步：Supabase Realtime 订阅 photos 表 + 60s 轮询兜底
 * 安全：
 *   - 房间密码 = WebCrypto SHA-256(随机盐 + 密码)，比对发生在服务端 RPC 内，
 *     明文密码与哈希都不会存到本地或暴露在网络上（除加入时一次哈希提交）。
 *   - 照片存私有桶，成员经 RLS 校验后读取。
 * 依赖：window.AUTH（auth.js）、window.MEM（gallery.js）、window.MAP（map.js）。
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const CURRENT_ROOM_KEY = 'travel_memory_current_room';

  let current = null;        // {id, name, ownerId}
  let metaRows = [];         // 当前房间全部照片元数据（无 blob）
  let channel = null;        // Realtime 频道
  let pollTimer = null;
  let barBuilt = false;

  // ---------- 密码哈希（WebCrypto，https/localhost 均可用） ----------
  function toHex(buf) {
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function newSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return toHex(a);
  }
  async function hashPass(saltHex, password) {
    const enc = new TextEncoder().encode(saltHex + password);
    return toHex(await crypto.subtle.digest('SHA-256', enc));
  }

  const sb = () => window.AUTH && window.AUTH.sb;

  // ============================================================
  // 房间后端：实现 MEM 后端接口，注册后照片墙/地图全部走云端
  // ============================================================
  function makeRoomBackend(ctx) {
    return {
      mode: 'room',

      // 供地图高亮/统计：把 metaRows 汇总成 {locKey: count}
      buildStore() {
        const store = {};
        metaRows.forEach(r => { store[r.loc_key] = (store[r.loc_key] || 0) + 1; });
        return store;
      },

      async getPhotos(key) {
        const rows = metaRows.filter(r => r.loc_key === key);
        const photos = [];
        for (const r of rows) {
          try { photos.push(await rowToPhoto(r)); }
          catch (e) { console.warn('照片加载失败', r.id, e); }
        }
        return photos;
      },

      async getAllPhotos() {
        // 走马灯用：批量签名 URL（不下载 blob，img 懒加载按需取）
        const rows = metaRows.slice();
        const paths = rows.map(r => r.storage_path);
        let urls = null;
        if (paths.length) {
          const { data, error } = await sb().storage.from('room-photos')
            .createSignedUrls(paths, 60 * 60 * 2);
          if (!error && data) urls = data;
        }
        return rows.map((r, i) => ({
          id: r.id, locKey: r.loc_key, cap: r.cap, ts: Number(r.ts), date: r.shoot_date || '',
          uploader_id: r.uploader_id, uploader_name: r.uploader_name,
          url: (urls && urls[i] && urls[i].signedUrl) || null,
          storage_path: r.storage_path,
        }));
      },

      async addPhotos(key, items, onProgress) {
        const u = await window.AUTH.getUser();
        if (!u) throw new Error('登录已过期，请重新登录');
        for (let i = 0; i < items.length; i++) {
          if (onProgress) onProgress(i + 1, items.length);
          const it = items[i];
          const id = (crypto.randomUUID ? crypto.randomUUID()
            : 'r' + Date.now() + Math.random().toString(36).slice(2, 10));
          const path = `${ctx.roomId}/${id}.jpg`;
          const { error: upErr } = await sb().storage.from('room-photos')
            .upload(path, it.blob, { contentType: 'image/jpeg' });
          if (upErr) throw new Error('照片上传失败：' + upErr.message);
          const row = {
            id, room_id: ctx.roomId, loc_key: key,
            uploader_id: u.id, uploader_name: window.AUTH.displayName(u),
            cap: it.cap || '', shoot_date: it.date || '', ts: it.ts || Date.now(),
            storage_path: path,
          };
          const { error: insErr } = await sb().from('photos').insert(row);
          if (insErr) {
            // 回滚已传的文件，避免孤儿对象
            sb().storage.from('room-photos').remove([path]).catch(() => { });
            throw new Error('照片登记失败：' + insErr.message);
          }
          metaRows.push(row);
          // 顺手写本地缓存：上传的照片离线也能看
          try { await window.MEM.cachePut(id, it.blob); } catch (e) { }
        }
        window.MEM.store = this.buildStore();
      },

      async updatePhoto(p) {
        const { error } = await sb().from('photos')
          .update({ cap: p.cap || '', shoot_date: p.date || '' })
          .eq('id', p.id);
        if (error) throw new Error('保存失败：' + error.message);
        const row = metaRows.find(r => r.id === p.id);
        if (row) { row.cap = p.cap || ''; row.shoot_date = p.date || ''; }
      },

      async deletePhoto(p) {
        const { error } = await sb().from('photos').delete().eq('id', p.id);
        if (error) throw new Error('删除失败：' + error.message);
        if (p.storage_path) {
          sb().storage.from('room-photos').remove([p.storage_path]).catch(() => { });
        }
        metaRows = metaRows.filter(r => r.id !== p.id);
        try { await window.MEM.cacheDel(p.id); } catch (e) { }
        window.MEM.store = this.buildStore();
      },

      canEdit(p) {
        if (!p || !p.uploader_id) return true;
        const u = _lastUser;
        return !!u && (p.uploader_id === u.id || (current && current.ownerId === u.id));
      },
    };
  }

  // 元数据行 → 照片对象（blob 缓存优先，未命中从云端下载）
  async function rowToPhoto(r) {
    let blob = null;
    try { blob = await window.MEM.cacheGet(r.id); } catch (e) { }
    if (!blob) {
      const { data, error } = await sb().storage.from('room-photos').download(r.storage_path);
      if (error || !data) throw new Error('下载失败: ' + (error && error.message));
      blob = data;
      try { window.MEM.cachePut(r.id, blob); } catch (e) { }
    }
    return {
      id: r.id, blob, cap: r.cap, ts: Number(r.ts), date: r.shoot_date || '',
      uploader_id: r.uploader_id, uploader_name: r.uploader_name,
      storage_path: r.storage_path,
    };
  }

  // ============================================================
  // 房间数据操作
  // ============================================================
  async function fetchMeta(roomId) {
    const { data, error } = await sb().from('photos')
      .select('id,room_id,loc_key,uploader_id,uploader_name,cap,shoot_date,ts,storage_path')
      .eq('room_id', roomId);
    if (error) throw new Error('读取房间照片失败：' + error.message);
    metaRows = data || [];
  }

  async function myRooms() {
    const u = await window.AUTH.getUser();
    if (!u) return [];
    const { data, error } = await sb().from('room_members')
      .select('room_id, rooms(id, name, owner_id)')
      .eq('user_id', u.id);
    if (error) { console.warn('myRooms:', error.message); return []; }
    return (data || []).map(m => ({
      id: m.room_id, name: m.rooms && m.rooms.name || '(房间)',
      ownerId: m.rooms && m.rooms.owner_id,
    }));
  }

  async function createRoom(name, password, display) {
    const salt = newSalt();
    const pass_hash = await hashPass(salt, password);
    const { data: roomId, error } = await sb().rpc('create_room', {
      p_name: name, p_salt: salt, p_hash: pass_hash,
      p_display: display || window.AUTH.displayName(),
    });
    if (error) throw new Error('创建失败：' + error.message);
    return roomId;
  }

  async function joinRoom(roomId, password, display) {
    const { data: salt, error: e1 } = await sb().rpc('room_salt', { p_room_id: roomId });
    if (e1 || !salt) throw new Error('房间不存在');
    const pass_hash = await hashPass(salt, password);
    const { data: ok, error: e2 } = await sb().rpc('join_room', {
      p_room_id: roomId, p_hash: pass_hash,
      p_display: display || window.AUTH.displayName(),
    });
    if (e2) throw new Error('加入失败：' + e2.message);
    return ok === true;
  }

  async function leaveRoom(roomId) {
    const u = await window.AUTH.getUser();
    if (!u) return;
    const { error } = await sb().from('room_members').delete()
      .eq('room_id', roomId).eq('user_id', u.id);
    if (error) throw new Error('退出失败：' + error.message);
  }

  async function deleteRoom(roomId) {
    // 先尽力清掉存储文件（元数据行随表级联删除）
    const paths = metaRows.filter(r => r.room_id === roomId).map(r => r.storage_path);
    if (paths.length) {
      try { await sb().storage.from('room-photos').remove(paths); } catch (e) { }
    }
    const { error } = await sb().from('rooms').delete().eq('id', roomId);
    if (error) throw new Error('删除房间失败：' + error.message);
  }

  // ============================================================
  // 进入 / 退出房间
  // ============================================================
  async function enter(roomId, name, ownerId) {
    if (!sb()) return;
    await fetchMeta(roomId);
    current = { id: roomId, name, ownerId: ownerId || null };
    const backend = makeRoomBackend({ roomId });
    await window.MEM.setBackend('room', backend);
    window.MEM.store = backend.buildStore();
    try {
      localStorage.setItem(CURRENT_ROOM_KEY, JSON.stringify(current));
    } catch (e) { }
    updateBar();
    if (window.MAP && window.MAP.refreshHighlight) window.MAP.refreshHighlight();
    subscribeRealtime(roomId);
  }

  function exit(opts) {
    const o = opts || {};
    unsubscribe();
    current = null;
    metaRows = [];
    try { localStorage.removeItem(CURRENT_ROOM_KEY); } catch (e) { }
    window.MEM.setBackend('local');
    updateBar();
    if (window.MAP && window.MAP.refreshHighlight) window.MAP.refreshHighlight();
    if (!o.silent && window.showScene) { /* 留在当前场景即可 */ }
  }

  function currentRoom() { return current; }

  // ---------- 实时同步 ----------
  function subscribeRealtime(roomId) {
    unsubscribe();
    if (!sb() || !sb().channel) { startPolling(); return; }
    try {
      channel = sb().channel('photos:' + roomId)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'photos', filter: 'room_id=eq.' + roomId },
          () => { refreshMeta(); })
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') startPolling();
        });
    } catch (e) {
      console.warn('Realtime 订阅失败，改用轮询：', e);
    }
    startPolling();  // 无论如何都开一个低频轮询兜底（大陆网络 WS 不稳）
  }

  function unsubscribe() {
    if (channel && sb() && sb().removeChannel) {
      try { sb().removeChannel(channel); } catch (e) { }
    }
    channel = null;
    clearInterval(pollTimer); pollTimer = null;
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshMeta();
    }, 60000);
    document.removeEventListener('visibilitychange', onVis);
    document.addEventListener('visibilitychange', onVis);
  }
  function onVis() {
    if (document.visibilityState === 'visible' && current) refreshMeta();
  }

  let refreshing = false;
  async function refreshMeta() {
    if (!current || refreshing || !sb()) return;
    refreshing = true;
    try {
      const before = metaRows.length;
      await fetchMeta(current.id);
      const backend = window.MEM.backend;
      if (backend && backend.buildStore) window.MEM.store = backend.buildStore();
      // 数量有变化且照片墙正开着 → 重渲染
      if (before !== metaRows.length) window.MEM.refreshGallery();
    } catch (e) {
      console.warn('房间同步失败：', e.message);
    } finally { refreshing = false; }
  }

  // ============================================================
  // 房间栏 UI + 对话框
  // ============================================================
  let _lastUser = null;

  function buildBar() {
    if (barBuilt) return;
    const scene = $('scene-map');
    if (!scene) return;
    const bar = document.createElement('div');
    bar.id = 'room-bar';
    bar.className = 'room-bar';
    bar.innerHTML = `
      <span id="room-mode" class="room-mode" title="当前数据范围">👤 个人记忆</span>
      <button id="room-menu-btn" class="btn-pill">房间 ▾</button>`;
    scene.appendChild(bar);
    $('room-menu-btn').onclick = openMenu;
    barBuilt = true;
    updateBar();
  }

  function updateBar() {
    const mode = $('room-mode');
    const btn = $('room-menu-btn');
    if (!mode || !btn) return;
    if (current) {
      mode.textContent = '🏠 ' + current.name;
      mode.title = '当前在共享房间「' + current.name + '」中，地图与照片来自房间成员';
      btn.textContent = '房间 ▾';
    } else if (_lastUser) {
      mode.textContent = '👤 个人记忆';
      mode.title = '照片保存在本机浏览器';
      btn.textContent = '房间 ▾';
    } else {
      mode.textContent = '👤 个人记忆';
      mode.title = '未登录：照片保存在本机浏览器。登录后可创建/加入共享房间';
      btn.textContent = '登录 ▾';
    }
  }

  async function onAuthChanged(user) {
    _lastUser = user;
    updateBar();
    if (!user) {
      // 登出：若正处于房间模式则退回个人模式
      if (current) exit({ silent: true });
      return;
    }
    // 登录后尝试恢复上次所在房间（需仍是成员）
    if (!current) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(CURRENT_ROOM_KEY) || 'null'); } catch (e) { }
      if (saved && saved.id) {
        const rooms = await myRooms();
        const hit = rooms.find(r => r.id === saved.id);
        if (hit) enter(hit.id, hit.name, hit.ownerId).catch(e => console.warn('恢复房间失败：', e));
      }
    }
  }

  // 主菜单对话框
  async function openMenu() {
    if (!_lastUser) {
      const u = await window.AUTH.getUser();
      _lastUser = u;
    }
    if (!_lastUser) { window.AUTH.open({ returnTo: 'scene-map' }); return; }

    const rooms = await myRooms();
    const items = rooms.map(r => `
      <button class="rm-item" data-id="${r.id}" data-name="${esc(r.name)}" data-owner="${r.ownerId || ''}">
        <span class="rm-name">${current && current.id === r.id ? '✓ ' : '🏠 '}${esc(r.name)}</span>
        <span class="rm-sub">${r.ownerId === _lastUser.id ? '房主' : '成员'}</span>
      </button>`).join('');

    dialog(`
      <h3>云端房间</h3>
      <p class="rm-hint">房间里的成员共享同一张地图与照片记忆</p>
      <div class="rm-list">${items || '<p class="rm-empty">还没有加入任何房间</p>'}</div>
      <div class="rm-actions">
        <button class="up-ok" data-act="create">➕ 创建房间</button>
        <button class="up-cancel" data-act="join">🔑 加入房间</button>
      </div>
      <div class="up-btns"><button class="up-cancel" data-act="close">关闭</button></div>
    `, el => {
      el.querySelectorAll('.rm-item').forEach(b => {
        b.onclick = async () => {
          const id = b.dataset.id;
          if (current && current.id === id) { closeDialog(el); openRoomManage(b.dataset.name, b.dataset.owner); return; }
          closeDialog(el);
          toast('进入房间「' + b.dataset.name + '」…');
          try { await enter(id, b.dataset.name, b.dataset.owner); toast('已进入「' + b.dataset.name + '」'); }
          catch (e) { toast(String(e.message || e)); }
        };
      });
      el.querySelector('[data-act=create]').onclick = () => { closeDialog(el); openCreate(); };
      el.querySelector('[data-act=join]').onclick = () => { closeDialog(el); openJoin(); };
      el.querySelector('[data-act=close]').onclick = () => closeDialog(el);
    });
  }

  // 当前房间管理（退出房间模式 / 离开 / 房主删除）
  function openRoomManage(name, ownerId) {
    const isOwner = _lastUser && ownerId === _lastUser.id;
    dialog(`
      <h3>🏠 ${esc(name)}</h3>
      <div class="rm-actions col">
        <button class="up-cancel" data-act="exit">返回个人记忆（不退出房间）</button>
        <button class="up-cancel danger" data-act="leave">离开此房间</button>
        ${isOwner ? '<button class="up-cancel danger" data-act="delete">删除房间（所有成员）</button>' : ''}
      </div>
      <div class="up-btns"><button class="up-cancel" data-act="close">关闭</button></div>
    `, el => {
      el.querySelector('[data-act=exit]').onclick = () => { closeDialog(el); exit(); toast('已回到个人记忆'); };
      el.querySelector('[data-act=leave]').onclick = async () => {
        if (!confirm(`离开房间「${name}」？你上传的照片会保留在房间里。`)) return;
        try { await leaveRoom(current.id); closeDialog(el); exit(); toast('已离开房间'); }
        catch (e) { toast(String(e.message || e)); }
      };
      const del = el.querySelector('[data-act=delete]');
      if (del) del.onclick = async () => {
        if (!confirm(`删除房间「${name}」？房间内所有照片将被清除，无法恢复！`)) return;
        try { await deleteRoom(current.id); closeDialog(el); exit(); toast('房间已删除'); }
        catch (e) { toast(String(e.message || e)); }
      };
      el.querySelector('[data-act=close]').onclick = () => closeDialog(el);
    });
  }

  // 创建房间
  function openCreate() {
    dialog(`
      <h3>创建房间</h3>
      <label>房间名 <input type="text" class="rm-in-name" maxlength="40" placeholder="例如：我们的家"></label>
      <label>房间密码 <input type="password" class="rm-in-pass" maxlength="64" placeholder="成员凭此密码加入（至少4位）"></label>
      <label>确认密码 <input type="password" class="rm-in-pass2" maxlength="64"></label>
      <div id="rm-err" class="rm-err"></div>
      <div class="up-btns">
        <button class="up-cancel" data-act="close">取消</button>
        <button class="up-ok" data-act="ok">创建</button>
      </div>
    `, el => {
      const err = m => { el.querySelector('#rm-err').textContent = m || ''; };
      el.querySelector('[data-act=ok]').onclick = async () => {
        const name = el.querySelector('.rm-in-name').value.trim();
        const p1 = el.querySelector('.rm-in-pass').value;
        const p2 = el.querySelector('.rm-in-pass2').value;
        if (!name) return err('请输入房间名');
        if (p1.length < 4) return err('密码至少 4 位');
        if (p1 !== p2) return err('两次输入的密码不一致');
        err('');
        try {
          const roomId = await createRoom(name, p1);
          closeDialog(el);
          toast('房间「' + name + '」已创建');
          await enter(roomId, name, _lastUser && _lastUser.id);
        } catch (e) { err(String(e.message || e)); }
      };
      el.querySelector('[data-act=close]').onclick = () => closeDialog(el);
    });
  }

  // 加入房间：搜索列表 → 选中 → 输密码
  async function openJoin() {
    let selected = null;
    dialog(`
      <h3>加入房间</h3>
      <label>搜索 <input type="text" class="rm-in-q" placeholder="按房间名搜索，留空显示全部"></label>
      <div class="rm-list rm-join-list"><p class="rm-empty">加载中…</p></div>
      <label class="rm-pass-row" hidden>房间密码 <input type="password" class="rm-in-joinpass" maxlength="64"></label>
      <div id="rm-err" class="rm-err"></div>
      <div class="up-btns">
        <button class="up-cancel" data-act="close">取消</button>
        <button class="up-ok" data-act="ok" disabled>加入</button>
      </div>
    `, el => {
      const list = el.querySelector('.rm-join-list');
      const err = m => { el.querySelector('#rm-err').textContent = m || ''; };
      const okBtn = el.querySelector('[data-act=ok]');

      async function load(q) {
        list.innerHTML = '<p class="rm-empty">加载中…</p>';
        const { data, error } = await sb().rpc('search_rooms', { p_q: q || '' });
        if (error) { list.innerHTML = '<p class="rm-empty">加载失败</p>'; return; }
        if (!data || !data.length) { list.innerHTML = '<p class="rm-empty">没有找到房间</p>'; return; }
        list.innerHTML = data.map(r => `
          <button class="rm-item" data-id="${r.id}" data-name="${esc(r.name)}">
            <span class="rm-name">${esc(r.name)}</span>
            <span class="rm-sub">${r.member_count} 人</span>
          </button>`).join('');
        list.querySelectorAll('.rm-item').forEach(b => {
          b.onclick = () => {
            list.querySelectorAll('.rm-item').forEach(x => x.classList.remove('sel'));
            b.classList.add('sel');
            selected = { id: b.dataset.id, name: b.dataset.name };
            el.querySelector('.rm-pass-row').hidden = false;
            el.querySelector('.rm-in-joinpass').focus();
            okBtn.disabled = false;
          };
        });
      }
      load('');
      let debounce = null;
      el.querySelector('.rm-in-q').addEventListener('input', e => {
        clearTimeout(debounce);
        debounce = setTimeout(() => load(e.target.value.trim()), 400);
      });

      okBtn.onclick = async () => {
        if (!selected) return err('请先选择一个房间');
        const pass = el.querySelector('.rm-in-joinpass').value;
        if (!pass) return err('请输入房间密码');
        err(''); okBtn.disabled = true; okBtn.textContent = '加入中…';
        try {
          const okk = await joinRoom(selected.id, pass);
          if (!okk) { err('密码不正确'); okBtn.disabled = false; okBtn.textContent = '加入'; return; }
          closeDialog(el);
          toast('已加入「' + selected.name + '」');
          await enter(selected.id, selected.name);
        } catch (e) {
          err(String(e.message || e));
          okBtn.disabled = false; okBtn.textContent = '加入';
        }
      };
      el.querySelector('[data-act=close]').onclick = () => closeDialog(el);
    });
  }

  // ---------- 通用对话框 / 提示（沿用 .up-dialog 风格） ----------
  let dialogEl = null;
  function dialog(innerHtml, bind) {
    closeDialog();
    dialogEl = document.createElement('div');
    dialogEl.className = 'up-dialog';
    dialogEl.innerHTML = `<div class="up-panel rm-panel">${innerHtml}</div>`;
    document.body.appendChild(dialogEl);
    dialogEl.onclick = e => { if (e.target === dialogEl) closeDialog(dialogEl); };
    if (bind) bind(dialogEl);
    return dialogEl;
  }
  function closeDialog(el) {
    const target = el || dialogEl;
    if (target) target.remove();
    if (dialogEl === target || !el) dialogEl = null;
  }

  let toastTimer = null;
  function toast(msg) {
    let t = $('rm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rm-toast'; t.className = 'rm-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============================================================
  window.ROOMS = {
    init() {
      buildBar();
      window.AUTH.onChange(u => { onAuthChanged(u); });
      // 启动时读取会话（异步），恢复上次房间
      (async () => {
        const u = await window.AUTH.getUser();
        onAuthChanged(u);
      })();
    },
    enter, exit,
    current: currentRoom,
    onAuthChanged,
    updateBar,
    toast,
  };
})();
