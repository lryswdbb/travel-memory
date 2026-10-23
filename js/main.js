/* ============ 主控制器 + 封面星空 ============ */
(function () {
  'use strict';

  // ---------- 封面闪烁星空（2D canvas） ----------
  function coverStars() {
    const cv = document.getElementById('cover-stars');
    const ctx = cv.getContext('2d');
    let stars = [], W, H;
    function resize() {
      W = cv.width = innerWidth; H = cv.height = innerHeight;
      stars = [];
      const n = Math.round(W * H / 3200);
      for (let i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * 1.4 + 0.2,
          tw: Math.random() * Math.PI * 2,
          sp: 0.4 + Math.random() * 1.6,
          hue: Math.random() < 0.15 ? 40 : (200 + Math.random() * 60)
        });
      }
    }
    resize();
    addEventListener('resize', resize);
    let t0 = performance.now();
    (function draw() {
      requestAnimationFrame(draw);
      if (!document.getElementById('scene-cover').classList.contains('active')) return;
      const t = (performance.now() - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(s.tw + t * s.sp));
        ctx.beginPath();
        ctx.fillStyle = `hsla(${s.hue},80%,85%,${a})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 偶尔一颗流星
      if (Math.random() < 0.004) {
        const mx = Math.random() * W, my = Math.random() * H * 0.5;
        const grd = ctx.createLinearGradient(mx, my, mx + 120, my + 60);
        grd.addColorStop(0, 'rgba(255,255,255,.8)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grd; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + 120, my + 60); ctx.stroke();
      }
    })();
  }

  // ---------- 流程 ----------
  function boot() {
    coverStars();
    window.MEM.init();

    // 地图页 → 统计页
    document.getElementById('btn-stats').addEventListener('click', () => {
      window.STATS.render();
      window.showScene('scene-stats');
      setTimeout(() => window.STATS.resize && window.STATS.resize(), 100);
    });
    document.getElementById('stats-back').addEventListener('click', () => {
      window.showScene('scene-map');
      setTimeout(() => window.MAP.resize && window.MAP.resize(), 80);
    });

    const btn = document.getElementById('btn-enter');
    btn.addEventListener('click', () => {
      // 直接进地图的兜底（WebGL 不可用 / 动画异常时使用）
      const goMap = () => {
        window.showScene('scene-map');
        if (!window.__mapInited) {
          window.__mapInited = true;
          window.MAP.init(document.getElementById('map-chart'));
        } else {
          window.MAP.refreshHighlight();
        }
        setTimeout(() => document.getElementById('map-chart') && window.MAP.resize && window.MAP.resize(), 80);
      };

      // 检测 WebGL 是否可用，不可用直接跳过动画进地图
      function webglOk() {
        try {
          const c = document.createElement('canvas');
          return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
        } catch (e) { return false; }
      }
      if (!webglOk()) { console.warn('WebGL 不可用，跳过星际穿梭动画'); goMap(); return; }

      window.showScene('scene-warp');
      // 点击或按键可跳过动画（跳过 = 直达可交互的抵达态地球）
      const skip = () => { WarpScene.skip(); cleanup(); };
      const onKey = e => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') skip(); };
      function cleanup() {
        removeEventListener('keydown', onKey);
        document.getElementById('scene-warp').removeEventListener('click', skip);
      }
      addEventListener('keydown', onKey);
      document.getElementById('scene-warp').addEventListener('click', skip);

      let started = false;
      try {
        WarpScene.init(document.getElementById('warp-canvas'));
        // 回调：用户在抵达态点「进入地图」/双击后触发
        WarpScene.start(() => { cleanup(); goMap(); });
        started = true;
      } catch (e) {
        console.error('星际穿梭动画初始化失败，直接进入地图：', e);
        cleanup();
        goMap();
        return;
      }
      // 双保险：动画卡死（未抵达）时最多 13 秒强制跳过；
      // 已抵达则不再计时——用户可能正在把玩地球，等他自己点进入
      if (started) {
        setTimeout(() => {
          if (document.getElementById('scene-map').classList.contains('visible')) return;
          if (WarpScene.arrived) return;
          console.warn('动画超时，强制进入抵达态');
          cleanup();
          try { WarpScene.skip(); } catch (e) { }
        }, 13000);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
