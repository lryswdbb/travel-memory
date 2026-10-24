/* ============ 一次性构建脚本：全球国家 → 省/州级地图数据 ============
 * 数据源：Natural Earth 10m admin-1（州省）+ admin-0（国家，做名称交叉表）
 * 产物：
 *   data/js/prov_<iso2小写>.js  — 每国一个懒加载文件（window.__GEO__.prov_jp 等）
 *   data/js/prov_index.js       — {世界图国家名 → ISO2} 索引 + {ISO2 → 世界图国家名} 反查
 * 用法：node tools/build_provinces.js
 * 依赖：tools/node_modules 里的 mapshaper（npm i --registry=https://registry.npmmirror.com mapshaper）
 *
 * 处理规则：
 *   - 排除 Antarctica、CN、US（中国/美国已有更细数据）
 *   - 海外属地裁剪：以该国面积最大的板块为种子，质心间单链聚类（阈值 900km），
 *     只保留主簇 —— 例如法国去掉法属圭亚那/留尼汪，西班牙去掉加那利，
 *     但冲绳/科西嘉/西西里等正常保留（邻省质心远小于阈值）
 *   - 每国输出体积 >60KB 时按 40%→25%→15%→8% 逐级简化（keep-shapes 防止小岛丢失）
 *   - properties 只保留 {name: NE英文名, zh: name_zh中文名(如有)}；名称去 ':' 防 locKey 冲突
 */
'use strict';
const fs = require('fs');
const path = require('path');
const mapshaper = require('mapshaper');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'js');
const A1_SHP = path.join(RAW, 'admin1', 'ne_10m_admin_1_states_provinces.shp');
const A0_SHP = path.join(RAW, 'admin0', 'ne_10m_admin_0_countries.shp');

const SIZE_CAP = 60 * 1024;      // 单国文件目标上限
const EXCLUDE = new Set(['AQ', 'CN', 'US']);
const LADDER = [null, 40, 25, 15, 8];   // 简化百分比阶梯（null = 不简化）

// ---------- mapshaper 封装 ----------
function run(cmd, input) {
  return new Promise((res, rej) =>
    mapshaper.applyCommands(cmd, input || {}, (err, out) => err ? rej(err) : res(out)));
}

async function shpToGeoJSON(shp, cacheFile) {
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  console.log('转换', path.basename(shp), '…');
  const out = await run(`-i "${shp}" -o out.json format=geojson`);
  const txt = Object.values(out)[0].toString();
  fs.writeFileSync(cacheFile, txt);
  return JSON.parse(txt);
}

async function convertFC(fc, pct) {
  const simp = pct ? `-simplify ${pct}% keep-shapes ` : '';
  const out = await run(
    `-i in.json ${simp}-o out.json format=geojson precision=0.0001`,
    { 'in.json': JSON.stringify(fc) });
  return Object.values(out)[0].toString();
}

// ---------- 海外属地黑名单 ----------
// 只剔除明确远离本土的海外属地，其余全部保留。
// 不用距离聚类：群岛国家（印尼/菲律宾/日本/新西兰）的本土岛链与海外属地
// 无法用距离区分（巴布亚距爪哇 ≈ 圭亚那距法国本土），聚类会误伤本土。
// 匹配 name / name_en / name_fr 是否包含关键词（按 ISO 限定，避免跨国误伤）。
const OVERSEAS = {
  FR: ['Guyane', 'Réunion', 'Reunion', 'Martinique', 'Guadeloupe', 'Mayotte'],
  ES: ['Canarias'],
  PT: ['Madeira', 'Açores', 'Azores'],
  NL: ['Bonaire', 'Eustatius', 'Saba'],
  NO: ['Bouvet'],
  NZ: ['Auckland Islands', 'Kermadec', 'Chatham'],
  PG: ['Spratly'],   // NE 数据异常：斯普拉特利礁被划在 PNG 名下
  WS: ['Akrotiri'],  // NE 数据异常：塞浦路斯 Akrotiri 被划在萨摩亚名下
};
// 塞浦路斯英属主权基地区（Dhekelia/Akrotiri，ISO=-99）在 NE 数据中散落在 ES/WS 等国名下
const JUNK = ['Dhekelia', 'Akrotiri Sovereign Base'];
function overseasHit(iso, f) {
  const p = f.properties;
  const names = [p.name, p.name_en, p.name_fr].filter(Boolean).join(' ');
  if (JUNK.some(k => names.includes(k))) return true;
  const kw = OVERSEAS[iso];
  if (!kw) return false;
  return kw.some(k => names.includes(k));
}
function filterOverseas(iso, feats) {
  const dropped = feats.filter(f => overseasHit(iso, f));
  return { kept: feats.filter(f => !overseasHit(iso, f)), dropped };
}

