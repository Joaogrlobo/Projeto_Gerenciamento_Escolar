// Aplicação Express, health check, rotas acadêmicas e erro em JSON.
const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const enrollmentsRoutes = require('./routes/enrollments.routes');
const gradesRoutes = require('./routes/grades.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const studentsRoutes = require('./routes/students.routes');
const errorHandler = require('./middlewares/error-handler');
const { circuitStates } = require('./resilience/resilient-call');

const app = express();
const academicRoutes = express.Router();
app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({
    status: 'UP',
    service: 'academic-service',
    circuits: circuitStates()
}));
academicRoutes.use('/enrollments', enrollmentsRoutes);
academicRoutes.use('/grades', gradesRoutes);
academicRoutes.use('/attendance', attendanceRoutes);
academicRoutes.use('/students', studentsRoutes);
app.use('/academic', academicRoutes);
app.use(academicRoutes);
app.use((req, res) => res.status(404).json({ error: 'rota não encontrada' }));
app.use(errorHandler);

module.exports = app;
