/* ============ 地图模块（ECharts 多级下钻） ============ */
(function () {
  'use strict';

  const G = window.__GEO__;
  let chart = null;
  const state = { level: 'world', code: null, name: null }; // code: 省级 adcode / 美国州名

  // ---- 地图注册（懒加载）----
  const registered = {};
  function reg(name, geo) {
    if (!registered[name]) { echarts.registerMap(name, geo); registered[name] = true; }
  }
  function usGeo(obj) { return topojson.feature(G.us_counties, G.us_counties.objects[obj]); }

  const CITY_FILES = {}; // adcode -> 加载 Promise

  function loadCityFile(adcode) {
    if (!CITY_FILES[adcode]) {
      CITY_FILES[adcode] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'data/js/city_' + adcode + '.js';
        s.onload = () => resolve(G[adcode]);
        s.onerror = () => reject(new Error('no city data ' + adcode));
        document.head.appendChild(s);
      });
    }
    return CITY_FILES[adcode];
  }

  // ---- 已有记忆的区域（用于高亮）----
  function visitedSet(levelKey) {
    return new Set(
      Object.keys(window.MEM.store || {})
        .filter(k => k.startsWith(levelKey + ':'))
        .map(k => k.slice(levelKey.length + 1).split(':')[0])
    );
  }

  function baseOption(mapName, regions, tipFmt) {
    const visited = visitedSet(currentLevelKey());
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(10,15,40,.92)',
        borderColor: 'rgba(150,180,255,.35)',
        textStyle: { color: '#e8ecf7', fontSize: 14 },
        formatter: p => {
          const n = p.name || '';
          const disp = state.level === 'world' ? zhName(n) : n;
          const has = visited.has(n);
          const cnt = has ? (window.MEM.count(currentLevelKey() + ':' + n) || 0) : 0;
          return `<b>${disp}</b><br/>${has ? '📷 ' + cnt + ' 张照片 · 点击查看' : '✈️ 点击进入，收藏记忆'}`;
        }
      },
      visualMap: { show: false },
      series: [{
        type: 'map',
        map: mapName,
        roam: true,
        scaleLimit: { min: 0.8, max: 12 },
        selectedMode: true,
        itemStyle: {
          areaColor: '#141e3e',
          borderColor: 'rgba(120,150,230,.55)',
          borderWidth: 0.7
        },
        emphasis: {
          label: { show: true, color: '#fff', fontSize: 13, textShadowColor: '#000', textShadowBlur: 6 },
          itemStyle: { areaColor: '#3d5aa8', shadowColor: 'rgba(120,160,255,.6)', shadowBlur: 18 }
        },
        select: {
          label: { show: true, color: '#fff' },
          itemStyle: { areaColor: '#ffb74d' }
        },
        data: regions
      }]
    };
  }

  function currentLevelKey() {
    if (state.level === 'world') return 'world';
    if (state.level === 'cn_province') return 'cn_prov';
    if (state.level === 'cn_city') return 'cn:' + state.code;
    if (state.level === 'us_state') return 'us_state';
    if (state.level === 'us_county') return 'us:' + state.code;
    return state.level;
  }

  // ---- 各级地图构建 ----
  function renderWorld() {
    reg('world', G.world);
    const visited = visitedSet('world');
    const keys = Object.keys(window.MEM.store || {});
    if (keys.some(k => k.startsWith('cn:') || k.startsWith('cn_prov:'))) visited.add('China');
    if (keys.some(k => k.startsWith('us:') || k.startsWith('us_state:'))) visited.add('United States');
    const regions = G.world.features
      .map(f => f.properties.name)
      .filter(Boolean)
      .map(n => visited.has(n) ? { name: n, itemStyle: visitedStyle() } : { name: n });
    chart.setOption(baseOption('world', regions), true);
    state.level = 'world'; state.code = null; state.name = null;
    updateBreadcrumb();
  }

  function visitedStyle() {
    return {
      areaColor: '#7a5a1e',
      borderColor: 'rgba(255,205,130,.8)',
      shadowColor: 'rgba(255,183,77,.4)',
      shadowBlur: 12
    };
  }

  function renderChinaProvinces() {
    reg('cn_prov', G.cn_prov);
    // 省级高亮：任何 “cn:<adcode>:*” 或 “cn_prov:<省名>” 的记忆都算已探索
    const byAdcode = new Set(
      Object.keys(window.MEM.store || {})
        .filter(k => k.startsWith('cn:'))
        .map(k => k.slice(3).split(':')[0])
    );
    const byName = visitedSet('cn_prov');
    const regions = G.cn_prov.features
      .map(f => ({ name: f.properties.name, adcode: String(f.properties.adcode) }))
      .filter(r => r.name)
      .map(r => (byAdcode.has(r.adcode) || byName.has(r.name))
        ? { name: r.name, itemStyle: visitedStyle() }
        : { name: r.name });
    chart.setOption(baseOption('cn_prov', regions), true);
    state.level = 'cn_province'; state.code = null; state.name = null;
    updateBreadcrumb();
  }

  async function renderChinaCities(adcode, pname) {
    const geo = await loadCityFile(adcode);
    const mapName = 'cn_city_' + adcode;
    reg(mapName, geo);
    const visited = visitedSet('cn:' + adcode);
    const single = geo.features.length === 1;
    const regions = geo.features
      .map(f => f.properties.name)
      .filter(Boolean)
      .map(n => visited.has(n) ? { name: n, itemStyle: visitedStyle() } : { name: n });
    chart.setOption(baseOption(mapName, regions), true);
    state.level = 'cn_city'; state.code = adcode; state.name = pname;
    state.single = single; // 该省只有整体一块（如部分直辖市显示）
    updateBreadcrumb();
  }

  async function renderUsStates() {
    const geo = usGeo('states');
    reg('us_states', geo);
    const visited = visitedSet('us_state');
    const regions = geo.features
      .map(f => f.properties.name)
      .filter(Boolean)
      .map(n => visited.has(n) ? { name: n, itemStyle: visitedStyle() } : { name: n });
    chart.setOption(baseOption('us_states', regions), true);
    state.level = 'us_state'; state.code = null; state.name = 'United States';
    updateBreadcrumb();
  }

  async function renderUsCounties(stateName) {
    const all = usGeo('counties');
    const stFips = usStateFips[stateName];
    const geo = { type: 'FeatureCollection', features: all.features.filter(f => f.id && f.id.startsWith(stFips)) };
    // 给每个县补全显示名（"县名, 州名"）
    geo.features.forEach(f => { f.properties.name = f.properties.name + ' County'; });
    const mapName = 'us_county_' + stFips;
    reg(mapName, geo);
    const visited = visitedSet('us:' + stateName);
    const regions = geo.features
      .map(f => f.properties.name)
      .filter(Boolean)
      .map(n => visited.has(n) ? { name: n, itemStyle: visitedStyle() } : { name: n });
    chart.setOption(baseOption(mapName, regions), true);
    state.level = 'us_county'; state.code = stateName; state.name = stateName;
    updateBreadcrumb();
  }

  const usStateFips = {
    'Alabama':'01','Alaska':'02','Arizona':'04','Arkansas':'05','California':'06','Colorado':'08',
    'Connecticut':'09','Delaware':'10','District of Columbia':'11','Florida':'12','Georgia':'13',
    'Hawaii':'15','Idaho':'16','Illinois':'17','Indiana':'18','Iowa':'19','Kansas':'20','Kentucky':'21',
    'Louisiana':'22','Maine':'23','Maryland':'24','Massachusetts':'25','Michigan':'26','Minnesota':'27',
    'Mississippi':'28','Missouri':'29','Montana':'30','Nebraska':'31','Nevada':'32','New Hampshire':'33',
    'New Jersey':'34','New Mexico':'35','New York':'36','North Carolina':'37','North Dakota':'38',
    'Ohio':'39','Oklahoma':'40','Oregon':'41','Pennsylvania':'42','Rhode Island':'44','South Carolina':'45',
    'South Dakota':'46','Tennessee':'47','Texas':'48','Utah':'49','Vermont':'50','Virginia':'51',
    'Washington':'53','West Virginia':'54','Wisconsin':'55','Wyoming':'56','Puerto Rico':'72'
  };

  // ---- 面包屑 ----
  function updateBreadcrumb() {
    const el = document.getElementById('map-breadcrumb');
    const crumbs = [{ t: '🌍 世界', lv: 'world' }];
    if (state.level.startsWith('cn')) {
      crumbs.push({ t: '中国', lv: 'cn' });
      if (state.level === 'cn_city') crumbs.push({ t: state.name, lv: 'cn_city' });
    } else if (state.level.startsWith('us')) {
      crumbs.push({ t: '美国', lv: 'us' });
      if (state.level === 'us_county') crumbs.push({ t: state.name, lv: 'us_county' });
    }
    el.innerHTML = crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      return (i ? '<span class="crumb-sep">›</span>' : '') +
        `<span class="crumb-link${last ? ' current' : ''}" data-lv="${c.lv}">${c.t}</span>`;
    }).join('');
    el.querySelectorAll('.crumb-link').forEach(a => {
      a.onclick = () => {
        const lv = a.dataset.lv;
        if (lv === 'world') renderWorld();
        else if (lv === 'cn') renderChinaProvinces();
        else if (lv === 'us') renderUsStates();
      };
    });
  }

  // ---- 点击逻辑 ----
  function bindClick() {
    chart.on('click', async params => {
      const name = params.name;
      if (!name) return;

      if (state.level === 'world') {
        if (name === 'China' || name === '中国') { renderChinaProvinces(); }
        else if (name === 'United States') { renderUsStates(); }
        else { window.MEM.openGallery('world:' + name, zhName(name)); }
      } else if (state.level === 'cn_province') {
        const f = G.cn_prov.features.find(x => x.properties.name === name);
        if (f) {
          try { await renderChinaCities(f.properties.adcode, name); }
          catch (e) { window.MEM.openGallery('cn_prov:' + name, name); }
        }
      } else if (state.level === 'cn_city') {
        window.MEM.openGallery('cn:' + state.code + ':' + name, state.name + ' · ' + name);
      } else if (state.level === 'us_state') {
        if (usStateFips[name]) renderUsCounties(name);
        else window.MEM.openGallery('us_state:' + name, name);
      } else if (state.level === 'us_county') {
        window.MEM.openGallery('us:' + state.code + ':' + name, state.name + ' · ' + name);
      }
    });
  }

  function zhName(en) {
    const m = {
      'China': '中国', 'Japan': '日本', 'United States': '美国', 'France': '法国', 'Italy': '意大利',
      'United Kingdom': '英国', 'Russia': '俄罗斯', 'Australia': '澳大利亚', 'Canada': '加拿大',
      'India': '印度', 'Egypt': '埃及', 'Brazil': '巴西', 'Singapore': '新加坡', 'Thailand': '泰国',
      'Greece': '希腊', 'Spain': '西班牙', 'Germany': '德国', 'Switzerland': '瑞士',
      'New Zealand': '新西兰', 'Iceland': '冰岛', 'South Africa': '南非', 'Mexico': '墨西哥',
      'Peru': '秘鲁', 'Nepal': '尼泊尔', 'Indonesia': '印度尼西亚', 'Malaysia': '马来西亚',
      'Vietnam': '越南', 'South Korea': '韩国', 'Dem. Rep. Korea': '朝鲜', 'Turkey': '土耳其',
      'United Arab Emirates': '阿联酋', 'Norway': '挪威', 'Netherlands': '荷兰', 'Portugal': '葡萄牙',
      'Kenya': '肯尼亚', 'Morocco': '摩洛哥', 'Chile': '智利', 'Argentina': '阿根廷',
      'Austria': '奥地利', 'Belgium': '比利时', 'Poland': '波兰', 'Czech Rep.': '捷克',
      'Hungary': '匈牙利', 'Croatia': '克罗地亚', 'Sweden': '瑞典', 'Finland': '芬兰',
      'Denmark': '丹麦', 'Ireland': '爱尔兰', 'Philippines': '菲律宾', 'Cambodia': '柬埔寨',
      'Myanmar': '缅甸', 'Bangladesh': '孟加拉国', 'Sri Lanka': '斯里兰卡', 'Israel': '以色列',
      'Saudi Arabia': '沙特阿拉伯', 'Cuba': '古巴', 'Fiji': '斐济', 'Tanzania': '坦桑尼亚',
      'Madagascar': '马达加斯加'
    };
    return m[en] || en;
  }
  window.ZH = zhName; // 供统计页显示中文国名

  // ---- 对外接口 ----
  window.MAP = {
    init(el) {
      chart = echarts.init(el, null, { renderer: 'canvas' });
      renderWorld();
      bindClick();
      addEventListener('resize', () => chart.resize());
    },
    resize() { chart && chart.resize(); },
    refreshHighlight() {
      // 从照片墙返回时刷新“已有记忆”高亮
      if (state.level === 'world') renderWorld();
      else if (state.level === 'cn_province') renderChinaProvinces();
      else if (state.level === 'cn_city') renderChinaCities(state.code, state.name);
      else if (state.level === 'us_state') renderUsStates();
      else if (state.level === 'us_county') renderUsCounties(state.code);
      chart && chart.resize();
    },
    get levelKey() { return currentLevelKey(); },
    get level() { return state.level; },
    // 测试钩子（模拟下钻，供 headless 测试用）
    async __test_drill_cn() { renderChinaProvinces(); },
    async __test_drill_city() { await renderChinaCities(110000, '北京市'); },
    async __test_drill_us() { await renderUsStates(); await renderUsCounties('California'); }
  };
})();
