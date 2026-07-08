/**
 * Ṣalawāt — compteur hebdomadaire (serveur unique : API + site statique)
 *
 * Connexion par compte Google (le serveur vérifie le jeton), données par
 * utilisateur dans une base SQLite (un simple fichier dans data/).
 * Chaque ajout est enregistré à sa date ; la semaine démarre au jour choisi
 * par l'utilisateur (vendredi par défaut). Les semaines passées non clôturées
 * sont archivées automatiquement pour ne rien perdre.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const { OAuth2Client } = require('google-auth-library');

const PORT = process.env.PORT || 3001;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 180;

if (!CLIENT_ID) {
  console.warn('[salawat] GOOGLE_CLIENT_ID manquant dans .env : la connexion ne fonctionnera pas.');
}

// --- Base de données ---------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'salawat.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  week_start INTEGER NOT NULL DEFAULT 5, -- 0=dimanche ... 5=vendredi, 6=samedi
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,            -- AAAA-MM-JJ (jour local de l'utilisateur)
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date);
CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total INTEGER NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_weeks_user ON weeks(user_id, start_date);
`);

// --- Outils de dates (tout en AAAA-MM-JJ, ancré à midi UTC) ------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
}
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayOfWeek(iso) {
  return new Date(iso + 'T12:00:00Z').getUTCDay(); // 0=dimanche ... 6=samedi
}
// Premier jour de la semaine contenant `iso`, la semaine commençant à `startDow`.
function weekStartFor(iso, startDow) {
  const diff = (dayOfWeek(iso) - startDow + 7) % 7;
  return addDaysISO(iso, -diff);
}

// --- Sessions -----------------------------------------------------------------
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}
function auth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ ok: false, error: 'auth' });
  const row = db.prepare(
    `SELECT s.expires_at, u.id AS uid, u.name, u.email, u.week_start
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(token);
  if (!row || row.expires_at < new Date().toISOString()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ ok: false, error: 'auth' });
  }
  req.user = { id: row.uid, name: row.name, email: row.email, week_start: row.week_start };
  next();
}

// --- Archivage automatique des semaines passées -------------------------------
function autoArchive(user, currentWeekStart) {
  const old = db.prepare('SELECT date, amount FROM entries WHERE user_id = ? AND date < ?')
    .all(user.id, currentWeekStart);
  if (!old.length) return 0;
  const groups = new Map();
  for (const e of old) {
    const ws = weekStartFor(e.date, user.week_start);
    groups.set(ws, (groups.get(ws) || 0) + e.amount);
  }
  const ins = db.prepare('INSERT INTO weeks (user_id, start_date, end_date, total) VALUES (?, ?, ?, ?)');
  const del = db.prepare('DELETE FROM entries WHERE user_id = ? AND date < ?');
  const tx = db.transaction(() => {
    for (const [ws, total] of groups) {
      if (total > 0) ins.run(user.id, ws, addDaysISO(ws, 6), total);
    }
    del.run(user.id, currentWeekStart);
  });
  tx();
  return groups.size;
}

// --- Application ---------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const oauth = new OAuth2Client(CLIENT_ID);

// Le frontend a besoin du Client ID (information publique).
app.get('/api/config', (_req, res) => res.json({ ok: true, clientId: CLIENT_ID }));

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential || !CLIENT_ID) return res.status(400).json({ ok: false, error: 'credential' });
    const ticket = await oauth.verifyIdToken({ idToken: credential, audience: CLIENT_ID });
    const p = ticket.getPayload();
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(p.sub);
    if (!user) {
      const info = db.prepare('INSERT INTO users (google_sub, name, email) VALUES (?, ?, ?)')
        .run(p.sub, p.name || '', p.email || '');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else {
      db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(p.name || user.name, p.email || user.email, user.id);
    }
    const token = createSession(user.id);
    res.cookie('session', token, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'Lax',
      maxAge: SESSION_DAYS * 86400000,
      path: '/',
    });
    // ménage léger des sessions expirées
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth]', e.message);
    res.status(401).json({ ok: false, error: 'verification' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

// État complet : semaine en cours, historique, totaux.
app.get('/api/state', auth, (req, res) => {
  const today = req.query.today;
  if (!isValidDate(today)) return res.status(400).json({ ok: false, error: 'date' });

  const ws = weekStartFor(today, req.user.week_start);
  const archivedNow = autoArchive(req.user, ws);

  const rows = db.prepare(
    'SELECT date, SUM(amount) AS total FROM entries WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date'
  ).all(req.user.id, ws, addDaysISO(ws, 6));
  const byDate = new Map(rows.map((r) => [r.date, r.total]));

  const days = [];
  let weekTotal = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDaysISO(ws, i);
    const total = byDate.get(date) || 0;
    weekTotal += total;
    days.push({ date, total });
  }

  const history = db.prepare(
    'SELECT start_date, end_date, total, saved_at FROM weeks WHERE user_id = ? ORDER BY start_date DESC LIMIT 26'
  ).all(req.user.id);
  const archivedTotal = db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM weeks WHERE user_id = ?')
    .get(req.user.id).t;

  res.json({
    ok: true,
    user: { name: req.user.name, weekStart: req.user.week_start },
    week: { start: ws, end: addDaysISO(ws, 6), days, total: weekTotal },
    history,
    allTimeTotal: archivedTotal + weekTotal,
    archivedNow,
  });
});

// Ajout d'une saisie (au jour local envoyé par le client).
app.post('/api/entries', auth, (req, res) => {
  const { date, amount } = req.body || {};
  const n = Number(amount);
  if (!isValidDate(date)) return res.status(400).json({ ok: false, error: 'date' });
  if (!Number.isInteger(n) || n < 1 || n > 1000000) return res.status(400).json({ ok: false, error: 'amount' });
  db.prepare('INSERT INTO entries (user_id, date, amount) VALUES (?, ?, ?)').run(req.user.id, date, n);
  res.json({ ok: true });
});

// Annuler la dernière saisie d'un jour donné.
app.delete('/api/entries/last', auth, (req, res) => {
  const date = req.query.date;
  if (!isValidDate(date)) return res.status(400).json({ ok: false, error: 'date' });
  const last = db.prepare(
    'SELECT id, amount FROM entries WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1'
  ).get(req.user.id, date);
  if (!last) return res.status(404).json({ ok: false, error: 'empty' });
  db.prepare('DELETE FROM entries WHERE id = ?').run(last.id);
  res.json({ ok: true, removed: last.amount });
});

// Clôturer la semaine en cours : archive le total puis remet à zéro.
app.post('/api/week/close', auth, (req, res) => {
  const { today } = req.body || {};
  if (!isValidDate(today)) return res.status(400).json({ ok: false, error: 'date' });
  const ws = weekStartFor(today, req.user.week_start);
  const we = addDaysISO(ws, 6);
  const total = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS t FROM entries WHERE user_id = ? AND date BETWEEN ? AND ?'
  ).get(req.user.id, ws, we).t;
  if (total <= 0) return res.status(400).json({ ok: false, error: 'empty' });
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO weeks (user_id, start_date, end_date, total) VALUES (?, ?, ?, ?)')
      .run(req.user.id, ws, we, total);
    db.prepare('DELETE FROM entries WHERE user_id = ? AND date BETWEEN ? AND ?').run(req.user.id, ws, we);
  });
  tx();
  res.json({ ok: true, total });
});

// Réglage : jour de début de semaine (0=dimanche ... 6=samedi).
app.post('/api/settings', auth, (req, res) => {
  const n = Number((req.body || {}).week_start);
  if (!Number.isInteger(n) || n < 0 || n > 6) return res.status(400).json({ ok: false, error: 'week_start' });
  db.prepare('UPDATE users SET week_start = ? WHERE id = ?').run(n, req.user.id);
  res.json({ ok: true });
});

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

app.listen(PORT, () => console.log(`Ṣalawāt : http://localhost:${PORT}`));
