# Sistem Analizi — neden "bir türlü stabil olmadı"

> Ölçüm tarihi: 2026-08-05 · Motor v48 · Ölçüm tabanı: 115 örnek (10 birim
> profili × 5 ay × değişen kadro/izin) + hedefli kararlılık testleri.

---

## 1. Önce iyi haber: üretim kalitesi artık sorun değil

115 örnekte kalan **tüm** sert uyarıların dağılımı:

| Uyarı türü | Adet | Not |
|---|---|---|
| Kıdem kuralı | 39 | Tek bir **yapısal olarak imkânsız** test profilinden (4 kıdemli, her güne 1 kıdemli şartı) |
| Üst üste sınırı | 1 | |
| Diğer | 4 | |
| Kapsama ihlali | **0** | |
| Nöbet şekli ihlali | **0** | |
| Eksik saat | **0** | |
| Fazla mesai | **0** | |

Yani uyarıların **%89'u tek bir imkânsız ayar bileşiminden** geliyor ve
fizibilite notu bunu zaten "en az 5 kıdemli gerekir" diye söylüyor.
**Motor doğru liste üretiyor.** Sorun burada değil.

---

## 2. Asıl sorun: KARARSIZLIK (ölçüldü)

Küçük bir girdi değişikliğinin listeyi ne kadar değiştirdiğini ölçtüm:

| Değişiklik | Değişen hücre |
|---|---|
| Aynı girdi, tekrar üretim | **0** (%0) — motor deterministik ✓ |
| Bir kişiye 1 gün izin eklendi | 1 (%0.2) ✓ |
| Bir kişi listede yer değiştirdi | 0 (%0) ✓ |
| Bir kişi "kıdemli" işaretlendi | 0 (%0) ✓ |
| **Bir kişiye 1 boş gün isteği eklendi** | **243 (%57.7)** ✗ |

**Tek bir boş gün isteği, listenin yarısından fazlasını yeniden yazıyor.**

Bu, kullanıcı gözünde şu demek: yönetici listeyi çıkarır, personele
gösterir, biri "14'ünde izin alabilir miyim" der — yönetici o isteği
girip yeniden üretir ve **herkesin listesi değişir**. Daha önce
"tamam" denen günler kayar. Güven biter, yönetici elle düzeltmeye
başlar, elle düzeltince de motorun kuralları devre dışı kalır.

Şimdiye kadarki bütün şikâyet döngüsünün altında büyük ölçüde bu var.

### Sebebi mimari, ayar değil

Motor her üretimde **sıfırdan** başlıyor: 80 rastgele başlangıç → puanla
→ en iyiyi seç. Girdi bir tık değişince farklı bir aday kazanıyor ve o
aday tamamen başka bir çözüm. Ceza fonksiyonunda "eski listeye benze"
diye bir terim yok — çünkü motorun eski listeden haberi yok.

### Çözüm: sıcak başlangıç (warm start) / en az değişiklikle yeniden plan

Yeniden üretirken önceki liste girdi olarak verilir ve ceza fonksiyonuna
**"önceki listeden sapma"** terimi eklenir. Etkilenen günler değişir,
gerisi yerinde kalır. Uygulanabilir: motor zaten `recompute` ile mevcut
ızgarayı okuyabiliyor, aylık veri (`MONTHS_DATA`) önceki listeyi zaten
saklıyor.

Beklenen sonuç: 1 boş gün isteği → %57.7 yerine ~%2-5 değişim.

### UYGULANDI (2026-08-19) — ölçülen sonuç

Üç parça birlikte gerekti; sadece ceza terimi eklemek **hiç işe yaramadı**:

1. **Ceza terimi** (`W.sadakat`) — tek başına etkisi %0. Ağırlık 35'ten
   1500'e çıkarıldı, değişim %19'da sabit kaldı: arama eski listeye
   *ulaşamıyordu*, çünkü onu hiç üretmiyordu. Ayrıca aday SIRALAMASI
   (`scoreResult`) da sadakati saymak zorundaydı; saymayınca cila
   yaklaştırdığı adayı sıralama geri eliyordu.
2. **Tohumlama** — önceki listedeki nöbetler, hâlâ geçerli oldukları
   sürece doğrudan yerine konur; greedy yalnız boşlukları doldurur.
   Çeşitlilik kaybolmasın diye adayların yarısı tohumsuz kurulur.
