import 'fake-indexeddb/auto';
import { beforeEach,afterAll,expect,it,vi } from 'vitest';
import { db } from '../src/db';
import { saveIngredient,saveRecipe,adjustStock } from '../src/inventory';
import { commitSale,reverseOrder } from '../src/transactions';
import { recoverDraft,saveDraft,draftKey } from '../src/drafts';
import { reprintReceipt } from '../src/receipts';
import { buildSalesReport,csvText,rangeBounds } from '../src/reports';
import { createBackup,parseBackup,restoreBackup } from '../src/backup';
import type { CartDraft,Order,Payment } from '../src/types';
vi.mock('../src/supabase',()=>({deviceId:async()=> 'test-device',cloudProject:()=>'',loadSupabase:vi.fn()}));
vi.mock('../src/sync',()=>({exclusive:async(fn:()=>Promise<unknown>)=>fn()}));
beforeEach(async()=>{await db.delete();await db.open();await db.shifts.add({id:1,staffId:2,status:'open',openedAt:1,openingFloat:0});});
afterAll(()=>db.close());
const order:Order={shiftId:1,status:'paid',createdAt:Date.parse('2026-11-01T16:59:00Z'),subtotal:20000,service:0,tax:2000,total:22000,orderType:'takeaway'};
const payment:Payment={orderId:0,shiftId:1,requestId:'once',amount:22000,tendered:22000,change:0,createdAt:Date.parse('2026-11-01T17:01:00Z'),method:'cash'};
const lines=[{productId:1,name:'Kopi',price:20000,qty:1}];
async function ingredient(stock=1000){return saveIngredient({name:'Kopi',unit:'g',stock,minimum:100,unitCost:100,active:1},1);}
it('penjualan memotong stok sekali dan menyimpan HPP historis',async()=>{
 const id=await ingredient();await saveRecipe({productId:1,ingredients:[{ingredientId:id,qty:20}]},1);
 const sale=await commitSale(order,lines,payment,2,null);await commitSale(order,lines,payment,2,null);
 expect((await db.ingredients.get(id))?.stock).toBe(980);expect((await db.orders.get(sale))?.costTotal).toBe(2000);
 await adjustStock(id,1000,'purchase','Nota 012',1,200000);
 expect((await db.orders.get(sale))?.costTotal).toBe(2000);
 expect((await db.ingredients.get(id))?.unitCost).toBeCloseTo(298000/1980);
});
it('stok kurang membatalkan seluruh transaksi dan audit',async()=>{
 const id=await ingredient(10);await saveRecipe({productId:1,ingredients:[{ingredientId:id,qty:20}]},1);
 await expect(commitSale(order,lines,payment,2,null)).rejects.toThrow('kurang');
 expect(await db.orders.count()).toBe(0);expect(await db.payments.count()).toBe(0);expect((await db.ingredients.get(id))?.stock).toBe(10);
});
it('refund tanpa pengembalian bahan tidak menambah stok',async()=>{
 const id=await ingredient();await saveRecipe({productId:1,ingredients:[{ingredientId:id,qty:20}]},1);
 const sale=await commitSale(order,lines,payment,2,null);await reverseOrder(sale,2,1,'Bahan sudah dimasak');
 expect((await db.ingredients.get(id))?.stock).toBe(980);
});
it('refund bahan belum terpakai memakai jumlah resep saat transaksi, bukan resep baru',async()=>{
 const id=await ingredient();await saveRecipe({productId:1,ingredients:[{ingredientId:id,qty:20}]},1);
 const sale=await commitSale(order,lines,payment,2,null);await saveRecipe({productId:1,ingredients:[{ingredientId:id,qty:50}]},1);
 await reverseOrder(sale,2,1,'Belum dimasak',true);expect((await db.ingredients.get(id))?.stock).toBe(1000);
 await expect(reverseOrder(sale,2,1,'Ulangi refund',true)).rejects.toThrow();
});
it('kasir tidak bisa mengelola bahan dan resep',async()=>{
 await expect(saveIngredient({name:'A',unit:'g',stock:1,minimum:0,unitCost:1,active:1},2)).rejects.toThrow('owner');
});
it('draft tahan reload, mendeteksi konflik, dan dihapus atomik setelah pembayaran',async()=>{
 const key=draftKey(1,2);const draft:CartDraft={key,staffId:2,shiftId:1,tableId:null,orderId:null,requestId:'once',orderType:'takeaway',lines:[{product:{id:1,name:'Kopi',price:20000,category:'Coffee',active:1},qty:1}],updatedAt:1,revision:0};
 const saved=await saveDraft(draft,0);db.close();await db.open();
 expect((await recoverDraft(key))?.lines[0].qty).toBe(1);
 await expect(saveDraft(draft,0)).rejects.toThrow('tab lain');
 await commitSale(order,lines,payment,2,null,saved);expect(await db.drafts.get(key)).toBeUndefined();
});
it('cetak salinan tidak mengubah pembayaran dan menandai struk SALINAN',async()=>{
 const sale=await commitSale(order,lines,payment,2,null);let printed='';
 await reprintReceipt(sale,2,async(bytes)=>{printed=new TextDecoder().decode(bytes);});
 expect(printed).toContain('*** SALINAN ***');expect(await db.payments.count()).toBe(1);expect(await db.audit.where('action').equals('receipt_copy').count()).toBe(1);
 await expect(reprintReceipt(sale,2,async()=>{throw new Error('putus');})).rejects.toThrow('putus');
 expect(await db.audit.where('action').equals('receipt_copy').count()).toBe(1);
});
it('laporan memakai waktu pembayaran WIB, filter kasir, dan tidak mengarang margin tanpa resep',async()=>{
 await commitSale(order,lines,payment,2,null);
 const args=[await db.orders.toArray(),await db.payments.toArray(),await db.shifts.toArray(),await db.staff.toArray(),await db.audit.toArray()] as const;
 const report=buildSalesReport(...args,'2026-11-02','2026-11-02',2);
 expect(report.net).toBe(22000);expect(report.margin).toBeNull();
 expect(buildSalesReport(...args,'2026-11-01','2026-11-01').net).toBe(0);
 expect(buildSalesReport(...args,'2026-11-02','2026-11-02',1).net).toBe(0);
 expect(()=>rangeBounds('2026-02-30','2026-03-02')).toThrow();
 expect(csvText([['=HYPERLINK("evil")','nama, "kopi"',-10]])).toContain("'=HYPERLINK");
});
it('backup v2 memulihkan bahan, resep, saldo, dan HPP; saldo palsu ditolak',async()=>{
 const id=await ingredient();await saveRecipe({productId:1,ingredients:[{ingredientId:id,qty:20}]},1);await commitSale(order,lines,payment,2,null);
 const backup=await createBackup();expect(backup.version).toBe(3);
 await adjustStock(id,-10,'adjustment','Bahan rusak',1);await restoreBackup(backup);
 expect((await db.ingredients.get(id))?.stock).toBe(980);expect(await db.recipes.count()).toBe(1);
 backup.data.ingredients[0].stock=9999;expect(()=>parseBackup(JSON.stringify(backup))).toThrow('saldo stok');
});
