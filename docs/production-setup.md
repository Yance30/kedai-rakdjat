# Penerapan keamanan dan keandalan POS

Panduan versi terbaru: [menu, pengeluaran, diskon, stok opname, backup dan migrasi schema 4](operasional.md).

Perubahan aplikasi tersedia di repository. Migrasi SQL tidak otomatis diterapkan ke proyek Supabase. Backup data tablet dan database cloud sebelum penerapan. Lakukan di luar jam transaksi dan tutup tab aplikasi versi lama agar tidak memakai jalur sinkronisasi lama.

## 1. Database dan akun cloud

1. Untuk proyek baru, jalankan `supabase/migrations/0001_init.sql`, lalu `0002_secure_sync.sql`, `0003_inventory_reporting.sql`, dan `0004_operations.sql` sebelum menghubungkan aplikasi. Untuk proyek versi awal yang sudah memiliki tabel POS, jalankan 0002 lalu 0003 lalu 0004. Jangan mengulang migrasi yang sudah berhasil. Masing-masing migrasi berjalan dalam satu transaksi. File 0002, 0003 dan 0004 juga bisa diunduh dari Pengaturan bagian diagnostik. Buka proyek yang sesuai di dashboard Supabase, pilih SQL Editor, tempel isi file dan jalankan berurutan. Dashboard yang terbuka belum membuktikan migrasi selesai.
2. Buat akun email/password owner, cashier, dan kitchen melalui Supabase Authentication. Tidak ada pendaftaran mandiri dari aplikasi.
3. Catat UUID masing-masing akun dari Authentication. Catat **ID tablet ini** dari Pengaturan → Akun Cloud pada tablet kasir.
4. Jalankan SQL berikut sebagai administrator, mengganti placeholder dengan UUID dan ID tablet yang benar:

```sql
insert into public.cloud_memberships (user_id, device_id, role) values
  ('UUID_OWNER', 'ID_TABLET_KASIR', 'owner'),
  ('UUID_KASIR', 'ID_TABLET_KASIR', 'cashier'),
  ('UUID_DAPUR', 'ID_TABLET_KASIR', 'kitchen');
```

Keanggotaan akun dapur dan owner menunjuk ID tablet kasir yang dipantau, bukan ID laptop/tablet pemantau. Satu akun bisa diberi akses ke beberapa perangkat, dengan data layar difilter ke perangkat yang dipilih. Pengguna tidak dapat mengubah membership sendiri.

5. Isi URL dan **publishable/anon key**, bukan service-role/secret key, pada Pengaturan. Login cloud sebagai owner di tablet kasir dan lakukan **Sync Sekarang** pertama kali. Ini merekonsiliasi data cloud perangkat tersebut dengan data tablet, termasuk menghapus sisa item dari versi lama. Pastikan tablet ini berisi data sumber yang benar.
6. Setelah bootstrap, keluar dari akun cloud owner di tablet dan login akun cloud cashier melalui Pengaturan. Login PIN lokal dan akun cloud adalah dua hal berbeda. Owner perlu login cloud lagi saat melakukan perubahan menu/staf atau pemulihan data; batch tersebut ditolak untuk akun cashier.
7. Pada perangkat owner/dapur, gunakan **Login Cloud Owner / Dapur** dari layar login. Tidak perlu membuka shift atau memakai PIN kasir. Isi koneksi jika belum tersedia, lalu login dan pilih perangkat.

| Akun cloud | Hak akses |
| --- | --- |
| Tanpa login / anon | Tidak dapat mengakses tabel POS atau RPC |
| Owner | Baca data perangkat, bootstrap, sinkronisasi, melihat audit server, progres dapur |
| Cashier | Baca data operasional perangkat, sinkronisasi transaksi/shift/meja; tidak dapat mengubah menu/staf, membership, atau log server |
| Kitchen | Baca pesanan/item/meja perangkat; progres dapur hanya melalui RPC khusus |

