import pg from 'pg';

const { Pool } = pg;
let pool;

export async function initDb() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      username TEXT,
      first_name TEXT,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_receipt',
      receipt_file_id TEXT,
      receipt_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS orders_telegram_id_idx ON orders (telegram_id);
  `);
}

export async function createOrder({ telegramId, username, firstName, planId }) {
  const { rows } = await pool.query(
    'INSERT INTO orders (telegram_id, username, first_name, plan_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [telegramId, username || null, firstName || null, planId]
  );
  return rows[0];
}

export async function getOrder(id) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0];
}

export async function setReceipt(id, fileId, type) {
  const { rows } = await pool.query(
    "UPDATE orders SET receipt_file_id = $2, receipt_type = $3, status = 'pending_review' WHERE id = $1 AND status = 'awaiting_receipt' RETURNING *",
    [id, fileId, type]
  );
  return rows[0];
}

export async function reviewOrder(id, status) {
  const { rows } = await pool.query(
    "UPDATE orders SET status = $2, reviewed_at = NOW() WHERE id = $1 AND status = 'pending_review' RETURNING *",
    [id, status]
  );
  return rows[0];
}

export async function markDelivered(id) {
  const { rows } = await pool.query(
    "UPDATE orders SET status = 'delivered', delivered_at = NOW() WHERE id = $1 AND status = 'approved' RETURNING *",
    [id]
  );
  return rows[0];
}
