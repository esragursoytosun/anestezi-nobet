/* =====================================================================
   AYAR DENETİM TESTİ — "her ayar gerçekten işliyor mu?"
   ---------------------------------------------------------------------
   Ayarlar zamanla çoğaldı. Bir ayarın ekranda görünmesi motora geçtiği
   anlamına gelmiyor; ölçmeden bilinmez. Burada HER ayar tek tek
   değiştirilir ve çıktının BEKLENEN yönde değişip değişmediği denetlenir.

   Her satır: ayarı değiştir -> ölçütü hesapla -> beklenen yönde mi?
     ↑ = artmalı · ↓ = azalmalı · ≠ = değişmeli (yön önemli değil)

   "işlemiyor" çıkan bir satır ya gerçek bir kopukluktur ya da o ayarın
   bu senaryoda etkisi yoktur — ikisi de bilinmeye değer.

   Kullanım: node test-ayarlar.js
   ===================================================================== */
'use strict';
var S = require(process.env.MOTOR || './asistan-scheduler.js');

var YIL = 2026, AY = 8, TATIL = [30];

function kadro(n, ek) {
    var p = [];
    for (var i = 1; i <= n; i++) p.push({ name: 'P' + i });
    p[0].noNobet = true;
    p[1].senior = true; p[2].senior = true; p[3].senior = true;
    if (ek && ek.izin) { p[4].leaveYI = [7, 8, 9, 10, 11]; p[5].leaveYI = [18, 19, 20, 21, 22]; }
    if (ek && ek.haftalikIzin) p[6].offDay = 4;
    if (ek && ek.izinAlt) { p[3].leaveYI = [6, 7, 8, 9, 10]; p[4].leaveYI = [20, 21, 22, 23, 24]; }
    if (ek && ek.celiski) { p[7].offReq = [9, 16]; p[7].onlyN24 = [9]; p[8].offReq = [11]; p[8].onlyN16 = [11]; }
    return p;
}
function uret(mut, ek) {
    var prof = S.defaultProfile();
    if (mut) mut(prof);
    return S.buildSchedule({ year: YIL, month: AY, holidays: TATIL,
        personnel: kadro((ek && ek.n) || 14, ek), profile: prof });
}

/* ---- ölçütler ---- */
var CAL = function (c) { return c === 'M' || c === 'NL' || c === 'NS'; };
function kodSay(r, kod) { var t = 0; r.totals.forEach(function (x) {
    for (var d = 1; d <= r.nDays; d++) if (r.grid[x.name][d] === kod) t++; }); return t; }
function nobetToplam(r) { return kodSay(r, 'NL') + kodSay(r, 'NS'); }
function haftaSonuNobet(r) { var t = 0; r.days.forEach(function (d) { if (!(d.weekend || d.holiday)) return;
    r.totals.forEach(function (x) { var c = r.grid[x.name][d.day]; if (c === 'NL' || c === 'NS') t++; }); }); return t; }
function gunduzOrt(r, P, ekstraMi) {
    var t = 0, n = 0;
    r.days.forEach(function (d) {
        if (!d.workday) return;
        if (ekstraMi !== undefined && d.isExtra !== ekstraMi) return;
        var g = 0;
        r.totals.forEach(function (x) { if (x.noNobet) return; var c = r.grid[x.name][d.day];
            if (c === 'M' || (c === 'NL' && P.oncallLongDaytime) || (c === 'NS' && P.oncallShortDaytime)) g++; });
        t += g; n++;
    });
    return n ? t / n : 0;
}
function enUzunCalisma(r) { var en = 0;
    r.totals.filter(function (x) { return !x.noNobet; }).forEach(function (x) {
        var run = 0; for (var d = 1; d <= r.nDays; d++) { if (CAL(r.grid[x.name][d])) { run++; if (run > en) en = run; } else run = 0; } });
    return en; }
function enUzunBosluk(r) { var en = 0;
    r.totals.filter(function (x) { return !x.noNobet; }).forEach(function (x) {
        var run = 0, izin = false;
        for (var d = 1; d <= r.nDays; d++) { var c = r.grid[x.name][d];
            if (CAL(c)) { if (run > en && !izin) en = run; run = 0; izin = false; }
            else { run++; if (c === 'YI' || c === 'GG') izin = true; } }
        if (run > en && !izin) en = run; });
    return en; }
