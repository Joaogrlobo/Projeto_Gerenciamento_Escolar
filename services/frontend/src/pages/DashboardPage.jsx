import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export default function DashboardPage() {
  const { displayName, isAdmin } = useAuth();
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
    <div className="page-heading section-heading"><div><p className="eyebrow">ATALHOS</p><h2>Acesso rápido</h2></div></div>
    <div className="shortcut-grid">
      <Link to="/students" className="shortcut-card"><span>01</span><h3>Alunos</h3><p>Consultar e atualizar cadastros.</p></Link>
      <Link to="/employees" className="shortcut-card"><span>02</span><h3>Funcionários</h3><p>Visualizar equipe escolar.</p></Link>
      {isAdmin && <Link to="/classes" className="shortcut-card"><span>03</span><h3>Turmas e disciplinas</h3><p>Gerenciar estrutura acadêmica.</p></Link>}
      <Link to="/attendance" className="shortcut-card"><span>04</span><h3>Frequência</h3><p>Registrar presenças e ausências.</p></Link>
    </div>
  </section>;
}
