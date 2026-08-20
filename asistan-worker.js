/* =====================================================================
   ÜRETİM İŞÇİSİ (Web Worker)
   ---------------------------------------------------------------------
   Liste üretimi 80 aday deniyor ve saniyeler sürüyor. Ana iş parçacığında
   çalışınca tarayıcı o süre boyunca hiçbir şey çizemiyor: kullanıcı
   "ekran dondu" diyor — özellikle telefonda, çünkü orada aynı hesap
   masaüstünün birkaç katı sürüyor. Ölçüldü: 14 kişilik bir ay masaüstü
   tarayıcıda 4.6 sn.

   Motor saf JavaScript (DOM'a hiç dokunmaz) ve determinist olduğu için
   olduğu gibi buraya taşınabiliyor. Sonuç yapısal kopyalamayla geri
   gönderilir; ana iş parçacığı bu sürede akıcı kalır.
   ===================================================================== */
'use strict';
self.onmessage = function (e) {
  var m = e.data || {};
  try {
    if (!self.AsistanScheduler) importScripts(m.motor || 'asistan-scheduler.js');
    var r = self.AsistanScheduler.buildSchedule(m.cfg);
    self.postMessage({ id: m.id, ok: true, sonuc: r });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, hata: String(err && err.message || err) });
  }
};
