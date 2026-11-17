# Panduan fitur operasional

## Migrasi cloud

Aplikasi terbaru memerlukan schema **7**. Untuk proyek versi awal yang sudah memiliki tabel POS, jalankan **0002_secure_sync.sql → 0003_inventory_reporting.sql → 0004_operations.sql → 0005_drawer_expenses.sql → 0006_split_bill.sql → 0007_queue_numbers.sql** melalui Supabase SQL Editor. Tunggu setiap file berhasil sebelum melanjutkan. Jangan mengulang migrasi yang sudah sukses. Proyek baru menjalankan 0001 terlebih dahulu. Semua file tersedia di Pengaturan → Pemeriksaan Kesiapan Kedai. Unduhan file tidak menerapkan migrasi.

Setelah migrasi, ikuti [pengaturan akun dan membership](production-setup.md), login cloud owner dan jalankan pemeriksaan kesiapan. Pemeriksaan harus menunjukkan schema 7 dan akses anonim ditolak. Pastikan tablet berisi data sumber yang benar sebelum sinkronisasi awal. Pengujian SQL lokal tidak membuktikan penerapan di proyek cloud.

## Menu

Kelola Menu tersedia untuk owner: tambah/edit nama, kategori, harga, foto JPEG/PNG/WebP, arsipkan menu, atau tandai habis sementara. Foto diperkecil dan disimpan offline. Item keranjang mempertahankan harga asal; perubahan harga berlaku untuk item baru. Checkout memeriksa kembali ketersediaan dan menolak menu habis, termasuk dari draf lama.

## Biaya dan laporan

Pengeluaran mencatat tanggal WIB, kategori, keterangan dan nominal. Pembatalan membutuhkan alasan dan mempertahankan riwayat. Biaya berasal dari kas operasional terpisah, tidak mengurangi laci kas shift. Pembelian bahan hanya dicatat di Stok & Resep; jangan dicatat kembali sebagai pengeluaran karena dihitung melalui HPP.

Estimasi laba operasional pada Laporan Penjualan dan Dashboard Owner = penjualan setelah diskon tanpa pajak/service − HPP − pengeluaran − kerugian/koreksi stok. Koreksi stok positif mengurangi kerugian bersih. Laba ditampilkan untuk semua kasir karena biaya tidak dialokasikan per kasir. HPP tidak lengkap tetap ditandai; biaya yang belum dicatat belum diperhitungkan. Refund mengikuti tanggal pembayaran asal.

## Bahan terbuang dan stok opname

Di Stok & Resep, masukkan jumlah rusak/terbuang atau jumlah fisik aktual. Alasan wajib dan saldo tidak boleh negatif. Jika saldo berubah sejak pemilihan bahan, penyimpanan ditolak: pilih ulang dan hitung kembali. Hentikan sementara transaksi bahan terkait saat penghitungan. Buku mutasi menyimpan waktu, identitas owner, alasan dan selisih.

## Diskon

Buka Diskon dengan PIN owner di kasir, pilih rupiah atau persen, masukkan alasan dan PIN owner. Diskon harus kurang dari subtotal dan diterapkan sebelum service/pajak. Persetujuan, nominal dan alasan dicatat atomik bersama pembayaran. Struk termasuk salinan menampilkan diskon.

Diskon diberikan saat pembayaran; simpan ke dapur tanpa diskon dahulu. Perubahan keranjang atau reload menghapus isian diskon dan PIN agar meminta persetujuan baru. PIN tidak disimpan dalam draf, backup atau cloud. PIN lokal bukan bukti otorisasi kriptografis di server; tablet kasir harus tetap perangkat tepercaya.

## Panduan dan backup

Checklist persiapan ditandai manual oleh owner dan bukan bukti verifikasi perangkat/cloud. Pengingat muncul jika belum ada unduhan backup dalam 24 jam. Waktu yang ditampilkan adalah waktu unduhan dimulai, bukan jaminan file tersimpan. Periksa folder unduhan dan simpan salinan di perangkat lain.

Backup versi 3 mencakup pengeluaran, menu, diskon dan mutasi stok. Versi 1/2 tetap dapat diimpor. Draf keranjang tidak ikut backup. Restore menghapus penanda unduhan terakhir dan menjeda sync.

Perubahan menu, pengeluaran, resep dan stok opname memerlukan login cloud owner ketika sinkronisasi. Data tetap tersimpan lokal jika akun/migrasi belum siap. Akun cashier dan kitchen tidak dapat membaca pengeluaran cloud.

## Pisah bill

Kedai tidak memakai pengaturan meja: semua pesanan (dine-in atau takeaway) dibuat dan langsung dibayar dari layar **Kasir**. Aplikasi tidak lagi memiliki layar dapur (KDS); pesanan diteruskan ke dapur lewat tiket dapur yang dicetak.

**Nomor antrean dan nama pelanggan.** Setiap pesanan mendapat nomor antrean otomatis yang dimulai lagi dari 1 setiap shift. Nama pelanggan boleh diisi (opsional, maksimal 30 karakter). Nomor dan nama tampil besar di layar sukses, tiket dapur, dan struk, sehingga pelayan bisa memanggil atau mengantar pesanan.

