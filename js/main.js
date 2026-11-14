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

  // ---------- 版本自检：旧缓存页面提示刷新 ----------
  function checkBuildVersion() {
    try {
      fetch('js/config.js?_=' + Date.now(), { cache: 'no-store' })
        .then(r => r.ok ? r.text() : null)
        .then(txt => {
          if (!txt) return;
          const m = txt.match(/APP_BUILD\s*=\s*['"]([^'"]+)['"]/);
          const remote = m && m[1];
          if (remote && remote !== window.APP_BUILD) {
            const bar = document.createElement('div');
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;' +
              'background:#ffb74d;color:#231604;text-align:center;padding:9px 14px;' +
              'font-size:14px;font-weight:600;cursor:pointer;letter-spacing:.05em;';
            bar.textContent = '✨ 检测到新版本，点击此处立即刷新加载';
            bar.onclick = () => location.reload();
            document.body.appendChild(bar);
          }
        })
        .catch(() => { });   // 离线/断网时静默忽略
    } catch (e) { }
  }

  // ---------- 云端不可用提示（不静默降级） ----------
  // CDN 被墙 / 断网 / 配置缺失时，AUTH.available 为 false，房间功能整体消失。
  // 此时页面展示的是「本机个人照片」，不是房间照片。以前这种情况毫无提示，
  // 用户会以为房间里的照片丢了 / 被换成了别的照片。
  function showCloudDownNotice() {
    try {
      if (document.getElementById('cloud-down')) return;
      const el = document.createElement('div');
      el.id = 'cloud-down';
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);' +
        'z-index:99997;max-width:min(560px,92vw);padding:11px 16px;border-radius:12px;' +
        'background:rgba(92,48,12,.94);border:1px solid rgba(255,183,77,.55);' +
        'color:#ffe4bd;font-size:13px;line-height:1.65;box-shadow:0 10px 30px rgba(0,0,0,.5);';
      el.innerHTML =
        '<b>⚠ 云端未连接</b><br>' +
        '现在展示的是<u>本机保存的个人照片</u>，不是共享房间里的照片。' +
        '房间照片仍安全地存在云端，没有丢失。<br>' +
        '<span style="color:#ffb74d">检查网络后刷新页面</span>';
      el.title = '点击重试';
      el.style.cursor = 'pointer';
      el.onclick = () => location.reload();
      document.body.appendChild(el);
    } catch (e) { console.warn('云端提示渲染失败：', e); }
  }

  // ---------- 流程 ----------
  function boot() {
    coverStars();
    window.MEM.init();
    checkBuildVersion();

    // 云端功能（认证 + 房间 + 走马灯）；CDN 失败或未配置时自动降级为纯个人模式
    try { window.AUTH.init(); } catch (e) { console.warn('AUTH 初始化失败：', e); }
    if (window.AUTH.available) {
      try { window.ROOMS.init(); } catch (e) { console.warn('ROOMS 初始化失败：', e); }
    } else {
      // 云端不可用不能静默降级：否则用户会以为「房间里的照片没了」，
      // 实际只是这次没连上云端，当前看到的是本机的个人照片。
      const bar = document.getElementById('room-bar');
      if (bar) bar.style.display = 'none';
      showCloudDownNotice();
    }
    try { window.CAROUSEL.init(); } catch (e) { console.warn('CAROUSEL 初始化失败：', e); }

    // 地图页 → 统计页
    document.getElementById('btn-stats').addEventListener('click', () => {
      // 统计页里的迷你世界地图依赖 echarts（按需加载）
      const go = () => {
        window.STATS.render();
        window.showScene('scene-stats');
        setTimeout(() => window.STATS.resize && window.STATS.resize(), 100);
      };
      if (window.echarts || !window.LIBS) go();
      else window.LIBS.load().then(go).catch(e => { console.warn('统计页库加载失败：', e); go(); });
    });
    document.getElementById('stats-back').addEventListener('click', () => {
      window.showScene('scene-map');
      setTimeout(() => window.MAP.resize && window.MAP.resize(), 80);
    });

    // 走马灯：地图页 = 全部记忆；照片墙 = 当前地点
    document.getElementById('btn-carousel').addEventListener('click', () => {
      window.CAROUSEL.open({});
    });
    const galCar = document.getElementById('btn-gallery-carousel');
    if (galCar) galCar.addEventListener('click', () => {
      window.CAROUSEL.open({
        locKey: window.MEM.currentKey,
        title: window.MEM.currentName,
      });
    });

    // 进入地图（初始化/刷新高亮），供「点击进入」兜底与登录后「继续」复用
    function enterMap() {
      window.showScene('scene-map');
      if (!window.__mapInited) {
        window.__mapInited = true;
        // echarts 是按需加载的（见 lib-loader.js），这里确保到位再初始化
        const boot = () => window.MAP.init(document.getElementById('map-chart'));
        if (window.echarts) boot();
        else if (window.LIBS) {
          window.LIBS.load().then(boot).catch(e => console.error('地图库加载失败：', e));
        } else boot();
      } else {
        window.MAP.refreshHighlight();
      }
      setTimeout(() => document.getElementById('map-chart') && window.MAP.resize && window.MAP.resize(), 80);
    }
    window.__enterMap = enterMap;

    const btn = document.getElementById('btn-enter');

    // 封面登录入口（云端可用时才显示）
    const coverAuth = document.getElementById('btn-cover-auth');
    if (coverAuth) {
      if (!window.AUTH.available) coverAuth.style.display = 'none';
      else coverAuth.addEventListener('click', () => {
        window.AUTH.open({ returnTo: 'scene-map' });
      });
    }
    btn.addEventListener('click', () => {
      // 直接进地图的兜底（WebGL 不可用 / 动画异常时使用）
      const goMap = enterMap;

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

      // three.js 是按需加载的（见 lib-loader.js）。封面页不下载它，
      // 这里等库到位再启动动画；期间屏幕上显示「正在穿越星系」的提示。
      const startWarp = () => {
        try {
          WarpScene.init(document.getElementById('warp-canvas'));
          // 回调：用户在抵达态点「进入地图」/双击后触发
          WarpScene.start(() => { cleanup(); goMap(); });
        } catch (e) {
          console.error('星际穿梭动画初始化失败，直接进入地图：', e);
          cleanup();
          goMap();
          return;
        }
        // 双保险：动画卡死（未抵达）时最多 13 秒强制跳过；
        // 已抵达则不再计时——用户可能正在把玩地球，等他自己点进入
        setTimeout(() => {
          if (document.getElementById('scene-map').classList.contains('visible')) return;
          if (WarpScene.arrived) return;
          console.warn('动画超时，强制进入抵达态');
          cleanup();
          try { WarpScene.skip(); } catch (e) { }
        }, 13000);
      };

      if (window.THREE) { startWarp(); return; }
      if (window.LIBS) {
        window.LIBS.load().then(startWarp).catch(e => {
          console.error('动画库加载失败，直接进地图：', e);
          cleanup();
          goMap();
        });
      } else {
        startWarp();
      }
    });
  }

  // ---------- Service Worker：首次慢、之后秒开 ----------
  // 站点部署在 GitHub Pages，国内访问常只有 20KB/s，首次要下 1.2MB。
  // 注册 SW 后资源落到本地缓存，第二次打开基本不再走网络。
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // 只在实际部署或 localhost 下注册；file:// 打开时不注册
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 注册失败：', e));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  registerSW();
})();
