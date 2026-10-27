// Handlers HTTP da API de notificações.
const notificationsService = require('../services/notifications.service');

async function list(req, res, next) {
    try {
        const notifications = await notificationsService.listNotifications(req.query.type, req.query.limit);
        res.json(notifications);
    } catch (error) {
        next(error);
    }
}

module.exports = { list };
