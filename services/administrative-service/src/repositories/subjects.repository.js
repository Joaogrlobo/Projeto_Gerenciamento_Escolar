const { pool } = require('../config/db');

async function list() {
    const { rows } = await pool.query('SELECT * FROM subjects ORDER BY name, id');
    return rows;
}

async function findById(id) {
    const { rows } = await pool.query('SELECT * FROM subjects WHERE id=$1', [id]);
    return rows[0];
}

async function create(item) {
    const { rows } = await pool.query(
        'INSERT INTO subjects(name, workload_hours) VALUES($1,$2) RETURNING *',
        [item.name, item.workload_hours]
    );
    return rows[0];
}

async function update(id, item) {
    const { rows } = await pool.query(
        `UPDATE subjects SET
         name=COALESCE($1,name), workload_hours=COALESCE($2,workload_hours)
         WHERE id=$3 RETURNING *`,
        [item.name, item.workload_hours, id]
    );
    return rows[0];
}

async function remove(id, database = pool) {
    return database.query('DELETE FROM subjects WHERE id=$1', [id]);
}

module.exports = { list, findById, create, update, remove };
