/* =====================================================================
   ANESTEZİ NÖBET / VARDİYA PLANLAYICI  —  çekirdek algoritma
   ---------------------------------------------------------------------
   Kurallar (kullanıcı onaylı, 2026-06-18 güncel):
   - Vardiya tipleri ve saatleri:
       M   = M8-17  gündüz mesai      ->  8 saat
       N24 = N08-08 tam nöbet         -> 24 saat
       N16 = N16-08 akşam nöbeti      -> 16 saat
     Sayılmayan kodlar:
       NI  = N.İ  nöbet izni (nöbet sonrası dinlenme) -> 0 saat, hedefi DÜŞÜRMEZ
       HT  = H.T  hafta tatili (cumartesi/pazar)      -> 0 saat, hedefi DÜŞÜRMEZ
       RT  = R.T  resmi tatil                         -> 0 saat, hedefi DÜŞÜRMEZ
       YI  = Yıllık izin   -> 0 saat, hedefi DÜŞÜRÜR (iş günü başına 8)
       OFF = haftalık sabit izin günü -> 0 saat, hedefi DÜŞÜRÜR
       UCI = Ücretli izin  -> 0 saat, hedefi DÜŞÜRMEZ (176 dolduktan sonra kalan
             iş günlerini doldurur; ASLA boş hücre kalmaz, 176 ASLA aşılmaz)
   - Hedef herkes için 176 saat (yalnız YI ve OFF kadarı düşülür).
   - Kimse fazla mesai yapmaz. Boş hücre bırakılmaz (kalan günler UCI olur).
   - Her gün 2 nöbetçi (tercihen 24h; saat ayarı için bazıları 16h).
   - Salı & Perşembe: 2 nöbetçi + en az 1 ekstra gündüz (M).
   - Nöbet (24h/16h) ertesi günü -> NI.
   - Hafta sonu nöbeti dengeli dağılır. 7 günde 3'ten fazla nöbet verilmez (soft).
   - Üst üste en fazla 3 iş günü "gelmeme" (NI+UCI); izinler seriyi kırar.
   - Yıllık izne çıkan: izinden 4 iş günü önce NÖBET, izinden önceki 2 iş günü UCI.
   - Yıllık izinden dönen ilk iş günü çalışır.
   ===================================================================== */

