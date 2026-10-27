// Rotas de funcionários com autenticação e perfis autorizados.
const router = require('express').Router();
const employeesController = require('../controllers/employees.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/', requireRole('admin', 'staff', 'teacher'), employeesController.list);
router.get('/:id', requireRole('admin', 'staff', 'teacher'), employeesController.get);
router.post('/', requireRole('admin'), employeesController.create);
router.put('/:id', requireRole('admin'), employeesController.update);
router.delete('/:id', requireRole('admin'), employeesController.remove);

module.exports = router;
