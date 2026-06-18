# Anestezi Nöbet & Vardiya Planlayıcı

Aylık nöbet/vardiya listesini otomatik üreten, tarayıcıda çalışan bir araç.
**Kural:** herkes tam **176 saat**, kimse **fazla mesai** yapmaz, her gün **2 nöbetçi**.

## Çalıştırma
1. `index.html` dosyasını çift tıkla (tarayıcıda açılır) — kurulum gerekmez, internet gerekmez.
2. (İstersen sunucuyla) `npx serve .` çalıştırıp tarayıcıdan aç.

## Kullanım
1. **Ay/Yıl** seç (varsayılan Temmuz 2026).
2. **Resmi tatil** günleri varsa virgülle yaz (ör. `1,15`).
3. **Personel tablosu**:
   - Ad Soyad
   - *Perşembe çalışmaz* (Onur için işaretli) → o günler izinli, çalışma saatinden düşülür
   - *Yıllık izin (gün)* → çalışma saatinden düşülür (gün başına 8 saat)
   - *Ücretsiz izin (gün)* → çalışma saatinden düşülür
   - *Boş gün isteği (gün)* → mümkünse o günler boş bırakılır (zorunlu değil)
   - Gün numaralarını virgülle yaz: `6,7,8`
4. **Liste Oluştur** → ızgara, toplamlar ve uyarılar görünür.
5. **Excel (CSV)** ile indir veya **Yazdır / PDF**.

Girdiler tarayıcıda otomatik kaydedilir; sonraki ay sadece izinleri güncellersin.

## Vardiya kodları
| Kod | Anlam | Saat | Hedefe etki |
|---|---|---|---|
| M8-17 | Gündüz mesai | 8 | sayılır |
| N08-08 | Tam nöbet (24s) | 24 | sayılır |
| N16-08 | Akşam nöbeti (16s) | 16 | sayılır |
| N.İ | Nöbet izni | 0 | düşmez |
| H.T | Hafta tatili | 0 | düşmez |
| R.T | Resmi tatil | 0 | düşmez |
| Yıllık izin | — | 0 | **düşer** (−8/gün) |
| Ücretsiz izin | — | 0 | **düşer** (−8/gün) |

## Kapsama kuralları
- Her gün **2 nöbetçi** (tercihen 24h; saat ayarı için bazıları 16h olabilir).
- **Salı & Perşembe:** 2 nöbetçi + en az 1 ekstra gündüz (M8-17).
- Nöbet → **ertesi gün N.İ**.
- Hafta sonu nöbeti kişiler arasında dengeli.
- Mümkünse 7 günlük pencerede 3'ten fazla nöbet verilmez.

## Dosyalar
- `index.html` — arayüz + ızgara + Excel/yazdır
- `scheduler.js` — planlama algoritması (saf JS, test edilebilir)
- `test.js` — Node ile algoritma testi (`node test.js`)
