const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { settings: { currency: '₹' }, categories: [], products: [], orders: [], tab: 'dashboard', flash: new Set() };
const money = (n) => state.settings.currency + Number(n || 0).toLocaleString('en-IN');
const when = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATUS_PILL = { pending: 'amber', confirmed: 'blue', shipped: 'blue', delivered: 'green', cancelled: 'red', paid: 'green', failed: 'red', refunded: 'gray' };
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && !e.target.src.endsWith('/img/placeholder.svg')) e.target.src = '/img/placeholder.svg'; }, true);
const pill = (s) => `<span class="pill pill-${STATUS_PILL[s] || 'gray'}">${esc(s)}</span>`;

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: opts.body instanceof FormData ? opts.body : opts.body && JSON.stringify(opts.body) });
  if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2500);
}
function openModal(id) { $(id).hidden = false; }
function closeModal(el) { el.hidden = true; }
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('overlay')) closeModal(e.target.closest('.overlay'));
});

// ---------- Auth ----------
function showLogin() { $('#loginView').hidden = false; $('#appView').hidden = true; }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    start();
  } catch (err) {
    $('#loginError').textContent = err.message;
    $('#loginError').hidden = false;
  }
});
$('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); });

// ---------- Navigation ----------
const TITLES = { dashboard: 'Dashboard', orders: 'Orders', payments: 'Payments', products: 'Products', settings: 'Store settings' };
function go(tab) {
  state.tab = tab;
  document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.querySelectorAll('[data-page]').forEach((s) => (s.hidden = s.dataset.page !== tab));
  $('#pageTitle').textContent = TITLES[tab];
  $('#side').classList.remove('open');
  history.replaceState(null, '', `#${tab}`);
  refresh();
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-goto]');
  if (t) go(t.dataset.tab || t.dataset.goto);
});
$('#menuBtn').addEventListener('click', () => $('#side').classList.toggle('open'));

function refresh() {
  const fn = { dashboard: loadDashboard, orders: loadOrders, payments: loadPayments, products: loadProducts, settings: loadSettings }[state.tab];
  return fn().catch((err) => toast(err.message));
}

async function start() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  const s = await api('/api/admin/settings');
  state.settings = s.settings;
  state.categories = s.categories;
  $('#brand').textContent = s.settings.storeName;
  document.documentElement.style.setProperty('--primary', s.settings.primaryColor);
  go(TITLES[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');
  listen();
}

// ---------- Live updates ----------
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch {}
}
function listen() {
  const es = new EventSource('/api/admin/events');
  es.addEventListener('order', (e) => {
    const o = JSON.parse(e.data);
    state.flash.add(o.id);
    toast(`🛒 New order #${o.number} from ${o.name} – ${money(o.total)}`);
    beep();
    if (Notification?.permission === 'granted') new Notification(`New order #${o.number}`, { body: `${o.name} – ${money(o.total)}` });
    refresh();
  });
  es.addEventListener('order-updated', () => { if (['orders', 'payments', 'dashboard'].includes(state.tab)) refresh(); });
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const s = await api('/api/admin/stats');
  $('#kpis').innerHTML = [
    ['Revenue (paid)', money(s.revenue)],
    ['Pending payments', money(s.pendingPayments)],
    ['Total orders', s.totalOrders],
    ["Today's orders", s.todayOrders],
    ['Awaiting action', s.pendingOrders],
  ].map(([k, v]) => `<div class="kpi"><small>${k}</small><b>${v}</b></div>`).join('');
  setPendingBadge(s.pendingOrders);
  const max = Math.max(1, ...s.days.map((d) => d.revenue));
  $('#chart').innerHTML = s.days.map((d) => `<div class="bar"><div style="height:${(d.revenue / max) * 100}%"><span>${d.revenue ? money(d.revenue) : ''}</span></div><label>${d.label}</label></div>`).join('');
  $('#lowStock').innerHTML = s.lowStock.length ? s.lowStock.map((p) => `<div class="stock-row"><span>${esc(p.name)}</span>${pill(p.stock ? `${p.stock} left` : 'out')}</div>`).join('') : '<p class="muted">All products are well stocked 👍</p>';
  $('#recentOrders').innerHTML = s.recent.length ? `<table class="table">${orderRows(s.recent, false)}</table>` : '<p class="muted">No orders yet. Share your store link to get started!</p>';
}
function setPendingBadge(n) {
  $('#pendingBadge').textContent = n;
  $('#pendingBadge').hidden = !n;
}

