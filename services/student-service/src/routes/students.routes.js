// Rotas de alunos com autenticação e perfis autorizados.
const router = require('express').Router();
const studentsController = require('../controllers/students.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/', requireRole('admin', 'teacher', 'staff'), studentsController.list);
router.get('/:id', requireRole('admin', 'teacher', 'staff'), studentsController.get);
router.post('/', requireRole('admin', 'staff'), studentsController.create);
router.put('/:id', requireRole('admin', 'staff'), studentsController.update);
router.delete('/:id', requireRole('admin'), studentsController.remove);

module.exports = router;
