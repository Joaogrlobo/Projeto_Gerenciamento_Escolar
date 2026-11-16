import { useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { canView, canWrite } from './auth/permissions';
import { canSeeNotifications, useNotifications } from './realtime/NotificationsProvider';
import { CrudPage } from './components/CrudPage';
import { AttendancePage, AllocationsPage, EnrollmentsPage, GradesPage, NotificationsPage } from './pages/AcademicPages';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import DashboardPage from './pages/DashboardPage';

const studentFields = [
  { name: 'registration', label: 'Matrícula', required: true },
  { name: 'name', label: 'Nome completo', required: true },
  { name: 'birth_date', label: 'Data de nascimento', type: 'date' },
  { name: 'address', label: 'Endereço' },
  { name: 'contact', label: 'Contato' },
  { name: 'class_name', label: 'Turma' },
];
const employeeFields = [
  { name: 'type', label: 'Tipo', required: true, options: [{ value: 'teacher', label: 'Professor' }, { value: 'admin_staff', label: 'Equipe administrativa' }], filterOptions: ['teacher', 'admin_staff'] },
  { name: 'name', label: 'Nome completo', required: true },
  { name: 'email', label: 'E-mail', type: 'email', required: true },
  { name: 'phone', label: 'Telefone' },
  { name: 'qualification', label: 'Qualificação' },
  { name: 'subjects', label: 'Disciplinas' },
  { name: 'position', label: 'Cargo' },
];
const userFields = [
  { name: 'name', label: 'Nome completo', required: true },
  { name: 'email', label: 'E-mail', type: 'email', required: true },
  { name: 'password', label: 'Senha', type: 'password', required: true },
  { name: 'role', label: 'Perfil', required: true, options: ['admin', 'teacher', 'student', 'parent', 'staff'].map((role) => ({ value: role, label: role })) },
];

function Protected({ children, admin = false }) {
  const { token, isAdmin, user } = useAuth();
  const { pathname } = useLocation();
  if (!token) return <Navigate to="/login" replace />;
  if ((admin && !isAdmin) || !canView(user, pathname)) return <Navigate to="/" replace />;
  return children;
}

function Sidebar() {
  const { user, displayName, isAdmin, logout } = useAuth();
  const { unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const role = user?.role || 'Usuário';
  const allLinks = [
    { to: '/', label: 'Visão geral', icon: '⌂' },
    { to: '/students', label: 'Alunos', icon: '◉' },
    { to: '/employees', label: 'Funcionários', icon: '♧' },
    { to: '/enrollments', label: 'Matrículas', icon: '▤' },
    { to: '/grades', label: 'Notas', icon: '✳' },
    { to: '/attendance', label: 'Frequência', icon: '◷' },
    { to: '/allocations', label: 'Alocações', icon: '▦' },
    ...(canSeeNotifications(user) ? [{ to: '/notifications', label: 'Notificações', icon: '♢', badge: unread }] : []),
    ...(isAdmin ? [
      { to: '/classes', label: 'Turmas', icon: '▣' },
      { to: '/subjects', label: 'Disciplinas', icon: '▧' },
      { to: '/users', label: 'Usuários', icon: '♙' },
    ] : []),
  ];
  const links = allLinks.filter((link) => canView(user, link.to));
  return <>
    <button className="mobile-menu" type="button" onClick={() => setOpen(!open)} aria-label="Abrir menu">☰</button>
    {open && <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <Link to="/" className="brand" onClick={() => setOpen(false)}><span className="brand-mark">DE</span><span>Distrito<span className="brand-light">Escolar</span></span></Link>
      <div className="menu-caption">MENU PRINCIPAL</div>
      <nav className="menu">{links.map((link) => <NavLink key={link.to} end={link.to === '/'} to={link.to} onClick={() => setOpen(false)} className={({ isActive }) => `menu-link${isActive ? ' active' : ''}`}><span className="menu-icon">{link.icon}</span>{link.label}{link.badge > 0 && <span className="menu-badge">{link.badge > 99 ? '99+' : link.badge}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom">
        <div className="profile-block"><span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span><div className="profile-text"><strong>{displayName}</strong><span>{role}</span></div></div>
        <button className="logout-button" onClick={logout} type="button"><span>↪</span>Sair</button>
      </div>
    </aside>
  </>;
}

function Shell({ children }) {
  return <div className="app-shell"><Sidebar /><main className="main-content"><header className="topbar"><span>Portal de gestão escolar</span><span className="topbar-tag">AMBIENTE ESCOLAR</span></header>{children}</main></div>;
}

function Page({ children, admin = false }) {
  return <Protected admin={admin}><Shell>{children}</Shell></Protected>;
}

function NotificationsRoute() {
  const { user } = useAuth();
  return canSeeNotifications(user) ? <NotificationsPage /> : <Navigate to="/" replace />;
}

function StudentsPage() {
  const { user } = useAuth();
  return <CrudPage title="Alunos" endpoint="/api/students" fields={studentFields} columns={['registration', 'name', 'birth_date', 'class_name', 'contact']} canEdit={canWrite(user, 'students')} canDelete={canWrite(user, 'studentsDelete')} />;
}

function EmployeesPage() {
  const { user } = useAuth();
  return <CrudPage title="Funcionários" endpoint="/api/employees" fields={employeeFields} columns={['name', 'type', 'email', 'phone', 'position']} canEdit={canWrite(user, 'employees')} />;
}

export default function App() {
  const location = useLocation();
  return <Routes>
    <Route path="/login" element={<LoginPage key={location.key} />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/" element={<Page><DashboardPage /></Page>} />
    <Route path="/students" element={<Page><StudentsPage /></Page>} />
    <Route path="/employees" element={<Page><EmployeesPage /></Page>} />
    <Route path="/users" element={<Page admin><CrudPage title="Usuários" endpoint="/api/users" fields={userFields} columns={['name', 'email', 'role']} rowActions={false} /></Page>} />
    <Route path="/classes" element={<Page admin><CrudPage title="Turmas" endpoint="/api/administrative/classes" fields={[
      { name: 'name', label: 'Nome da turma', required: true },
      { name: 'school_year', label: 'Ano letivo', type: 'number', required: true },
      { name: 'shift', label: 'Turno', required: true, options: [
        { value: 'morning', label: 'Manhã' },
        { value: 'afternoon', label: 'Tarde' },
        { value: 'evening', label: 'Noite' },
      ] },
      { name: 'capacity', label: 'Capacidade', type: 'number', required: true },
      { name: 'active', label: 'Ativa', valueType: 'boolean', options: [
        { value: 'true', label: 'Sim' },
        { value: 'false', label: 'Não' },
      ] },
    ]} columns={['name', 'school_year', 'shift', 'capacity', 'active']} /></Page>} />
    <Route path="/subjects" element={<Page admin><CrudPage title="Disciplinas" endpoint="/api/administrative/subjects" fields={[
      { name: 'name', label: 'Nome da disciplina', required: true },
      { name: 'workload_hours', label: 'Carga horária (horas)', type: 'number', required: true },
    ]} columns={['name', 'workload_hours']} /></Page>} />
    <Route path="/allocations" element={<Page><AllocationsPage /></Page>} />
    <Route path="/enrollments" element={<Page><EnrollmentsPage /></Page>} />
    <Route path="/grades" element={<Page><GradesPage /></Page>} />
    <Route path="/attendance" element={<Page><AttendancePage /></Page>} />
    <Route path="/notifications" element={<Page><NotificationsRoute /></Page>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
