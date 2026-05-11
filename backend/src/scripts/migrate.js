const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// SQLite3 is optional - only for development
let sqlite3;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (err) {
  sqlite3 = null;
}

async function migrate() {
  let databaseUrl = process.env.DATABASE_URL;
  
  try {
    const schemaPath = path.join(__dirname, '../../../database/schema.sql');
    let schema = fs.readFileSync(schemaPath, 'utf8');

    const isPostgresUrl = (url) => url && /^(postgres|postgresql):\/\//i.test(url);

    // Construct DATABASE_URL from individual PostgreSQL env vars if needed (Render provides these)
    if (!databaseUrl) {
      const pgHost = process.env.PGHOST;
      const pgPort = process.env.PGPORT || 5432;
      const pgUser = process.env.PGUSER;
      const pgPassword = process.env.PGPASSWORD;
      const pgDatabase = process.env.PGDATABASE;

      if (pgHost && pgUser && pgPassword && pgDatabase) {
        databaseUrl = `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}`;
        console.log('🔄 Constructed DATABASE_URL from PostgreSQL environment variables');
      }
    }

    const isPostgres = isPostgresUrl(databaseUrl);
    if (isPostgres) {
      schema = schema.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
      schema = schema.replace(/\bDATETIME\b/g, 'TIMESTAMP');
      schema = schema.replace(/INSERT INTO ([\w_]+) \(([^)]+)\) VALUES([\s\S]*?);/g, (match, table, cols, values) => {
        return `INSERT INTO ${table} (${cols}) VALUES${values} ON CONFLICT DO NOTHING;`;
      });
    }

    if (databaseUrl && isPostgres) {
      // PostgreSQL migration
      console.log('🔄 Running PostgreSQL migrations...');
      
      const pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      });

      const client = await pool.connect();
      try {
        await client.query(schema);
        console.log('✅ PostgreSQL migrations completed successfully');
      } finally {
        client.release();
        await pool.end();
      }
    } else if (sqlite3) {
      // SQLite migration
      console.log('🔄 Running SQLite migrations...');
      
      const dbPath = process.env.DB_PATH || './database/laikipia_lost_found.db';
      const db = new sqlite3.Database(dbPath);

      await new Promise((resolve, reject) => {
        db.exec(schema, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      db.close();
      console.log('✅ SQLite migrations completed successfully');
    } else {
      throw new Error('No database configured: Set DATABASE_URL or install sqlite3');
    }
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();