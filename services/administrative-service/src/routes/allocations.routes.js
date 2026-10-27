const router = require('express').Router();
const controller = require('../controllers/allocations.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.use(authenticate);
router.get('/', requireRole('admin', 'staff', 'teacher'), controller.list);
router.post('/', requireRole('admin'), controller.create);
router.delete('/', requireRole('admin'), controller.remove);
router.delete('/:id', requireRole('admin'), controller.remove);

module.exports = router;
