/* 一次性清理：删除自动化测试遗留的房间与测试账号
 * - dbg房<6位> 系列：登录 dbg<同6位> 账号 → delete_own_account（级联删房）
 * - TestRoom：API 账号 roomtest01@users.travel-memory.app 同法删除
 * 用法：node tools/cleanup_test_rooms.js
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const src = fs.readFileSync('js/config.js', 'utf8');
const URL_ = (src.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
const KEY = (src.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
const DOMAIN = 'users.travel-memory.app';

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const deriveEmail = u => sha256('travel-memory:' + u.toLowerCase()) + '@' + DOMAIN;

async function api(path, opts, token) {
  const res = await fetch(URL_ + path, {
    ...opts,
    headers: {
      apikey: KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  });
  const txt = await res.text();
  let json = null; try { json = JSON.parse(txt); } catch (e) { }
  return { status: res.status, json, txt };
}

async function login(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  return r.json && r.json.access_token ? r.json.access_token : null;
}

async function deleteSelf(token) {
  const r = await api('/rest/v1/rpc/delete_own_account', { method: 'POST', body: '{}' }, token);
  return r.status === 204 || r.status === 200;
}

(async () => {
  // 1) 临时账号用于列出房间目录
  const tmp = 'cleaner' + Date.now().toString().slice(-6);
  const su = await api('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email: deriveEmail(tmp), password: 'test123456', data: { display_name: tmp } }),
  });
  const tmpToken = su.json && su.json.access_token;
  if (!tmpToken) { console.error('临时账号登录失败:', su.txt.slice(0, 200)); process.exit(1); }

  const list = await api('/rest/v1/rpc/search_rooms', { method: 'POST', body: '{"p_q":""}' }, tmpToken);
  const rooms = list.json || [];
  console.log('当前房间目录:', rooms.map(r => r.name).join(', ') || '(空)');

  const targets = [];
  for (const r of rooms) {
    const m = /^dbg房(\d{6})$/.exec(r.name);
    if (m) targets.push({ user: 'dbg' + m[1], via: 'derive' });
    if (r.name === 'TestRoom') targets.push({ user: 'roomtest01@' + DOMAIN, via: 'email' });
  }

  for (const t of targets) {
    const email = t.via === 'derive' ? deriveEmail(t.user) : t.user;
    const token = await login(email, 'test123456');
    if (!token) { console.log('⚠️ 登录失败，跳过:', t.user); continue; }
    const ok = await deleteSelf(token);
    console.log(`${ok ? '✅' : '❌'} 已注销测试账号并删除其房间: ${t.user}`);
  }

  // 2) 清理临时账号自身
  await deleteSelf(tmpToken);
  console.log('✅ 临时清理账号已注销');

  // 3) 复核目录
  const su2 = await api('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email: deriveEmail(tmp + 'b'), password: 'test123456', data: { display_name: tmp + 'b' } }),
  });
  const list2 = await api('/rest/v1/rpc/search_rooms', { method: 'POST', body: '{"p_q":""}' }, su2.json.access_token);
  console.log('清理后房间目录:', (list2.json || []).map(r => r.name).join(', ') || '(空)');
  await deleteSelf(su2.json.access_token);
})().catch(e => { console.error('清理失败:', e); process.exit(1); });
