/* =====================================================================
   NÖBET PLANLAMA ASİSTANI — OTOMATİK REGRESYON TESTLERİ
   ---------------------------------------------------------------------
   Çalıştır:  node test-asistan.js
   Amaç: motorun DEĞİŞMEZ kurallarını (invariant) ve senaryolarını her
   değişiklikten sonra doğrulamak. Bir test düşerse çıkış kodu 1 olur
   (GitHub Actions CI kırmızı yanar).
   ===================================================================== */
'use strict';
var S = require('./asistan-scheduler.js');

var pass = 0, fail = 0, fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(msg); console.log('  ✗ ' + msg); } }
function section(t) { console.log('\n== ' + t + ' =='); }

// --- yardımcılar ---
var Y = 2026, M = 6;                                   // Temmuz 2026
function isWeekend(d) { var w = new Date(Y, M, d).getDay(); return w === 0 || w === 6; }
function people(n, extra) { var a = []; for (var i = 1; i <= n; i++) { var p = { name: 'P' + i }; if (extra && extra[i]) Object.assign(p, extra[i]); a.push(p); } return a; }
function run(cfg) { return S.buildSchedule(Object.assign({ year: Y, month: M, holidays: [], profile: S.defaultProfile() }, cfg)); }
function isOncall(c) { return c === 'NL' || c === 'NS'; }
function nDaysOf(r) { return r.nDays; }
function warnCount(r) { return (r.warnings || []).filter(function (w) { return w.indexOf('💡') !== 0; }).length; }

// === INVARIANT: her sonuçta uyulması ZORUNLU kurallar ===
function checkInvariants(r, P, label) {
  P = P || S.defaultProfile();
  var nD = nDaysOf(r), grid = r.grid, names = r.totals.map(function (t) { return t.name; });
  // 1) KAPSAMA: her gün en az min nöbetçi
  for (var d = 1; d <= nD; d++) {
    var need = isWeekend(d) ? P.weekendOncallPerDay : P.oncallPerDay;
    var cnt = 0; names.forEach(function (n) { if (isOncall(grid[n][d])) cnt++; });
    ok(cnt >= need, label + ': ' + d + '. gün kapsama ' + cnt + ' < ' + need);
  }
  // 2) DİNLENME: nöbet ertesi gün nöbet YOK (ardışık nöbet olmaz)
  names.forEach(function (n) { for (var d = 1; d < nD; d++) { if (isOncall(grid[n][d]) && isOncall(grid[n][d + 1])) ok(false, label + ': ' + n + ' ardışık nöbet ' + d + '-' + (d + 1)); } });
  // 3) NÖBETÇİ ARALIĞI: max aşılmaz
  for (var d2 = 1; d2 <= nD; d2++) {
    var mx = isWeekend(d2) ? (P.weekendOncallMax || P.weekendOncallPerDay) : (P.oncallMax || P.oncallPerDay);
    var c2 = 0; names.forEach(function (n) { if (isOncall(grid[n][d2])) c2++; });
    ok(c2 <= mx, label + ': ' + d2 + '. gün nöbetçi ' + c2 + ' > max ' + mx);
  }
}

// ---------------------------------------------------------------
section('Fizibilite: N=12..14 tam kadro, 0 uyarı + invariant');
[12, 13, 14].forEach(function (n) {
  var r = run({ personnel: people(n), __attempts: 40, __lsIter: 4000 });
  ok(warnCount(r) === 0, 'N=' + n + ' 0 uyarı bekleniyordu, ' + warnCount(r) + ' çıktı');
  checkInvariants(r, null, 'N=' + n);
  ok((r.alternatives || []).length >= 1, 'N=' + n + ' alternatif üretilmeli');
});

