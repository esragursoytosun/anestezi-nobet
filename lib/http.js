/* Serverless fonksiyonları için küçük yardımcılar. */
'use strict';
const core = require('./core');

/** JSON yanıt — tarayıcı asla önbelleğe almasın (veri her zaman taze). */
function json(res, code, obj) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(code).json(obj);
}

/** Depo gerçekten erişilebilir mi?
 *  Mongo'ya ulaşılamadığında BOŞ durum döndürmek, kullanıcıya "verilerim
 *  silinmiş" gibi görünür ve üstüne kayıt yapılırsa gerçekten silinir.
 *  Bu yüzden Vercel'de depo yoksa açıkça 503 döndürüp isteği durduruyoruz. */
async function ensureStorage(res) {
    const col = await core.getCol();
    if (core.storageUnavailable(col)) {
        json(res, 503, { error: 'Veri deposuna şu an ulaşılamıyor. Lütfen birazdan tekrar deneyin.' });
        return false;
    }
    return true;
}

module.exports = { json, ensureStorage };
