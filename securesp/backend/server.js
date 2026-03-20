require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const db = require('./config/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security Headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || `http://localhost:${process.env.PORT || 3000}`).split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());

// ── Global Rate Limiter ───────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/student', require('./routes/student'));
app.use('/api/admin',   require('./routes/admin'));

// ── Serve Static Frontend ──────────────────────────────────────────────────────
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND, { index: false }));

const pages = {
  '/':          'index.html',
  '/login':     'index.html',
  '/register':  'index.html',
  '/dashboard': 'dashboard.html',
  '/admin':     'admin.html',
};
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (_, res) => res.sendFile(path.join(FRONTEND, file)));
}

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint not found.' });
  res.status(404).sendFile(path.join(FRONTEND, 'index.html'));
});

// ── Global Error Handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── Start: initialise DB first, then listen ────────────────────────────────────
async function start() {
  try {
    console.log('  Initialising database…');
    await db.initDb();
    console.log('  Database ready.');

    app.listen(PORT, () => {
      console.log(`\n  Secure Student Portal`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  URL:  http://localhost:${PORT}`);
      console.log(`  Env:  ${process.env.NODE_ENV || 'development'}`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Run seed: npm run seed\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
