/* ============ 照片走马灯 ============
 * 效果：3 行照片带以不同速度无限滚动（错速走马灯）。
 * 交互：
 *   - 鼠标按住拖动 → 三行一起动；快速甩动松手 → 惯性滑行（每帧速度 ×0.95）
 *   - 悬停暂停自动滚动；触屏只劫持横向拖动（touch-action: pan-y 保留竖滑）
 *   - 单击照片（拖动 <6px）→ 进大图 Lightbox（可左右翻页）
 * 筛选：全部 / 今天 / 本周 / 本月 / 有日期 chips + 指定日期跳转
 *   规则：没有拍摄日期的照片只出现在「全部」里
 * 数据来源：MEM.getAllPhotos()（本地=IndexedDB 聚合；房间=云端签名URL）
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  let all = [];          // 全部照片（含 locKey）
  let filtered = [];     // 当前筛选结果
  let filter = 'all';    // all|today|week|month|dated|exact
  let exactDate = '';
  let filterKey = null;  // 只看某个地点（从照片墙 🎞 进入时）

  const LANES = [1.0, 0.72, 0.48];   // 三行速度系数（px/帧）
  const COPIES = 4;                   // 每行内容重复份数（保证无缝循环）
  let offsets = [0, 0, 0];
  let unitWidths = [0, 0, 0];         // 每行单份内容宽度（滚动取模用）
  let raf = null;
  let hovered = false;
  let velocity = 0;                   // 惯性速度（px/帧）
  let dragging = false;
  let dragMoved = 0;
  let lastX = 0, lastT = 0;
  let cardUrls = [];                  // 已创建的 objectURL（关闭时释放）

  // ---------- 打开走马灯 ----------
  async function open(opts) {
    const o = opts || {};
    // 记住来处，关闭时返回（照片墙 or 地图）
    const from = ['scene-gallery', 'scene-map'].find(s =>
      document.getElementById(s) && document.getElementById(s).classList.contains('visible'));
    lastScene = from || 'scene-map';
    filterKey = o.locKey || null;
    $('car-title').textContent = o.locKey
      ? '走马灯 · ' + (o.title || '当前地点')
      : '走马灯 · 全部记忆';
    window.showScene('scene-carousel');
    await reload();
    startLoop();
  }

  function close() {
    stopLoop();
    window.showScene(lastScene || 'scene-map');
  }
  let lastScene = 'scene-map';

  async function reload() {
    try {
      all = await window.MEM.getAllPhotos();
    } catch (e) {
      console.warn('读取照片失败：', e);
      all = [];
    }
    if (filterKey) all = all.filter(p => p.locKey === filterKey);
    applyFilter();
  }

  // ---------- 日期筛选 ----------
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function matchFilter(p) {
    const d = p.date || '';
    switch (filter) {
      case 'all': return true;
      case 'dated': return !!d;
      case 'today': return d === todayStr();
      case 'week': {
        if (!d) return false;
        const t = new Date(d + 'T00:00:00');
        if (isNaN(t)) return false;
        const days = (Date.now() - t.getTime()) / 86400000;
        return days >= 0 && days <= 7;
      }
      case 'month': return !!d && d.slice(0, 7) === todayStr().slice(0, 7);
      case 'exact': return d === exactDate;
      default: return true;
    }
  }

  function applyFilter() {
    filtered = all.filter(matchFilter).sort((a, b) => {
      const da = a.date || '', db = b.date || '';
      if (da && db && da !== db) return da < db ? -1 : 1;
      return (a.ts || 0) - (b.ts || 0);
    });
    $('car-count').textContent = filtered.length
      ? `${filtered.length} 张照片`
      : '这个条件下没有照片';
    renderLanes();
  }

  function setFilter(f, dateStr) {
    filter = f;
    exactDate = dateStr || '';
    document.querySelectorAll('#car-filter .car-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.f === f));
    applyFilter();
  }

  // ---------- 渲染 ----------
  function renderLanes() {
    releaseUrls();
    const track = $('car-track');
    track.innerHTML = '';
    offsets = [0, 0, 0];
    unitWidths = [0, 0, 0];

    if (!filtered.length) {
      track.innerHTML = '<div class="car-empty">这里还没有照片，换个筛选条件，或去地图上添加记忆吧</div>';
      return;
    }

    // 照片交错分配到 3 行
    LANES.forEach((_, li) => {
      const lane = document.createElement('div');
      lane.className = 'car-lane';
      lane.dataset.lane = li;
      const items = filtered.filter((_, idx) => idx % LANES.length === li);
      if (!items.length) { track.appendChild(lane); return; }
      for (let c = 0; c < COPIES; c++) {
        items.forEach(p => lane.appendChild(makeCard(p, li)));
      }
      track.appendChild(lane);
    });

    // 等图片排布后测量单份宽度
    requestAnimationFrame(() => requestAnimationFrame(measureLanes));
    // 图片异步加载可能改变宽度，加载完成后补测一次
    track.querySelectorAll('img').forEach(img => {
      if (img.complete) return;
      img.addEventListener('load', measureLanes, { once: true });
    });
  }

  function measureLanes() {
    document.querySelectorAll('#car-track .car-lane').forEach(lane => {
      const li = +lane.dataset.lane;
      // scrollWidth 含 COPIES 份 + 间隙；单份宽 = 总宽/份数（近似，间隙均匀）
      unitWidths[li] = lane.scrollWidth / COPIES;
    });
  }

  function makeCard(p, laneIdx) {
    const card = document.createElement('div');
    card.className = 'car-card';
    card.style.animationDelay = (Math.random() * 300 | 0) + 'ms';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.draggable = false;
    if (p.blob) {
      const u = URL.createObjectURL(p.blob);
      cardUrls.push(u);
      img.src = u;
    } else if (p.url) {
      img.src = p.url;
    } else {
      img.alt = '(无法加载)';
    }
    card.appendChild(img);

    if (p.date) {
      const badge = document.createElement('span');
      badge.className = 'date-badge';
      const [, m, d] = p.date.split('-');
      badge.textContent = `${+m}/${+d}`;
      card.appendChild(badge);
    }
    if (p.uploader_name) {
      const who = document.createElement('span');
      who.className = 'car-who';
      who.textContent = p.uploader_name;
      card.appendChild(who);
    }

    card.addEventListener('click', () => {
      if (dragMoved > 6) return;   // 拖拽后不算点击
      const idx = filtered.indexOf(p);
      window.MEM.openLightboxList(filtered, idx < 0 ? 0 : idx);
    });
    return card;
  }

  function releaseUrls() {
    cardUrls.forEach(u => URL.revokeObjectURL(u));
    cardUrls = [];
  }

  // ---------- 动画循环 ----------
  function startLoop() {
    stopLoop();
    raf = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    velocity = 0;
  }

  function tick() {
    const lanes = document.querySelectorAll('#car-track .car-lane');
    lanes.forEach((lane, li) => {
      // 自动滚动（悬停/拖拽时暂停）
      if (!hovered && !dragging) offsets[li] += LANES[li] * 0.8;
      // 惯性滑行：仅在松手后（非拖拽）生效，避免与 pointermove 的直接位移叠加
      if (!dragging && Math.abs(velocity) > 0.05) {
        offsets[li] += velocity;
        if (li === 0) velocity *= 0.95;   // 衰减只算一次
      } else if (!dragging && li === 0) {
        velocity = 0;
      }

      const unit = unitWidths[li];
      if (unit > 0) {
        offsets[li] = ((offsets[li] % unit) + unit) % unit;
        lane.style.transform = `translate3d(${-offsets[li]}px,0,0)`;
      }
    });
    raf = requestAnimationFrame(tick);
  }

  // ---------- 拖拽（Pointer Events，鼠标+触屏统一） ----------
  function bindDrag() {
    const vp = $('car-viewport');
    if (!vp || vp.dataset.bound) return;
    vp.dataset.bound = '1';

    vp.addEventListener('pointerenter', () => { hovered = true; });
    vp.addEventListener('pointerleave', () => { hovered = false; });

    vp.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; dragMoved = 0; velocity = 0;
      lastX = e.clientX; lastT = performance.now();
      vp.classList.add('dragging');
      vp.setPointerCapture(e.pointerId);
    });

    vp.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const now = performance.now();
      const dt = Math.max(now - lastT, 1);
      // 速度平滑：80% 旧值 + 20% 新值，避免抖动
      velocity = velocity * 0.8 + (dx / dt * 16.7) * 0.2;
      LANES.forEach((_, li) => { offsets[li] -= dx; });
      lastX = e.clientX; lastT = now;
      dragMoved += Math.abs(dx);
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      $('car-viewport').classList.remove('dragging');
      // 点击判定延迟清零：click 事件在 pointerup 之后触发
      setTimeout(() => { dragMoved = 0; }, 0);
    };
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);
  }

  // ---------- 初始化 ----------
  function init() {
    bindDrag();

    // 筛选 chips
    document.querySelectorAll('#car-filter .car-chip').forEach(c => {
      c.onclick = () => {
        if (c.dataset.f === 'exact') { $('car-date').showPicker ? $('car-date').showPicker() : $('car-date').focus(); return; }
        setFilter(c.dataset.f);
      };
    });
    $('car-date').addEventListener('change', e => {
      if (!e.target.value) { setFilter('all'); return; }
      exactDate = e.target.value;
      filter = 'exact';
      document.querySelectorAll('#car-filter .car-chip').forEach(c =>
        c.classList.toggle('active', c.dataset.f === 'exact'));
      applyFilter();
    });

    $('car-back').onclick = close;
    addEventListener('keydown', e => {
      if (!$('scene-carousel').classList.contains('active')) return;
      if (e.key === 'Escape') close();
    });

    // 场景切走时停掉 rAF 省电
    const vp = $('scene-carousel');
    new MutationObserver(() => {
      if (!vp.classList.contains('active')) { stopLoop(); releaseUrls(); }
    }).observe(vp, { attributes: true, attributeFilter: ['class'] });
  }

  window.CAROUSEL = { init, open };
})();
