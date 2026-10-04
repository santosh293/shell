const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

// Load .env without extra dependencies
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const db = require('./lib/db');
const auth = require('./lib/auth');
const wa = require('./lib/whatsapp');

const app = express();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${db.id()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});

// ---------- Live updates for the admin dashboard (Server-Sent Events) ----------
const listeners = new Set();
function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of listeners) res.write(msg);
}

// ---------- Helpers ----------
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const razorpayEnabled = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

function publicSettings() {
  const s = db.data.settings;
  return { ...s, razorpayKeyId: razorpayEnabled() ? process.env.RAZORPAY_KEY_ID : null };
}

function publicOrder(o) {
  const { notes, ...rest } = o;
  return rest;
}

function addHistory(order, text) {
  order.history.push({ at: new Date().toISOString(), text });
}

// ---------- Public API ----------
app.get('/api/store', (req, res) => {
  const { categories, products } = db.data;
  res.json({ settings: publicSettings(), categories, products: products.filter((p) => p.active) });
});

app.get('/api/upi-qr', async (req, res) => {
  const s = db.data.settings;
  if (!s.upiId) return res.status(404).end();
  const amount = Math.max(0, num(req.query.amount)).toFixed(2);
  const link = `upi://pay?pa=${encodeURIComponent(s.upiId)}&pn=${encodeURIComponent(s.upiName || s.storeName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(s.storeName + ' order')}`;
  res.type('image/svg+xml').send(await QRCode.toString(link, { type: 'svg', margin: 1, width: 180 }));
});

app.post('/api/orders', async (req, res) => {
  const data = db.data;
  const s = data.settings;
  const c = req.body.customer || {};
  const customer = {
    name: str(c.name, 80),
    phone: str(c.phone, 20),
    email: str(c.email, 120),
    address: str(c.address, 300),
    city: str(c.city, 80),
    pincode: str(c.pincode, 12),
    note: str(c.note, 300),
  };
  if (!customer.name || !customer.address || !customer.city) return res.status(400).json({ error: 'Name, address and city are required.' });
  if (wa.digits(customer.phone).length < 10) return res.status(400).json({ error: 'Please enter a valid phone number.' });

  const method = str(req.body.paymentMethod, 20);
  const allowed = { cod: s.codEnabled, upi: s.upiEnabled && s.upiId, online: razorpayEnabled() };
  if (!allowed[method]) return res.status(400).json({ error: 'Selected payment method is not available.' });

  const items = [];
  for (const line of Array.isArray(req.body.items) ? req.body.items : []) {
    const product = data.products.find((p) => p.id === line.id && p.active);
    const qty = Math.floor(num(line.qty));
    if (!product || qty < 1) continue;
    if (product.stock < qty) return res.status(400).json({ error: `Only ${product.stock} left of "${product.name}".` });
    items.push({ id: product.id, name: product.name, price: product.price, qty, image: product.image });
  }
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty.' });

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const deliveryFee = s.freeDeliveryAbove && subtotal >= s.freeDeliveryAbove ? 0 : num(s.deliveryFee);
  const order = {
    id: db.id(),
    token: crypto.randomBytes(12).toString('hex'),
    number: ++data.counters.order,
    createdAt: new Date().toISOString(),
    customer,
    items,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    status: 'pending',
    payment: { method, status: 'pending', reference: method === 'upi' ? str(req.body.paymentReference, 60) : '' },
    notes: '',
    history: [],
  };
  addHistory(order, 'Order placed');

  if (method === 'online') {
    try {
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64'),
        },
        body: JSON.stringify({ amount: Math.round(order.total * 100), currency: 'INR', receipt: `order_${order.number}` }),
      });
      const rp = await r.json();
      if (!r.ok) throw new Error(rp.error?.description || 'Razorpay error');
      order.payment.gatewayOrderId = rp.id;
    } catch (err) {
      data.counters.order--;
      return res.status(502).json({ error: `Could not start online payment: ${err.message}` });
    }
  }

  for (const i of items) data.products.find((p) => p.id === i.id).stock -= i.qty;
  data.orders.unshift(order);
  await db.save();

  broadcast('order', { id: order.id, number: order.number, total: order.total, name: customer.name });
  wa.notifyAdmin(wa.orderMessage(order, s), s).then((r) => {
    order.whatsapp = r;
    db.save();
  });

  res.status(201).json({
    order: publicOrder(order),
    whatsappLink: s.whatsappNumber ? wa.waLink(s.whatsappNumber, wa.orderMessage(order, s)) : null,
    razorpay: order.payment.gatewayOrderId ? { keyId: process.env.RAZORPAY_KEY_ID, orderId: order.payment.gatewayOrderId, amount: Math.round(order.total * 100) } : null,
  });
});

