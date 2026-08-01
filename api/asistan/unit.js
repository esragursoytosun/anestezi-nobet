/* GET|POST /api/asistan/unit?id=... — bir birimin kural profili ve ay yapılandırması */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

module.exports = async (req, res) => {
    if (!(await ensureStorage(res))) return;
    const me = await core.aReqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });

    const id = (req.query && req.query.id) || null;
    if (!core.aCanAccess(me, id)) return json(res, 403, { error: 'Bu birime erişim yetkiniz yok' });

    if (req.method === 'GET') {
        const st = await core.loadAsistan();
        const un = (st.units || []).find(x => x.id === id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        return json(res, 200, {
            id: un.id, name: un.name, profile: un.profile || null, cfg: un.cfg || null,
            rev: un.rev || 0, savedAt: un.savedAt || null, savedBy: un.savedBy || null,
            requests: un.requests || [], reqOpen: un.reqOpen !== false, reqMonth: un.reqMonth || null,
            reqTokens: un.reqTokens || {},
        });
    }

    if (req.method === 'POST') {
        const b = req.body || {};
        const st = await core.loadAsistan();
        const un = (st.units || []).find(x => x.id === id);
        if (!un) return json(res, 404, { error: 'birim yok' });

        // ── EŞZAMANLI DÜZENLEME KORUMASI ──────────────────────────────────
        // İstemci, birimi açtığı andaki sürümü (rev) geri gönderir. Aradan
        // başka biri kaydettiyse sürüm değişmiştir; sessizce üzerine yazmak
        // yerine 409 dönüp KİMİN ne zaman kaydettiğini bildiriyoruz. Sürüm
        // göndermeyen eski istemciler eskisi gibi çalışmaya devam eder.
        const mevcut = un.rev || 0;
        if (b.rev !== undefined && b.rev !== null && Number(b.rev) !== mevcut) {
            return json(res, 409, {
                error: 'Bu birim siz açtıktan sonra başka biri tarafından kaydedildi.',
                rev: mevcut, savedBy: un.savedBy || null, savedAt: un.savedAt || null,
            });
        }

        const savedAt = new Date().toISOString();
        /* ATOMİK KAYIT — yalnız bu birimin KENDİ alanlarını değiştirir.
           Eskiden belgenin tamamı geri yazılıyordu; kayıt sırasında araya
           giren bir personel talebi sessizce siliniyordu. Ayrıca sürüm
           koşulu filtreye konduğu için çakışma denetimi de veritabanı
           tarafında, yarış payı bırakmadan yapılır. */
        const set = { 'units.$.rev': mevcut + 1, 'units.$.savedAt': savedAt, 'units.$.savedBy': me.u };
        if (b.profile !== undefined) set['units.$.profile'] = b.profile;
        if (b.cfg !== undefined) set['units.$.cfg'] = b.cfg;
        if (b.name && me.role === 'admin') set['units.$.name'] = b.name;
        // rev alanı eski kayıtlarda hiç olmayabilir → 0 beklerken "yok"u da kabul et
        const revKosul = mevcut === 0 ? { $or: [{ rev: 0 }, { rev: { $exists: false } }] } : { rev: mevcut };
        const sonuc = await core.unitUpdate({ units: { $elemMatch: Object.assign({ id: id }, revKosul) } }, { $set: set });

        // Eski yol (yerel dosya modu ve düşme-emniyeti için)
        const tumunuYaz = async () => {
            if (b.profile !== undefined) un.profile = b.profile;
            if (b.cfg !== undefined) un.cfg = b.cfg;
            if (b.name && me.role === 'admin') un.name = b.name;
            un.rev = mevcut + 1; un.savedAt = savedAt; un.savedBy = me.u;
            st.rev = (st.rev || 0) + 1;
            return core.saveAsistan(st);
        };

        if (sonuc === null) {                            // yerel dosya modu (tek süreç)
            if (!(await tumunuYaz())) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
        } else if (!sonuc) {
            /* Filtre tutmadı. İki ihtimal var:
               (a) gerçekten başka biri araya girdi  → 409 dön
               (b) atomik filtre yapısal olarak eşleşmedi → ESKİ YOLA düş.
               (b)'yi ayırt etmek için sürümü tazeden okuyoruz; hâlâ bizim
               beklediğimiz sürümdeyse çakışma yok demektir, kaydı kaybetmeyiz. */
            const taze = await core.loadAsistan();
            const g = (taze.units || []).find(x => x.id === id) || {};
            if ((g.rev || 0) === mevcut) {
                if (!(await tumunuYaz())) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
            } else {
                return json(res, 409, {
                    error: 'Bu birim siz açtıktan sonra başka biri tarafından kaydedildi.',
                    rev: g.rev || 0, savedBy: g.savedBy || null, savedAt: g.savedAt || null,
                });
            }
        }
        return json(res, 200, { ok: true, rev: mevcut + 1, savedAt: savedAt, savedBy: me.u });
    }

    return json(res, 405, { error: 'method' });
};
