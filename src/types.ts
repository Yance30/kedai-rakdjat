export type Role = 'owner' | 'kasir';

export interface Staff {
  id?: number;
  name: string;
  role: Role;
  pinHash: string;
  mustChangePin?: boolean;
  /** false = access revoked by the owner. Kept (not deleted) because shifts and audit rows reference it. */
  active?: boolean;
}

export interface Shift {
  id?: number;
  staffId: number;
  status: 'open' | 'closed';
  openedAt: number;
  openingFloat: number;
  closedAt?: number;
  actualCash?: number;
  note?: string;
}

export interface Product {
  id?: number;
  name: string;
  category: string;
  price: number;
  active: 1 | 0;
  photo?: string;
  soldOut?: boolean;
}

export interface Setting {
  key: string;
  value: string;
}

export interface DiningTable {
  id?: number;
  name: string;
  status: 'available' | 'occupied' | 'cleaning';
}

export interface Order {
  id?: number;
  shiftId: number;
  status: 'open' | 'paid' | 'void';
  createdAt: number;
  subtotal: number;
  service: number;
  tax: number;
  total: number;
  orderType: 'dine_in' | 'takeaway';
  tableId?: number;
  cashierId?: number;
  paidAt?: number;
  costTotal?: number;
  costComplete?: boolean;
  stockReturned?: boolean;
  discount?: number;
  discountReason?: string;
  discountApproverId?: number;
  /** Set on a paid part of a split bill: the open table order it was taken from. */
  splitFrom?: number;
}

export interface OrderItem {
  id?: number;
  orderId: number;
  productId: number;
  name: string;
  qty: number;
  price: number;
  costTotal?: number;
}

export interface Payment {
  id?: number;
  orderId: number;
  shiftId: number;
  method: 'cash' | 'qris';
  amount: number;
  tendered: number;
  change: number;
  createdAt: number;
  requestId?: string;
}

export interface AuditEvent {
  id?: number;
  action: 'payment' | 'refund' | 'void' | 'shift_close' | 'receipt_copy' | 'discount';
  orderId?: number;
  shiftId: number;
  actorId: number;
  approverId?: number;
  reason: string;
  amount: number;
  createdAt: number;
}

export interface CartDraft {
  key: string;
  shiftId: number;
  staffId: number;
  tableId: number | null;
  orderId: number | null;
  requestId: string;
  orderType: 'dine_in' | 'takeaway';
  lines: { product: Product; qty: number }[];
  updatedAt: number;
  revision: number;
}
export interface Ingredient {
  id?: number;
  name: string;
  unit: 'g' | 'ml' | 'pcs';
  stock: number;
  minimum: number;
  unitCost: number;
  active: 0 | 1;
}
export interface Recipe {
  productId: number;
  ingredients: { ingredientId: number; qty: number }[];
}
export interface StockMovement {
  id?: number;
  ingredientId: number;
  orderId?: number;
  kind: 'opening' | 'purchase' | 'adjustment' | 'sale' | 'return' | 'waste' | 'stocktake';
  qty: number;
  unitCost: number;
  reason: string;
  actorId: number;
  createdAt: number;
}

export interface Expense {
  id?: number;
  date: string;
  category: string;
  description: string;
  amount: number;
  actorId: number;
  createdAt: number;
  voidedAt?: number;
  voidReason?: string;
  /** Set when the cash was taken from the drawer of this (open) shift. */
  shiftId?: number;
}
