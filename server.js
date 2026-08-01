/* =====================================================================
   ANESTEZİ NÖBET — YEREL GELİŞTİRME SUNUCUSU
   ---------------------------------------------------------------------
   Canlı yayın artık Vercel'de: statik dosyalar kökten, API'ler api/*.js
   serverless fonksiyonlarından servis edilir. Bu dosya aynı rotaları
   YEREL'de tek süreçte ayağa kaldırır (npm start), böylece geliştirirken
   Vercel CLI'ya gerek kalmaz.

   Tüm iş mantığı lib/core.js'te — TEK KAYNAK. Buradaki kod yalnız HTTP
   yönlendirmesi ve statik dosya sunumudur; kural değişikliği core'da
   yapılır ve hem burada hem Vercel'de aynı anda geçerli olur.
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const core = require('./lib/core');

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 6e6) req.destroy(); });
    req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch (e) { cb(null); } });
}

/** api/*.js fonksiyonlarını Node'un http sunucusunda çalıştırmak için ince köprü:
 *  Vercel'in verdiği req.body / req.query / res.status().json() arayüzünü taklit eder. */
function runHandler(handler, req, res, query, body) {
    req.body = body;
    req.query = query;
    res.status = code => { res._code = code; return res; };
    res.json = obj => sendJSON(res, res._code || 200, obj);
    const origSetHeader = res.setHeader.bind(res);
    res.setHeader = (k, v) => { if (!res.headersSent) origSetHeader(k, v); };
    Promise.resolve(handler(req, res)).catch(err => {
        console.error('[api] hata:', err);
        if (!res.headersSent) sendJSON(res, 500, { error: 'Sunucu hatası' });
    });
}

// Yol -> fonksiyon eşlemesi (Vercel'deki dosya-tabanlı yönlendirmenin aynısı)
const ROUTES = {
    '/api/login': require('./api/login'),
    '/api/changepw': require('./api/changepw'),
    '/api/users': require('./api/users'),
    '/api/state': require('./api/state'),
    '/api/asistan/login': require('./api/asistan/login'),
    '/api/asistan/units': require('./api/asistan/units'),
    '/api/asistan/unit': require('./api/asistan/unit'),
    '/api/asistan/admin': require('./api/asistan/admin'),
};

const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const handler = ROUTES[u.pathname];

    if (handler) {
        const query = Object.fromEntries(u.searchParams.entries());
        if (req.method === 'GET' || req.method === 'HEAD') return runHandler(handler, req, res, query, {});
        return readBody(req, body => runHandler(handler, req, res, query, body || {}));
    }

    // ---- statik dosyalar ----
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const fp = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        const ext = path.extname(fp);
        const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
        // HTML'i ASLA önbelleğe alma -> her açılışta en güncel sürüm gelir.
        if (ext === '.html') headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        res.writeHead(200, headers);
        res.end(data);
    });
});

server.listen(PORT, () => console.log(
    'Anestezi yerel sunucu: http://localhost:' + PORT +
    (process.env.MONGODB_URI ? ' (MongoDB)' : ' (dosya: data/)')
));

// NOT: Eskiden burada Render'ın 15 dakikalık uykusuna karşı 13 dakikada bir
// kendimize istek atan bir "uyumama" zamanlayıcısı vardı. Servisi 7/24 uyanık
// tuttuğu için ücretsiz kotayı tek başına tüketiyordu. Vercel'de uyuma diye bir
// şey olmadığından tamamen kaldırıldı.
