/* =====================================================================
   ANESTEZİ NÖBET — ORTAK/CANLI sunucu (Utopya benzeri)
   ---------------------------------------------------------------------
   - Statik dosyaları (index.html, scheduler.js) sunar.
   - /api/state  GET  -> kayıtlı ortak durumu döndürür { cfg, grid, rev, savedAt, by }
                 POST -> ortak durumu kaydeder (gövdede cfg/grid). rev artar.
   - Depo: MongoDB (MONGODB_URI varsa) yoksa data/state.json dosyası.
   - İstemci ~2 sn'de bir poll eder; rev değişince (arkadaş kaydetti) güncellenir.
   - Aynı anda iki kişi çalışabilir; kayıt "son yazan" mantığıyla birleşir (rev ile çakışma görünür).
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'state.json');
const MONGODB_URI = process.env.MONGODB_URI;
const DOC_ID = 'anestezi_state';
// Ortak parola (Render'da APP_PASSWORD ortam değişkeniyle değiştirin). Yalnız /api/* korunur.
const PASSWORD = process.env.APP_PASSWORD || 'anestezi2026';
function authed(req) { return (req.headers['x-auth'] || '') === PASSWORD; }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function emptyState() { return { cfg: null, grid: null, rev: 0, savedAt: null, by: null }; }

// ---- MongoDB (opsiyonel) ----
let _col = null, _mongoTried = false;
async function getCol() {
  if (!MONGODB_URI) return null;
  if (_col) return _col;
  if (_mongoTried && !_col) return null;
  _mongoTried = true;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    _col = client.db('anestezi').collection('state');
    console.log('[db] MongoDB bağlandı.');
    return _col;
  } catch (e) {
    console.error('[db] MongoDB bağlanamadı, dosya kullanılacak:', e.message);
    return null;
  }
}
async function loadState() {
  const col = await getCol();
  if (col) {
    try {
      const doc = await col.findOne({ _id: DOC_ID });
      if (!doc) return emptyState();
      const { _id, ...rest } = doc; return Object.assign(emptyState(), rest);
    } catch (e) { console.error('[db] load hata, dosya:', e.message); }
  }
  try { if (fs.existsSync(FILE)) return Object.assign(emptyState(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (e) { console.error('[db] dosya okuma hata:', e.message); }
  return emptyState();
}
async function saveState(st) {
  const col = await getCol();
  if (col) {
    try { await col.replaceOne({ _id: DOC_ID }, Object.assign({ _id: DOC_ID }, st), { upsert: true }); return; }
    catch (e) { console.error('[db] save hata, dosya:', e.message); }
  }
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(st), 'utf8'); }
  catch (e) { console.error('[db] dosya yazma hata:', e.message); }
}

function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  // ---- Giriş: parola doğrula ----
  if (u.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      try { const p = (JSON.parse(body || '{}').password) || '';
        if (p === PASSWORD) return sendJSON(res, 200, { ok: true });
        return sendJSON(res, 401, { ok: false, error: 'Parola hatalı' });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    });
    return;
  }

  // ---- API (parola korumalı) ----
  if (u.pathname === '/api/state') {
    if (!authed(req)) return sendJSON(res, 401, { error: 'Giriş gerekli' });
    if (req.method === 'GET') { const st = await loadState(); return sendJSON(res, 200, st); }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const incoming = JSON.parse(body || '{}');
          const cur = await loadState();
          const next = { cfg: incoming.cfg !== undefined ? incoming.cfg : cur.cfg,
            grid: incoming.grid !== undefined ? incoming.grid : cur.grid,
            rev: (cur.rev || 0) + 1, savedAt: new Date().toISOString(), by: incoming.by || null };
          await saveState(next);
          sendJSON(res, 200, next);
        } catch (e) { sendJSON(res, 400, { error: e.message }); }
      });
      return;
    }
    return sendJSON(res, 405, { error: 'method' });
  }

  // ---- statik dosyalar ----
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const fp = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log('Anestezi ortak sunucu: http://localhost:' + PORT + (MONGODB_URI ? ' (MongoDB)' : ' (dosya)')));
