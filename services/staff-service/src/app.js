// Aplicação Express: middlewares globais, health check, rotas e tratamento de erros.
const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const employeesRoutes = require('./routes/employees.routes');
const errorHandler = require('./middlewares/error-handler');

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'staff-service' }));
app.use('/employees', employeesRoutes);
app.use(errorHandler);

module.exports = app;
