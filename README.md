# Toolyvans — Fintech Platform

A full-stack fintech web app where users sign up, fund their wallet via **Paystack**, and purchase two professional tools:
- **Support Site Generator** — branded trading-platform support microsites ($3/day)
- **Transaction Receipt Generator** — platform-branded trade receipts ($2/day)

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS SPA (hash routing), Tailwind-inspired CSS |
| Backend | Node.js + Express |
| Auth | JWT (14-day tokens) + bcrypt |
| Payments | Paystack Inline JS (live key wired in) |
| Database | JSON file via `/tmp` (swap for MongoDB/Supabase at scale) |
| Hosting | Vercel (Node serverless) |

---

## Project Structure

```
toolyvans/
├── api/
│   └── server.js          ← Express backend (all API routes)
├── public/
│   ├── index.html         ← Main SPA (auth + dashboard)
│   └── view.html          ← Public view page (support sites & receipts)
├── .env.example           ← Environment variable template
├── .gitignore
├── package.json
├── vercel.json            ← Vercel deployment config
└── README.md
```

---

## Local Development

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
```

Edit `.env`:
```
JWT_SECRET=your_strong_random_secret_here
PAYSTACK_SECRET_KEY=sk_live_YOUR_SECRET_KEY
PAYSTACK_PUBLIC_KEY=pk_live_69fcc7c11f24d782bb103fddf833dee1daa85e9d
APP_URL=http://localhost:3000
NODE_ENV=development
```

> ⚠️ **Never commit `.env` to git.** The Paystack secret key must stay server-side only.

### 3. Start the server
```bash
npm start
```

Visit: `http://localhost:3000`

---

## Deploy to Vercel

### Option A — Vercel CLI (recommended)
```bash
npm install -g vercel
vercel login
vercel
```

### Option B — GitHub → Vercel dashboard
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
3. Vercel auto-detects the config from `vercel.json`
4. Add environment variables in **Project Settings → Environment Variables**:

| Key | Value |
|---|---|
| `JWT_SECRET` | `your_strong_random_secret` |
| `PAYSTACK_SECRET_KEY` | `sk_live_YOUR_SECRET_KEY` |
| `APP_URL` | `https://your-app.vercel.app` |
| `NODE_ENV` | `production` |

5. Click **Deploy** ✅

---

## API Reference

### Auth
| Method | Path | Body | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | `{name, email, password}` | — |
| POST | `/api/auth/login` | `{email, password}` | — |
| GET | `/api/auth/me` | — | ✅ Bearer |

### Dashboard
| Method | Path | Auth |
|---|---|---|
| GET | `/api/dashboard` | ✅ Bearer |

### Payments
| Method | Path | Body | Auth |
|---|---|---|---|
| POST | `/api/payment/verify` | `{reference}` | ✅ Bearer |

### Tools
| Method | Path | Body | Auth |
|---|---|---|---|
| POST | `/api/tools/support-site/generate` | `{platform, contactMethod, contactValue, days}` | ✅ |
| GET | `/api/tools/support-site/list` | — | ✅ |
| POST | `/api/tools/receipt/generate` | `{platform, tradeType, asset, amount, price, date, txId, days}` | ✅ |
| GET | `/api/tools/receipt/list` | — | ✅ |

### Public View
| Method | Path | Auth |
|---|---|---|
| GET | `/api/view/:slug` | — (public) |
| GET | `/view/:slug` | — (renders `view.html`) |

---

## Pricing

| Tool | Price |
|---|---|
| Support Site Generator | $3 × days selected |
| Transaction Receipt Generator | $2 × days selected |
| Duration | 1 – 30 days |

---

## Supported Platforms

Binance · Bybit · Coinbase · MetaMask · Trust Wallet · Robinhood · Phantom · Kraken · KuCoin · OKX

Each platform has its own:
- Color theme and branding
- Custom FAQ content
- Branded receipt styling
- Floating contact button (support sites)

---

## Upgrading the Database

The current `/tmp` JSON file approach works for demos and low-traffic apps. For production:

1. Sign up for [MongoDB Atlas](https://www.mongodb.com/atlas) (free tier)
2. Replace `readDB()` / `writeDB()` in `api/server.js` with Mongoose calls
3. Add `MONGODB_URI` to your Vercel environment variables

---

## Security Notes

- JWT tokens expire in 14 days
- Passwords hashed with bcrypt (12 rounds)
- Paystack secret key is server-side only
- Public view endpoints strip `userId` from responses
- Duplicate payment references are rejected (double-credit protection)
