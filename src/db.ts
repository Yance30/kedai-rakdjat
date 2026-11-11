import Dexie, { type Table } from 'dexie';
import type { AuditEvent, DiningTable, Order, OrderItem, Payment, Product, Setting, Shift, Staff } from './types';
import type { CartDraft, Ingredient, Recipe, StockMovement, Expense } from './types';

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
  recovery!: Table<{ id?: number; createdAt: number; data: string }, number>;
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
    this.on('populate', (tx) => {
      const t = tx as unknown as PosDB;
      t.staff.bulkAdd([
        { name: 'Budi Santoso', role: 'owner', pinHash: hashPin('1234') },
        { name: 'Sari', role: 'kasir', pinHash: hashPin('1111') },
      ]);
      t.products.bulkAdd([
        { name: 'Nasi Lemak Spesial', category: 'Food', price: 35000, active: 1 },
        { name: 'Wagyu Rendang', category: 'Food', price: 65000, active: 1 },
        { name: 'Sate Ayam Madura', category: 'Food', price: 38000, active: 1 },
        { name: 'Beef Teriyaki Bowl', category: 'Rice Bowl', price: 45000, active: 1 },
        { name: 'Signature Coffee', category: 'Coffee', price: 28000, active: 1 },
        { name: 'Lychee Iced Tea', category: 'Drink', price: 22000, active: 1 },
        { name: 'Es Teh Manis', category: 'Drink', price: 12000, active: 1 },
        { name: 'Lava Cake', category: 'Dessert', price: 32000, active: 1 },
      ]);
      t.meja.bulkAdd(seedTables());
    });
  }
}

export const db = new PosDB();
