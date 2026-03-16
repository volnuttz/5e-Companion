# CLAUDE.md

## Project Overview

5.5e Companion — A D&D 5.5e session companion web app. DMs manage characters, battlefield, treasures, shops, and notes. Players join via QR code + PIN and see real-time updates over WebRTC.

## Tech Stack

- **Backend:** Node.js + Express 5.2.1 (static file server + SRD data API only)
- **Storage:** IndexedDB in DM's browser (no server-side database)
- **Real-time:** PeerJS/WebRTC for DM-to-player communication
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks, no build process)
- **SRD Data:** 5.2 reference data (CC BY 4.0) as read-only JSON in `data/`
- **External libs (CDN):** PeerJS 1.x, QRCode.js 1.x

## Directory Structure

```
server.js                        Express server (58 lines)
package.json                     Dependencies (express only)
data/
  srd-5.2-spells.json            ~500+ spells (342 KB)
  srd-5.2-monsters.json          Monster stat blocks (516 KB)
  srd-5.2-equipment.json         Weapons, armor, tools (19 KB)
  srd-5.2-class-features.json    Features for all 12 classes (36 KB)
  srd-5.2-species-traits.json    10 playable species traits (4.5 KB)
  srd-5.2-feats.json             Feats (3.5 KB)
public/
  dm.html                        DM dashboard (451 lines)
  player.html                    Player character sheet (89 lines)
  css/style.css                  Parchment theme (1601 lines)
  img/background_texture.png     Background texture
  js/
    constants.js                 Game tables, class data, skills (141 lines)
    db.js                        IndexedDB abstraction layer (255 lines)
    peer.js                      PeerJS communication layer (373 lines)
    dm.js                        DM dashboard logic (2311 lines)
    player.js                    Player sheet logic (561 lines)
```

## Key Files

- `server.js` — Static file server + SRD JSON data API routes
- `public/js/db.js` — IndexedDB abstraction (database: `dnd-companion`, stores: `characters`, `dmState`). Exposed as `window.db`
- `public/js/peer.js` — PeerJS layer with factory functions `createDMPeer(roomId)` and `createPlayerPeer(roomId)`. Exposed as `window.peerManager`
- `public/js/dm.js` — DM dashboard: character CRUD, compendium search, battlefield, treasures, shops, notes, session management, workspace backup/restore, TOML character import
- `public/js/player.js` — Player sheet: PIN join flow, character claiming, auto-reclaim on reconnect, tabbed display (Stats/Equipment/Spells)
- `public/js/constants.js` — CLASSES, SPECIES, BACKGROUNDS, HIT_DIE, spell slot tables, saving throw proficiencies, spellcasting abilities, 18 skill definitions
- `data/srd-5.2-*.json` — SRD reference data (read-only, loaded once on server start)

## Server API Routes

```
GET  /                     → Redirect to /dm
GET  /dm                   → dm.html
GET  /join/:roomId         → player.html
GET  /health               → { status: 'ok' }
GET  /api/spells           → All spells
GET  /api/feats            → All feats
GET  /api/species-traits   → Species traits
GET  /api/class-features   → Class features by class name
GET  /api/equipment        → All equipment
GET  /api/monsters         → All monsters
Static files from /public
```

## Architecture Patterns

- **No server-side database** — all data stored in DM's browser via IndexedDB
- **No authentication** — DM opens the page, data persists in browser
- **WebRTC peer connections** — PeerJS uses a public signaling server; same network not required
- **Session flow:** DM creates session with PIN → generates QR code → players scan and join via PeerJS → claim characters
- **Peer ID format:** `dnd-companion-{roomId}` where roomId is auto-generated UUID stored in IndexedDB
- **HP tracking** is stored separately from character objects in `dmState.characterHP` to persist across character updates
- **Battlefield, treasures, shops, notes** all persist in IndexedDB `dmState` store
- **Player state** (spell slot checkboxes) is client-side only — survives character re-renders
- **Backup/Restore:** DM can export all IndexedDB data as JSON; also supports TOML character import
- **Custom items** use `_editing: true` flag for inline editable rows, stripped on save
- **Modal-based flows** for forms and searches with overlay backdrops
- **Top-bar compendium search** with category filters (spells, monsters, equipment, features)

## PeerJS Message Protocol

### Player → DM
| Type | Payload | Purpose |
|------|---------|---------|
| `join` | `{ pin }` | Request to join session |
| `claim` | `{ characterId, playerName }` | Claim a character |
| `ping` | `{ ts }` | Heartbeat (every 30s) |

### DM → Player
| Type | Payload | Purpose |
|------|---------|---------|
| `join-ok` | `{ characters }` | Session joined, here are available characters |
| `join-error` | `{ error }` | Invalid PIN or other error |
| `claim-ok` | `{ characterId, character, hpState }` | Character claimed successfully |
| `claim-error` | `{ error }` | Character already claimed |
| `character-update` | `{ characterId, character, hpState }` | Character data changed |
| `character-list` | `{ characters }` | Updated character list |
| `pong` | `{ ts }` | Heartbeat response |

### Connection Management
- Stale connection threshold: 60 seconds without activity
- Auto-cleanup interval: every 15 seconds
- Player heartbeat: every 30 seconds
- Reconnect backoff: exponential 1s → 30s max
- Connection timeout: 10 seconds
- Auto-reconnect on tab visibility change and network online events

## IndexedDB Schema

**Database:** `dnd-companion` (version 1)

### `characters` store (keyPath: `_id`)
```
_id: UUID
name: string (max 100), class: string, species: string
background: string (SRD or custom), level: 1-20
HP: 0-9999, AC: 0-99
STR/DEX/CON/INT/WIS/CHA: 1-30
equipment: [{ name, type, description, quantity }] (max 50)
spells: [{ name, level, ... }] (max 50)
features: [{ name, description, ... }] (max 50)
cp/sp/ep/gp/pp: currency values
createdAt/updatedAt: ISO strings
```

### `dmState` store (keyPath: `key`)
Key-value pairs: `roomId`, `pin`, `battlefield`, `characterHP`, `treasures`, `shops`, `notes`

## Game Constants

- **12 classes:** Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard
- **10 species:** Aasimar, Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling
- **4 backgrounds:** Acolyte, Criminal, Sage, Soldier
- **Spell slots:** Full casters, half casters (Paladin/Ranger), Warlock pact magic
- **Proficiency bonus:** `Math.ceil(level / 4) + 1`

## Commands

- `npm start` — Start the Express server (default port 3000)
- No test suite, no linting, no build process configured

## Conventions

- **No frameworks** — vanilla JS only on frontend, no transpilation
- **IIFE pattern** for db.js; factory functions for peer.js
- **Global exports** via `window.db` and `window.peerManager`
- **Async/await** throughout for IndexedDB operations
- **Parchment theme:** Cinzel (headings) + Crimson Text (body), `--accent: #8b2e2e` (deep crimson)
- **Responsive design:** Mobile-first with hamburger menu, breakpoints at 1200px and 1600px
- **Array limits:** 50 each for equipment/spells/features, 20 characters per DM, 50 battlefield monsters
- **String limits:** 100 (name), 50 (class/species), 100 (background), 500 (descriptions)
- **SRD data files in `data/` are read-only** — never modify them
- **No external state management** — plain JS objects and DOM manipulation
- **Event-driven** — heavy use of addEventListener for UI interactions
