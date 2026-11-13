/* ============ 坐标 → 地点 key ============
 * 把 GPS 坐标落到本站使用的地点 key 上：
 *   cn:<省adcode>:<市名> | cn_prov:<省名> | us:<州>:<县> | us_state:<州> |
 *   prov:<ISO>:<省名> | world:<国名>
 *
 * 判定顺序（由精确到粗略）：
 *   1. 中国：省份多边形命中 → 再在省内的市级多边形里找命中 → 都没命中用省级
 *   2. 美国：州命中 → 县命中
 *   3. 其它国家：country 多边形命中 → 省/州命中 → 没有省数据则用国家
 *
 * 边界数据是懒加载的（和地图一致），只在需要时取。
 */
(function () {
  'use strict';

  const G = window.__GEO__;
  let loadedProv = {};      // iso → FeatureCollection
  let loadedCity = {};      // adcode → FeatureCollection

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('加载失败 ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureProv(iso) {
    const key = String(iso).toLowerCase();
    if (loadedProv[key]) return loadedProv[key];
    if (!G['prov_' + key]) {
      try { await loadScript('data/js/prov_' + key + '.js'); } catch (e) { return null; }
    }
    loadedProv[key] = G['prov_' + key] || null;
    return loadedProv[key];
  }

  async function ensureCity(adcode) {
    if (loadedCity[adcode]) return loadedCity[adcode];
    if (!G[adcode]) {
      try { await loadScript('data/js/city_' + adcode + '.js'); } catch (e) { return null; }
    }
    loadedCity[adcode] = G[adcode] || null;
    return loadedCity[adcode];
  }

  // ---------- 点在多边形内（射线法） ----------
  function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // 环有洞：第一个环是外边界，其余为洞（落在洞里算外面）
  function inPolygon(lng, lat, poly) {
    if (!poly || !poly.length) return false;
    if (!inRing(lng, lat, poly[0])) return false;
    for (let i = 1; i < poly.length; i++) if (inRing(lng, lat, poly[i])) return false;
    return true;
  }

  function inGeometry(lng, lat, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') return inPolygon(lng, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) if (inPolygon(lng, lat, poly)) return true;
    }
    return false;
  }

  // 先按外接框快速排除，命中再精算
  function bboxOf(geom) {
    let minX = 180, maxX = -180, minY = 90, maxY = -90;
    const walk = c => {
      if (typeof c[0] === 'number') {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      } else c.forEach(walk);
    };
    walk(geom.coordinates);
    return { minX, maxX, minY, maxY };
  }

  function hitFeature(lng, lat, fc) {
    if (!fc || !fc.features) return null;
    for (const f of fc.features) {
      const g = f.geometry;
      if (!g) continue;
      if (!g.__bbox) g.__bbox = bboxOf(g);
      const b = g.__bbox;
      if (lng < b.minX || lng > b.maxX || lat < b.minY || lat > b.maxY) continue;
      if (inGeometry(lng, lat, g)) return f;
    }
    return null;
  }

  // US 县数据在 topojson 里，用 topojson.feature 转成 GeoJSON 再匹配
  let usCountiesGeo = null;
  function usCounties() {
    if (usCountiesGeo) return usCountiesGeo;
    if (!G.us_counties || !window.topojson) return null;
    usCountiesGeo = window.topojson.feature(G.us_counties, G.us_counties.objects.counties);
    return usCountiesGeo;
  }
  let usStatesGeo = null;
  function usStates() {
    if (usStatesGeo) return usStatesGeo;
    if (!G.us_counties) return null;
    usStatesGeo = window.topojson.feature(G.us_counties, G.us_counties.objects.states);
    return usStatesGeo;
  }

  // ---------- 主入口 ----------
  // 返回 { key, name, level } 或 null
  async function locate(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return null;

    // 1) 中国
    const cnProv = G.cn_prov;
    const provHit = hitFeature(lng, lat, cnProv);
    if (provHit) {
      const adcode = provHit.properties.adcode;
      const pname = provHit.properties.name;
      // 再试市级（更精确）
      const cityFc = await ensureCity(adcode);
      if (cityFc) {
        const cityHit = hitFeature(lng, lat, cityFc);
        if (cityHit) {
          return {
            key: 'cn:' + adcode + ':' + cityHit.properties.name,
            name: pname + ' · ' + cityHit.properties.name,
            level: 'city',
          };
        }
      }
      return { key: 'cn_prov:' + pname, name: pname, level: 'province' };
    }

    // 2) 美国
    const st = hitFeature(lng, lat, usStates());
    if (st) {
      const stName = st.properties.name;
      const countyFc = usCounties();
      if (countyFc) {
        // 只在该州的县里找：按质心不在同州的先排掉嫌麻烦，直接全表匹配（3231 个，可接受）
        const c = hitFeature(lng, lat, countyFc);
        if (c) {
          const cname = c.properties.name + ' County';
          return { key: 'us:' + stName + ':' + cname, name: stName + ' · ' + cname, level: 'county' };
        }
      }
      return { key: 'us_state:' + stName, name: stName, level: 'state' };
    }

    // 3) 其它国家
    const world = G.world;
    const countryHit = hitFeature(lng, lat, world);
    if (!countryHit) return null;
    const countryEn = countryHit.properties.name;
    const iso = (G.prov_index || {})[countryEn];
    const zh = (window.ZH && window.ZH(countryEn)) || countryEn;

    if (iso) {
      const provFc = await ensureProv(iso);
      if (provFc) {
        const p = hitFeature(lng, lat, provFc);
        if (p) {
          const zhProv = (p.properties && p.properties.zh) || p.properties.name;
          return {
            key: 'prov:' + iso + ':' + p.properties.name,
            name: zh + ' · ' + zhProv,
            level: 'province',
          };
        }
      }
    }
    // 无省级数据 / 未命中省界 → 落到国家
    return { key: 'world:' + countryEn, name: zh, level: 'country' };
  }

  window.GEO_LOCATE = { locate, __inPolygon: inPolygon, __inRing: inRing };
})();
