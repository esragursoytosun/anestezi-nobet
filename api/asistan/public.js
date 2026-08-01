/* GET /api/asistan/public?token=... — SALT-OKUNUR birim görünümü.
   ---------------------------------------------------------------------
   Nöbetçilerin kendi listelerini görmesi için: hesap yok, giriş yok.
   Yalnızca paylaşım anahtarı bilinen birimin ADI, KURAL PROFİLİ ve AY
   YAPILANDIRMASI döner. Kullanıcı listesi, şifreler ve diğer birimler
   hiçbir koşulda bu uçtan çıkmaz. Yazma yolu yoktur (yalnız GET).
   Anahtar iptal edilirse (unit'ten silinirse) link anında ölür. */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

module.exports = async (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    if (!(await ensureStorage(res))) return;

    const token = (req.query && req.query.token) || '';
    // Kısa/boş anahtarla deneme yapılmasın.
    if (typeof token !== 'string' || token.length < 16) {
        return json(res, 404, { error: 'Bu bağlantı geçersiz.' });
    }

    const st = await core.loadAsistan();
    const un = (st.units || []).find(x => x.shareToken && x.shareToken === token);
    if (!un) return json(res, 404, { error: 'Bu bağlantı geçersiz veya iptal edilmiş.' });

    return json(res, 200, {
        name: un.name,
        profile: un.profile || null,
        cfg: un.cfg || null,
        savedAt: un.savedAt || null,
        readOnly: true,
    });
};
