const express = require('express');
const cors = require('cors');
const { init } = require('./db');
const routes = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'UP', service: 'staff-service' }));
app.use('/employees', routes)

app.use((err, req, res, next) => {
    if (err.code === '23505') return res.status(409).json({ error: 'e-mail já cadastrado' });
    console.error(err);
    res.status(500).json({ error: 'erro interno' });
});

init(`CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('teacher','admin_staff')),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  phone VARCHAR(30),
  qualification VARCHAR(120),
  subjects TEXT,
  position VARCHAR(80),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
)`).then(() => {
    const port = process.env.PORT || 3003;
    app.listen(port, () => console.log(`staff-service na porta ${port}`));
});