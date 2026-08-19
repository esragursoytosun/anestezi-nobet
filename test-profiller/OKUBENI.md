# Gerçek birim profilleri (anonim)

Bu klasöre konan `*.json` dosyaları `node test-birimler.js` çalıştırıldığında
sentetik profillerin yanında **ayrıca** ölçülür. Klasör boşsa hiçbir şey
değişmez.

## Dosya nasıl üretilir

1. Uygulamada ilgili birimi açın.
2. Üst çubuktaki **"Anonim test dosyası"** düğmesine basın.
3. İnen `anonim-profil-*.json` dosyasını bu klasöre koyun.

## İçinde ne var, ne yok

**Var:** kural profili (vardiya saatleri, gündüz sayıları, tavanlar,
denge ağırlıkları), kadro yapısı (kaç kişi, kim sorumlu/kıdemli/sadece
gündüz), izin ve istek **gün numaraları**, resmi tatiller.

**Yok:** isim (herkes `P1`, `P2`… olur), birim adı, kullanıcı bilgisi,
notlar, sunucu/hesap bilgisi. Takım, dosyada `P1..Pn` dışında bir ad
görürse o ayı ölçmez ve uyarır.

## Neden gerekli

Şikâyetlerin çoğu sentetik profillerde değil gerçek birimlerde çıkıyordu
(bkz. `ANALIZ.md` §4). Bu dosyalar konduğunda "şu değişiklik Yenidoğan'da
ne yapıyor" sorusu saniyeler içinde cevaplanır — canlıda denemeye gerek
kalmaz.

> Depo public. Dosyalar isimsiz olduğu için sorun yok, ama yine de
> koymadan önce bir kez açıp `"name"` alanlarının `P1`, `P2`… olduğunu
> doğrulayın.
