/* KAPSAMA STRES TESTI — motor gunde gereken nobetci sayisini ne zaman tutturamiyor? */
const S=require('./asistan-scheduler.js');
function lcg(s){let x=s>>>0;return()=>{x=(x*1664525+1013904223)>>>0;return x/4294967296;};}
const senaryolar=[];
let id=0;
[[6,1],[8,1],[8,2],[10,2],[12,2],[14,2],[16,3],[9,2],[7,2],[11,3]].forEach(([n,nb])=>{
 [0,1,2,3].forEach(yg=>{
  [[2026,0],[2026,1],[2026,8]].forEach(ay=>{
   const rnd=lcg(4000+(id++)); const gun=new Date(ay[0],ay[1]+1,0).getDate();
   const p=[]; for(let i=1;i<=n;i++)p.push({name:'P'+i});
   p[0].noNobet=true;
   const izinli = yg===0?0 : yg===1?1 : yg===2?Math.round(n*0.25) : Math.round(n*0.4);
   for(let k=0;k<izinli;k++){ const kk=p[1+((rnd()*(n-1))|0)];
     const bas=1+((rnd()*(gun-10))|0), boy=5+((rnd()*10)|0); const e=[];
     for(let q=0;q<boy;q++) if(bas+q<=gun) e.push(bas+q);
     kk.leaveYI=(kk.leaveYI||[]).concat(e); }
   if(yg===3) for(let k=0;k<Math.max(2,Math.round(n*0.3));k++){ const kk=p[1+((rnd()*(n-1))|0)];
     kk.offReq=(kk.offReq||[]).concat([1+((rnd()*gun)|0),1+((rnd()*gun)|0)]); }
   const pr=S.defaultProfile();
   pr.oncallPerDay=nb; pr.oncallMax=nb; pr.weekendOncallPerDay=nb; pr.weekendOncallMax=nb;
   senaryolar.push({ad:n+' kisi · '+nb+' nobetci · izin'+yg+' · '+ay[0]+'-'+(ay[1]+1),
     cfg:{year:ay[0],month:ay[1],holidays:[],personnel:p,profile:pr}, n, nb, yg});
  });
 });
});
let ihlalOrnek=0, toplamIhlalGun=0, yapisalMumkunsuz=0, liste=[];
senaryolar.forEach(s=>{
  const r=S.buildSchedule(s.cfg);
  // gun basina gercek nobetci sayisi
  let ihlal=0, en=null;
  for(let d=1;d<=r.nDays;d++){
    let c=0; r.totals.forEach(t=>{const x=r.grid[t.name][d]; if(x==='NL'||x==='NS')c++;});
    if(c<s.nb){ ihlal++; if(en===null)en=d+':'+c+'/'+s.nb; }
  }
  // yapisal siniri kabaca olc: nobet tutabilecek kisi sayisi
  const nobetci=s.n-1;
  const yapisal = nobetci < s.nb*2;   // dinlenme yuzunden en az 2 kat kisi gerekir
  if(ihlal){ ihlalOrnek++; toplamIhlalGun+=ihlal; if(yapisal)yapisalMumkunsuz++;
    liste.push('  '+s.ad.padEnd(38)+ihlal+' gun eksik (ilk: '+en+')'+(yapisal?'  [yapisal sinir]':'')); }
});
console.log('KAPSAMA STRES — '+senaryolar.length+' senaryo');
console.log('  kapsama eksigi olan ornek : '+ihlalOrnek);
console.log('  toplam eksik gun          : '+toplamIhlalGun);
console.log('  bunlardan yapisal sinir   : '+yapisalMumkunsuz);
if(liste.length) console.log('\n'+liste.slice(0,25).join('\n'));
