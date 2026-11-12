# Panduan fitur operasional

## Migrasi cloud

Aplikasi terbaru memerlukan schema **6**. Untuk proyek versi awal yang sudah memiliki tabel POS, jalankan **0002_secure_sync.sql → 0003_inventory_reporting.sql → 0004_operations.sql → 0005_drawer_expenses.sql → 0006_split_bill.sql** melalui Supabase SQL Editor. Tunggu setiap file berhasil sebelum melanjutkan. Jangan mengulang migrasi yang sudah sukses. Proyek baru menjalankan 0001 terlebih dahulu. Semua file tersedia di Pengaturan → Pemeriksaan Kesiapan Kedai. Unduhan file tidak menerapkan migrasi.

Setelah migrasi, ikuti [pengaturan akun dan membership](production-setup.md), login cloud owner dan jalankan pemeriksaan kesiapan. Pemeriksaan harus menunjukkan schema 6 dan akses anonim ditolak. Pastikan tablet berisi data sumber yang benar sebelum sinkronisasi awal. Pengujian SQL lokal tidak membuktikan penerapan di proyek cloud.

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

Untuk meja yang tamunya membayar sendiri-sendiri: simpan pesanan ke dapur, buka meja dari denah, lalu ketuk **Pisah Bill**. Pilih item (dan jumlahnya) yang dibayar tamu tersebut, lalu **Bayar Item Terpilih**. Bagian itu menjadi pesanan lunas tersendiri dengan struk dan pembayarannya sendiri. Sisa item tetap terbuka di meja yang sama. Service charge, pajak dan diskon (dengan PIN owner) dihitung per bagian. Bagian terakhir dibayar dengan pembayaran biasa, lalu meja berpindah ke status bersih-bersih. Di KDS, item semua bagian tetap tampil dalam satu tiket meja. Fitur ini memerlukan migrasi `0006_split_bill.sql`.

## Salinan otomatis dan pemulihan dari cloud

Tablet membuat salinan lengkap otomatis sekali sehari dan setiap tutup shift. Tujuh salinan otomatis terakhir disimpan, ditambah salinan sebelum setiap restore. Daftarnya ada di **Pengaturan → Backup Data**. Salinan ini berada di tablet yang sama, jadi tetap unduh backup ke perangkat lain. Aplikasi juga meminta browser menyimpan data secara permanen (cek di Pemeriksaan Kesiapan). Pasang aplikasi ke layar utama agar izin ini lebih mungkin diberikan.

Bila tablet rusak atau hilang, siapkan tablet pengganti dan login sebagai owner (PIN demo lalu ganti). Buka **Pengaturan → Koneksi Cloud**, login akun cloud owner, lalu pilih perangkat lama. Ketuk **Periksa data cloud**, isi PIN baru untuk setiap staf, dan centang bahwa tablet lama tidak dipakai lagi. Setelah itu ketuk **Pulihkan data dari cloud**. Tablet pengganti melanjutkan ID perangkat lama. PIN dan pengaturan tablet (service charge, foto QRIS) tidak ada di cloud, jadi setiap staf wajib mengganti PIN saat login pertama dan pengaturan perlu diisi ulang. Sync dijeda setelah pemulihan. Periksa data, lalu aktifkan kembali dari Pengaturan. Data yang belum sempat tersinkron dari tablet lama tidak dapat dipulihkan dari cloud.
