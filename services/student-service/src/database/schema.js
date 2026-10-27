// Esquema SQL da tabela de alunos.
module.exports = `CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  registration VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  birth_date DATE,
  address TEXT,
  contact VARCHAR(120),
  class_name VARCHAR(60),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
)`;
