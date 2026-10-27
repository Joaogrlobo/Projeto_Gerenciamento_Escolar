// Adaptadores HTTP para lançamento e consulta de notas.
const service = require('../services/grades.service');
const averages = require('../services/averages.service');

async function list(req, res) {
    const grades = await service.list(req.query);
    res.json(grades.map(grade => ({
        ...grade,
        score: Number(grade.value),
        assessment: grade.subject,
        enrollmentId: grade.enrollment_id
    })));
}

async function get(req, res) {
    const grade = await service.get(req.params.id);
    res.json({
        ...grade,
        score: Number(grade.value),
        assessment: grade.subject,
        enrollmentId: grade.enrollment_id
    });
}

async function create(req, res) {
    const grade = await service.create(req.body || {}, req.headers.authorization);
    res.status(202).json({
        grade: {
            ...grade,
            score: Number(grade.value),
            assessment: grade.subject,
            enrollmentId: grade.enrollment_id
        },
        status: 'processing'
    });
}

async function update(req, res) {
    const grade = await service.update(req.params.id, req.body || {});
    res.json({
        ...grade,
        score: Number(grade.value),
        assessment: grade.subject,
        enrollmentId: grade.enrollment_id
    });
}

async function remove(req, res) {
    const grade = await service.remove(req.params.id);
    res.json({
        deleted: true,
        grade: {
            ...grade,
            score: Number(grade.value),
            assessment: grade.subject,
            enrollmentId: grade.enrollment_id
        }
    });
}

async function getAverage(req, res) {
    const average = await averages.getAverage(
        req.params.id,
        req.query.subject,
        req.headers.authorization
    );
    res.json(average);
}

module.exports = { list, get, create, update, remove, getAverage };
