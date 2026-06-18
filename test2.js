const S = require('./scheduler.js');
const names = ['Yahya','Burcu','Cem','Gamze','Merve','Tuğba','Nurşen','Onur','Ayşe','Mehmet','Selin','Kaan','Derya','Emre'];
// Gerçekçi ay: Yahya sorumlu, Onur Perşembe izinli, Merve 5 gün yıllık izin. Tuğba normal çalışıyor.
const cfg = {
  year: 2026, month: 6,
  personnel: names.map(n => ({ name: n, noNobet: n==='Yahya', noThursday: n==='Onur' })),
  holidays: []
};
cfg.personnel[4].leaveYI = [13,14,15,16,17];
const r = S.buildSchedule(cfg);
console.log('GERÇEKÇİ Temmuz 2026 — uyarı sayısı:', r.warnings.length);
r.warnings.forEach(w=>console.log(' - '+w));
const overtime = r.totals.filter(t=>t.fark>0);
console.log('Fazla mesai olan:', overtime.length);
console.log('Nöbet dağılımı:', r.totals.map(t=>t.name+':'+(t.n24+t.n16)).join('  '));

// ikinci senaryo: Ağustos 2026 + resmi tatil + 2 kişi izinli
const cfg2 = {
  year:2026, month:7,
  personnel: names.map(n=>({name:n, noNobet:n==='Yahya', noThursday:n==='Onur'})),
  holidays:[30] // 30 Ağustos Zafer Bayramı
};
cfg2.personnel[2].leaveYI=[3,4,5,6,7];   // Cem
cfg2.personnel[9].leaveUI=[20,21];        // Mehmet ücretsiz
const r2 = S.buildSchedule(cfg2);
console.log('\nAĞUSTOS 2026 (30 R.T, 2 izin) — uyarı sayısı:', r2.warnings.length);
r2.warnings.forEach(w=>console.log(' - '+w));
console.log('Fazla mesai olan:', r2.totals.filter(t=>t.fark>0).length);
console.log('Eksik olan:', r2.totals.filter(t=>t.fark<0).map(t=>t.name+' '+t.fark).join(', ')||'yok');