function bosBlokOrt(r) { var blok = 0, gun = 0;
    r.totals.filter(function (x) { return !x.noNobet; }).forEach(function (x) {
        var run = 0; var bit = function () { if (run) { blok++; gun += run; run = 0; } };
        for (var d = 1; d <= r.nDays; d++) { var c = r.grid[x.name][d];
            if (CAL(c)) bit(); else if (r.days[d - 1].workday && (c === 'NI' || c === 'UCI')) run++; else bit(); }
        bit(); });
    return blok ? gun / blok : 0; }
function enCokHaftaSonu(r) { var m = 0; r.totals.forEach(function (x) { if (!x.noNobet && x.weekendNobet > m) m = x.weekendNobet; }); return m; }
function toplamSaat(r) { var t = 0; r.totals.forEach(function (x) { t += x.hours; }); return t; }
function uyariSay(r, kalip) { return (r.warnings || []).filter(function (w) {
    return kalip ? kalip.test(w) : w.indexOf('💡') !== 0; }).length; }
function sapmaNobet(r) {
    var t = r.totals.filter(function (x) { return !x.noNobet; });
    var sw = t.reduce(function (a, x) { return a + (x.target || 1); }, 0) || 1;
    var tn = t.reduce(function (a, x) { return a + x.nl + x.ns; }, 0);
    return Math.max.apply(null, t.map(function (x) { return Math.abs((x.nl + x.ns) - tn * (x.target || 1) / sw); }));
}
function sapmaHaftaSonu(r) {
    var t = r.totals.filter(function (x) { return !x.noNobet; });
    var sw = t.reduce(function (a, x) { return a + (x.target || 1); }, 0) || 1;
    var tw = t.reduce(function (a, x) { return a + x.weekendNobet; }, 0);
    return Math.max.apply(null, t.map(function (x) { return Math.abs(x.weekendNobet - tw * (x.target || 1) / sw); }));
}
function izgaraImza(r) { var s = ''; r.totals.forEach(function (x) {
    for (var d = 1; d <= r.nDays; d++) s += (r.grid[x.name][d] || '-') + ','; }); return s; }

/* ---- test tablosu ----
   Her satir: [ad, TEMEL kurulum, DEGISIKLIK, olcut, beklenen yon, ek]
   TEMEL onemli: bir ayarin etkisini gormek icin baslangicin o ayarin
   sinirinda OLMAMASI gerekir. Orn. "ust uste calisma tavani"ni denemek icin
   once uzun seriler ureten bir taban kurulur; yoksa "zaten 3'tu, 3 kaldi"
   diye yanlislikla "etkisiz" gorunur. */
