// Adaptadores HTTP para frequência em lote e consultas resumidas.
const service = require('../services/attendance.service');

async function list(req, res) {
    const rows = await service.list(req.query);
    res.json(rows.map(record => ({
        ...record,
        course_id: record.course_id || null,
        class_id: record.course_id || null,
        studentId: record.student_id,
        classId: record.course_id || null,
        date: record.attendance_date
    })));
}

async function summarize(req, res) {
    res.json(await service.summarize(req.query, req.headers.authorization));
}

async function summarizeStudent(req, res) {
    res.json(await service.summarizeStudent(
        req.params.id,
        req.query,
        req.headers.authorization
    ));
}

async function bulkUpsert(req, res) {
    const records = await service.bulkUpsert(req.body || {}, req.headers.authorization);
    res.status(req.method === 'POST' ? 201 : 200).json({
        count: records.length,
        records: records.map(record => ({
            ...record,
            course_id: record.course_id || null,
            class_id: record.course_id || null,
            studentId: record.student_id,
            classId: record.course_id || null,
            date: record.attendance_date
        }))
    });
}

module.exports = { list, summarize, summarizeStudent, bulkUpsert };
