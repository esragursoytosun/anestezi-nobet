/* =====================================================================
   ANESTEZİ NÖBET / VARDİYA PLANLAYICI  —  çekirdek algoritma
   ---------------------------------------------------------------------
   Kurallar (kullanıcı onaylı):
   - Vardiya tipleri ve saatleri:
       M   = M8-17  gündüz mesai      ->  8 saat
       N24 = N08-08 tam nöbet         -> 24 saat
       N16 = N16-08 akşam nöbeti      -> 16 saat
     İzin / sayılmayan kodlar:
       NI  = N.İ  nöbet izni (nöbet sonrası dinlenme)  -> 0 saat, hedefi DÜŞÜRMEZ
       HT  = H.T  hafta tatili (cumartesi/pazar)       -> 0 saat, hedefi DÜŞÜRMEZ
       RT  = R.T  resmi tatil                          -> 0 saat, hedefi DÜŞÜRMEZ
       YI  = Yıllık izin   -> 0 saat, hedefi DÜŞÜRÜR (iş günü başına 8)
       UI  = Ücretsiz izin -> 0 saat, hedefi DÜŞÜRÜR (iş günü başına 8)
       OFF = kişisel off (ör. Onur'un Perşembesi) -> hedefi DÜŞÜRÜR
       ''  = boş
   - Hedef herkes için 176 saat (YI/UI/Onur-Perşembe kadarı düşülür).
   - Kimse fazla mesai yapmaz (toplam <= hedef, tam hedefi tuttururuz).
   - Her gün 2 nöbetçi (tercihen 24h; saat ayarı için bazıları 16h).
   - Salı & Perşembe: 2 nöbetçi + en az 1 ekstra gündüz (M). Diğer günler mümkünse.
   - Nöbet (24h/16h) ertesi günü -> NI (dinlenme).
   - Hafta sonu nöbeti dengeli dağılır.
   - Mümkünse 7 günlük pencerede 3'ten fazla nöbet verme.
   - Yıllık izinden dönen ilk iş günü çalışır (soft).
   ===================================================================== */

