// Aplicação Express: middlewares globais, health check, rotas e tratamento de erros.
const express = require('express');
const cors = require('cors');
const employeesRoutes = require('./routes/employees.routes');
const errorHandler = require('./middlewares/error-handler');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: 'staff-service' }));
app.use('/employees', employeesRoutes);
app.use(errorHandler);

module.exports = app;
