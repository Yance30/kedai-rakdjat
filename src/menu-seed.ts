import type { Product } from './types';

/** Kedai Rakdjat's printed menu (prices in thousands of rupiah). Hot/Ice items with two prices become two products. */
const MENU: [category: string, items: [name: string, priceK: number][]][] = [
  ['Coffee', [
    ['Espresso', 10], ['Affogato', 15],
    ['Americano Original', 14], ['Americano Rose', 16], ['Americano Lychee', 16], ['Sanger', 14],
    ['Tubruk', 8], ['Tubruk Susu', 10],
    ['Kopi Rakdjat', 17], ['Kopi Susu Butterscotch', 18], ['Himalayan Butterscotch', 18], ['Kopi Susu Caramel', 18], ['Cappucino', 17],
    ['V60', 28], ['Japanese', 30], ['Vietnam Drip', 14],
  ]],
  ['Speciality', [
    ['Monblanc Berry', 23], ['Monblanc Orange', 23], ['Monblanc Apple', 23], ['Nectar Brew', 23], ['Perfect Peach', 23],
  ]],
  ['Non Coffee', [
    ['Chocolate (Hot)', 16], ['Chocolate (Ice)', 18],
    ['Red Velvet (Hot)', 16], ['Red Velvet (Ice)', 18],
    ['Taro (Hot)', 16], ['Taro (Ice)', 18],
    ['Pink Lava', 20], ['Matcha Latte', 18], ['Matcha Strawberry', 20],
  ]],
  ['Yakult Series', [['Yakult Lychee', 16], ['Yakult Strawberry', 16], ['Yakult Mangga', 16]]],
  ['Tea', [
    ['Jasmine Tea (Hot)', 8], ['Jasmine Tea (Ice)', 10],
    ['Lemon Tea (Hot)', 10], ['Lemon Tea (Ice)', 12],
    ['Thai Tea (Hot)', 10], ['Thai Tea (Ice)', 12],
    ['Lychee Tea (Hot)', 10], ['Lychee Tea (Ice)', 12],
  ]],
  ['Snack', [
    ['Ice Cream', 15], ['Donat', 15], ['Roti Bakar', 15], ['Mix Platter', 18], ['Kentang Goreng', 14], ['Cireng', 15],
  ]],
  ['Main Course', [
    ['Mie Pejuang', 12], ['Mie Merdeka', 15], ['Nasi Telur Pejuang', 15], ['Nasi Telur Merdeka', 18], ['Chicken Wings Rice Bowl', 20],
  ]],
];

export const MENU_PRODUCTS: Product[] = MENU.flatMap(([category, items]) =>
  items.map(([name, k]) => ({ name, category, price: k * 1000, active: 1 as const })));

/** Placeholder items shipped with the first version of the app; archived (not deleted) so old orders keep their history. */
export const DEMO_PRODUCT_NAMES = [
  'Nasi Lemak Spesial', 'Wagyu Rendang', 'Sate Ayam Madura', 'Beef Teriyaki Bowl',
  'Signature Coffee', 'Lychee Iced Tea', 'Es Teh Manis', 'Lava Cake',
];
