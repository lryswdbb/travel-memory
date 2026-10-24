/* ============ 旅行足迹统计页 ============
 * 数据来源：
 *   - localStorage 索引（window.MEM.store）：地点 → 照片数
 *   - IndexedDB：需要日期范围时按需读取
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // 解析索引 key，归并出各级足迹
  function collectFootprints() {
    const idx = window.MEM.store || {};
    const out = {
      countries: new Set(),      // 直接收藏的国家（world:*）
      cnProv: new Set(),         // 中国省份
      cnCity: new Set(),         // 中国市/区
      usState: new Set(),        // 美国州
      usCounty: new Set(),       // 美国县
      foreignProv: new Set(),    // 外国省/州（prov:<ISO>:<省名>）
      places: [],                // [{name, count}] 全部地点
      total: 0
    };
    const provCountry = (window.MAP && window.MAP.provCountry) || {};
    for (const key of Object.keys(idx)) {
      const cnt = idx[key] || 0;
      out.total += cnt;
      if (key.startsWith('world:')) {
        const n = key.slice(6);
        out.countries.add(n);
        out.places.push({ name: window.ZH ? window.ZH(n) : n, count: cnt });
      } else if (key.startsWith('cn_prov:')) {
        out.cnProv.add(key.slice(8));
        out.places.push({ name: key.slice(8), count: cnt });
      } else if (key.startsWith('cn:')) {
        // cn:<adcode>:<市名>
        const parts = key.slice(3).split(':');
        out.cnProv.add('adcode:' + parts[0]);
        out.cnCity.add(parts[1]);
        out.places.push({ name: parts[1], count: cnt });
      } else if (key.startsWith('us_state:')) {
        out.usState.add(key.slice(9));
        out.places.push({ name: key.slice(9), count: cnt });
      } else if (key.startsWith('us:')) {
        // us:<州>:<县>
        const parts = key.slice(3).split(':');
        out.usState.add(parts[0]);
        out.usCounty.add(parts[1]);
        out.places.push({ name: parts[1] + ', ' + parts[0], count: cnt });
      } else if (key.startsWith('prov:')) {
        // prov:<ISO>:<省名> —— 外国省/州
        const parts = key.slice(5).split(':');
        const iso = parts[0];
        const countryEn = provCountry[iso] || '';
        out.foreignProv.add(iso + ':' + parts[1]);
        if (countryEn) out.countries.add(countryEn);
        const zhC = countryEn && window.ZH ? window.ZH(countryEn) : countryEn;
        out.places.push({ name: parts[1] + (zhC ? ', ' + zhC : ''), count: cnt });
      }
    }
    // 中国/美国本身有记忆也算国家足迹
    if (out.cnProv.size || out.cnCity.size) out.countries.add('China');
    if (out.usState.size || out.usCounty.size) out.countries.add('United States');
    out.places.sort((a, b) => b.count - a.count);
    return out;
  }

  // 中国省级数量：cn:<adcode> 去重（省级地图高亮也用 adcode）
  function cnProvinceNames(fp) {
    const idx = window.MEM.store || {};
    const names = new Set();
    for (const key of Object.keys(idx)) {
      if (key.startsWith('cn_prov:')) names.add(key.slice(8));
      else if (key.startsWith('cn:')) {
        // 通过省级 GeoJSON 反查省名
        const adcode = key.slice(3).split(':')[0];
        const G = window.__GEO__;
        if (G && G.cn_prov) {
          const f = G.cn_prov.features.find(x => String(x.properties.adcode) === String(adcode));
          if (f) names.add(f.properties.name);
        }
      }
    }
    return names;
  }

  function statCard(icon, num, label) {
    return `<div class="stat-card">
      <div class="stat-icon">${icon}</div>
      <div class="stat-num">${num}</div>
      <div class="stat-label">${label}</div>
    </div>`;
  }

  function renderStats() {
    const fp = collectFootprints();
    const provNames = cnProvinceNames(fp);
    const body = $('stats-body');

    // 顶部数字卡片（省份卡 = 中国省份 ∪ 外国省/州）
    const provTotal = provNames.size + fp.foreignProv.size;
    const cards = `
      <div class="stat-cards">
        ${statCard('📷', fp.total, '张照片')}
        ${statCard('🌍', fp.countries.size, '个国家')}
        ${statCard('🏞️', provTotal, '个省份 / 州')}
        ${statCard('🏙️', fp.cnCity.size + fp.usCounty.size, '个城市 / 县')}
      </div>`;

    // 足迹世界地图（缩略）
    let mapHtml = '<div class="stats-map-wrap"><div id="stats-map"></div></div>';
    if (!window.__GEO__ || !window.__GEO__.world) mapHtml = '';

    // 地点排行（前 12）
    let listHtml = '';
    if (fp.places.length) {
      const top = fp.places.slice(0, 12);
      const max = top[0].count || 1;
      listHtml = `<div class="stats-list"><h4>📍 记忆最多的地方</h4>` +
        top.map(p => `
          <div class="stats-row">
            <span class="stats-rname">${p.name}</span>
            <span class="stats-bar"><i style="width:${Math.round(p.count / max * 100)}%"></i></span>
            <span class="stats-rcount">${p.count}</span>
          </div>`).join('') + `</div>`;
    } else {
      listHtml = `<div class="stats-list"><h4>📍 记忆最多的地方</h4>
        <p class="stats-none">还没有任何记忆，去地图上点一个国家开始吧 ✈️</p></div>`;
    }

    body.innerHTML = cards + mapHtml + listHtml;

    // 渲染缩略世界地图（已探索国家金色）
    if (mapHtml) renderMiniWorld(fp.countries);
  }

  let miniChart = null;
  function renderMiniWorld(visited) {
    const el = $('stats-map');
    if (!el || typeof echarts === 'undefined') return;
    try {
      echarts.registerMap('stats_world', window.__GEO__.world);
      if (miniChart) miniChart.dispose();
      miniChart = echarts.init(el);
      const regions = window.__GEO__.world.features
        .map(f => f.properties.name)
        .filter(Boolean)
        .map(n => visited.has(n)
          ? { name: n, itemStyle: { areaColor: '#ffb74d', borderColor: 'rgba(255,205,130,.85)' } }
          : { name: n });
      miniChart.setOption({
        backgroundColor: 'transparent',
        series: [{
          type: 'map', map: 'stats_world', roam: false, silent: true,
          itemStyle: { areaColor: '#141e3e', borderColor: 'rgba(120,150,230,.4)', borderWidth: 0.5 },
          label: { show: false }, emphasis: { disabled: true },
          data: regions
        }]
      });
    } catch (e) { console.warn('统计地图渲染失败', e); }
  }

  window.STATS = {
    render: renderStats,
    resize() { miniChart && miniChart.resize(); }
  };
})();
