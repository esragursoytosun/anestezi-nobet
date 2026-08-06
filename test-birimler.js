/* =====================================================================
   ÇOK BİRİMLİ KALİTE TAKIMI
   ---------------------------------------------------------------------
   Motoru YALNIZ anestezi varsayılanıyla ölçmek yanıltıcıydı: her birimin
   kural profili, kadro büyüklüğü ve nöbet düzeni farklı. Burada 10 ayrı
   birim profili × 5 ay × değişen kadro/izin yoğunluğu denenir.

   Ölçülenler (hepsi birim profiline GÖRE):
     • kural ihlali (uyarı) sayısı
     • adalet: nöbet ve hafta sonu, adil paydan sapma
     • nöbet şekli ihlali: profilin hafta içi/hafta sonu için belirlediği
       türün dışında nöbet yazılmış mı
     • boş gün yapısı: blok uzunluğu (dağıtık/toplu tercihine göre)
     • eksik saat: hedefi dolduramamış kişi

   Kullanım:  node test-birimler.js            (özet)
              DETAY=1 node test-birimler.js    (uyarılı ayları listeler)
              MOTOR=<yol> node test-birimler.js  (başka sürümle karşılaştır)
   ===================================================================== */
'use strict';
var S = require(process.env.MOTOR || './asistan-scheduler.js');

