const S=require('./scheduler.js');
const names=['Personel 1','Personel 2','Personel 3','Personel 4','Personel 5','Personel 6','Personel 7','Personel 8','Personel 9','Personel 10','Personel 11','Personel 12','Personel 13','Personel 14'];
const cfg={ year:2026, month:6, holidays:[],
  personnel: names.map((n,i)=>({name:n, noNobet:i===0, offDay:i===1?4:null})) };
cfg.personnel[4].leaveYI=[20,21,22,23,24]; // P5 yıllık izin 20-24 (Pzt-Cum)
const r=S.buildSchedule(cfg);

// boş hücre var mı?
let bos=0; r.totals.forEach(t=>{const g=r.grid[t.name]; r.days.forEach(d=>{if(g[d.day]==='')bos++;});});
console.log('Boş (\'\') hücre sayısı (0 olmalı):', bos);
console.log('Fazla mesai:', r.totals.filter(t=>t.fark>0).length, ' | Uyarı:', r.warnings.length);

console.log('\nKİŞİ          HEDEF TOP FARK  M  N24 N16 NI  UCI  HSn');
r.totals.forEach(t=>console.log(t.name.padEnd(13),String(t.target).padStart(4),String(t.hours).padStart(4),
  String(t.fark).padStart(4),String(t.mesai).padStart(3),String(t.n24).padStart(3),String(t.n16).padStart(3),
  String(t.ni).padStart(3),String(t.uci).padStart(4),String(t.weekendNobet).padStart(4)));

// P5'in yıllık izin öncesi düzeni: 20 Pzt başlıyor. Önceki iş günleri: 19Cum,18Per(P5 offDay? hayır P2),17Çar,16Sal
const g5=r.grid['Personel 5'];
console.log('\nP5 izin öncesi günler (16-19):', [16,17,18,19].map(d=>d+':'+g5[d]).join('  '), '| izin 20-24:', [20,21,22,23,24].map(d=>g5[d]).join(','));
console.log('Beklenti: 19,18 = UCI; 16 = N24 (4. iş günü önce); 17 = NI');

if(r.warnings.length){console.log('\nUYARILAR:'); r.warnings.forEach(w=>console.log(' - '+w));}