var Y = function () { };   // bos temel
var TESTLER = [
    ['Hafta içi nöbetçi sayısı', Y, function (p) { p.oncallPerDay = 3; p.oncallMax = 3; },
        function (r) { return nobetToplam(r); }, '↑'],
    ['Hafta sonu nöbetçi sayısı', Y, function (p) { p.weekendOncallPerDay = 3; p.weekendOncallMax = 3; },
        function (r) { return haftaSonuNobet(r); }, '↑'],
    ['Gündüz en az kaç kişi', Y, function (p) { p.daytimeMin = 4; },
        function (r, P) { return gunduzOrt(r, P, false); }, '↑'],
    // dar kadro: sinir gercekten baglayici olsun
    ['Yoğun gün sayısı', function (p) { p.daytimeExtra = 3; }, function (p) { p.daytimeExtra = 5; },
        function (r, P) { return gunduzOrt(r, P, true); }, '↑', { n: 11 }],
    ['Yoğun günler listesi', Y, function (p) { p.daytimeExtraDays = [1, 3, 5]; },
        function (r, P) { return gunduzOrt(r, P, true); }, '≠'],
    ['Nöbette en az kıdemli', Y, function (p) { p.minSeniorOncall = 1; },
        function (r) { return izgaraImza(r); }, '≠'],
    ['Gündüzde en az kıdemli', Y, function (p) { p.minSeniorDaytime = 2; },
        function (r) { return izgaraImza(r); }, '≠'],
    ['Mesai kaç saat', Y, function (p) { p.mesaiHours = 6; },
        function (r) { return toplamSaat(r); }, '≠'],
    // toplam saat hedefe kilitli -> nobet suresi degisince MESAI GUNU sayisi degisir
    ['Uzun nöbet kaç saat', Y, function (p) { p.oncallLongHours = 16; },
        function (r) { return kodSay(r, 'M'); }, '≠'],
    ['Kısa nöbet kaç saat', function (p) { p.defaultOncall = 'short'; },
        function (p) { p.defaultOncall = 'short'; p.oncallShortHours = 12; },
        function (r) { return kodSay(r, 'M'); }, '≠'],
    ['Uzun nöbet gündüzü kapsar', Y, function (p) { p.oncallLongDaytime = false; },
        function (r) { return izgaraImza(r); }, '≠'],
    // gündüz minimumu baskı yapmazsa bu bayrağın etkisi görünmez -> dar kadro + yüksek min
    ['Kısa nöbet gündüzü kapsar', function (p) { p.defaultOncall = 'short'; p.daytimeMin = 4; },
        function (p) { p.defaultOncall = 'short'; p.daytimeMin = 4; p.oncallShortDaytime = true; },
        function (r) { return izgaraImza(r); }, '≠', { n: 11, izin: 1 }],
    // temel KISA nobet kullaniyor olmali ki kapatmanin etkisi gorunsun
    ['Kısa nöbet kullanılsın (kapat)', function (p) { p.defaultOncall = 'short'; },
        function (p) { p.defaultOncall = 'short'; p.useShortOncall = false; },
        function (r) { return kodSay(r, 'NS'); }, '↓'],
    ['Hafta içi nöbet şekli = kısa', Y, function (p) { p.defaultOncall = 'short'; },
        function (r) { return kodSay(r, 'NS'); }, '↑'],
    ['Hafta sonu nöbet şekli = kısa', Y, function (p) { p.weekendOncall = 'short'; },
        function (r) { return kodSay(r, 'NS'); }, '↑'],
    // temel SERBEST (sapma var) -> asla ile sapma azalmali; dar kadro
    ['Nöbet şekline bağlılık = asla', function (p) { p.shiftTypePref = 'serbest'; },
        function (p) { p.shiftTypePref = 'asla'; },
        function (r) { return kodSay(r, 'NS'); }, '↓', { n: 12, izin: 1 }],
    ['Aylık saat hedefi', Y, function (p) { p.targetPerWorkday = 6; },
        function (r) { return toplamSaat(r); }, '↓'],
    // esigi kadronun ALTINA cekince not sonmeli
    ['Az personel uyarı eşiği', Y, function (p) { p.minStaffWarn = 3; },
        function (r) { return uyariSay(r, /ÖNERİ/); }, '↓', { n: 10, izin: 1 }],
    // temelde de gunduz min yuksek olsun ki YALNIZ bayrak degissin
    ['Gerekirse fazla mesai', function (p) { p.daytimeMin = 6; },
        function (p) { p.daytimeMin = 6; p.overtimeForCounts = true; },
        function (r) { return uyariSay(r, /gündüzde \d+ kişi/); }, '↓', { n: 11, izin: 1 }],
    ['Nöbet sonrası dinlenme', Y, function (p) { p.postOncallRest = 2; },
        function (r) { return kodSay(r, 'NI'); }, '↑'],
    ['İzin öncesi nöbet (kapat)', Y, function (p) { p.preLeaveOncall = false; },
        function (r) { return izgaraImza(r); }, '≠', { izin: 1 }],
    ['İzin öncesi nöbet mesafesi', Y, function (p) { p.preLeaveDaysBefore = 2; },
        function (r) { return izgaraImza(r); }, '≠', { izin: 1 }],
    /* preLeaveGap YEDEK bir kural: izin öncesi nöbet mesafelerden hiçbirine
       sığmazsa devreye giriyor. Mesafeler ulaşılmaz yapılınca yol açılıyor.
       (Bu davranış UI'da da böyle etiketlendi.) */
    ['İzin öncesi dinlenme boşluğu (yedek yol)',
        function (p) { p.preLeaveDaysBefore = 99; p.preLeaveDaysBeforeFallback = 99; p.preLeaveGap = 1; },
        function (p) { p.preLeaveDaysBefore = 99; p.preLeaveDaysBeforeFallback = 99; p.preLeaveGap = 4; },
        function (r) { return izgaraImza(r); }, '≠', { izin: 1 }],
    /* Bayrak yalnız izin öncesi KİLİTLİ günler varken iş yapar; nöbet
       konamayan (mesafeler ulaşılmaz) + geniş boşluk kurulumu bunu üretir. */
    ['Saat hedefi izin boşluğundan önce',
        function (p) { p.preLeaveDaysBefore = 99; p.preLeaveDaysBeforeFallback = 99; p.preLeaveGap = 6; },
        function (p) { p.preLeaveDaysBefore = 99; p.preLeaveDaysBeforeFallback = 99; p.preLeaveGap = 6; p.hoursBeforePreLeaveGap = false; },
        function (r) { return izgaraImza(r); }, '≠', { izinAlt: 1 }],
    /* NOT: "boş günler toplu + geniş boş blok" ile dar çalışma tavanı aynı
       günleri paylaştığı için ÇELİŞİR; o bileşimde motor saat hedefini tavana
       tercih eder ve tavan aşılır (ayar denetimi bunu üretimden önce uyarır).
       Burada tavanın tek başına bağlayıcı olduğu düzen sınanıyor. */
    ['Üst üste en fazla çalışma', function (p) { p.daytimeMin = 3; p.maxConsecutiveWork = 0; },
        function (p) { p.daytimeMin = 3; p.maxConsecutiveWork = 3; },
        function (r) { return enUzunCalisma(r); }, '↓', { n: 16 }],
    // 1 matematiksel olarak imkansiz; 2 ulasilabilir bir tavan
    ['Hafta sonu nöbeti üst sınırı', Y, function (p) { p.maxWeekendDuties = 2; },
        function (r) { return enCokHaftaSonu(r); }, '↓'],
    ['Üst üste boş iş günü sınırı', Y, function (p) { p.maxConsecutiveOff = 1; },
        function (r) { return izgaraImza(r); }, '≠'],
    ['Üst üste boş takvim günü sınırı', Y, function (p) { p.maxAbsentDays = 3; },
        function (r) { return enUzunBosluk(r); }, '↓', { n: 12 }],
    ['Boş gün düzeni = toplu', Y, function (p) { p.idleStyle = 'toplu'; },
        function (r) { return bosBlokOrt(r); }, '↑'],
    // dengesizligin olustugu dar senaryo
    ['Denge: hafta sonu', function (p) { p.weightWeekend = 0.4; }, function (p) { p.weightWeekend = 6; },
        function (r) { return sapmaHaftaSonu(r); }, '↓', { n: 12, izin: 1 }],
    ['Denge: toplam nöbet',
        function (p) { p.weightDuty = 0.2; p.weightSpread = 6; p.weightIdle = 6; },
        function (p) { p.weightDuty = 10; p.weightSpread = 6; p.weightIdle = 6; },
        function (r) { return sapmaNobet(r); }, '↓', { n: 11, izin: 1 }],
    ['Denge: nöbetleri yayma', Y, function (p) { p.weightSpread = 6; },
        function (r) { return izgaraImza(r); }, '≠'],
    ['Denge: uzun boşluktan kaçınma', Y, function (p) { p.weightIdle = 6; },
        function (r) { return izgaraImza(r); }, '≠'],
    ['Denge: çalışma düzeni', Y, function (p) { p.weightRhythm = 6; },
        function (r) { return izgaraImza(r); }, '≠'],
    // celisen istekleri olan kadro gerekiyor (bos gun istegi + tur istegi ayni gun)
    ['Öncelik sırası', Y, function (p) { p.priorityOrder = ['offReq', 'pref', 'leave', 'offDay', 'startNI', 'preLeave']; },
        function (r) { return izgaraImza(r); }, '≠', { celiski: 1 }],
];

