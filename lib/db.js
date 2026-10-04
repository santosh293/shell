// Tiny JSON-file data store. Writes are atomic (temp file + rename) and serialized.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const defaults = () => ({
  settings: {
    storeName: 'ShopKart',
    tagline: 'Fresh picks, delivered to your door',
    heroTitle: 'Big Festive Sale',
    heroSubtitle: 'Up to 40% off on bestsellers. Free delivery above ₹999.',
    currency: '₹',
    deliveryFee: 49,
    freeDeliveryAbove: 999,
    whatsappNumber: '',
    upiId: '',
    upiName: '',
    codEnabled: true,
    upiEnabled: true,
    contactEmail: '',
    address: '',
    announcement: '🎉 Free delivery on orders above ₹999',
    primaryColor: '#6d28d9',
  },
  categories: ['Electronics', 'Fashion', 'Home', 'Grocery'],
  products: [
    { name: 'Wireless Earbuds Pro', category: 'Electronics', price: 1999, mrp: 3499, stock: 25, image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600', description: 'Active noise cancellation, 30h battery, IPX5 water resistant.', featured: true },
    { name: 'Smart Watch Fit', category: 'Electronics', price: 2499, mrp: 4999, stock: 15, image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600', description: 'Heart-rate, SpO2, sleep tracking and 7-day battery life.', featured: true },
    { name: 'Classic Cotton T-Shirt', category: 'Fashion', price: 499, mrp: 799, stock: 60, image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600', description: '100% combed cotton, regular fit. Available in S–XXL.', featured: false },
    { name: 'Running Sneakers', category: 'Fashion', price: 1799, mrp: 2999, stock: 20, image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600', description: 'Lightweight mesh upper with cushioned sole.', featured: true },
    { name: 'Ceramic Coffee Mug Set', category: 'Home', price: 649, mrp: 999, stock: 40, image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=600', description: 'Set of 2 handcrafted 350ml mugs. Microwave safe.', featured: false },
    { name: 'Indoor Plant – Snake Plant', category: 'Home', price: 399, mrp: 599, stock: 30, image: 'https://images.unsplash.com/photo-1593482892290-f54927ae1bb6?w=600', description: 'Low-maintenance air-purifying plant with pot.', featured: false },
    { name: 'Organic Honey 500g', category: 'Grocery', price: 349, mrp: 450, stock: 50, image: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=600', description: 'Raw, unprocessed wild forest honey.', featured: false },
    { name: 'Premium Dry Fruits Box', category: 'Grocery', price: 899, mrp: 1299, stock: 35, image: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?w=600', description: 'Almonds, cashews, pistachios & raisins – 500g gift box.', featured: true },
  ].map((p) => ({ id: id(), active: true, createdAt: new Date().toISOString(), ...p })),
  orders: [],
  counters: { order: 1000 },
});

function id() {
  return crypto.randomBytes(6).toString('hex');
}

let state = null;
let writing = Promise.resolve();

function load() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    const fresh = defaults();
    const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    state = { ...fresh, ...saved, settings: { ...fresh.settings, ...saved.settings } };
  } else {
    state = defaults();
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
  }
  return state;
}

function save() {
  const snapshot = JSON.stringify(state, null, 2);
  writing = writing.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, DB_FILE);
  });
  return writing;
}

module.exports = { load, save, id, get data() { return load(); } };
