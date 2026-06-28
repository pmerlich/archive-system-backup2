// renderer.js — ממשק ה-Reader (שלב 3.3). מדבר עם השרת דרך fetch בלבד; הטוקן נשמר בזיכרון ונמחק ביציאה.
'use strict';
let API = 'http://localhost:4000';
let DEVICE_ID = '';
let DEVICE_NAME = 'Reader';
let token = null;            // טוקן התחברות (בזיכרון בלבד)
let pendingEmail = '';
const viewTokens = new Map(); // sid -> { token, exp }
const objectUrls = [];        // לשחרור

const $ = (id) => document.getElementById(id);
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function setMsg(id, text, isErr) { const el = $(id); el.textContent = text || ''; el.className = 'msg' + (isErr ? ' err' : ''); }

// חוסם תפריט-הקשר וגרירה בכל הממשק (הגנת-יתר; ההגנה האמיתית בשרת)
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, Object.assign({}, opts, { headers, cache: 'no-store' }));
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.message) ? (Array.isArray(data.message) ? data.message.join(', ') : data.message) : ('שגיאה ' + res.status));
  return data;
}

// ───────── התחברות ─────────
async function doLogin() {
  const email = $('email').value.trim();
  const password = $('password').value;
  const codeShown = !$('twofa').classList.contains('hidden');
  setMsg('loginMsg', 'מתחבר…');
  $('loginBtn').disabled = true;
  try {
    let r;
    if (codeShown) {
      const code = $('code').value.trim();
      r = await api('/auth/2fa/login-verify', { method: 'POST', body: JSON.stringify({ email: pendingEmail || email, code, deviceId: DEVICE_ID }) });
    } else {
      r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, deviceId: DEVICE_ID, deviceName: DEVICE_NAME }) });
    }
    if (r.deviceStatus === 'pending') { setMsg('loginMsg', 'המכשיר ממתין לאישור מנהל. לאחר אישור — נסה שוב.', true); return; }
    if (r.deviceStatus === 'revoked') { setMsg('loginMsg', 'המכשיר נחסם על ידי המנהל.', true); return; }
    if (r.twoFactorRequired) { pendingEmail = r.email || email; show('twofa', true); setMsg('loginMsg', 'נשלח קוד אימות למייל. הזן אותו והמשך.'); return; }
    if (r.accessToken) { token = r.accessToken; await enterApp(r.user); return; }
    setMsg('loginMsg', 'תשובה לא צפויה מהשרת.', true);
  } catch (e) {
    setMsg('loginMsg', e.message || 'שגיאת התחברות', true);
  } finally {
    $('loginBtn').disabled = false;
  }
}

async function enterApp(user) {
  show('login', false); show('app', true);
  $('hello').textContent = 'שלום' + (user && user.email ? ' · ' + user.email : '');
  await loadFiles();
}

function logout() {
  token = null; pendingEmail = ''; viewTokens.clear();
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  $('password').value = ''; $('code').value = ''; show('twofa', false);
  setMsg('loginMsg', ''); show('app', false); show('login', true);
}

// ───────── רשימת קבצים ─────────
async function loadFiles() {
  setMsg('viewerMsg', '');
  const r = await api('/files?pageSize=100&sort=createdAt&order=desc');
  const items = (r && r.items) || [];
  const list = $('fileList'); list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div class="muted">אין קבצים להצגה.</div>'; return; }
  for (const f of items) {
    const row = document.createElement('div');
    row.className = 'row';
    const left = document.createElement('div'); left.textContent = f.name;
    const right = document.createElement('div'); right.className = 'muted'; right.textContent = f.mimeType || '';
    row.appendChild(left); row.appendChild(right);
    row.addEventListener('click', () => openFile(f));
    list.appendChild(row);
  }
}

// ───────── צפייה מוגנת ─────────
let current = null; // { sid, kind, pages, fileId }

async function viewToken(sid) {
  const c = viewTokens.get(sid);
  if (c && c.exp > Date.now()) return c.token;
  const r = await api('/view/sessions/' + sid + '/token', { method: 'POST' });
  viewTokens.set(sid, { token: r.token, exp: Date.now() + (r.tokenExpiresIn - 10) * 1000 });
  return r.token;
}

