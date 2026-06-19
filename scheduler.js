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
          for (var k = d + 1; k <= nDays; k++) { if (days[k - 1].workday && P.assign[k] === '') { R = k; break; } }
          var end = (R < 0) ? nDays : R - 1;
          for (var g = d + 1; g <= end; g++) P.lockedOff.add(g);
          // dönüş günü ZORUNLU çalışma: en baştan mesai olarak ayrılır (hedefe sayılır),
          // coverage/diğer dağıtım bunun etrafında çalışır. Hafta sonuna (lockedOff) iş yazılmaz.
          if (R > 0) { P.assign[R] = 'M'; P.hours += 8; P.mustMesai.add(R); }
        }
      }
    });

    function hoursOf(P) { var h = 0; for (var d = 1; d <= nDays; d++) h += HOURS[P.assign[d]] || 0; return h; }
    function presentCode(c) { return c === 'M' || c === 'N24' || c === 'N16'; }
    function offRun(c) { return c === 'NI' || c === 'UCI'; }   // "gelmeme" sayılan boşluk
    // Yıllık izin ÖNCESİ/sonrası KASITLI boşluk (yönetim verir) lockedOff'ta işaretli;
    // bu günler "üst üste en fazla 3 gün gelmeme" sayımına GİRMEZ (izin bloğunun parçası).
    function absentRun(P, d) { return offRun(P.assign[d]) && !P.lockedOff.has(d); }

    function eligibleForNobet(P, dd, addHours, strict) {
      var d = dd.day, cur = P.assign[d];
      if (P.noNobet) return false;
      if (P.lockedOff.has(d)) return false;            // izin sonrası hafta sonu -> nöbet yok
      if (P.offReq.has(d)) return false;               // boş gün isteği -> o güne nöbet yazma
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
        var cnt = 0;
        for (var k = Math.max(1, d - 6); k <= d; k++) if (P.assign[k] === 'N24' || P.assign[k] === 'N16') cnt++;
        if (cnt >= 3) return false;
        // "3 ardarda nöbet" (sık nöbet) engeli: önceki 4 günde zaten 2 nöbet varsa
        // bu 3.'yü REDDET -> nöbetler aya yayılır, kişi erken dolup ay sonu boş kalmaz.
        // Sadece strict'te; coverage darboğazında non-strict bunu görmezden gelir (gerekirse).
        var near = 0;
        for (var k2 = Math.max(1, d - 4); k2 <= d - 1; k2++) if (P.assign[k2] === 'N24' || P.assign[k2] === 'N16') near++;
        if (near >= 2) return false;
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
    // Gündüz 08-17'de FİİLEN bulunanlar: M8-17 + N08-08 (24s). N16-08 günüzü KAPSAMAZ.
    // Sorumlu (noNobet) sayılmaz. (Kural 5)
    function daytimeCount(day) {
      var c = 0;
      for (var i = 0; i < people.length; i++) {
        var P = people[i];
        if (!P.noNobet && (P.assign[day] === 'M' || P.assign[day] === 'N24')) c++;
      }
      return c;
    }
    function dayNeed(dd) { return dd.isTueThu ? 3 : 2; }

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
              // nöbet ile izin arası TÜM günler (HAFTA SONU DAHİL): nöbet yazılmaz, boş iş günleri ücretli izin
              for (var g2 = nd + 1; g2 < bs; g2++) {
                P.lockedOff.add(g2);
                if (P.assign[g2] === '') P.assign[g2] = 'UCI';
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
            if (dd !== undefined && P.assign[dd] === '') { P.assign[dd] = 'UCI'; P.lockedOff.add(dd); }
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
          for (var k = d; k <= nDays; k++) if (days[k - 1].workday && P.assign[k] !== 'YI' && P.assign[k] !== 'OFF') { res.push(k); break; }
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
        // NOT: burada uyarı BASMA — bu erken adım; mesai-doldurma (2b) ve son-garanti (2.7)
        // sonradan günü tamamlayabiliyor. Gündüz uyarısının tek yetkilisi 2.7'dir (FİNAL sayı).
        if (!cand) break;
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
          var absent = (i < workdayNums.length) && absentRun(P, workdayNums[i]);
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
        // donör: P'nin (seri DIŞI) bir M'sini mid'e TAŞI. Saat sabit (8->0, 0->8).
        // Kabul şartı: (a) donör günün gündüz min'i bozulmaz, (b) taşıma sonrası P'de
        // >3 boş seri açılmaz. Tentatif uygulanıp longestAbsentRun ile doğrulanır;
        // olmazsa geri alınıp başka donör denenir (eski katı komşu kontrolünden daha esnek).
        var donor = -1;
        for (var m = 0; m < workdayNums.length; m++) {
          var dm = workdayNums[m];
          if (P.assign[dm] !== 'M') continue;
          if (P.mustMesai.has(dm)) continue;            // yıllık izin dönüş günü taşınmaz
          if (dm >= workdayNums[best.start] && dm <= workdayNums[best.end - 1]) continue;
          if (daytimeCount(dm) - 1 < dayNeed(days[dm - 1])) continue;   // donör günün gündüz min'i korunur
          P.assign[dm] = 'UCI'; P.assign[mid] = 'M';
          if (longestAbsentRun(P) <= 3) { donor = dm; break; }
          P.assign[dm] = 'M'; P.assign[mid] = 'UCI';    // geri al, başka donör dene
        }
        if (donor >= 0) continue;                        // takas başarılı -> tekrar tara
        {
          // taşınacak mesai yok (kişi çok nöbetli): bir 24s nöbeti 16s'e indir (8s açılır),
          // bu seride bir ücretli izin gününü mesaiye çevir -> saat 176 sabit, boşluk kırılır.
          var n24 = -1;
          for (var q = 0; q < workdayNums.length; q++) {
            var dq = workdayNums[q];
            if (P.assign[dq] !== 'N24') continue;
            // N24->N16 indirimi o günün gündüz minimumunu BOZMAMALI (N24 sayılır, N16 sayılmaz).
            if (daytimeCount(dq) - 1 < dayNeed(days[dq - 1])) continue;
            n24 = dq; break;
          }
          if (n24 > 0) { P.assign[n24] = 'N16'; P.hours -= 8; P.assign[mid] = 'M'; P.hours += 8; continue; }
          return;
        }
      }
    }
    function longestAbsentRun(P) {
      var best = 0, run = 0;
      for (var i = 0; i < workdayNums.length; i++) {
        if (absentRun(P, workdayNums[i])) { run++; if (run > best) best = run; } else run = 0;
      }
      return best;
    }
    people.forEach(fixAbsence);

    // ---- 2.7) GÜNDÜZ MİNİMUMU SON GARANTİ (kural 5 — "kesinlikle olmalı") ----
    // Önceki adımlar (fixAbsence taşımaları/indirmeleri, kapsama N16 atamaları) gündüz
    // sayısını minimumun altına düşürmüş olabilir. Burada günü gün kontrol edip:
    //   1) saat-korumalı TAKAS: bugün UCI olan biri, FAZLASI olan bir günden M taşıyarak
    //      bugüne M olur (toplam saat değişmez, kimsede >3 boş seri açılmaz).
    //   2) olmazsa bugünün N16 nöbetçisini N24'e YÜKSELT (günüzü kapsar -> sayılır);
    //      saat aşarsa aynı kişinin başka bir M'sini UCI yapıp dengele.
    // İkisi de mümkün değilse: gerçek kapasite darboğazı -> net uyarı.
    days.forEach(function (dd) {
      if (!dd.workday) return;
      var need = dayNeed(dd);
      for (var guard = 0; guard < 60 && daytimeCount(dd.day) < need; guard++) {
        var done = false;
        // STRATEJİ 1 — saat-korumalı takas
        for (var pi = 0; pi < people.length && !done; pi++) {
          var P = people[pi];
          if (P.noNobet || P.assign[dd.day] !== 'UCI') continue;
          if (P.offReq.has(dd.day) || P.lockedOff.has(dd.day)) continue;
          for (var m = 0; m < workdayNums.length && !done; m++) {
            var dm = workdayNums[m];
            if (dm === dd.day || P.assign[dm] !== 'M' || P.mustMesai.has(dm)) continue;
            if (daytimeCount(dm) - 1 < dayNeed(days[dm - 1])) continue;  // donör günü koru
            P.assign[dm] = 'UCI'; P.assign[dd.day] = 'M';                // saat sabit (8->0, 0->8)
            if (longestAbsentRun(P) > 3) { P.assign[dm] = 'M'; P.assign[dd.day] = 'UCI'; continue; }
            done = true;
          }
        }
        if (done) continue;
        // STRATEJİ 2 — N16 nöbetçiyi N24'e yükselt (gerekirse başka M'yi UCI yaparak dengele)
        for (var qi = 0; qi < people.length && !done; qi++) {
          var Q = people[qi];
          if (Q.noNobet || Q.assign[dd.day] !== 'N16') continue;
          var ok = (Q.hours + 8 <= Q.target);
          if (!ok) {
            for (var mm = 0; mm < workdayNums.length; mm++) {
              var dx = workdayNums[mm];
              if (dx === dd.day || Q.assign[dx] !== 'M' || Q.mustMesai.has(dx)) continue;
              if (daytimeCount(dx) - 1 < dayNeed(days[dx - 1])) continue;
              Q.assign[dx] = 'UCI'; Q.hours -= 8;
              if (longestAbsentRun(Q) > 3) { Q.assign[dx] = 'M'; Q.hours += 8; continue; }
              ok = true; break;
            }
          }
          if (!ok) continue;
          Q.assign[dd.day] = 'N24'; Q.hours += 8;
          done = true;
        }
        if (done) continue;
        warnings.push(dd.day + '. gün (' + dd.dowName + '): gündüz mesaisinde en az ' + need +
          ' kişi sağlanamadı (kapasite yetersiz).');
        break;
      }
    });

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

    // ---- ÖNERİ: kırılamayan boşluk kümeleri kapasite darboğazını gösterir ----
    // Boş günler (NI+UCI) matematiksel olarak sabittir; çok izin + az kişi olunca
    // bazı kişilerde >3 üst üste birikir ve taşımak yalnız kümeyi başkasına kaydırır.
    // Bu durumda eyleme dönük öneri ver (kullanıcı: "gerekirse yeni tahmin/öneri versin").
    var clusterCount = warnings.filter(function (w) { return /üst üste izinli\/boşta/.test(w); }).length;
    var coverGap = warnings.filter(function (w) { return /sağlanamadı|nöbetçi atanamadı/.test(w); }).length;
    if (clusterCount > 0 || coverGap > 0) {
      var nNobet = people.filter(function (P) { return !P.noNobet; }).length;
      warnings.push('💡 ÖNERİ: Bu ay ' + nNobet + ' nöbetçi kişi var; bu izin yoğunluğu için kapasite sınırda. ' +
        'Kaçınılmaz boş günler kümeleniyor (taşımak yalnızca başka kişiye kaydırır, toplamı azaltmaz). ' +
        'Çözüm: çakışan yıllık izinleri farklı haftalara yayın, ya da o ay 1 kişi daha ekleyin ' +
        '(çoğunlukla +1 kişi tüm bu uyarıları giderir).');
    }

    var grid = {};
    people.forEach(function (P) { grid[P.name] = P.assign; });
    return { year: year, month: month, nDays: nDays, days: days, grid: grid, totals: totals, warnings: warnings,
      meta: { base: baseTarget, hours: HOURS, dowName: DOW_TR } };
  }

  var API = { buildSchedule: buildSchedule, HOURS: HOURS, DOW_TR: DOW_TR, daysInMonth: daysInMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Scheduler = API;
})(typeof window !== 'undefined' ? window : this);
