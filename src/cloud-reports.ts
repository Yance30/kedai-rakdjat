import type { SupabaseClient } from '@supabase/supabase-js';
import { rangeBounds } from './reports';
import type { Order, Payment, Shift, Staff } from './types';

// Explicit paging avoids silently truncated totals at Supabase's row limit.
async function allRows(sb: SupabaseClient, table: string, device: string, configure?: (query: any) => any): Promise<any[]> {
  const rows: any[] = [];
  for(let offset=0;;offset+=500) {
    let query=sb.from(table).select('*').eq('device_id',device).order('local_id');
    if(configure) query=configure(query);
    const {data,error}=await query.range(offset,offset+499);
    if(error) throw new Error(error.message);
    rows.push(...(data??[]));
    if(!data || data.length<500) return rows;
  }
}
export async function loadCloudReport(sb: SupabaseClient,device:string,from:string,to:string) {
  const {start,end}=rangeBounds(from,to);
  const [rawPayments,rawStaff,rawShifts,tables,expenses,movements]=await Promise.all([
    allRows(sb,'payments',device,q=>q.gte('created_at',start).lt('created_at',end)), allRows(sb,'staff',device), allRows(sb,'shifts',device), allRows(sb,'dining_tables',device),
    allRows(sb,'expenses',device,q=>q.gte('date',from).lte('date',to)),
    allRows(sb,'stock_movements',device,q=>q.gte('created_at',start).lt('created_at',end).in('kind',['waste','stocktake','adjustment'])),
  ]);
  const ids=[...new Set<number>(rawPayments.map(p=>p.order_local_id))];
  const rawOrders:any[]=[]; const items:any[]=[];
  for(let i=0;i<ids.length;i+=100) {
    const slice=ids.slice(i,i+100);
    const [o,it]=await Promise.all([allRows(sb,'orders',device,q=>q.in('local_id',slice)),allRows(sb,'order_items',device,q=>q.in('order_local_id',slice))]);
    rawOrders.push(...o);items.push(...it);
  }
  const orders:Order[]=rawOrders.map(o=>({id:o.local_id,shiftId:o.shift_local_id,status:o.status,createdAt:o.created_at,subtotal:o.subtotal,discount:o.discount??0,service:o.service,tax:o.tax,total:o.total,orderType:o.order_type,tableId:o.table_local_id??undefined,cashierId:o.cashier_local_id??undefined,paidAt:o.paid_at??undefined,costTotal:o.cost_total??undefined,costComplete:o.cost_complete??undefined,stockReturned:o.stock_returned??undefined}));
  const payments:Payment[]=rawPayments.map(p=>({id:p.local_id,orderId:p.order_local_id,shiftId:p.shift_local_id,method:p.method,amount:p.amount,tendered:p.tendered,change:p.change,createdAt:p.created_at}));
  const staff:Staff[]=rawStaff.map(s=>({id:s.local_id,name:s.name,role:s.role,pinHash:''}));
  const shifts:Shift[]=rawShifts.map(s=>({id:s.local_id,staffId:s.staff_local_id,status:s.status,openedAt:s.opened_at,openingFloat:s.opening_float}));
  return {orders,payments,staff,shifts,tables,items,operatingExpenses:expenses.filter(e=>!e.voided_at).reduce((sum,e)=>sum+e.amount,0),stockLoss:Math.round(movements.reduce((sum,m)=>sum-m.qty*m.unit_cost,0))};
}
