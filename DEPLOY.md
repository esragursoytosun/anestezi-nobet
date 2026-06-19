# Ortak / Canlı Sürüm — Kurulum (Utopya benzeri)

Bu uygulama iki şekilde çalışır:

- **GitHub Pages (mevcut, statik):** Tek kişi, veriler yalnız o tarayıcıda (localStorage). Rozet: ⚪ Yerel.
- **Render.com (sunucu):** İki kişi **aynı anda** düzenler, değişiklikler **canlı senkron** olur ve bulutta saklanır. Rozet: 🟢 Ortak (canlı).

Aşağıdaki adımlar Render sürümü içindir (Utopya jüri projesindeki ile aynı mantık: Node sunucu + MongoDB).

---

## 1) MongoDB (ücretsiz, kalıcı veri) — MongoDB Atlas

> Atlas olmadan da çalışır: o zaman veriler sunucudaki `data/state.json` dosyasına yazılır.
> Render Free planda dosya her deploy'da sıfırlanır — bu yüzden kalıcılık için Atlas önerilir.

1. [mongodb.com/atlas](https://www.mongodb.com/atlas) → ücretsiz hesap → **Free (M0)** cluster oluştur.
2. **Database Access** → bir kullanıcı (kullanıcı adı + şifre) oluştur.
3. **Network Access** → `0.0.0.0/0` (her yerden erişim) ekle.
4. **Connect → Drivers** → bağlantı dizesini kopyala:
   `mongodb+srv://KULLANICI:SIFRE@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority`
   (Bu, aşağıda `MONGODB_URI` olarak girilecek.)

## 2) Kodu GitHub'a (zaten var: `esragursoytosun/anestezi-nobet`)

Bu repo `git push` ile güncel. Render bu repoyu otomatik çeker.

## 3) Render Web Service

1. [render.com](https://render.com) → GitHub ile giriş.
2. **New → Web Service** → `anestezi-nobet` reposunu seç.
3. Ayarlar:
   - **Region:** Frankfurt
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (yeterli)
4. **Environment** → **Add Environment Variable**:
   - **Key:** `MONGODB_URI` · **Value:** (1. adımdaki bağlantı dizesi)
     *(Atlas kullanmıyorsanız bu adımı atlayın; dosya moduna düşer.)*
   - **Key:** `APP_PASSWORD` · **Value:** (yönetici şifresi — kendi belirlediğiniz gizli bir söz)
     ❗ **ÖNEMLİ:** Bunu mutlaka değiştirin. Ayarlamazsanız varsayılan `anestezi2026` olur ve bu kod
     herkese açık repoda görünür. Bu, **yönetici** (`admin`) kullanıcısının ilk şifresidir.
   - *(İsteğe bağlı)* **Key:** `ADMIN_USER` · **Value:** yönetici kullanıcı adı (varsayılan `admin`).

   **Giriş ve kullanıcılar:** İlk girişte **kullanıcı adı: `admin`** (veya `ADMIN_USER`), **şifre: `APP_PASSWORD`**.
   Giriş yaptıktan sonra sağ üstteki **⚙️ Ayarlar**'dan kendi şifrenizi değiştirebilir, **yeni kullanıcılar
   ekleyip silebilirsiniz** (arkadaşınıza ayrı kullanıcı adı/şifre verin). Herkes kendi adıyla girer;
   "kim güncelledi" bilgisinde kullanıcı adı görünür.
5. **Create Web Service** → ~2-3 dk'da `https://anestezi-nobet.onrender.com` gibi bir adres verir.

## 4) Kullanım

- O adresi **iki kişi** de açar; **parola** sorulur (`APP_PASSWORD`). Girince sağ üstte **🟢 Ortak (canlı)** görünür. (Tarayıcı parolayı hatırlar; "Çıkış" ile çıkılır.)
- Biri değişiklik yapıp **Liste Oluştur** der ya da bir hücreyi elle değiştirir → ~2.5 sn içinde diğerinin ekranı kendiliğinden güncellenir ("Arkadaşınız güncelledi ↻").
- Aynı anda farklı şeyler değiştirirseniz **son kaydeden** geçerli olur; çakışmamak için kabaca aynı bölümü aynı anda düzenlemeyin.

## Notlar

- Render Free plan ~15 dk hareketsizlikte uykuya geçer; ilk açılış birkaç saniye sürebilir.
- Gerçek isimler **MongoDB'nizde** (sizin hesabınız) saklanır; herkese açık repoya gitmez.
- `data/` ve `node_modules/` git'e gönderilmez (`.gitignore`).
