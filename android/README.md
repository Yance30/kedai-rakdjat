# Aplikasi Android (TWA)

Folder ini berisi proyek Android yang membungkus aplikasi web di
https://yance30.github.io/kedai-rakdjat/ menjadi APK. Proyek dibuat dengan Bubblewrap
(Trusted Web Activity). Aplikasi berjalan di Chrome, sehingga printer Bluetooth, mode offline dan
update otomatis dari GitHub Pages tetap berfungsi.

- Package: `io.github.yance30.kedairakdjat`
- Minimal Android 7.0 (API 24). Tablet harus memiliki Google Chrome.
- Isi aplikasi diambil dari GitHub Pages. Perubahan fitur cukup di-push ke `main`; APK **tidak** perlu dibangun ulang.
  Bangun ulang APK hanya bila nama, ikon, warna atau alamat aplikasi berubah.

## Kunci tanda tangan

Keystore dan password-nya berada di `C:\Users\yansg\kedai-rakdjat-signing\`, di luar repo dan tidak pernah di-commit.
Simpan salinannya di tempat aman. Tanpa keystore yang sama, APK versi baru tidak bisa dipasang di atas versi lama;
aplikasi harus dihapus dulu, dan data kasir di tablet ikut terhapus.

## Verifikasi domain (menghilangkan address bar)

Android hanya menampilkan aplikasi layar penuh bila domain membuktikan bahwa APK ini miliknya. Caranya, letakkan
[`assetlinks.json`](assetlinks.json) di **https://yance30.github.io/.well-known/assetlinks.json**:

1. Buat repo baru bernama persis `yance30.github.io` (publik).
2. Tambahkan file `.well-known/assetlinks.json` (isi dari folder ini) dan file kosong `.nojekyll` di root repo.
3. Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Pastikan alamat di atas menampilkan isi JSON, lalu tutup dan buka kembali aplikasi di tablet.

Sebelum langkah ini selesai, aplikasi tetap berjalan, tetapi menampilkan bilah alamat kecil di bagian atas.

## Membangun ulang APK

Perlu JDK 17 dan Android SDK (sudah ada di komputer pengembang).

```sh
cd android
echo sdk.dir=C:/Users/yansg/AppData/Local/Android/Sdk > local.properties
# naikkan appVersionCode/versionCode dan versionName di app/build.gradle terlebih dahulu
gradlew.bat assembleRelease
BT=%LOCALAPPDATA%/Android/Sdk/build-tools/35.0.0
%BT%/zipalign -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
%BT%/apksigner sign --ks C:/Users/yansg/kedai-rakdjat-signing/kedai-rakdjat.keystore --ks-key-alias kedai-rakdjat --out kedai-rakdjat.apk aligned.apk
```

`apksigner` meminta password dari `PASSWORD-keystore.txt`.