app.post('/api/orders/:id/verify-payment', async (req, res) => {
  const order = db.data.orders.find((o) => o.id === req.params.id && o.token === req.body.token);
  if (!order || !order.payment.gatewayOrderId) return res.status(404).json({ error: 'Order not found' });
  const { razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${order.payment.gatewayOrderId}|${pid}`).digest('hex');
  const ok = typeof sig === 'string' && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  order.payment.status = ok ? 'paid' : 'failed';
  order.payment.reference = str(pid, 60);
  if (ok && order.status === 'pending') order.status = 'confirmed';
  addHistory(order, ok ? `Online payment received (${pid})` : 'Online payment verification failed');
  await db.save();
  broadcast('order-updated', { id: order.id });
  res.status(ok ? 200 : 400).json({ ok, order: publicOrder(order) });
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.data.orders.find((o) => o.id === req.params.id && o.token === req.query.token);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const s = db.data.settings;
  res.json({ order: publicOrder(order), whatsappLink: s.whatsappNumber ? wa.waLink(s.whatsappNumber, wa.orderMessage(order, s)) : null });
});

// ---------- Admin API ----------
app.post('/api/admin/login', (req, res) => {
  if (!auth.checkCredentials(str(req.body.username), str(req.body.password))) return res.status(401).json({ error: 'Invalid username or password' });
  auth.issue(res);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  auth.clear(res);
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ authed: auth.isAuthed(req) }));

const admin = express.Router();
admin.use(auth.requireAdmin);

admin.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  listeners.add(res);
  req.on('close', () => {
    clearInterval(ping);
    listeners.delete(res);
  });
});

admin.get('/stats', (req, res) => {
  const { orders, products } = db.data;
  const live = orders.filter((o) => o.status !== 'cancelled');
  const today = new Date().toDateString();
  const days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toDateString();
    const dayOrders = live.filter((o) => new Date(o.createdAt).toDateString() === key);
    return { label: d.toLocaleDateString('en-IN', { weekday: 'short' }), orders: dayOrders.length, revenue: dayOrders.reduce((s, o) => s + o.total, 0) };
  });
  res.json({
    totalOrders: orders.length,
    revenue: live.filter((o) => o.payment.status === 'paid').reduce((s, o) => s + o.total, 0),
    pendingPayments: live.filter((o) => o.payment.status === 'pending').reduce((s, o) => s + o.total, 0),
    todayOrders: orders.filter((o) => new Date(o.createdAt).toDateString() === today).length,
    pendingOrders: orders.filter((o) => o.status === 'pending').length,
    lowStock: products.filter((p) => p.active && p.stock <= 5).map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
    productCount: products.length,
    days,
    recent: orders.slice(0, 5),
  });
});

// Products
function productFromBody(body, base = {}) {
  return {
    ...base,
    name: str(body.name ?? base.name, 120),
    category: str(body.category ?? base.category, 60),
    price: Math.max(0, num(body.price ?? base.price)),
    mrp: Math.max(0, num(body.mrp ?? base.mrp)),
    stock: Math.max(0, Math.floor(num(body.stock ?? base.stock))),
    image: str(body.image ?? base.image, 500),
    description: str(body.description ?? base.description, 2000),
    featured: Boolean(body.featured ?? base.featured),
    active: Boolean(body.active ?? base.active ?? true),
  };
}

admin.get('/products', (req, res) => res.json(db.data.products));
admin.post('/products', async (req, res) => {
  const p = productFromBody(req.body, { id: db.id(), createdAt: new Date().toISOString() });
  if (!p.name) return res.status(400).json({ error: 'Product name is required' });
  db.data.products.unshift(p);
  if (p.category && !db.data.categories.includes(p.category)) db.data.categories.push(p.category);
  await db.save();
  res.status(201).json(p);
});
admin.put('/products/:id', async (req, res) => {
  const idx = db.data.products.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  const p = productFromBody(req.body, db.data.products[idx]);
  if (!p.name) return res.status(400).json({ error: 'Product name is required' });
  db.data.products[idx] = p;
  if (p.category && !db.data.categories.includes(p.category)) db.data.categories.push(p.category);
  await db.save();
  res.json(p);
});
admin.delete('/products/:id', async (req, res) => {
  db.data.products = db.data.products.filter((p) => p.id !== req.params.id);
  await db.save();
  res.json({ ok: true });
});
admin.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please upload a PNG, JPG, WEBP or GIF image under 5MB' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Categories
admin.put('/categories', async (req, res) => {
  const list = Array.isArray(req.body.categories) ? req.body.categories : [];
  db.data.categories = [...new Set(list.map((c) => str(c, 60)).filter(Boolean))];
  await db.save();
  res.json(db.data.categories);
});

// Orders & payments
function filterOrders(q) {
  let list = db.data.orders;
  if (q.status) list = list.filter((o) => o.status === q.status);
  if (q.payment) list = list.filter((o) => o.payment.status === q.payment);
  if (q.range === 'today') list = list.filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString());
  if (q.q) {
    const term = String(q.q).toLowerCase();
    list = list.filter((o) => `${o.number} ${o.customer.name} ${o.customer.phone} ${o.customer.city}`.toLowerCase().includes(term));
  }
  return list;
}

admin.get('/orders', (req, res) => res.json(filterOrders(req.query)));

admin.get('/orders/whatsapp', (req, res) => {
  const s = db.data.settings;
  const list = filterOrders(req.query);
  const title = req.query.range === 'today' ? `Today's Orders` : req.query.status ? `${req.query.status} orders` : 'Orders';
  const text = wa.ordersListMessage(list, s, title);
  res.json({ text, link: wa.waLink(req.query.to || s.whatsappNumber, text), count: list.length });
});

admin.post('/orders/whatsapp/send', async (req, res) => {
  const s = db.data.settings;
  const text = wa.ordersListMessage(filterOrders(req.body || {}), s, req.body?.range === 'today' ? `Today's Orders` : 'Orders');
  res.json(await wa.notifyAdmin(text, s));
});

admin.get('/orders.csv', (req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Order', 'Date', 'Customer', 'Phone', 'Address', 'Items', 'Total', 'Payment Method', 'Payment Status', 'Payment Ref', 'Order Status']];
  for (const o of filterOrders(req.query)) {
    rows.push([o.number, o.createdAt, o.customer.name, o.customer.phone, `${o.customer.address}, ${o.customer.city} ${o.customer.pincode}`, o.items.map((i) => `${i.name} x${i.qty}`).join('; '), o.total, o.payment.method, o.payment.status, o.payment.reference, o.status]);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
});

admin.patch('/orders/:id', async (req, res) => {
  const order = db.data.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const { status, paymentStatus, paymentReference, notes } = req.body;
  if (status && ORDER_STATUSES.includes(status) && status !== order.status) {
    const restock = status === 'cancelled';
    const unstock = order.status === 'cancelled';
    for (const i of order.items) {
      const p = db.data.products.find((x) => x.id === i.id);
      if (p && restock) p.stock += i.qty;
      if (p && unstock) p.stock = Math.max(0, p.stock - i.qty);
    }
    addHistory(order, `Status: ${order.status} → ${status}`);
    order.status = status;
  }
  if (paymentStatus && PAYMENT_STATUSES.includes(paymentStatus) && paymentStatus !== order.payment.status) {
    addHistory(order, `Payment: ${order.payment.status} → ${paymentStatus}`);
    order.payment.status = paymentStatus;
    if (paymentStatus === 'paid') order.payment.paidAt = new Date().toISOString();
  }
  if (paymentReference !== undefined) order.payment.reference = str(paymentReference, 60);
  if (notes !== undefined) order.notes = str(notes, 1000);
  await db.save();
  broadcast('order-updated', { id: order.id });
  const s = db.data.settings;
  const customerMsg = `Hi ${order.customer.name}, your order #${order.number} from ${s.storeName} is now *${order.status}*. Payment: ${order.payment.status}. Total: ${s.currency}${order.total}.`;
  res.json({ order, customerWhatsappLink: wa.waLink(order.customer.phone.length === 10 ? '91' + order.customer.phone : order.customer.phone, customerMsg) });
});

admin.delete('/orders/:id', async (req, res) => {
  db.data.orders = db.data.orders.filter((o) => o.id !== req.params.id);
  await db.save();
  res.json({ ok: true });
});

// Settings
admin.get('/settings', (req, res) => res.json({ settings: db.data.settings, categories: db.data.categories, razorpay: razorpayEnabled(), whatsappAuto: Boolean(process.env.WHATSAPP_TOKEN || process.env.CALLMEBOT_APIKEY) }));
admin.put('/settings', async (req, res) => {
  const cur = db.data.settings;
  const b = req.body || {};
  const next = { ...cur };
  for (const key of Object.keys(cur)) {
    if (!(key in b)) continue;
    if (typeof cur[key] === 'number') next[key] = Math.max(0, num(b[key], cur[key]));
    else if (typeof cur[key] === 'boolean') next[key] = Boolean(b[key]);
    else next[key] = str(b[key], 500);
  }
  db.data.settings = next;
  await db.save();
  res.json(next);
});

app.use('/api/admin', admin);

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

db.load();
if (require.main === module) {
  const port = process.env.PORT || 3000;
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD is not set – using the default "admin123". Set it in .env before going live!');
  app.listen(port, () => console.log(`🛒 Store running at http://localhost:${port}  |  Admin: http://localhost:${port}/admin`));
}

module.exports = app;