var gecti = 0, dustu = 0, satir = [];
TESTLER.forEach(function (t) {
    var ad = t[0], temel = t[1], mut = t[2], olc = t[3], yon = t[4], ek = t[5] || {};
    var pt = S.defaultProfile(); temel(pt);
    var pv = S.defaultProfile(); mut(pv);            // ölçüt bazen profile bakıyor
    var a = uret(temel, ek), b = uret(mut, ek);
    var va = olc(a, pt), vb = olc(b, pv);
    var ok;
    if (yon === '↑') ok = vb > va;
    else if (yon === '↓') ok = vb < va;
    else ok = String(va) !== String(vb);
    var goster = function (v) { return typeof v === 'number' ? v.toFixed(2) : (String(v).length > 12 ? '(ızgara)' : String(v)); };
    satir.push({ ad: ad, yon: yon, once: goster(va), sonra: goster(vb), ok: ok });
    if (ok) gecti++; else dustu++;
});

console.log('AYAR DENETİMİ — her ayar motora geçiyor mu?\n');
console.log('  ' + 'AYAR'.padEnd(36) + 'YÖN  ÖNCE      SONRA     SONUÇ');
satir.forEach(function (s) {
    console.log('  ' + s.ad.padEnd(36) + s.yon + '    ' + s.once.padEnd(10) + s.sonra.padEnd(10) + (s.ok ? '✓ işliyor' : '✗ ETKİSİZ'));
});
console.log('\n  ' + gecti + ' ayar işliyor, ' + dustu + ' etkisiz.');
process.exit(dustu ? 1 : 0);
