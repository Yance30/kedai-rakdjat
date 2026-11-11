import { db } from './db';
import { rangeBounds } from './reports';
import type { Expense, Product } from './types';

async function owner(id: number) {
  if ((await db.staff.get(id))?.role !== 'owner') throw new Error('Hanya owner yang dapat melakukan perubahan ini.');
}
export async function saveProduct(input: Product, actorId: number) {
  if (!input.name.trim() || !input.category.trim() || !Number.isSafeInteger(input.price) || input.price <= 0 || input.price > 1e9 || ![0,1].includes(input.active)) throw new Error('Isi nama, kategori dan harga rupiah yang valid.');
  if (input.photo && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(input.photo) || input.photo.length > 500000)) throw new Error('Foto harus berupa JPEG, PNG atau WebP berukuran kecil.');
  return db.transaction('rw', [db.products, db.staff], async () => {
    await owner(actorId);
    if (input.id && !await db.products.get(input.id)) throw new Error('Menu tidak ditemukan.');
    return db.products.put({ ...input, name: input.name.trim(), category: input.category.trim() });
  });
}
export async function addExpense(input: Pick<Expense,'date'|'category'|'description'|'amount'>, actorId: number) {
  rangeBounds(input.date,input.date);
  if (!input.category.trim() || input.description.trim().length < 3 || !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1e12) throw new Error('Isi kategori, keterangan dan nominal pengeluaran yang valid.');
  return db.transaction('rw',[db.expenses,db.staff],async()=>{
    await owner(actorId);
    return db.expenses.add({...input,description:input.description.trim(),actorId,createdAt:Date.now()});
  });
}
export async function voidExpense(id: number, reason: string, actorId: number) {
  if (reason.trim().length < 5) throw new Error('Alasan pembatalan minimal 5 karakter.');
  return db.transaction('rw',[db.expenses,db.staff],async()=>{
    await owner(actorId);
    const row=await db.expenses.get(id);
    if (!row || row.voidedAt) throw new Error('Pengeluaran sudah dibatalkan atau tidak ditemukan.');
    await db.expenses.update(id,{voidedAt:Date.now(),voidReason:reason.trim()});
  });
}
export async function recordStock(ingredientId:number, value:number, kind:'waste'|'stocktake', expectedStock:number, reason:string, actorId:number) {
  if (!Number.isSafeInteger(value) || value < 0 || (kind==='waste' && value===0) || reason.trim().length<5) throw new Error('Isi jumlah bulat dan alasan minimal 5 karakter.');
  return db.transaction('rw',[db.ingredients,db.stockMovements,db.staff],async()=>{
    await owner(actorId);
    const row=await db.ingredients.get(ingredientId);
    if (!row || row.stock!==expectedStock) throw new Error('Stok berubah sejak formulir dibuka. Periksa ulang jumlah fisik.');
    const qty=kind==='waste' ? -value : value-row.stock;
    if (row.stock+qty<0) throw new Error('Bahan terbuang melebihi stok tersedia.');
    await db.ingredients.update(ingredientId,{stock:row.stock+qty});
    await db.stockMovements.add({ingredientId,kind,qty,unitCost:row.unitCost,reason:reason.trim(),actorId,createdAt:Date.now()});
  });
}
