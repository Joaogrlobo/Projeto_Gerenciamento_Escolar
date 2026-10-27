// Rotas administrativas de gerenciamento de usuários.
const router = require('express').Router();
const usersController = require('../controllers/users.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

router.post('/', authenticate, requireRole('admin'), usersController.create);
router.get('/', authenticate, requireRole('admin'), usersController.list);

module.exports = router;
