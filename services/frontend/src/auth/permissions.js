// Permissões do frontend, espelhando a tabela de perfis de docs/api.md.
// A API continua sendo quem bloqueia; aqui só se evita mostrar o que daria 403.
const STAFF_AREA = ['admin', 'teacher', 'staff'];

// Quem pode abrir cada tela (leitura).
const VIEW = {
  '/students': STAFF_AREA,
  '/employees': STAFF_AREA,
  '/enrollments': STAFF_AREA,
  '/grades': STAFF_AREA,
  '/attendance': STAFF_AREA,
  '/allocations': STAFF_AREA,
  '/notifications': STAFF_AREA,
  '/classes': ['admin'],
  '/subjects': ['admin'],
  '/users': ['admin'],
};

// Quem pode criar ou alterar em cada tela.
const WRITE = {
  students: ['admin', 'staff'],
  studentsDelete: ['admin'],
  employees: ['admin'],
  enrollments: ['admin', 'staff'],
  grades: ['admin', 'teacher'],
  attendance: ['admin', 'teacher'],
  allocations: ['admin'],
};

export function roleOf(user) {
  return String(user?.role || '').toLowerCase();
}

// Telas sem regra (como a Visão geral) ficam liberadas para qualquer usuário logado.
export function canView(user, path) {
  const roles = VIEW[path];
  return !roles || roles.includes(roleOf(user));
}

export function canWrite(user, area) {
  return (WRITE[area] || []).includes(roleOf(user));
}
