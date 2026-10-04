# 🛍️ ShopKart – E-commerce store with Admin dashboard & WhatsApp orders

A complete, ready-to-deploy online store:

- **Storefront** – product catalogue, categories, search, sorting, product details, cart, checkout and order tracking. Mobile-first.
- **Payments** – Cash on Delivery, **UPI QR** (auto-generated QR with the exact amount + UTR capture) and optional **Razorpay** (cards / UPI / netbanking) with server-side signature verification.
- **Admin dashboard** (`/admin`)
  - 📊 Dashboard: revenue, pending payments, today's orders, 7-day chart, low-stock alerts
  - 🧾 Orders: live list (new orders pop up instantly with a sound), filter/search, change order & payment status inline, order detail with history and notes, CSV export
  - 💳 Payments: every payment with method, UTR/reference and status
  - 📦 Products: add / edit / delete, image upload, price & MRP, stock, featured, show/hide
  - ⚙️ Store settings: store name, banner text, announcement, brand colour, delivery fee, free-delivery threshold, UPI ID, WhatsApp number, payment methods, categories – **no code changes needed**
- **WhatsApp**
  - Every new order is sent to the admin's WhatsApp **automatically** (via CallMeBot or the official WhatsApp Cloud API – see below)
  - After checkout the customer gets a **"Send order on WhatsApp"** button with the full order pre-filled
  - Admin can **send the orders list on WhatsApp** (all / today / filtered) with one click
  - One-click WhatsApp message to any customer about their order status
  - Floating WhatsApp chat button on the store

## Quick start

```bash
npm install
cp .env.example .env      # then edit ADMIN_PASSWORD and SESSION_SECRET
npm start
```

- Store: http://localhost:3000
- Admin: http://localhost:3000/admin (default `admin` / `admin123` – **change it in `.env`**)

First thing to do in the admin: open **Store settings** and set your store name, WhatsApp number (with country code, e.g. `919876543210`) and UPI ID.

Data is stored in `data/db.json` and uploaded images in `uploads/` – back these up.

## Automatic WhatsApp order alerts

Without any setup the customer can send the order to your WhatsApp from the success screen, and you can share order lists from the admin. For **fully automatic** alerts on every order, choose one:

**Option A – CallMeBot (free, 2 minutes)**
1. Save `+34 644 66 32 62` in your phone contacts.
2. Send it the WhatsApp message `I allow callmebot to send me messages`.
3. You'll receive an API key. Put it in `.env`:
   ```
   CALLMEBOT_APIKEY=123456
   WHATSAPP_ADMIN_NUMBER=919876543210
   ```

**Option B – WhatsApp Cloud API (official, Meta)**
Create an app at developers.facebook.com → WhatsApp, then set:
```
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ADMIN_NUMBER=919876543210
```

## Online payments (optional)

Create a Razorpay account and add your keys to `.env`:
```
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
```
A **Pay online** option then appears at checkout. Payments are verified on the server and the order is marked *paid* + *confirmed* automatically.

## Deploy / publish

**Render (one click):** push this repo to GitHub → in Render choose *New → Blueprint* → select the repo. `render.yaml` sets up the app with a persistent disk for orders and images. Set `ADMIN_PASSWORD` when prompted.

**Docker / any VPS:**
```bash
docker build -t shopkart .
docker run -d -p 3000:3000 --env-file .env -v shop-data:/app/data -v shop-uploads:/app/uploads shopkart
```

**Railway / Fly.io / a plain VPS** also work – run `npm start` and mount a persistent volume for `data/` and `uploads/` (or set `DATA_DIR` / `UPLOAD_DIR`).

## Tests

```bash
npm test
```

## Tech

Node.js + Express, plain HTML/CSS/JS (no build step), JSON file storage with atomic writes, Server-Sent Events for the live admin feed.