// ---------- Orders ----------
function orderQuery() {
  return new URLSearchParams({ q: $('#orderSearch').value, status: $('#orderStatus').value, payment: $('#orderPayment').value, range: $('#orderRange').value }).toString();
}
function orderRows(list, editable = true) {
  return `<thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>${list.map((o) => `
    <tr class="clickable ${state.flash.has(o.id) ? 'new-row' : ''}" data-order="${o.id}">
      <td><b>#${o.number}</b><small>${when(o.createdAt)}</small></td>
      <td>${esc(o.customer.name)}<small>${esc(o.customer.phone)} · ${esc(o.customer.city)}</small></td>
      <td>${o.items.reduce((s, i) => s + i.qty, 0)} item(s)<small>${esc(o.items.map((i) => i.name).join(', ').slice(0, 40))}</small></td>
      <td><b>${money(o.total)}</b></td>
      <td>${editable ? select('paymentStatus', ['pending', 'paid', 'failed', 'refunded'], o.payment.status) : pill(o.payment.status)}<small>${esc(o.payment.method.toUpperCase())}</small></td>
      <td>${editable ? select('status', ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], o.status) : pill(o.status)}</td>
      ${editable ? `<td class="actions"><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waCustomer(o)}" title="Message customer">💬</a></td>` : ''}
    </tr>`).join('') || `<tr><td colspan="7" class="muted" style="text-align:center;padding:32px">No orders found</td></tr>`}</tbody>`;
}
function select(field, opts, val) {
  return `<select data-field="${field}">${opts.map((o) => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
}
function waCustomer(o) {
  const s = state.settings;
  const phone = o.customer.phone.replace(/\D/g, '');
  const text = `Hi ${o.customer.name}, thank you for your order #${o.number} at ${s.storeName}! Total ${money(o.total)}. Status: ${o.status}.`;
  return `https://wa.me/${phone.length === 10 ? '91' + phone : phone}?text=${encodeURIComponent(text)}`;
}

async function loadOrders() {
  state.orders = await api(`/api/admin/orders?${orderQuery()}`);
  $('#ordersTable').innerHTML = orderRows(state.orders);
  $('#csvLink').href = `/api/admin/orders.csv?${orderQuery()}`;
  setPendingBadge((await api('/api/admin/orders?status=pending')).length);
}
['#orderSearch', '#orderStatus', '#orderPayment', '#orderRange'].forEach((id) => $(id).addEventListener('input', () => loadOrders()));

async function updateOrder(id, body) {
  const r = await api(`/api/admin/orders/${id}`, { method: 'PATCH', body });
  toast(`Order #${r.order.number} updated`);
  return r;
}

document.addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-field]');
  const row = e.target.closest('[data-order]');
  if (!sel || !row) return;
  try {
    await updateOrder(row.dataset.order, { [sel.dataset.field]: sel.value });
    refresh();
  } catch (err) { toast(err.message); }
});
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-order]');
  if (!row || e.target.closest('select,a,button')) return;
  showOrder(row.dataset.order);
});

