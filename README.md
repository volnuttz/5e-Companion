# 5.5e Companion

A web app for tabletop D&D 5.5e sessions. DMs manage characters and track battlefield encounters, while players view their character sheets in real time via QR code + PIN.

## Features

- **DM Dashboard** - Create and manage characters (stats, equipment, spells, features, currency)
- **Player View** - Join sessions via QR code, view character sheets with tabs (Stats, Equipment, Spells)
- **Battlefield** - Track monster and character HP, view stat blocks during encounters
- **Treasures & Shops** - Manage loot pools and shops, assign items to characters
- **Real-time Updates** - Character changes sync instantly to players via PeerJS/WebRTC
- **Workspace Management** - Save, load, and clear workspace data
- **SRD 5.2 Data** - Pre-loaded spells, monsters, equipment, class features, species traits, and feats

## Tech Stack

- **Backend:** Node.js, Express 5 (static file server + SRD data API)
- **Storage:** IndexedDB (client-side, DM's browser is source of truth)
- **Real-time:** PeerJS / WebRTC data channels
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks)

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

## Setup

1. **Clone the repository**

   ```bash
   git clone <repo-url>
   cd dnd
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the app**

   ```bash
   npm start
   ```

   The app runs at `http://localhost:3000`. The DM dashboard is at `/dm`.

## How It Works

1. DM opens `/dm` and creates characters
2. DM clicks "Start Session" and sets a PIN
3. A QR code is generated — players scan it or navigate to the join URL
4. Players enter the PIN and claim a character
5. Character updates (HP, equipment, etc.) sync in real time via WebRTC

All data is stored in the DM's browser via IndexedDB. Use **Save Workspace** to export data as JSON for backup.

## Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `PORT`   | Server port | `3000`  |

## Project Structure

```
├── server.js            # Express server, static files, SRD data API
├── data/                # SRD 5.2 reference data (read-only JSON)
├── public/
│   ├── css/style.css    # Parchment theme styles
│   ├── js/
│   │   ├── constants.js # Classes, species, backgrounds, spell slots
│   │   ├── db.js        # IndexedDB abstraction layer
│   │   ├── peer.js      # PeerJS communication layer
│   │   ├── dm.js        # DM dashboard logic
│   │   └── player.js    # Player character sheet logic
│   ├── dm.html          # DM dashboard page
│   └── player.html      # Player view page
└── LICENSE-SRD          # SRD 5.2 CC BY 4.0 attribution
```

## Deployment (Railway)

1. Create an app service on [Railway](https://railway.com)
2. Set `PORT=3000` in environment variables
3. Deploy — no database setup needed (data lives in browser)

## License

SRD 5.2 content is used under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/). See [LICENSE-SRD](LICENSE-SRD) for full attribution.
