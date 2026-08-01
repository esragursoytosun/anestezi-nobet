/* POST /api/asistan/admin — birim ve yönetici işlemleri
   ---------------------------------------------------------------------
   YETKİ İKİ KADEMELİ:
     • ADMIN: her şey (birim ekle/sil/adlandır, yönetici ata/kaldır)
     • BİRİM YÖNETİCİSİ: yalnız KENDİ biriminde talep işlemleri
       (talep linki üret, talep dönemini aç/kapa, talep sil)
   Yönetici başka birime dokunamaz; birim yapısını değiştiremez. */
'use strict';
const core = require('../../lib/core');
const { json, ensureStorage } = require('../../lib/http');

// Birim yöneticisinin KENDİ biriminde yapabildiği işlemler
const YONETICI_ISLEMLERI = ['reqTokens', 'reqOpen', 'reqDelete', 'reqRotate'];

module.exports = async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!(await ensureStorage(res))) return;
    const me = await core.aReqUser(req.headers);
    if (!me) return json(res, 401, { error: 'Giriş gerekli' });

    const b = req.body || {};
    const yetkili = me.role === 'admin' ||
        (me.role === 'manager' && YONETICI_ISLEMLERI.indexOf(b.action) >= 0 && b.id && me.unitId === b.id);
    if (!yetkili) return json(res, 403, { error: 'Bu işlem için yetkiniz yok' });

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
    /* Bir birimde BİRDEN FAZLA yönetici olabilir. Aynı kullanıcı adı tekrar
       verilirse yeni yönetici eklenmez, mevcut yöneticinin ŞİFRESİ yenilenir. */
    if (b.action === 'setManager') {
        const uu = (b.username || '').trim(), pp = (b.password || '').trim();
        if (!uu || !pp) return json(res, 400, { error: 'Kullanıcı adı ve şifre gerekli' });
        // Aynı ad başka bir birimde ya da başka bir rolde kullanılıyorsa engelle
        if (st.users.some(x => x.u === uu && !(x.role === 'manager' && x.unitId === b.id))) {
            return json(res, 400, { error: 'Bu kullanıcı adı başka bir birimde kullanılıyor' });
        }
        const mevcut = st.users.find(x => x.u === uu && x.role === 'manager' && x.unitId === b.id);
        if (mevcut) { mevcut.pw = core.hashPw(pp); delete mevcut.p; return persist({ ok: true, guncellendi: true }); }
        st.users.push({ u: uu, pw: core.hashPw(pp), role: 'manager', unitId: b.id });
        return persist({ ok: true, eklendi: true });
    }
    /* Tek bir yöneticiyi kaldırır (kullanıcı adı ile). Ad verilmezse hiçbir
       şey silinmez — eskiden birimin TÜM yöneticilerini siliyordu. */
    if (b.action === 'removeManager') {
        const uu = (b.username || '').trim();
        if (!uu) return json(res, 400, { error: 'Kaldırılacak yönetici belirtilmedi' });
        const once = st.users.length;
        st.users = st.users.filter(x => !(x.role === 'manager' && x.unitId === b.id && x.u === uu));
        if (st.users.length === once) return json(res, 404, { error: 'Yönetici bulunamadı' });
        return persist({ ok: true });
    }
    /* ---- TALEP YÖNETİMİ (yalnız admin) ----
       Kişiye özel bağlantı anahtarları burada üretilir; talepler yalnız
       buradan silinir. Talepler plana asla otomatik işlenmez. */
    if (b.action === 'reqTokens') {
        const un = st.units.find(x => x.id === b.id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        const adlar = Array.isArray(b.names) ? b.names.filter(x => typeof x === 'string' && x.trim()) : [];
        const eski = un.reqTokens || {}, yeni = {};
        adlar.forEach(ad => {
            const a = ad.trim();
            // Var olan anahtar korunur (paylaşılmış linkler bozulmasın);
            // yalnız yeni kişiler için üretilir. b.yenile ile hepsi tazelenir.
            yeni[a] = (!b.yenile && eski[a]) ? eski[a] : require('crypto').randomBytes(18).toString('base64url');
        });
        un.reqTokens = yeni;
        return persist({ ok: true, reqTokens: yeni });
    }
    /* TEK KİŞİNİN linkini yeniler (sızma/kaybolma durumu). Eski link anında
       ölür; diğer kişilerin linkleri etkilenmez. */
    if (b.action === 'reqRotate') {
        const un = st.units.find(x => x.id === b.id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        const ad = (b.name || '').trim();
        if (!ad || !un.reqTokens || !un.reqTokens[ad]) return json(res, 404, { error: 'Kişi bulunamadı' });
        un.reqTokens[ad] = require('crypto').randomBytes(18).toString('base64url');
        return persist({ ok: true, name: ad, token: un.reqTokens[ad] });
    }
    if (b.action === 'reqOpen') {
        const un = st.units.find(x => x.id === b.id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        un.reqOpen = !!b.acik;
        if (b.ay !== undefined) un.reqMonth = b.ay || null;
        return persist({ ok: true, reqOpen: un.reqOpen, reqMonth: un.reqMonth || null });
    }
    if (b.action === 'reqDelete') {
        const un = st.units.find(x => x.id === b.id);
        if (!un) return json(res, 404, { error: 'birim yok' });
        un.requests = (un.requests || []).filter(t => t.id !== b.reqId);
        return persist({ ok: true });
    }
    if (b.action === 'renameUnit') {
        const un = st.units.find(x => x.id === b.id);
        if (un) un.name = (b.name || un.name).trim();
        return persist({ ok: true });
    }
    return json(res, 400, { error: 'bilinmeyen işlem' });
};