section('Fazla mesai: tam kadroda kimse hedefi aşmaz (overtimeForCounts kapalı)');
[12, 13, 14].forEach(function (n) {
  var r = run({ personnel: people(n), __attempts: 40, __lsIter: 4000 });
  var over = r.totals.filter(function (t) { return t.fark > 0; });
  ok(over.length === 0, 'N=' + n + ' fazla mesai olmamalı, olan: ' + over.map(function (t) { return t.name + '+' + t.fark; }).join(','));
});

section('Sadece nöbet (onlyNobet): hiç mesai yok');
(function () {
  var r = run({ personnel: people(13, { 1: { onlyNobet: true } }), __attempts: 20, __lsIter: 2000 });
  var t = r.totals.find(function (x) { return x.name === 'P1'; });
  ok(t.mesai === 0, 'onlyNobet kişide mesai=0 olmalı, ' + t.mesai);
  ok((t.nl + t.ns) > 0, 'onlyNobet kişi nöbet almalı');
})();

section('Sadece gündüz (dayOnly): nöbet yok AMA gündüz sayısına DAHİL');
(function () {
  var r = run({ personnel: people(13, { 1: { dayOnly: true } }), __attempts: 20, __lsIter: 2000 });
  var t = r.totals.find(function (x) { return x.name === 'P1'; });
  ok((t.nl + t.ns) === 0, 'dayOnly nöbet=0 olmalı');
  ok(t.noNobet === false, 'dayOnly sayıya DAHİL olmalı (noNobet=false)');
  ok(t.mesai > 0, 'dayOnly gündüz mesaisi yapmalı');
})();

section('Sorumlu (noNobet): nöbet yok ve gündüz sayısına DAHİL DEĞİL');
(function () {
  var r = run({ personnel: people(13, { 1: { noNobet: true } }), __attempts: 20, __lsIter: 2000 });
  var t = r.totals.find(function (x) { return x.name === 'P1'; });
  ok((t.nl + t.ns) === 0, 'Sorumlu nöbet=0 olmalı');
  ok(t.noNobet === true, 'Sorumlu sayıya DAHİL OLMAMALI (noNobet=true)');
})();

section('Yıllık izin dönüşü: ilk iş günü çalışır, aradaki hafta sonu boş');
(function () {
  // izin 6-10 Tem (10 = Cuma); dönüş 13 Pzt çalışmalı, 11-12 h.sonu boş
  var r = run({ personnel: people(13, { 1: { leaveYI: [6, 7, 8, 9, 10] } }), __attempts: 20, __lsIter: 2000 });
  var g = r.grid['P1'];
  ok(g[10] === 'YI', 'izin son günü YI');
  var work = function (c) { return c === 'M' || isOncall(c); };
  ok(work(g[13]), 'dönüş (13 Pzt) çalışma olmalı, ' + g[13]);
  ok(!work(g[11]) && !work(g[12]), 'aradaki hafta sonu (11-12) çalışma olmamalı');
})();

section('Hafta sonu nöbet tipi: weekendOncall bağımsız');
(function () {
  var P1 = S.defaultProfile(); P1.defaultOncall = 'long'; P1.weekendOncall = 'short'; P1.useShortOncall = true;
  var r = run({ profile: P1, personnel: people(13), __attempts: 30, __lsIter: 3000 });
  var wkNS = 0, wkNL = 0; r.totals.forEach(function (t) { [4, 5, 11, 12].forEach(function (d) { var c = r.grid[t.name][d]; if (c === 'NS') wkNS++; else if (c === 'NL') wkNL++; }); });
  ok(wkNL === 0 && wkNS > 0, 'hafta sonu short seçilince NL=0/NS>0 olmalı (NL=' + wkNL + ' NS=' + wkNS + ')');
})();

