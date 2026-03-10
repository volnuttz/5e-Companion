const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const os = require('os');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');

// Static SRD reference data (read-only)
const spellsDB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-spells.json'), 'utf-8'));
const featsDB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-feats.json'), 'utf-8'));
const speciesTraitsDB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-species-traits.json'), 'utf-8'));
const equipmentDB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-equipment.json'), 'utf-8'));
let monstersDB = [];
try { monstersDB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-monsters.json'), 'utf-8')); } catch(e) {}
let classFeatsDB = {};
try { classFeatsDB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-class-features.json'), 'utf-8')); } catch(e) {}

app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(express.static(path.join(__dirname, 'public')));

// Global rate limit: 100 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
}));

// Strict rate limit for PIN attempts
const pinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: 'Too many PIN attempts, please try again later' }
});

// SSE: connected players
const sseClients = new Set();

// --- Helpers ---

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function parseJSON(val, fallback) {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch(e) { return fallback; }
  }
  return val != null ? val : fallback;
}

function charRowToJSON(row) {
  return {
    _id: row.id,
    name: row.name,
    class: row.class,
    species: row.species,
    level: row.level,
    background: row.background,
    HP: row.hp,
    AC: row.ac,
    STR: row.str,
    DEX: row.dex,
    CON: row.con,
    INT: row.int,
    WIS: row.wis,
    CHA: row.cha,
    skills: parseJSON(row.skills, []),
    features: parseJSON(row.features, []),
    currency: parseJSON(row.currency, {}),
    equipment: parseJSON(row.equipment, []),
    spells: parseJSON(row.spells, [])
  };
}

// No-op auth middleware — single local DM, always authorized
function authDM(req, res, next) {
  req.dmId = 1;
  req.dmUsername = 'dm';
  next();
}

// --- SRD Reference Data (public, read-only) ---

app.get('/api/spells', (req, res) => res.json(spellsDB));
app.get('/api/feats', (req, res) => res.json(featsDB));
app.get('/api/species-traits', (req, res) => res.json(speciesTraitsDB));
app.get('/api/class-features', (req, res) => res.json(classFeatsDB));
app.get('/api/equipment', (req, res) => res.json(equipmentDB));
app.get('/api/monsters', (req, res) => res.json(monstersDB));

// --- Pages ---

app.get('/', (req, res) => {
  res.redirect('/dm');
});

app.get('/dm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dm.html'));
});

// --- Character validation & sanitization ---
const LIMITS = { equipment: 50, spells: 50, features: 50 };
const STR_LIMITS = { name: 100, class: 50, species: 50, background: 100 };

