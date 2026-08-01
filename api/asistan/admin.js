/* POST /api/asistan/admin — birim ekle/sil/adlandır, birim yöneticisi ata/kaldır (yalnız admin) */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!(await ensureStorage(res))) return;
    const me = await core.aReqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });
    if (me.role !== 'admin') return json(res, 403, { error: 'Yalnız admin' });

    const b = req.body || {};
    const st = await core.loadAsistan();
    st.units = st.units || [];
    st.users = st.users || [];
    const persist = async payload => {
        if (!(await core.saveAsistan(st))) return json(res, 503, { error: 'Kaydedilemedi — veri deposuna ulaşılamadı' });
        return json(res, 200, payload);
    };

    if (b.action === 'addUnit') {
        const id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        st.units.push({ id, name: (b.name || 'Birim').trim(), profile: b.profile || null, cfg: b.cfg || null });
        st.rev = (st.rev || 0) + 1;
        return persist({ ok: true, id });
    }
    if (b.action === 'delUnit') {
        st.units = st.units.filter(x => x.id !== b.id);
        st.users = st.users.filter(x => !(x.role === 'manager' && x.unitId === b.id));
        return persist({ ok: true });
    }
    if (b.action === 'setManager') {
        const uu = (b.username || '').trim(), pp = (b.password || '').trim();
        if (!uu || !pp) return json(res, 400, { error: 'Kullanıcı adı ve şifre gerekli' });
        if (st.users.some(x => x.u === uu && !(x.role === 'manager' && x.unitId === b.id))) {
            return json(res, 400, { error: 'Bu kullanıcı adı başka yerde kullanılıyor' });
        }
        st.users = st.users.filter(x => !(x.role === 'manager' && x.unitId === b.id));   // birimde tek yönetici
        st.users.push({ u: uu, pw: core.hashPw(pp), role: 'manager', unitId: b.id });
        return persist({ ok: true });
    }
    if (b.action === 'removeManager') {
        st.users = st.users.filter(x => !(x.role === 'manager' && x.unitId === b.id));
        return persist({ ok: true });
    }
    // Paylaşım linki: anahtar üret / iptal et. Anahtar yalnızca burada
    // oluşur; iptal edilince eski link anında geçersiz olur.
    if (b.action === 'shareOn' || b.action === 'shareOff') {
        const un = st.units.find(x => x.id === b.id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        if (b.action === 'shareOff') { delete un.shareToken; return persist({ ok: true, shareToken: null }); }
        un.shareToken = require('crypto').randomBytes(18).toString('base64url');
        return persist({ ok: true, shareToken: un.shareToken });
    }
    if (b.action === 'renameUnit') {
        const un = st.units.find(x => x.id === b.id);
        if (un) un.name = (b.name || un.name).trim();
        return persist({ ok: true });
    }
    return json(res, 400, { error: 'bilinmeyen işlem' });
};
