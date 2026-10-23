/* 根据 data/landmark_search.json 生成 js/landmarks.js（真实 Commons 缩略图 URL） */
const fs = require('fs');

const search = JSON.parse(fs.readFileSync('data/landmark_search.json', 'utf-8'));

// 中文展示名（tooltip/照片墙标题下方的地标说明）
const CN = {
  'world:China': '北京 · 故宫', 'world:Japan': '富士山 · 樱花', 'world:United States': '纽约 · 自由女神像',
  'world:France': '巴黎 · 埃菲尔铁塔', 'world:Italy': '罗马 · 斗兽场', 'world:United Kingdom': '伦敦 · 威斯敏斯特宫',
  'world:Russia': '莫斯科 · 圣瓦西里大教堂', 'world:Australia': '悉尼 · 歌剧院', 'world:Canada': '班夫 · 梦莲湖',
  'world:India': '阿格拉 · 泰姬陵', 'world:Egypt': '吉萨 · 金字塔', 'world:Brazil': '里约 · 救世基督像',
  'world:Singapore': '滨海湾 · 金沙', 'world:Thailand': '曼谷 · 黎明寺', 'world:Greece': '雅典 · 帕特农神庙',
  'world:Spain': '巴塞罗那 · 圣家堂', 'world:Germany': '新天鹅堡', 'world:Switzerland': '马特洪峰',
  'world:New Zealand': '米尔福德峡湾', 'world:Iceland': '黄金瀑布', 'world:South Africa': '开普敦 · 桌山',
  'world:Mexico': '奇琴伊察', 'world:Peru': '马丘比丘', 'world:Nepal': '珠穆朗玛峰',
  'world:Indonesia': '婆罗浮屠', 'world:Malaysia': '吉隆坡 · 双子塔', 'world:Vietnam': '下龙湾',
  'world:South Korea': '首尔 · 景福宫', 'world:Turkey': '伊斯坦布尔 · 圣索菲亚', 'world:United Arab Emirates': '迪拜 · 哈利法塔',
  'world:Norway': '盖朗厄尔峡湾', 'world:Netherlands': '阿姆斯特丹 · 运河', 'world:Portugal': '里斯本 · 贝伦塔',
  'world:Kenya': '马赛马拉草原', 'world:Morocco': '马拉喀什 · 库图比亚清真寺', 'world:Chile': '百内国家公园',
  'world:Argentina': '佩里托莫雷诺冰川', 'world:Dem. Rep. Korea': '平壤', 'world:Korea': '首尔 · 景福宫',
  'cn:110000': '故宫', 'cn:120000': '天津之眼', 'cn:130000': '承德避暑山庄',
  'cn:140000': '云冈石窟', 'cn:150000': '呼伦贝尔草原', 'cn:210000': '沈阳故宫',
  'cn:220000': '长白山天池', 'cn:230000': '圣索菲亚教堂', 'cn:310000': '外滩 · 上海天际线',
  'cn:320000': '中山陵', 'cn:330000': '杭州西湖', 'cn:340000': '黄山',
  'cn:350000': '鼓浪屿', 'cn:360000': '庐山', 'cn:370000': '泰山',
  'cn:410000': '龙门石窟', 'cn:420000': '黄鹤楼', 'cn:430000': '张家界',
  'cn:440000': '广州塔', 'cn:450000': '桂林漓江', 'cn:460000': '三亚海滩',
  'cn:500000': '洪崖洞', 'cn:510000': '大熊猫', 'cn:520000': '黄果树瀑布',
  'cn:530000': '玉龙雪山', 'cn:540000': '布达拉宫', 'cn:610000': '西安 · 大雁塔',
  'cn:620000': '嘉峪关', 'cn:630000': '青海湖', 'cn:640000': '贺兰山',
  'cn:650000': '天山天池', 'cn:710000': '台北101', 'cn:810000': '维多利亚港夜景',
  'cn:820000': '大三巴牌坊',
  'us:California': '金门大桥', 'us:New York': '自由女神像', 'us:Texas': '州议会大厦',
  'us:Hawaii': '威基基海滩', 'us:Florida': '迈阿密天际线', 'us:Nevada': '拉斯维加斯',
  'us:Arizona': '大峡谷', 'us:Utah': '精致拱门', 'us:Alaska': '迪纳利山',
  'us:Colorado': '落基山国家公园', 'us:Washington': '雷尼尔山', 'us:Wyoming': '老忠实泉',
  'us:Montana': '冰川国家公园', 'us:Illinois': '芝加哥天际线', 'us:Massachusetts': '波士顿天际线',
  'us:Pennsylvania': '独立厅', 'us:Louisiana': '新奥尔良 · 法国区'
};

const lines = [];
let ok = 0, miss = 0;
lines.push('/* ============ 地标景观数据（自动生成，勿手改；改 tools/build_landmarks.js） ============');
lines.push(' * key: world:<英文国名> | cn:<省级adcode> | us:<州名>');
lines.push(' * thumb: Wikimedia Commons 缩略图直链（约1600px），加载失败时前端自动回退渐变背景');
lines.push(' */');
lines.push('window.LM_INDEX = {');
for (const [k, v] of Object.entries(search)) {
  if (v && v.thumb) {
    ok++;
    lines.push(`  ${JSON.stringify(k)}: { thumb: ${JSON.stringify(v.thumb)}, cn: ${JSON.stringify(CN[k] || v.q)}, file: ${JSON.stringify(v.file)} },`);
  } else { miss++; }
}
lines.push('};');
lines.push('');
lines.push('window.landmarkUrl = function (key) { const e = window.LM_INDEX[key]; return e ? e.thumb : null; };');
fs.writeFileSync('js/landmarks.js', lines.join('\n'));
console.log('generated js/landmarks.js —', ok, 'entries,', miss, 'missing');
