// Rotas de notas: consulta por equipe escolar e escrita por docentes/admins.
const router = require('express').Router();
const controller = require('../controllers/grades.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/', requireRole('admin', 'teacher', 'staff'), controller.list);
router.get('/:id', requireRole('admin', 'teacher', 'staff'), controller.get);
router.post('/', requireRole('admin', 'teacher'), controller.create);
router.put('/:id', requireRole('admin', 'teacher'), controller.update);
router.delete('/:id', requireRole('admin', 'teacher'), controller.remove);

module.exports = router;
