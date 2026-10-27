// Rotas de frequência e resumos com controle de acesso escolar.
const router = require('express').Router();
const controller = require('../controllers/attendance.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/summary', requireRole('admin', 'teacher', 'staff'), controller.summarize);
router.get('/', requireRole('admin', 'teacher', 'staff'), controller.list);
router.post('/', requireRole('admin', 'teacher'), controller.bulkUpsert);
router.post('/batch', requireRole('admin', 'teacher'), controller.bulkUpsert);
router.put('/bulk', requireRole('admin', 'teacher'), controller.bulkUpsert);

module.exports = router;
