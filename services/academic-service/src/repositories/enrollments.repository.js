// Consultas parametrizadas para inscrições e operações transacionais de capacidade.
const { pool } = require('../config/db');

async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Uma conexão perdida já descarta a transação.
        }
        throw error;
    } finally {
        client.release();
    }
}

function findById(id, client = pool) {
    return client.query('SELECT * FROM academic_enrollments WHERE id = $1', [id])
        .then(result => result.rows[0] || null);
}

async function list(filters = {}) {
    const clauses = [];
    const values = [];
    for (const [field, column] of [
        ['student_id', 'student_id'],
        ['course_id', 'course_id'],
        ['status', 'status'],
        ['academic_year', 'academic_year']
    ]) {
        if (filters[field] !== undefined) {
            values.push(filters[field]);
            clauses.push(`${column} = $${values.length}`);
        }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
        `SELECT * FROM academic_enrollments ${where} ORDER BY created_at DESC, id DESC`,
        values
    );
    return result.rows;
}

async function countActiveByCourse(courseId, client = pool) {
    const result = await client.query(
        "SELECT count(*)::integer AS count FROM academic_enrollments WHERE course_id = $1 AND status = 'active'",
        [courseId]
    );
    return result.rows[0].count;
}

async function findByStudentCourseYear(studentId, courseId, academicYear, client = pool) {
    const result = await client.query(
        `SELECT * FROM academic_enrollments
         WHERE student_id = $1 AND course_id = $2 AND academic_year = $3`,
        [studentId, courseId, academicYear]
    );
    return result.rows[0] || null;
}

function lockCourse(client, courseId) {
    return client.query('SELECT pg_advisory_xact_lock($1::bigint)', [courseId]);
}

async function create(enrollment, client = pool) {
    const result = await client.query(
        `INSERT INTO academic_enrollments
            (student_id, course_id, academic_year, enrollment_date, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
            enrollment.student_id,
            enrollment.course_id,
            enrollment.academic_year,
            enrollment.enrollment_date,
            enrollment.status || 'active'
        ]
    );
    return result.rows[0];
}

async function updateStatus(id, status, client = pool) {
    const result = await client.query(
        `UPDATE academic_enrollments
         SET status = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, status]
    );
    return result.rows[0] || null;
}

module.exports = {
    transaction,
    findById,
    list,
    countActiveByCourse,
    findByStudentCourseYear,
    lockCourse,
    create,
    updateStatus
};
