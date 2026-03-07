const fs = require('fs');
const path = require('path');
const db = require('./index');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function migrate() {
  console.log('Starting migration...');

  // Migrate DMs
  const dmsFile = path.join(DATA_DIR, 'dms.json');
  if (fs.existsSync(dmsFile)) {
    const dms = JSON.parse(fs.readFileSync(dmsFile, 'utf-8'));
    for (const dm of dms) {
      const existing = await db.query('SELECT id FROM dms WHERE username = $1', [dm.username]);
      if (existing.rows.length === 0) {
        await db.query(
          'INSERT INTO dms (username, password_hash) VALUES ($1, $2)',
          [dm.username, dm.passwordHash]
        );
        console.log(`  DM "${dm.username}" migrated`);
      } else {
        console.log(`  DM "${dm.username}" already exists, skipping`);
      }
    }
  }

  // Migrate characters per DM
  const charsDir = path.join(DATA_DIR, 'characters');
  if (fs.existsSync(charsDir)) {
    const dmDirs = fs.readdirSync(charsDir).filter(f =>
      fs.statSync(path.join(charsDir, f)).isDirectory()
    );

    for (const dmUsername of dmDirs) {
      const dmResult = await db.query('SELECT id FROM dms WHERE username = $1', [dmUsername]);
      if (dmResult.rows.length === 0) {
        console.log(`  Skipping characters for unknown DM "${dmUsername}"`);
        continue;
      }
      const dmId = dmResult.rows[0].id;

      const charDir = path.join(charsDir, dmUsername);
      const charFiles = fs.readdirSync(charDir).filter(f => f.endsWith('.json'));

      for (const file of charFiles) {
        const charId = path.basename(file, '.json');
        const existing = await db.query('SELECT id FROM characters WHERE id = $1', [charId]);
        if (existing.rows.length > 0) {
          console.log(`  Character "${charId}" already exists, skipping`);
          continue;
        }

        const c = JSON.parse(fs.readFileSync(path.join(charDir, file), 'utf-8'));
        await db.query(
          `INSERT INTO characters (id, dm_id, name, class, species, level, background, hp, ac, str, dex, con, int, wis, cha, skills, features, currency, equipment, spells)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            charId, dmId,
            c.name || '', c.class || '', c.species || '', c.level || 1,
            c.background || '', c.HP || 10, c.AC || 10,
            c.STR || 10, c.DEX || 10, c.CON || 10, c.INT || 10, c.WIS || 10, c.CHA || 10,
            JSON.stringify(c.skills || []),
            JSON.stringify(c.features || []),
            JSON.stringify(c.currency || { CP: 0, SP: 0, EP: 0, GP: 0, PP: 0 }),
            JSON.stringify(c.equipment || []),
            JSON.stringify(c.spells || [])
          ]
        );
        console.log(`  Character "${c.name}" (${charId}) migrated for DM "${dmUsername}"`);
      }
    }
  }

  // Migrate sessions
  const sessionsDir = path.join(DATA_DIR, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    for (const file of sessionFiles) {
      const dmUsername = path.basename(file, '.json');
      const dmResult = await db.query('SELECT id FROM dms WHERE username = $1', [dmUsername]);
      if (dmResult.rows.length === 0) continue;
      const dmId = dmResult.rows[0].id;

      const existing = await db.query('SELECT id FROM sessions WHERE dm_id = $1', [dmId]);
      if (existing.rows.length > 0) {
        console.log(`  Session for "${dmUsername}" already exists, skipping`);
        continue;
      }

      const s = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'));
      await db.query(
        'INSERT INTO sessions (dm_id, pin, characters, created_at) VALUES ($1, $2, $3, $4)',
        [dmId, s.pin, JSON.stringify(s.characters || {}), s.createdAt || new Date().toISOString()]
      );
      console.log(`  Session for "${dmUsername}" migrated`);
    }
  }

  console.log('Migration complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
