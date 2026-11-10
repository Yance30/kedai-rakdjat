export type Role = 'owner' | 'kasir';

export interface Staff {
  id?: number;
  name: string;
  role: Role;
  pinHash: string;
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
}

export interface OrderItem {
  id?: number;
  orderId: number;
  productId: number;
  name: string;
  qty: number;
  price: number;
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
}