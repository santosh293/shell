const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { settings: {}, products: [], categories: [], category: 'All', query: '', sort: 'featured', cart: loadCart(), payMethod: null };

function loadCart() {
  try { return JSON.parse(localStorage.getItem('cart')) || {}; } catch { return {}; }
}
function saveCart() {
  try { localStorage.setItem('cart', JSON.stringify(state.cart)); } catch {}
  renderCartCount();
}
const money = (n) => state.settings.currency + Number(n).toLocaleString('en-IN');
const FALLBACK = '/img/placeholder.svg';
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && !e.target.src.endsWith(FALLBACK)) e.target.src = FALLBACK; }, true);
const product = (id) => state.products.find((p) => p.id === id);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

function open(id) { $(id).hidden = false; document.body.classList.add('noscroll'); }
function close(el) { el.hidden = true; if (!document.querySelector('.overlay:not([hidden])')) document.body.classList.remove('noscroll'); }
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('overlay')) close(e.target.closest('.overlay'));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.overlay:not([hidden])').forEach(close); });

async function init() {
  const data = await fetch('/api/store').then((r) => r.json());
  Object.assign(state, data);
  const s = state.settings;
  document.title = `${s.storeName} – ${s.tagline}`;
  document.documentElement.style.setProperty('--primary', s.primaryColor);
  $('#storeName').textContent = s.storeName;
  $('#tagline').textContent = s.tagline;
  $('#heroTitle').textContent = s.heroTitle;
  $('#heroSubtitle').textContent = s.heroSubtitle;
  $('#footName').textContent = s.storeName;
  $('#footAddress').textContent = s.address;
  $('#footContact').innerHTML = [s.contactEmail && `✉️ ${esc(s.contactEmail)}`, s.whatsappNumber && `💬 +${esc(s.whatsappNumber)}`].filter(Boolean).join('<br>');
  if (s.announcement) { $('#announce').textContent = s.announcement; $('#announce').hidden = false; }
  if (s.whatsappNumber) {
    $('#waFloat').href = `https://wa.me/${s.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${s.storeName}!`)}`;
    $('#waFloat').hidden = false;
  }
  $('#heroArt').innerHTML = state.products.filter((p) => p.featured).slice(0, 3).map((p) => `<img src="${esc(p.image)}" alt="${esc(p.name)}">`).join('');
  // drop cart lines for products that no longer exist
  for (const id of Object.keys(state.cart)) if (!product(id)) delete state.cart[id];
  saveCart();
  renderCategories();
  renderProducts();
}

function renderCategories() {
  $('#categories').innerHTML = ['All', ...state.categories]
    .map((c) => `<button class="chip ${c === state.category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}