async function showOrder(id) {
  const o = (await api('/api/admin/orders')).find((x) => x.id === id);
  if (!o) return;
  const c = o.customer;
  $('#orderDetail').innerHTML = `
    <div class="od">
      <h2>Order #${o.number} ${pill(o.status)}</h2>
      <p class="muted">${new Date(o.createdAt).toLocaleString('en-IN')}</p>
      <div class="od-grid">
        <div>
          <h4>Items</h4>
          ${o.items.map((i) => `<div class="line"><img src="${esc(i.image)}" alt=""><div><b>${esc(i.name)}</b><small>${i.qty} × ${money(i.price)}</small></div><b>${money(i.qty * i.price)}</b></div>`).join('')}
          <div class="sumrow"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
          <div class="sumrow"><span>Delivery</span><span>${o.deliveryFee ? money(o.deliveryFee) : 'FREE'}</span></div>
          <div class="sumrow total"><span>Total</span><span>${money(o.total)}</span></div>
          <h4>Customer</h4>
          <p><b>${esc(c.name)}</b><br>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>${c.email ? `<br>✉️ ${esc(c.email)}` : ''}<br>📍 ${esc(c.address)}, ${esc(c.city)} - ${esc(c.pincode)}${c.note ? `<br>📝 ${esc(c.note)}` : ''}</p>
          <h4>History</h4>
          <ul class="timeline">${o.history.map((h) => `<li>${esc(h.text)} <small>${when(h.at)}</small></li>`).join('')}</ul>
        </div>
        <form id="orderEdit" data-id="${o.id}">
          <h4>Manage</h4>
          <label>Order status${select('status', ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], o.status).replace('data-field', 'name')}</label>
          <label>Payment status (${esc(o.payment.method.toUpperCase())})${select('paymentStatus', ['pending', 'paid', 'failed', 'refunded'], o.payment.status).replace('data-field', 'name')}</label>
          <label>Payment reference / UTR<input name="paymentReference" value="${esc(o.payment.reference)}"></label>
          <label>Internal notes<textarea name="notes" rows="3">${esc(o.notes)}</textarea></label>
          <button class="btn btn-primary btn-block">Save changes</button>
          <a class="btn btn-wa btn-block" target="_blank" rel="noopener" href="${waCustomer(o)}">💬 WhatsApp customer</a>
          <button type="button" class="btn btn-ghost btn-block" id="deleteOrder">Delete order</button>
        </form>
      </div>
    </div>`;
  openModal('#orderModal');
}
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'orderEdit') return;
  e.preventDefault();
  try {
    const r = await updateOrder(e.target.dataset.id, Object.fromEntries(new FormData(e.target)));
    closeModal($('#orderModal'));
    refresh();
    if (confirm('Order saved. Notify the customer on WhatsApp now?')) window.open(r.customerWhatsappLink, '_blank');
  } catch (err) { toast(err.message); }
});
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'deleteOrder') return;
  if (!confirm('Delete this order permanently?')) return;
  await api(`/api/admin/orders/${$('#orderEdit').dataset.id}`, { method: 'DELETE' });
  closeModal($('#orderModal'));
  refresh();
});

$('#waList').addEventListener('click', async () => {
  try {
    const r = await api(`/api/admin/orders/whatsapp?${orderQuery()}`);
    if (!r.count) return toast('No orders in this list');
    if (!state.settings.whatsappNumber) toast('Tip: set your WhatsApp number in Store settings');
    window.open(r.link, '_blank');
  } catch (err) { toast(err.message); }
});

// ---------- Payments ----------
async function loadPayments() {
  const orders = await api('/api/admin/orders');
  const live = orders.filter((o) => o.status !== 'cancelled');
  const sum = (f) => live.filter(f).reduce((s, o) => s + o.total, 0);
  $('#payKpis').innerHTML = [
    ['Received', money(sum((o) => o.payment.status === 'paid'))],
    ['Pending', money(sum((o) => o.payment.status === 'pending'))],
    ['Cash on delivery', money(sum((o) => o.payment.method === 'cod'))],
    ['UPI / Online', money(sum((o) => o.payment.method !== 'cod'))],
  ].map(([k, v]) => `<div class="kpi"><small>${k}</small><b>${v}</b></div>`).join('');
  $('#paymentsTable').innerHTML = `<thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Reference / UTR</th><th>Amount</th><th>Status</th></tr></thead><tbody>${
    orders.map((o) => `<tr data-order="${o.id}" class="clickable">
      <td><b>#${o.number}</b><small>${when(o.createdAt)}</small></td>
      <td>${esc(o.customer.name)}<small>${esc(o.customer.phone)}</small></td>
      <td>${esc({ cod: 'Cash on delivery', upi: 'UPI', online: 'Razorpay' }[o.payment.method] || o.payment.method)}</td>
      <td>${esc(o.payment.reference) || '<span class="muted">—</span>'}</td>
      <td><b>${money(o.total)}</b></td>
      <td>${select('paymentStatus', ['pending', 'paid', 'failed', 'refunded'], o.payment.status)}${o.payment.paidAt ? `<small>${when(o.payment.paidAt)}</small>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:32px">No payments yet</td></tr>'}</tbody>`;
}

// ---------- Products ----------
async function loadProducts() {
  state.products = await api('/api/admin/products');
  renderProducts();
}
function renderProducts() {
  const q = $('#productSearch').value.toLowerCase();
  const list = state.products.filter((p) => !q || `${p.name} ${p.category}`.toLowerCase().includes(q));
  $('#productsTable').innerHTML = `<thead><tr><th></th><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>${
    list.map((p) => `<tr data-product="${p.id}">
      <td><img class="thumbs" src="${esc(p.image)}" alt=""></td>
      <td><b>${esc(p.name)}</b>${p.featured ? ' ⭐' : ''}<small>${esc(p.category)}</small></td>
      <td><b>${money(p.price)}</b>${p.mrp > p.price ? `<small><s>${money(p.mrp)}</s></small>` : ''}</td>
      <td>${p.stock <= 5 ? `<span class="pill pill-${p.stock ? 'amber' : 'red'}">${p.stock}</span>` : p.stock}</td>
      <td>${p.active ? pill('visible').replace('gray', 'green') : pill('hidden')}</td>
      <td class="actions"><button class="btn btn-outline btn-sm" data-edit>Edit</button> <button class="btn btn-ghost btn-sm" data-del>🗑</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:32px">No products</td></tr>'}</tbody>`;
}
$('#productSearch').addEventListener('input', renderProducts);
$('#addProduct').addEventListener('click', () => editProduct());
$('#productsTable').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-product]')?.dataset.product;
  if (!id) return;
  if (e.target.closest('[data-edit]')) editProduct(state.products.find((p) => p.id === id));
  if (e.target.closest('[data-del]') && confirm('Delete this product?')) {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    toast('Product deleted');
    loadProducts();
  }
});

