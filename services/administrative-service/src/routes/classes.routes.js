const router = require('express').Router();
const controller = require('../controllers/classes.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/', requireRole('admin', 'staff', 'teacher'), controller.list);
router.get('/:id/schedule', requireRole('admin', 'staff', 'teacher'), controller.schedule);
router.get('/:id', requireRole('admin', 'staff', 'teacher'), controller.get);
router.post('/', requireRole('admin'), controller.create);
router.put('/:id', requireRole('admin'), controller.update);
router.patch('/:id', requireRole('admin'), controller.update);
router.delete('/:id', requireRole('admin'), controller.remove);

module.exports = router;