function cleanName(s) {
  return String(s || '').trim().replace(/:/g, '');
}

// ---------- 主流程 ----------
(async () => {
  const a1 = await shpToGeoJSON(A1_SHP, path.join(RAW, 'admin1.geojson'));
  const a0 = await shpToGeoJSON(A0_SHP, path.join(RAW, 'admin0.geojson'));

  // world.js 的国家名集合（prov_index 的键必须与它一致）
  const worldSrc = fs.readFileSync(path.join(ROOT, 'data', 'js', 'world.js'), 'utf8');
  const win = {};
  new Function('window', worldSrc)(win);
  const worldNames = new Set(win.__GEO__.world.features.map(f => f.properties.name).filter(Boolean));
  console.log('world.js 国家数:', worldNames.size);

  // admin-0：ISO → 候选国名；跳过塞浦路斯英属基地区（ADM0_A3=ESB/WSB，防污染 ES/WS）
  const iso0 = {};
  for (const f of a0.features) {
    const p = f.properties;
    if (p.ADM0_A3 === 'ESB' || p.ADM0_A3 === 'WSB') continue;
    let iso = /^[A-Z]{2}$/i.test(p.ISO_A2 || '') ? p.ISO_A2.toUpperCase()
      : (/^[A-Z]{3}$/i.test(p.ADM0_A3 || '') ? p.ADM0_A3.toUpperCase().slice(0, 2) : null);
    if (!iso || iso0[iso]) continue;
    iso0[iso] = {
      short: p.NAME_SHORT || p.NAME || '',
      cands: [p.NAME_SHORT, p.NAME, p.ADMIN, p.NAME_LONG].filter(Boolean)
    };
  }

  // world.js（ECharts4 老 NE 数据）国名 → ISO 手工别名（NE 4.1 改名或缩写差异）
  const ALIAS = {
    'Korea': 'KR',              // NE: South Korea
    'Czech Rep.': 'CZ',         // NE: Czechia
    'Macedonia': 'MK',          // NE: North Macedonia
    'Swaziland': 'SZ',          // NE: eSwatini
    'Cape Verde': 'CV',         // NE: Cabo Verde
    'Samoa': 'WS',
    'Spain': 'ES',
    'Laos': 'LA',               // NE: Laos（保险起见）
    'Russia': 'RU',             // NE: Russian Federation（保险起见）
  };

  // admin-1：按 ISO 分组
  const groups = {};
  for (const f of a1.features) {
    if (!f.geometry) continue;
    const p = f.properties;
    let iso = /^[A-Z]{2}$/i.test(p.iso_a2 || '') ? p.iso_a2.toUpperCase()
      : (/^[A-Z]{3}$/i.test(p.adm0_a3 || '') ? p.adm0_a3.toUpperCase().slice(0, 2) : null);
    if (!iso || EXCLUDE.has(iso)) continue;
    (groups[iso] = groups[iso] || []).push(f);
  }
  console.log('admin-1 分组国家数:', Object.keys(groups).length);

  // 逐国构建
  const isos = Object.keys(groups).sort();
  let totalBytes = 0;
  const droppedLog = [], dupLog = [], emptyNameLog = [];
  for (const iso of isos) {
    const feats = groups[iso];
    const { kept, dropped } = filterOverseas(iso, feats);
    if (dropped.length)
      droppedLog.push(`${iso}: 裁掉海外属地 ${dropped.length} 块（${dropped.map(f => cleanName(f.properties.name)).join(', ')}）`);

    // 名称清洗 + 重名检查
    const seen = new Set();
    const features = kept.map((f, i) => {
      let name = cleanName(f.properties.name) || cleanName(f.properties.name_en) || `Region ${i + 1}`;
      if (!cleanName(f.properties.name)) emptyNameLog.push(iso + ':#' + i);
      if (seen.has(name)) dupLog.push(`${iso}: ${name}`);
      seen.add(name);
      const props = { name };
      const zh = String(f.properties.name_zh || '').trim();
      if (zh && zh !== name) props.zh = zh;
      return { type: 'Feature', properties: props, geometry: f.geometry };
    });
    const fc = { type: 'FeatureCollection', features };

    // 简化阶梯
    let txt = null;
    for (const pct of LADDER) {
      txt = await convertFC(fc, pct);
      if (Buffer.byteLength(txt) <= SIZE_CAP) break;
    }

    const varName = 'prov_' + iso.toLowerCase();
    const body = `window.__GEO__=window.__GEO__||{};window.__GEO__.${varName}=${txt};\n`;
    fs.writeFileSync(path.join(OUT, varName + '.js'), body);
    totalBytes += Buffer.byteLength(body);
  }
  console.log(`生成 ${isos.length} 个国家文件，总计 ${(totalBytes / 1048576).toFixed(2)} MB`);

  // prov_index：世界图国家名 → ISO；prov_country：ISO → 世界图国家名
  const index = {}, provCountry = {}, orphanIsos = [];
  for (const iso of isos) {
    const info = iso0[iso];
    const matched = info ? [...new Set(info.cands)].filter(c => worldNames.has(c)) : [];
    if (!matched.length) { orphanIsos.push(iso); continue; }
    matched.forEach(m => { index[m] = iso; });
    provCountry[iso] = (info.short && worldNames.has(info.short)) ? info.short : matched[0];
  }
  // 手工别名覆盖（world.js 用旧版 NE 短名的国家）
  for (const [wname, iso] of Object.entries(ALIAS)) {
    if (!groups[iso]) continue;               // 没有省级数据文件则跳过
    if (!worldNames.has(wname)) { console.warn('别名警告: world.js 无国家', wname); continue; }
    index[wname] = iso;
    provCountry[iso] = wname;
    const i = orphanIsos.indexOf(iso);
    if (i >= 0) orphanIsos.splice(i, 1);
  }
  const coveredWorld = new Set(Object.keys(index));
  const uncovered = [...worldNames]
    .filter(n => !coveredWorld.has(n) && n !== 'Antarctica')
    .sort();

  const idxBody = 'window.__GEO__=window.__GEO__||{};\n' +
    `window.__GEO__.prov_index=${JSON.stringify(index)};\n` +
    `window.__GEO__.prov_country=${JSON.stringify(provCountry)};\n`;
  fs.writeFileSync(path.join(OUT, 'prov_index.js'), idxBody);
  console.log(`prov_index: ${Object.keys(index).length} 个世界图国家名可下钻，prov_index.js ${(Buffer.byteLength(idxBody) / 1024).toFixed(1)} KB`);

  // 报告
  console.log('\n== 无法对应世界图国家名的 ISO（文件已生成但入口不可达）==');
  console.log(orphanIsos.join(', ') || '(无)');
  console.log('\n== 世界图上无省级数据的国家（点击仍进国家照片墙，多为迷你国家）==');
  console.log(uncovered.join(', ') || '(无)');
  console.log('\n== 海外属地裁剪记录 ==');
  console.log(droppedLog.join('\n') || '(无)');
  if (dupLog.length) { console.log('\n== 国内重名板块（会共享同一照片墙）=='); console.log(dupLog.join(', ')); }
  if (emptyNameLog.length) { console.log('\n== 空名称板块 =='); console.log(emptyNameLog.join(', ')); }

  // 抽查关键国家
  console.log('\n== 抽查 ==');
  for (const iso of ['JP', 'KR', 'TH', 'SG', 'MY', 'VN', 'ID', 'PH', 'FR', 'IT', 'CH', 'GB', 'DE', 'ES', 'CA', 'AU', 'NZ', 'RU']) {
    const fp = path.join(OUT, 'prov_' + iso.toLowerCase() + '.js');
    if (!fs.existsSync(fp)) { console.log(iso, ': 缺失!'); continue; }
    const w = {};
    new Function('window', fs.readFileSync(fp, 'utf8'))(w);
    const fc = w.__GEO__['prov_' + iso.toLowerCase()];
    console.log(`${iso}: ${fc.features.length} 块, ${(fs.statSync(fp).size / 1024).toFixed(0)} KB, 示例: ${fc.features[0].properties.name}${fc.features[0].properties.zh ? '/' + fc.features[0].properties.zh : ''}`);
  }
  console.log('\n完成 ✅');
})().catch(e => { console.error('构建失败:', e); process.exit(1); });
