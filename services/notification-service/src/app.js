// Aplicação Express com health check, rotas e tratamento de erros.
const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const notificationsRoutes = require('./routes/notifications.routes');
const errorHandler = require('./middlewares/error-handler');

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'notification-service' }));
app.use('/notifications', notificationsRoutes);
app.use(errorHandler);

module.exports = app;
