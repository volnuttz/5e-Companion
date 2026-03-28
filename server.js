const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');

// Static SRD reference data (read-only, loaded once)
const srdData = {
  spells:        (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-spells.json'), 'utf-8')); } catch(e) { console.error('Failed to load spells:', e.message); return []; } })(),
  feats:         (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-feats.json'), 'utf-8')); } catch(e) { console.error('Failed to load feats:', e.message); return []; } })(),
  speciesTraits: (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-species-traits.json'), 'utf-8')); } catch(e) { console.error('Failed to load species traits:', e.message); return []; } })(),
  equipment:     (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-equipment.json'), 'utf-8')); } catch(e) { console.error('Failed to load equipment:', e.message); return []; } })(),
  monsters:      (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-monsters.json'), 'utf-8')); } catch(e) { return []; } })(),
  classFeatures: (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'srd-5.2-class-features.json'), 'utf-8')); } catch(e) { return {}; } })()
};

// Self-hosted PeerJS signaling server
const peerServer = ExpressPeerServer(server, { path: '/' });
app.use('/peerjs', peerServer);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// SRD reference data API
app.get('/api/spells', (req, res) => res.json(srdData.spells));
app.get('/api/feats', (req, res) => res.json(srdData.feats));
app.get('/api/species-traits', (req, res) => res.json(srdData.speciesTraits));
app.get('/api/class-features', (req, res) => res.json(srdData.classFeatures));
app.get('/api/equipment', (req, res) => res.json(srdData.equipment));
app.get('/api/monsters', (req, res) => res.json(srdData.monsters));

// Pages
app.get('/', (req, res) => res.redirect('/dm'));
app.get('/dm', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dm.html')));
app.get('/join/:roomId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));

// Start
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`DnD App running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log(`  DM:      http://${ip}:${PORT}/dm`);
});
