const S = require('./scheduler.js');
const names = ['Yahya','Burcu','Cem','Gamze','Merve','Tuğba','Nurşen','Onur','Ayşe','Mehmet','Selin','Kaan','Derya','Emre'];
const cfg = {
  year: 2026, month: 6,
  personnel: names.map(n => ({ name: n, noNobet: n==='Yahya', noThursday: n === 'Onur' })),
  holidays: []
};
cfg.personnel[5].leaveUI = [...Array(31).keys()].map(i=>i+1); // Tuğba ay boyu ücretsiz
cfg.personnel[4].leaveYI = [6,7,8,9,10];                      // Merve yıllık izin

function longestAbsent(grid, days){
  const wd = days.filter(d=>d.workday).map(d=>d.day);
  let best=0,run=0;
  wd.forEach(d=>{const c=grid[d]; if(c==='M'||c==='N24'||c==='N16') run=0; else {run++; if(run>best)best=run;}});
  return best;
}

const r = S.buildSchedule(cfg);
console.log('Temmuz 2026  (Yahya=sorumlu, Onur=Perşembe izinli)\n');
console.log('KİŞİ          HEDEF  TOPLAM  FARK  M   N24 N16 NI  HSn  maxBoşSeri');
r.totals.forEach(t=>{
  const maxA = longestAbsent(r.grid[t.name], r.days);
  console.log(
    t.name.padEnd(13), String(t.target).padStart(4), String(t.hours).padStart(6),
    String(t.fark).padStart(5), String(t.mesai).padStart(3), String(t.n24).padStart(3),
    String(t.n16).padStart(3), String(t.ni).padStart(3), String(t.weekendNobet).padStart(4),
    String(maxA).padStart(6));
});
console.log('\nYahya nöbet sayısı (0 olmalı):', r.totals[0].n24 + r.totals[0].n16);
console.log('\nUYARILAR ('+r.warnings.length+'):');
r.warnings.slice(0,40).forEach(w=>console.log(' - '+w));
