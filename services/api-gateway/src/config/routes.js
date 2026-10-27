module.exports = [
    { prefix: '/api/auth', service: 'user-service', stripApiPrefix: true },
    { prefix: '/api/users', service: 'user-service', stripApiPrefix: true },
    { prefix: '/api/students', service: 'student-service', stripApiPrefix: true },
    { prefix: '/api/employees', service: 'staff-service', stripApiPrefix: true },
    { prefix: '/api/academic', service: 'academic-service', stripApiPrefix: true, stripServicePrefix: true },
    { prefix: '/api/administrative', service: 'administrative-service', stripApiPrefix: true, stripServicePrefix: true },
    { prefix: '/api/notifications', service: 'notification-service', stripApiPrefix: true }
];