$('#categories').addEventListener('click', (e) => {
  const c = e.target.dataset.cat;
  if (!c) return;
  state.category = c;
  renderCategories();
  renderProducts();
});
$('#search').addEventListener('input', (e) => { state.query = e.target.value.toLowerCase(); renderProducts(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderProducts(); });

function discount(p) {
  return p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
}

function renderProducts() {
  let list = state.products.filter((p) =>
    (state.category === 'All' || p.category === state.category) &&
    (!state.query || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(state.query)));
  const sorters = {
    featured: (a, b) => b.featured - a.featured,
    low: (a, b) => a.price - b.price,
    high: (a, b) => b.price - a.price,
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
  };
  list = [...list].sort(sorters[state.sort]);
  $('#listTitle').textContent = state.category === 'All' ? 'All products' : state.category;
  $('#noResults').hidden = list.length > 0;
  $('#products').innerHTML = list.map((p) => `
    <article class="card-p" data-id="${p.id}">
      <div class="thumb" data-view>
        <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">
        ${discount(p) ? `<span class="off">${discount(p)}% OFF</span>` : ''}
        ${p.stock === 0 ? '<span class="soldout">Sold out</span>' : ''}
      </div>
      <div class="info">
        <small class="cat">${esc(p.category)}</small>
        <h3 data-view>${esc(p.name)}</h3>
        <div class="price"><b>${money(p.price)}</b>${p.mrp > p.price ? `<s>${money(p.mrp)}</s>` : ''}</div>
        ${p.stock > 0 && p.stock <= 5 ? `<small class="low">Only ${p.stock} left!</small>` : ''}
        <button class="btn btn-primary btn-block btn-sm" data-add ${p.stock === 0 ? 'disabled' : ''}>${p.stock === 0 ? 'Out of stock' : 'Add to cart'}</button>
      </div>
    </article>`).join('');
}

$('#products').addEventListener('click', (e) => {
  const card = e.target.closest('.card-p');
  if (!card) return;
  if (e.target.closest('[data-add]')) addToCart(card.dataset.id);
  else if (e.target.closest('[data-view]')) showProduct(card.dataset.id);
});

function showProduct(id) {
  const p = product(id);
  $('#pdp').innerHTML = `
    <img src="${esc(p.image)}" alt="${esc(p.name)}">
    <div>
      <small class="cat">${esc(p.category)}</small>
      <h2>${esc(p.name)}</h2>
      <div class="price big"><b>${money(p.price)}</b>${p.mrp > p.price ? `<s>${money(p.mrp)}</s><span class="save">Save ${discount(p)}%</span>` : ''}</div>
      <p>${esc(p.description)}</p>
      <p class="muted">${p.stock > 0 ? `✅ In stock (${p.stock} available)` : '❌ Out of stock'}</p>
      <button class="btn btn-primary" ${p.stock === 0 ? 'disabled' : ''} onclick="addToCart('${p.id}'); close(document.getElementById('productModal')); open('#cartDrawer'); renderCart();">Add to cart</button>
    </div>`;
  open('#productModal');
}

function addToCart(id, delta = 1) {
  const p = product(id);
  const qty = (state.cart[id] || 0) + delta;
  if (qty > p.stock) return toast(`Only ${p.stock} in stock`);
  if (qty <= 0) delete state.cart[id];
  else state.cart[id] = qty;
  saveCart();
  renderCart();
  if (delta > 0) toast(`Added “${p.name}”`);
}

function totals() {
  const lines = Object.entries(state.cart).map(([id, qty]) => ({ p: product(id), qty })).filter((l) => l.p);
  const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const { deliveryFee, freeDeliveryAbove } = state.settings;
  const delivery = !subtotal || (freeDeliveryAbove && subtotal >= freeDeliveryAbove) ? 0 : deliveryFee;
  return { lines, subtotal, delivery, total: subtotal + delivery };
}

function renderCartCount() {
  $('#cartCount').textContent = Object.values(state.cart).reduce((a, b) => a + b, 0);
}

function summaryHtml(t) {
  const { freeDeliveryAbove } = state.settings;
  return `
    <div class="sumrow"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    <div class="sumrow"><span>Delivery</span><span>${t.delivery ? money(t.delivery) : 'FREE'}</span></div>
    ${t.delivery && freeDeliveryAbove ? `<small class="hint">Add ${money(freeDeliveryAbove - t.subtotal)} more for free delivery</small>` : ''}
    <div class="sumrow total"><span>Total</span><span>${money(t.total)}</span></div>`;
}

function renderCart() {
  const t = totals();
  $('#cartItems').innerHTML = t.lines.length ? t.lines.map(({ p, qty }) => `
    <div class="line" data-id="${p.id}">
      <img src="${esc(p.image)}" alt="">
      <div><b>${esc(p.name)}</b><small>${money(p.price)}</small>
        <div class="qty"><button data-q="-1">−</button><span>${qty}</span><button data-q="1">+</button></div>
      </div>
      <b>${money(p.price * qty)}</b>
    </div>`).join('') : '<div class="empty"><p style="font-size:42px">🛒</p><p>Your cart is empty</p></div>';
  $('#cartFoot').innerHTML = t.lines.length ? `${summaryHtml(t)}<button class="btn btn-primary btn-block" id="goCheckout">Checkout · ${money(t.total)}</button>` : '';
}
$('#cartItems').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (b) addToCart(b.closest('.line').dataset.id, Number(b.dataset.q));
});
$('#openCart').addEventListener('click', () => { renderCart(); open('#cartDrawer'); });
$('#cartFoot').addEventListener('click', (e) => {
  if (e.target.id !== 'goCheckout') return;
  close($('#cartDrawer'));
  openCheckout();
});