function lcg(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ---- BİRİM PROFİLLERİ: gerçek hayatta karşılaşılan düzenler ---- */
function birimler() {
  var d = S.defaultProfile;
  return [
    { ad: 'Anestezi (varsayılan)', kadro: [12, 14, 18], prof: {} },
    { ad: 'Küçük birim · 1 nöbetçi', kadro: [6, 8, 10],
      prof: { oncallPerDay: 1, oncallMax: 1, weekendOncallPerDay: 1, weekendOncallMax: 1, daytimeMin: 1, daytimeExtraDays: [] } },
    { ad: 'Büyük birim · 3 nöbetçi', kadro: [20, 24],
      prof: { oncallPerDay: 3, oncallMax: 3, weekendOncallPerDay: 3, weekendOncallMax: 3, daytimeMin: 4, daytimeExtra: 5 } },
    { ad: 'Yalnız 16s akşam nöbeti', kadro: [10, 12, 14],
      prof: { defaultOncall: 'short', weekendOncall: 'short' } },
    { ad: 'Yalnız 24s (kısa kapalı)', kadro: [12, 14],
      prof: { useShortOncall: false } },
    { ad: 'Hafta içi kısa · h.sonu uzun', kadro: [12, 14],
      prof: { defaultOncall: 'short', weekendOncall: 'long' } },
    { ad: 'Nöbetçi aralıklı (2-3)', kadro: [14, 16],
      prof: { oncallPerDay: 2, oncallMax: 3, weekendOncallPerDay: 2, weekendOncallMax: 3 } },
    { ad: 'Kıdem kurallı', kadro: [14, 16],
      prof: { minSeniorOncall: 1, minSeniorDaytime: 1 } },
    { ad: 'Uzun dinlenme (2 gün)', kadro: [14, 18],
      prof: { postOncallRest: 2, maxConsecutiveOff: 4, maxAbsentDays: 6 } },
    { ad: '7 saatlik hedef · izin öncesi kapalı', kadro: [12, 14],
      prof: { targetPerWorkday: 7, preLeaveOncall: false } },
  ];
}

function ornekler() {
  var L = [], id = 0;
  var aylar = [[2026, 0], [2026, 1], [2026, 3], [2026, 8], [2026, 10]];
  birimler().forEach(function (b) {
    b.kadro.forEach(function (n) {
      aylar.forEach(function (ay, ai) {
        var yg = ai % 3;                      // izin yoğunluğu: yok / orta / ağır
        var rnd = lcg(7000 + (id++));
        var gun = new Date(ay[0], ay[1] + 1, 0).getDate();
        var kisiler = [];
        for (var i = 1; i <= n; i++) kisiler.push({ name: 'P' + i });
        kisiler[0].noNobet = true;                                  // sorumlu
        if (n >= 12) kisiler[1].senior = true;
        if (n >= 12) kisiler[2].senior = true;
        if (n >= 14) kisiler[3].senior = true;
        var izinli = yg === 0 ? 0 : yg === 1 ? Math.max(1, Math.round(n * 0.12)) : Math.max(2, Math.round(n * 0.25));
        for (var k = 0; k < izinli; k++) {
          var kisi = kisiler[1 + ((rnd() * (n - 1)) | 0)];
          var bas = 1 + ((rnd() * (gun - 8)) | 0), boy = 4 + ((rnd() * 8) | 0);
          var ek = [];
          for (var q = 0; q < boy; q++) if (bas + q <= gun) ek.push(bas + q);
          kisi.leaveYI = (kisi.leaveYI || []).concat(ek);
        }
        if (n >= 10) { kisiler[n - 1].offDay = 4; kisiler[n - 2].offDay = 1; }
        var prof = S.defaultProfile();
        for (var kk in b.prof) prof[kk] = b.prof[kk];
        prof.name = b.ad;
        L.push({ ad: b.ad + ' · ' + n + ' kişi · ' + ay[0] + '-' + (ay[1] + 1) + ' · izin' + yg,
          birim: b.ad,
          cfg: { year: ay[0], month: ay[1], holidays: [], personnel: kisiler, profile: prof } });
      });
    });
  });
  return L;
}

var CAL = function (c) { return c === 'M' || c === 'NL' || c === 'NS'; };

function olc(r, prof) {
  var t = r.totals.filter(function (x) { return !x.noNobet; });
  var sumW = t.reduce(function (a, x) { return a + (x.target || 1); }, 0) || 1;
  var totNc = t.reduce(function (a, x) { return a + x.nl + x.ns; }, 0);
  var totWk = t.reduce(function (a, x) { return a + x.weekendNobet; }, 0);
  var sapNc = 0, sapWk = 0;
  t.forEach(function (x) { var pay = (x.target || 1) / sumW;
    sapNc = Math.max(sapNc, Math.abs((x.nl + x.ns) - totNc * pay));
    sapWk = Math.max(sapWk, Math.abs(x.weekendNobet - totWk * pay)); });

  /* NÖBET ŞEKLİ İHLALİ: profilin o gün için belirlediği tür dışında nöbet.
     İndirgeme (uzun -> kısa) meşru gevşetmedir, sayılmaz; YÜKSELTME sayılır. */
  var kisaAcik = prof.useShortOncall !== false;
  var haftaIci = (prof.defaultOncall === 'short' && kisaAcik) ? 'NS' : 'NL';
  var haftaSonu = (prof.weekendOncall === 'short' && kisaAcik) ? 'NS' : 'NL';
  var UZ = { NL: 24, NS: 16 }, ihlal = 0;
  r.days.forEach(function (d) {
    var ayar = (d.weekend || d.holiday) ? haftaSonu : haftaIci;
    r.totals.forEach(function (x) {
      var c = r.grid[x.name][d.day];
      if (c !== 'NL' && c !== 'NS') return;
      var istek = ((x.onlyN24 || []).indexOf(d.day) >= 0) || ((x.onlyN16 || []).indexOf(d.day) >= 0);
      if (!istek && UZ[c] > UZ[ayar]) ihlal++;      // ayarlıdan UZUN nöbet yazılmış
    });
  });

  var sert = (r.warnings || []).filter(function (w) { return w.indexOf('💡') !== 0; });
  var blok = 0, bosGun = 0;
  r.totals.filter(function (x) { return !x.noNobet && !x.dayOnly && !x.onlyNobet; }).forEach(function (x) {
    var g = r.grid[x.name], run = 0;
    var bitir = function () { if (run > 0) { blok++; bosGun += run; run = 0; } };
    for (var d = 1; d <= r.nDays; d++) {
      var c = g[d];
      if (CAL(c)) bitir();
      else if (r.days[d - 1].workday && (c === 'NI' || c === 'UCI')) run++;
      else bitir();
    }
    bitir();
  });
  return { sert: sert.length, kapsama: sert.filter(function (w) { return /sadece \d+ nöbetçi/.test(w); }).length,
    eksik: sert.filter(function (w) { return /EKSİK/.test(w); }).length,
    fazla: sert.filter(function (w) { return /FAZLA MESAİ/.test(w); }).length,
    sapNc: sapNc, sapWk: sapWk, sekilIhlal: ihlal, blok: blok, bosGun: bosGun };
}

function calistir() {
  var ex = ornekler(), toplam = {}, birimOzet = {};
  var T = { sert: 0, kapsama: 0, eksik: 0, fazla: 0, sapNc: 0, sapWk: 0, sekilIhlal: 0, blok: 0, bosGun: 0, ms: 0, temiz: 0 };
  var detay = [];
  ex.forEach(function (e) {
    var t0 = Date.now(); var r = S.buildSchedule(e.cfg); var ms = Date.now() - t0;
    var o = olc(r, e.cfg.profile);
    ['sert', 'kapsama', 'eksik', 'fazla', 'sapNc', 'sapWk', 'sekilIhlal', 'blok', 'bosGun'].forEach(function (k) { T[k] += o[k]; });
    T.ms += ms; if (o.sert === 0) T.temiz++;
    if (!birimOzet[e.birim]) birimOzet[e.birim] = { n: 0, sert: 0, sekil: 0, sapWk: 0, kapsama: 0 };
    var b = birimOzet[e.birim]; b.n++; b.sert += o.sert; b.sekil += o.sekilIhlal; b.sapWk += o.sapWk; b.kapsama += o.kapsama;
    detay.push({ ad: e.ad, o: o, ms: ms });
  });
  return { N: ex.length, T: T, birim: birimOzet, detay: detay };
}

module.exports = { calistir: calistir, ornekler: ornekler, birimler: birimler };

if (require.main === module) {
  var r = calistir(), N = r.N, T = r.T;
  console.log('ÇOK BİRİMLİ TAKIM — ' + N + ' örnek (' + Object.keys(r.birim).length + ' birim profili)');
  console.log('  ort. sert uyarı      : ' + (T.sert / N).toFixed(2));
  console.log('  hiç uyarısız ay      : ' + T.temiz + '/' + N);
  console.log('  kapsama ihlali       : ' + T.kapsama + '   (0 olmalı)');
  console.log('  NÖBET ŞEKLİ ihlali   : ' + T.sekilIhlal + '   (0 olmalı)');
  console.log('  EKSİK SAAT uyarısı   : ' + T.eksik + '   (0 olmalı)');
  console.log('  fazla mesai uyarısı  : ' + T.fazla);
  console.log('  adalet sapması       : nöbet ' + (T.sapNc / N).toFixed(3) + ' · hafta sonu ' + (T.sapWk / N).toFixed(3));
  console.log('  boş gün bloğu        : ort ' + (T.bosGun / T.blok).toFixed(2) + ' gün');
  console.log('  ort. süre            : ' + (T.ms / N).toFixed(0) + ' ms');
  console.log('\n  BİRİM BAZINDA (ort uyarı · şekil ihlali · h.sonu sapması):');
  Object.keys(r.birim).forEach(function (k) { var b = r.birim[k];
    console.log('    ' + k.padEnd(38) + (b.sert / b.n).toFixed(2).padStart(6) + '  ' + String(b.sekil).padStart(4) + '  ' + (b.sapWk / b.n).toFixed(2).padStart(6)); });
  if (process.env.DETAY) { console.log('\n  UYARILI ÖRNEKLER:');
    r.detay.filter(function (d) { return d.o.sert > 0; }).forEach(function (d) {
      console.log('    ' + d.ad + ' -> ' + d.o.sert + ' uyarı' + (d.o.kapsama ? ' (kapsama ' + d.o.kapsama + ')' : '')); }); }
}
