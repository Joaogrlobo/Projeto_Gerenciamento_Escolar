// Rotas de inscrição protegidas por autenticação e perfis autorizados.
const router = require('express').Router();
const controller = require('../controllers/enrollments.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/', requireRole('admin', 'teacher', 'staff'), controller.list);
router.get('/:id', requireRole('admin', 'teacher', 'staff'), controller.get);
router.post('/', requireRole('admin', 'staff'), controller.create);
router.patch('/:id/status', requireRole('admin', 'staff'), controller.updateStatus);
router.put('/:id/status', requireRole('admin', 'staff'), controller.updateStatus);

module.exports = router;
