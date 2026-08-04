/* GET|POST /api/asistan/request?token=... — KİŞİYE ÖZEL TALEP UCU
   ---------------------------------------------------------------------
   Personelin yıllık izin / boş gün gibi taleplerini iletmesi içindir.
   Kimlik: kişiye özel bağlantı anahtarı (şifre ezberlemeye gerek yok;
   sızarsa yalnız o kişininki yenilenir).

   GÜVENLİK SINIRLARI — bu uçtan ASLA çıkmaz:
     • başka kişilerin talepleri veya isimleri
     • nöbet listesi, kural profili, ay yapılandırması
     • kullanıcı/şifre bilgisi, diğer birimler
   Dönen tek şey: birim adı, KİŞİNİN KENDİ adı, talep dönemi durumu ve
   yine KENDİ gönderdiği talepler.

   Talepler plana OTOMATİK İŞLENMEZ; yalnızca yöneticinin gelen kutusuna
   düşer. Yani bu uç nöbet listesini değiştiremez.
   ===================================================================== */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

const TURLER = ['yillik-izin', 'bos-gun', 'nobet-tercihi', 'diger'];
// Ay anahtarı 'YYYY-M' — ay 0 TABANLI (uygulamanın MONTHS_DATA anahtarlarıyla
// aynı biçim; Ocak=0 … Aralık=11). Böylece gelen talep, planlanan ayla
// doğrudan eşleşir.
const AY_BICIMI = /^\d{4}-(?:[0-9]|1[01])$/;
const MAX_TALEP_KISI = 30;      // kişi başı biriken talep tavanı (kötüye kullanım freni)
const MAX_METIN = 400;

function kes(s, n) { return String(s == null ? '' : s).slice(0, n); }

/** Anahtarı olan kişiyi bulur: { un, ad } ya da null. */
function sahibiBul(st, token) {
    for (const un of (st.units || [])) {
        const harita = un.reqTokens || {};
        for (const ad of Object.keys(harita)) {
            if (harita[ad] && harita[ad] === token) return { un, ad };
        }
    }
    return null;
}

module.exports = async (req, res) => {
    if (!(await ensureStorage(res))) return;

    const token = (req.query && req.query.token) || '';
    if (typeof token !== 'string' || token.length < 16) {
        return json(res, 404, { error: 'Bu bağlantı geçersiz.' });
    }

    const st = await core.loadAsistan();
    const bulunan = sahibiBul(st, token);
    if (!bulunan) return json(res, 404, { error: 'Bu bağlantı geçersiz veya iptal edilmiş.' });
    const { un, ad } = bulunan;

    if (req.method === 'GET') {
        const benim = (un.requests || []).filter(t => t.name === ad)
            .map(t => ({ id: t.id, tur: t.tur, ay: t.ay || null, bas: t.bas, bit: t.bit, gunler: t.gunler, not: t.not, at: t.at }));
        return json(res, 200, {
            birim: un.name, ad: ad,
            acik: un.reqOpen !== false,          // varsayılan açık
            ay: un.reqMonth || null,             // yöneticinin ilan ettiği talep ayı (formda hazır gelir)
            taleplerim: benim,
        });
    }

    if (req.method === 'POST') {
        if (un.reqOpen === false) {
            return json(res, 403, { error: 'Talep dönemi kapalı. Birim yöneticinizle görüşün.' });
        }
        const b = req.body || {};
        const tur = TURLER.indexOf(b.tur) >= 0 ? b.tur : 'diger';

        // Silme: kişi YALNIZ kendi talebini silebilir
        if (b.sil) {
            const i = (un.requests || []).findIndex(t => t.id === b.sil && t.name === ad);
            if (i < 0) return json(res, 404, { error: 'Talep bulunamadı.' });
            // Atomik $pull — belgenin geri kalanına dokunmaz (bkz. core.unitUpdate)
            const sonuc = await core.unitUpdate({ 'units.id': un.id },
                { $pull: { 'units.$.requests': { id: b.sil, name: ad } } });
            if (sonuc !== true) {                       // dosya modu / düşme-emniyeti
                un.requests.splice(i, 1);
                if (!(await core.saveAsistan(st))) return json(res, 503, { error: 'Kaydedilemedi' });
            }
            return json(res, 200, { ok: true });
        }

        un.requests = un.requests || [];
        if (un.requests.filter(t => t.name === ad).length >= MAX_TALEP_KISI) {
            return json(res, 429, { error: 'Çok fazla talep gönderdiniz. Yöneticinize başvurun.' });
        }
        const ISO = /^\d{4}-\d{2}-\d{2}$/;
        // HANGİ AY İÇİN? Boş gün istekleri ("5,12") ay bilgisi olmadan
        // anlamsız kalıyordu. Geçerli bir ay gelmezse yöneticinin ilan
        // ettiği talep ayına düşülür.
        const ay = AY_BICIMI.test(b.ay || '') ? b.ay
                 : (AY_BICIMI.test(un.reqMonth || '') ? un.reqMonth : null);
        if (!ay) return json(res, 400, { error: 'Talebin hangi ay için olduğu belirtilmeli.' });

        const kayit = {
            id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
            name: ad, tur: tur, ay: ay,
            bas: ISO.test(b.bas || '') ? b.bas : null,
            bit: ISO.test(b.bit || '') ? b.bit : null,
            gunler: kes(b.gunler, 60),
            not: kes(b.not, MAX_METIN),
            at: new Date().toISOString(),
        };
        if (tur === 'yillik-izin' && !kayit.bas) return json(res, 400, { error: 'Başlangıç tarihi gerekli.' });
        if (tur === 'bos-gun' && !kayit.gunler && !kayit.bas) return json(res, 400, { error: 'Gün bilgisi gerekli.' });
        if (tur === 'diger' && !kayit.not) return json(res, 400, { error: 'Lütfen talebinizi yazın.' });

        /* ATOMİK EKLEME — kritik nokta.
           Eskiden belge okunup tamamı geri yazılıyordu; iki personel aynı
           anda gönderdiğinde sonra yazan öncekinin talebini siliyordu (ve
           araya giren bir yönetici kaydını da geri alabiliyordu). $push
           yalnızca ilgili diziye ekler, belgenin geri kalanı korunur. */
        const sonuc = await core.unitUpdate({ 'units.id': un.id },
            { $push: { 'units.$.requests': kayit } });
        if (sonuc !== true) {           // dosya modu ya da atomik yol tutmadı → düşme-emniyeti
            un.requests.push(kayit);
            if (!(await core.saveAsistan(st))) return json(res, 503, { error: 'Kaydedilemedi' });
        }
        return json(res, 200, { ok: true, id: kayit.id });
    }

    return json(res, 405, { error: 'method' });
};
