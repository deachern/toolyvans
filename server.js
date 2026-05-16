const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

// ─────────────────────────────────────────
// NATIVE HTTPS HELPER (replaces axios)
// ─────────────────────────────────────────
function httpsRequest(method, hostname, path, data, headers) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const options = {
      hostname,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function paystackPost(path, data) {
  return httpsRequest('POST', 'api.paystack.co', path, data, {
    Authorization: `Bearer ${PAYSTACK_SECRET}`
  });
}
function paystackGet(path) {
  return httpsRequest('GET', 'api.paystack.co', path, null, {
    Authorization: `Bearer ${PAYSTACK_SECRET}`
  });
}

const app = express();

// ─────────────────────────────────────────
// FILE-BASED DATABASE
// Uses /tmp for Vercel serverless (ephemeral but better than pure in-memory)
// Swap readDB/writeDB for a real DB driver (MongoDB/Supabase) for production
// ─────────────────────────────────────────
const DB_PATH = path.join('/tmp', 'toolyvans_db.json');

function readDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) { /* corrupted file — start fresh */ }
  return { users: [], transactions: [], generatedSites: [], generatedReceipts: [] };
}

function writeDB(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('DB write error:', e.message);
  }
}

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'toolyvans_jwt_secret_change_in_production_2024';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const SUPPORT_SITE_PRICE = 3;  // $3/day
const RECEIPT_PRICE = 2;       // $2/day

const PLATFORM_NAMES = {
  binance:'Binance', bybit:'Bybit', coinbase:'Coinbase',
  metamask:'MetaMask', trustwallet:'Trust Wallet', robinhood:'Robinhood',
  phantom:'Phantom', kraken:'Kraken', kucoin:'KuCoin', okx:'OKX'
};

// ─────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!token) return res.status(401).json({ error: 'Unauthorized: no token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

// ─────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = readDB();
    const emailLower = email.toLowerCase().trim();

    if (db.users.find(u => u.email === emailLower))
      return res.status(400).json({ error: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 12);
    const user = {
      id: uuidv4(),
      name: name.trim(),
      email: emailLower,
      password: hashed,
      balance: 0,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDB(db);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '14d' });
    return res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, balance: user.balance }
    });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const db = readDB();
    const user = db.users.find(u => u.email === email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '14d' });
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, balance: user.balance }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, email: user.email, balance: user.balance });
});

// ─────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────

app.get('/api/dashboard', auth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const txs = db.transactions
    .filter(t => t.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);

  const sites = db.generatedSites.filter(s => s.userId === req.user.id);
  const receipts = db.generatedReceipts.filter(r => r.userId === req.user.id);
  const totalSpent = txs
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  res.json({
    balance: user.balance,
    transactions: txs,
    stats: {
      sites: sites.length,
      receipts: receipts.length,
      totalSpent: parseFloat(totalSpent.toFixed(2))
    }
  });
});

// ─────────────────────────────────────────
// PAYSTACK PAYMENT
// ─────────────────────────────────────────

