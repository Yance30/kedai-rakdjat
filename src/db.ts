import Dexie, { type Table } from 'dexie';
import type { AuditEvent, DiningTable, Order, OrderItem, Payment, Product, Setting, Shift, Staff } from './types';
import type { CartDraft, Ingredient, Recipe, StockMovement, Expense } from './types';
import { DEMO_PRODUCT_NAMES, MENU_PRODUCTS } from './menu-seed';

export function hashPin(pin: string): string {
  let h = 5381;
  const s = 'kedai-rakdjat:' + pin;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function seedTables(): DiningTable[] {
  return Array.from({ length: 8 }, (_, i) => ({ name: `T-0${i + 1}`, status: 'available' as const }));
}

export class PosDB extends Dexie {
  staff!: Table<Staff, number>;
  shifts!: Table<Shift, number>;
  products!: Table<Product, number>;
  orders!: Table<Order, number>;
  orderItems!: Table<OrderItem, number>;
  payments!: Table<Payment, number>;
  settings!: Table<Setting, string>;
  meja!: Table<DiningTable, number>;
  audit!: Table<AuditEvent, number>;
  syncState!: Table<{ key: string; value: string }, string>;
  /** Local copies of the whole database: before a restore, or automatic daily / shift-close snapshots. */
  recovery!: Table<{ id?: number; createdAt: number; data: string; kind?: 'restore' | 'auto'; reason?: string }, number>;
  drafts!: Table<CartDraft, string>;
  ingredients!: Table<Ingredient, number>;
  recipes!: Table<Recipe, number>;
  stockMovements!: Table<StockMovement, number>;
  expenses!: Table<Expense, number>;

  constructor() {
    super('kedai-rakdjat-pos');
    this.version(1).stores({
      staff: '++id, role, pinHash',
      shifts: '++id, status, staffId',
      products: '++id, category, active',
      orders: '++id, shiftId, status',
      orderItems: '++id, orderId',
      payments: '++id, orderId, shiftId, method',
    });
    this.version(2).stores({
      settings: 'key',
    });
    this.version(3).stores({
      meja: '++id, status',
      orders: '++id, shiftId, status, tableId',
    }).upgrade((tx) => {
      const t = tx as unknown as PosDB;
      t.meja.bulkAdd(seedTables());
    });
    this.version(4).stores({
      payments: '++id, orderId, shiftId, method, &requestId',
      audit: '++id, orderId, shiftId, action',
      syncState: 'key',
      recovery: '++id, createdAt',
    });
    this.version(5).stores({
      drafts: 'key, shiftId, staffId, tableId',
      ingredients: '++id, name, active',
      recipes: 'productId',
      stockMovements: '++id, ingredientId, orderId, createdAt',
    });
    this.version(6).stores({ expenses: '++id, date, actorId' });
    this.version(7).stores({ expenses: '++id, date, actorId, shiftId' });
    // Real Kedai Rakdjat menu; demo items are archived (not deleted) so past orders keep their product rows.
    // Demo staff names become neutral account names the owner renames under Pengaturan → Staf.
    this.version(8).stores({}).upgrade(async (tx) => {
      const t = tx as unknown as PosDB;
      const existing = await t.products.toArray();
      for (const p of existing) if (DEMO_PRODUCT_NAMES.includes(p.name) && p.active) await t.products.update(p.id!, { active: 0 });
      const names = new Set(existing.map((p) => p.name));
      await t.products.bulkAdd(MENU_PRODUCTS.filter((p) => !names.has(p.name)));
      const rename: Record<string, string> = { 'Budi Santoso': 'Owner', Sari: 'Kasir' };
      await t.staff.toCollection().modify((s) => { if (rename[s.name]) s.name = rename[s.name]; });
    });
    this.on('populate', (tx) => {
      const t = tx as unknown as PosDB;
      t.staff.bulkAdd([
        { name: 'Owner', role: 'owner', pinHash: hashPin('1234') },
        { name: 'Kasir', role: 'kasir', pinHash: hashPin('1111') },
      ]);
      t.products.bulkAdd(MENU_PRODUCTS);
      t.meja.bulkAdd(seedTables());
    });
  }
}

export const db = new PosDB();