function sanitizeString(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function validateCharacter(c) {
  if (!c.name || typeof c.name !== 'string' || c.name.trim().length === 0) return 'Name is required';
  if (c.name.length > STR_LIMITS.name) return `Name too long (max ${STR_LIMITS.name} chars)`;
  if (c.class && c.class.length > STR_LIMITS.class) return 'Invalid class';
  if (c.species && c.species.length > STR_LIMITS.species) return 'Invalid species';
  if (c.background && c.background.length > STR_LIMITS.background) return 'Background too long';
  if (c.level != null && (c.level < 1 || c.level > 20)) return 'Level must be 1-20';
  if (c.HP != null && (c.HP < 0 || c.HP > 9999)) return 'Invalid HP';
  if (c.AC != null && (c.AC < 0 || c.AC > 99)) return 'Invalid AC';
  for (const a of ['STR','DEX','CON','INT','WIS','CHA']) {
    if (c[a] != null && (c[a] < 1 || c[a] > 30)) return `Invalid ${a} score`;
  }
  if (c.equipment && c.equipment.length > LIMITS.equipment) return `Equipment limit reached (max ${LIMITS.equipment})`;
  if (c.spells && c.spells.length > LIMITS.spells) return `Spells limit reached (max ${LIMITS.spells})`;
  if (c.features && c.features.length > LIMITS.features) return `Features limit reached (max ${LIMITS.features})`;
  return null;
}

function sanitizeCharacter(c) {
  c.name = sanitizeString(c.name, STR_LIMITS.name);
  c.class = sanitizeString(c.class, STR_LIMITS.class);
  c.species = sanitizeString(c.species, STR_LIMITS.species);
  c.background = sanitizeString(c.background, STR_LIMITS.background);
  c.level = Math.max(1, Math.min(20, parseInt(c.level) || 1));
  c.HP = Math.max(0, Math.min(9999, parseInt(c.HP) || 0));
  c.AC = Math.max(0, Math.min(99, parseInt(c.AC) || 0));
  for (const a of ['STR','DEX','CON','INT','WIS','CHA']) {
    c[a] = Math.max(1, Math.min(30, parseInt(c[a]) || 10));
  }
  if (c.equipment) {
    c.equipment = c.equipment.slice(0, LIMITS.equipment).map(e => ({
      name: sanitizeString(e.name, 100),
      type: sanitizeString(e.type, 50),
      description: sanitizeString(e.description, 500),
      quantity: Math.max(0, Math.min(9999, parseInt(e.quantity) || 1))
    }));
  }
  return c;
}

// --- API: Characters ---

app.get('/api/characters', authDM, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM characters ORDER BY name').all();
    res.json(rows.map(charRowToJSON));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/characters/:id', authDM, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(charRowToJSON(row));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/characters', authDM, (req, res) => {
  const id = uuidv4();
  const c = sanitizeCharacter(req.body);
  const err = validateCharacter(c);
  if (err) return res.status(400).json({ error: err });
  try {
    const count = db.prepare('SELECT COUNT(*) as n FROM characters').get();
    if (count.n >= 20) {
      return res.status(400).json({ error: 'Character limit reached (max 20)' });
    }
    db.prepare(
      `INSERT INTO characters (id, name, class, species, level, background, hp, ac, str, dex, con, int, wis, cha, skills, features, currency, equipment, spells)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, c.name, c.class, c.species, c.level, c.background,
      c.HP, c.AC, c.STR, c.DEX, c.CON, c.INT, c.WIS, c.CHA,
      JSON.stringify(c.skills || []), JSON.stringify(c.features || []),
      JSON.stringify(c.currency || {}), JSON.stringify(c.equipment || []),
      JSON.stringify(c.spells || [])
    );
    res.json({ _id: id, ...c });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/characters/:id', authDM, (req, res) => {
  const c = sanitizeCharacter(req.body);
  const err = validateCharacter(c);
  if (err) return res.status(400).json({ error: err });
  try {
    const result = db.prepare(
      `UPDATE characters SET name=?, class=?, species=?, level=?, background=?,
       hp=?, ac=?, str=?, dex=?, con=?, int=?, wis=?, cha=?,
       skills=?, features=?, currency=?, equipment=?, spells=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(
      c.name, c.class, c.species, c.level, c.background,
      c.HP, c.AC, c.STR, c.DEX, c.CON, c.INT, c.WIS, c.CHA,
      JSON.stringify(c.skills || []), JSON.stringify(c.features || []),
      JSON.stringify(c.currency || {}), JSON.stringify(c.equipment || []),
      JSON.stringify(c.spells || []),
      req.params.id
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    broadcastCharacterUpdate(req.params.id);
    res.json({ _id: req.params.id, ...c });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/characters/:id', authDM, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- API: Sessions ---

app.post('/api/sessions', authDM, (req, res) => {
  let { pin } = req.body;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN is required' });
  }
  pin = pin.trim().slice(0, 20);
  if (pin.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 characters' });
  }
  if (!/^[a-zA-Z0-9]+$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be alphanumeric' });
  }

  try {
    const charRows = db.prepare('SELECT id FROM characters').all();
    const characters = {};
    for (const row of charRows) {
      characters[row.id] = { claimedBy: null };
    }

    db.prepare(
      `INSERT INTO session (id, pin, characters) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET pin=excluded.pin, characters=excluded.characters, created_at=datetime('now')`
    ).run(pin, JSON.stringify(characters));

    res.json({ dmUsername: 'dm', pin, createdAt: new Date().toISOString(), characters });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sessions/mine', authDM, (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM session WHERE id = 1').get();
    if (!s) return res.status(404).json({ error: 'No active session' });
    res.json({ dmUsername: 'dm', pin: s.pin, createdAt: s.created_at, characters: parseJSON(s.characters, {}) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sessions/qr', authDM, async (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM session WHERE id = 1').get();
    if (!s) return res.status(404).json({ error: 'No active session' });
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const url = `${protocol}://${host}/join/dm`;
    const qr = await QRCode.toDataURL(url);
    res.json({ qr, url, pin: s.pin });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/battlefield', authDM, (req, res) => {
  try {
    const row = db.prepare('SELECT battlefield FROM dm WHERE id = 1').get();
    res.json(parseJSON(row?.battlefield, []));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/battlefield', authDM, (req, res) => {
  const battlefield = req.body;
  if (!Array.isArray(battlefield) || battlefield.length > 50) {
    return res.status(400).json({ error: 'Invalid battlefield data (max 50 monsters)' });
  }
  try {
    db.prepare('UPDATE dm SET battlefield = ? WHERE id = 1').run(JSON.stringify(battlefield));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Character HP (battlefield tracking) ---

app.get('/api/character-hp', authDM, (req, res) => {
  try {
    const row = db.prepare('SELECT character_hp FROM dm WHERE id = 1').get();
    res.json(parseJSON(row?.character_hp, {}));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/character-hp', authDM, (req, res) => {
  const hpData = req.body;
  if (typeof hpData !== 'object' || Array.isArray(hpData)) {
    return res.status(400).json({ error: 'Invalid character HP data' });
  }
  try {
    db.prepare('UPDATE dm SET character_hp = ? WHERE id = 1').run(JSON.stringify(hpData));
    for (const charId of Object.keys(hpData)) {
      broadcastCharacterUpdate(charId);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Treasures ---

app.get('/api/treasures', authDM, (req, res) => {
  try {
    const row = db.prepare('SELECT treasures FROM dm WHERE id = 1').get();
    res.json(parseJSON(row?.treasures, []));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/treasures', authDM, (req, res) => {
  const treasures = req.body;
  if (!Array.isArray(treasures) || treasures.length > 100) {
    return res.status(400).json({ error: 'Invalid treasures data (max 100 items)' });
  }
  const sanitizedTreasures = treasures.map(t => ({
    name: sanitizeString(t.name, 100),
    type: sanitizeString(t.type, 50),
    description: sanitizeString(t.description, 500),
    quantity: Math.max(0, Math.min(9999, parseInt(t.quantity) || 1))
  }));
  try {
    db.prepare('UPDATE dm SET treasures = ? WHERE id = 1').run(JSON.stringify(sanitizedTreasures));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/treasures/assign', authDM, (req, res) => {
  const { characterId, item } = req.body;
  if (!characterId || !item || !item.name) {
    return res.status(400).json({ error: 'Missing character or item' });
  }
  try {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!row) return res.status(404).json({ error: 'Character not found' });
    const equipment = parseJSON(row.equipment, []);
    if (equipment.length >= 50) return res.status(400).json({ error: 'Equipment limit reached (max 50)' });
    equipment.push({
      name: sanitizeString(item.name, 100),
      type: sanitizeString(item.type, 50),
      description: sanitizeString(item.description, 500),
      quantity: Math.max(0, Math.min(9999, parseInt(item.quantity) || 1))
    });
    db.prepare("UPDATE characters SET equipment = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(equipment), characterId);
    broadcastCharacterUpdate(characterId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Shops ---

app.get('/api/shops', authDM, (req, res) => {
  try {
    const row = db.prepare('SELECT shops FROM dm WHERE id = 1').get();
    res.json(parseJSON(row?.shops, []));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/shops', authDM, (req, res) => {
  const shops = req.body;
  if (!Array.isArray(shops) || shops.length > 20) {
    return res.status(400).json({ error: 'Invalid shops data (max 20 shops)' });
  }
  const VALID_DENOMS = ['CP', 'SP', 'EP', 'GP', 'PP'];
  for (const shop of shops) {
    if (!shop.name || shop.name.length > 100) return res.status(400).json({ error: 'Invalid shop name' });
    if (!Array.isArray(shop.items) || shop.items.length > 100) return res.status(400).json({ error: 'Too many items in shop (max 100)' });
  }
  const sanitizedShops = shops.map(s => ({
    id: sanitizeString(s.id, 50),
    name: sanitizeString(s.name, 100),
    items: (s.items || []).slice(0, 100).map(it => ({
      name: sanitizeString(it.name, 100),
      type: sanitizeString(it.type, 50),
      description: sanitizeString(it.description, 500),
      price: Math.max(0, Math.min(999999, parseInt(it.price) || 0)),
      denomination: VALID_DENOMS.includes(it.denomination) ? it.denomination : 'GP',
      quantity: parseInt(it.quantity) || -1
    }))
  }));
  try {
    db.prepare('UPDATE dm SET shops = ? WHERE id = 1').run(JSON.stringify(sanitizedShops));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/shops/sell', authDM, (req, res) => {
  const { shopId, itemIndex, characterId } = req.body;
  if (!shopId || itemIndex == null || !characterId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const dmRow = db.prepare('SELECT shops FROM dm WHERE id = 1').get();
    const shops = parseJSON(dmRow?.shops, []);
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const item = shop.items[itemIndex];
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const charRow = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!charRow) return res.status(404).json({ error: 'Character not found' });
    const currency = parseJSON(charRow.currency, { CP: 0, SP: 0, EP: 0, GP: 0, PP: 0 });
    const equipment = parseJSON(charRow.equipment, []);

    const validDenoms = ['CP', 'SP', 'EP', 'GP', 'PP'];
    const denom = validDenoms.includes(item.denomination) ? item.denomination : 'GP';
    const price = Math.max(0, Math.min(999999, parseInt(item.price) || 0));
    if (price > 0 && (currency[denom] || 0) < price) {
      return res.status(400).json({ error: `Not enough ${denom} (need ${price}, have ${currency[denom] || 0})` });
    }

    if (equipment.length >= 50) return res.status(400).json({ error: 'Equipment limit reached (max 50)' });

    if (price > 0) currency[denom] -= price;
    equipment.push({
      name: sanitizeString(item.name, 100),
      type: sanitizeString(item.type, 50),
      description: sanitizeString(item.description, 500),
      quantity: 1
    });

    db.prepare("UPDATE characters SET currency = ?, equipment = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify(currency), JSON.stringify(equipment), characterId
    );

    if (item.quantity > 0) {
      item.quantity--;
      if (item.quantity === 0) shop.items.splice(itemIndex, 1);
      db.prepare('UPDATE dm SET shops = ? WHERE id = 1').run(JSON.stringify(shops));
    }

    broadcastCharacterUpdate(characterId);
    res.json({ ok: true, currency });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Notes ---

app.get('/api/notes', authDM, (req, res) => {
  try {
    const row = db.prepare('SELECT notes FROM dm WHERE id = 1').get();
    res.json({ notes: row?.notes || '' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/notes', authDM, (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== 'string' || notes.length > 50000) {
    return res.status(400).json({ error: 'Notes too long (max 50,000 characters)' });
  }
  try {
    db.prepare('UPDATE dm SET notes = ? WHERE id = 1').run(notes);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/sessions', authDM, (req, res) => {
  try {
    db.prepare('DELETE FROM session WHERE id = 1').run();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Player API (public, requires PIN) ---

app.get('/api/player/:dmUsername/characters/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const char = charRowToJSON(row);
    const dmRow = db.prepare('SELECT character_hp FROM dm WHERE id = 1').get();
    const hpState = parseJSON(dmRow?.character_hp, {});
    if (hpState[char._id]) {
      char.currentHP = hpState[char._id].currentHP;
      char.tempHP = hpState[char._id].tempHP || 0;
    }
    res.json(char);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/player/:dmUsername/join', pinLimiter, (req, res) => {
  const { pin } = req.body;
  try {
    const s = db.prepare('SELECT * FROM session WHERE id = 1').get();
    if (!s) return res.status(404).json({ error: 'No active session' });
    if (s.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });
    res.json({ dmUsername: 'dm', pin: s.pin, createdAt: s.created_at, characters: parseJSON(s.characters, {}) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/player/:dmUsername/claim', pinLimiter, (req, res) => {
  const { pin, characterId, playerName } = req.body;
  try {
    const s = db.prepare('SELECT * FROM session WHERE id = 1').get();
    if (!s) return res.status(404).json({ error: 'No active session' });
    if (s.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });

    const characters = parseJSON(s.characters, {});
    if (!characters[characterId]) {
      return res.status(400).json({ error: 'Character not in this session' });
    }
    if (characters[characterId].claimedBy) {
      return res.status(400).json({ error: 'Character already claimed' });
    }
    for (const cid of Object.keys(characters)) {
      if (characters[cid].claimedBy === playerName) {
        return res.status(400).json({ error: 'You already claimed a character' });
      }
    }

    characters[characterId].claimedBy = playerName;
    db.prepare('UPDATE session SET characters = ? WHERE id = 1').run(JSON.stringify(characters));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- SSE: real-time updates for players ---

function broadcastCharacterUpdate(characterId) {
  if (sseClients.size === 0) return;
  const data = JSON.stringify({ type: 'character-updated', characterId });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

app.get('/api/player/:dmUsername/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// --- Player Pages ---

app.get('/join/:dmUsername', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// --- Start ---

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`DnD App running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log(`  DM:      http://${ip}:${PORT}/dm`);
});
