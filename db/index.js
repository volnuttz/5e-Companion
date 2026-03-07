const { Pool } = require('pg');

const pool = new Pool({
  database: 'dnd',
  host: 'localhost',
  port: 5432
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
