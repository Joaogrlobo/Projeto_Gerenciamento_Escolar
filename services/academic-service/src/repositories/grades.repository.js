// Consultas parametrizadas para notas e cálculo de médias ponderadas.
const { pool } = require('../config/db');

async function list(filters = {}) {
    const clauses = [];
    const values = [];
    for (const [field, column] of [
        ['enrollment_id', 'enrollment_id'],
        ['student_id', 'student_id'],
        ['course_id', 'course_id'],
        ['subject', 'subject']
    ]) {
        if (filters[field] !== undefined) {
            values.push(filters[field]);
            clauses.push(`${column} = $${values.length}`);
        }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
        `SELECT * FROM academic_grades ${where} ORDER BY created_at DESC, id DESC`,
        values
    );
    return result.rows;
}

async function findById(id, client = pool) {
    const result = await client.query('SELECT * FROM academic_grades WHERE id = $1', [id]);
    return result.rows[0] || null;
}

async function findByEnrollment(id, client = pool) {
    const result = await client.query('SELECT * FROM academic_enrollments WHERE id = $1', [id]);
    return result.rows[0] || null;
}

async function create(grade, client = pool) {
    const result = await client.query(
        `INSERT INTO academic_grades
            (enrollment_id, student_id, course_id, subject, value, weight)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [grade.enrollment_id, grade.student_id, grade.course_id, grade.subject, grade.value, grade.weight]
    );
    return result.rows[0];
}

async function update(id, grade, client = pool) {
    const result = await client.query(
        `UPDATE academic_grades
         SET subject = $2, value = $3, weight = $4, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, grade.subject, grade.value, grade.weight]
    );
    return result.rows[0] || null;
}

async function remove(id, client = pool) {
    const result = await client.query('DELETE FROM academic_grades WHERE id = $1 RETURNING *', [id]);
    return result.rows[0] || null;
}

async function calculateAverage(studentId, subject, client) {
    const result = await client.query(
        `SELECT COALESCE(SUM(value * weight) / NULLIF(SUM(weight), 0), 0)::numeric(7, 2) AS average,
                COALESCE(SUM(weight), 0)::numeric(12, 3) AS total_weight,
                count(*)::integer AS grade_count
         FROM academic_grades
         WHERE student_id = $1 AND subject = $2`,
        [studentId, subject]
    );
    return result.rows[0];
}

async function upsertAverage(studentId, subject, average, client) {
    const result = await client.query(
        `INSERT INTO academic_averages (student_id, subject, average, total_weight, grade_count, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (student_id, subject)
         DO UPDATE SET average = EXCLUDED.average,
                       total_weight = EXCLUDED.total_weight,
                       grade_count = EXCLUDED.grade_count,
                       updated_at = now()
         RETURNING *`,
        [studentId, subject, average.average, average.total_weight, average.grade_count]
    );
    return result.rows[0];
}

async function findAverage(studentId, subject) {
    if (subject !== undefined) {
        const result = await pool.query(
            'SELECT * FROM academic_averages WHERE student_id = $1 AND subject = $2',
            [studentId, subject]
        );
        return result.rows[0] || null;
    }
    const result = await pool.query(
        `SELECT student_id,
                COALESCE(SUM(average * total_weight) / NULLIF(SUM(total_weight), 0), 0)::numeric(7, 2) AS average,
                COALESCE(SUM(total_weight), 0)::numeric(12, 3) AS total_weight,
                COALESCE(SUM(grade_count), 0)::integer AS grade_count,
                max(updated_at) AS updated_at
         FROM academic_averages
         WHERE student_id = $1
         GROUP BY student_id`,
        [studentId]
    );
    return result.rows[0] || null;
}

module.exports = {
    list,
    findById,
    findByEnrollment,
    create,
    update,
    remove,
    calculateAverage,
    upsertAverage,
    findAverage
};
