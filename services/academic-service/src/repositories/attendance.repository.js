// Consultas parametrizadas para registros e resumos de frequência.
const { pool } = require('../config/db');

async function upsertMany(records, client) {
    const rows = [];
    for (const record of records) {
        const result = await client.query(
            `INSERT INTO academic_attendance (student_id, course_id, attendance_date, status)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (student_id, course_id, attendance_date)
             DO UPDATE SET status = EXCLUDED.status, updated_at = now()
             RETURNING *`,
            [record.student_id, record.course_id ?? 0, record.attendance_date, record.status]
        );
        rows.push(result.rows[0]);
    }
    return rows;
}

async function list(filters = {}) {
    const clauses = [];
    const values = [];
    for (const [field, column, operator] of [
        ['student_id', 'student_id', '='],
        ['course_id', 'course_id', '='],
        ['date', 'attendance_date', '='],
        ['start_date', 'attendance_date', '>='],
        ['end_date', 'attendance_date', '<='],
        ['status', 'status', '=']
    ]) {
        if (filters[field] !== undefined) {
            values.push(filters[field]);
            clauses.push(`${column} ${operator} $${values.length}`);
        }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
        `SELECT * FROM academic_attendance ${where} ORDER BY attendance_date DESC, id DESC`,
        values
    );
    return result.rows;
}

async function summarize(filters = {}) {
    const clauses = [];
    const values = [];
    for (const [field, column, operator] of [
        ['student_id', 'student_id', '='],
        ['course_id', 'course_id', '='],
        ['start_date', 'attendance_date', '>='],
        ['end_date', 'attendance_date', '<=']
    ]) {
        if (filters[field] !== undefined) {
            values.push(filters[field]);
            clauses.push(`${column} ${operator || '='} $${values.length}`);
        }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
        `SELECT count(*)::integer AS total,
                count(*) FILTER (WHERE status = 'present')::integer AS present,
                count(*) FILTER (WHERE status = 'absent')::integer AS absent,
                count(*) FILTER (WHERE status = 'late')::integer AS late,
                count(*) FILTER (WHERE status = 'excused')::integer AS excused
         FROM academic_attendance ${where}`,
        values
    );
    const summary = result.rows[0];
    const counted = summary.total - summary.excused;
    summary.attendance_percentage = counted
        ? Number(((summary.present + summary.late) * 100 / counted).toFixed(2))
        : 0;
    return summary;
}

module.exports = { upsertMany, list, summarize };
