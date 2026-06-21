const A=require('./asistan-scheduler.js');   // asistan motoru
const S=require('./scheduler.js');           // anestezi motoru (referans)
function rng(seed){let s=seed>>>0; return ()=>{s=(s*1664525+1013904223)>>>0; return s/4294967296;};}

// Bir sonucu hata türlerine ayır
function classify(r){
  let ot=0,otPpl=0,cluster=0,daygap=0,covgap=0,undertime=0;
  (r.warnings||[]).forEach(w=>{
    if(w[0]==='💡')return;
    let m;
    if(m=w.match(/FAZLA MESAİ (\d+)/)){ot+=+m[1];otPpl++;}
    else if(/üst üste izinli/.test(w))cluster++;
    else if(/gündüzde \d+ kişi/.test(w))daygap++;
    else if(/sadece \d+ nöbetçi/.test(w))covgap++;
    else if(/EKSİK/.test(w))undertime++;
  });
  return {ot,otPpl,cluster,daygap,covgap,undertime, clean:(ot+cluster+daygap+covgap+undertime)===0};
}
function makeCfg(seed){
  const r=rng(seed);
  const N=8+Math.floor(r()*7);                 // 8..14
  const month=Math.floor(r()*12);
  // izin yoğunluğu: 0..4 kişi, 4..10 gün, başlangıç rastgele
  const nleave=Math.floor(r()*5);
  const persons=Array.from({length:N},(_,i)=>({name:'P'+i, noNobet:i===0}));
  let leaveDays=0, endLoad=0;
  for(let k=0;k<nleave;k++){ const who=1+Math.floor(r()*(N-1)); const st=1+Math.floor(r()*22), len=4+Math.floor(r()*7);
    const days=Array.from({length:len},(_,j)=>st+j).filter(x=>x<=28); persons[who].leaveYI=days; leaveDays+=days.length;
    if(st>=18)endLoad+=days.length; }
  return {N,month,nleave,leaveDays,endLoad, persons};
}
function bucketN(N){ return N<=9?'düşük(8-9)':N<=11?'orta(10-11)':'bol(12-14)'; }
function bucketLeave(d){ return d<=6?'az':d<=15?'orta':'yoğun'; }

const RUNS=160;
const stat={}; // key -> {n, clean, ot, otHours, cluster, daygap, covgap}
function add(key,c){ const s=stat[key]||(stat[key]={n:0,clean:0,ot:0,otH:0,cl:0,dg:0,cg:0,ut:0}); s.n++; if(c.clean)s.clean++; if(c.otPpl)s.ot++; s.otH+=c.ot; if(c.cluster)s.cl++; if(c.daygap)s.dg++; if(c.covgap)s.cg++; if(c.undertime)s.ut++; }

let hardSeeds=[];
for(let seed=1;seed<=RUNS;seed++){
  const m=makeCfg(seed);
  const cfgA={year:2026,month:m.month,holidays:[],profile:A.defaultProfile(),personnel:m.persons.map(p=>({...p}))};
  const cfgS={year:2026,month:m.month,holidays:[],personnel:m.persons.map(p=>({...p}))};
  let rA,rS; try{rA=A.buildSchedule(cfgA);}catch(e){console.log('ASISTAN CRASH',seed,e.message);continue;}
  try{rS=S.buildSchedule(cfgS);}catch(e){rS=null;}
  const cA=classify(rA);
  add('ASISTAN|'+bucketN(m.N),cA); add('ASISTAN|'+bucketLeave(m.leaveDays),cA);
  if(rS){const cS=classify(rS); add('ANESTEZI|'+bucketN(m.N),cS); add('ANESTEZI|'+bucketLeave(m.leaveDays),cS);}
  if(!cA.clean && hardSeeds.length<8) hardSeeds.push({seed,N:m.N,leave:m.leaveDays,endLoad:m.endLoad,err:cA});
}
function pct(a,b){return (100*a/b).toFixed(0)+'%';}
function show(prefix){
  console.log('\n=== '+prefix+' ===');
  ['düşük(8-9)','orta(10-11)','bol(12-14)','az','orta','yoğun'].forEach(b=>{
    const s=stat[prefix+'|'+b]; if(!s)return;
    console.log(b.padEnd(12), 'n='+String(s.n).padStart(4),
      'temiz '+pct(s.clean,s.n).padStart(4),
      '| overtime '+pct(s.ot,s.n).padStart(4)+' (ort '+(s.otH/s.n).toFixed(0)+'s)',
      '| küme '+pct(s.cl,s.n).padStart(4),
      '| gündüz '+pct(s.dg,s.n).padStart(4),
      '| KAPSAMA-EKSİK '+s.cg,
      '| eksik-saat '+s.ut);
  });
}
console.log('Toplam senaryo:',RUNS,'(8-14 kişi, 0-4 kişi izinli, rastgele ay)');
show('ANESTEZI'); show('ASISTAN');
console.log('\nZor (asistan hatalı) örnek senaryolar:');
hardSeeds.forEach(h=>console.log('  seed',h.seed,'N='+h.N,'izin='+h.leave,'aysonu='+h.endLoad,'->',JSON.stringify(h.err)));
