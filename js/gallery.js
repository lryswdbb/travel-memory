/* ============ 照片墙模块 ============
 * 存储策略：
 *   - 索引（哪些地点有记忆、各几张）→ localStorage（同步读取，供地图高亮）
 *   - 照片本体（Blob）→ IndexedDB（不占用 localStorage 5MB 配额）
 * 照片字段：{ id, blob, cap, ts, date }
 *   - ts   上传时间戳（兜底排序用）
 *   - date 'YYYY-MM-DD' 拍摄日期（可选，默认为文件的最后修改时间）
 */
(function () {
  'use strict';

  const INDEX_KEY = 'travel_memory_index_v1';
  const DB_NAME = 'travel_memory_db';
  const STORE = 'photos';
  const CACHE_STORE = 'room_cache';   // 房间照片 Blob 缓存（key = 照片 uuid）

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

  function photoCard(p) {
    const card = document.createElement('div');
    card.className = 'photo-card';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(p.blob);
    img.loading = 'lazy';
    card.appendChild(img);

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

  // ---------- 上传信息弹窗（备注 + 拍摄日期） ----------
  let dialogEl = null;
  function openUploadDialog(opts) {
    return new Promise(resolve => {
      const o = opts || {};
      if (dialogEl) dialogEl.remove();
      dialogEl = document.createElement('div');
      dialogEl.className = 'up-dialog';
      dialogEl.innerHTML = `
        <div class="up-panel">
          <h3>${o.title || '添加照片信息'}</h3>
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

  // ---------- 上传 ----------
  async function handleFiles(files) {
    if (!files || !files.length) return;
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;

    // 默认日期取第一张文件的最后修改时间（通常≈拍摄时间）
    const lastMod = new Date(imgs[0].lastModified || Date.now());
    const defDate = lastMod.toISOString().slice(0, 10);
    const res = await openUploadDialog({
      title: imgs.length > 1 ? `添加 ${imgs.length} 张照片` : '添加照片',
      date: defDate,
      okText: '保存到照片墙'
    });
    if (!res) return;

    const items = [];
    for (const f of imgs) {
      const blob = await shrink(f);
      const lm = f.lastModified ? new Date(f.lastModified).toISOString().slice(0, 10) : res.date;
      items.push({
        id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
        blob,
        cap: res.cap || '',
        ts: Date.now(),
        // 单张时用户填的日期优先；多张时各自用文件修改日期，用户填的作为兜底
        date: (imgs.length === 1 ? res.date : (res.date && res.date !== defDate ? res.date : lm)) || ''
      });
    }

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
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- Lightbox（支持左右翻页；列表可来自照片墙或走马灯） ----------
  let lbList = [];      // 当前大图浏览的照片列表
  let lbIndex = -1;
  let lbUrl = null;     // 仅 blob 照片创建的 objectURL 需要释放

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
    if (p.blob) {
      lbUrl = URL.createObjectURL(p.blob);
      $('lightbox-img').src = lbUrl;
    } else if (p.url) {
      $('lightbox-img').src = p.url;   // 房间照片走马灯：签名 URL 直读
    }
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

  function closeLightbox() {
    $('lightbox').classList.remove('open');
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
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
