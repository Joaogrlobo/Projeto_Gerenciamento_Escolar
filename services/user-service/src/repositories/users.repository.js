// Persistência SQL parametrizada de usuários.
const { pool } = require('../config/db');

async function create({ name, email, passwordHash, role }) {
    const { rows } = await pool.query(
        'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',
        [name, email, passwordHash, role]
    );
    return rows[0];
}

async function findByEmail(email) {
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    return rows[0];
}

async function list() {
    const { rows } = await pool.query('SELECT id,name,email,role,created_at FROM users ORDER BY id');
    return rows;
}

async function createAdminSeed(email, passwordHash) {
    return pool.query(
        `INSERT INTO users(name,email,password_hash,role)
         VALUES($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
        ['Administrador', email, passwordHash, 'admin']
    );
}

module.exports = { create, findByEmail, list, createAdminSeed };