(function (root) {
  'use strict';

  var HOURS = { M: 8, N24: 24, N16: 16, NI: 0, HT: 0, RT: 0, YI: 0, OFF: 0, UCI: 0, '': 0 };
  var BASE_TARGET = 176;
  var DOW_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
  function dow(year, month, day) { return new Date(year, month, day).getDay(); }
  function isWeekend(d) { return d === 0 || d === 6; }

  function buildSchedule(config) {
    var year = config.year, month = config.month;
    var nDays = daysInMonth(year, month);
    var holidays = new Set(config.holidays || []);
    var warnings = [];

    // ---- gün meta ----
    var days = [];
    for (var d = 1; d <= nDays; d++) {
      var w = dow(year, month, d);
      days.push({
        day: d, dow: w, dowName: DOW_TR[w],
        weekend: isWeekend(w), holiday: holidays.has(d),
        isTueThu: (w === 2 || w === 4),
        workday: (!isWeekend(w) && !holidays.has(d))
      });
    }
    var workdayNums = days.filter(function (x) { return x.workday; }).map(function (x) { return x.day; });
    // Aylık hedef = 8 saat × o ayın iş günü (hafta içi, resmi tatil hariç) sayısı.
    var baseTarget = 8 * workdayNums.length;

    // ---- kişiler ----
    var people = config.personnel.map(function (p, idx) {
      var YI = new Set(p.leaveYI || []);
      var offReq = new Set(p.offReq || []);
      var offDow = (p.offDay !== undefined && p.offDay !== null && p.offDay !== '')
        ? Number(p.offDay) : (p.noThursday ? 4 : null);
      var thursdays = new Set();
      if (offDow !== null && !isNaN(offDow)) {
        days.forEach(function (dd) { if (dd.dow === offDow) thursdays.add(dd.day); });
      }
      var target = baseTarget;
      days.forEach(function (dd) {
        if ((YI.has(dd.day) || thursdays.has(dd.day)) && dd.workday) target -= 8;
      });
      if (target < 0) target = 0;
      return {
        idx: idx, name: p.name, noNobet: !!p.noNobet, startNI: !!p.startNI,
        YI: YI, offReq: offReq, thursdays: thursdays,
        target: target, assign: {}, nobetDays: [], weekendNobet: 0, hours: 0, lastNobet: -99,
        lockedOff: new Set(), mustMesai: new Set()
      };
    });

    // ---- prefill: izin / tatil / hafta sonu ----
    people.forEach(function (P) {
      days.forEach(function (dd) {
        var c = '';
        if (P.YI.has(dd.day)) c = 'YI';
        else if (P.thursdays.has(dd.day)) c = 'OFF';
        else if (dd.holiday) c = 'RT';
        else if (dd.weekend) c = 'HT';
        P.assign[dd.day] = c;
      });
      // önceki ayın son nöbetçisi -> yeni aya N.İ (dinlenme) ile başlar
      if (P.startNI && (P.assign[1] === '' || P.assign[1] === 'HT')) P.assign[1] = 'NI';
      // Yıllık izin sonrası: izin bitişi ile ilk iş günü arasındaki hafta sonu/tatil
      // günlerine NÖBET yazılmaz (izinden sonra dinlenip ilk iş günü gelir).
      for (var d = 1; d <= nDays; d++) {
        if (P.assign[d] === 'YI' && (d === nDays || P.assign[d + 1] !== 'YI')) {
          var R = -1;
          for (var k = d + 1; k <= nDays; k++) { if (days[k - 1].workday && P.assign[k] !== 'YI') { R = k; break; } }
          var end = (R < 0) ? nDays : R - 1;
          for (var g = d + 1; g <= end; g++) P.lockedOff.add(g);
          if (R > 0) P.mustMesai.add(R);   // dönüş günü mesai (M) olsun, nöbet değil
        }
      }
    });

    function hoursOf(P) { var h = 0; for (var d = 1; d <= nDays; d++) h += HOURS[P.assign[d]] || 0; return h; }
    function presentCode(c) { return c === 'M' || c === 'N24' || c === 'N16'; }
    function offRun(c) { return c === 'NI' || c === 'UCI'; }   // "gelmeme" sayılan boşluk

    function eligibleForNobet(P, dd, addHours, strict) {
      var d = dd.day, cur = P.assign[d];
      if (P.noNobet) return false;
      if (P.lockedOff.has(d)) return false;            // izin sonrası hafta sonu -> nöbet yok
      if (P.mustMesai.has(d)) return false;            // yıllık izin dönüş günü -> mesai, nöbet değil
      if (cur === 'YI' || cur === 'OFF' || cur === 'UCI') return false;
      if (cur === 'NI') return false;
      if (cur === 'N24' || cur === 'N16' || cur === 'M') return false;
      if (d > 1 && (P.assign[d - 1] === 'N24' || P.assign[d - 1] === 'N16')) return false;
      if (d < nDays) {
        var nx = P.assign[d + 1];
        if (nx === 'N24' || nx === 'N16') return false;
        if (nx === 'YI' || nx === 'UCI') return false; // ertesi gün izinse NI yazılamaz
      }
      if (P.hours + addHours > P.target) return false;
      if (strict) {
        if (P.offReq.has(d)) return false;
        var cnt = 0;
        for (var k = Math.max(1, d - 6); k <= d; k++) if (P.assign[k] === 'N24' || P.assign[k] === 'N16') cnt++;
        if (cnt >= 3) return false;
      }
      return true;
    }
    function placeNobet(P, dd, kind) {
      var d = dd.day;
      P.assign[d] = kind; P.hours += HOURS[kind]; P.nobetDays.push(d); P.lastNobet = d;
      if (dd.weekend || dd.holiday) P.weekendNobet++;
      if (d < nDays) {
        var nx = P.assign[d + 1];
        if (nx === '' || nx === 'HT' || nx === 'RT') P.assign[d + 1] = 'NI';
      }
    }
    function addMesai(P, day) { P.assign[day] = 'M'; P.hours += 8; }

    // ---- 0.5) YILLIK İZİN ÖNCESİ DÜZEN ----
    // izinden 4 iş günü önce NÖBET; izinden hemen önceki 2 iş günü UCI.
    people.forEach(function (P) {
      var starts = [];
      for (var d = 1; d <= nDays; d++) {
        if (P.assign[d] === 'YI' && (d === 1 || P.assign[d - 1] !== 'YI')) starts.push(d);
      }
      starts.forEach(function (bs) {
        var wprev = workdayNums.filter(function (x) { return x < bs; }).sort(function (a, b) { return b - a; });
        // Nöbet: mümkünse 4 iş günü önce (index 3), olmazsa 3 iş günü önce (index 2).
        // Nöbetten izine kadar TÜM iş günleri off (mesai/nöbet yazılmaz): N.İ + ücretli izin.
        var placed = false;
        if (!P.noNobet) {
          [3, 2].some(function (ni) {
            var nd = wprev[ni];
            if (nd !== undefined && P.assign[nd] === '' && P.hours + 24 <= P.target) {
              placeNobet(P, days[nd - 1], 'N24');           // ertesi gün N.İ (bitişikse)
              for (var k = ni - 1; k >= 0; k--) {            // nöbet ile izin arası
                var dd2 = wprev[k];
                if (dd2 !== undefined && P.assign[dd2] === '') P.assign[dd2] = 'UCI';
              }
              placed = true; return true;
            }
            return false;
          });
        }
        if (!placed) {
          // nöbet konulamadıysa en azından izinden önceki 2 iş günü ücretli izin
          [0, 1].forEach(function (i) {
            var dd = wprev[i];
            if (dd !== undefined && P.assign[dd] === '') P.assign[dd] = 'UCI';
          });
        }
      });
    });

    // ---- 1) NÖBET KAPSAMA (her gün 2) ----
    function pickCandidate(dd, kind, strict) {
      var addH = HOURS[kind];
      var pool = people.filter(function (P) { return eligibleForNobet(P, dd, addH, strict); });
      if (!pool.length) return null;
      pool.sort(function (a, b) {
        if (dd.weekend || dd.holiday) { if (a.weekendNobet !== b.weekendNobet) return a.weekendNobet - b.weekendNobet; }
        if (a.nobetDays.length !== b.nobetDays.length) return a.nobetDays.length - b.nobetDays.length;
        // nöbetleri aya YAY: nöbeti en eski olan (ya da hiç tutmamış) önce gelsin
        if (a.lastNobet !== b.lastNobet) return a.lastNobet - b.lastNobet;
        var ra = a.target - a.hours, rb = b.target - b.hours;
        if (ra !== rb) return rb - ra;
        return a.idx - b.idx;
      });
      return pool[0];
    }
    days.forEach(function (dd) {
      var have = people.filter(function (P) { return P.assign[dd.day] === 'N24' || P.assign[dd.day] === 'N16'; }).length;
      for (var slot = have; slot < 2; slot++) {
        var kind = 'N24';
        var cand = pickCandidate(dd, kind, true) || pickCandidate(dd, kind, false);
        if (!cand) { kind = 'N16'; cand = pickCandidate(dd, kind, true) || pickCandidate(dd, kind, false); }
        if (cand) placeNobet(cand, dd, kind);
        else warnings.push(dd.day + '. gün (' + dd.dowName + '): ' + (slot + 1) + '. nöbetçi atanamadı.');
      }
    });

    // ---- 2) MESAİ İLE HEDEFE TAMAMLA ----
    function freeWorkdaySlots(P) {
      var arr = [];
      days.forEach(function (dd) { if (dd.workday && P.assign[dd.day] === '') arr.push(dd.day); });
      return arr;
    }
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
    function returnDays(P) {
      var res = [], inBlock = false;
      for (var d = 1; d <= nDays; d++) {
        if (P.assign[d] === 'YI') inBlock = true;
        else if (inBlock) {
          for (var k = d; k <= nDays; k++) if (days[k - 1].workday && P.assign[k] !== 'YI') { res.push(k); break; }
          inBlock = false;
        }
      }
      return res;
    }
    // 2a) Gündüz mesaisi (M8-17) minimumu: her hafta içi >=2, SALI ve PERŞEMBE >=3. Sorumlu SAYILMAZ.
    days.forEach(function (dd) {
      if (!dd.workday) return;
      var need = dd.isTueThu ? 3 : 2;
      // Gündüz 08-17'de fiilen bulunanlar: M8-17 + N08-08 (24s). N16-08 daytime'ı kapsamaz, sayılmaz.
      // Sorumlu sayılmaz.
      var have = people.filter(function (P) {
        return !P.noNobet && (P.assign[dd.day] === 'M' || P.assign[dd.day] === 'N24');
      }).length;
      while (have < need) {
        var cand = people.filter(function (P) {
          return !P.noNobet && P.assign[dd.day] === '' && (P.hours + 8 <= P.target) && !P.offReq.has(dd.day);
        }).sort(function (a, b) { return (b.target - b.hours) - (a.target - a.hours); })[0];
        if (!cand) { warnings.push(dd.day + '. gün (' + dd.dowName + '): gündüz mesaisinde en az ' + need + ' kişi sağlanamadı.'); break; }
        addMesai(cand, dd.day); have++;
      }
    });
    // 2b) hedefe tamamla — mesaiyi EN UZUN BOŞLUĞU kıracak şekilde yerleştir
    //     (böylece üst üste >3 gün "gelmeme" oluşmaz). offReq günleri mümkünse boş bırakılır.
    function fillMesaiGapAware(P, need) {
      for (var c = 0; c < need; c++) {
        var bestStart = -1, bestLen = 0, rs = -1;
        for (var i = 0; i <= workdayNums.length; i++) {
          var pres = i < workdayNums.length && presentCode(P.assign[workdayNums[i]]);
          if (i < workdayNums.length && !pres) { if (rs < 0) rs = i; }
          else { if (rs >= 0) { if (i - rs > bestLen) { bestLen = i - rs; bestStart = rs; } rs = -1; } }
        }
        if (bestLen <= 0) return;
        var center = bestStart + Math.floor(bestLen / 2), pick = -1, pickScore = 1e9;
        for (var j = bestStart; j < bestStart + bestLen; j++) {
          var d = workdayNums[j];
          if (P.assign[d] !== '') continue;
          var score = Math.abs(j - center) * 2 + (P.offReq.has(d) ? 1000 : 0);
          if (score < pickScore) { pickScore = score; pick = d; }
        }
        if (pick < 0) { for (var k = 0; k < workdayNums.length; k++) if (P.assign[workdayNums[k]] === '') { pick = workdayNums[k]; break; } }
        if (pick < 0) return;
        addMesai(P, pick);
      }
    }
    people.forEach(function (P) {
      if (P.target - P.hours < 8) return;
      returnDays(P).forEach(function (d) { if (P.assign[d] === '' && P.hours + 8 <= P.target) addMesai(P, d); });
      var need = Math.floor((P.target - P.hours) / 8);
      if (need > 0) fillMesaiGapAware(P, need);
    });

    // ---- 2.5) KALAN BOŞ İŞ GÜNLERİ -> ÜCRETLİ İZİN (boş hücre kalmaz) ----
    people.forEach(function (P) {
      days.forEach(function (dd) { if (dd.workday && P.assign[dd.day] === '') P.assign[dd.day] = 'UCI'; });
    });

    // ---- 2.6) ÜST ÜSTE 3 İŞ GÜNÜ SINIRI: (NI+UCI) serilerini mesai TAŞIYARAK kır ----
    function fixAbsence(P) {
      for (var guard = 0; guard < 80; guard++) {
        var runStart = -1, best = null;
        for (var i = 0; i <= workdayNums.length; i++) {
          var absent = (i < workdayNums.length) && offRun(P.assign[workdayNums[i]]);
          if (absent) { if (runStart < 0) runStart = i; }
          else if (runStart >= 0) {
            var len = i - runStart, hasUCI = false;
            for (var j = runStart; j < i; j++) if (P.assign[workdayNums[j]] === 'UCI') hasUCI = true;
            if (len > 3 && hasUCI && (!best || len > best.len)) best = { start: runStart, end: i, len: len };
            runStart = -1;
          }
        }
        if (!best) return;
        var mid = -1;
        for (var k = best.start + 3; k < best.end; k++) if (P.assign[workdayNums[k]] === 'UCI') { mid = workdayNums[k]; break; }
        if (mid < 0) for (var k2 = best.start; k2 < best.end; k2++) if (P.assign[workdayNums[k2]] === 'UCI') { mid = workdayNums[k2]; break; }
        if (mid < 0) return;
        // donör: yalnızca İKİ yanı da dolu (güvenli) bir M taşınır -> taşıma yeni boşluk açmaz.
        // (tek yanı dolu M taşımak başka yerde boşluk açıp oynamaya yol açıyordu.)
        var donor = -1;
        for (var m = 0; m < workdayNums.length; m++) {
          var dm = workdayNums[m];
          if (P.assign[dm] !== 'M') continue;
          if (dm >= workdayNums[best.start] && dm <= workdayNums[best.end - 1]) continue;
          var prevOk = m > 0 && !offRun(P.assign[workdayNums[m - 1]]);
          var nextOk = m < workdayNums.length - 1 && !offRun(P.assign[workdayNums[m + 1]]);
          if (prevOk && nextOk) { donor = dm; break; }
        }
        if (donor < 0) {
          // taşınacak mesai yok (kişi çok nöbetli): bir 24s nöbeti 16s'e indir (8s açılır),
          // bu seride bir ücretli izin gününü mesaiye çevir -> saat 176 sabit, boşluk kırılır.
          var n24 = -1;
          for (var q = 0; q < workdayNums.length; q++) { if (P.assign[workdayNums[q]] === 'N24') { n24 = workdayNums[q]; break; } }
          if (n24 > 0) { P.assign[n24] = 'N16'; P.hours -= 8; P.assign[mid] = 'M'; P.hours += 8; continue; }
          return;
        }
        P.assign[donor] = 'UCI'; P.assign[mid] = 'M';
      }
    }
    function longestAbsentRun(P) {
      var best = 0, run = 0;
      for (var i = 0; i < workdayNums.length; i++) {
        if (offRun(P.assign[workdayNums[i]])) { run++; if (run > best) best = run; } else run = 0;
      }
      return best;
    }
    people.forEach(fixAbsence);

    // ---- 3) YILLIK İZİN DÖNÜŞÜ doğrulaması ----
    people.forEach(function (P) {
      returnDays(P).forEach(function (d) {
        if (P.assign[d] !== 'M' && !presentCode(P.assign[d]))
          warnings.push(P.name + ': yıllık izin dönüşü (' + d + '. gün) çalıştırılamadı (hedef dolu).');
      });
    });

    // ---- TOTALLER & UYARILAR ----
    var totals = people.map(function (P) {
      var nM = 0, nN24 = 0, nN16 = 0, nNI = 0, nUCI = 0, nYI = 0;
      for (var d = 1; d <= nDays; d++) {
        var c = P.assign[d];
        if (c === 'M') nM++; else if (c === 'N24') nN24++; else if (c === 'N16') nN16++;
        else if (c === 'NI') nNI++; else if (c === 'UCI') nUCI++; else if (c === 'YI') nYI++;
      }
      var hours = hoursOf(P), fark = hours - P.target;
      if (fark > 0) warnings.push(P.name + ': FAZLA MESAİ ' + fark + ' saat (hedef ' + P.target + ').');
      else if (fark < 0) {
        if (P.noNobet) {
          var avail = days.filter(function (dd) {
            return dd.workday && P.assign[dd.day] !== 'YI' && P.assign[dd.day] !== 'OFF';
          }).length;
          warnings.push(P.name + ' (sorumlu · sadece gündüz): bu ay ' + avail + ' iş günü var → en fazla ' +
            (avail * 8) + ' saat yapılabilir, ' + (-fark) + ' saat eksik (nöbet tutmadığı için 176 dolmuyor, ay kısa).');
        } else warnings.push(P.name + ': EKSİK ' + (-fark) + ' saat (hedef ' + P.target + ', toplam ' + hours + ').');
      }
      var run = longestAbsentRun(P);
      if (run > 3) warnings.push(P.name + ': ' + run + ' iş günü üst üste izinli/boşta (en fazla 3 olmalı).');
      return {
        name: P.name, target: P.target, hours: hours, fark: fark,
        mesai: nM, n24: nN24, n16: nN16, ni: nNI, uci: nUCI, yi: nYI, weekendNobet: P.weekendNobet
      };
    });

    days.forEach(function (dd) {
      var nob = people.filter(function (P) { return P.assign[dd.day] === 'N24' || P.assign[dd.day] === 'N16'; }).length;
      if (nob < 2) warnings.push(dd.day + '. gün (' + dd.dowName + '): sadece ' + nob + ' nöbetçi (2 gerekli).');
    });

    var grid = {};
    people.forEach(function (P) { grid[P.name] = P.assign; });
    return { year: year, month: month, nDays: nDays, days: days, grid: grid, totals: totals, warnings: warnings,
      meta: { base: baseTarget, hours: HOURS, dowName: DOW_TR } };
  }

  var API = { buildSchedule: buildSchedule, HOURS: HOURS, DOW_TR: DOW_TR, daysInMonth: daysInMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Scheduler = API;
})(typeof window !== 'undefined' ? window : this);