section('Nöbetçi aralığı: hafta sonu "2 veya 3" -> kadro yeterse 3, max aşılmaz');
(function () {
  var P1 = S.defaultProfile(); P1.weekendOncallPerDay = 2; P1.weekendOncallMax = 3;
  var r = run({ profile: P1, personnel: people(14), __attempts: 40, __lsIter: 4000 });
  checkInvariants(r, P1, 'aralık');
  var minW = 99, maxW = 0; [4, 5, 11, 12, 18, 19, 25, 26].forEach(function (d) { var c = 0; r.totals.forEach(function (t) { if (isOncall(r.grid[t.name][d])) c++; }); minW = Math.min(minW, c); maxW = Math.max(maxW, c); });
  ok(minW >= 2, 'hafta sonu min 2 garanti (min=' + minW + ')');
  ok(maxW <= 3, 'hafta sonu max 3 aşılmaz (max=' + maxW + ')');
})();

section('Aylar arası adalet: ağır carry olan kişi bu ay daha az hafta sonu alır');
(function () {
  var wk = [4, 5, 11, 12, 18, 19, 25, 26];
  function wkCnt(r, n) { var s = 0; wk.forEach(function (d) { if (isOncall(r.grid[n][d])) s++; }); return s; }
  var carry = { byName: { P1: { nc: 12, wk: 10 } }, months: 3 };   // P1 önceki aylarda çok hafta sonu tuttu
  var r = run({ personnel: people(13), __attempts: 50, __lsIter: 5000, carry: carry });
  var p1 = wkCnt(r, 'P1'); var others = 0; for (var i = 2; i <= 13; i++) others += wkCnt(r, 'P' + i); var oavg = others / 12;
  ok(p1 < oavg, 'ağır carry olan P1 hafta sonu diğerlerinin ortalamasından AZ olmalı (P1=' + p1 + ' ort=' + oavg.toFixed(2) + ')');
})();

section('Boş gün isteği: o günlerde ne nöbet ne mesai');
(function () {
  var r = run({ personnel: people(13, { 1: { offReq: [10, 15] } }), __attempts: 20, __lsIter: 2000 });
  var g = r.grid['P1'];
  var busy = function (c) { return c === 'M' || isOncall(c); };
  ok(!busy(g[10]) && !busy(g[15]), 'boş gün isteği (10,15) çalışma olmamalı');
})();

section('Çalışma tercihi önceliği: uzun nöbet isteği o günlerde nöbete önceler');
(function () {
  var wd = [1, 2, 3, 7, 8, 9, 10, 14];
  function hits(pref) {
    var ppl = people(13); if (pref) ppl[0].onlyN24 = wd;
    var r = S.buildSchedule({ year: Y, month: M, holidays: [], profile: S.defaultProfile(), personnel: ppl, __attempts: 40, __lsIter: 4000 });
    var h = 0; wd.forEach(function (d) { if (r.grid['P1'][d] === 'NL') h++; }); return h;
  }
  var base = hits(false), withPref = hits(true);
  ok(withPref > base, 'uzun nöbet isteği verilince istenen günlerde NL artmalı (önce ' + base + ' sonra ' + withPref + ')');
})();

section('Kısa nöbet isteği VARSAYILAN UZUN profilde bile yazılır (fiilen yerleştirilir)');
(function () {
  // default profil uzun; istenen günlerde NS çıkmalı, NL asla, fazla mesai yok
  var req = [1, 3, 8]; // ardışık olmayan iş günleri (dinlenme çakışmasın)
  var r = S.buildSchedule({ year: Y, month: M, holidays: [], profile: S.defaultProfile(), personnel: people(13, { 1: { onlyN16: req } }), __attempts: 40, __lsIter: 4000 });
  var g = r.grid['P1'], ns = 0, nl = 0;
  req.forEach(function (d) { if (g[d] === 'NS') ns++; else if (g[d] === 'NL') nl++; });
  ok(ns >= 2, 'kısa nöbet isteği günlerinde NS yazılmalı (' + ns + '/' + req.length + ')');
  ok(nl === 0, 'kısa nöbet isteği gününde NL olmamalı (' + nl + ')');
  var ot = r.totals.filter(function (t) { return t.fark > 0; }).length;
  ok(ot === 0, 'kısa nöbet isteği fazla mesai yaratmamalı');
})();

