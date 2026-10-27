const { pool } = require('../config/db');

async function list() {
    const { rows } = await pool.query('SELECT * FROM classes ORDER BY name, id');
    return rows;
}

async function findById(id) {
    const { rows } = await pool.query('SELECT * FROM classes WHERE id=$1', [id]);
    return rows[0];
}

async function create(item) {
    const { rows } = await pool.query(
        `INSERT INTO classes(name, school_year, shift, capacity, active)
         VALUES($1,$2,$3,$4,COALESCE($5,true)) RETURNING *`,
        [item.name, item.school_year, item.shift, item.capacity, item.active]
    );
    return rows[0];
}

async function update(id, item) {
    const { rows } = await pool.query(
        `UPDATE classes SET
         name=COALESCE($1,name), school_year=COALESCE($2,school_year),
         shift=COALESCE($3,shift), capacity=COALESCE($4,capacity), active=COALESCE($5,active)
         WHERE id=$6 RETURNING *`,
        [item.name, item.school_year, item.shift, item.capacity, item.active, id]
    );
    return rows[0];
}

async function remove(id) {
    return pool.query('DELETE FROM classes WHERE id=$1', [id]);
}

async function schedule(id) {
    const { rows } = await pool.query(
        `SELECT a.*, s.name AS subject_name, s.workload_hours
         FROM allocations a JOIN subjects s ON s.id=a.subject_id
         WHERE a.class_id=$1
         ORDER BY a.weekday, a.start_time`,
        [id]
    );
    return rows;
}

module.exports = { list, findById, create, update, remove, schedule };
