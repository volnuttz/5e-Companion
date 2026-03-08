# 5e Companion

A web app for tabletop D&D 5e sessions. DMs manage characters and track battlefield encounters, while players view their character sheets in real time via QR code + PIN.

## Features

- **DM Dashboard** - Create and manage characters (stats, equipment, spells, features, currency)
- **Player View** - Join sessions via QR code, view character sheets with tabs (Stats, Equipment, Spells)
- **Battlefield** - Track monster HP and view stat blocks during encounters
- **Real-time Updates** - Character changes sync instantly to players via Server-Sent Events
- **SRD 5.2 Data** - Pre-loaded spells, monsters, equipment, class features, species traits, and feats

## Tech Stack

- **Backend:** Node.js, Express 5
- **Database:** PostgreSQL (relational + JSONB)
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks)
- **Real-time:** Server-Sent Events (SSE)

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [PostgreSQL](https://www.postgresql.org/) (v14+)

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

3. **Create the database**

   ```bash
   createdb dnd
   psql -d dnd -f db/schema.sql
   ```

4. **Create a DM user**

   Registration is disabled by default. Create a user manually:

   ```bash
   node -e "
   const bcrypt = require('bcryptjs');
   const hash = bcrypt.hashSync('YOUR_PASSWORD', 10);
   console.log(hash);
   "
   ```

   Then insert into the database:

   ```sql
   INSERT INTO dms (username, password_hash) VALUES ('your_username', '<hash_from_above>');
   ```

5. **Start the app**

   ```bash
   npm start
   ```

   The app runs at `http://localhost:3000`. DM login at `/dm/login`.

## Environment Variables

| Variable       | Description                          | Default                              |
| -------------- | ------------------------------------ | ------------------------------------ |
| `PORT`         | Server port                          | `3000`                               |
| `DATABASE_URL` | PostgreSQL connection string         | `postgresql://localhost:5432/dnd`     |

When `DATABASE_URL` is set (e.g. in production), it takes priority over the default local connection.

## Project Structure

```
├── server.js            # Express server, API routes, SSE
├── db/
│   ├── index.js         # PostgreSQL connection pool
│   └── schema.sql       # Database schema
├── data/                # SRD 5.2 reference data (read-only JSON)
├── public/
│   ├── css/style.css    # Parchment theme styles
│   ├── js/
│   │   ├── constants.js # Classes, species, backgrounds, spell slots
│   │   ├── dm.js        # DM dashboard logic
│   │   └── player.js    # Player character sheet logic
│   ├── dm.html          # DM dashboard page
│   ├── player.html      # Player view page
│   └── login.html       # DM login page
└── LICENSE-SRD          # SRD 5.2 CC BY 4.0 attribution
```

## Deployment (Railway)

1. Create a PostgreSQL service on [Railway](https://railway.com)
2. Link it to your app service (auto-sets `DATABASE_URL`)
3. Set `PORT=3000` in your app's environment variables
4. Run `schema.sql` against the Railway database and create a DM user (see step 3-4 above)
5. Deploy

## License

SRD 5.2 content is used under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/). See [LICENSE-SRD](LICENSE-SRD) for full attribution.
