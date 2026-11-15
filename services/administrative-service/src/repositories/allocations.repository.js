const { pool } = require('../config/db');

const selection = `SELECT a.*, c.name AS class_name, c.school_year,
                          s.name AS subject_name, s.workload_hours
                   FROM allocations a
                   JOIN classes c ON c.id=a.class_id
                   JOIN subjects s ON s.id=a.subject_id`;

async function list(filters = {}) {
    const clauses = [];
    const params = [];
    const filterColumns = {
        class_id: 'a.class_id',
        teacher_id: 'a.teacher_id',
        weekday: 'a.weekday',
        school_year: 'c.school_year'
    };
    for (const [field, value] of Object.entries(filters)) {
        if (value === undefined) continue;
        params.push(value);
        clauses.push(`${filterColumns[field]}=$${params.length}`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
        `${selection}${where} ORDER BY c.school_year, a.weekday, a.start_time`,
        params
    );
    return rows;
}

async function findById(id) {
    const { rows } = await pool.query(`${selection} WHERE a.id=$1`, [id]);
    return rows[0];
}

async function findScheduleConflict(item, resource, excludeId, database = pool) {
    const column = { teacher: 'teacher_id', class: 'class_id', room: 'room' }[resource];
    const field = resource === 'teacher' ? 'teacher_id' : resource === 'class' ? 'class_id' : 'room';
    const params = [item[field], item.class_id, item.weekday, item.end_time, item.start_time];
    let sql = `SELECT a.id FROM allocations a
               JOIN classes allocation_class ON allocation_class.id=a.class_id
               JOIN classes requested_class ON requested_class.id=$2
               WHERE a.${column}=$1
                 AND allocation_class.school_year=requested_class.school_year
                 AND a.weekday=$3
                 AND a.start_time < $4 AND a.end_time > $5`;
    if (excludeId !== undefined) {
        params.push(excludeId);
        sql += ` AND a.id <> $6`;
    }
    const { rows } = await database.query(sql, params);
    return rows[0];
}

async function create(item, database = pool) {
    const { rows } = await database.query(
        `INSERT INTO allocations(class_id,subject_id,teacher_id,room,weekday,start_time,end_time)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [item.class_id, item.subject_id, item.teacher_id, item.room, item.weekday,
            item.start_time, item.end_time]
    );
    return rows[0];
}

async function withScheduleLock(operation) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(9347281)');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // A broken connection can no longer roll back the transaction.
        }
        throw error;
    } finally {
        client.release();
    }
}

async function remove(id, database = pool) {
    return database.query('DELETE FROM allocations WHERE id=$1', [id]);
}

async function teacherSchedule(teacherId) {
    const { rows } = await pool.query(
        `${selection} WHERE a.teacher_id=$1
         ORDER BY a.weekday, a.start_time`,
        [teacherId]
    );
    return rows;
}

module.exports = {
    list,
    findById,
    findScheduleConflict,
    create,
    withScheduleLock,
    remove,
    teacherSchedule
};