// ---------- Checkout ----------
function openCheckout() {
  const s = state.settings;
  const methods = [
    s.razorpayKeyId && { id: 'online', title: 'Pay online', sub: 'UPI, Cards, Netbanking, Wallets' },
    s.upiEnabled && s.upiId && { id: 'upi', title: 'UPI (scan QR)', sub: 'GPay, PhonePe, Paytm & more' },
    s.codEnabled && { id: 'cod', title: 'Cash on delivery', sub: 'Pay when you receive' },
  ].filter(Boolean);
  if (!methods.some((m) => m.id === state.payMethod)) state.payMethod = methods[0]?.id;
  $('#payOptions').innerHTML = methods.map((m) => `
    <label class="pay ${m.id === state.payMethod ? 'active' : ''}"><input type="radio" name="pay" value="${m.id}" ${m.id === state.payMethod ? 'checked' : ''}>
      <span><b>${m.title}</b><small>${m.sub}</small></span></label>`).join('') || '<p class="error">No payment methods are enabled.</p>';
  try {
    const saved = JSON.parse(localStorage.getItem('customer') || '{}');
    for (const [k, v] of Object.entries(saved)) if ($('#checkoutForm').elements[k]) $('#checkoutForm').elements[k].value = v;
  } catch {}
  updateCheckout();
  $('#checkoutError').hidden = true;
  open('#checkoutModal');
}

$('#payOptions').addEventListener('change', (e) => {
  state.payMethod = e.target.value;
  document.querySelectorAll('.pay').forEach((l) => l.classList.toggle('active', l.querySelector('input').checked));
  updateCheckout();
});

function updateCheckout() {
  const t = totals();
  const s = state.settings;
  $('#checkoutSummary').innerHTML = summaryHtml(t);
  const upi = state.payMethod === 'upi';
  $('#upiBox').hidden = !upi;
  $('#upiRef').required = upi;
  if (upi) {
    const link = `upi://pay?pa=${encodeURIComponent(s.upiId)}&pn=${encodeURIComponent(s.upiName || s.storeName)}&am=${t.total}&cu=INR&tn=${encodeURIComponent(s.storeName + ' order')}`;
    $('#upiAmount').textContent = money(t.total);
    $('#upiIdText').textContent = s.upiId;
    $('#upiAppLink').href = link;
    $('#upiQr').innerHTML = `<img src="/api/upi-qr?amount=${t.total}" width="180" height="180" alt="UPI QR code">`;
  }
  $('#placeOrder').textContent = state.payMethod === 'online' ? `Pay ${money(t.total)}` : `Place order · ${money(t.total)}`;
}

$('#checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const btn = $('#placeOrder');
  const err = $('#checkoutError');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Placing order…';
  try {
    const { paymentReference, pay, ...customer } = f;
    try { localStorage.setItem('customer', JSON.stringify({ ...customer, note: '' })); } catch {}
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, paymentMethod: state.payMethod, paymentReference, items: Object.entries(state.cart).map(([id, qty]) => ({ id, qty })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not place order');
    if (data.razorpay) await payOnline(data);
    state.cart = {};
    saveCart();
    close($('#checkoutModal'));
    showSuccess(data);
    refreshStock();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    updateCheckout();
  }
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load payment gateway'));
    document.head.appendChild(s);
  });
}

async function payOnline(data) {
  if (!window.Razorpay) await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  const o = data.order;
  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: data.razorpay.keyId,
      amount: data.razorpay.amount,
      currency: 'INR',
      name: state.settings.storeName,
      description: `Order #${o.number}`,
      order_id: data.razorpay.orderId,
      prefill: { name: o.customer.name, contact: o.customer.phone, email: o.customer.email },
      theme: { color: state.settings.primaryColor },
      handler: async (resp) => {
        const r = await fetch(`/api/orders/${o.id}/verify-payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...resp, token: o.token }) }).then((x) => x.json());
        if (r.order) data.order = r.order;
        resolve();
      },
      modal: { ondismiss: resolve }, // order stays with payment "pending"; admin can follow up
    });
    rzp.open();
  });
}

function showSuccess(data) {
  const o = data.order;
  const paid = o.payment.status === 'paid';
  $('#successText').innerHTML = `Order <b>#${o.number}</b> for <b>${money(o.total)}</b> has been received.<br>${
    paid ? 'Payment successful ✅' : o.payment.method === 'cod' ? 'Please keep cash ready at delivery.' : 'Payment will be verified by the store shortly.'}`;
  $('#successTrack').href = `/order?id=${o.id}&token=${o.token}`;
  $('#successWa').hidden = !data.whatsappLink;
  if (data.whatsappLink) $('#successWa').href = data.whatsappLink;
  open('#successModal');
}

async function refreshStock() {
  const data = await fetch('/api/store').then((r) => r.json());
  state.products = data.products;
  renderProducts();
}

init();
