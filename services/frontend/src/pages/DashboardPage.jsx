import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canView, canWrite } from '../auth/permissions';

const SHORTCUTS = [
  { to: '/students', title: 'Alunos', text: 'Consultar cadastros de alunos.', textWrite: 'Consultar e atualizar cadastros.', area: 'students' },
  { to: '/employees', title: 'Funcionários', text: 'Visualizar equipe escolar.' },
  { to: '/classes', title: 'Turmas e disciplinas', text: 'Gerenciar estrutura acadêmica.' },
  { to: '/attendance', title: 'Frequência', text: 'Consultar resumo de frequência.', textWrite: 'Registrar presenças e ausências.', area: 'attendance' },
];

export default function DashboardPage() {
  const { displayName, user } = useAuth();
  const shortcuts = SHORTCUTS
    .filter((item) => canView(user, item.to))
    .map((item) => ({ ...item, text: item.area && canWrite(user, item.area) ? item.textWrite : item.text }));
  const [health, setHealth] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api('/health/services').then((result) => {
      const serviceList = Array.isArray(result?.services)
        ? result.services
        : result?.services && typeof result.services === 'object'
          ? Object.entries(result.services).map(([name, value]) => ({
            name,
            ...(typeof value === 'string' ? { status: value } : value),
          }))
          : [result];
      const cards = serviceList.map((service) => {
        const status = service.status || (service.healthy ? 'UP' : 'UNKNOWN');
        return {
          label: service.label || service.name || service.service || 'API Gateway',
          healthy: String(status).toUpperCase() === 'UP',
          status,
          circuitOpen: Boolean(service.circuit) && service.circuit !== 'CLOSED',
        };
      });
      if (active) { setHealth(cards); setLoading(false); }
    }).catch(() => {
      if (active) {
        setHealth([{ label: 'API Gateway', healthy: false, status: 'Indisponível' }]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  return <section className="page">
    <div className="welcome-card"><div><p className="eyebrow">PAINEL DE CONTROLE</p><h1>Olá, {displayName}</h1><p>Acompanhe os serviços e acesse rapidamente as áreas da escola.</p></div><div className="welcome-orbit">✦</div></div>
    <div className="page-heading section-heading"><div><p className="eyebrow">SISTEMA</p><h2>Status dos serviços</h2></div></div>
    {loading ? <div className="state-message">Verificando serviços…</div> : <div className="health-grid">{health.map((item) => <article className="panel health-card" key={item.label}><div className={`health-dot ${item.healthy ? 'online' : ''}`} /><div><h3>{item.label}</h3><span>{item.status}</span></div><span className={`status-pill ${item.healthy && !item.circuitOpen ? 'status-ok' : 'status-down'}`}>{item.circuitOpen ? 'Circuito aberto' : item.healthy ? 'Operacional' : 'Indisponível'}</span></article>)}</div>}
    {shortcuts.length > 0 && <>
      <div className="page-heading section-heading"><div><p className="eyebrow">ATALHOS</p><h2>Acesso rápido</h2></div></div>
      <div className="shortcut-grid">
        {shortcuts.map((item, index) => <Link to={item.to} className="shortcut-card" key={item.to}><span>{String(index + 1).padStart(2, '0')}</span><h3>{item.title}</h3><p>{item.text}</p></Link>)}
      </div>
    </>}
  </section>;
}
