// Rotas de notificações protegidas por autenticação e perfil.
const express = require('express');
const controller = require('../controllers/notifications.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin', 'staff', 'teacher'));
router.get('/', controller.list);
router.get('/unread-count', controller.unreadCount);
router.post('/seen', controller.markSeen);

module.exports = router;
