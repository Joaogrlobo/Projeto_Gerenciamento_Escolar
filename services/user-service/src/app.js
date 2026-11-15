// Aplicação Express: middlewares globais, health check, rotas e tratamento de erros.
const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const errorHandler = require('./middlewares/error-handler');

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'user-service' }));
app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use(errorHandler);

module.exports = app;
