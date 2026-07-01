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

section('Aylar arası adalet: carry ile yük kayar');
(function () {
  var wk = [4, 5, 11, 12, 18, 19, 25, 26];
  function wkAvg(r, names) { var s = 0; names.forEach(function (n) { wk.forEach(function (d) { if (isOncall(r.grid[n][d])) s++; }); }); return s / names.length; }
  var A = ['P1', 'P2', 'P3', 'P4', 'P5'];
  var carry = { byName: {}, months: 2 }; A.forEach(function (n) { carry.byName[n] = { nc: 8, wk: 6 }; });
  var r0 = run({ personnel: people(10), __attempts: 50, __lsIter: 5000 });
  var r1 = run({ personnel: people(10), __attempts: 50, __lsIter: 5000, carry: carry });
  ok(wkAvg(r1, A) <= wkAvg(r0, A) + 1e-9, 'carry sonrası A grubu hafta sonu artmamalı (önce ' + wkAvg(r0, A).toFixed(2) + ' sonra ' + wkAvg(r1, A).toFixed(2) + ')');
  ok(wkAvg(r1, A) < wkAvg(r0, A) || wkAvg(r1, A) <= 1.0, 'carry A grubunu hafifletmeli');
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

// ---------------------------------------------------------------
console.log('\n──────────────────────────────');
console.log('SONUÇ: ' + pass + ' geçti, ' + fail + ' düştü.');
if (fail) { console.log('DÜŞENLER:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('✓ Tüm testler geçti.');
