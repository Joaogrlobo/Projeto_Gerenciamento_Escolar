// Esquema SQL da tabela de usuários.
module.exports = `CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','teacher','student','parent','staff')),
  created_at TIMESTAMPTZ DEFAULT now()
)`;