app.post('/api/payment/initialize', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || parseFloat(amount) < 5)
      return res.status(400).json({ error: 'Minimum deposit is $5' });

    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const amountKobo = Math.round(parseFloat(amount) * 100);

    const response = await paystackPost(
      '/transaction/initialize',
      {
        email: user.email,
        amount: amountKobo,
        currency: 'NGN',
        reference: 'TV-' + Date.now() + '-' + uuidv4().split('-')[0],
        callback_url: (process.env.APP_URL || 'https://toolyvans.vercel.app'),
        metadata: {
          userId: user.id,
          depositAmountUSD: amount,
          custom_fields: [{ display_name: 'Platform', variable_name: 'platform', value: 'Toolyvans' }]
        }
      }
    );

    res.json({
      authorizationUrl: response.data.data.authorization_url,
      reference: response.data.data.reference,
      accessCode: response.data.data.access_code
    });
  } catch (e) {
    console.error('Paystack init error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

app.post('/api/payment/verify', auth, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Reference is required' });

    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent double-crediting
    const already = db.transactions.find(t => t.reference === reference && t.type === 'deposit');
    if (already) {
      return res.json({ success: true, balance: user.balance, amount: already.amount, alreadyProcessed: true });
    }

    const response = await paystackGet(`/transaction/verify/${reference}`);

    const pData = response.data.data;
    if (pData.status !== 'success')
      return res.status(400).json({ error: `Payment not successful. Status: ${pData.status}` });

    // Amount from Paystack is in kobo → divide by 100 for USD (1:1 demo parity)
    const amountUSD = parseFloat((pData.amount / 100).toFixed(2));
    user.balance = parseFloat((user.balance + amountUSD).toFixed(2));

    const tx = {
      id: uuidv4(),
      userId: user.id,
      type: 'deposit',
      description: 'Paystack Deposit',
      amount: amountUSD,
      reference,
      status: 'success',
      icon: 'add_task',
      channel: pData.channel || 'paystack',
      createdAt: new Date().toISOString()
    };
    db.transactions.push(tx);
    writeDB(db);

    res.json({ success: true, balance: user.balance, amount: amountUSD, transaction: tx });
  } catch (e) {
    console.error('Paystack verify error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// ─────────────────────────────────────────
// TOOL 1: SUPPORT SITE GENERATOR
// ─────────────────────────────────────────

app.post('/api/tools/support-site/generate', auth, async (req, res) => {
  try {
    const { platform, contactMethod, contactValue, chatbotCode, days } = req.body;

    if (!platform) return res.status(400).json({ error: 'Platform is required' });
    if (!contactMethod) return res.status(400).json({ error: 'Contact method is required' });
    if (contactMethod !== 'chatbot' && !contactValue?.trim())
      return res.status(400).json({ error: 'Contact value is required' });
    if (contactMethod === 'chatbot' && !chatbotCode?.trim())
      return res.status(400).json({ error: 'Chatbot embed code is required' });
    const daysInt = parseInt(days);
    if (!daysInt || daysInt < 1 || daysInt > 30)
      return res.status(400).json({ error: 'Duration must be between 1 and 30 days' });

    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const totalCost = parseFloat((daysInt * SUPPORT_SITE_PRICE).toFixed(2));
    if (user.balance < totalCost)
      return res.status(400).json({
        error: `Insufficient balance. You need $${totalCost.toFixed(2)} but have $${user.balance.toFixed(2)}.`
      });

    user.balance = parseFloat((user.balance - totalCost).toFixed(2));

    const siteId = uuidv4().replace(/-/g,'').slice(0, 10);
    const platformKey = platform.toLowerCase();
    const slug = `${platformKey}-support-${siteId}`;
    const expiresAt = new Date(Date.now() + daysInt * 86400000).toISOString();

    const site = {
      id: siteId,
      userId: user.id,
      type: 'support-site',
      platform: platformKey,
      contactMethod,
      contactValue: contactValue?.trim() || '',
      chatbotCode: chatbotCode?.trim() || '',
      days: daysInt,
      totalCost,
      slug,
      expiresAt,
      createdAt: new Date().toISOString(),
      active: true
    };

    db.generatedSites.push(site);
    db.transactions.push({
      id: uuidv4(),
      userId: user.id,
      type: 'billing',
      description: `Support Site — ${PLATFORM_NAMES[platformKey] || platform} (${daysInt} days)`,
      amount: -totalCost,
      reference: `SITE-${siteId}`,
      status: 'success',
      icon: 'support_agent',
      createdAt: new Date().toISOString()
    });
    writeDB(db);

    res.json({ success: true, siteId, slug, viewUrl: `/view/${slug}`, expiresAt, newBalance: user.balance, cost: totalCost });
  } catch (e) {
    console.error('Support site error:', e);
    res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
});

app.get('/api/tools/support-site/list', auth, (req, res) => {
  const db = readDB();
  const sites = db.generatedSites
    .filter(s => s.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ sites });
});

// ─────────────────────────────────────────
// TOOL 2: RECEIPT GENERATOR
// ─────────────────────────────────────────

app.post('/api/tools/receipt/generate', auth, async (req, res) => {
  try {
    const { platform, tradeType, asset, amount, price, totalValue, date, txId, walletAddress, fee, days } = req.body;

    if (!platform) return res.status(400).json({ error: 'Platform is required' });
    if (!asset?.trim()) return res.status(400).json({ error: 'Asset is required' });
    if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: 'Valid amount is required' });
    if (!price || isNaN(parseFloat(price))) return res.status(400).json({ error: 'Valid price is required' });
    if (!date) return res.status(400).json({ error: 'Trade date is required' });
    if (!txId?.trim()) return res.status(400).json({ error: 'Transaction ID is required' });
    const daysInt = parseInt(days);
    if (!daysInt || daysInt < 1 || daysInt > 30)
      return res.status(400).json({ error: 'Duration must be 1–30 days' });

    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const totalCost = parseFloat((daysInt * RECEIPT_PRICE).toFixed(2));
    if (user.balance < totalCost)
      return res.status(400).json({
        error: `Insufficient balance. You need $${totalCost.toFixed(2)} but have $${user.balance.toFixed(2)}.`
      });

    user.balance = parseFloat((user.balance - totalCost).toFixed(2));

    const receiptId = uuidv4().replace(/-/g,'').slice(0, 10);
    const platformKey = platform.toLowerCase();
    const slug = `${platformKey}-receipt-${receiptId}`;
    const expiresAt = new Date(Date.now() + daysInt * 86400000).toISOString();
    const computedTotal = (parseFloat(amount) * parseFloat(price)).toFixed(2);

    const receipt = {
      id: receiptId,
      userId: user.id,
      type: 'receipt',
      platform: platformKey,
      tradeType: (tradeType || 'BUY').toUpperCase(),
      asset: asset.trim().toUpperCase(),
      amount: parseFloat(parseFloat(amount).toFixed(8)),
      price: parseFloat(parseFloat(price).toFixed(2)),
      totalValue: parseFloat(totalValue || computedTotal),
      date,
      txId: txId.trim(),
      walletAddress: walletAddress?.trim() || '',
      fee: parseFloat(parseFloat(fee || 0).toFixed(2)),
      days: daysInt,
      totalCost,
      slug,
      expiresAt,
      createdAt: new Date().toISOString(),
      active: true
    };

    db.generatedReceipts.push(receipt);
    db.transactions.push({
      id: uuidv4(),
      userId: user.id,
      type: 'billing',
      description: `Receipt — ${PLATFORM_NAMES[platformKey] || platform} ${receipt.tradeType} ${receipt.asset} (${daysInt} days)`,
      amount: -totalCost,
      reference: `RCPT-${receiptId}`,
      status: 'success',
      icon: 'receipt_long',
      createdAt: new Date().toISOString()
    });
    writeDB(db);

    res.json({ success: true, receiptId, slug, viewUrl: `/view/${slug}`, expiresAt, newBalance: user.balance, cost: totalCost });
  } catch (e) {
    console.error('Receipt generate error:', e);
    res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
});

app.get('/api/tools/receipt/list', auth, (req, res) => {
  const db = readDB();
  const receipts = db.generatedReceipts
    .filter(r => r.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ receipts });
});

// ─────────────────────────────────────────
// PUBLIC VIEW ENDPOINT (no auth required)
// ─────────────────────────────────────────

app.get('/api/view/:slug', (req, res) => {
  const { slug } = req.params;
  const db = readDB();

  const site = db.generatedSites.find(s => s.slug === slug);
  if (site) {
    if (new Date() > new Date(site.expiresAt))
      return res.status(410).json({ error: 'expired', message: 'This support site link has expired.' });
    const { userId, password, ...pub } = site;
    return res.json({ type: 'support-site', data: pub });
  }

  const receipt = db.generatedReceipts.find(r => r.slug === slug);
  if (receipt) {
    if (new Date() > new Date(receipt.expiresAt))
      return res.status(410).json({ error: 'expired', message: 'This receipt link has expired.' });
    const { userId, ...pub } = receipt;
    return res.json({ type: 'receipt', data: pub });
  }

  res.status(404).json({ error: 'not_found', message: 'This link does not exist or has been removed.' });
});

// ─────────────────────────────────────────
// SPA FALLBACKS — must be last
// ─────────────────────────────────────────

app.get('/view/*', (_req, res) =>
  res.sendFile(path.join(__dirname, '../public/view.html'))
);

app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html'))
);

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀  Toolyvans running → http://localhost:${PORT}`);
  console.log(`📦  DB: ${DB_PATH}`);
});

module.exports = app;
