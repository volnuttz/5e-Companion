const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const os = require('os');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, 'data');
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const DMS_FILE = path.join(DATA_DIR, 'dms.json');

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

// In-memory token store: token -> dmUsername
const dmTokens = {};

// SSE: connected players per DM
// { dmUsername: Set<res> }
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

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getDMs() {
  return readJSON(DMS_FILE);
}

function saveDMs(dms) {
  writeJSON(DMS_FILE, dms);
}

function getDMCharactersDir(dmUsername) {
  const dir = path.join(CHARACTERS_DIR, dmUsername);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listCharacters(dmUsername) {
  const dir = getDMCharactersDir(dmUsername);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const data = readJSON(path.join(dir, f));
    data._id = path.basename(f, '.json');
    return data;
  });
}

function getSession(dmUsername) {
  const sessionFile = path.join(SESSIONS_DIR, `${dmUsername}.json`);
  if (!fs.existsSync(sessionFile)) return null;
  return readJSON(sessionFile);
}

function saveSession(dmUsername, data) {
  writeJSON(path.join(SESSIONS_DIR, `${dmUsername}.json`), data);
}

// Auth middleware for DM routes
function authDM(req, res, next) {
  const token = req.headers['x-dm-token'];
  if (!token || !dmTokens[token]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.dmUsername = dmTokens[token];
  next();
}

// --- Spells DB (public) ---

app.get('/api/spells', (req, res) => {
  res.json(spellsDB);
});

app.get('/api/feats', (req, res) => {
  res.json(featsDB);
});

app.get('/api/species-traits', (req, res) => {
  res.json(speciesTraitsDB);
});

app.get('/api/class-features', (req, res) => {
  res.json(classFeatsDB);
});

app.get('/api/equipment', (req, res) => {
  res.json(equipmentDB);
});

app.get('/api/monsters', (req, res) => {
  res.json(monstersDB);
});

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
  // Only allow alphanumeric and underscores/hyphens in username (used in URLs)
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, hyphens, and underscores' });
  }

  const dms = getDMs();
  if (dms.find(d => d.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already taken' });
  }

  const hash = await bcrypt.hash(password, 10);
  dms.push({ username, passwordHash: hash });
  saveDMs(dms);

  const token = crypto.randomBytes(32).toString('hex');
  dmTokens[token] = username;

  res.json({ token, username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const dms = getDMs();
  const dm = dms.find(d => d.username.toLowerCase() === username.toLowerCase());
  if (!dm) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const valid = await bcrypt.compare(password, dm.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  dmTokens[token] = dm.username;

  res.json({ token, username: dm.username });
});

// --- DM Pages ---

app.get('/dm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dm.html'));
});

app.get('/dm/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- API: Characters (DM-scoped) ---

app.get('/api/characters', authDM, (req, res) => {
  res.json(listCharacters(req.dmUsername));
});

app.get('/api/characters/:id', authDM, (req, res) => {
  const filePath = path.join(getDMCharactersDir(req.dmUsername), `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  const data = readJSON(filePath);
  data._id = req.params.id;
  res.json(data);
});

app.post('/api/characters', authDM, (req, res) => {
  const id = uuidv4();
  const character = req.body;
  writeJSON(path.join(getDMCharactersDir(req.dmUsername), `${id}.json`), character);
  res.json({ _id: id, ...character });
});

app.put('/api/characters/:id', authDM, (req, res) => {
  const filePath = path.join(getDMCharactersDir(req.dmUsername), `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  const character = req.body;
  writeJSON(filePath, character);
  broadcastCharacterUpdate(req.dmUsername, req.params.id);
  res.json({ _id: req.params.id, ...character });
});

app.delete('/api/characters/:id', authDM, (req, res) => {
  const filePath = path.join(getDMCharactersDir(req.dmUsername), `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// --- API: Sessions (DM-scoped) ---

app.post('/api/sessions', authDM, (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 characters' });
  }

  const session = {
    dmUsername: req.dmUsername,
    pin,
    createdAt: new Date().toISOString(),
    characters: {}
  };
  // Add all DM's characters as available
  const characters = listCharacters(req.dmUsername);
  for (const c of characters) {
    session.characters[c._id] = { claimedBy: null };
  }
  saveSession(req.dmUsername, session);
  res.json(session);
});

app.get('/api/sessions/mine', authDM, (req, res) => {
  const session = getSession(req.dmUsername);
  if (!session) return res.status(404).json({ error: 'No active session' });
  res.json(session);
});

app.get('/api/sessions/qr', authDM, async (req, res) => {
  const session = getSession(req.dmUsername);
  if (!session) return res.status(404).json({ error: 'No active session' });
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}/join/${req.dmUsername}`;
  const qr = await QRCode.toDataURL(url);
  res.json({ qr, url, pin: session.pin });
});

app.delete('/api/sessions', authDM, (req, res) => {
  const sessionFile = path.join(SESSIONS_DIR, `${req.dmUsername}.json`);
  if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
  res.json({ ok: true });
});

// --- Player API (public, requires DM name + PIN) ---

// Get character details (public, for players)
app.get('/api/player/:dmUsername/characters/:id', (req, res) => {
  const dir = path.join(CHARACTERS_DIR, req.params.dmUsername);
  const filePath = path.join(dir, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  const data = readJSON(filePath);
  data._id = req.params.id;
  res.json(data);
});

// Verify PIN and get session
app.post('/api/player/:dmUsername/join', (req, res) => {
  const { pin } = req.body;
  const session = getSession(req.params.dmUsername);
  if (!session) return res.status(404).json({ error: 'No active session for this DM' });
  if (session.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });
  res.json(session);
});

// Claim a character
app.post('/api/player/:dmUsername/claim', (req, res) => {
  const { pin, characterId, playerName } = req.body;
  const session = getSession(req.params.dmUsername);
  if (!session) return res.status(404).json({ error: 'No active session' });
  if (session.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });

  if (!session.characters[characterId]) {
    return res.status(400).json({ error: 'Character not in this session' });
  }
  if (session.characters[characterId].claimedBy) {
    return res.status(400).json({ error: 'Character already claimed' });
  }

  for (const cid of Object.keys(session.characters)) {
    if (session.characters[cid].claimedBy === playerName) {
      return res.status(400).json({ error: 'You already claimed a character' });
    }
  }

  session.characters[characterId].claimedBy = playerName;
  saveSession(req.params.dmUsername, session);
  res.json({ ok: true });
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
