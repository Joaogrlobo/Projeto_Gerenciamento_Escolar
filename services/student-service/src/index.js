const express = require('express');
const cors = require('cors');
const { init } = require('./db');
const routes = require('./routes');

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'UP', service: 'student-service' }));
app.use('/students', routes);

app.use((err, req, res, next) => {
    if (err.code === '23505') return res.status(409).json({ error: 'matrícula já cadastrada' });
    console.error(err);
    res.status(500).json({ error: 'erro interno' });
});

init(`CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  registration VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  birth_date DATE,
  address TEXT,
  contact VARCHAR(120),
  class_name VARCHAR(60),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
)`).then(() => {
    const port = process.env.PORT || 3002;
    app.listen(port, () => console.log(`student-service na porta ${port}`));
});