function editProduct(p) {
  const f = $('#productForm');
  f.reset();
  f.dataset.id = p?.id || '';
  $('#productModalTitle').textContent = p ? 'Edit product' : 'Add product';
  $('#catList').innerHTML = state.categories.map((c) => `<option value="${esc(c)}">`).join('');
  const v = p || { active: true, stock: 10 };
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = Boolean(v[el.name]);
    else el.value = v[el.name] ?? '';
  }
  $('#imgPreview').src = v.image || '';
  $('#productError').hidden = true;
  openModal('#productModal');
}
$('#productForm').elements.image.addEventListener('input', (e) => ($('#imgPreview').src = e.target.value));
$('#imgFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('image', file);
  try {
    const r = await api('/api/admin/upload', { method: 'POST', body: fd });
    $('#productForm').elements.image.value = r.url;
    $('#imgPreview').src = r.url;
  } catch (err) { toast(err.message); }
});
$('#productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {};
  for (const el of f.elements) if (el.name) body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  try {
    await api(f.dataset.id ? `/api/admin/products/${f.dataset.id}` : '/api/admin/products', { method: f.dataset.id ? 'PUT' : 'POST', body });
    if (body.category && !state.categories.includes(body.category)) state.categories.push(body.category);
    closeModal($('#productModal'));
    toast('Product saved');
    loadProducts();
  } catch (err) {
    $('#productError').textContent = err.message;
    $('#productError').hidden = false;
  }
});

// ---------- Settings ----------
async function loadSettings() {
  const r = await api('/api/admin/settings');
  state.settings = r.settings;
  state.categories = r.categories;
  const f = $('#settingsForm');
  for (const el of f.elements) {
    if (!el.name || !(el.name in r.settings)) continue;
    if (el.type === 'checkbox') el.checked = r.settings[el.name];
    else el.value = r.settings[el.name];
  }
  $('#waStatus').innerHTML = r.whatsappAuto
    ? '✅ Automatic WhatsApp alerts are ON – every new order is sent to this number instantly.'
    : 'Customers get a “Send order on WhatsApp” button after checkout, and you can share order lists from the Orders page. For fully automatic alerts, set <code>CALLMEBOT_APIKEY</code> or WhatsApp Cloud API keys on the server (see README).';
  $('#rzpStatus').innerHTML = r.razorpay ? '✅ Razorpay online payments are enabled.' : 'Online card/UPI payments via Razorpay: add <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> on the server to enable.';
  renderCats();
}
function renderCats() {
  $('#catTags').innerHTML = state.categories.map((c, i) => `<span class="tag">${esc(c)}<button type="button" data-rmcat="${i}">×</button></span>`).join('');
}
async function saveCats() {
  state.categories = await api('/api/admin/categories', { method: 'PUT', body: { categories: state.categories } });
  renderCats();
}
$('#catTags').addEventListener('click', (e) => {
  const i = e.target.dataset.rmcat;
  if (i === undefined) return;
  state.categories.splice(Number(i), 1);
  saveCats();
});
$('#addCat').addEventListener('click', () => {
  const v = $('#newCat').value.trim();
  if (!v) return;
  state.categories.push(v);
  $('#newCat').value = '';
  saveCats();
});
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  for (const el of e.target.elements) if (el.name) body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  try {
    state.settings = await api('/api/admin/settings', { method: 'PUT', body });
    $('#brand').textContent = state.settings.storeName;
    document.documentElement.style.setProperty('--primary', state.settings.primaryColor);
    toast('Settings saved ✓');
  } catch (err) { toast(err.message); }
});

// ---------- Boot ----------
api('/api/admin/me').then((r) => (r.authed ? start() : showLogin()));
