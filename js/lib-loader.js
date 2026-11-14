/* ============ 重型库按需加载（three.js / echarts） ============
 * 为什么要做：站点放在 GitHub Pages，国内访问 github.io 常只有 20KB/s。
 *   three.min.js 约 600KB、echarts.min.js 约 1MB（未压缩），二者合计占了
 *   首屏流量的近一半，但封面页一个都用不到——
 *     · three.js 只在「点击进入」后的星际穿梭动画里用
 *     · echarts 只在真正画地图时用
 *   所以改成用户点「点击进入」时再并行拉取，封面和首屏立刻可见。
 *
 * 用法：await window.LIBS.load();   // 幂等，重复调用返回同一个 Promise
 */
(function () {
  'use strict';

  const LIBS = {
    three: 'assets/three.min.js',
    echarts: 'assets/echarts.min.js',
  };

  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error('库加载失败：' + src));
      document.head.appendChild(s);
    });
  }

  function load() {
    if (window.THREE && window.echarts) return Promise.resolve();
    if (loading) return loading;
    const jobs = [];
    if (!window.THREE) jobs.push(loadScript(LIBS.three));
    if (!window.echarts) jobs.push(loadScript(LIBS.echarts));
    // topojson 很小（7KB）但同样是地图依赖，一起带上
    if (!window.topojson) jobs.push(loadScript('assets/topojson.min.js'));
    loading = Promise.all(jobs).then(() => {
      if (!window.THREE || !window.echarts) throw new Error('库加载不完整');
    }).catch(e => {
      loading = null;   // 允许重试
      throw e;
    });
    return loading;
  }

  window.LIBS = { load };
})();
