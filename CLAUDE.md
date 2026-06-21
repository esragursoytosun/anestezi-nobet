# Anestezi Nöbet & Vardiya Planlayıcı — Proje Bağlamı

> ⚠️ GÜNCEL (2026-06-19): Eski tek-amaçlı **anestezi uygulaması (index.html'in eski hali + scheduler.js + test*.js) SİLİNDİ.** Yerini **NÖBET PLANLAMA ASİSTANI** aldı: `index.html` (artık asistan; eski `nobet-asistani.html` → köke yönlendirme) + `asistan-scheduler.js` (profil/birim-bazlı motor: çok-başlangıç + kapsama garantisi + yerel-arama/tavlama + eşit dağılım + ekstra-gün önceliği) + `server.js` `/api/asistan/*` (çok-kullanıcılı: admin + birim-bazlı yönetici + izolasyon, MongoDB doc `asistan_state`). Anestezi artık asistanda bir **Birim profili** olarak kurulur (varsayılan profil = eski anestezi kuralları). Eski anestezi MongoDB verisi (`anestezi_state`) ve server.js'teki eski `/api/login,/api/state,/api/users` uçları DURUYOR ama KULLANILMIYOR (zararsız). Aşağıdaki ESKİ bölümler tarihsel referanstır. Detay: memory/[[yenidogan-yakin-izlem-plan]].

Bu, anestezi teknikerleri için **aylık nöbet/vardiya listesi** üreten, tarayıcıda çalışan tek-sayfa araçtır. (SleepWell sohbetinde başlandı, artık kendi sohbetinde sürüyor.)

## Canlı & Repo
- **Canlı:** https://esragursoytosun.github.io/anestezi-nobet/ (GitHub Pages)
- **Repo:** https://github.com/esragursoytosun/anestezi-nobet (public, hesap: esragursoytosun, `gh` CLI bağlı)
- **Yerel:** `C:\Users\Esra\Desktop\OMNI_CORP\Output\yazilim\anestezi-nobet`

## Dosyalar
- `index.html` — UI + ızgara render + Excel/CSV + Yazdır. `scheduler.js`'i `?v=N` ile yükler (önbellek kırma — değişiklikte v'yi ARTIR).
- `scheduler.js` — saf JS planlama algoritması (`buildSchedule(config)`), Node ile test edilebilir (UMD export).
- `test*.js` — Node testleri (`node test.js`).
- `README.md` — kullanıcı kılavuzu.

## Deploy süreci
1. `index.html`/`scheduler.js` düzenle. scheduler.js değiştiyse `index.html`'deki `scheduler.js?v=N` sürümünü artır.
2. `git -C <yol> add -A && git -C <yol> commit && git -C <yol> push origin main`
3. Pages ~1-3 dk'da yayılır. Doğrula: `curl -s "https://esragursoytosun.github.io/anestezi-nobet/scheduler.js?x=$RANDOM" | grep ...`
4. Preview için: `.claude/launch.json`'da "anestezi" (port 8091, `serve`). Node ile mantık testi en hızlısı.

## KURALLAR (kullanıcı onaylı — hepsi kodda)
**Vardiya:** M8-17 = 8s gündüz · N08-08 = 24s nöbet · N16-08 = 16s akşam nöbeti.
**Sayılmayan kodlar:** N.İ (nöbet sonrası dinlenme), H.T (hafta sonu), R.T (resmi tatil), Yİ (yıllık izin), Ü.İ (ücretli izin — algoritma üretir, 176 dolunca kalan günler), OFF (haftalık sabit izin günü).

1. **Hedef = 8 × o ayın iş günü sayısı** (hafta içi, resmi tatil hariç). Temmuz 2026 = 184; 15 Tem tatil girilince 176. `baseTarget = 8 * workdayNums.length`.
2. **Hedeften düşenler:** yıllık izin + haftalık izin günü (gün başına 8s). Ücretli izin DÜŞMEZ (dolgu).
3. **Kimse fazla mesai yapmaz; boş hücre kalmaz** (176 dolunca kalan iş günleri Ü.İ olur).
4. **Her gün 2 nöbetçi** (tercihen 24s; saat tutturmak/boşluk kırmak için 16s'e inilebilir).
5. **Gündüz 08-17 minimumu:** her hafta içi **≥2**, **Salı/Perşembe ≥3**. Bu sayıya **N08-08 (24s) DAHİL** (08-17'yi kapsar), **N16-08 HARİÇ**, **Sorumlu HARİÇ**.
6. **Sorumlu** (`noNobet`): nöbet tutmaz, sadece gündüz mesai. Kısa ayda (iş günü<22) 176'ya ulaşamaz → bilgilendirici uyarı.
7. **Haftalık izin günü** (`offDay`, 0-6): kişiye özel (örn. biri Perşembe çalışmaz).
8. **Nöbet sonrası ertesi gün N.İ.** Hafta sonu nöbeti dengeli. **Üst üste en fazla 3 iş günü "gelmeme"** (N.İ+Ü.İ); 4. gün mutlaka iş. (Çözüm: nöbet yay + boşluk-odaklı mesai + gerekirse 24s→16s indirip mesai ekle.)
9. **Boş gün isteği** (`offReq`, elle gün no): o günlere ne nöbet ne mesai (kesin).
10. **Yıllık izin öncesi:** mümkünse 4 (olmazsa 3) iş günü önce NÖBET; **nöbetten izine kadar hafta sonu DAHİL hiç iş yok** (N.İ + Ü.İ).
11. **Yıllık izin dönüşü:** ilk İŞ GÜNÜ (hafta sonu değil) **ZORUNLU çalışma** (nöbet/mesai farketmez; baştan rezerve + taşınmaya karşı korumalı = `mustMesai` seti).
12. **Aylar arası devir** (`startNI`): önceki ayın son nöbetçisi yeni ayın 1. günü N.İ başlar.
13. **Resmi tatil:** UI ay seçilince Türkiye sabit tatillerini otomatik doldurur (Oca1, Nis23, May1+19, Tem15, Ağu30, Eki29). Dini bayram elle. Tatil hedeften düşer.
14. **Kişi listesi sıralanabilir** (↑/↓). Çıktı bu sırayı izler. İsimler serbest (varsayılan "Personel 1..14").

## FİZİBİLİTE
- **N≥12 kişi:** tüm kurallar 0 uyarı ile sağlanır.
- **N≤11:** matematiksel darboğaz (günde 2 nöbet + 176 tavanı + gündüz min aynı anda zor). N=10 alt sınır; N≤9 yapısal imkânsız (kapsama uyarısı). Az kişide algoritma 24s→16s indirip dengeler.

## ÖNEMLİ NOTLAR
- Kişi verileri tarayıcı **localStorage**'da (`anestezi_cfg`), repoya gitmez. Public repo'da gerçek isim yok.
- Kullanıcının tekrarlayan "değişmiyor/eklenmemiş/görünmedi" şikayetleri hep **tarayıcı önbelleğiydi** → `?v=N` sürümleme bunu çözdü; yine de Ctrl+F5 öner.
- Açık karar (kullanıcı erteledi): hafta sonu nöbeti Cmt+Paz aynı kişi mi; çıktının hastane yazılımına uyumu.
