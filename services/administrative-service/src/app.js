const express = require('express');
const cors = require('cors');
const classesRoutes = require('./routes/classes.routes');
const subjectsRoutes = require('./routes/subjects.routes');
const allocationsRoutes = require('./routes/allocations.routes');
const teachersRoutes = require('./routes/teachers.routes');
const errorHandler = require('./middlewares/error-handler');
const { circuitStates } = require('./resilience/resilient-call');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({
    status: 'UP',
    service: 'administrative-service',
    circuits: circuitStates()
}));
app.use('/classes', classesRoutes);
app.use('/subjects', subjectsRoutes);
app.use('/allocations', allocationsRoutes);
app.use('/teachers', teachersRoutes);
app.use(errorHandler);

module.exports = app;
