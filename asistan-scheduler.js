/* =====================================================================
   NÖBET PLANLAMA ASİSTANI — PROFİLE GÖRE AYARLANABİLİR MOTOR
   ---------------------------------------------------------------------
   Anestezi scheduler.js'ten BAĞIMSIZ. Tüm "çalışma şartları" bir KURAL
   PROFİLİ'nden okunur (her birim kendi profilini ayarlar). Temel kısımlar
   (mesai, izin türleri, aylık hedef mantığı) ortak; profille değişen:
     - günde kaç nöbetçi (oncallPerDay)
     - nöbet 24s mı 16s mi (defaultOncall, useShortOncall)
     - gündüz minimumu (daytimeMin, ekstra günler)
     - hafta sonu/tatil kuralı (weekendForceLong, weekendOncallPerDay)
     - izin öncesi nöbet/boşluk (preLeave*), nöbet sonrası dinlenme (postOncallRest)
     - üst üste en fazla boş gün (maxConsecutiveOff), aylık hedef (targetPerWorkday)
   Çıktı: { grid, totals, warnings, days, alternatives, ... } (anestezi ile aynı şekil).
   UMD: tarayıcıda window.AsistanScheduler, Node'da module.exports.
   ===================================================================== */
(function (root) {
  'use strict';

  var DOW_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

  // ---- VARSAYILAN PROFİL (Anestezi kuralları) — yeni birim bunu kopyalayıp değiştirir ----
  function defaultProfile() {
    return {
      name: 'Anestezi',
      mesaiHours: 8, mesaiLabel: 'M8-17',                 // gündüz mesai vardiyası
      oncallLongHours: 24, oncallLongLabel: 'N08-08', oncallLongDaytime: true,   // 24s nöbet (gündüzü kapsar)
      oncallShortHours: 16, oncallShortLabel: 'N16-08', oncallShortDaytime: false, // 16s nöbet (gündüzü kapsamaz)
      useShortOncall: true,                                // 16s nöbet kullanılsın mı
      defaultOncall: 'long',                               // varsayılan nöbet: 'long'(24) | 'short'(16)
      oncallPerDay: 2,                                     // hafta içi günde kaç nöbetçi (EN AZ)
      oncallMax: 2,                                        // hafta içi nöbetçi EN FAZLA (aralık; eksik-saat varsa max'a çıkar)
      daytimeMin: 2,                                       // hafta içi gündüz min (oncall-daytime + mesai)
      daytimeExtraDays: [2, 4],                            // ekstra gündüz istenen günler (dow: Sal=2, Per=4)
      daytimeExtra: 3,                                     // o günlerde gündüz min
      weekendForceLong: true,                              // (eski) — weekendOncall'a göç eder; tutuluyor
      weekendOncall: 'long',                               // hafta sonu/tatil nöbet şekli: 'long'(24) | 'short'(16)
      weekendOncallPerDay: 2,                              // hafta sonu/tatil nöbetçi EN AZ
      weekendOncallMax: 2,                                 // hafta sonu/tatil nöbetçi EN FAZLA (aralık)
      targetPerWorkday: 8,                                 // aylık hedef = bu × iş günü
      preLeaveOncall: true,                                // yıllık izin öncesi nöbet konsun mu
      preLeaveDaysBefore: 4,                               // izinden kaç iş günü önce nöbet (tercih)
      preLeaveDaysBeforeFallback: 3,                       // olmazsa kaç iş günü önce
      preLeaveGap: 2,                                      // izinden hemen önce kaç iş günü boş (ücretli izin)
      postOncallRest: 1,                                   // nöbet sonrası kaç gün dinlenme (N.İ)
      maxConsecutiveOff: 3,                                // üst üste en fazla kaç boş iş günü
      minStaffWarn: 12,                                    // bu sayının altında "kapasite sınırda" uyarısı
      overtimeForCounts: false,                            // açıksa: gündüz sayıları tutmazsa o günlerde FAZLA MESAİ verilir
      minSeniorOncall: 0,                                  // her gün nöbette EN AZ kaç KIDEMLİ olsun (0=kapalı)
      minSeniorDaytime: 0,                                 // her hafta içi gündüzde EN AZ kaç KIDEMLİ olsun (0=kapalı)
      // ÖNCELİK SIRASI: aynı güne birden çok kural denk gelirse ÜSTTEKİ (öndeki) kazanır.
      // pref=çalışma tercihi (gün nöbet isteği) · offReq=boş gün isteği · leave=yıllık izin ·
      // offDay=haftalık izin günü (doluysa aynı haftada kaydırılır) · startNI=aya N.İ başla · preLeave=izin öncesi nöbet+boşluk
      priorityOrder: ['pref', 'offReq', 'leave', 'offDay', 'startNI', 'preLeave'],
      // ÖZEL VARDİYALAR (kullanıcı ekler): ızgarada ELLE atanır; saat/gündüz/lejantta sayılır.
      // (Otomatik dağıtım çekirdek vardiyalarla yapılır; özel vardiyaların otomatiğe girmesi sonra.)
      //   { code:'C1', label:'12s', hours:12, daytime:true, color:'#0891b2' }
      customShifts: []
    };
  }

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function dow(y, m, d) { return new Date(y, m, d).getDay(); }
  function isWeekend(w) { return w === 0 || w === 6; }
  function clampProfile(p) { var d = defaultProfile(); var r = {}; for (var k in d) r[k] = (p && p[k] !== undefined) ? p[k] : d[k];
    // GÖÇ: eski profillerde weekendOncall yoksa weekendForceLong'tan türet (false -> hafta içi şekli)
    if (p && p.weekendOncall === undefined) r.weekendOncall = (p.weekendForceLong === false) ? (p.defaultOncall || 'long') : 'long';
    // GÖÇ: nöbetçi aralığı — eski profilde max yoksa min'e eşitle (sabit davranış); max >= min güvencesi
    if (p && p.oncallMax === undefined) r.oncallMax = r.oncallPerDay;
    if (p && p.weekendOncallMax === undefined) r.weekendOncallMax = r.weekendOncallPerDay;
    r.oncallMax = Math.max(r.oncallMax || 0, r.oncallPerDay);
    r.weekendOncallMax = Math.max(r.weekendOncallMax || 0, r.weekendOncallPerDay);
    // ÖNCELİK SIRASI normalize: bilinmeyen anahtarlar atılır, eksikler varsayılan sırayla sona eklenir
    var PRIO_ALL = ['pref', 'offReq', 'leave', 'offDay', 'startNI', 'preLeave'];
    var po = (p && Array.isArray(p.priorityOrder)) ? p.priorityOrder.filter(function (k) { return PRIO_ALL.indexOf(k) >= 0; }) : [];
    PRIO_ALL.forEach(function (k) { if (po.indexOf(k) < 0) po.push(k); });
    r.priorityOrder = po;
    return r; }

  // Vardiya kodları sabit arketip: M(mesai), NL(uzun nöbet), NS(kısa nöbet) + izin türleri.
  // Profil bunların SAATİNİ/etiketini/gündüz-sayılıp-sayılmadığını belirler.
  function customMap(P) { var m = {}; (P.customShifts || []).forEach(function (s) { if (s && s.code) m[s.code] = s; }); return m; }
  function hoursMap(P) {
    var h = { M: P.mesaiHours, NL: P.oncallLongHours, NS: P.oncallShortHours,
      NI: 0, HT: 0, RT: 0, YI: 0, OFF: 0, UCI: 0, '': 0 };
    (P.customShifts || []).forEach(function (s) { if (s && s.code) h[s.code] = +s.hours || 0; });
    return h;
  }
  function isOncall(c) { return c === 'NL' || c === 'NS'; }
  function isCustom(c, P) { return !!customMap(P)[c]; }
  function coversDaytime(c, P) {
    if (c === 'M') return true;
    if (c === 'NL') return !!P.oncallLongDaytime;
    if (c === 'NS') return !!P.oncallShortDaytime;
    var cs = customMap(P)[c]; if (cs) return !!cs.daytime;
    return false;
  }

  // ===== ANALİZ (tek doğruluk kaynağı) =====
  function analyze(grid, plist, daysArr, nDays, P) {
    var HOURS = hoursMap(P), warnings = [];
    function present(c) { return c === 'M' || isOncall(c) || isCustom(c, P); }   // özel vardiya da "çalıştı" sayılır
    function dayNeed(dd) { return (dd.workday && P.daytimeExtraDays.indexOf(dd.dow) >= 0) ? P.daytimeExtra : P.daytimeMin; }
    function oncallNeed(dd) { return (dd.weekend || dd.holiday) ? P.weekendOncallPerDay : P.oncallPerDay; }

    var totals = plist.map(function (p) {
      var a = grid[p.name] || {}, hours = 0, mesai = 0, nl = 0, ns = 0, ni = 0, uci = 0, wkn = 0;
      for (var d = 1; d <= nDays; d++) {
        var c = a[d] || ''; hours += HOURS[c] || 0;
        if (c === 'M') mesai++; else if (c === 'NL') nl++; else if (c === 'NS') ns++;
        else if (c === 'NI') ni++; else if (c === 'UCI') uci++;
        if (isOncall(c) && (daysArr[d - 1].weekend || daysArr[d - 1].holiday)) wkn++;
      }
      var fark = hours - p.target;
      if (fark > 0) warnings.push((P.overtimeForCounts ? '💡 ' + p.name + ': planlı fazla mesai ' + fark + ' saat (gündüz sayıları tutturuldu).'
        : p.name + ': FAZLA MESAİ ' + fark + ' saat (hedef ' + p.target + ').'));
      else if (fark < 0) {
        if (p.noNobet) {
          var avail = daysArr.filter(function (dd) { return dd.workday && a[dd.day] !== 'YI' && a[dd.day] !== 'OFF'; }).length;
          warnings.push(p.name + ' (sorumlu · sadece gündüz): bu ay ' + avail + ' iş günü var → en fazla ' + (avail * P.mesaiHours) + ' saat.');
        } else if (p.onlyNobet) {
          warnings.push('💡 ' + p.name + ' (sadece nöbet): bu ay ' + (nl + ns) + ' nöbet, ' + hours + ' saat (mesai yazılmaz).');
        } else warnings.push(p.name + ': EKSİK ' + (-fark) + ' saat (hedef ' + p.target + ', toplam ' + hours + ').');
      }
      // üst üste boş iş günü (lockedOff hariç)
      var locked = {}; (p.lockedOff || []).forEach(function (x) { locked[x] = 1; });
      var best = 0, run = 0;
      for (var d2 = 1; d2 <= nDays; d2++) {
        var c2 = a[d2] || '';
        if (present(c2)) run = 0;
        else if (daysArr[d2 - 1].workday && (c2 === 'NI' || c2 === 'UCI') && !locked[d2]) { run++; if (run > best) best = run; }
      }
      if (best > P.maxConsecutiveOff) warnings.push((p.onlyNobet ? '💡 ' : '') + p.name + ': ' + best + ' iş günü üst üste izinli/boşta' + (p.onlyNobet ? ' (sadece nöbet — mesai yazılmadığı için doğal).' : ' (en fazla ' + P.maxConsecutiveOff + ' olmalı).'));
      // ÇALIŞMA TERCİHİ: karşılanamayan nöbet-türü isteği için BİLGİ notu (neden uygulanmadı)
      var odSet = {}; (p.onlyDay || []).forEach(function (x) { odSet[x] = 1; });
      function noteReq(list, wanted, lbl) { (list || []).forEach(function (dn) {
        // ÖNCE çelişki: bu kişi o gün zaten nöbet tutmuyor mu?
        if (p.noNobet) { warnings.push('💡 ' + p.name + ': ' + dn + '. gün ' + lbl + ' isteği uygulanamadı (bu kişi “Sorumlu” — nöbet tutmuyor).'); return; }
        if (p.dayOnly) { warnings.push('💡 ' + p.name + ': ' + dn + '. gün ' + lbl + ' isteği uygulanamadı (bu kişi “sadece gündüz” — nöbet tutmuyor).'); return; }
        if (odSet[dn]) { warnings.push('💡 ' + p.name + ': ' + dn + '. gün ' + lbl + ' isteği uygulanamadı (o gün “sadece gündüz” seçili).'); return; }
        var c = a[dn] || ''; if (c === wanted) return;
        var why = (c === 'NI') ? 'dinlenme (ardışık nöbet olmaz)'
          : (c === 'YI' || c === 'OFF') ? 'izin günü'
          : (c === 'M') ? 'o gün gündüz mesaisi verildi'
          : (c === 'NL' || c === 'NS') ? 'diğer nöbet türü yazıldı'
          : 'o gün nöbet kadrosu dolu (kapasite)';
        warnings.push('💡 ' + p.name + ': ' + dn + '. gün ' + lbl + ' isteği uygulanamadı (' + why + ').'); }); }
      noteReq(p.onlyN16, 'NS', 'kısa nöbet'); noteReq(p.onlyN24, 'NL', 'uzun nöbet');
      return { name: p.name, target: p.target, hours: hours, fark: fark, mesai: mesai, nl: nl, ns: ns,
        ni: ni, uci: uci, weekendNobet: wkn, noNobet: !!p.noNobet, dayOnly: !!p.dayOnly, onlyNobet: !!p.onlyNobet, senior: !!p.senior,
        onlyN16: p.onlyN16 || [], onlyN24: p.onlyN24 || [], onlyDay: p.onlyDay || [], lockedOff: p.lockedOff || [] };
    });

    daysArr.forEach(function (dd) {
      var nob = 0, gun = 0, srNob = 0, srGun = 0;
      plist.forEach(function (p) { var c = (grid[p.name] || {})[dd.day];
        if (isOncall(c)) { nob++; if (p.senior) srNob++; }
        if (!p.noNobet && coversDaytime(c, P)) { gun++; if (p.senior) srGun++; } });
      var needN = oncallNeed(dd);
      if (nob < needN) warnings.push(dd.day + '. gün (' + dd.dowName + '): sadece ' + nob + ' nöbetçi (' + needN + ' gerekli).');
      if (dd.workday && gun < dayNeed(dd)) warnings.push(dd.day + '. gün (' + dd.dowName + '): gündüzde ' + gun + ' kişi (en az ' + dayNeed(dd) + ' olmalı).');
      if (P.minSeniorOncall > 0 && srNob < P.minSeniorOncall) warnings.push(dd.day + '. gün (' + dd.dowName + '): nöbette ' + srNob + ' kıdemli (en az ' + P.minSeniorOncall + ' olmalı).');
      if (P.minSeniorDaytime > 0 && dd.workday && srGun < P.minSeniorDaytime) warnings.push(dd.day + '. gün (' + dd.dowName + '): gündüzde ' + srGun + ' kıdemli (en az ' + P.minSeniorDaytime + ' olmalı).');
    });

    var nNobet = plist.filter(function (p) { return !p.noNobet; }).length;
    var hasGap = warnings.some(function (w) { return /sadece \d+ nöbetçi|gündüzde \d+ kişi|üst üste izinli/.test(w); });
    if (hasGap && nNobet < P.minStaffWarn) {
      warnings.push('💡 ÖNERİ: Bu ay ' + nNobet + ' nöbetçi kişi var; bu izin yoğunluğu için kapasite sınırda. ' +
        'Çözüm: çakışan izinleri farklı haftalara yayın ya da o ay 1 kişi daha ekleyin.');
    }
    return { totals: totals, warnings: warnings };
  }

  // ===== TEK LİSTE ÜRETİMİ =====
  function buildOne(config) {
    var P = clampProfile(config.profile);
    var year = config.year, month = config.month, nDays = daysInMonth(year, month);
    var holidays = new Set(config.holidays || []);
    var HOURS = hoursMap(P);
    var variant = config.__variant || 0;
    var carry = (config.carry && config.carry.byName) || null;   // {name:{nc,wk}} — önceki ayların kümülatif nöbet/hafta sonu
    var _s = (variant * 2654435761 + 1013904223) >>> 0;
    function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }

    var days = [];
    for (var d = 1; d <= nDays; d++) {
      var w = dow(year, month, d);
      days.push({ day: d, dow: w, dowName: DOW_TR[w], weekend: isWeekend(w), holiday: holidays.has(d),
        isExtra: (P.daytimeExtraDays.indexOf(w) >= 0), workday: (!isWeekend(w) && !holidays.has(d)) });
    }
    var workdayNums = days.filter(function (x) { return x.workday; }).map(function (x) { return x.day; });
    var baseTarget = P.targetPerWorkday * workdayNums.length;
    function dayNeed(dd) { return (dd.workday && dd.isExtra) ? P.daytimeExtra : P.daytimeMin; }
    function oncallNeed(dd) { return (dd.weekend || dd.holiday) ? P.weekendOncallPerDay : P.oncallPerDay; }
    function oncallCap(dd) { var mn = oncallNeed(dd), mx = (dd.weekend || dd.holiday) ? P.weekendOncallMax : P.oncallMax; return Math.max(mn, mx || mn); }

    var people = config.personnel.map(function (p, idx) {
      var YI = new Set(p.leaveYI || []);
      var offDow = (p.offDay != null) ? p.offDay : null;
      var assign = {}, lockedOff = new Set(), mustMesai = new Set();
      days.forEach(function (dd) {   // kurulumda YALNIZ takvim yazılır; YI/OFF/istekler ÖNCELİK KATMANLARINDA
        var dn = dd.day;
        if (dd.holiday) assign[dn] = 'RT';
        else if (dd.weekend) assign[dn] = 'HT';
        else assign[dn] = '';
      });
      // hedef: iş günü başına targetPerWorkday; yıllık izin + haftalık izin günü DÜŞER (gün×targetPerWorkday)
      // (offDays öngörüsü: haftalık izin kaydırılsa da haftada 1 OFF yazılır -> sayı aynı)
      var leaveWork = workdayNums.filter(function (x) { return YI.has(x); }).length;
      var offDays = (offDow == null) ? 0 : days.filter(function (dd) { return dd.workday && dd.dow === offDow && !YI.has(dd.day); }).length;
      var target = baseTarget - (leaveWork + offDays) * P.targetPerWorkday;
      var cy = (carry && carry[p.name]) || null;   // AYLAR ARASI: önceki ayların birikimi (rotasyon hafızası)
      return { name: p.name, idx: idx, noNobet: !!p.noNobet, dayOnly: !!p.dayOnly, startNI: !!p.startNI,
        onlyNobet: !!p.onlyNobet, senior: !!p.senior, YI: YI, offDow: offDow,
        onlyDay: new Set(p.onlyDay || []), onlyN16: new Set(p.onlyN16 || []), onlyN24: new Set(p.onlyN24 || []), offReq: new Set(p.offReq || []),
        assign: assign, target: target, hours: 0, nobetDays: [], lastNobet: -99, weekendNobet: 0,
        carryNc: cy ? (cy.nc || 0) : 0, carryWk: cy ? (cy.wk || 0) : 0,
        lockedOff: lockedOff, mustMesai: mustMesai };
    });

    // ===== ÖNCELİK KATMANLARI: kurallar P.priorityOrder SIRASIYLA uygulanır — önce gelen GÜNÜ KAPAR =====
    // (dolu hücreye sonraki kural yazamaz; tek istisna: haftalık izin dolu güne denk gelirse AYNI HAFTADA kaydırılır)
    function prefEligible(Pp, d, kind) {
      if (Pp.noNobet || Pp.dayOnly) return false;
      if (Pp.onlyDay.has(d)) return false;
      var cur = Pp.assign[d];
      if (cur !== '' && cur !== 'HT' && cur !== 'RT') return false;   // hafta sonu/tatil hücresi de yazılabilir (istek her güne olabilir)
      if (d > 1 && isOncall(Pp.assign[d - 1])) return false;
      if (d < nDays) { var nx = Pp.assign[d + 1]; if (isOncall(nx) || nx === 'YI') return false; }
      return true;
    }
    var LAYERS = {
      pref: function () {            // ÇALIŞMA TERCİHİ: belirli gün nöbet TÜRÜ isteğini fiilen yerleştir
        people.forEach(function (Pp) {
          days.forEach(function (dd) {
            var d = dd.day, wants = Pp.onlyN16.has(d) ? 'NS' : (Pp.onlyN24.has(d) ? 'NL' : null);
            if (!wants) return;
            if (oncallCount(d) >= oncallCap(dd)) return;          // günün max nöbetçisini aşma
            if (!prefEligible(Pp, d, wants)) return;              // dinlenme/uygunluk (sıra kararı: hücre durumu)
            placeCover(Pp, dd, wants);
          });
        });
      },
      offReq: function () {          // BOŞ GÜN İSTEĞİ: boş hücreyi kesin kilitle
        people.forEach(function (Pp) { Pp.offReq.forEach(function (dn) { if (Pp.assign[dn] === '') { Pp.assign[dn] = 'UCI'; Pp.lockedOff.add(dn); } }); });
      },
      leave: function () {           // YILLIK İZİN
        people.forEach(function (Pp) { Pp.YI.forEach(function (dn) { var c = Pp.assign[dn]; if (c === '' || c === 'HT' || c === 'RT') Pp.assign[dn] = 'YI'; }); });
      },
      offDay: function () {          // HAFTALIK İZİN GÜNÜ (gün doluysa izin AYNI HAFTANIN boş iş gününe kaydırılır)
        people.forEach(function (Pp) {
          if (Pp.offDow == null) return;
          days.forEach(function (dd) {
            if (!dd.workday || dd.dow !== Pp.offDow) return;
            var d = dd.day, c = Pp.assign[d];
            if (c === '') { Pp.assign[d] = 'OFF'; return; }
            if (c === 'YI' || c === 'OFF' || c === 'UCI' || c === 'NI') return;   // o gün zaten çalışmıyor -> kaydırma gerekmez
            var ws = d - ((dd.dow + 6) % 7);                       // haftanın Pazartesi'si
            for (var k = 0; k < 7; k++) { var d2 = ws + k;
              if (d2 < 1 || d2 > nDays || d2 === d) continue;
              if (days[d2 - 1].workday && Pp.assign[d2] === '') { Pp.assign[d2] = 'OFF'; return; }
            }
          });
        });
      },
      startNI: function () {         // AYA N.İ İLE BAŞLA (önceki ayın son nöbetçisi)
        people.forEach(function (Pp) { if (Pp.startNI && Pp.assign[1] === '') Pp.assign[1] = 'NI'; });
      },
      preLeave: function () {        // YILLIK İZİN ÖNCESİ NÖBET + BOŞLUK (izin & boşluk kuralı)
        if (!P.preLeaveOncall) return;
        people.forEach(function (Pp) {
          var starts = [];
          for (var d = 1; d <= nDays; d++) if (Pp.assign[d] === 'YI' && (d === 1 || Pp.assign[d - 1] !== 'YI')) starts.push(d);
          starts.forEach(function (bs) {
            var wprev = workdayNums.filter(function (x) { return x < bs; }).sort(function (a, b) { return b - a; });
            var placed = false;
            if (!Pp.noNobet && !Pp.dayOnly) {
              [P.preLeaveDaysBefore - 1, P.preLeaveDaysBeforeFallback - 1].some(function (ni) {
                var nd = wprev[ni];
                if (nd === undefined || Pp.assign[nd] !== '' || Pp.hours + HOURS[defType()] > Pp.target) return false;
                if (oncallCount(nd) >= oncallCap(days[nd - 1])) return false;   // o gün max nöbetçi dolu
                placeOncall(Pp, days[nd - 1], defType());
                for (var g = nd + 1; g < bs; g++) { Pp.lockedOff.add(g); if (Pp.assign[g] === '') Pp.assign[g] = 'UCI'; }
                placed = true; return true;
              });
            }
            // "sadece gündüz"/Sorumlu kişiye Ü.İ boşluk YAZILMAZ (izinli olsa bile tüm iş günleri mesai)
            if (!placed && !Pp.noNobet && !Pp.dayOnly) for (var i = 0; i < P.preLeaveGap; i++) { var dd2 = wprev[i]; if (dd2 !== undefined && Pp.assign[dd2] === '') { Pp.assign[dd2] = 'UCI'; Pp.lockedOff.add(dd2); } }
          });
        });
      }
    };
    P.priorityOrder.forEach(function (k) { if (LAYERS[k]) LAYERS[k](); });

    function hoursOf(Pp) { var h = 0; for (var d = 1; d <= nDays; d++) h += HOURS[Pp.assign[d]] || 0; return h; }
    function daytimeCount(day) { var c = 0; people.forEach(function (Pp) { if (!Pp.noNobet && coversDaytime(Pp.assign[day], P)) c++; }); return c; }
    function oncallCount(day) { var c = 0; people.forEach(function (Pp) { if (isOncall(Pp.assign[day])) c++; }); return c; }
    function seniorOncallCount(day) { var c = 0; people.forEach(function (Pp) { if (Pp.senior && isOncall(Pp.assign[day])) c++; }); return c; }
    function seniorDaytimeCount(day) { var c = 0; people.forEach(function (Pp) { if (Pp.senior && !Pp.noNobet && coversDaytime(Pp.assign[day], P)) c++; }); return c; }
    function absentRun(Pp, d) { var c = Pp.assign[d]; return (c === 'NI' || c === 'UCI') && !Pp.lockedOff.has(d); }
    function longestAbsentRun(Pp) {
      var best = 0, run = 0;
      for (var d = 1; d <= nDays; d++) {
        var c = Pp.assign[d];
        if (c === 'M' || isOncall(c)) run = 0;
        else if (days[d - 1].workday && absentRun(Pp, d)) { run++; if (run > best) best = run; }
      }
      return best;
    }
    function defType() { return P.defaultOncall === 'short' && P.useShortOncall ? 'NS' : 'NL'; }
    function weekendType() { return P.weekendOncall === 'short' && P.useShortOncall ? 'NS' : 'NL'; }
    function dayType(dd) { return (dd.weekend || dd.holiday) ? weekendType() : defType(); }

    function eligible(Pp, dd, kind, strict) {
      var d = dd.day, cur = Pp.assign[d];
      if (Pp.noNobet || Pp.dayOnly) return false;   // Sorumlu ve "sadece gündüz" nöbet tutmaz
      if (Pp.onlyDay.has(d)) return false;
      if (Pp.onlyN16.has(d) && kind === 'NL') return false;
      if (Pp.onlyN24.has(d) && kind === 'NS') return false;
      if (Pp.lockedOff.has(d) || Pp.offReq.has(d)) return false;
      if (cur !== '' ) return false;
      if (d > 1 && isOncall(Pp.assign[d - 1])) return false;
      if (d < nDays) { var nx = Pp.assign[d + 1]; if (isOncall(nx) || nx === 'YI' || nx === 'UCI') return false; }
      if (Pp.hours + HOURS[kind] > Pp.target) return false;
      if (strict) {
        var cnt = 0; for (var k = Math.max(1, d - 6); k <= d; k++) if (isOncall(Pp.assign[k])) cnt++;
        if (cnt >= 3) return false;
      }
      return true;
    }
    function placeOncall(Pp, dd, kind) {
      var d = dd.day; Pp.assign[d] = kind; Pp.hours += HOURS[kind]; Pp.nobetDays.push(d); Pp.lastNobet = d;
      if (dd.weekend || dd.holiday) Pp.weekendNobet++;
      // nöbet sonrası dinlenme (postOncallRest gün)
      for (var r = 1; r <= P.postOncallRest && d + r <= nDays; r++) {
        var nx = Pp.assign[d + r]; if (nx === '' || nx === 'HT' || nx === 'RT') Pp.assign[d + r] = 'NI'; else break;
      }
    }
    function addMesai(Pp, day) { Pp.assign[day] = 'M'; Pp.hours += P.mesaiHours; }

    // (0.4 çalışma tercihi ve 0.5 izin-öncesi fazları yukarıdaki ÖNCELİK KATMANLARINA taşındı)

    // ---- 0.6) İZİN DÖNÜŞÜ: İLK İŞ GÜNÜ ZORUNLU ÇALIŞMA ----
    // Yıllık izin biten kişi, dönüşte ilk İŞ GÜNÜnde kesin çalışır (mustMesai ile korunur).
    // İzin Cuma biterse → Cumartesi/Pazar boş, Pazartesi başlar. Çarşamba biterse → Perşembe başlar.
    // İzin bitişi ile dönüş günü arasındaki hafta sonu/tatile nöbet/mesai yazılmaz.
    people.forEach(function (Pp) {
      for (var d = 1; d <= nDays; d++) {
        if (Pp.assign[d] !== 'YI') continue;
        if (d !== nDays && Pp.assign[d + 1] === 'YI') continue;     // sadece izin bloğunun BİTİŞİ
        var rd = -1;
        for (var k = d + 1; k <= nDays; k++) {
          if (!days[k - 1].workday) continue;                       // hafta sonu/tatil: atla
          if (Pp.assign[k] === 'OFF') continue;                     // kişisel haftalık izin günü: atla
          if (Pp.assign[k] === '') rd = k;                          // ilk çalışılabilir iş günü
          break;                                                    // ilk iş günü bulundu (boşsa rd, doluysa zorlama yok)
        }
        if (rd < 0) continue;
        for (var w = d + 1; w < rd; w++) if (!days[w - 1].workday) Pp.lockedOff.add(w);  // aradaki h.sonu/tatil kilit
        if (Pp.onlyNobet) continue;                                 // "sadece nöbet": mesai rezerve edilmez
        addMesai(Pp, rd); Pp.mustMesai.add(rd);                     // dönüş günü = korumalı kesin çalışma
      }
    });

    // ÇALIŞMA TERCİHİ ÖNCELİĞİ (düşük = önce): o gün o TİPTE nöbet İSTEYEN kişi en önce,
    // sonra "sadece nöbet" kişi (başka çalışma yolu yok) -> tercihlere kararlarda öncelik.
    function prefRank(Pp, d, kind) {
      if ((kind === 'NL' && Pp.onlyN24.has(d)) || (kind === 'NS' && Pp.onlyN16.has(d))) return 0;
      return 2;   // NOT: "sadece nöbet" artık öne yığılmaz (gün aşırı yükü önlemek için) — adil paya bırakılır
    }
    // ---- 1) NÖBET KAPSAMA (greedy) ----
    function pickCandidate(dd, kind, strict) {
      var pool = people.filter(function (Pp) { return eligible(Pp, dd, kind, strict); });
      if (!pool.length) return null;
      if (variant) pool.forEach(function (Pp) { Pp._rk = rnd(); });
      var needSr = (P.minSeniorOncall > 0) && (seniorOncallCount(dd.day) < P.minSeniorOncall);   // bu gün kıdemli açığı varsa öne al
      pool.sort(function (a, b) {
        if (needSr && a.senior !== b.senior) return a.senior ? -1 : 1;
        var pra = prefRank(a, dd.day, kind), prb = prefRank(b, dd.day, kind); if (pra !== prb) return pra - prb;   // çalışma tercihi önceliği
        if (dd.weekend || dd.holiday) { var aw = a.weekendNobet + (a.carryWk || 0), bw = b.weekendNobet + (b.carryWk || 0); if (aw !== bw) return aw - bw; }
        var pa = a.hours / (a.target || 1), pb = b.hours / (b.target || 1);
        var band = variant ? 0.10 : 0.0001;
        if (Math.abs(pa - pb) > band) return pa - pb;
        if (variant) return a._rk - b._rk;
        if (a.lastNobet !== b.lastNobet) return a.lastNobet - b.lastNobet;
        return a.idx - b.idx;
      });
      return pool[0];
    }
    days.forEach(function (dd) {
      var need = oncallNeed(dd);
      for (var slot = oncallCount(dd.day); slot < need; slot++) {
        var kind = dayType(dd);
        var cand = pickCandidate(dd, kind, true) || pickCandidate(dd, kind, false);
        if (!cand && dd.workday && P.useShortOncall && kind === 'NL') { kind = 'NS'; cand = pickCandidate(dd, kind, true) || pickCandidate(dd, kind, false); }
        if (cand) placeOncall(cand, dd, kind);
      }
    });

    // ---- 1.5) KAPSAMA GARANTİSİ (mesai doldurmadan ÖNCE — overtime önler) ----
    function coverEligible(Pp, dd, kind) {
      var d = dd.day, cur = Pp.assign[d];
      if (Pp.noNobet || Pp.dayOnly || Pp.onlyDay.has(d)) return false;
      if (Pp.onlyN16.has(d) && kind === 'NL') return false;
      if (Pp.onlyN24.has(d) && kind === 'NS') return false;
      if (Pp.lockedOff.has(d) || Pp.offReq.has(d)) return false;
      if (cur === 'YI' || cur === 'OFF' || cur === 'NI' || isOncall(cur)) return false;
      if (d > 1 && isOncall(Pp.assign[d - 1])) return false;
      if (d < nDays) { var nx = Pp.assign[d + 1]; if (nx === 'M' || isOncall(nx) || nx === 'YI') return false; }
      return true;
    }
    function freeBudget(Pp, needH, excl, allowBreak) {
      var conv = [], freed = 0;
      for (var m = 0; m < workdayNums.length && freed < needH; m++) {
        var dm = workdayNums[m];
        if (dm === excl || Pp.assign[dm] !== 'M' || Pp.mustMesai.has(dm)) continue;
        if (!allowBreak && daytimeCount(dm) - 1 < dayNeed(days[dm - 1])) continue;
        Pp.assign[dm] = 'UCI'; Pp.hours -= P.mesaiHours;
        if (longestAbsentRun(Pp) > P.maxConsecutiveOff) { Pp.assign[dm] = 'M'; Pp.hours += P.mesaiHours; continue; }
        conv.push(dm); freed += P.mesaiHours;
      }
      return { conv: conv, freed: freed };
    }
    function placeCover(Pp, dd, kind) {
      var d = dd.day, net = HOURS[kind] - (HOURS[Pp.assign[d]] || 0);
      Pp.hours += net; Pp.assign[d] = kind; Pp.nobetDays.push(d); Pp.lastNobet = d;
      if (dd.weekend || dd.holiday) Pp.weekendNobet++;
      for (var r = 1; r <= P.postOncallRest && d + r <= nDays; r++) { var nx = Pp.assign[d + r]; if (nx === '' || nx === 'HT' || nx === 'RT' || nx === 'UCI') Pp.assign[d + r] = 'NI'; else break; }
    }
    function tryCover(dd, kind) {
      var d = dd.day, addH = HOURS[kind];
      var pool = people.filter(function (Pp) { return coverEligible(Pp, dd, kind); });
      if (!pool.length) return false;
      if (variant) pool.forEach(function (Pp) { Pp._rk = rnd(); });
      var needSrC = (P.minSeniorOncall > 0) && (seniorOncallCount(dd.day) < P.minSeniorOncall);
      pool.sort(function (a, b) { if (needSrC && a.senior !== b.senior) return a.senior ? -1 : 1; var pra = prefRank(a, dd.day, kind), prb = prefRank(b, dd.day, kind); if (pra !== prb) return pra - prb; var ra = a.target - a.hours, rb = b.target - b.hours; if (ra !== rb) return rb - ra; if (variant) return a._rk - b._rk; return a.lastNobet - b.lastNobet; });
      function attempt(Pp, allowBreak) {
        var over = (Pp.hours + (addH - (HOURS[Pp.assign[d]] || 0))) - Pp.target;
        if (over <= 0) { placeCover(Pp, dd, kind); return true; }
        var r = freeBudget(Pp, over, d, allowBreak);
        if (r.freed >= over) { placeCover(Pp, dd, kind); return true; }
        r.conv.forEach(function (dm) { Pp.assign[dm] = 'M'; Pp.hours += P.mesaiHours; }); return false;
      }
      var i;
      for (i = 0; i < pool.length; i++) if (attempt(pool[i], false)) return true;
      for (i = 0; i < pool.length; i++) if (attempt(pool[i], true)) return true;
      var Q = pool[0], over2 = (Q.hours + (addH - (HOURS[Q.assign[d]] || 0))) - Q.target;
      if (over2 > 0) freeBudget(Q, over2, d, true);
      placeCover(Q, dd, kind); return true;
    }
    function guaranteeCoverage() {
      days.forEach(function (dd) {
        var need = oncallNeed(dd);
        for (var guard = 0; guard < need && oncallCount(dd.day) < need; guard++) {
          var longK = dayType(dd);
          var ok = tryCover(dd, longK);
          if (!ok && dd.workday && P.useShortOncall && longK === 'NL') ok = tryCover(dd, 'NS');
          if (!ok) break;
        }
      });
    }
    guaranteeCoverage();

    // ---- 2) MESAİ İLE HEDEFE TAMAMLA (EŞİT YAYILI) ----
    // Mesailer ayın başından sırayla doldurulursa kalan boşluklar (Ü.İ) ay sonuna yığılır
    // ("son hafta koca boşluk" görünümü). Bütçe tüm boş günlere yetmiyorsa mesai günleri
    // EŞİT ARALIKLI seçilir -> boşluklar aya tekli dağılır.
    people.forEach(function (Pp) {
      if (Pp.onlyNobet) return;                            // "sadece nöbet": hiç mesai yazılmaz
      var free = []; days.forEach(function (dd) { if (dd.workday && Pp.assign[dd.day] === '' && !Pp.offReq.has(dd.day)) free.push(dd.day); });
      var budget = Math.floor((Pp.target - Pp.hours) / P.mesaiHours);
      if (budget <= 0 || !free.length) return;
      if (budget >= free.length) { free.forEach(function (d) { addMesai(Pp, d); }); return; }
      var picked = {}, cnt = 0;
      for (var k = 0; k < budget; k++) { var ix = Math.min(free.length - 1, Math.floor((k + 0.5) * free.length / budget)); if (!picked[free[ix]]) { picked[free[ix]] = 1; cnt++; } }
      for (var i2 = 0; i2 < free.length && cnt < budget; i2++) if (!picked[free[i2]]) { picked[free[i2]] = 1; cnt++; }   // yuvarlama çakışması tamamla
      free.forEach(function (d) { if (picked[d]) addMesai(Pp, d); });
    });

    // ---- 2.5) KALAN BOŞ İŞ GÜNLERİ -> ÜCRETLİ İZİN ----
    people.forEach(function (Pp) { days.forEach(function (dd) { if (dd.workday && Pp.assign[dd.day] === '') Pp.assign[dd.day] = 'UCI'; }); });

    guaranteeCoverage();  // güvenlik ağı

    // ---- 2.6) ÜST ÜSTE BOŞ SINIRI: mesai taşıyarak kır ----
    people.forEach(function (Pp) {
      if (Pp.onlyNobet) return;                            // mesai yazılamaz -> küme kırma mesaiyle yapılmaz
      for (var guard = 0; guard < 60; guard++) {
        if (longestAbsentRun(Pp) <= P.maxConsecutiveOff) break;
        // seri içinde bir UCI'yi M yap, dengelemek için fazlası olan bir M'yi UCI yap
        var moved = false, runs = [], cur = [];
        for (var d = 1; d <= nDays; d++) { var c = Pp.assign[d]; if (c === 'M' || isOncall(c)) { if (cur.length) { runs.push(cur); cur = []; } } else if (days[d - 1].workday && absentRun(Pp, d)) cur.push(d); }
        if (cur.length) runs.push(cur);
        var best = null; runs.forEach(function (rn) { if (rn.length > P.maxConsecutiveOff && (!best || rn.length > best.length)) best = rn; });
        if (!best) break;
        var mid = -1; for (var k = P.maxConsecutiveOff; k < best.length; k++) if (Pp.assign[best[k]] === 'UCI') { mid = best[k]; break; }
        if (mid < 0) break;
        for (var m = 0; m < workdayNums.length; m++) {
          var dm = workdayNums[m];
          if (Pp.assign[dm] !== 'M' || Pp.mustMesai.has(dm) || (dm >= best[0] && dm <= best[best.length - 1])) continue;
          if (daytimeCount(dm) - 1 < dayNeed(days[dm - 1])) continue;
          Pp.assign[dm] = 'UCI'; Pp.assign[mid] = 'M';
          if (longestAbsentRun(Pp) <= P.maxConsecutiveOff || longestAbsentRun(Pp) < best.length) { moved = true; break; }
          Pp.assign[dm] = 'M'; Pp.assign[mid] = 'UCI';
        }
        if (!moved) break;
      }
    });

    // ---- 2.7) GÜNDÜZ MİNİMUMU: saat-korumalı takasla tamamla ----
    days.forEach(function (dd) {
      if (!dd.workday) return; var need = dayNeed(dd);
      for (var guard = 0; guard < 40 && daytimeCount(dd.day) < need; guard++) {
        var done = false;
        for (var pi = 0; pi < people.length && !done; pi++) {
          var Pp = people[pi];
          if (Pp.noNobet || Pp.onlyNobet || Pp.assign[dd.day] !== 'UCI' || Pp.offReq.has(dd.day) || Pp.lockedOff.has(dd.day)) continue;
          for (var m = 0; m < workdayNums.length && !done; m++) {
            var dm = workdayNums[m];
            if (dm === dd.day || Pp.assign[dm] !== 'M' || Pp.mustMesai.has(dm)) continue;
            if (daytimeCount(dm) - 1 < dayNeed(days[dm - 1])) continue;
            Pp.assign[dm] = 'UCI'; Pp.assign[dd.day] = 'M';
            if (longestAbsentRun(Pp) > P.maxConsecutiveOff) { Pp.assign[dm] = 'M'; Pp.assign[dd.day] = 'UCI'; continue; }
            done = true;
          }
        }
        if (!done) break;
      }
    });

    // ---- 2.97) FAZLA MESAİ GİDERME: uzun nöbeti kısa nöbete indir (gündüz min'i bozmadan) ----
    if (P.useShortOncall) people.forEach(function (Pp) {
      if (Pp.noNobet) return;
      for (var d = 1; d <= nDays && Pp.hours > Pp.target; d++) {
        if (Pp.assign[d] !== 'NL' || !days[d - 1].workday || Pp.onlyN24.has(d)) continue;   // uzun-istek günü indirilmez
        // uzun gündüzü kapsıyorsa indirince gündüz düşer -> koru
        if (P.oncallLongDaytime && !P.oncallShortDaytime && daytimeCount(d) - 1 < dayNeed(days[d - 1])) continue;
        Pp.assign[d] = 'NS'; Pp.hours -= (P.oncallLongHours - P.oncallShortHours);
      }
    });

    // ---- 2.99) YEREL ARAMA / TAVLAMA: küçük hamlelerle hata puanını düşür ----
    // Greedy + geçişler yerel optimumda kalabiliyor (özellikle KÜME). Burada binlerce küçük
    // hamle deneyip ceza puanını (fazla mesai + eksik saat + küme + gündüz) düşüreni kabul
    // ederiz; yerel optimumdan kaçmak için kötü hamleyi de küçük olasılıkla kabul (tavlama).
    // Hamleler KAPSAMAYI (gün başına nöbetçi) korur -> her gün 2 nöbetçi garantisi bozulmaz.
    var LS_ITER = (config.__lsIter != null) ? config.__lsIter : 2500;
    if (LS_ITER > 0) {
      function penalty() {
        var s = 0;
        // ADALET için toplama: kişi başına nöbet sayısı, hafta sonu nöbeti, nöbet günleri (yayılım), hedef ağırlığı
        var ncArr = [], wkArr = [], wArr = [], crNc = [], crWk = [], totNc = 0, totWk = 0, sumW = 0, spacing = 0, totCrNc = 0, totCrWk = 0;
        for (var i = 0; i < people.length; i++) {
          var Pp = people[i], h = Pp.hours;
          if (h > Pp.target) s += (h - Pp.target) * 7;                      // fazla mesai
          else if (h < Pp.target && !Pp.noNobet && !Pp.onlyNobet) s += (Pp.target - h) * 7;  // eksik saat (sadece-nöbet HARİÇ: hedefe zorlanmaz -> gün aşırı yığılmaz)
          var run = 0, nc = 0, wk = 0, onDays = [];
          for (var d = 1; d <= nDays; d++) { var c = Pp.assign[d];
            if (isOncall(c)) { nc++; onDays.push(d); if (days[d - 1].weekend || days[d - 1].holiday) wk++; }
            if (c === 'M' || isOncall(c)) run = 0;
            else if (days[d - 1].workday && (c === 'NI' || c === 'UCI') && !Pp.lockedOff.has(d)) { run++; if (run > P.maxConsecutiveOff) s += 75; else if (run >= 2) s += run * run * 2.5; } }   // boş seriler tekli boşluklara yayılsın (koca boş hafta görünümü olmasın)
          if (!Pp.noNobet) { var w = Pp.target || 1; ncArr.push(nc); wkArr.push(wk); wArr.push(w); crNc.push(Pp.carryNc || 0); crWk.push(Pp.carryWk || 0); totNc += nc; totWk += wk; sumW += w; totCrNc += (Pp.carryNc || 0); totCrWk += (Pp.carryWk || 0);
            // YAYILIM: kişinin kendi nöbetleri aya eşit aralıklı mı (kısa aralık cezalı)
            if (onDays.length > 1) { var ideal = nDays / onDays.length; for (var q = 1; q < onDays.length; q++) { var gap = onDays[q] - onDays[q - 1]; if (gap < ideal) spacing += (ideal - gap); } }
            // GÜN AŞIRI NÖBET (2 gün arayla: N _ N): mecbur kalmadıkça kaçın — nöbetleri yay.
            // İlk gün-aşırı çiftinden itibaren cezalı, zincir uzadıkça ARTAN (nöbet-boş-nöbet-boş... engellenir).
            var gaRun = 1; for (var ga = 1; ga < onDays.length; ga++) { if (onDays[ga] - onDays[ga - 1] === 2) { gaRun++; s += gaRun * gaRun * 6; } else gaRun = 1; }
          }
        }
        // gündüz min (sert) + DAĞILIM ŞEKİLLENDİRME (ekstra gün = normal ort + 1..2, aşırı yığma yok)
        var normVals = [], extras = [];
        for (var k = 0; k < workdayNums.length; k++) { var dn = workdayNums[k], dday = days[dn - 1], need = dayNeed(dday), g = daytimeCount(dn);
          if (g < need) s += (need - g) * 55;
          if (dday.isExtra) extras.push(g); else normVals.push(g);
        }
        if (normVals.length) {
          var navg = 0; for (var n1 = 0; n1 < normVals.length; n1++) navg += normVals[n1]; navg /= normVals.length;
          for (var n2 = 0; n2 < normVals.length; n2++) s += Math.abs(normVals[n2] - navg) * 4;   // normal günler DENGELİ (birini min'e düşürüp diğerini şişirme yok)
          for (var e1 = 0; e1 < extras.length; e1++) { var ge = extras[e1];
            if (ge < navg + 1) s += (navg + 1 - ge) * 8;          // ekstra gün EN AZ normal+1 olsun
            else if (ge > navg + 2) s += (ge - (navg + 2)) * 8;   // ama normal+2'yi GEÇMESİN (aşırı yığma yok)
          }
        } else { for (var e2 = 0; e2 < extras.length; e2++) { var need2 = P.daytimeExtra; if (extras[e2] > need2) s -= Math.min(extras[e2] - need2, 2) * 4; } }
        // ADALET cezaları: KÜMÜLATİF (önceki aylar + bu ay), hedef-oranlı ADİL paydan sapma.
        // Önceki aylarda çok nöbet/hafta sonu tutan bu ay daha az alsın (rotasyon hafızası).
        var cumTotNc = totNc + totCrNc, cumTotWk = totWk + totCrWk;
        for (var f = 0; f < ncArr.length; f++) {
          var fairNc = cumTotNc * wArr[f] / sumW, fairWk = cumTotWk * wArr[f] / sumW;
          s += Math.abs((ncArr[f] + crNc[f]) - fairNc) * 16;   // nöbet sayısı adaleti (kümülatif) — gün-aşırı yayılımı dengeyi EZEMEZ
          s += Math.abs((wkArr[f] + crWk[f]) - fairWk) * 14;   // hafta sonu/tatil nöbeti adaleti (kümülatif, daha değerli)
        }
        s += spacing * 2.5;                           // nöbetleri aya eşit yay (kümeleşme/sıkışma)
        // KIDEM: her gün nöbette / hafta içi gündüzde EN AZ kaç kıdemli (sert ceza)
        if (P.minSeniorOncall > 0 || P.minSeniorDaytime > 0) {
          for (var sd = 1; sd <= nDays; sd++) {
            if (P.minSeniorOncall > 0) { var so = seniorOncallCount(sd); if (so < P.minSeniorOncall) s += (P.minSeniorOncall - so) * 60; }
            if (P.minSeniorDaytime > 0 && days[sd - 1].workday) { var sg = seniorDaytimeCount(sd); if (sg < P.minSeniorDaytime) s += (P.minSeniorDaytime - sg) * 60; }
          }
        }
        return s;
      }
      function mFill() {           // eksik-saatli kişiye boş iş gününde M ekle (hedefe yaklaştır + küme kır)
        var Pp = people[(rnd() * people.length) | 0];
        if (Pp.onlyNobet) return null;
        if (Pp.hours + P.mesaiHours > Pp.target) return null;
        var Us = []; for (var d = 1; d <= nDays; d++) if (days[d - 1].workday && Pp.assign[d] === 'UCI' && !Pp.lockedOff.has(d) && !Pp.offReq.has(d)) Us.push(d);
        if (!Us.length) return null;
        var dd = Us[(rnd() * Us.length) | 0]; Pp.assign[dd] = 'M'; Pp.hours += P.mesaiHours;
        return function () { Pp.assign[dd] = 'UCI'; Pp.hours -= P.mesaiHours; };
      }
      function mDrain() {          // fazla-mesaili kişiden bir M çıkar (UCI)
        var Pp = people[(rnd() * people.length) | 0];
        if (Pp.hours <= Pp.target) return null;
        var Ms = []; for (var d = 1; d <= nDays; d++) if (Pp.assign[d] === 'M' && !Pp.mustMesai.has(d)) Ms.push(d);
        if (!Ms.length) return null;
        var dd = Ms[(rnd() * Ms.length) | 0]; Pp.assign[dd] = 'UCI'; Pp.hours -= P.mesaiHours;
        return function () { Pp.assign[dd] = 'M'; Pp.hours += P.mesaiHours; };
      }
      function mBreakCluster() {   // KÜMEYİ doğrudan hedefle: serinin ortasındaki UCI'yi M yap, dengelemek için dış M'yi UCI yap
        var Pp = people[(rnd() * people.length) | 0], run = [], best = null;
        if (Pp.onlyNobet) return null;
        for (var d = 1; d <= nDays; d++) { var c = Pp.assign[d];
          if (c === 'M' || isOncall(c)) { if (run.length > P.maxConsecutiveOff && !best) best = run.slice(); run = []; }
          else if (days[d - 1].workday && (c === 'NI' || c === 'UCI') && !Pp.lockedOff.has(d)) run.push(d); }
        if (run.length > P.maxConsecutiveOff && !best) best = run.slice();
        if (!best) return null;
        var uci = best.filter(function (d) { return Pp.assign[d] === 'UCI' && !Pp.offReq.has(d); });
        if (!uci.length) return null;
        var d2 = uci[(rnd() * uci.length) | 0];
        // bütçe açıksa (eksik saat) sadece UCI->M; değilse dış bir M'yi UCI yapıp dengele (saat sabit)
        if (Pp.hours + P.mesaiHours <= Pp.target) { Pp.assign[d2] = 'M'; Pp.hours += P.mesaiHours; return function () { Pp.assign[d2] = 'UCI'; Pp.hours -= P.mesaiHours; }; }
        var Ms = []; for (var d3 = 1; d3 <= nDays; d3++) if (Pp.assign[d3] === 'M' && !Pp.mustMesai.has(d3) && (d3 < best[0] || d3 > best[best.length - 1])) Ms.push(d3);
        if (!Ms.length) return null;
        var d1 = Ms[(rnd() * Ms.length) | 0]; Pp.assign[d1] = 'UCI'; Pp.assign[d2] = 'M';
        return function () { Pp.assign[d1] = 'M'; Pp.assign[d2] = 'UCI'; };
      }
      function mDowngradeBreak() { // donör M yoksa: bir uzun nöbeti kısaya indir (saat açılır), açılanı kümeye M koy (anestezi tarzı)
        if (!P.useShortOncall) return null;
        var freed = P.oncallLongHours - P.oncallShortHours; if (freed < P.mesaiHours) return null;
        var Pp = people[(rnd() * people.length) | 0], run = [], best = null;
        if (Pp.onlyNobet) return null;
        for (var d = 1; d <= nDays; d++) { var c = Pp.assign[d];
          if (c === 'M' || isOncall(c)) { if (run.length > P.maxConsecutiveOff && !best) best = run.slice(); run = []; }
          else if (days[d - 1].workday && (c === 'NI' || c === 'UCI') && !Pp.lockedOff.has(d)) run.push(d); }
        if (run.length > P.maxConsecutiveOff && !best) best = run.slice();
        if (!best) return null;
        var uci = best.filter(function (d) { return Pp.assign[d] === 'UCI' && !Pp.offReq.has(d); }); if (!uci.length) return null;
        var NLs = []; for (var d4 = 1; d4 <= nDays; d4++) if (Pp.assign[d4] === 'NL' && days[d4 - 1].workday && !Pp.onlyN16.has(d4) && !Pp.onlyN24.has(d4)) NLs.push(d4);
        if (!NLs.length) return null;
        var dOn = NLs[(rnd() * NLs.length) | 0], dM = uci[(rnd() * uci.length) | 0];
        Pp.assign[dOn] = 'NS'; Pp.hours -= freed; Pp.assign[dM] = 'M'; Pp.hours += P.mesaiHours;
        return function () { Pp.assign[dOn] = 'NL'; Pp.hours += freed; Pp.assign[dM] = 'UCI'; Pp.hours -= P.mesaiHours; };
      }
      function mRelocate() {       // bir kişinin M'sini başka boş iş gününe taşı (saat sabit) -> küme/gündüz
        var Pp = people[(rnd() * people.length) | 0], Ms = [], Us = [];
        for (var d = 1; d <= nDays; d++) { var c = Pp.assign[d];
          if (c === 'M' && !Pp.mustMesai.has(d)) Ms.push(d);
          else if (days[d - 1].workday && c === 'UCI' && !Pp.lockedOff.has(d) && !Pp.offReq.has(d)) Us.push(d); }
        if (!Ms.length || !Us.length) return null;
        var d1 = Ms[(rnd() * Ms.length) | 0], d2 = Us[(rnd() * Us.length) | 0];
        Pp.assign[d1] = 'UCI'; Pp.assign[d2] = 'M';
        return function () { Pp.assign[d1] = 'M'; Pp.assign[d2] = 'UCI'; };
      }
      function mType() {           // NL<->NS (saat ±) -> fazla mesai/gündüz
        if (!P.useShortOncall) return null;
        var Pp = people[(rnd() * people.length) | 0]; if (Pp.noNobet) return null;
        var Os = []; for (var d = 1; d <= nDays; d++) if (isOncall(Pp.assign[d]) && days[d - 1].workday) Os.push(d);
        if (!Os.length) return null;
        var dd = Os[(rnd() * Os.length) | 0], cur = Pp.assign[dd], to = cur === 'NL' ? 'NS' : 'NL';
        if (to === 'NL' && Pp.onlyN16.has(dd)) return null;
        if (to === 'NS' && Pp.onlyN24.has(dd)) return null;
        var dh = HOURS[to] - HOURS[cur]; Pp.assign[dd] = to; Pp.hours += dh;
        return function () { Pp.assign[dd] = cur; Pp.hours -= dh; };
      }
      function mHandoff() {        // A'nın nöbetini B'ye devret (kapsama sabit) -> nöbet yükünü dağıt
        var d = 1 + ((rnd() * nDays) | 0), As = [];
        for (var i = 0; i < people.length; i++) if (isOncall(people[i].assign[d])) As.push(people[i]);
        if (!As.length) return null;
        var A = As[(rnd() * As.length) | 0], kind = A.assign[d], Bs = [];
        if ((kind === 'NS' && A.onlyN16.has(d)) || (kind === 'NL' && A.onlyN24.has(d))) return null;   // istenen nöbet devredilmez
        for (var j = 0; j < people.length; j++) { var B = people[j];
          if (B === A || B.noNobet || B.dayOnly || B.onlyDay.has(d)) continue;
          if (kind === 'NL' && B.onlyN16.has(d)) continue;
          if (kind === 'NS' && B.onlyN24.has(d)) continue;
          if (B.lockedOff.has(d) || B.offReq.has(d)) continue;
          var cell = B.assign[d]; if (!(cell === 'M' || cell === 'UCI' || cell === '')) continue;
          if (d > 1 && isOncall(B.assign[d - 1])) continue;
          if (d < nDays) { var nx = B.assign[d + 1]; if (!(nx === '' || nx === 'HT' || nx === 'RT' || nx === 'UCI' || nx === 'NI')) continue; }
          Bs.push(B); }
        if (!Bs.length) return null;
        var Bsel = Bs[(rnd() * Bs.length) | 0];
        var aNext = d < nDays ? A.assign[d + 1] : null, bCell = Bsel.assign[d], bNext = d < nDays ? Bsel.assign[d + 1] : null;
        A.hours -= HOURS[kind]; A.assign[d] = 'UCI'; if (d < nDays && A.assign[d + 1] === 'NI') A.assign[d + 1] = 'UCI';
        Bsel.hours += HOURS[kind] - HOURS[bCell]; Bsel.assign[d] = kind;
        if (d < nDays) { var nb = Bsel.assign[d + 1]; if (nb === '' || nb === 'HT' || nb === 'RT' || nb === 'UCI') Bsel.assign[d + 1] = 'NI'; }
        return function () { A.hours += HOURS[kind]; A.assign[d] = kind; if (d < nDays) A.assign[d + 1] = aNext;
          Bsel.hours -= HOURS[kind] - HOURS[bCell]; Bsel.assign[d] = bCell; if (d < nDays) Bsel.assign[d + 1] = bNext; };
      }
      var cur = penalty();
      for (var it = 0; it < LS_ITER && cur > 0; it++) {
        var t = rnd(), undo;
        if (t < 0.24) undo = mBreakCluster(); else if (t < 0.40) undo = mDowngradeBreak(); else if (t < 0.52) undo = mRelocate();
        else if (t < 0.62) undo = mFill(); else if (t < 0.72) undo = mDrain(); else if (t < 0.88) undo = mHandoff(); else undo = mType();
        if (!undo) continue;
        var np = penalty();
        if (np < cur) cur = np;
        else if (np > cur) {
          var T = 8 * (1 - it / LS_ITER);   // azalan sıcaklık
          if (!(T > 0.01 && rnd() < Math.exp((cur - np) / T))) { undo(); continue; }
          cur = np;
        }
      }
    }

    // ---- 3.1) NÖBETÇİ ARALIĞI: min garanti edildi; KADRO YETERSE max'a kadar GÜÇLENDİR ----
    // Sayı aralıksa (örn. hafta sonu "2 veya 3"): min zaten sağlandı. Burada o günü max'a kadar nöbetçiyle
    // güçlendiririz — ama YALNIZCA aday, hafta içi mesaisini (gündüz-min'i BOZMADAN) takas ederek hedefini
    // aşmadan alabiliyorsa (FAZLA MESAİ YOK). Hafta sonu/tatil yükü en az olana öncelik (adil). Aksi halde min'de kalır.
    days.forEach(function (dd) {
      var cap = oncallCap(dd), kind = dayType(dd);
      for (var guard = 0; guard < 40 && oncallCount(dd.day) < cap; guard++) {
        var pool = people.filter(function (Pp) { return coverEligible(Pp, dd, kind); });
        if (!pool.length) break;
        pool.sort(function (a, b) { var aw = a.weekendNobet + (a.carryWk || 0), bw = b.weekendNobet + (b.carryWk || 0); if (aw !== bw) return aw - bw; return (b.target - b.hours) - (a.target - a.hours); });
        var placed = false;
        for (var i = 0; i < pool.length; i++) { var Pp = pool[i];
          var over = (Pp.hours + (HOURS[kind] - (HOURS[Pp.assign[dd.day]] || 0))) - Pp.target;
          if (over <= 0) { placeCover(Pp, dd, kind); placed = true; break; }   // zaten yeri var (eksik-saat)
          var r = freeBudget(Pp, over, dd.day, false);                          // gündüz-min'i BOZMADAN hafta içi mesaiden aç
          if (r.freed >= over) { placeCover(Pp, dd, kind); placed = true; break; }
          r.conv.forEach(function (dm) { Pp.assign[dm] = 'M'; Pp.hours += P.mesaiHours; });   // yetmedi -> geri al, sonraki aday
        }
        if (!placed) break;
      }
    });

    // ---- 3.2) GÜN AŞIRI ONARIM: N _ N çiftlerini HEDEFLİ devirle kır ----
    // LS rastgele hamlelerle bazı gün-aşırı çiftleri kaçırabiliyor. Burada tek tek bulup, çiftin
    // (İSTEK OLMAYAN) nöbetini, yeni gün-aşırı yaratmayacak uygun birine devrederiz. Saatler dengelenir
    // (devreden eksikse boş iş günlerine mesai; devralan taşarsa hafta içi mesaisi gündüz-min bozulmadan açılır).
    // Kişinin KENDİ istediği günler 2 gün arayla ise dokunulmaz (kendi tercihi). Kapsama değişmez.
    (function repairGunAsiri() {
      function freeCell(dd) { return dd.holiday ? 'RT' : (dd.weekend ? 'HT' : 'UCI'); }
      function isReq(Pp, d) { return Pp.onlyN16.has(d) || Pp.onlyN24.has(d); }
      for (var guard = 0; guard < 80; guard++) {
        var moved = false;
        for (var pi = 0; pi < people.length && !moved; pi++) {
          var A = people[pi];
          for (var d1 = 1; d1 + 2 <= nDays && !moved; d1++) {
            if (!isOncall(A.assign[d1]) || !isOncall(A.assign[d1 + 2])) continue;   // gün-aşırı çift
            var cands = [d1 + 2, d1].filter(function (d) { return !isReq(A, d); }); // istek gününe dokunma
            for (var ci = 0; ci < cands.length && !moved; ci++) {
              var d = cands[ci], kind = A.assign[d], dd = days[d - 1];
              var pool = people.filter(function (B) {
                if (B === A || !coverEligible(B, dd, kind)) return false;
                if ((d > 2 && isOncall(B.assign[d - 2])) || (d + 2 <= nDays && isOncall(B.assign[d + 2]))) return false;   // B'de YENİ çift oluşmasın
                return true;
              });
              if (!pool.length) continue;
              pool.sort(function (a, b) { var an = a.nobetDays.length, bn = b.nobetDays.length; if (an !== bn) return an - bn; return (b.target - b.hours) - (a.target - a.hours); });
              function releaseA() {   // A bırakır (hücre + ertesi günün N.İ'si geri alınır, sayaçlar düzeltilir)
                A.hours -= HOURS[kind]; A.assign[d] = freeCell(dd);
                A.nobetDays = A.nobetDays.filter(function (x) { return x !== d; });
                if (dd.weekend || dd.holiday) A.weekendNobet--;
                if (d < nDays && A.assign[d + 1] === 'NI') A.assign[d + 1] = freeCell(days[d]);
              }
              // STRATEJİ 1: B'nin saat yeri var ya da hafta içi mesaisinden açılabiliyor (gündüz-min bozulmadan)
              for (var bi = 0; bi < pool.length && !moved; bi++) { var B = pool[bi];
                var over = (B.hours + (HOURS[kind] - (HOURS[B.assign[d]] || 0))) - B.target;
                if (over > 0) { var fb = freeBudget(B, over, d, false);
                  if (fb.freed < over) { fb.conv.forEach(function (dm) { B.assign[dm] = 'M'; B.hours += P.mesaiHours; }); continue; } }
                releaseA();
                if (!A.onlyNobet) for (var d3 = 1; d3 <= nDays && A.hours + P.mesaiHours <= A.target; d3++) {
                  var dw = days[d3 - 1]; if (dw.workday && A.assign[d3] === 'UCI' && !A.lockedOff.has(d3) && !A.offReq.has(d3)) { A.assign[d3] = 'M'; A.hours += P.mesaiHours; } }
                placeCover(B, dd, kind);   // B devralır (kapsama aynı gün/tür korunur)
                moved = true;
              }
              // STRATEJİ 2 (SAAT-NÖTR TAKAS): B o gün mesaide -> A'nın nöbeti B'ye, A o güne M;
              // fark saat için B'nin başka M günleri A'ya taşınır. Kapsama/gündüz/saatler DEĞİŞMEZ.
              if (!moved && dd.workday && !A.onlyNobet) {
                var kMove = Math.round((HOURS[kind] - P.mesaiHours) / P.mesaiHours);   // NL:2, NS:1 (8s mesai)
                for (var bj = 0; bj < pool.length && !moved; bj++) { var B2 = pool[bj];
                  if (B2.assign[d] !== 'M' || B2.mustMesai.has(d) || B2.onlyNobet) continue;
                  var dms = [];   // B'nin M'si + A'nın UCI'si olan dengeleme günleri
                  for (var dm2 = 1; dm2 <= nDays && dms.length < kMove; dm2++) { var dwd = days[dm2 - 1];
                    if (dm2 === d || !dwd.workday) continue;
                    if (B2.assign[dm2] !== 'M' || B2.mustMesai.has(dm2)) continue;
                    if (A.assign[dm2] !== 'UCI' || A.lockedOff.has(dm2) || A.offReq.has(dm2)) continue;
                    dms.push(dm2); }
                  if (dms.length < kMove) continue;
                  releaseA();
                  A.assign[d] = 'M'; A.hours += P.mesaiHours;                       // A aynı gün mesaiye geçer (gündüz sabit)
                  dms.forEach(function (dm3) { B2.assign[dm3] = 'UCI'; B2.hours -= P.mesaiHours; A.assign[dm3] = 'M'; A.hours += P.mesaiHours; });
                  placeCover(B2, dd, kind);                                          // B nöbeti devralır (M'si düşer, saati placeCover dengeler)
                  moved = true;
                }
              }
            }
          }
        }
        if (!moved) break;
      }
    })();

    // ---- 3.0) (opsiyonel) GEREKİRSE FAZLA MESAİ — LS'den SONRA, MİNİMUM ----
    // LS gündüz açıklarını saat-korumalı taşımalarla zaten en aza indirdi. Burada yalnız KALAN
    // (kaçınılmaz) açıklar için, o gün boşta (UCI) + EN AZ fazla mesaisi olan uygun kişiye sırayla
    // M ekleriz. Açığı tam kapatacak kadar, fazlası değil -> toplam fazla mesai minimumda ve adil dağılır.
    if (P.overtimeForCounts) days.forEach(function (dd) {
      if (!dd.workday) return; var need = dayNeed(dd);
      for (var guard = 0; guard < 60 && daytimeCount(dd.day) < need; guard++) {
        var cand = null, bestH = Infinity;
        for (var pi = 0; pi < people.length; pi++) { var Pp = people[pi];
          if (Pp.noNobet || Pp.onlyNobet || Pp.assign[dd.day] !== 'UCI') continue;   // gündüze katkı + o gün boşta (UCI)
          if (Pp.offReq.has(dd.day) || Pp.lockedOff.has(dd.day)) continue;      // kesin boş / kilitli olmasın
          var over = Pp.hours - Pp.target;                                       // mevcut fazla mesai (negatifse henüz altında)
          if (over < bestH) { bestH = over; cand = Pp; }                         // en az fazla mesaisi olana ver
        }
        if (!cand) break;
        cand.assign[dd.day] = 'M'; cand.hours += P.mesaiHours;
      }
    });

    var gridA = {}; people.forEach(function (Pp) { gridA[Pp.name] = Pp.assign; });
    var plist = people.map(function (Pp) { return { name: Pp.name, target: Pp.target, noNobet: Pp.noNobet, dayOnly: Pp.dayOnly, onlyNobet: Pp.onlyNobet, senior: Pp.senior, onlyN16: Array.from(Pp.onlyN16), onlyN24: Array.from(Pp.onlyN24), onlyDay: Array.from(Pp.onlyDay), lockedOff: Array.from(Pp.lockedOff) }; });
    var av = analyze(gridA, plist, days, nDays, P);
    return { year: year, month: month, nDays: nDays, days: days, grid: gridA, totals: av.totals, warnings: av.warnings,
      profile: P, meta: { base: baseTarget } };
  }

  // ===== MULTI-START + ALTERNATİFLER =====
  function scoreResult(r, P, carry) {
    var s = 0;
    (r.warnings || []).forEach(function (w) {
      if (w.indexOf('💡') === 0) return;
      if (/sadece \d+ nöbetçi/.test(w)) s += 100000;
      else if (/FAZLA MESAİ/.test(w)) s += 1000;
      else if (/EKSİK/.test(w)) s += 600;
      else if (/kıdemli/.test(w)) s += 300;
      else if (/üst üste izinli|gündüzde \d+ kişi/.test(w)) s += 100;
      else s += 10;
    });
    var wd = (r.days || []).filter(function (d) { return d.workday; }).map(function (d) { return d.day; });
    (r.totals || []).forEach(function (t) {
      if (t.noNobet) return; var locked = {}; (t.lockedOff || []).forEach(function (d) { locked[d] = 1; });
      var g = r.grid[t.name] || {}, run = 0;
      for (var i = 0; i < wd.length; i++) { var c = g[wd[i]], idle = (c === 'NI' || c === 'UCI') && !locked[wd[i]]; if (idle) run++; else { if (run >= 2) s += run * run * 1; run = 0; } }
      if (run >= 2) s += run * run * 1;
      // GÜN AŞIRI NÖBET (N _ N): ilk çiftten itibaren cezalı, artan -> nöbetler yayılır
      var onD = []; for (var od = 1; od <= (r.nDays || 31); od++) if (isOncall(g[od])) onD.push(od);
      var gr = 1; for (var j = 1; j < onD.length; j++) { if (onD[j] - onD[j - 1] === 2) { gr++; s += gr * gr * 3; } else gr = 1; }
    });
    // ADALET (KÜMÜLATİF): nöbet ve hafta sonu nöbeti, önceki aylar (carry) + bu ay birlikte, hedef-oranlı adil paydan sapma
    var totNc = 0, totWk = 0, sumW = 0, arr = [], totCrNc = 0, totCrWk = 0;
    (r.totals || []).forEach(function (t) { if (t.noNobet) return; var nc = (t.nl || 0) + (t.ns || 0), w = t.target || 1;
      var cy = (carry && carry[t.name]) || null, cn = cy ? (cy.nc || 0) : 0, cw = cy ? (cy.wk || 0) : 0;
      arr.push({ nc: nc, wk: t.weekendNobet || 0, w: w, cn: cn, cw: cw }); totNc += nc; totWk += t.weekendNobet || 0; sumW += w; totCrNc += cn; totCrWk += cw; });
    var cumNc = totNc + totCrNc, cumWk = totWk + totCrWk;
    arr.forEach(function (a) { s += Math.abs((a.nc + a.cn) - cumNc * a.w / sumW) * 7 + Math.abs((a.wk + a.cw) - cumWk * a.w / sumW) * 6; });
    // EKSTRA gündüz: normal günlerin ortalaması + 1..2 olsun (aşırı yığma değil)
    var prof = r.profile || {};
    function dcount(day) { var g = 0; (r.totals || []).forEach(function (t) { if (!t.noNobet && coversDaytime((r.grid[t.name] || {})[day], prof)) g++; }); return g; }
    var nv = [], ex = [];
    (r.days || []).forEach(function (dd) { if (!dd.workday) return; (dd.isExtra ? ex : nv).push(dcount(dd.day)); });
    if (nv.length) { var na = 0; nv.forEach(function (x) { na += x; }); na /= nv.length;
      nv.forEach(function (x) { s += Math.abs(x - na) * 2; });
      ex.forEach(function (g) { if (g < na + 1) s += (na + 1 - g) * 5; else if (g > na + 2) s += (g - (na + 2)) * 5; }); }
    return s;
  }
  function sigOf(r) {
    var parts = [];
    (r.totals || []).forEach(function (t) { var g = r.grid[t.name] || {}, on = []; for (var d = 1; d <= (r.nDays || 31); d++) if (isOncall(g[d])) on.push(d + (g[d] === 'NS' ? 's' : '')); parts.push(on.join(',')); });
    return parts.join('|');
  }
  function buildSchedule(config) {
    if (config && config.__variant !== undefined) return buildOne(config);
    var attempts = (config && config.__attempts) || 80;            // Faz 1 çeşitlilik denemesi
    var maxAlts = (config && config.__maxAlts) || 12;
    var lsIter = (config && config.__lsIter != null) ? config.__lsIter : 4000;  // Faz 2 yerel arama bütçesi
    function mk(v, ls) { var c = {}; for (var k in config) c[k] = config[k]; c.__variant = v; c.__lsIter = ls; return c; }
    if (attempts <= 1) return buildOne(mk(0, 0));                  // senkron yolları: hızlı, LS yok
    var P = clampProfile(config.profile);
    var carryMap = (config.carry && config.carry.byName) || null;   // aylar arası adalet (rotasyon hafızası)
    // FAZ 1 — ÇEŞİTLİLİK: LS kapalı (hızlı), farklı rastgele tie-break'lerle aday üret.
    var cands = [];
    for (var v = 0; v < attempts; v++) { var r = buildOne(mk(v, 0)); r.__variant = v; r.__score = scoreResult(r, P, carryMap); r.__sig = sigOf(r); cands.push(r); }
    cands.sort(function (a, b) { return a.__score - b.__score; });
    var seen = {}, picks = [];
    for (var i = 0; i < cands.length && picks.length < maxAlts; i++) if (!seen[cands[i].__sig]) { seen[cands[i].__sig] = 1; picks.push(cands[i]); }
    // FAZ 2 — CİLA: seçilen adayları YEREL ARAMA/TAVLAMA ile iyileştir (aynı variant -> aynı başlangıç + LS).
    var alts = picks.map(function (pk) { var r = buildOne(mk(pk.__variant, lsIter)); r.__variant = pk.__variant; r.__score = scoreResult(r, P, carryMap); r.__sig = sigOf(r); return r; });
    alts.sort(function (a, b) { return a.__score - b.__score; });
    var seen2 = {}, fin = [];
    for (var j = 0; j < alts.length; j++) if (!seen2[alts[j].__sig]) { seen2[alts[j].__sig] = 1; fin.push(alts[j]); }
    var best = fin[0]; best.alternatives = fin; best.meta = best.meta || {}; best.meta.tried = attempts; best.meta.distinct = fin.length;
    return best;
  }
  function recompute(result) {
    var P = clampProfile(result.profile);
    var plist = (result.totals || []).map(function (t) { return { name: t.name, target: t.target, noNobet: t.noNobet, dayOnly: t.dayOnly, onlyNobet: t.onlyNobet, senior: t.senior, onlyN16: t.onlyN16 || [], onlyN24: t.onlyN24 || [], onlyDay: t.onlyDay || [], lockedOff: t.lockedOff || [] }; });
    return analyze(result.grid, plist, result.days, result.nDays, P);
  }

  var API = { buildSchedule: buildSchedule, recompute: recompute, defaultProfile: defaultProfile,
    daysInMonth: daysInMonth, DOW_TR: DOW_TR, hoursMap: hoursMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.AsistanScheduler = API;
})(typeof window !== 'undefined' ? window : this);
