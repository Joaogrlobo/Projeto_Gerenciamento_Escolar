// Handlers HTTP da API de notificações.
const notificationsService = require('../services/notifications.service');

async function list(req, res, next) {
    try {
        const notifications = await notificationsService.listNotifications(
            req.query.type,
            req.query.limit,
            req.user.role
        );
        res.json(notifications);
    } catch (error) {
        next(error);
    }
}

async function unreadCount(req, res, next) {
    try {
        res.json({ count: await notificationsService.countUnread(req.user) });
    } catch (error) {
        next(error);
    }
}

async function markSeen(req, res, next) {
    try {
        await notificationsService.markSeen(req.user);
        res.status(204).end();
    } catch (error) {
        next(error);
    }
}

module.exports = { list, unreadCount, markSeen };
