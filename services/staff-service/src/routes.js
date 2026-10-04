const router = require('express').Router();
const { pool } = require('./db');
const { authenticate, requireRole } = require('./middleware/auth');

const TYPES = ['teacher', 'admin_staff'];
router.use(authenticate);

// GET /employees?type=teacher&q=silva
router.get('/', requireRole('admin', 'staff', 'teacher'), async (req, res) => {
    const q = `%${req.query.q || ''}%`;
    const params = [q];
    let sql = 'SELECT * FROM employees WHERE (name ILIKE $1 OR email ILIKE $1)';
    if (req.query.type) { params.push(req.query.type); sql += ' AND type=$2'; }
    const { rows } = await pool.query(sql + ' ORDER BY name', params);
    res.json(rows);
});

router.get('/:id', requireRole('admin', 'staff', 'teacher'), async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM employees WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'funcionário não encontrado' });
    res.json(rows[0]);
});

router.post('/', requireRole('admin'), async (req, res) => {
    const { type, name, email, phone, qualification, subjects, position } = req.body;
    if (!TYPES.includes(type) || !name || !email)
        return res.status(400).json({ error: 'type (teacher|admin_staff), name e email são obrigatórios' });
    const { rows } = await pool.query(
        `INSERT INTO employees(type,name,email,phone,qualification,subjects,position)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [type, name, email.toLowerCase(), phone, qualification, subjects, position]);
    res.status(201).json(rows[0]);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
    const { name, phone, qualification, subjects, position, active } = req.body;
    const { rows } = await pool.query(
        `UPDATE employees SET
       name=COALESCE($1,name), phone=COALESCE($2,phone),
       qualification=COALESCE($3,qualification), subjects=COALESCE($4,subjects),
       position=COALESCE($5,position), active=COALESCE($6,active)
     WHERE id=$7 RETURNING *`,
        [name, phone, qualification, subjects, position, active, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'funcionário não encontrado' });
    res.json(rows[0]);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
    const r = await pool.query('DELETE FROM employees WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'funcionário não encontrado' });
    res.status(204).end();
});

module.exports = router;