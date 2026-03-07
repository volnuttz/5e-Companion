const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({ database: 'dnd', host: 'localhost', port: 5432 });

pool.on('error', (err) => {
  console.error('Database pool error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
