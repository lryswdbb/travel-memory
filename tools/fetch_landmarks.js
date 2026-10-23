const fs = require('fs');

const QUERIES = {
  'world:China': 'Forbidden City Beijing', 'world:Japan': 'Mount Fuji cherry blossom', 'world:United States': 'Statue of Liberty',
  'world:France': 'Eiffel Tower Paris', 'world:Italy': 'Colosseum Rome', 'world:United Kingdom': 'Palace of Westminster',
  'world:Russia': "Saint Basil's Cathedral", 'world:Australia': 'Sydney Opera House', 'world:Canada': 'Moraine Lake',
  'world:India': 'Taj Mahal', 'world:Egypt': 'Great Pyramid of Giza', 'world:Brazil': 'Christ the Redeemer Rio',
  'world:Singapore': 'Marina Bay Sands', 'world:Thailand': 'Wat Arun Bangkok', 'world:Greece': 'Parthenon Athens',
  'world:Spain': 'Sagrada Familia', 'world:Germany': 'Neuschwanstein Castle', 'world:Switzerland': 'Matterhorn',
  'world:New Zealand': 'Milford Sound', 'world:Iceland': 'Gullfoss waterfall', 'world:South Africa': 'Table Mountain Cape Town',
  'world:Mexico': 'Chichen Itza', 'world:Peru': 'Machu Picchu', 'world:Nepal': 'Mount Everest',
  'world:Indonesia': 'Borobudur temple', 'world:Malaysia': 'Petronas Towers', 'world:Vietnam': 'Ha Long Bay',
  'world:South Korea': 'Gyeongbokgung palace', 'world:Turkey': 'Hagia Sophia Istanbul', 'world:United Arab Emirates': 'Burj Khalifa Dubai',
  'world:Norway': 'Geirangerfjord', 'world:Netherlands': 'Amsterdam canal', 'world:Portugal': 'Belem Tower Lisbon',
  'world:Kenya': 'Maasai Mara safari', 'world:Morocco': 'Koutoubia Mosque Marrakesh', 'world:Chile': 'Torres del Paine',
  'world:Argentina': 'Perito Moreno Glacier', 'world:Dem. Rep. Korea': 'Pyongyang', 'world:Korea': 'Gyeongbokgung palace',
  'cn:110000': 'Forbidden City Beijing', 'cn:120000': 'Tianjin Eye night', 'cn:130000': 'Chengde Mountain Resort',
  'cn:140000': 'Yungang Grottoes', 'cn:150000': 'Hulunbuir grassland', 'cn:210000': 'Shenyang Imperial Palace',
  'cn:220000': 'Heaven Lake Changbai Mountain', 'cn:230000': 'Saint Sophia Cathedral Harbin', 'cn:310000': 'Shanghai skyline Bund',
  'cn:320000': 'Sun Yat-sen Mausoleum', 'cn:330000': 'West Lake Hangzhou', 'cn:340000': 'Huangshan Anhui',
  'cn:350000': 'Gulangyu Xiamen', 'cn:360000': 'Lushan mountain', 'cn:370000': 'Mount Tai',
  'cn:410000': 'Longmen Grottoes', 'cn:420000': 'Yellow Crane Tower', 'cn:430000': 'Zhangjiajie',
  'cn:440000': 'Canton Tower', 'cn:450000': 'Li River Guilin', 'cn:460000': 'Sanya beach Hainan',
  'cn:500000': 'Hongya Cave Chongqing', 'cn:510000': 'Giant panda', 'cn:520000': 'Huangguoshu Waterfall',
  'cn:530000': 'Jade Dragon Snow Mountain', 'cn:540000': 'Potala Palace', 'cn:610000': 'Terracotta Warriors',
  'cn:620000': 'Jiayuguan fort', 'cn:630000': 'Qinghai Lake', 'cn:640000': 'Helan Mountain Ningxia',
  'cn:650000': 'Heaven Lake Tianshan', 'cn:710000': 'Taipei 101', 'cn:810000': 'Hong Kong Victoria Harbour night',
  'cn:820000': 'Ruins of St. Paul Macau',
  'us:California': 'Golden Gate Bridge', 'us:New York': 'Statue of Liberty', 'us:Texas': 'Texas State Capitol',
  'us:Hawaii': 'Waikiki Beach', 'us:Florida': 'Miami skyline', 'us:Nevada': 'Las Vegas Strip',
  'us:Arizona': 'Grand Canyon', 'us:Utah': 'Delicate Arch', 'us:Alaska': 'Denali mountain',
  'us:Colorado': 'Rocky Mountain National Park', 'us:Washington': 'Mount Rainier', 'us:Wyoming': 'Old Faithful geyser',
  'us:Montana': 'Glacier National Park Montana', 'us:Illinois': 'Chicago skyline', 'us:Massachusetts': 'Boston skyline',
  'us:Pennsylvania': 'Independence Hall Philadelphia', 'us:Louisiana': 'French Quarter New Orleans'
};

const OUT = 'data/landmark_search.json';
let results = {};
try { results = JSON.parse(fs.readFileSync(OUT, 'utf-8')); } catch (e) { }

async function searchOnce(q) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
    encodeURIComponent(q) + '&gsrlimit=8&gsrnamespace=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=1600&format=json';
  const r = await fetch(u, { headers: { 'User-Agent': 'TravelMemoryPersonalSite/1.0 (contact: dev@example.com)' }, signal: AbortSignal.timeout(30000) });
  if (r.status === 429) throw new Error('RATE_LIMIT');
  const txt = await r.text();
  if (txt.startsWith('Y')) throw new Error('RATE_LIMIT');
  return JSON.parse(txt);
}

async function search(q) {
  let delay = 3000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const j = await searchOnce(q);
      const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
      pages.sort((a, b) => a.index - b.index);
      for (const p of pages) {
        const ii = p.imageinfo && p.imageinfo[0];
        if (ii && ii.mime && ii.mime.startsWith('image/') && ii.thumburl) {
          return { q, file: p.title.replace(/^File:/, ''), thumb: ii.thumburl };
        }
      }
      return null;
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        console.log('  rate limited, wait', delay / 1000, 's');
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else throw e;
    }
  }
  return null;
}

(async () => {
  let n = 0;
  for (const [k, q] of Object.entries(QUERIES)) {
    if (results[k] && results[k].thumb) { n++; continue; }
    try {
      results[k] = await search(q);
      console.log((results[k] ? 'OK  ' : 'MISS'), k, '->', results[k] ? results[k].file : '');
    } catch (e) {
      console.log('ERR ', k, e.message.slice(0, 60));
    }
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1)); // 增量保存
    await new Promise(r => setTimeout(r, 1500));
  }
  const ok = Object.values(results).filter(v => v && v.thumb).length;
  console.log('DONE total', Object.keys(results).length, 'ok', ok, 'skipped', n);
})();