(function (root) {
  'use strict';

  var HOURS = { M: 8, N24: 24, N16: 16, NI: 0, HT: 0, RT: 0, YI: 0, UI: 0, OFF: 0, '': 0 };
  var BASE_TARGET = 176;

  // Türkçe gün kısaltmaları (0=Pazar)
  var DOW_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

  function daysInMonth(year, month /*0-based*/) {
    return new Date(year, month + 1, 0).getDate();
  }
  function dow(year, month, day) {
    return new Date(year, month, day).getDay(); // 0=Pazar ... 6=Cmt
  }
  function isWeekend(d) { return d === 0 || d === 6; }

  /* ---------------------------------------------------------------
     buildSchedule(config)
     config = {
       year, month (0-based),
       personnel: [ { name, noThursday?:bool, leaveYI?:[gün...], leaveUI?:[gün...],
                      offReq?:[gün...] (boş gün isteği, soft) } ],
       holidays: [gün...]   // resmi tatil günleri
     }
     dönüş: { days, grid, totals, warnings, meta }
  --------------------------------------------------------------- */
  function buildSchedule(config) {
    var year = config.year;
    var month = config.month;
    var nDays = daysInMonth(year, month);
    var holidays = new Set(config.holidays || []);
    var warnings = [];

    // ---- gün meta tablosu ----
    var days = [];
    for (var d = 1; d <= nDays; d++) {
      var w = dow(year, month, d);
      days.push({
        day: d,
        dow: w,
        dowName: DOW_TR[w],
        weekend: isWeekend(w),
        holiday: holidays.has(d),
        isTueThu: (w === 2 || w === 4),
        workday: (!isWeekend(w) && !holidays.has(d)) // normal mesai günü
      });
    }

    // ---- kişi durum nesneleri ----
    var people = config.personnel.map(function (p, idx) {
      var YI = new Set(p.leaveYI || []);
      var UI = new Set(p.leaveUI || []);
      var offReq = new Set(p.offReq || []);
      // haftalık sabit izin günü (0=Paz..6=Cmt). Eski 'noThursday' ile geriye uyumlu (Perşembe=4).
      var offDow = (p.offDay !== undefined && p.offDay !== null && p.offDay !== '')
        ? Number(p.offDay) : (p.noThursday ? 4 : null);
      var thursdays = new Set();
      if (offDow !== null && !isNaN(offDow)) {
        days.forEach(function (dd) { if (dd.dow === offDow) thursdays.add(dd.day); });
      }
      // hedef hesabı: 176 - (YI/UI/Onur-Per iş günleri)*8
      var target = BASE_TARGET;
      days.forEach(function (dd) {
        var reduce = false;
        if (YI.has(dd.day) || UI.has(dd.day)) reduce = true;
        if (thursdays.has(dd.day)) reduce = true;
        // sadece o gün normalde çalışacağı bir iş günüyse düş
        if (reduce && dd.workday) target -= 8;
      });
      if (target < 0) target = 0;

      return {
        idx: idx,
        name: p.name,
        noThursday: !!p.noThursday,
        noNobet: !!p.noNobet,   // sorumlu -> sadece gündüz mesai, nöbet tutmaz
        YI: YI, UI: UI, offReq: offReq, thursdays: thursdays,
        target: target,
        assign: {},          // gün -> kod
        nobetDays: [],       // nöbet tutulan günler (24/16)
        weekendNobet: 0,
        hours: 0
      };
    });

    // ---- ızgarayı izin/tatil/hafta sonu ile ön-doldur ----
    people.forEach(function (P) {
      days.forEach(function (dd) {
        var c = '';
        if (P.YI.has(dd.day)) c = 'YI';
        else if (P.UI.has(dd.day)) c = 'UI';
        else if (P.thursdays.has(dd.day)) c = 'OFF';
        else if (dd.holiday) c = 'RT';
        else if (dd.weekend) c = 'HT';
        P.assign[dd.day] = c;
      });
    });

    function hoursOf(P) {
      var h = 0;
      for (var d = 1; d <= nDays; d++) h += HOURS[P.assign[d]] || 0;
      return h;
    }

    // kişi belirli günde nöbete uygun mu? (strict=true => soft kuralları da uygula)
    function eligibleForNobet(P, dd, addHours, strict) {
      var d = dd.day;
      var cur = P.assign[d];
      if (P.noNobet) return false;                     // sorumlu nöbet tutmaz
      // kalıcı engeller
      if (cur === 'YI' || cur === 'UI' || cur === 'OFF') return false;
      if (P.assign[d] === 'NI') return false;          // dinlenme günü
      if (cur === 'N24' || cur === 'N16' || cur === 'M') return false; // doluysa
      // önceki gün nöbet tuttuysa bugün dinlenmeli
      if (d > 1 && (P.assign[d - 1] === 'N24' || P.assign[d - 1] === 'N16')) return false;
      // ertesi gün zaten nöbet/izinse dinlenme yazamayız -> çakışma
      if (d < nDays) {
        var nx = P.assign[d + 1];
        if (nx === 'N24' || nx === 'N16') return false;
        if (nx === 'YI' || nx === 'UI') return false; // ertesi gün izin -> NI yazılamaz
      }
      // hedef aşımı (fazla mesai yok)
      if (P.hours + addHours > P.target) return false;
      if (strict) {
        // boş gün isteği (soft)
        if (P.offReq.has(d)) return false;
        // 7 günlük pencerede 3+ nöbet engeli (soft)
        var cnt = 0;
        for (var k = Math.max(1, d - 6); k <= d; k++) {
          if (P.assign[k] === 'N24' || P.assign[k] === 'N16') cnt++;
        }
        if (cnt >= 3) return false;
      }
      return true;
    }

    function placeNobet(P, dd, kind /*'N24'|'N16'*/) {
      var d = dd.day;
      P.assign[d] = kind;
      P.hours += HOURS[kind];
      P.nobetDays.push(d);
      if (dd.weekend || dd.holiday) P.weekendNobet++;
      // ertesi gün dinlenme (izin/hafta tatili/resmi tatil olsa bile NI baskın değil:
      // sadece boş/HT/RT üstüne yaz, gerçek izinleri koru)
      if (d < nDays) {
        var nx = P.assign[d + 1];
        if (nx === '' || nx === 'HT' || nx === 'RT') P.assign[d + 1] = 'NI';
      }
    }

    // ---- 1) NÖBET KAPSAMA ----
    days.forEach(function (dd) {
      var need = 2; // her gün 2 nöbetçi
      for (var slot = 0; slot < need; slot++) {
        var kind = 'N24'; // tercih 24h
        var cand = pickCandidate(dd, kind, true);
        if (!cand) cand = pickCandidate(dd, kind, false);   // soft gevşet
        if (!cand) { // 24h sığmıyorsa 16h dene
          kind = 'N16';
          cand = pickCandidate(dd, kind, true) || pickCandidate(dd, kind, false);
        }
        if (cand) {
          placeNobet(cand, dd, kind);
        } else {
          warnings.push(dd.day + '. gün (' + dd.dowName + '): ' + (slot + 1) +
            '. nöbetçi atanamadı (uygun kişi yok).');
        }
      }
    });

    function pickCandidate(dd, kind, strict) {
      var addH = HOURS[kind];
      var pool = people.filter(function (P) { return eligibleForNobet(P, dd, addH, strict); });
      if (!pool.length) return null;
      // öncelik:
      //  - hafta sonu/tatil ise: önce az hafta-sonu-nöbetli (denge), sonra az toplam nöbet
      //  - hafta içi ise: önce az toplam nöbet
      //  - sonra hedefe uzak (çok saat lazım), sonra sabit sıra
      pool.sort(function (a, b) {
        if (dd.weekend || dd.holiday) {
          if (a.weekendNobet !== b.weekendNobet) return a.weekendNobet - b.weekendNobet;
        }
        if (a.nobetDays.length !== b.nobetDays.length) return a.nobetDays.length - b.nobetDays.length;
        var ra = a.target - a.hours, rb = b.target - b.hours;
        if (ra !== rb) return rb - ra; // çok saat lazım olan önce
        return a.idx - b.idx;
      });
      return pool[0];
    }

    // ---- 2) MESAİ İLE 176'YI TAMAMLA ----
    // önce Salı/Perşembe ekstra gündüz garantisi, sonra genel doldurma
    function freeWorkdaySlots(P) {
      var arr = [];
      days.forEach(function (dd) {
        if (!dd.workday) return;
        if (P.assign[dd.day] === '') arr.push(dd.day);
      });
      return arr;
    }
    function addMesai(P, day) {
      P.assign[day] = 'M';
      P.hours += 8;
    }

    // 2a) Salı/Perşembe ekstra gündüz: o gün nöbetçi olmayan, saat ihtiyacı olan birine M ver
    days.forEach(function (dd) {
      if (!dd.isTueThu || !dd.workday) return;
      var hasExtraDay = people.some(function (P) { return P.assign[dd.day] === 'M'; });
      if (hasExtraDay) return;
      var cand = people
        .filter(function (P) {
          return P.assign[dd.day] === '' && (P.hours + 8 <= P.target) && !P.offReq.has(dd.day);
        })
        .sort(function (a, b) { return (b.target - b.hours) - (a.target - a.hours); })[0];
      if (cand) addMesai(cand, dd.day);
      else warnings.push(dd.day + '. gün (' + dd.dowName + '): ekstra gündüz (M) atanamadı.');
    });

    // 2b) herkesi tam hedefe getir — mesaiyi aya YAYARAK (uzun boşluk olmasın)
    function pickEven(arr, k) {
      if (k <= 0) return [];
      if (k >= arr.length) return arr.slice();
      var res = [], step = arr.length / k, seen = {};
      for (var i = 0; i < k; i++) {
        var idx = Math.floor(i * step + step / 2);
        if (idx >= arr.length) idx = arr.length - 1;
        while (seen[idx] && idx < arr.length - 1) idx++;
        while (seen[idx] && idx > 0) idx--;
        seen[idx] = 1; res.push(arr[idx]);
      }
      return res.sort(function (a, b) { return a - b; });
    }
    // yıllık izin bloğundan sonraki ilk iş günü (dönüşte çalışma zorunlu)
    function returnDays(P) {
      var res = [], inBlock = false;
      for (var d = 1; d <= nDays; d++) {
        if (P.assign[d] === 'YI') { inBlock = true; }
        else if (inBlock) {
          for (var k = d; k <= nDays; k++) {
            if (days[k - 1].workday && P.assign[k] !== 'YI') { res.push(k); break; }
          }
          inBlock = false;
        }
      }
      return res;
    }
    people.forEach(function (P) {
      if (P.target - P.hours < 8) return;
      // 1) yıllık izin dönüş günlerini ÖNCE yerleştir (zorunlu çalışma)
      returnDays(P).forEach(function (d) {
        if (P.assign[d] === '' && P.hours + 8 <= P.target) addMesai(P, d);
      });
      // 2) kalan saati aya yayarak doldur
      var need = Math.floor((P.target - P.hours) / 8);
      if (need <= 0) return;
      var slots = freeWorkdaySlots(P);
      var pref = slots.filter(function (d) { return !P.offReq.has(d); });
      var use = (pref.length >= need) ? pref : slots;
      pickEven(use, need).forEach(function (d) { addMesai(P, d); });
    });

    // 2c) ÜST ÜSTE BOŞ GÜN SINIRI: aynı kişi en fazla 3 iş günü gelmeyebilir.
    //     (hafta sonu / resmi tatil iş gününden sayılmaz). Boş serileri mesai TAŞIYARAK kır.
    var workdayNums = days.filter(function (d) { return d.workday; }).map(function (d) { return d.day; });
    function presentCode(c) { return c === 'M' || c === 'N24' || c === 'N16'; }
    // kuralın saydığı "gelmeme" = sadece algoritmanın bıraktığı N.İ / boş.
    // Talep edilen izinler (YI/UI/OFF) seriyi KIRAR (onaylı, sorun değil).
    function offRun(c) { return c === 'NI' || c === ''; }
    function longestAbsentRun(P) {
      var best = 0, run = 0;
      for (var i = 0; i < workdayNums.length; i++) {
        if (offRun(P.assign[workdayNums[i]])) { run++; if (run > best) best = run; }
        else run = 0;
      }
      return best;
    }
    function fixAbsence(P) {
      for (var guard = 0; guard < 80; guard++) {
        // boş ('') içeren, 3'ten uzun absans serilerinden en uzununu bul
        var runStart = -1, best = null;
        for (var i = 0; i <= workdayNums.length; i++) {
          var absent = (i < workdayNums.length) && offRun(P.assign[workdayNums[i]]);
          if (absent) { if (runStart < 0) runStart = i; }
          else {
            if (runStart >= 0) {
              var len = i - runStart, hasEmpty = false;
              for (var j = runStart; j < i; j++) if (P.assign[workdayNums[j]] === '') hasEmpty = true;
              if (len > 3 && hasEmpty && (!best || len > best.len)) best = { start: runStart, end: i, len: len };
              runStart = -1;
            }
          }
        }
        if (!best) return;
        // seriyi bölecek bir boş günü seç (3. günden sonra)
        var mid = -1;
        for (var k = best.start + 3; k < best.end; k++) if (P.assign[workdayNums[k]] === '') { mid = workdayNums[k]; break; }
        if (mid < 0) for (var k2 = best.start; k2 < best.end; k2++) if (P.assign[workdayNums[k2]] === '') { mid = workdayNums[k2]; break; }
        if (mid < 0) return;
        // donör: bir komşusu dolu olan (kümeden) bir M günü taşı -> saat değişmez
        var donor = -1;
        for (var m = 0; m < workdayNums.length; m++) {
          var dm = workdayNums[m];
          if (P.assign[dm] !== 'M') continue;
          if (dm >= workdayNums[best.start] && dm <= workdayNums[best.end - 1]) continue;
          // komşusu "gelinen" gün (mesai/nöbet/izin) ise taşıma yeni seri yaratmaz
          var prevP = m > 0 && !offRun(P.assign[workdayNums[m - 1]]);
          var nextP = m < workdayNums.length - 1 && !offRun(P.assign[workdayNums[m + 1]]);
          if (prevP || nextP) { donor = dm; break; }
        }
        if (donor < 0) return; // taşınacak uygun mesai yok
        P.assign[donor] = '';
        P.assign[mid] = 'M';
      }
    }
    people.forEach(fixAbsence);

    // ---- 3) YILLIK İZİNDEN DÖNÜŞ doğrulaması (tek uyarı) ----
    people.forEach(function (P) {
      returnDays(P).forEach(function (d) {
        if (P.assign[d] === '') {
          warnings.push(P.name + ': yıllık izin dönüşü (' + d + '. gün) hedef dolu olduğu için çalıştırılamadı.');
        }
      });
    });

    // ---- TOTALLER & DOĞRULAMA ----
    var totals = people.map(function (P) {
      var nM = 0, nN24 = 0, nN16 = 0, nNI = 0;
      for (var d = 1; d <= nDays; d++) {
        var c = P.assign[d];
        if (c === 'M') nM++; else if (c === 'N24') nN24++;
        else if (c === 'N16') nN16++; else if (c === 'NI') nNI++;
      }
      var hours = hoursOf(P);
      var fark = hours - P.target;
      if (fark > 0) warnings.push(P.name + ': FAZLA MESAİ ' + fark + ' saat (hedef ' + P.target + ').');
      else if (fark < 0) {
        if (P.noNobet) {
          var avail = days.filter(function (d) {
            return d.workday && P.assign[d.day] !== 'YI' && P.assign[d.day] !== 'UI' && P.assign[d.day] !== 'OFF';
          }).length;
          warnings.push(P.name + ' (sorumlu · sadece gündüz): bu ay yalnız ' + avail + ' iş günü var → en fazla ' +
            (avail * 8) + ' saat yapılabilir, ' + (-fark) + ' saat eksik kalıyor. Nöbet tutmadığı için 176 dolmuyor (ay kısa).');
        } else {
          warnings.push(P.name + ': EKSİK ' + (-fark) + ' saat (hedef ' + P.target + ', toplam ' + hours + ').');
        }
      }
      return {
        name: P.name, target: P.target, hours: hours, fark: fark,
        mesai: nM, n24: nN24, n16: nN16, ni: nNI,
        weekendNobet: P.weekendNobet
      };
    });

    // üst üste boş gün ihlali uyarısı
    people.forEach(function (P) {
      var r = longestAbsentRun(P);
      if (r > 3) warnings.push(P.name + ': ' + r + ' iş günü üst üste boşta (en fazla 3 olmalı).');
    });

    // günlük kapsama doğrulama
    days.forEach(function (dd) {
      var nob = people.filter(function (P) {
        return P.assign[dd.day] === 'N24' || P.assign[dd.day] === 'N16';
      }).length;
      if (nob < 2) warnings.push(dd.day + '. gün (' + dd.dowName + '): sadece ' + nob + ' nöbetçi (2 gerekli).');
    });

    var grid = {};
    people.forEach(function (P) { grid[P.name] = P.assign; });

    return {
      year: year, month: month, nDays: nDays,
      days: days, grid: grid, totals: totals, warnings: warnings,
      meta: { base: BASE_TARGET, hours: HOURS, dowName: DOW_TR }
    };
  }

  var API = { buildSchedule: buildSchedule, HOURS: HOURS, DOW_TR: DOW_TR, daysInMonth: daysInMonth };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Scheduler = API;
})(typeof window !== 'undefined' ? window : this);