Semua penulisan cloud lewat RPC yang memeriksa membership. Progres dapur tidak dapat ditimpa sinkronisasi tablet. `cloud_change_log` mencatat akun cloud, waktu server, dan perubahan; tidak dapat dihapus oleh akun aplikasi. PIN dan hash PIN tidak disinkronkan. Key publik bukan rahasia pengaman; perlindungan berasal dari autentikasi dan kebijakan database.

## 2. Sinkronisasi dan kondisi offline

Data tablet tetap menjadi sumber utama. Snapshot terakhir yang sudah diakui cloud disimpan di IndexedDB; selisih terhadap data sekarang membentuk antrean perubahan yang tahan reload. Hanya penambahan, perubahan, dan penghapusan yang dikirim. Satu batch diterapkan dalam satu transaksi SQL sehingga item/order/payment tidak terpublikasi sebagian.

Sync memakai satu kunci lintas tab. Kegagalan tidak menghapus antrean. Saat aplikasi terbuka, retry bertahap berjalan hingga interval 60 detik dan dipercepat ketika koneksi kembali. Setelah sukses, pemeriksaan berikutnya setiap 5 detik. Browser yang ditutup tidak menjalankan retry; buka aplikasi untuk melanjutkan. Batas satu batch adalah 50.000 perubahan, bukan solusi untuk migrasi dataset besar tanpa penyesuaian.

Gunakan Chrome/Edge melalui HTTPS (localhost hanya untuk pengembangan). Web Crypto, Web Locks, service worker, dan Bluetooth memerlukan lingkungan yang sesuai. Pembaruan PWA menunggu pergantian sesi; tutup semua tab lalu buka kembali setelah pekerjaan kasir selesai.

## 3. PIN, pembayaran, refund, dan shift

- PIN lama dimigrasi ke PBKDF2-SHA256 dengan salt acak ketika berhasil diverifikasi. PIN demo wajib diganti sebelum masuk; lima kegagalan PIN menyebabkan jeda satu menit. Ini perlindungan akses lokal pada perangkat tepercaya, bukan pengganti autentikasi server atau keamanan perangkat.
- Pembayaran memiliki request ID unik, pemeriksaan status pesanan, serta transaksi database atomik. Klik berulang tidak menambah pembayaran untuk checkout yang sama.
- Riwayat menyediakan pembatalan pesanan terbuka dan **refund penuh pada shift berjalan**. Wajib alasan, PIN owner, serta konfirmasi uang sudah dikembalikan melalui metode semula. Aplikasi tidak mengirim refund QRIS otomatis dan belum mendukung refund sebagian atau lintas shift.
- Pembayaran asli tetap tersimpan; status void dan catatan audit menjelaskan koreksinya. Rekonsiliasi mengeluarkan pembayaran pesanan yang sudah dibatalkan/refund. Tutup shift membaca ulang data dalam transaksi dan menolak pesanan terbuka atau selisih tanpa persetujuan.
- Status keberhasilan pembayaran terpisah dari hasil cetak. Jika cetak gagal, jangan ulangi pembayaran.

## 4. Backup dan pemulihan

Export memakai format berversi, metadata waktu, dan ID perangkat asal. File berisi data usaha serta hash PIN; simpan secara aman. Kredensial login cloud tidak ikut, konfigurasi cloud/identitas perangkat tidak diimpor.

Import memeriksa struktur, versi, ID duplikat, relasi, nilai rupiah, rincian pesanan, pembayaran ganda, dan jejak audit. Backup lama hanya diterima jika seluruh bagian wajib lengkap. JSON kosong atau parsial ditolak sebelum data diubah. Batas file 30 MB.

Sebelum mengganti data, aplikasi menyimpan salinan data sebelumnya dalam tabel lokal `recovery` di transaksi yang sama. Jika ada kegagalan, seluruh penggantian dibatalkan. Salinan terakhir bisa diunduh melalui **Unduh salinan sebelum restore terakhir**, kemudian dipulihkan lewat Import Backup. Salinan lokal tidak melindungi dari kerusakan/hilangnya tablet; tetap simpan export di perangkat lain.

