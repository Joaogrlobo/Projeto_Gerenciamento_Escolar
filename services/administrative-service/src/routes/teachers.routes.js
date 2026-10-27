const router = require('express').Router();
const controller = require('../controllers/allocations.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/:teacherId/schedule', requireRole('admin', 'staff', 'teacher'), controller.teacherSchedule);

module.exports = router;
