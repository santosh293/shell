const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-test-'));
process.env.UPLOAD_DIR = path.join(process.env.DATA_DIR, 'uploads');
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'secret';
const app = require('../server');

let server, base, cookie;
before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('store lists seeded products', async () => {
  const data = await (await fetch(base + '/api/store')).json();
  assert.ok(data.products.length > 0);
  assert.equal(data.settings.razorpayKeyId, null);
});

test('admin routes require login', async () => {
  assert.equal((await fetch(base + '/api/admin/orders')).status, 401);
  assert.equal((await post('/api/admin/login', { username: 'admin', password: 'nope' })).status, 401);
  const r = await post('/api/admin/login', { username: 'admin', password: 'secret' });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
});

test('placing an order computes totals server-side, reduces stock and appears for admin', async () => {
  const { products } = await (await fetch(base + '/api/store')).json();
  const p = products[0];
  const r = await post('/api/orders', {
    customer: { name: 'Asha', phone: '9876543210', address: '12 MG Road', city: 'Pune', pincode: '411001' },
    paymentMethod: 'cod',
    items: [{ id: p.id, qty: 2, price: 1 }],
  });
  assert.equal(r.status, 201);
  const { order } = await r.json();
  assert.equal(order.subtotal, p.price * 2);
  assert.equal(order.payment.status, 'pending');

  const after = (await (await fetch(base + '/api/store')).json()).products.find((x) => x.id === p.id);
  assert.equal(after.stock, p.stock - 2);

  const orders = await (await fetch(base + '/api/admin/orders', { headers: { cookie } })).json();
  assert.equal(orders[0].id, order.id);

  const tracked = await fetch(`${base}/api/orders/${order.id}?token=${order.token}`);
  assert.equal(tracked.status, 200);
  assert.equal((await fetch(`${base}/api/orders/${order.id}?token=wrong`)).status, 404);

  const upd = await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled', paymentStatus: 'paid' }) });
  const u = await upd.json();
  assert.equal(u.order.status, 'cancelled');
  assert.equal(u.order.payment.status, 'paid');
  const restocked = (await (await fetch(base + '/api/store')).json()).products.find((x) => x.id === p.id);
  assert.equal(restocked.stock, p.stock);

  const wa = await (await fetch(base + '/api/admin/orders/whatsapp?to=919999999999', { headers: { cookie } })).json();
  assert.match(wa.link, /^https:\/\/wa\.me\/919999999999\?text=/);
  assert.match(wa.text, /Asha/);
});

test('rejects invalid orders', async () => {
  const { products } = await (await fetch(base + '/api/store')).json();
  const customer = { name: 'A', phone: '9876543210', address: 'x', city: 'y', pincode: '1' };
  assert.equal((await post('/api/orders', { customer, paymentMethod: 'cod', items: [] })).status, 400);
  assert.equal((await post('/api/orders', { customer, paymentMethod: 'online', items: [{ id: products[0].id, qty: 1 }] })).status, 400);
  assert.equal((await post('/api/orders', { customer, paymentMethod: 'cod', items: [{ id: products[0].id, qty: 99999 }] })).status, 400);
});

test('admin can edit settings and products', async () => {
  const h = { cookie, 'Content-Type': 'application/json' };
  const s = await (await fetch(base + '/api/admin/settings', { method: 'PUT', headers: h, body: JSON.stringify({ storeName: 'My Shop', deliveryFee: '30', codEnabled: false }) })).json();
  assert.equal(s.storeName, 'My Shop');
  assert.equal(s.deliveryFee, 30);
  assert.equal(s.codEnabled, false);
  const p = await (await fetch(base + '/api/admin/products', { method: 'POST', headers: h, body: JSON.stringify({ name: 'New Item', category: 'Toys', price: 100, stock: 3 }) })).json();
  assert.equal(p.name, 'New Item');
  const store = await (await fetch(base + '/api/store')).json();
  assert.ok(store.categories.includes('Toys'));
  assert.equal(store.settings.storeName, 'My Shop');
});
