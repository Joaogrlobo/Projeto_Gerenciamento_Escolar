// Rotas de notificações protegidas por autenticação e perfil.
const express = require('express');
const controller = require('../controllers/notifications.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = express.Router();
router.get('/', authenticate, requireRole('admin'), controller.list);

module.exports = router;
