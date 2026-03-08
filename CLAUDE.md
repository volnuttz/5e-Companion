# CLAUDE.md

## Project Overview

5e Companion - A D&D 5e session companion web app. DMs manage characters and battlefield, players join via QR + PIN and see real-time updates.

## Tech Stack

- Node.js + Express 5 backend, PostgreSQL (relational + JSONB), vanilla HTML/CSS/JS frontend
- Real-time sync via Server-Sent Events (SSE)
- SRD 5.2 data (CC BY 4.0) stored as read-only JSON in `data/`

## Key Files

- `server.js` — All API routes, SSE, auth middleware, validation
- `db/index.js` — Postgres pool (uses `DATABASE_URL` in prod, local defaults in dev)
- `db/schema.sql` — Tables: `dms`, `characters`, `sessions`
- `public/js/dm.js` — DM dashboard: character CRUD, pickers (spells/features/equipment), battlefield
- `public/js/player.js` — Player sheet: SSE listener, local state (HP, spell slots, currency deltas)
- `public/js/constants.js` — CLASSES, SPECIES, BACKGROUNDS, HIT_DIE, spell slot tables
- `data/srd-5.2-*.json` — SRD reference data (spells, monsters, equipment, class features, species traits, feats)

## Architecture Patterns

- `charRowToJSON(row)` converts DB rows to API format (HP/AC/STR etc uppercase)
- `validateCharacter(c)` and `sanitizeCharacter(c)` handle server-side validation
- Battlefield persists at DM level (`dms.battlefield` column), not session level
- Player state (currentHP, tempHP, spell slot checks, currency deltas) is client-side only — survives SSE re-renders
- Custom features/spells use `_editing: true` flag for inline editable rows, stripped on save
- Background dropdown: SRD options + "Custom..." with conditional text input

## Commands

- `npm start` — Start the server
- `psql -d dnd -f db/schema.sql` — Initialize database schema
- PostgreSQL binary (macOS): `/opt/homebrew/Cellar/postgresql@17/17.9/bin/psql`

## Conventions

- No frameworks — vanilla JS only on frontend
- Parchment theme: Cinzel + Crimson Text fonts, background texture
- Registration disabled — users created manually via SQL + bcrypt
- Rate limiting: global 100/min, auth 15/15min, PIN 10/5min
- Array limits: 50 each for equipment/spells/features, 20 characters per DM, 50 battlefield monsters
- SRD data files in `data/` are read-only reference — never modify them
