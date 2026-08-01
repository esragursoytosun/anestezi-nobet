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

        if (b.profile !== undefined) un.profile = b.profile;
        if (b.cfg !== undefined) un.cfg = b.cfg;
        if (b.name && me.role === 'admin') un.name = b.name;
        un.rev = mevcut + 1;
        un.savedAt = new Date().toISOString();
        un.savedBy = me.u;
        st.rev = (st.rev || 0) + 1;
        if (!(await core.saveAsistan(st))) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
        return json(res, 200, { ok: true, rev: un.rev, savedAt: un.savedAt, savedBy: un.savedBy });
    }

    return json(res, 405, { error: 'method' });
};
