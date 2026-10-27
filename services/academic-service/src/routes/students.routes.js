// Consultas acadêmicas de média e frequência por aluno.
const router = require('express').Router();
const gradesController = require('../controllers/grades.controller');
const attendanceController = require('../controllers/attendance.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/:id/average', requireRole('admin', 'teacher', 'staff'), gradesController.getAverage);
router.get('/:id/attendance', requireRole('admin', 'teacher', 'staff'), attendanceController.summarizeStudent);

module.exports = router;
