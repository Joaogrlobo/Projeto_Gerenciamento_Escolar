const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { pool, init } = require('./db');
const routes = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'user-service' }));
app.use('/', routes);

app.use((err, req, res, next) => {
    if (err.code === '23505') return res.status(409).json({ error: 'registro já existe' });
    console.error(err);
    res.status(500).json({ error: 'erro interno' });
});

async function seedAdmin() {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
        `INSERT INTO users(name,email,password_hash,role)
     VALUES('Administrador',$1,$2,'admin') ON CONFLICT (email) DO NOTHING`,
        [ADMIN_EMAIL.toLowerCase(), hash]
    );
}

init(`CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','teacher','student','parent','staff')),
  created_at TIMESTAMPTZ DEFAULT now()
)`).then(seedAdmin).then(() => {
    const port = process.env.PORT || 3001;
    app.listen(port, () => console.log(`user-service na porta ${port}`));
});