/* ============ 地图基础数据 · 非阻塞加载 ============
 * world.js（279KB gz）+ china_provinces.js（196KB gz）+ prov_index（3KB）
 * 合计约 478KB，占首屏流量的 40%。但封面页和星际穿梭动画完全用不到它们，
 * 只有真正进地图才需要。
 *
 * 做法：不再用 <script src> 同步加载（会阻塞 DOMContentLoaded，
 * 国内 20KB/s 下等于把首屏白白拖后 20 多秒），改成进页面立刻并行拉取。
 * map.js 的 init() 会 await window.GEO_READY，所以不会出现「数据没到就画图」。
 *
 * 注意：三个文件并行下载，走 HTTP/2 多路复用，比串行快得多。
 */
(function () {
  'use strict';

  window.__GEO__ = window.__GEO__ || {};

  const FILES = [
    'data/js/world.js',
    'data/js/china_provinces.js',
    'data/js/prov_index.js',
  ];

  function loadOne(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error('加载失败 ' + src));
      document.head.appendChild(s);
    });
  }

  // 记录进度，供加载提示使用
  window.__GEO_PROGRESS = { done: 0, total: FILES.length };

  window.GEO_READY = Promise.all(FILES.map(f =>
    loadOne(f).then(r => {
      window.__GEO_PROGRESS.done++;
      if (typeof window.__onGeoProgress === 'function') window.__onGeoProgress();
      return r;
    }).catch(e => {
      // 单个失败不拖垮整体：地图会退化成可用但缺数据的状态
      console.warn('[geo]', e.message);
      window.__GEO_PROGRESS.done++;
      if (typeof window.__onGeoProgress === 'function') window.__onGeoProgress();
      return null;
    })
  )).then(() => {
    if (typeof window.__onGeoProgress === 'function') window.__onGeoProgress();
    return true;
  });
})();
