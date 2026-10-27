// Persistência SQL parametrizada de alunos.
const { pool } = require('../config/db');

async function list(search) {
    const { rows } = await pool.query(
        `SELECT * FROM students
         WHERE name ILIKE $1 OR registration ILIKE $1 OR class_name ILIKE $1
         ORDER BY name`,
        [search]
    );
    return rows;
}

async function findById(id) {
    const { rows } = await pool.query('SELECT * FROM students WHERE id=$1', [id]);
    return rows[0];
}

async function create(student) {
    const { rows } = await pool.query(
        `INSERT INTO students(registration,name,birth_date,address,contact,class_name)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [student.registration, student.name, student.birth_date, student.address, student.contact, student.class_name]
    );
    return rows[0];
}

async function update(id, student) {
    const { rows } = await pool.query(
        `UPDATE students SET
         name=COALESCE($1,name), birth_date=COALESCE($2,birth_date),
         address=COALESCE($3,address), contact=COALESCE($4,contact),
         class_name=COALESCE($5,class_name), active=COALESCE($6,active)
         WHERE id=$7 RETURNING *`,
        [student.name, student.birth_date, student.address, student.contact, student.class_name, student.active, id]
    );
    return rows[0];
}

async function remove(id) {
    return pool.query('DELETE FROM students WHERE id=$1', [id]);
}

module.exports = { list, findById, create, update, remove };
