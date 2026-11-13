/* ============ 导出备份模块 ============
 * 目的：照片此前没有任何「出口」——只存在浏览器 IndexedDB 和 Supabase 两处，
 *       一旦清缓存 / 额度超限 / 换设备就找不回来。这里提供一键下载。
 *
 * 导出内容：
 *   1. 照片文件本体（<地点>/<序号>_<日期>_<备注>.jpg / .mp4）
 *   2. backup.json —— 每张照片的地点 key、地点显示名、备注、拍摄日期、来源
 *
 * 两种导出方式：
 *   - 「下载全部照片」：直接触发浏览器逐文件下载（无依赖，但文件多时会排队）
 *   - 「打包为 ZIP」：纯前端手写 ZIP（store 模式不压缩），单个文件一次拿到
 *     （JPEG/MP4 本身已压缩，再压缩收益极低，所以不引入压缩库）
 *
 * 依赖：window.MEM（gallery.js）暴露的 getAllPhotos / backend
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // ---------- 文件名清洗 ----------
  function safeName(s, fallback) {
    const t = String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    return t || fallback || 'unnamed';
  }

  function extOf(p) {
    if (p.video && !p.blob) return 'mp4';
    if (p.video_path) return 'jpg';
    return 'jpg';
  }

  // 地点 key → 可读目录名（cn:370200:青岛市 → 中国-青岛市）
  function dirOf(key) {
    const parts = String(key || '').split(':');
    if (parts[0] === 'cn' && parts.length >= 3) return safeName('中国-' + parts.slice(2).join('-'), '中国');
    if (parts[0] === 'cn_prov') return safeName('中国-' + parts.slice(1).join('-'), '中国');
    if (parts[0] === 'us' && parts.length >= 3) return safeName('美国-' + parts[2], '美国');
    if (parts[0] === 'us_state') return safeName('美国-' + parts.slice(1).join('-'), '美国');
    if (parts[0] === 'prov' && parts.length >= 3) return safeName(parts[1] + '-' + parts.slice(2).join('-'), '海外');
    if (parts[0] === 'world') return safeName('世界-' + parts.slice(1).join('-'), '世界');
    return safeName(key, '未分类');
  }

  // ---------- 收集照片 ----------
  // 返回 [{ path, blob, meta }]，path 是压缩包内相对路径
  async function collect(onProgress) {
    const backend = window.MEM.backend;
    const out = [];
    const counts = {};

    if (backend.mode === 'room') {
      // 房间模式：一次拿到全部元数据 + 签名直链，再逐个转 blob
      const rows = await backend.getAllPhotos();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (onProgress) onProgress(i + 1, rows.length, r.cap || '');
        const dir = dirOf(r.locKey);
        counts[dir] = (counts[dir] || 0) + 1;
        const n = String(counts[dir]).padStart(3, '0');
        const base = [n, safeName(r.date, ''), safeName(r.cap, '')].filter(Boolean).join('_');

        // 静态帧：优先取 blob（缓存/下载），否则用签名 URL 抓取
        let blob = null;
        try {
          const p = await backend.getPhotos(r.locKey);
          const hit = p.find(x => x.id === r.id);
          if (hit && hit.blob) blob = hit.blob;
          else if (hit && hit.video) blob = hit.blob;
        } catch (e) { }
        if (!blob && r.url) {
          try { const res = await fetch(r.url); blob = await res.blob(); } catch (e) { }
        }
        if (blob) out.push({ path: dir + '/' + base + '.' + extOf({}), blob, meta: r });

        // 实况视频
        if (r.video_url) {
          try {
            const res = await fetch(r.video_url);
            out.push({ path: dir + '/' + base + '.mp4', blob: await res.blob(), meta: r, isVideo: true });
          } catch (e) { console.warn('实况视频导出失败', r.id, e); }
        }
      }
    } else {
      // 本地模式：遍历索引里的每个地点
      const idx = window.MEM.store || {};
      const keys = Object.keys(idx).filter(k => idx[k] > 0);
      let done = 0;
      const total = keys.reduce((s, k) => s + idx[k], 0);
      for (const key of keys) {
        const list = await window.MEM.getPhotos(key);
        for (const p of list) {
          done++;
          if (onProgress) onProgress(done, total, p.cap || '');
          const dir = dirOf(key);
          counts[dir] = (counts[dir] || 0) + 1;
          const n = String(counts[dir]).padStart(3, '0');
          const base = [n, safeName(p.date, ''), safeName(p.cap, '')].filter(Boolean).join('_');
          if (p.blob) out.push({ path: dir + '/' + base + '.jpg', blob: p.blob, meta: Object.assign({ locKey: key }, p) });
          if (p.video) out.push({ path: dir + '/' + base + '.mp4', blob: p.video, meta: Object.assign({ locKey: key }, p), isVideo: true });
        }
      }
    }
    return out;
  }

  function buildManifest(items, mode) {
    return {
      app: '我们的旅行记忆',
      exportedAt: new Date().toISOString(),
      source: mode === 'room' ? '云端共享房间' : '本机个人模式',
      room: mode === 'room' && window.ROOMS && window.ROOMS.current ? (window.ROOMS.current() || {}).name || '' : '',
      count: items.length,
      photos: items.map(it => ({
        file: it.path,
        locKey: it.meta.locKey || '',
        caption: it.meta.cap || '',
        date: it.meta.date || it.meta.shoot_date || '',
        uploader: it.meta.uploader_name || '',
        isVideo: !!it.isVideo,
      })),
    };
  }

  // ---------- 逐文件下载（无依赖方案） ----------
  async function downloadAll(items, manifest) {
    const files = items.slice();
    files.push({
      path: 'backup.json',
      blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    });
    for (const f of files) {
      const url = URL.createObjectURL(f.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.path.split('/').pop();
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 浏览器对连续下载有节流，给一点间隔避免被丢弃
      await new Promise(r => setTimeout(r, 220));
      URL.revokeObjectURL(url);
    }
  }

  // ---------- 纯前端 ZIP（store 模式，不压缩） ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  // 生成 ZIP（仅 store，无压缩）。返回 Blob
  async function makeZip(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    // DOS 时间：用当前时间即可，解压不受影响
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    for (const e of entries) {
      const data = new Uint8Array(await e.blob.arrayBuffer());
      const nameBytes = utf8(e.path);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);       // 本地文件头签名
      dv.setUint16(4, 20, true);                // 版本
      dv.setUint16(6, 0x0800, true);            // UTF-8 文件名标志
      dv.setUint16(8, 0, true);                 // 存储方式：0 = store
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);        // 中央目录签名
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      central.push(cen);

      offset += local.length + data.length;
    }

    let cenSize = 0;
    for (const c of central) cenSize += c.length;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, cenSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
  }

  // ---------- 界面 ----------
  function openExportDialog() {
    const mode = window.MEM.backend.mode;
    const idx = window.MEM.store || {};
    const localCount = Object.keys(idx).reduce((s, k) => s + (idx[k] || 0), 0);

    const el = document.createElement('div');
    el.className = 'up-dialog';
    el.innerHTML = `
      <div class="up-panel mv-panel">
        <h3>导出备份</h3>
        <div class="mv-row">
          <span class="mv-label">数据来源</span>
          <span class="mv-cur">${mode === 'room' ? '🏠 云端共享房间' : '📱 本机个人照片'}</span>
          <span class="mv-count">${mode === 'room' ? '房间照片' : localCount + ' 张'}</span>
        </div>
        <p class="mv-hint">
          把照片和一份 <code>backup.json</code>（包含地点、备注、拍摄日期）一起保存到电脑。
          换设备、清缓存或云端额度用尽时，这份备份能让你把记忆找回来。
        </p>
        <label>保存方式
          <select class="mv-sel">
            <option value="zip">打包成一个 ZIP（推荐）</option>
            <option value="files">逐个下载文件</option>
          </select>
        </label>
        <p class="mv-note">
          说明：ZIP 不做二次压缩（照片本身已是压缩格式），体积≈原图总和。
          照片多时生成需要一些时间，请保持页面打开。
        </p>
        <div class="mv-err">${mode === 'local' && !localCount ? '本机还没有照片可导出。' : ''}</div>
        <div class="up-btns">
          <button class="up-cancel">取消</button>
          <button class="up-ok">开始导出</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const errEl = el.querySelector('.mv-err');
    const sel = el.querySelector('.mv-sel');
    const okBtn = el.querySelector('.up-ok');
    const close = () => el.remove();
    el.querySelector('.up-cancel').onclick = close;
    el.onclick = e => { if (e.target === el) close(); };

    okBtn.onclick = async () => {
      if (mode === 'local' && !localCount) return;
      okBtn.disabled = true;
      sel.disabled = true;
      const setMsg = m => { errEl.textContent = m; };

      try {
        setMsg('正在收集照片…');
        const items = await collect((n, total, cap) => {
          setMsg(`正在读取 ${n}/${total}${cap ? ' · ' + cap : ''}`);
        });
        if (!items.length) { setMsg('没有找到可导出的照片。'); okBtn.disabled = false; sel.disabled = false; return; }

        const manifest = buildManifest(items, mode);
        setMsg(`共 ${items.length} 个文件，正在打包…`);

        if (sel.value === 'files') {
          await downloadAll(items, manifest);
          setMsg(`✅ 已开始下载 ${items.length + 1} 个文件。`);
        } else {
          const entries = items.map(it => ({ path: it.path, blob: it.blob }));
          entries.push({
            path: 'backup.json',
            blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
          });
          const zip = await makeZip(entries);
          const stamp = new Date().toISOString().slice(0, 10);
          const url = URL.createObjectURL(zip);
          const a = document.createElement('a');
          a.href = url;
          a.download = `旅行记忆备份_${stamp}.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          setMsg(`✅ 打包完成（${(zip.size / 1048576).toFixed(1)} MB），已开始下载。`);
        }
      } catch (e) {
        console.error('导出失败：', e);
        setMsg('导出失败：' + (e.message || e));
      } finally {
        okBtn.disabled = false;
        sel.disabled = false;
      }
    };
  }

  window.EXPORT = {
    open: openExportDialog,
    __collect: collect,
    __makeZip: makeZip,
    __dirOf: dirOf,
  };
})();