Setelah restore, aplikasi reload dan sync otomatis dijeda. Periksa data, login cloud sebagai owner, lalu **Aktifkan kembali sync** untuk menyelaraskan cloud dengan hasil restore. ID perangkat tujuan dipertahankan. Untuk penggantian tablet, berikan membership ke ID tablet baru; jangan membuat dua tablet aktif dengan identitas yang sama. Jalankan restore tanpa tab kasir lain yang aktif agar tidak ada layar dengan data lama.

## 5. Verifikasi

### Fitur operasional tambahan

- **Keranjang otomatis:** tersimpan lokal per shift dan meja/kasir, dipulihkan setelah reload atau login kembali. Tab dengan revisi keranjang lama ditolak agar tidak menimpa perubahan tab lain. Keranjang kosong dihapus saat checkout berhasil; shift tidak bisa ditutup selama masih ada keranjang berisi barang. Draf tidak masuk backup dan dihapus saat restore.
- **Riwayat → Cetak salinan:** mencetak rincian transaksi tersimpan dengan label SALINAN, tanpa membuat pembayaran baru. Cetak ulang yang berhasil dikirim dicatat dalam audit; ini bukan bukti kertas fisik sudah keluar.
- **Laporan Penjualan / Dashboard Owner:** rentang tanggal WIB, pilihan kasir, ringkasan pembayaran, HPP dan ekspor CSV. Refund mengikuti tanggal pembayaran asal. Estimasi margin bahan belum termasuk gaji, sewa atau biaya operasional lain; menu tanpa resep tidak diberi margin seolah HPP-nya nol.
- **Stok & Resep (owner):** bahan dalam satuan dasar bulat gram/ml/buah, pembelian dengan biaya rata-rata, penyesuaian beralasan, resep per porsi dan batas stok minimum. Stok berkurang atomik saat pembayaran, bukan saat tiket dikirim ke dapur. Stok tidak cukup membatalkan seluruh pembayaran. Refund hanya mengembalikan stok jika bahan belum terpakai dan opsi pengembalian dipilih; jumlah mengikuti transaksi asal, bukan resep yang kemudian diubah.
- **Backup versi 2:** mencakup bahan, resep dan buku mutasi stok, dengan validasi relasi dan saldo. Backup versi 1 tetap dapat dibaca tanpa data inventori.
- **Pengaturan → diagnostik:** memeriksa kesiapan browser, versi schema cloud, membership dan akses anonim; menyediakan berkas migrasi dan cetak uji printer. Sync menahan antrean sampai schema versi 4 tersedia.

Perubahan bahan/resep membutuhkan akun cloud owner saat sinkronisasi. Akun kitchen tidak memiliki akses bahan dan biaya persediaan.

```bash
npm install
npm test
npm run build
npm run test:e2e
```

Unit/integrasi menggunakan IndexedDB simulasi dan PostgreSQL WASM (PGlite), termasuk migrasi SQL sebenarnya, RLS, kegagalan batch, retry, pembayaran ganda, refund, rekonsiliasi, rollback restore, PIN, draf, HPP, buku stok, CSV dan penolakan schema lama. Pengujian browser memakai Chrome terpasang dan server preview hasil build, service worker produksi, mode offline, printer Bluetooth simulasi berhasil/gagal, serta viewport tablet landscape dan portrait.

Uji penerimaan di kedai tetap diperlukan: perangkat Android sebenarnya, printer thermal dan lebar kertas, akun Supabase produksi, mati/nyala tablet, login cloud kedaluwarsa, koneksi putus-sambung, serta restore dari export yang disimpan di perangkat lain. Pengujian lokal tidak membuktikan migrasi sudah diterapkan ke cloud produksi atau printer fisik telah berfungsi.

Rujukan: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [login password](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).