3. **Geri yaslanma** — kalan değişimin yarısı (34/66 hücre) saf bir
   *mesai günü kayması* idi: saat, nöbet, izin aynı; sadece mesai günü
   başka güne taşınmış. Hiçbir ölçüt bozulmadan geri alınabilenler eski
   gününe döndürülür.

| Senaryo | Önce | Sonra |
|---|---|---|
| 1 boş gün isteği eklendi | %57.9 | **%14.0** |
| 1 gün izin eklendi | %0.2 | %11.7 |
| 2 kişiye boş gün isteği | %59.5 | **%9.0** |
| 1 kişi gündüz isteği | %55.0 | **%9.3** |

Kalite bedeli yok: 295/295 test geçiyor, çok birimli takımda kapsama /
nöbet şekli / eksik saat ihlali 0, ortalama uyarı 1.27 (değişmedi).

### TAMAMLANDI (2026-08-19, ikinci tur) — hedef aşıldı

İlk turda %9-14'te takılmıştık. Aşama aşama ölçünce sebep tek bir
satırda çıktı: **tohum, nöbetlerin üçte birini yerleştiremiyordu**
(60 nöbetin 41'i). Reddedilme sebepleri sayıldığında:

```
red sebepleri: {"hücre dolu: HT": 16, "hücre dolu: RT": 2, "hücre dolu: NL": 1}
```

Hafta sonu hücreleri kurulumda `'HT'`, resmî tatil `'RT'` yazılı; tohum
greedy'nin `eligible()` denetimini kullandığı için "hücre boş değil"
deyip **bütün hafta sonu ve tatil nöbetlerini** eliyordu. (Aynı sınıfta
bir hata daha önce `devirAdaylari`'nda da çıkmıştı — hafta sonu hücresi
'HT' olduğu için hiçbir hafta sonu nöbeti devredilemiyordu.)

Tohuma kendi uygunluk denetimi yazıldı: HT/RT hücrelerine izin verir,
"7 günde en fazla 3 nöbet" gibi konfor eşiklerini aramaz (önceki liste
zaten kabul edilmiş bir listedir; gerçek sorun kalırsa yerel arama ve
onarım düzeltir). Tohumlama 41/60 → **59/60**.

| Senaryo | Başlangıç | 1. tur | 2. tur |
|---|---|---|---|
| 1 boş gün isteği | %57.9 | %14.0 | **%0.2** |
| 1 gün izin eklendi | %0.2 | %11.7 | **%0.2** |
| 2 kişiye boş gün isteği | %59.5 | %9.0 | **%0.7** |
| 1 kişi gündüz isteği | %55.0 | %9.3 | **%3.6** |

**Motor artık idempotent:** kendi çıktısını girdi olarak aldığında
420 hücrenin hiçbiri oynamıyor (önce 48 oynuyordu). Hedef %2-5 idi,
sonuç %0.2-3.6.

Kalite bedeli yok: 295/295 test, çok birimli takımda kapsama / nöbet
şekli / eksik saat ihlali 0, ortalama uyarı 1.27, adalet sapması
0.816 / 0.872 — hepsi değişmedi. Süre de artmadı (sıcak başlangıçlı
üretim biraz daha hızlı: 1169 ms / 1688 ms).

---

## 3. İkinci sorun: ayar yüzeyi

- **49 profil alanı**, arayüzde **104 alan kimliği**
- Bu oturumda eklenen: 12 yeni ayar (gündüz tavanı, nöbet zinciri, izin
  tavanı, boş gün düzeni, 5 denge önceliği, oto-denge, iki üst üste
  sınırı…)
- Her şikâyet bir ayar doğurdu. Kullanıcı geri bildirimi zaten bunu
  söylüyordu: *"kurallara eklemek zor olup kafa karışıklığı oluyor"*

Şu an bunu iki şey hafifletiyor ama çözmüyor:
- **Ayar denetimi** (12 kural) çakışmaları söylüyor
- **Oto-denge** 5 denge kaydırıcısını gereksizleştiriyor

### Yapılması gereken: ayarları KATMANLAMAK

- **Temel (5-6 ayar):** her gün kaç kişi, vardiya saatleri, aylık hedef.
  Bir birim kurmak için yeterli olmalı.
- **Gelişmiş (varsayılanı iyi olan ~15 ayar):** dinlenme, izin, koruma
  sınırları. Çoğu birim hiç açmamalı.
- **Uzman (kalan ~25):** denge çarpanları, öncelik sırası, indirgeme
  davranışı. "Oto-denge kapalıysa" gibi koşullarda görünür olmalı.

### UYGULANDI (2026-08-19)

Ayar ekranının üstüne **Temel / Gelişmiş / Uzman** çubuğu geldi
(varsayılan Temel, tercih tarayıcıda saklanır — birim profilinin parçası
değil, kişiye özel).

| Görünüm | Gizlenen alan |
|---|---|
| Temel | 30 |
| Gelişmiş | 17 |
| Uzman | 0 |

Temel görünümde 7 bölümün her birinde yalnız birimi kurmak için gereken
alanlar kalıyor (ör. *Çalışan koruması*: "en fazla kaç gün üst üste
çalışılabilir" + "boş günler nasıl verilsin"; nöbet zinciri, hafta sonu
tavanı, izin tavanı ve iki gelmeme sınırı gizli).

İki emniyet:

1. **Gizli ayar çalışmaya devam eder** — sadece görünmez. Çubukta bu
   açıkça yazıyor.
2. **Varsayılandan farklı ayarlanmış hiçbir alan gizlenmez.** Ölçüldü:
   `preLeaveGap` (Uzman) değiştirildiğinde Temel görünümde de kalıyor.
   Aksi halde listeyi etkileyen bir kural görünmez olurdu.

Seviye listesinde olmayan her alan **Temel** sayılır — sonradan eklenen
bir ayar kazara gizlenmesin. "Çakışan istekler" (öncelik sırası) bilerek
Temel bırakıldı: kullanıcı onu doğrudan istemişti.

---

## 4. Üçüncü sorun: gerçek veriyle test edilmiyor

Test tabanı **sentetik**: "P1…P14" isimli kurgusal kadrolar. Kullanıcının
gerçek birimleri (Anestezi, Yenidoğan Yakın İzlem) test setinde yok.
Bu yüzden şikâyetler ancak canlıda ortaya çıkıyor ve her seferinde
"önce yeniden üret, sonra ölç" döngüsü yaşanıyor.

### Yapılması gereken
Gerçek birimlerin **anonimleştirilmiş** kadro + kural profili (isimler
P1..Pn'e çevrilmiş) test setine eklenmeli. Böylece bir değişiklik
yapıldığında "Yenidoğan'da ne oluyor" sorusu saniyeler içinde
cevaplanır.

### YOL AÇILDI (2026-08-19) — dosyaları yönetici üretecek

Gerçek veriye erişmeden bu maddeyi tamamlamak mümkün değil; onun yerine
**mekanizma** kuruldu:

- Uygulamaya **"Anonim test dosyası"** düğmesi eklendi. Birimin kural
  profilini ve kadro YAPISINI indirir: isimler `P1..Pn`, birim adı /
  kullanıcı / not / sunucu bilgisi hiç yazılmaz; izin ve istek **gün
  numaraları** korunur (testin gerçekçiliği buna bağlı).
- `test-birimler.js` artık `test-profiller/` klasöründeki `*.json`
  dosyalarını sentetik profillerin yanında ölçüyor. Klasör boşsa hiçbir
  şey değişmez. Dosyada `P1..Pn` dışında bir ad görürse o ayı **ölçmez
  ve uyarır** — depo public olduğu için ikinci bir emniyet.

**Kalan iş kullanıcıda:** Anestezi ve Yenidoğan Yakın İzlem birimlerinde
düğmeye basıp inen dosyaları `test-profiller/` klasörüne koymak. O anda
madde tamamlanır.

---

## 5. Dördüncü sorun: sert/yumuşak kural ayrımı yok

Her şey ceza puanı. "Kapsama" 100.000, "adalet" 16 — ama ikisi de aynı
toplamda yarışıyor. Sonuç: teoride kapsama hiç bozulmamalı, pratikte
"çok büyük sayı" garantisi matematiksel bir garanti değil.

Ölçümde kapsama ihlali 0 çıkıyor (iyi), ama bu **şans değil tasarım**
olmalı: kapsama, hiçbir hamlenin bozamayacağı bir değişmez (invariant)
olarak kodlanmalı — ceza değil, kısıt.

### UYGULANDI (2026-08-19)

Önce **kapsama stres testi** yazıldı: 120 senaryo (6-16 kişi, 1-3
nöbetçi, dört izin/istek yoğunluğu). Rutin takımda 0 çıkan ihlal burada
çıktı — **3 örnekte 5 gün** ve hiçbiri yapısal değildi: her birinde o
gün boşta duran uygun kişi vardı. Örneğin 7 kişilik bir ayda 15. gün
Pazar **0/2** iken dört kişi boştaydı.

İki sebep bulundu ve düzeltildi:

1. **Kapsama garantisi "ertesi günü mesai olan" kişiyi eliyordu.** Oysa
   o mesai dinlenmeye çevrilebilir. Eklenen **kapsama son çare** fazı,
   kalan açıkları yalnız yumuşak engelleri esneterek kapatır; izin,
   kişinin kendi boş gün isteği ve arka arkaya nöbet yasağı burada da
   geçerlidir. Motorun kendi koyduğu *izin öncesi dinlenme* kilidi ise
   esnetilebilir — o bir konfor kuralı, kişinin isteği değil. Yapılan
   her esnetme listede not olarak yazılır, sessizce kural bükülmez.
2. **Açığın büyüklüğü sayılmıyordu.** "2 gerekirken 1" ile "2 gerekirken
   0" aynı puanı alıyordu; sıralama ikisi arasında kayıtsızdı ve bazen
   daha kötü olanı seçiyordu (ölçüldü: bir gün 1/2 iken seçilen adayda
   0/2 olmuştu). Artık ceza açık miktarıyla çarpılıyor.

**Sonuç: 5 gün → 3 gün, ve artık hiçbir gün 0 nöbetçi değil.**

Kalan 3 gün için tek tek bakıldı: her birinde engel **kullanıcının
onayladığı bir kural** — kişinin kendi boş gün isteği, nöbet sonrası
dinlenme, ya da "izin bitişi ile dönüş günü arasındaki hafta sonuna iş
yazılmaz" kuralı. Bunları kapsama uğruna kırmak bilerek yapılmadı;
uyarı olarak bildiriliyor ve kararı yönetici veriyor.

Kalite değişmedi: 295/295 test, çok birimli takımda kapsama / nöbet
şekli / eksik saat ihlali 0, ortalama uyarı 1.27, adalet 0.816 / 0.872.
Kararlılık da bozulmadı (idempotent, %0.2-3.6).

---

## 6. Beşinci sorun: onarım fazları birbirini bozuyor

Motorda 6 ayrı onarım fazı var (gün-aşırı, adalet, hafta sonu takası,
küme kırma, izin tavanı, mesai tamamlama). Bu oturumda bunları
"en iyiyi sakla" döngüsüne aldık ve düzeldi — ama bu bir yama.

Doğrusu: tek bir birleşik yerel arama, tüm hamle tiplerini (devir,
takas, tür değiştirme, mesai taşıma) aynı havuzda tutmalı. Şu anki
yapı, her yeni ihtiyaçta yeni bir faz eklemeye davet ediyor.

### DURUM (2026-08-19): ölçülebilir zarar kalmadı, borç duruyor

Bu maddenin somut zararı "onarım fazları önceki listeyi bozuyor"
sanılıyordu. Aşama aşama ölçüm bunu **doğrulamadı**: sıcak başlangıç
düzeldikten sonra her aşamada sapma 0:

```
  aşama                    sapma
  1-nöbet+kapsama            204   (mesai henüz yazılmadı)
  2-mesai dolgu               96
  3-yerel arama                0
  4-onarım turları             0
  5-fazla mesai dolgu          0
  6-mesai tamamlama            0
  7-geri yaslanma              0
```

Yani onarım fazları artık ölçülebilir bir kayıp üretmiyor. Mimari borç
(6 ayrı faz, her yeni ihtiyaçta bir yenisi) duruyor ama **acil değil**;
yeni bir onarım fazı eklemek gerektiğinde birleştirme o zaman yapılmalı.

---

## Öncelik sırası (etki / maliyet)

| # | İş | Etki | Maliyet |
|---|---|---|---|
| 1 | **Sıcak başlangıç** — yeniden üretimde önceki listeye sadık kal | **Çok yüksek** — kararsızlığın kökü | Orta |
| 2 | **Gerçek birim profillerini test setine al** | Yüksek — şikâyet döngüsünü kırar | Düşük |
| 3 | **Ayarları katmanla** (Temel / Gelişmiş / Uzman) | Yüksek — "kafa karışıklığı" | Düşük-orta |
| 4 | Kapsamayı kısıt olarak kodla (ceza değil) | Orta | Orta |
| 5 | Onarım fazlarını tek aramada birleştir | Orta — bakım kolaylığı | Yüksek |

**Önerim: 1 ve 2 ile başlamak.** Kararsızlık çözülmeden diğerleri
hissedilmez; gerçek veri olmadan da her değişiklik kör atış olur.
