// Persistência SQL parametrizada de funcionários.
const { pool } = require('../config/db');

async function list(search, type) {
    const params = [search];
    let sql = 'SELECT * FROM employees WHERE (name ILIKE $1 OR email ILIKE $1)';
    if (type) {
        params.push(type);
        sql += ' AND type=$2';
    }
    const { rows } = await pool.query(sql + ' ORDER BY name', params);
    return rows;
}

async function findById(id) {
    const { rows } = await pool.query('SELECT * FROM employees WHERE id=$1', [id]);
    return rows[0];
}

async function create(employee) {
    const { rows } = await pool.query(
        `INSERT INTO employees(type,name,email,phone,qualification,subjects,position)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [employee.type, employee.name, employee.email, employee.phone, employee.qualification, employee.subjects, employee.position]
    );
    return rows[0];
}

async function update(id, employee) {
    const { rows } = await pool.query(
        `UPDATE employees SET
         name=COALESCE($1,name), phone=COALESCE($2,phone),
         qualification=COALESCE($3,qualification), subjects=COALESCE($4,subjects),
         position=COALESCE($5,position), active=COALESCE($6,active)
         WHERE id=$7 RETURNING *`,
        [employee.name, employee.phone, employee.qualification, employee.subjects, employee.position, employee.active, id]
    );
    return rows[0];
}

async function remove(id) {
    return pool.query('DELETE FROM employees WHERE id=$1', [id]);
}

module.exports = { list, findById, create, update, remove };
