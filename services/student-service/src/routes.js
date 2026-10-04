const router = require('express').Router();
const { pool } = require('./db');
const { authenticate, requireRole } = require('./middleware/auth');

router.use(authenticate);

// busca por nome, matrícula ou turma: GET /students?q=maria
router.get('/', requireRole('admin', 'teacher', 'staff'), async (req, res) => {
    const q = `%${req.query.q || ''}%`;
    const { rows } = await pool.query(
        `SELECT * FROM students
     WHERE name ILIKE $1 OR registration ILIKE $1 OR class_name ILIKE $1
     ORDER BY name`, [q]);
    res.json(rows);
});

router.get('/:id', requireRole('admin', 'teacher', 'staff'), async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'aluno não encontrado' });
    res.json(rows[0]);
});

router.post('/', requireRole('admin', 'staff'), async (req, res) => {
    const { registration, name, birth_date, address, contact, class_name } = req.body;
    if (!registration || !name) return res.status(400).json({ error: 'registration e name são obrigatórios' });
    const { rows } = await pool.query(
        `INSERT INTO students(registration,name,birth_date,address,contact,class_name)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [registration, name, birth_date, address, contact, class_name]);
    res.status(201).json(rows[0]);
});

router.put('/:id', requireRole('admin', 'staff'), async (req, res) => {
    const { name, birth_date, address, contact, class_name, active } = req.body;
    const { rows } = await pool.query(
        `UPDATE students SET
       name=COALESCE($1,name), birth_date=COALESCE($2,birth_date),
       address=COALESCE($3,address), contact=COALESCE($4,contact),
       class_name=COALESCE($5,class_name), active=COALESCE($6,active)
     WHERE id=$7 RETURNING *`,
        [name, birth_date, address, contact, class_name, active, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'aluno não encontrado' });
    res.json(rows[0]);
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
    const r = await pool.query('DELETE FROM students WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'aluno não encontrado' });
    res.status(204).end();
});

module.exports = router;