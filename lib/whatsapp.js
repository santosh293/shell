// WhatsApp helpers: message formatting, wa.me links and optional automatic delivery.
function money(settings, n) {
  return `${settings.currency}${Number(n).toLocaleString('en-IN')}`;
}

function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function orderMessage(order, settings) {
  const lines = [
    `🛒 *New Order #${order.number}* – ${settings.storeName}`,
    '',
    ...order.items.map((i) => `• ${i.name} × ${i.qty} = ${money(settings, i.price * i.qty)}`),
    '',
    `Subtotal: ${money(settings, order.subtotal)}`,
    `Delivery: ${order.deliveryFee ? money(settings, order.deliveryFee) : 'FREE'}`,
    `*Total: ${money(settings, order.total)}*`,
    '',
    `💳 Payment: ${order.payment.method.toUpperCase()} (${order.payment.status})`,
    order.payment.reference ? `Ref: ${order.payment.reference}` : null,
    '',
    `👤 ${order.customer.name}`,
    `📞 ${order.customer.phone}`,
    `📍 ${order.customer.address}, ${order.customer.city} - ${order.customer.pincode}`,
    order.customer.note ? `📝 ${order.customer.note}` : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function ordersListMessage(orders, settings, title = 'Orders') {
  const total = orders.reduce((s, o) => s + o.total, 0);
  const lines = [
    `📋 *${settings.storeName} – ${title}* (${orders.length})`,
    '',
    ...orders.map((o) => `#${o.number} | ${o.customer.name} | ${o.customer.phone} | ${money(settings, o.total)} | ${o.payment.method.toUpperCase()}-${o.payment.status} | ${o.status}`),
    '',
    `*Total value: ${money(settings, total)}*`,
  ];
  return lines.join('\n');
}

function waLink(phone, text) {
  return `https://wa.me/${digits(phone)}?text=${encodeURIComponent(text)}`;
}

// Sends automatically if WhatsApp Cloud API or CallMeBot is configured. Never throws.
async function notifyAdmin(text, settings) {
  const to = digits(process.env.WHATSAPP_ADMIN_NUMBER || settings.whatsappNumber);
  if (!to) return { sent: false, reason: 'no admin number' };
  try {
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      });
      return { sent: r.ok, via: 'cloud-api', status: r.status };
    }
    if (process.env.CALLMEBOT_APIKEY) {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${to}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(process.env.CALLMEBOT_APIKEY)}`;
      const r = await fetch(url);
      return { sent: r.ok, via: 'callmebot', status: r.status };
    }
    return { sent: false, reason: 'not configured' };
  } catch (err) {
    console.error('WhatsApp notify failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { orderMessage, ordersListMessage, waLink, notifyAdmin, digits };
