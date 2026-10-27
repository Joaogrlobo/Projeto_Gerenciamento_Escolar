// Adaptadores HTTP para operações de inscrição.
const service = require('../services/enrollments.service');

function serialize(enrollment) {
    return {
        ...enrollment,
        studentId: enrollment.student_id,
        classId: enrollment.course_id,
        enrollmentDate: enrollment.enrollment_date,
        status: enrollment.status
    };
}

async function list(req, res) {
    res.json((await service.list(req.query)).map(serialize));
}

async function get(req, res) {
    res.json(serialize(await service.get(req.params.id)));
}

async function create(req, res) {
    const enrollment = await service.create(req.body || {}, req.headers.authorization);
    res.status(201).json(serialize(enrollment));
}

async function updateStatus(req, res) {
    res.json(serialize(await service.updateStatus(
        req.params.id,
        req.body?.status,
        req.headers.authorization
    )));
}

module.exports = { list, get, create, updateStatus };
