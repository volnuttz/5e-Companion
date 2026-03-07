const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const os = require('os');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = 3000;

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory token store: token -> { username, dmId }
const dmTokens = {};

// SSE: connected players per DM
const sseClients = {};

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
    skills: row.skills,
    features: row.features,
    currency: row.currency,
    equipment: row.equipment,
    spells: row.spells
  };
}

// Auth middleware for DM routes
function authDM(req, res, next) {
  const token = req.headers['x-dm-token'];
  if (!token || !dmTokens[token]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.dmUsername = dmTokens[token].username;
  req.dmId = dmTokens[token].dmId;
  next();
}

// --- SRD Reference Data (public, read-only) ---

app.get('/api/spells', (req, res) => res.json(spellsDB));
app.get('/api/feats', (req, res) => res.json(featsDB));
app.get('/api/species-traits', (req, res) => res.json(speciesTraitsDB));
app.get('/api/class-features', (req, res) => res.json(classFeatsDB));
app.get('/api/equipment', (req, res) => res.json(equipmentDB));
app.get('/api/monsters', (req, res) => res.json(monstersDB));

// --- DM Auth ---

app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, hyphens, and underscores' });
  }

  try {
    const existing = await db.query('SELECT id FROM dms WHERE LOWER(username) = LOWER($1)', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO dms (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    const dm = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    dmTokens[token] = { username: dm.username, dmId: dm.id };

    res.json({ token, username: dm.username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const result = await db.query('SELECT id, username, password_hash FROM dms WHERE LOWER(username) = LOWER($1)', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const dm = result.rows[0];

    const valid = await bcrypt.compare(password, dm.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    dmTokens[token] = { username: dm.username, dmId: dm.id };

    res.json({ token, username: dm.username });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- DM Pages ---

app.get('/dm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dm.html'));
});

app.get('/dm/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- API: Characters (DM-scoped) ---

app.get('/api/characters', authDM, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM characters WHERE dm_id = $1 ORDER BY name', [req.dmId]);
    res.json(result.rows.map(charRowToJSON));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/characters/:id', authDM, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM characters WHERE id = $1 AND dm_id = $2', [req.params.id, req.dmId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(charRowToJSON(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/characters', authDM, async (req, res) => {
  const id = uuidv4();
  const c = req.body;
  try {
    await db.query(
      `INSERT INTO characters (id, dm_id, name, class, species, level, background, hp, ac, str, dex, con, int, wis, cha, skills, features, currency, equipment, spells)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [id, req.dmId, c.name, c.class, c.species, c.level, c.background,
       c.HP, c.AC, c.STR, c.DEX, c.CON, c.INT, c.WIS, c.CHA,
       JSON.stringify(c.skills || []), JSON.stringify(c.features || []),
       JSON.stringify(c.currency || {}), JSON.stringify(c.equipment || []),
       JSON.stringify(c.spells || [])]
    );
    res.json({ _id: id, ...c });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/characters/:id', authDM, async (req, res) => {
  const c = req.body;
  try {
    const result = await db.query(
      `UPDATE characters SET name=$1, class=$2, species=$3, level=$4, background=$5,
       hp=$6, ac=$7, str=$8, dex=$9, con=$10, int=$11, wis=$12, cha=$13,
       skills=$14, features=$15, currency=$16, equipment=$17, spells=$18, updated_at=NOW()
       WHERE id=$19 AND dm_id=$20 RETURNING *`,
      [c.name, c.class, c.species, c.level, c.background,
       c.HP, c.AC, c.STR, c.DEX, c.CON, c.INT, c.WIS, c.CHA,
       JSON.stringify(c.skills || []), JSON.stringify(c.features || []),
       JSON.stringify(c.currency || {}), JSON.stringify(c.equipment || []),
       JSON.stringify(c.spells || []),
       req.params.id, req.dmId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    broadcastCharacterUpdate(req.dmUsername, req.params.id);
    res.json({ _id: req.params.id, ...c });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/characters/:id', authDM, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM characters WHERE id = $1 AND dm_id = $2 RETURNING id', [req.params.id, req.dmId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- API: Sessions (DM-scoped) ---

app.post('/api/sessions', authDM, async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 characters' });
  }

  try {
    // Get all characters for this DM
    const charsResult = await db.query('SELECT id FROM characters WHERE dm_id = $1', [req.dmId]);
    const characters = {};
    for (const row of charsResult.rows) {
      characters[row.id] = { claimedBy: null };
    }

    // Upsert session
    await db.query(
      `INSERT INTO sessions (dm_id, pin, characters) VALUES ($1, $2, $3)
       ON CONFLICT (dm_id) DO UPDATE SET pin = $2, characters = $3, created_at = NOW()`,
      [req.dmId, pin, JSON.stringify(characters)]
    );

    const session = { dmUsername: req.dmUsername, pin, createdAt: new Date().toISOString(), characters };
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sessions/mine', authDM, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sessions WHERE dm_id = $1', [req.dmId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No active session' });
    const s = result.rows[0];
    res.json({ dmUsername: req.dmUsername, pin: s.pin, createdAt: s.created_at, characters: s.characters });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sessions/qr', authDM, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sessions WHERE dm_id = $1', [req.dmId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No active session' });
    const ip = getLocalIP();
    const url = `http://${ip}:${PORT}/join/${req.dmUsername}`;
    const qr = await QRCode.toDataURL(url);
    res.json({ qr, url, pin: result.rows[0].pin });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/sessions', authDM, async (req, res) => {
  try {
    await db.query('DELETE FROM sessions WHERE dm_id = $1', [req.dmId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Player API (public, requires DM name + PIN) ---

app.get('/api/player/:dmUsername/characters/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.* FROM characters c JOIN dms d ON c.dm_id = d.id
       WHERE c.id = $1 AND d.username = $2`,
      [req.params.id, req.params.dmUsername]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(charRowToJSON(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/player/:dmUsername/join', async (req, res) => {
  const { pin } = req.body;
  try {
    const result = await db.query(
      `SELECT s.* FROM sessions s JOIN dms d ON s.dm_id = d.id WHERE d.username = $1`,
      [req.params.dmUsername]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No active session for this DM' });
    const session = result.rows[0];
    if (session.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });
    res.json({ dmUsername: req.params.dmUsername, pin: session.pin, createdAt: session.created_at, characters: session.characters });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/player/:dmUsername/claim', async (req, res) => {
  const { pin, characterId, playerName } = req.body;
  try {
    const result = await db.query(
      `SELECT s.* FROM sessions s JOIN dms d ON s.dm_id = d.id WHERE d.username = $1`,
      [req.params.dmUsername]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No active session' });
    const session = result.rows[0];
    if (session.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });

    const characters = session.characters;
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
    await db.query('UPDATE sessions SET characters = $1 WHERE id = $2', [JSON.stringify(characters), session.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- SSE: real-time updates for players ---

function broadcastCharacterUpdate(dmUsername, characterId) {
  const clients = sseClients[dmUsername];
  if (!clients || clients.size === 0) return;
  const data = JSON.stringify({ type: 'character-updated', characterId });
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

app.get('/api/player/:dmUsername/events', (req, res) => {
  const dm = req.params.dmUsername;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');

  if (!sseClients[dm]) sseClients[dm] = new Set();
  sseClients[dm].add(res);

  req.on('close', () => {
    sseClients[dm].delete(res);
    if (sseClients[dm].size === 0) delete sseClients[dm];
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
