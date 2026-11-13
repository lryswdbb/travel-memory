/* ============ 照片墙模块 ============
 * 存储策略：
 *   - 索引（哪些地点有记忆、各几张）→ localStorage（同步读取，供地图高亮）
 *   - 照片本体（Blob）→ IndexedDB（不占用 localStorage 5MB 配额）
 * 照片字段：{ id, blob, video?, cap, ts, date }
 *   - ts   上传时间戳（兜底排序用）
 *   - date 'YYYY-MM-DD' 拍摄日期（可选，默认为文件的最后修改时间）
 *   - video 实况照片的动态部分（Blob，可选）；没有这个字段就是普通照片
 */
(function () {
  'use strict';

  const INDEX_KEY = 'travel_memory_index_v1';
  const DB_NAME = 'travel_memory_db';
  const STORE = 'photos';
  const CACHE_STORE = 'room_cache';   // 房间照片 Blob 缓存（key = 照片 uuid；'vid:'+uuid = 实况视频）
  const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'webm', 'qt']);
  const HEIC_EXT = new Set(['heic', 'heif', 'hif']);   // 浏览器普遍解不了，导入时提示用户先转 JPG
  const MAX_VIDEO_BYTES = 60 * 1024 * 1024;   // 单个实况视频上限，超出则退化为静图

  let db = null;
  let currentKey = null;   // 当前照片墙的地点 key
  let currentName = '';

  // ---------- 索引（localStorage） ----------
  function loadIndex() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveIndex(idx) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch (e) { }
    window.MEM.store = idx; // 同步给地图高亮使用
  }

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        if (!d.objectStoreNames.contains(CACHE_STORE)) d.createObjectStore(CACHE_STORE);
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(key) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => reject(rq.error);
    }));
  }

  function idbPut(key, list) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(list, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // ---------- 房间照片 Blob 缓存（room_cache：uuid → Blob） ----------
  function cacheGet(id) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const rq = d.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(id);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    }));
  }
  function cachePut(id, blob) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function cacheDel(id) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // ---------- 场景切换 ----------
  const SCENES = ['scene-cover', 'scene-warp', 'scene-map', 'scene-gallery', 'scene-stats', 'scene-auth', 'scene-carousel'];
  window.showScene = function (id) {
    SCENES.forEach(s => {
      const el = document.getElementById(s);
      if (!el) return;
      if (s === id) {
        el.classList.add('active');
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
      } else {
        el.classList.remove('visible');
        setTimeout(() => el.classList.remove('active'), 1200);
      }
    });
  };

  // ---------- 照片墙 ----------
  const $ = id => document.getElementById(id);
  const grid = () => $('gallery-grid');
  const empty = () => $('gallery-empty');

  // ---------- 后端抽象 ----------
  // 不变式：window.MEM.store 永远是 {locKey: count} 纯对象（地图高亮/统计只读它）
  // local 后端 = IndexedDB（现状逻辑）；room 后端 = 云端（rooms.js 注入）
  const localBackend = {
    mode: 'local',
    async getPhotos(key) { return idbGet(key); },
    async addPhotos(key, items) {
      const list = await idbGet(key);
      list.push(...items);
      await idbPut(key, list);
      updateIndexFrom(key, list.length);
    },
    async updatePhoto(p) {
      const list = await idbGet(currentKey);
      const hit = list.find(x => x.id === p.id);
      if (hit) { hit.cap = p.cap; hit.date = p.date; }
      await idbPut(currentKey, list);
    },
    async deletePhoto(p) {
      const list = (await idbGet(currentKey)).filter(x => x.id !== p.id);
      await idbPut(currentKey, list);
      updateIndexFrom(currentKey, list.length);
    },
    // 把 fromKey 下的照片整体搬到 toKey（ids 省略 = 全部）。返回实际搬走的张数。
    async movePhotos(fromKey, toKey, ids) {
      if (!fromKey || !toKey || fromKey === toKey) return 0;
      const src = await idbGet(fromKey);
      const picked = ids && ids.length ? src.filter(x => ids.includes(x.id)) : src.slice();
      if (!picked.length) return 0;
      const pickedIds = new Set(picked.map(x => x.id));
      const rest = src.filter(x => !pickedIds.has(x.id));
      const dst = await idbGet(toKey);
      dst.push(...picked);
      await idbPut(toKey, dst);
      await idbPut(fromKey, rest);
      updateIndexFrom(toKey, dst.length);
      updateIndexFrom(fromKey, rest.length);
      return picked.length;
    },
    canEdit() { return true; },
    async getAllPhotos() {
      // 走马灯：聚合本地所有地点的照片
      const idx = loadIndex();
      const out = [];
      for (const key of Object.keys(idx)) {
        const list = await idbGet(key);
        list.forEach(p => out.push(Object.assign({ locKey: key }, p)));
      }
      return out;
    },
  };

  function updateIndexFrom(key, count) {
    const idx = loadIndex();
    if (count) idx[key] = count; else delete idx[key];
    saveIndex(idx);
  }

  async function setBackend(mode, backend) {
    if (mode === 'local') {
      currentBackend = localBackend;
      window.MEM.store = loadIndex();
    } else if (backend) {
      currentBackend = backend;
    }
    if (currentKey && $('scene-gallery').classList.contains('active')) {
      await renderPhotos();
    }
  }
  let currentBackend = localBackend;

  let photoCache = [];  // 当前地点的照片列表（已排序）

  // 排序：有拍摄日期按日期（早→晚），没有的按上传时间，日期相同再按上传时间
  function sortPhotos(list) {
    return list.slice().sort((a, b) => {
      const da = a.date || '', db2 = b.date || '';
      if (da && db2 && da !== db2) return da < db2 ? -1 : 1;
      return (a.ts || 0) - (b.ts || 0);
    });
  }

  function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${y}年${+m}月${+day}日`;
  }
  function monthOf(d) {
    if (!d) return '';
    const [y, m] = d.split('-');
    return `${y}年${+m}月`;
  }

  async function openGallery(key, displayName) {
    currentKey = key;
    currentName = displayName;
    $('gallery-name').textContent = displayName;

    // 背景：地标图片（搜索到的真实 Commons 文件），加载失败回退渐变
    const bg = $('gallery-bg');
    const lmKey = landmarkKeyFor(key);
    const entry = lmKey ? (window.LM_INDEX || {})[lmKey] : null;
    $('gallery-landmark').textContent = entry ? ('📍 ' + (entry.cn || entry.q)) : '';
    bg.style.opacity = 0;
    if (entry && entry.thumb) {
      const probe = new Image();
      probe.onload = () => { bg.style.backgroundImage = `url("${entry.thumb}")`; bg.style.opacity = 1; };
      probe.onerror = () => { fallbackBg(bg); };
      probe.src = entry.thumb;
    } else fallbackBg(bg);

    showScene('scene-gallery');
    await renderPhotos();
  }

  function landmarkKeyFor(key) {
    // key 形式： world:<name> | cn_prov:<省名> | cn:<adcode>:<市名> | us_state:<州> | us:<州>:<县> | prov:<ISO>:<省名>
    if (key.startsWith('world:')) return 'world:' + key.slice(6);
    if (key.startsWith('cn:')) {
      const adcode = key.slice(3).split(':')[0];
      return 'cn:' + adcode;
    }
    if (key.startsWith('us:')) return 'us:' + key.slice(3).split(':')[0];
    if (key.startsWith('prov:')) {
      // 外国省 → 复用该国的国家级地标图（查不到返回 null → 渐变兜底）
      const iso = key.slice(5).split(':')[0];
      const countryEn = (window.MAP && window.MAP.provCountry || {})[iso];
      return countryEn ? 'world:' + countryEn : null;
    }
    return null;
  }

  function fallbackBg(el) {
    el.style.backgroundImage = 'linear-gradient(135deg,#1b2a5e 0%,#0d1430 55%,#241a3d 100%)';
    el.style.opacity = 1;
  }

  // ---------- 实况照片播放 ----------
  // 卡片上默认显示静态帧；鼠标移入（桌面）自动播放并循环，移出暂停回到静图；
  // 触屏点按 LIVE 角标切换播放/暂停（手机上 hover 不可用）。
  // 视频元素按需创建，未播过的卡片不占解码资源。
  let liveCards = [];

  function releaseLives() {
    liveCards.forEach(c => { try { c.destroy(); } catch (e) { } });
    liveCards = [];
  }

  function bindLive(card, p) {
    let videoEl = null;
    let url = null;
    let destroyed = false;

    const badge = document.createElement('span');
    badge.className = 'live-badge';
    badge.textContent = 'LIVE';
    badge.title = '实况照片，点按播放';
    card.appendChild(badge);
    card.classList.add('is-live');

    function ensureVideo() {
      if (videoEl) return videoEl;
      url = URL.createObjectURL(p.video);
      videoEl = document.createElement('video');
      videoEl.className = 'live-video';
      videoEl.src = url;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.defaultMuted = true;
      videoEl.playsInline = true;
      videoEl.setAttribute('muted', '');
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('webkit-playsinline', '');
      videoEl.preload = 'none';
      // 播放失败（编码不支持等）就静默退化成静态照片
      videoEl.addEventListener('error', () => { stop(); badge.style.display = 'none'; });
      card.appendChild(videoEl);
      return videoEl;
    }

    function play() {
      if (destroyed) return;
      const v = ensureVideo();
      card.classList.add('live-playing');
      const pr = v.play();
      if (pr && pr.catch) pr.catch(() => { card.classList.remove('live-playing'); });
    }
    function stop() {
      card.classList.remove('live-playing');
      if (videoEl) { try { videoEl.pause(); videoEl.currentTime = 0; } catch (e) { } }
    }

    // 桌面：悬停即播
    card.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse') play();
    });
    card.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse') stop();
    });

    // 触屏：点 LIVE 角标切换，且不触发打开大图
    badge.addEventListener('click', e => {
      e.stopPropagation();
      if (card.classList.contains('live-playing')) stop();
      else play();
    });
    badge.addEventListener('pointerdown', e => e.stopPropagation());

    const entry = {
      destroy() {
        destroyed = true;
        stop();
        if (url) { URL.revokeObjectURL(url); url = null; }
        if (videoEl && videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
        videoEl = null;
      }
    };
    liveCards.push(entry);
    return entry;
  }

  function photoCard(p) {
    const card = document.createElement('div');
    card.className = 'photo-card';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(p.blob);
    img.loading = 'lazy';
    card.appendChild(img);

    // 实况照片：悬停（桌面）/ 点按 LIVE 角标（手机）播放，移开或再次点按回到静图
    if (p.video) bindLive(card, p);

    // 日期角标（左上，常显）
    if (p.date) {
      const badge = document.createElement('span');
      badge.className = 'date-badge';
      const [, m, d] = p.date.split('-');
      badge.textContent = `${+m}/${+d}`;
      card.appendChild(badge);
    }

    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = p.cap || (p.date ? fmtDate(p.date) : new Date(p.ts).toLocaleDateString('zh-CN'));
    card.appendChild(cap);

    // 编辑备注/日期（铅笔按钮）—— 房间模式下仅上传者本人或房主可见
    const canEdit = currentBackend.canEdit(p);
    if (canEdit) {
      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.textContent = '✎';
      edit.title = '编辑备注和日期';
      edit.onclick = async (e) => {
        e.stopPropagation();
        openUploadDialog({
          title: '编辑照片信息',
          cap: p.cap || '',
          date: p.date || '',
          okText: '保存',
          showPreview: p.blob
        }).then(async res => {
          if (!res) return;
          p.cap = res.cap; p.date = res.date;
          try {
            await currentBackend.updatePhoto(p);
            await renderPhotos();
          } catch (err) { alert(err.message || '保存失败'); }
        });
      };
      card.appendChild(edit);

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.title = '删除这张照片';
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('删除这张照片？')) return;
        try {
          await currentBackend.deletePhoto(p);
          photoCache = photoCache.filter(x => x.id !== p.id);
          await renderPhotos();
        } catch (err) { alert(err.message || '删除失败'); }
      };
      card.appendChild(del);
    }

    card.onclick = () => openLightbox(p);
    return card;
  }

  async function renderPhotos() {
    try {
      photoCache = sortPhotos(await currentBackend.getPhotos(currentKey));
    } catch (e) {
      console.warn('照片读取失败：', e);
      photoCache = [];
      if (window.ROOMS) window.ROOMS.toast('照片读取失败：' + (e.message || e));
    }
    // 本地模式：同步索引计数（房间模式索引由 ROOMS 维护）
    if (currentBackend.mode === 'local') updateIndexFrom(currentKey, photoCache.length);
    const g = grid();
    releaseLives();          // 旧卡片的视频 objectURL 先释放，避免重渲染泄漏
    g.innerHTML = '';
    empty().style.display = photoCache.length ? 'none' : 'flex';
    if (!photoCache.length) return;

    // 按月份分组成时间线
    let lastMonth = null, delay = 0;
    photoCache.forEach(p => {
      const m = monthOf(p.date);
      if (m && m !== lastMonth) {
        lastMonth = m;
        const head = document.createElement('div');
        head.className = 'tl-month';
        head.innerHTML = `<span>${m}</span>`;
        g.appendChild(head);
      }
      const card = photoCard(p);
      card.style.animationDelay = (delay++ * 45) + 'ms';
      g.appendChild(card);
    });
  }

  function updateIndex() { updateIndexFrom(currentKey, photoCache.length); }

  // 地理名称来自地图数据，插入 innerHTML 前必须转义
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 上传信息弹窗（备注 + 拍摄日期） ----------
  let dialogEl = null;
  function openUploadDialog(opts) {
    return new Promise(resolve => {
      const o = opts || {};
      if (dialogEl) dialogEl.remove();
      dialogEl = document.createElement('div');
      dialogEl.className = 'up-dialog';
      // 存入位置：照片按「当前地图停在哪一层」归桶，这里明确告知，避免存错地方
      const willSave = o.showPreview ? '' : (currentName || currentKey || '');
      dialogEl.innerHTML = `
        <div class="up-panel">
          <h3>${o.title || '添加照片信息'}</h3>
          ${willSave ? `<div class="up-loc">
            <span class="up-loc-label">存入位置</span>
            <span class="up-loc-name">${escapeHtml(willSave)}</span>
            <span class="up-loc-hint">照片会归到这里。位置不对请先返回地图，点到正确的地方再上传。</span>
          </div>` : ''}
          ${o.showPreview ? '<img class="up-preview" alt="">' : ''}
          <label>备注 <input type="text" class="up-cap" placeholder="这一刻的心情…" maxlength="60"></label>
          <label>拍摄日期 <input type="date" class="up-date"></label>
          <div class="up-btns">
            <button class="up-cancel">取消</button>
            <button class="up-ok">${o.okText || '保存'}</button>
          </div>
        </div>`;
      document.body.appendChild(dialogEl);
      const capIn = dialogEl.querySelector('.up-cap');
      const dateIn = dialogEl.querySelector('.up-date');
      capIn.value = o.cap || '';
      dateIn.value = o.date || '';
      if (o.showPreview) dialogEl.querySelector('.up-preview').src = URL.createObjectURL(o.showPreview);
      setTimeout(() => capIn.focus(), 50);

      function done(val) {
        dialogEl.remove(); dialogEl = null;
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      }
      function ok() { done({ cap: capIn.value.trim(), date: dateIn.value }); }
      dialogEl.querySelector('.up-ok').onclick = ok;
      dialogEl.querySelector('.up-cancel').onclick = () => done(null);
      dialogEl.onclick = e => { if (e.target === dialogEl) done(null); };
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); done(null); }
        else if (e.key === 'Enter') { e.stopPropagation(); ok(); }
      }
      document.addEventListener('keydown', onKey, true);
    });
  }

  // ---------- 整理：把归错地点的照片搬到别处 ----------
  // 照片按「地图当前层级」归桶，位置点错就会整批存进错误地点。
  // 这里提供整桶搬迁，把照片挪回正确的地方（不必重新上传）。
  function openMoveDialog() {
    if (!currentKey) return;
    const store = loadStoreCounts();
    const here = store[currentKey] || 0;
    if (!here) { alert('这个地点还没有照片，没什么可整理的。'); return; }

    const others = Object.keys(store)
      .filter(k => k !== currentKey && store[k] > 0)
      .sort((a, b) => store[b] - store[a]);

    const opts = others.map(k =>
      `<option value="${escapeHtml(k)}">${escapeHtml(prettyKey(k))}（${store[k]} 张）</option>`
    ).join('');

    const el = document.createElement('div');
    el.className = 'up-dialog';
    el.innerHTML = `
      <div class="up-panel mv-panel">
        <h3>整理照片位置</h3>
        <div class="mv-row">
          <span class="mv-label">当前位置</span>
          <span class="mv-cur">${escapeHtml(currentName || currentKey)}</span>
          <span class="mv-count">${here} 张</span>
        </div>
        <p class="mv-hint">
          把这些照片整体搬到另一个地点。照片不会重新上传，只是换一个归属，
          地图上的金色高亮和足迹统计会跟着更新。
        </p>
        <label>搬到
          <select class="mv-sel">
            ${opts || '<option value="">（还没有其它地点有照片）</option>'}
            <option value="__custom__">＋ 其他地点（手动输入）</option>
          </select>
        </label>
        <label class="mv-custom-row" hidden>目标地点 key
          <input type="text" class="mv-custom" placeholder="例如 cn:310000:上海市 或 world:Japan">
        </label>
        <p class="mv-note">
          提示：地点 key 的格式是 <code>世界</code> / <code>cn:省份adcode:城市名</code> /
          <code>cn_prov:省名</code> / <code>us_state:州名</code> / <code>us:州名:县名</code> /
          <code>prov:国家代码:省名</code>。拿不准的话，先在地图上点到正确地点，
          看一眼照片墙地址栏，或者直接在那边传一张照片，再回到这里从下拉框里选。
        </p>
        <div class="mv-err"></div>
        <div class="up-btns">
          <button class="up-cancel">取消</button>
          <button class="up-ok">移动</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const sel = el.querySelector('.mv-sel');
    const customRow = el.querySelector('.mv-custom-row');
    const customIn = el.querySelector('.mv-custom');
    const err = m => { el.querySelector('.mv-err').textContent = m || ''; };

    sel.onchange = () => {
      const custom = sel.value === '__custom__';
      customRow.hidden = !custom;
      if (custom) setTimeout(() => customIn.focus(), 30);
    };

    const close = () => { el.remove(); };
    el.querySelector('.up-cancel').onclick = close;
    el.onclick = e => { if (e.target === el) close(); };
    el.querySelector('.up-ok').onclick = async () => {
      const target = sel.value === '__custom__' ? customIn.value.trim() : sel.value;
      if (!target) return err('请选择或填写目标地点');
      if (target === currentKey) return err('目标地点和当前位置相同');

      const okBtn = el.querySelector('.up-ok');
      okBtn.disabled = true; okBtn.textContent = '移动中…';
      err('');
      try {
        const n = await currentBackend.movePhotos(currentKey, target);
        close();
        if (window.ROOMS) window.ROOMS.toast(`已移动 ${n} 张照片`);
        await renderPhotos();
        window.MEM.store = currentBackend.mode === 'local'
          ? loadIndex() : (currentBackend.buildStore ? currentBackend.buildStore() : window.MEM.store);
        if (window.MAP && window.MAP.refreshHighlight) window.MAP.refreshHighlight();
      } catch (e) {
        okBtn.disabled = false; okBtn.textContent = '移动';
        err(String(e.message || e));
      }
    };
  }

  // 当前后端的 {地点: 张数}
  function loadStoreCounts() {
    if (currentBackend.mode === 'local') return loadIndex();
    return (window.MEM && window.MEM.store) || {};
  }

  // 把内部 key 显示成人能读的文字（尽力而为，识别不了就原样显示）
  function prettyKey(key) {
    const parts = String(key).split(':');
    if (parts[0] === 'cn' && parts.length >= 3) return `中国 · ${parts.slice(2).join(':')}（${parts[1]}）`;
    if (parts[0] === 'cn_prov') return `中国 · ${parts.slice(1).join(':')}`;
    if (parts[0] === 'us' && parts.length >= 3) return `美国 · ${parts[2]}（${parts[1]}）`;
    if (parts[0] === 'us_state') return `美国 · ${parts.slice(1).join(':')}`;
    if (parts[0] === 'prov' && parts.length >= 3) return `${parts[2]}（${parts[1]}）`;
    if (parts[0] === 'world') return parts.slice(1).join(':');
    return key;
  }

  // ---------- 实况照片配对 ----------
  // iPhone 导出的实况照片是一对同名文件：IMG_1234.JPG + IMG_1234.MOV
  // 按「去掉扩展名后的文件名」配对，大小写不敏感。
  function fileBase(name) {
    return String(name || '').replace(/\.[^.]+$/, '').toLowerCase();
  }

  function splitPairs(files) {
    const images = [];
    const videos = new Map();
    files.forEach(f => {
      const ext = (String(f.name).split('.').pop() || '').toLowerCase();
      if (f.type.startsWith('image/')) images.push(f);
      else if (f.type.startsWith('video/') || VIDEO_EXT.has(ext)) videos.set(fileBase(f.name), f);
    });
    const pairs = images.map(img => {
      const key = fileBase(img.name);
      const video = videos.get(key) || null;
      videos.delete(key);
      return { img, video };
    });
    return { pairs, orphanVideos: videos.size };
  }

  // ---------- 上传 ----------
  async function handleFiles(files) {
    if (!files || !files.length) return;
    const { pairs, orphanVideos } = splitPairs(Array.from(files));
    if (!pairs.length) {
      if (orphanVideos) {
        alert('实况照片需要「同名的照片 + 视频」一起选择：\n' +
          'iPhone 导出时请同时选中 IMG_1234.JPG 和 IMG_1234.MOV。\n' +
          '（只选了视频的话，把对应的照片一起拖进来即可）');
      }
      return;
    }
    const imgs = pairs;
    const liveCount = imgs.filter(p => p.video).length;

    // 默认日期取第一张文件的最后修改时间（通常≈拍摄时间）
    const lastMod = new Date(imgs[0].img.lastModified || Date.now());
    const defDate = lastMod.toISOString().slice(0, 10);
    const res = await openUploadDialog({
      title: imgs.length > 1
        ? `添加 ${imgs.length} 张照片${liveCount ? `（${liveCount} 张实况）` : ''}`
        : (liveCount ? '添加实况照片' : '添加照片'),
      date: defDate,
      okText: '保存到照片墙'
    });
    if (!res) return;

    let skippedVideo = 0, skippedHeic = 0;
    const items = [];
    for (const pair of imgs) {
      const f = pair.img;
      const blob = await shrink(f);
      if (!blob) { skippedHeic++; continue; }   // HEIC 解不了，跳过
      // 视频原样保存（浏览器原生解码）；超过上限则退化为静图
      let video = null;
      if (pair.video) {
        if (pair.video.size > MAX_VIDEO_BYTES) skippedVideo++;
        else video = pair.video;
      }
      const lm = f.lastModified ? new Date(f.lastModified).toISOString().slice(0, 10) : res.date;
      const item = {
        id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
        blob,
        cap: res.cap || '',
        ts: Date.now(),
        // 单张时用户填的日期优先；多张时各自用文件修改日期，用户填的作为兜底
        date: (imgs.length === 1 ? res.date : (res.date && res.date !== defDate ? res.date : lm)) || ''
      };
      if (video) item.video = video;
      items.push(item);
    }
    if (skippedHeic) {
      alert(`有 ${skippedHeic} 张 HEIC 照片浏览器无法解码，已跳过。\n` +
        'iPhone 导出时请选「兼容性最佳」或用「导出未修改的原片」得到 JPG。');
    }
    if (skippedVideo) {
      alert(`有 ${skippedVideo} 个实况视频超过 ${Math.round(MAX_VIDEO_BYTES / 1048576)}MB，已按普通照片保存。`);
    }
    if (!items.length) return;

    if (currentBackend.mode === 'room') {
      // 云端上传：带进度提示，成功后 store 已在 backend.addPhotos 内重建
      try {
        await currentBackend.addPhotos(currentKey, items, (n, total) => {
          if (window.ROOMS) window.ROOMS.toast(`上传中… ${n}/${total}`);
        });
        if (window.ROOMS) window.ROOMS.toast('上传完成');
      } catch (e) {
        alert('上传失败：' + (e.message || e));
      }
    } else {
      await currentBackend.addPhotos(currentKey, items);
    }
    await renderPhotos();
  }

  // 压缩到最长边 1600px，节省空间
  // 解码失败且是 HEIC/HEIF 时返回 null：浏览器解不了这种格式，不能当成照片存进去
  function shrink(file) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let { width: w, height: h } = img;
        if (Math.max(w, h) > MAX) {
          const r = MAX / Math.max(w, h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(b => resolve(b || file), 'image/jpeg', 0.86);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        const ext = (String(file.name || '').split('.').pop() || '').toLowerCase();
        // HEIC 只能由 Safari 解；其它浏览器一律当作不支持
        resolve(HEIC_EXT.has(ext) ? null : file);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- Lightbox（支持左右翻页；列表可来自照片墙或走马灯） ----------
  let lbList = [];      // 当前大图浏览的照片列表
  let lbIndex = -1;
  let lbUrl = null;     // 仅 blob 照片创建的 objectURL 需要释放
  let lbVidUrl = null;  // 实况视频的 objectURL

  function openLightbox(p) {
    openLightboxList(photoCache, photoCache.indexOf(p));
  }

  function openLightboxList(list, index) {
    lbList = list || [];
    if (!lbList.length) return;
    lbIndex = index < 0 ? 0 : index;
    showLightboxAt(lbIndex);
    $('lightbox').classList.add('open');
  }

  function showLightboxAt(i) {
    if (!lbList.length) return;
    lbIndex = (i + lbList.length) % lbList.length;
    const p = lbList[lbIndex];
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    stopLightboxVideo();
    if (p.blob) {
      lbUrl = URL.createObjectURL(p.blob);
      $('lightbox-img').src = lbUrl;
    } else if (p.url) {
      $('lightbox-img').src = p.url;   // 房间照片走马灯：签名 URL 直读
    }
    // 实况照片：大图里自动循环播放动态部分
    setLightboxVideo(p.video || p.video_url || null);
    const capParts = [];
    if (p.date) capParts.push(fmtDate(p.date));
    if (p.cap) capParts.push(p.cap);
    if (p.uploader_name) capParts.push('by ' + p.uploader_name);
    if (!capParts.length) capParts.push(new Date(p.ts).toLocaleString('zh-CN'));
    $('lightbox-cap').textContent = capParts.join(' · ');
    $('lightbox-count').textContent = `${lbIndex + 1} / ${lbList.length}`;
    // 只有一张时隐藏翻页按钮
    const showNav = lbList.length > 1;
    $('lightbox-prev').style.display = showNav ? '' : 'none';
    $('lightbox-next').style.display = showNav ? '' : 'none';
  }

  // 设置大图里的动态部分：传 Blob 或直链 URL，传 null 则回到静图
  function setLightboxVideo(src) {
    const vid = $('lightbox-video');
    const img = $('lightbox-img');
    if (!vid) return;
    try { vid.pause(); } catch (e) { }
    vid.removeAttribute('src');
    try { vid.load(); } catch (e) { }
    vid.style.display = 'none';
    if (img) img.style.display = '';
    if (!src) return;
    if (typeof src === 'string') {
      vid.src = src;
    } else {
      lbVidUrl = URL.createObjectURL(src);
      vid.src = lbVidUrl;
    }
    vid.style.display = '';
    if (img) img.style.display = 'none';   // 视频盖在静图上，避免两张并排
    // 解码不了（如 iPhone 的 HEVC 视频在不支持的浏览器里）→ 回退到静图
    vid.onerror = () => {
      vid.style.display = 'none';
      if (img) img.style.display = '';
    };
    const pr = vid.play();
    if (pr && pr.catch) pr.catch(() => {
      vid.style.display = 'none';
      if (img) img.style.display = '';
    });
  }

  function stopLightboxVideo() {
    const vid = $('lightbox-video');
    if (vid) { try { vid.pause(); } catch (e) { } }
    if (lbVidUrl) { URL.revokeObjectURL(lbVidUrl); lbVidUrl = null; }
  }

  function closeLightbox() {
    $('lightbox').classList.remove('open');
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    stopLightboxVideo();
    lbIndex = -1;
    lbList = [];
  }

  // ---------- 返回地图 ----------
  function backToMap() {
    showScene('scene-map');
    window.MAP.refreshHighlight();
    setTimeout(() => window.MAP.fitCurrent && window.MAP.fitCurrent(), 50);
  }

  // ---------- 初始化 ----------
  window.MEM = {
    store: loadIndex(),
    count(key) { return window.MEM.store[key] || 0; },
    openGallery,
    get currentKey() { return currentKey; },
    get currentName() { return currentName; },
    // 后端抽象（rooms.js 切换个人/房间模式用）
    get backend() { return currentBackend; },
    get backendMode() { return currentBackend.mode; },
    setBackend,
    // 房间照片 Blob 缓存（IndexedDB room_cache）
    cacheGet, cachePut, cacheDel,
    // 走马灯：当前后端的全部照片
    getAllPhotos() { return currentBackend.getAllPhotos(); },
    // 房间数据刷新后重渲染照片墙
    refreshGallery() { if (currentKey) renderPhotos(); },
    // Lightbox 泛化入口
    openLightboxList,
    // 供统计页使用：读取任意地点的照片（不切换场景）
    getPhotos: key => currentBackend.getPhotos(key),
    __handleFiles: handleFiles, // 测试钩子
    __idbPut: idbPut,            // 测试钩子（直接写入照片记录）
    __dropDB() { db = null; },   // 测试钩子：丢弃启动时缓存的真实连接，改走注入的假 indexedDB
    closeDB() {                  // 注销账号用：关闭连接以便整库删除
      if (db) { try { db.close(); } catch (e) { } db = null; }
    },
    init() {
      openDB();
      $('btn-back').onclick = backToMap;
      const mvBtn = $('btn-move');
      if (mvBtn) mvBtn.onclick = openMoveDialog;
      $('file-input').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
      $('lightbox').onclick = e => {
        // 点在导航按钮上不关闭
        if (e.target.closest('.lb-nav')) return;
        closeLightbox();
      };
      $('lightbox-prev').onclick = () => showLightboxAt(lbIndex - 1);
      $('lightbox-next').onclick = () => showLightboxAt(lbIndex + 1);
      // 拖拽上传
      const gc = document.querySelector('.gallery-content');
      ['dragover', 'drop'].forEach(ev => gc.addEventListener(ev, e => e.preventDefault()));
      gc.addEventListener('drop', e => {
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      });
      addEventListener('keydown', e => {
        if (!$('lightbox').classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') showLightboxAt(lbIndex - 1);
        else if (e.key === 'ArrowRight') showLightboxAt(lbIndex + 1);
      });
      // 移动端：大图上左右滑动翻页
      let touchX = null;
      const lb = $('lightbox');
      lb.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
      lb.addEventListener('touchend', e => {
        if (touchX === null || lbIndex < 0) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) showLightboxAt(lbIndex + (dx < 0 ? 1 : -1));
        touchX = null;
      }, { passive: true });
    }
  };
})();