**Pisah Bayar.** Untuk rombongan yang membayar sendiri-sendiri: masukkan semua pesanan, ketuk **Pisah Bayar**, pilih item (dan jumlahnya) yang dibayar tamu pertama, lalu **Bayar Item Terpilih**. Bagian itu menjadi pesanan lunas tersendiri dengan struk dan tiket dapurnya sendiri. Sisa item tetap di keranjang dengan nomor antrean dan nama yang sama (tetap aman walau aplikasi ditutup), lalu dibayar dengan cara yang sama. Service charge, pajak dan diskon (dengan PIN owner) dihitung per bagian. Shift tidak bisa ditutup selama sisa keranjang belum dibayar atau dikosongkan.

**Pesanan meja dari versi lama.** Jika tablet masih menyimpan pesanan meja dari versi sebelumnya yang belum dibayar, muncul pita kuning di atas Kasir; ketuk **Selesaikan** untuk melunasinya. Shift tidak bisa ditutup selama pesanan tersebut belum lunas.

## Salinan otomatis dan pemulihan dari cloud

Tablet membuat salinan lengkap otomatis sekali sehari dan setiap tutup shift. Tujuh salinan otomatis terakhir disimpan, ditambah salinan sebelum setiap restore. Daftarnya ada di **Pengaturan → Backup Data**. Salinan ini berada di tablet yang sama, jadi tetap unduh backup ke perangkat lain. Aplikasi juga meminta browser menyimpan data secara permanen (cek di Pemeriksaan Kesiapan). Pasang aplikasi ke layar utama agar izin ini lebih mungkin diberikan.

Bila tablet rusak atau hilang, siapkan tablet pengganti dan login sebagai owner (PIN demo lalu ganti). Buka **Pengaturan → Koneksi Cloud**, login akun cloud owner, lalu pilih perangkat lama. Ketuk **Periksa data cloud**, isi PIN baru untuk setiap staf, dan centang bahwa tablet lama tidak dipakai lagi. Setelah itu ketuk **Pulihkan data dari cloud**. Tablet pengganti melanjutkan ID perangkat lama. PIN dan pengaturan tablet (service charge, foto QRIS) tidak ada di cloud, jadi setiap staf wajib mengganti PIN saat login pertama dan pengaturan perlu diisi ulang. Sync dijeda setelah pemulihan. Periksa data, lalu aktifkan kembali dari Pengaturan. Data yang belum sempat tersinkron dari tablet lama tidak dapat dipulihkan dari cloud.

## Peringatan stok menipis

Bahan aktif yang stoknya sama dengan atau di bawah **Stok minimum** muncul di pita kuning di atas layar **Kasir** (untuk semua staf) dan di **Dashboard Owner**. Pita menyebut menu yang memakai bahan tersebut; menu bertulisan **Bahan tidak cukup untuk** berarti sisa bahan kurang dari kebutuhan satu porsi. Aplikasi tidak memblokir penjualan menu tersebut. Tandai menu habis di Kelola Menu bila memang tidak bisa dibuat. Owner dapat mengetuk **Buka Stok & Resep** untuk mencatat pembelian. Peringatan berasal dari data stok di tablet ini.

## Layar tetap menyala

Selama ada staf yang login, aplikasi meminta browser agar layar tablet tidak redup atau terkunci, sehingga layar Kasir tetap terlihat. Izin ini otomatis dilepas saat aplikasi ditutup atau berpindah ke aplikasi lain, lalu diminta lagi saat kembali. Mode hemat baterai atau browser lama bisa menolak permintaan ini; layar lalu mengikuti pengaturan tablet biasa. Sambungkan tablet ke charger selama jam buka.

## Jam ramai, menu terlaris dan pelanggan tetap

**Laporan Penjualan** menampilkan **Jam Ramai** (penerimaan per jam WIB dan jam tersibuk), **Menu Terlaris** (lima menu dengan porsi terbanyak) dan **Pelanggan Tetap** dalam rentang tanggal yang dipilih. Dashboard Owner menampilkan Jam Ramai dan Pelanggan Tetap dari data cloud. Pelanggan tetap disusun dari nama yang diisi kasir: huruf besar/kecil dan spasi berlebih disamakan, dan bagian pisah bayar dihitung satu kunjungan. Nama yang sama bisa saja milik orang berbeda, jadi daftar ini hanya perkiraan. Data pelanggan cloud memerlukan migrasi 0007.

## Peringatan migrasi cloud

Jika database cloud belum memakai migrasi yang dibutuhkan versi aplikasi ini, sinkronisasi berhenti dan owner melihat pita merah **Sinkronisasi cloud berhenti** di atas setiap layar. Transaksi tetap tersimpan di tablet. Ketuk **Buka Pemeriksaan Kesiapan**, unduh migrasi yang belum diterapkan dan jalankan di Supabase SQL Editor. Pita hilang setelah sinkronisasi berikutnya berhasil.

## Menghapus menu dan staf

Di **Kelola Menu**, ketuk **Hapus** di baris menu. Menu yang belum pernah terjual dihapus beserta resepnya. Menu yang sudah pernah terjual diarsipkan, sehingga hilang dari kasir dan daftar, tetapi riwayat penjualan, laporan dan HPP tetap mencatatnya. Menu yang diarsipkan bisa dilihat lewat **Tampilkan menu diarsipkan**, lalu diaktifkan lagi melalui Edit.

Di **Pengaturan → Staf & Akses Login**, ketuk **Hapus** di baris staf. Akun yang belum pernah dipakai dihapus. Staf yang pernah bertugas (shift, transaksi, diskon, pengeluaran atau stok) dinonaktifkan dan disembunyikan, agar namanya tetap tercatat di riwayat. Owner tidak dapat menghapus akunnya sendiri, dan minimal harus ada satu owner aktif. Penghapusan ikut tersinkron ke cloud saat akun cloud owner login.
