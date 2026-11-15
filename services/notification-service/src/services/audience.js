// Define quais perfis enxergam cada tipo de evento.
const STAFF = ['admin', 'staff'];
const CLASSROOM = ['admin', 'staff', 'teacher'];
const EXACT = {
    'user.logged': [],
    'class.created': STAFF,
    'average.calculated': CLASSROOM,
    'attendance.recorded': CLASSROOM,
    'teacher.assigned': CLASSROOM,
    'schedule.updated': CLASSROOM
};
const FAMILY = {
    student: STAFF,
    employee: STAFF,
    enrollment: STAFF,
    grade: CLASSROOM
};

function rolesFor(type) {
    return EXACT[type] ?? FAMILY[type.split('.')[0]] ?? ['admin'];
}

module.exports = { rolesFor };
