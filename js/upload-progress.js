/* ============ 上传进度与失败重试 ============
 * 背景：以前多张上传时只有一个 toast 计数，任何一张失败就整批中断，
 *      网络一抖就得从头再来。这里提供：
 *   1. 常驻进度条：第几张 / 共几张、当前文件的备注、失败数
 *   2. 失败清单：逐条列出哪张失败、失败原因，可一键重试（只重传失败的）
 *
 * 约定：后端 addPhotos 逐张回调 onItem(index, total, item, 'ok'|'fail')，
 *      并在返回值为 { added, failed: [{item, message}] }。
 */
(function () {
  'use strict';

  let panel = null;

  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.className = 'upl-panel';
    panel.innerHTML = `
      <div class="upl-head">
        <span class="upl-title">上传中</span>
        <span class="upl-count"></span>
      </div>
      <div class="upl-bar"><div class="upl-fill"></div></div>
      <div class="upl-sub"></div>`;
    document.body.appendChild(panel);
    return panel;
  }

  function start(opts) {
    const o = opts || {};
    const total = o.total || 0;
    const el = ensurePanel();
    el.classList.add('show');
    el.classList.remove('is-done');
    el.querySelector('.upl-title').textContent =
      o.title || (o.mode === 'room' ? '正在上传到云端房间' : '正在保存到本机');
    el.querySelector('.upl-count').textContent = `0 / ${total}`;
    el.querySelector('.upl-fill').style.width = '0%';
    el.querySelector('.upl-fill').classList.remove('is-fail');
    el.querySelector('.upl-sub').textContent = '';

    let done = 0, fails = 0, closed = false;
    return {
      update(n, t, label, item, status) {
        if (closed) return;
        done = n;
        if (status === 'fail') fails++;
        const denom = t || total || 1;
        const pct = Math.min(100, Math.round((n / denom) * 100));
        const fill = el.querySelector('.upl-fill');
        fill.style.width = pct + '%';
        fill.classList.toggle('is-fail', fails > 0);
        el.querySelector('.upl-count').textContent = `${n} / ${denom}`;
        const cap = item && (item.cap || item.date || '');
        const bits = [];
        if (label) bits.push(label);
        if (cap) bits.push(cap);
        if (status === 'fail') bits.push('失败');
        el.querySelector('.upl-sub').textContent = bits.join(' · ');
      },
      finish(text) {
        if (closed) return;
        el.classList.add('is-done');
        el.querySelector('.upl-fill').style.width = '100%';
        el.querySelector('.upl-sub').textContent = text || '完成';
      },
      close(delay) {
        if (closed) return;
        closed = true;
        const ms = delay == null ? 1100 : delay;
        setTimeout(() => {
          if (el) el.classList.remove('show');
        }, ms);
      },
      get failed() { return fails; },
      get done() { return done; },
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 失败清单：failed = [{ item, message, key }]，onRetry(failedHere) 返回 Promise
  function showFailures(failed, onRetry) {
    if (!failed || !failed.length) return;
    const el = document.createElement('div');
    el.className = 'up-dialog';
    const shown = failed.slice(0, 20);
    const rows = shown.map((f, i) => `
      <li class="upl-fail-row">
        <span class="upl-fail-cap">${esc(f.item && (f.item.cap || f.item.date) || ('第 ' + (i + 1) + ' 张'))}</span>
        <span class="upl-fail-msg">${esc(f.message || '未知错误')}</span>
      </li>`).join('');
    const more = failed.length > shown.length
      ? `<p class="upl-fail-more">还有 ${failed.length - shown.length} 张也失败了（未全部列出）</p>` : '';

    el.innerHTML = `
      <div class="up-panel upl-fail-panel">
        <h3>有 ${failed.length} 张没能保存</h3>
        <p class="upl-fail-hint">
          其余照片已经保存好了，不用重传。失败的多是网络波动，可以直接重试。
        </p>
        <ul class="upl-fail-list">${rows}</ul>
        ${more}
        <div class="up-btns">
          <button class="up-cancel">稍后再说</button>
          <button class="up-ok">重试这 ${failed.length} 张</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    const close = () => el.remove();
    el.onclick = e => { if (e.target === el) close(); };
    el.querySelector('.up-cancel').onclick = close;
    const okBtn = el.querySelector('.up-ok');
    okBtn.onclick = async () => {
      okBtn.disabled = true;
      okBtn.textContent = '重试中…';
      close();
      try { await onRetry(failed); } catch (e) { console.warn('重试失败：', e); }
    };
  }

  window.UPLOAD = { start, showFailures };
})();
