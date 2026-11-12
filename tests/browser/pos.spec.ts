import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function login(page: Page, pin: string, staff = 'Budi Santoso') {
  await page.getByRole('button', { name: new RegExp('^' + staff) }).click();
  for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: /^Login →/ }).click();
}
async function counts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kedai-rakdjat-pos'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const result: Record<string, number> = {};
    for (const table of ['orders', 'payments', 'audit']) result[table] = await new Promise<number>((resolve, reject) => {
      const req = db.transaction(table).objectStore(table).count(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    db.close(); return result;
  });
}
test('PIN demo, pembayaran offline dengan printer gagal, reload PWA, refund, tutup shift', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const characteristic = { properties: { write: true }, writeValue: async () => { throw new Error('Printer disconnected'); }, writeValueWithoutResponse: async () => { throw new Error('Printer disconnected'); } };
    const server = { connected: true, connect: async () => server, getPrimaryServices: async () => [{ getCharacteristics: async () => [characteristic] }] };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => ({ name: 'Test Printer', gatt: server, addEventListener: () => {} }) } });
  });
  await page.goto('/');
  await login(page, '1234');
  await expect(page.getByText('Ganti PIN demo terlebih dahulu')).toBeVisible();
  await page.getByLabel('PIN baru', { exact: true }).fill('987654');
  await page.getByLabel('Ulangi PIN', { exact: true }).fill('987654');
  await page.getByRole('button', { name: 'Simpan PIN & masuk' }).click();
  await page.getByRole('button', { name: 'Hubungkan Printer' }).click();
  await expect(page.getByRole('button', { name: 'Printer: Test Printer' })).toBeVisible();
  // Ensure the actual production service worker controls the page before offline reload.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.getByRole('button', { name: '+ Tambah', exact: true }).first().click();
  await page.getByRole('button', { name: 'Lanjut ke Pembayaran' }).click();
  await page.getByRole('button', { name: 'Uang Pas' }).click();
  await page.getByRole('button', { name: 'Konfirmasi Pembayaran' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText('Pembayaran Berhasil', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'struk gagal dicetak' })).toBeVisible();
  expect(await counts(page)).toEqual({ orders: 1, payments: 1, audit: 1 });
  await page.screenshot({ path: 'test-results/offline-payment.png', animations: 'disabled' });
  await page.reload();
  await login(page, '987654');
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.getByRole('button', { name: 'Refund penuh', exact: true }).click();
  await page.getByLabel('Alasan pembatalan').fill('Pelanggan membatalkan pesanan');
  await page.getByPlaceholder('PIN owner').fill('987654');
  await page.getByLabel('Uang sudah dikembalikan seluruhnya melalui metode semula').check();
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByText('VOID', { exact: true })).toBeVisible();
  expect(await counts(page)).toEqual({ orders: 1, payments: 1, audit: 2 });
  await page.getByRole('button', { name: 'Keuangan', exact: true }).click();
  await page.getByRole('button', { name: 'Tutup Shift & Simpan Z-Report' }).click();
  await expect(page.getByText('Selamat Datang', { exact: true })).toBeVisible();
  expect(await counts(page)).toEqual({ orders: 1, payments: 1, audit: 3 });
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
test('portal cloud tanpa login tidak membuat transaksi kasir', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Login Cloud Owner / Dapur' }).click();
  await expect(page.getByRole('button', { name: 'Login Cloud', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email cloud')).toBeVisible();
  expect(await counts(page)).toEqual({ orders: 0, payments: 0, audit: 0 });
});

async function setupOwner(page: Page) {
  await page.goto('/');await login(page,'1234');
  await page.getByLabel('PIN baru',{exact:true}).fill('987654');
  await page.getByLabel('Ulangi PIN',{exact:true}).fill('987654');
  await page.getByRole('button',{name:'Simpan PIN & masuk'}).click();
  await expect(page.getByText('Keranjang siap',{exact:true})).toBeVisible();
}

test('operasional: kelola menu, diskon owner, pengeluaran dan backup',async({page})=>{
  await page.setViewportSize({width:1024,height:768});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await setupOwner(page);
  await page.getByRole('button',{name:'Kelola Menu',exact:true}).click();
  await page.getByLabel('Nama menu',{exact:true}).fill('Kopi Operasional');
  await page.getByLabel('Kategori menu',{exact:true}).fill('Coffee');
  await page.getByLabel('Harga menu',{exact:true}).fill('20000');
  await page.getByLabel('Foto menu',{exact:true}).setInputFiles({name:'photo.png',mimeType:'image/png',buffer:await page.screenshot()});
  await expect(page.getByAltText('Pratinjau menu')).toBeVisible();
  await page.getByRole('button',{name:'Simpan menu',exact:true}).click();
  await expect(page.getByText('Menu berhasil disimpan.')).toBeVisible();
  await page.screenshot({path:'test-results/kelola-menu.png',animations:'disabled'});
  await page.getByRole('button',{name:'Kasir',exact:true}).click();
  await page.getByPlaceholder('Cari menu...').fill('Kopi Operasional');
  await page.getByRole('button',{name:'+ Tambah',exact:true}).click();
  await expect(page.getByText('Keranjang tersimpan di tablet',{exact:true})).toBeVisible();
  await page.getByText('Diskon dengan PIN owner',{exact:true}).click();
  await page.getByLabel('Jenis diskon',{exact:true}).selectOption('persen');
  await page.getByLabel('Nilai diskon',{exact:true}).fill('10');
  await page.getByLabel('Alasan diskon',{exact:true}).fill('Promo pelanggan');
  await page.getByLabel('PIN owner diskon',{exact:true}).fill('987654');
  await page.getByRole('button',{name:'Lanjut ke Pembayaran',exact:true}).click();
  await page.getByRole('button',{name:'Uang Pas',exact:true}).click();
  await page.getByRole('button',{name:'Konfirmasi Pembayaran',exact:true}).click();
  await expect(page.getByText('Pembayaran Berhasil',{exact:true})).toBeVisible();
  await expect(page.getByText('Rp 19.800',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Transaksi Baru',exact:true}).click();
  await page.getByRole('button',{name:'Pengeluaran',exact:true}).click();
  await page.getByLabel('Keterangan biaya',{exact:true}).fill('Token listrik');
  await page.getByLabel('Nominal biaya',{exact:true}).fill('50000');
  await page.getByRole('button',{name:'Simpan pengeluaran',exact:true}).click();
  await expect(page.getByText('Pengeluaran tersimpan.',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/pengeluaran.png',animations:'disabled'});
  await page.getByRole('button',{name:'Laporan Penjualan',exact:true}).click();
  await expect(page.getByText('Estimasi Laba Operasional',{exact:true})).toBeVisible();
  await expect(page.getByText('Rp 50.000',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Panduan & Backup',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Unduh backup sekarang',exact:true}).click();
  const file=await download;const backup=JSON.parse(readFileSync((await file.path())!,'utf8'));
  expect(backup.version).toBe(3);expect(backup.data.expenses).toHaveLength(1);expect(backup.data.orders[0].discount).toBe(2000);
  await page.screenshot({path:'test-results/panduan-backup.png',animations:'disabled'});
  expect(errors).toEqual([]);
});
test('tablet: stok resep, pemulihan keranjang, cetak salinan, laporan dan ekspor',async({page})=>{
  await page.setViewportSize({width:1024,height:768});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    (window as any).__prints=[];
    const write=async(bytes:Uint8Array)=>{(window as any).__prints.push(new TextDecoder().decode(bytes));};
    const characteristic={properties:{write:true},writeValue:write,writeValueWithoutResponse:write};
    const server={connected:true,connect:async()=>server,getPrimaryServices:async()=>[{getCharacteristics:async()=>[characteristic]}]};
    Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{requestDevice:async()=>({name:'Printer uji',gatt:server,addEventListener:()=>{}})}});
  });
  await setupOwner(page);
  await page.getByRole('button',{name:'Stok & Resep',exact:true}).click();
  await page.getByLabel('Nama bahan',{exact:true}).fill('Biji kopi uji');
  await page.getByLabel('Stok awal',{exact:true}).fill('1000');
  await page.getByLabel('Stok minimum',{exact:true}).fill('100');
  await page.getByLabel('Biaya per satuan',{exact:true}).fill('100');
  await page.getByRole('button',{name:'Simpan bahan',exact:true}).click();
  await expect(page.getByText('Bahan tersimpan.',{exact:true})).toBeVisible();
  await page.getByLabel('Menu resep',{exact:true}).selectOption('1');
  await page.getByLabel('Bahan resep',{exact:true}).selectOption('1');
  await page.getByLabel('Jumlah resep',{exact:true}).fill('20');
  await page.getByRole('button',{name:'Tambah ke resep',exact:true}).click();
  await page.getByRole('button',{name:'Simpan resep',exact:true}).click();
  await expect(page.getByText('Resep tersimpan untuk transaksi berikutnya.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Kasir',exact:true}).click();
  await page.getByRole('button',{name:'+ Tambah',exact:true}).first().click();
  await page.getByRole('button',{name:'+ Tambah',exact:true}).first().click();
  await expect(page.getByText('Keranjang tersimpan di tablet',{exact:true})).toBeVisible();
  await page.reload();await login(page,'987654');
  await expect(page.getByText('Keranjang dipulihkan dari tablet',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/kasir-tablet.png',animations:'disabled'});
  await page.getByRole('button',{name:'Lanjut ke Pembayaran',exact:true}).click();
  await page.getByRole('button',{name:'Uang Pas',exact:true}).click();
  await page.getByRole('button',{name:'Konfirmasi Pembayaran',exact:true}).click();
  await expect(page.getByText('Pembayaran Berhasil',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Transaksi Baru',exact:true}).click();
  await page.getByRole('button',{name:'Riwayat',exact:true}).click();
  await page.getByRole('button',{name:'Cetak salinan',exact:true}).click();
  await expect(page.getByText('Struk SALINAN #1 dikirim ke printer.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__prints.join(''))).toContain('*** SALINAN ***');
  expect(await counts(page)).toEqual({orders:1,payments:1,audit:2});
  await page.getByRole('button',{name:'Laporan Penjualan',exact:true}).click();
  await expect(page.getByText('Rp 66.000',{exact:true}).first()).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Ekspor CSV',exact:true}).click();
  const file=await download;expect(file.suggestedFilename()).toMatch(/^penjualan-/);
  const contents=readFileSync((await file.path())!,'utf8');expect(contents).toContain('4000');expect(contents).toContain('66000');
  await page.screenshot({path:'test-results/laporan-tablet.png',animations:'disabled'});
  await page.getByRole('button',{name:'Stok & Resep',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:'Biji kopi uji'}).first()).toContainText('960 g');
  await page.screenshot({path:'test-results/stok-tablet.png',animations:'disabled'});
  await page.getByLabel('Bahan yang dihitung',{exact:true}).selectOption('1');
  await page.getByLabel('Jumlah terbuang',{exact:true}).fill('10');
  await page.getByLabel('Alasan pencatatan',{exact:true}).fill('Biji kopi tumpah');
  await page.getByRole('button',{name:'Simpan pencatatan stok',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:'Biji kopi uji'}).first()).toContainText('950 g');
  await page.getByLabel('Jenis pencatatan',{exact:true}).selectOption('stocktake');
  await page.getByLabel('Bahan yang dihitung',{exact:true}).selectOption('1');
  await page.getByLabel('Jumlah fisik aktual',{exact:true}).fill('940');
  await page.getByLabel('Alasan pencatatan',{exact:true}).fill('Hasil hitung fisik');
  await page.getByRole('button',{name:'Simpan pencatatan stok',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:'Biji kopi uji'}).first()).toContainText('940 g');
  await page.screenshot({path:'test-results/stok-opname.png',animations:'disabled'});
  await page.setViewportSize({width:768,height:1024});
  await page.getByRole('button',{name:'Kasir',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/kasir-portrait.png',animations:'disabled'});
  expect(errors).toEqual([]);
});
test('pisah bill: tamu membayar sebagian item, sisa tetap di meja lalu dilunasi', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await login(page, '1234');
  await page.getByLabel('PIN baru', { exact: true }).fill('987654');
  await page.getByLabel('Ulangi PIN', { exact: true }).fill('987654');
  await page.getByRole('button', { name: 'Simpan PIN & masuk' }).click();
  await page.getByRole('button', { name: 'Meja', exact: true }).click();
  await page.getByRole('button', { name: 'Buka Meja' }).first().click();
  const add = page.getByRole('button', { name: '+ Tambah', exact: true });
  await add.nth(0).click(); await add.nth(0).click(); await add.nth(6).click(); // 2× Nasi Lemak, 1× Es Teh
  await expect(page.getByText('Simpan & kirim ke dapur dulu untuk memisah bill.')).toBeHidden(); // no saved order yet
  await page.getByRole('button', { name: 'Simpan & ke Dapur' }).click();
  await page.getByRole('button', { name: 'Lanjut / Bayar' }).click();
  await page.getByRole('button', { name: 'Pisah Bill' }).click();
  await page.getByLabel('Dibayar terpisah: Nasi Lemak Spesial').getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Bayar Item Terpilih' }).click();
  await expect(page.getByText('Rp 38.500').first()).toBeVisible();
  await page.getByRole('button', { name: 'Uang Pas' }).click();
  await page.getByRole('button', { name: 'Konfirmasi Pembayaran' }).click();
  await expect(page.getByText('Bill terpisah lunas.')).toBeVisible();
  await page.getByRole('button', { name: 'Lanjutkan Sisa Pesanan' }).click();
  expect(await counts(page)).toEqual({ orders: 2, payments: 1, audit: 1 });
  await page.getByRole('button', { name: 'Lanjut ke Pembayaran' }).click();
  await expect(page.getByText('Rp 51.700').first()).toBeVisible();
  await page.getByRole('button', { name: 'Uang Pas' }).click();
  await page.getByRole('button', { name: 'Konfirmasi Pembayaran' }).click();
  await page.getByRole('button', { name: 'Kembali ke Denah Meja' }).click();
  await expect(page.getByRole('button', { name: 'Selesai Bersih' })).toBeVisible();
  expect(await counts(page)).toEqual({ orders: 2, payments: 2, audit: 2 });
  expect(errors).toEqual([]);
});