section('Çalışma tercihi HER ZAMAN öncelikli: kısa istek, genel "Kısa nöbet" kapalı olsa bile yazılır');
(function () {
  var P = S.defaultProfile(); P.useShortOncall = false;   // genel kısa kapalı ama kişi açıkça kısa istiyor
  var r = S.buildSchedule({ year: Y, month: M, holidays: [], profile: P, personnel: people(13, { 1: { onlyN16: [8] } }), __attempts: 20, __lsIter: 2000 });
  ok(r.grid['P1'][8] === 'NS', 'genel kısa kapalı olsa bile istenen günde kısa nöbet (NS) yazılmalı, çıkan: ' + r.grid['P1'][8]);
})();
section('Karşılanamayan istek (ardışık gün) için bilgi notu üretilir');
(function () {
  var r = S.buildSchedule({ year: Y, month: M, holidays: [], profile: S.defaultProfile(), personnel: people(13, { 1: { onlyN16: [1, 2, 3] } }), __attempts: 30, __lsIter: 3000 });
  var note = (r.warnings || []).filter(function (w) { return w.indexOf('💡') === 0 && /uygulanamadı/.test(w) && /P1/.test(w); });
  ok(note.length >= 1, 'ardışık gün isteğinde (biri dinlenmeye denk) bilgi notu çıkmalı');
})();

section('Nöbet isteği izin-öncesi nöbetleri YENER (gün dolu olsa da istek yerleşir)');
(function () {
  // P2/P3/P4 izinleri -> izin-öncesi nöbetler 6. güne yığılır; ALİ 6'ya kısa istek
  var ppl = people(13, { 1: { onlyN16: [6] }, 2: { leaveYI: [10, 11, 12, 13, 14] }, 3: { leaveYI: [9, 10, 11, 12, 13] }, 4: { leaveYI: [10, 11, 12, 13, 14] } });
  ppl[0].name = 'ALI';
  var r = S.buildSchedule({ year: Y, month: M, holidays: [], profile: S.defaultProfile(), personnel: ppl, __attempts: 40, __lsIter: 4000 });
  ok(r.grid['ALI'][6] === 'NS', 'izin-öncesi baskısına rağmen istenen kısa nöbet 6. güne yazılmalı, çıkan: ' + r.grid['ALI'][6]);
  var c6 = 0; r.totals.forEach(function (t) { var c = r.grid[t.name][6]; if (c === 'NL' || c === 'NS') c6++; });
  ok(c6 <= 2, '6. gün nöbetçi max aşılmamalı (' + c6 + ')');
})();

section('Gün aşırı yayılım: kimse uzun gün-aşırı zinciri çalışmaz (istek yokken)');
(function () {
  var r = S.buildSchedule({ year: Y, month: M, holidays: [], profile: S.defaultProfile(), personnel: people(13), __attempts: 40, __lsIter: 4000 });
  var worst = 0;
  r.totals.forEach(function (t) { var on = []; for (var d = 1; d <= r.nDays; d++) { var c = r.grid[t.name][d]; if (c === 'NL' || c === 'NS') on.push(d); }
    var run = 1, mx = 1; for (var i = 1; i < on.length; i++) { if (on[i] - on[i - 1] === 2) { run++; if (run > mx) mx = run; } else run = 1; } if (mx > worst) worst = mx; });
  ok(worst <= 3, 'en uzun gün-aşırı zinciri <=3 olmalı (çıkan ' + worst + ')');
})();

// ---------------------------------------------------------------
console.log('\n──────────────────────────────');
console.log('SONUÇ: ' + pass + ' geçti, ' + fail + ' düştü.');
if (fail) { console.log('DÜŞENLER:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('✓ Tüm testler geçti.');
