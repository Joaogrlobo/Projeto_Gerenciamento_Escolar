const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { authenticate, requireRole } = require('./middleware/auth');

const ROLES = ['admin', 'teacher', 'student', 'parent', 'staff'];
const PUBLIC_ROLES = ['student', 'parent'];

async function criarUsuario({ name, email, password, role }, res) {
    if (!name || !email || !password)
        return res.status(400).json({ error: 'name, email e password são obrigatórios' });
    if (password.length < 6)
        return res.status(400).json({ error: 'senha deve ter ao menos 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
        'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',
        [name, email.toLowerCase(), hash, role]
    );
    res.status(201).json(rows[0]);
}

// cadastro público: só student ou parent
router.post('/auth/register', (req, res) => {
    const role = PUBLIC_ROLES.includes(req.body.role) ? req.body.role : 'student';
    return criarUsuario({ ...req.body, role }, res);
});

router.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email e password são obrigatórios' });
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash)))
        return res.status(401).json({ error: 'credenciais inválidas' });
    const token = jwt.sign({ sub: u.id, name: u.name, role: u.role }, process.env.JWT_SECRET, { expiresIn: '2h' });
    res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

router.get('/auth/me', authenticate, (req, res) => res.json(req.user));

// admin cria usuários de qualquer perfil
router.post('/users', authenticate, requireRole('admin'), (req, res) => {
    if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'role inválida' });
    return criarUsuario(req.body, res);
});

router.get('/users', authenticate, requireRole('admin'), async (req, res) => {
    const { rows } = await pool.query('SELECT id,name,email,role,created_at FROM users ORDER BY id');
    res.json(rows);
});

module.exports = router;