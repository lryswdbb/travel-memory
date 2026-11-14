/* ============ 离线缓存（Service Worker） ============
 * 为什么需要：站点部署在 GitHub Pages，国内访问 github.io 常只有 20KB/s，
 *   首次要下 1.2MB 左右，实测 57 秒。代码没法凭空加速网络，但可以做到
 *   「第一次慢，之后几乎秒开」——把静态资源缓存到本地。
 *
 * 策略：
 *   - 静态资源（js/css/地图数据/库）：cache-first + 后台更新（stale-while-revalidate）
 *     命中缓存立即返回，同时静默拉新版，下次打开就是新的。
 *   - 导航请求（index.html）：network-first，失败回退缓存。保证拿到最新页面骨架。
 *   - 带缓存绕过参数（?_:）的请求：直接走网络，不进缓存。版本自检用得到，
 *     否则会把旧 config.js 当成新的比对，永远提示不了「有新版本」。
 *   - 云端 API（supabase.co）：一律不插手（照片/登录必须实时）。
 *
 * ⚠️ 每次发版（改 APP_BUILD）时把 CACHE 版本号加一，
 *    这样旧缓存会在 activate 阶段整体清掉，用户不会跑到新旧混杂的代码。
 */
const CACHE = 'travel-memory-v3';

// 首屏必需资源：装上就预取。不带 ?v= 查询串（匹配时用 ignoreSearch），
// 这样发版改版本号时这里不用跟着改。
const PRECACHE = [
  './',
  './index.html',
  './css/style.css',
  './assets/three.min.js',
  './assets/echarts.min.js',
  './assets/topojson.min.js',
  './assets/supabase.min.js',
  './assets/favicon.svg',
  './js/config.js',
  './js/main.js',
  './js/map.js',
  './js/gallery.js',
  './js/auth.js',
  './js/rooms.js',
  './js/carousel.js',
  './js/stats.js',
  './js/export.js',
  './js/upload-progress.js',
  './js/exif.js',
  './js/geolocate.js',
  './js/geo-loader.js',
  './js/landmarks.js',
  './js/warp.js',
  './data/js/world.js',
  './data/js/china_provinces.js',
  './data/js/prov_index.js',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      // 逐个添加：某个文件失败不影响整批
      await Promise.all(PRECACHE.map(u =>
        c.add(u).catch(err => console.warn('[SW] 预缓存失败', u, err && err.message))
      ));
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 判断是否本站可缓存的静态资源
function isStatic(url) {
  if (url.origin !== self.location.origin) return false;
  return /\.(?:js|css|svg|png|jpe?g|webp|json|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 云端 API、登录、Realtime：完全不插手
  if (url.hostname.endsWith('supabase.co')) return;

  // 带缓存绕过参数（版本自检 ?_=时间戳）：必须走网络拿真实内容
  if (url.searchParams.has('_')) return;

  // 页面导航：network-first，断网用缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => { });
          }
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true })
          .then(r => r || caches.match('./', { ignoreSearch: true })))
    );
    return;
  }

  // 静态资源：cache-first + 后台更新
  if (isStatic(url)) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => {
        const network = fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
          }
          return res;
        }).catch(() => hit);
        // 有缓存立刻返回，network 在后台跑（不 await）
        return hit || network;
      })
    );
  }
});
