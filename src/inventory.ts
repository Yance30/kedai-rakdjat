import { db } from './db';
import type { Ingredient, OrderItem, Recipe } from './types';

const whole = (v: number) => Number.isSafeInteger(v) && v >= 0;
async function requireOwner(actorId: number) {
  if ((await db.staff.get(actorId))?.role !== 'owner') throw new Error('Hanya owner yang dapat mengubah stok dan resep.');
}
export async function saveIngredient(input: Ingredient, actorId: number) {
  if (!input.name.trim() || !['g', 'ml', 'pcs'].includes(input.unit) || !whole(input.stock) || !whole(input.minimum) || !Number.isFinite(input.unitCost) || input.unitCost < 0 || input.unitCost > 1e9) throw new Error('Nama, satuan, jumlah bulat, dan biaya bahan harus valid.');
  return db.transaction('rw', [db.ingredients, db.stockMovements, db.staff], async () => {
    await requireOwner(actorId);
    if (input.id) {
      const prior = await db.ingredients.get(input.id);
      if (!prior || prior.unit !== input.unit) throw new Error('Satuan bahan yang sudah tersimpan tidak boleh diubah.');
      await db.ingredients.put({ ...input, stock: prior.stock, name: input.name.trim() });
      return input.id;
    }
    const id = await db.ingredients.add({ ...input, name: input.name.trim() });
    await db.stockMovements.add({ ingredientId: id, kind: 'opening', qty: input.stock, unitCost: input.unitCost, actorId, reason: 'Stok awal', createdAt: Date.now() });
    return id;
  });
}
export async function adjustStock(ingredientId: number, qty: number, kind: 'purchase' | 'adjustment', reason: string, actorId: number, purchaseCost?: number) {
  if (!Number.isSafeInteger(qty) || !qty || (kind === 'purchase' && qty < 1) || reason.trim().length < 3) throw new Error('Isi jumlah bulat nonnol dan alasan stok.');
  if (kind === 'purchase' && (purchaseCost === undefined || !whole(purchaseCost))) throw new Error('Total biaya pembelian harus rupiah bulat.');
  return db.transaction('rw', [db.ingredients, db.stockMovements, db.staff], async () => {
    await requireOwner(actorId);
    const ingredient = await db.ingredients.get(ingredientId);
    if (!ingredient || ingredient.stock + qty < 0 || !whole(ingredient.stock + qty)) throw new Error('Stok akhir tidak boleh negatif atau melebihi batas.');
    const cost = kind === 'purchase' ? (ingredient.stock * ingredient.unitCost + purchaseCost!) / (ingredient.stock + qty) : ingredient.unitCost;
    await db.ingredients.update(ingredientId, { stock: ingredient.stock + qty, unitCost: cost });
    await db.stockMovements.add({ ingredientId, kind, qty, unitCost: kind === 'purchase' ? purchaseCost! / qty : cost, reason: reason.trim(), actorId, createdAt: Date.now() });
  });
}
export async function saveRecipe(recipe: Recipe, actorId: number) {
  if (!recipe.ingredients.length || new Set(recipe.ingredients.map(i => i.ingredientId)).size !== recipe.ingredients.length || recipe.ingredients.some(i => !Number.isSafeInteger(i.qty) || i.qty < 1)) throw new Error('Resep harus berisi bahan unik dengan jumlah bulat lebih dari nol.');
  return db.transaction('rw', [db.recipes, db.ingredients, db.products, db.staff], async () => {
    await requireOwner(actorId);
    if (!await db.products.get(recipe.productId)) throw new Error('Menu tidak ditemukan.');
    for (const row of recipe.ingredients) if ((await db.ingredients.get(row.ingredientId))?.active !== 1) throw new Error('Bahan resep tidak aktif atau tidak ditemukan.');
    await db.recipes.put(recipe);
  });
}

// Called inside the sale transaction. Quantities use base units (whole g/ml/pcs).
export async function consumeRecipe(orderId: number, lines: Omit<OrderItem, 'id' | 'orderId'>[], actorId: number) {
  const needed = new Map<number, number>();
  const costed: Omit<OrderItem, 'id' | 'orderId'>[] = [];
  let complete = true;
  for (const line of lines) {
    const recipe = await db.recipes.get(line.productId);
    if (!recipe?.ingredients.length) { complete = false; costed.push({ ...line, costTotal: undefined }); continue; }
    let cost = 0;
    for (const part of recipe.ingredients) {
      const ingredient = await db.ingredients.get(part.ingredientId);
      if (!ingredient || ingredient.active !== 1) throw new Error(`Bahan resep ${line.name} tidak tersedia. Periksa stok.`);
      const qty = part.qty * line.qty;
      if (!Number.isSafeInteger(qty)) throw new Error('Jumlah bahan melebihi batas.');
      needed.set(part.ingredientId, (needed.get(part.ingredientId) ?? 0) + qty);
      cost += ingredient.unitCost * qty;
    }
    if (!Number.isSafeInteger(Math.round(cost))) throw new Error('Harga pokok melebihi batas.');
    costed.push({ ...line, costTotal: Math.round(cost) });
  }
  for (const [ingredientId, qty] of needed) {
    const ingredient = (await db.ingredients.get(ingredientId))!;
    if (ingredient.stock < qty) throw new Error(`Stok ${ingredient.name} kurang: perlu ${qty} ${ingredient.unit}, tersedia ${ingredient.stock}.`);
    await db.ingredients.update(ingredientId, { stock: ingredient.stock - qty });
    await db.stockMovements.add({ ingredientId, orderId, kind: 'sale', qty: -qty, unitCost: ingredient.unitCost, reason: `Penjualan #${orderId}`, actorId, createdAt: Date.now() });
  }
  return { lines: costed, complete, total: costed.reduce((s, i) => s + (i.costTotal ?? 0), 0) };
}
export async function returnOrderStock(orderId: number, actorId: number) {
  const movements = await db.stockMovements.where('orderId').equals(orderId).toArray();
  if (movements.some(m => m.kind === 'return')) throw new Error('Stok pesanan sudah dikembalikan.');
  for (const m of movements.filter(m => m.kind === 'sale')) {
    const ingredient = await db.ingredients.get(m.ingredientId);
    if (!ingredient) throw new Error('Bahan asal tidak ditemukan.');
    const stock = ingredient.stock - m.qty;
    const unitCost = (ingredient.stock * ingredient.unitCost - m.qty * m.unitCost) / stock;
    await db.ingredients.update(m.ingredientId, { stock, unitCost });
    await db.stockMovements.add({ ingredientId: m.ingredientId, orderId, kind: 'return', qty: -m.qty, unitCost: m.unitCost, actorId, reason: `Pengembalian bahan pesanan #${orderId}`, createdAt: Date.now() });
  }
}
