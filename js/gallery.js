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
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
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

  // ---------- 场景切换 ----------
  const SCENES = ['scene-cover', 'scene-warp', 'scene-map', 'scene-gallery', 'scene-stats'];
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
    // key 形式： world:<name> | cn_prov:<省名> | cn:<adcode>:<市名> | us_state:<州> | us:<州>:<县>
    if (key.startsWith('world:')) return 'world:' + key.slice(6);
    if (key.startsWith('cn:')) {
      const adcode = key.slice(3).split(':')[0];
      return 'cn:' + adcode;
    }
    if (key.startsWith('us:')) return 'us:' + key.slice(3).split(':')[0];
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

    // 编辑备注/日期（铅笔按钮）
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
      }).then(res => {
        if (!res) return;
        p.cap = res.cap; p.date = res.date;
        idbPut(currentKey, photoCache).then(() => renderPhotos());
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
      photoCache = photoCache.filter(x => x.id !== p.id);
      await idbPut(currentKey, photoCache);
      updateIndex();
      await renderPhotos();
    };
    card.appendChild(del);

    card.onclick = () => openLightbox(p);
    return card;
  }

  async function renderPhotos() {
    photoCache = sortPhotos(await idbGet(currentKey));
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

  function updateIndex() {
    const idx = loadIndex();
    if (photoCache.length) idx[currentKey] = photoCache.length;
    else delete idx[currentKey];
    saveIndex(idx);
  }

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

    for (const f of imgs) {
      const blob = await shrink(f);
      const lm = f.lastModified ? new Date(f.lastModified).toISOString().slice(0, 10) : res.date;
      photoCache.push({
        id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
        blob,
        cap: res.cap || '',
        ts: Date.now(),
        // 单张时用户填的日期优先；多张时各自用文件修改日期，用户填的作为兜底
        date: (imgs.length === 1 ? res.date : (res.date && res.date !== defDate ? res.date : lm)) || ''
      });
    }
    await idbPut(currentKey, photoCache);
    updateIndex();
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

  // ---------- Lightbox（支持左右翻页） ----------
  let lbIndex = -1;
  let lbUrl = null;

  function openLightbox(p) {
    lbIndex = photoCache.indexOf(p);
    if (lbIndex < 0) lbIndex = 0;
    showLightboxAt(lbIndex);
    $('lightbox').classList.add('open');
  }

  function showLightboxAt(i) {
    if (!photoCache.length) return;
    lbIndex = (i + photoCache.length) % photoCache.length;
    const p = photoCache[lbIndex];
    if (lbUrl) URL.revokeObjectURL(lbUrl);
    lbUrl = URL.createObjectURL(p.blob);
    $('lightbox-img').src = lbUrl;
    const capParts = [];
    if (p.date) capParts.push(fmtDate(p.date));
    if (p.cap) capParts.push(p.cap);
    if (!capParts.length) capParts.push(new Date(p.ts).toLocaleString('zh-CN'));
    $('lightbox-cap').textContent = capParts.join(' · ');
    $('lightbox-count').textContent = `${lbIndex + 1} / ${photoCache.length}`;
    // 只有一张时隐藏翻页按钮
    const showNav = photoCache.length > 1;
    $('lightbox-prev').style.display = showNav ? '' : 'none';
    $('lightbox-next').style.display = showNav ? '' : 'none';
  }

  function closeLightbox() {
    $('lightbox').classList.remove('open');
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    lbIndex = -1;
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
    // 供统计页使用：读取任意地点的照片（不切换场景）
    getPhotos: idbGet,
    __handleFiles: handleFiles, // 测试钩子
    __idbPut: idbPut,            // 测试钩子（直接写入照片记录）
    __dropDB() { db = null; },   // 测试钩子：丢弃启动时缓存的真实连接，改走注入的假 indexedDB
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
