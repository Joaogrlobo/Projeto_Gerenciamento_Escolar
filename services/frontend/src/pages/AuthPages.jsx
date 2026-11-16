import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

function AuthForm({ register = false }) {
  const { token, login, register: signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (token) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await (register ? signUp(values) : login(values));
      navigate(register ? '/login' : '/', { replace: true, state: register ? { registered: true } : undefined });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const fields = register
    ? [{ name: 'name', label: 'Nome completo', type: 'text' }, { name: 'email', label: 'E-mail', type: 'email' }, { name: 'password', label: 'Senha', type: 'password' }]
    : [{ name: 'email', label: 'E-mail', type: 'email' }, { name: 'password', label: 'Senha', type: 'password' }];

  return <main className="auth-page">
    <div className="auth-decoration"><div className="brand-mark">SF</div><h1>Educação que transforma.</h1><p>Gestão simples e conectada para toda a comunidade escolar.</p></div>
    <div className="auth-card">
      <p className="eyebrow">SCHOOLFLOW</p>
      <h2>{register ? 'Crie sua conta' : 'Bem-vindo de volta'}</h2>
      <p className="muted">{register ? 'Preencha seus dados para começar.' : 'Entre para acessar o sistema escolar.'}</p>
      {location.state?.registered && <div className="alert alert-success">Cadastro realizado. Entre com seu e-mail e senha.</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <form onSubmit={submit}>
        {fields.map((field) => <label className="field" key={field.name}><span>{field.label}</span><input required type={field.type} autoComplete={field.name === 'password' ? register ? 'new-password' : 'current-password' : field.name} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} /></label>)}
        <button className="button button-wide" disabled={busy}>{busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <p className="auth-switch">{register ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'} <Link to={register ? '/login' : '/register'}>{register ? 'Entrar' : 'Cadastre-se'}</Link></p>
    </div>
  </main>;
}

export function LoginPage() { return <AuthForm />; }
export function RegisterPage() { return <AuthForm register />; }