async function rendition(sid, fileId, seg) {
  const hit = async (tk) => fetch(API + '/view/' + fileId + '/' + seg + '?vt=' + encodeURIComponent(tk),
    { headers: token ? { Authorization: 'Bearer ' + token } : {}, cache: 'no-store' });
  let res = await hit(await viewToken(sid));
  if (res.status === 403) { viewTokens.delete(sid); res = await hit(await viewToken(sid)); }
  if (!res.ok) throw new Error('שגיאת צפייה ' + res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob); objectUrls.push(url);
  return { url, type: res.headers.get('Content-Type') || '' };
}

async function openFile(f) {
  show('browse', false); show('viewer', true); show('pager', false);
  $('viewerName').textContent = f.name; $('stage').innerHTML = '';
  setMsg('viewerMsg', 'טוען…');
  try {
    const s = await api('/view/sessions', { method: 'POST', body: JSON.stringify({ fileId: f.id }) });
    viewTokens.set(s.sid, { token: s.token, exp: Date.now() + (s.tokenExpiresIn - 10) * 1000 });
    current = { sid: s.sid, kind: s.kind, pages: s.pages || 1, fileId: f.id, page: 1 };
    await renderCurrent();
  } catch (e) {
    setMsg('viewerMsg', e.message || 'שגיאה', true);
  }
}

async function renderCurrent() {
  const c = current; const stage = $('stage'); stage.innerHTML = ''; setMsg('viewerMsg', 'טוען…');
  show('pager', c.kind === 'pdf' && c.pages > 1);
  try {
    if (c.kind === 'image') { const r = await rendition(c.sid, c.fileId, 'image'); stage.appendChild(img(r.url)); }
    else if (c.kind === 'pdf') { const r = await rendition(c.sid, c.fileId, 'page/' + c.page); stage.appendChild(img(r.url)); $('pageInfo').textContent = 'עמוד ' + c.page + ' מתוך ' + c.pages; }
    else if (c.kind === 'video') { const r = await rendition(c.sid, c.fileId, 'video'); stage.appendChild(media('video', r.url)); }
    else if (c.kind === 'audio') { const r = await rendition(c.sid, c.fileId, 'audio'); stage.appendChild(media('audio', r.url)); }
    else if (c.kind === 'text') { const r = await rendition(c.sid, c.fileId, 'text'); const t = await (await fetch(r.url)).text(); const pre = document.createElement('pre'); pre.textContent = t; stage.appendChild(pre); }
    else { setMsg('viewerMsg', 'אין תצוגה לסוג קובץ זה', true); return; }
    setMsg('viewerMsg', '');
  } catch (e) { setMsg('viewerMsg', e.message || 'שגיאת צפייה', true); }
}

function img(url) { const el = document.createElement('img'); el.src = url; el.draggable = false; return el; }
function media(tag, url) { const el = document.createElement(tag); el.src = url; el.controls = true; el.setAttribute('controlsList', 'nodownload noplaybackrate'); el.disablePictureInPicture = true; return el; }

// ───────── אתחול + אירועים ─────────
window.addEventListener('DOMContentLoaded', async () => {
  try { const info = await window.reader.init(); API = info.apiBase || API; DEVICE_ID = info.deviceId; DEVICE_NAME = info.deviceName || 'Reader'; }
  catch { /* ignore */ }
  $('deviceLine').textContent = 'מזהה מכשיר: ' + (DEVICE_ID || '—');
  $('loginBtn').addEventListener('click', doLogin);
  $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('logoutBtn').addEventListener('click', logout);
  $('backBtn').addEventListener('click', () => { show('viewer', false); show('browse', true); });
  $('prevBtn').addEventListener('click', () => { if (current && current.page > 1) { current.page--; renderCurrent(); } });
  $('nextBtn').addEventListener('click', () => { if (current && current.page < current.pages) { current.page++; renderCurrent(); } });
});
