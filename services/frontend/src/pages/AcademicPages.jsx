import { useCallback, useEffect, useMemo, useState } from 'react';
import { http } from '../api/client';
import { useNotifications } from '../realtime/NotificationsProvider';
import { useAuth } from '../auth/AuthContext';
import { canWrite as hasWritePermission } from '../auth/permissions';

// O formulário só aparece para quem a API deixa enviar (ver auth/permissions.js).
function useCanWrite(area) {
  const { user } = useAuth();
  return hasWritePermission(user, area);
}

function recordsFrom(data) {
  return Array.isArray(data) ? data : data?.items || data?.data || [];
}

function ErrorMessage({ children }) {
  return children ? <div className="alert alert-error" role="alert">{children}</div> : null;
}

function DataTable({ rows, columns, empty = 'Nenhum registro encontrado.' }) {
  if (!rows.length) return <div className="state-message">{empty}</div>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={row.id ?? index}>{columns.map(([key]) => <td key={key}>{row[key] === null || row[key] === undefined || row[key] === '' ? '—' : typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key])}</td>)}</tr>)}
  </tbody></table></div>;
}

export function AllocationsPage() {
  const [values, setValues] = useState({});
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [classId, setClassId] = useState('');
  const canWrite = useCanWrite('allocations');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const path = classId ? `/api/administrative/allocations?class_id=${encodeURIComponent(classId)}` : '/api/administrative/allocations';
      setRecords(recordsFrom(await http.get(path)));
      setError('');
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [classId]);
  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await http.post('/api/administrative/allocations', {
        ...values,
        class_id: Number(values.class_id),
        subject_id: Number(values.subject_id),
        teacher_id: Number(values.teacher_id),
        weekday: Number(values.weekday),
        room: values.room?.trim() || null,
      });
      setMessage('Alocação criada com sucesso.');
      setValues({});
      await load();
    } catch (requestError) {
      setError(requestError.status === 409
        ? 'Conflito de horário: já existe uma alocação para a turma ou professor neste período.'
        : requestError.message);
    } finally { setBusy(false); }
  }

  return <section className="page">
    <div className="page-heading"><div><p className="eyebrow">ORGANIZAÇÃO ACADÊMICA</p><h1>Alocações</h1></div><button className="button button-secondary" onClick={load} type="button">Atualizar</button></div>
    <ErrorMessage>{error}</ErrorMessage>{message && <div className="alert alert-success">{message}</div>}
    <div className={`content-grid${canWrite ? '' : ' content-grid-single'}`}>
      {canWrite && <form className="panel form-panel" onSubmit={submit}><h2>Nova alocação</h2>
        {[['class_id', 'ID da turma'], ['subject_id', 'ID da disciplina'], ['teacher_id', 'ID do professor'], ['weekday', 'Dia da semana (1-5)'], ['start_time', 'Horário inicial'], ['end_time', 'Horário final']].map(([name, label]) => <label className="field" key={name}><span>{label}</span><input required value={values[name] || ''} type={name.includes('time') ? 'time' : 'number'} min={!name.includes('time') ? 1 : undefined} max={name === 'weekday' ? 5 : undefined} onChange={(event) => setValues({ ...values, [name]: event.target.value })} /></label>)}
        <label className="field"><span>Sala (opcional)</span><input value={values.room || ''} onChange={(event) => setValues({ ...values, room: event.target.value })} /></label>
        <button className="button" disabled={busy}>{busy ? 'Salvando…' : 'Criar alocação'}</button>
      </form>}
      <div className="panel table-panel"><div className="table-heading"><h2>Horários da turma</h2><input className="search" placeholder="ID da turma" value={classId} onChange={(event) => setClassId(event.target.value)} /></div>
        {loading ? <div className="state-message">Carregando horários…</div> : <DataTable rows={records} columns={Object.keys(records[0] || { id: '', class_id: '', subject_id: '', teacher_id: '', weekday: '', start_time: '', end_time: '', room: '' }).map((key) => [key, key])} />}
      </div>
    </div>
  </section>;
}

export function EnrollmentsPage() {
  const [records, setRecords] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const canWrite = useCanWrite('enrollments');
  const load = useCallback(async () => {
    setLoading(true);
    try { setRecords(recordsFrom(await http.get('/api/academic/enrollments'))); setError(''); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await http.post('/api/academic/enrollments', values); setValues({}); setMessage('Matrícula criada com sucesso.'); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <section className="page">
    <div className="page-heading"><div><p className="eyebrow">VIDA ESCOLAR</p><h1>Matrículas</h1></div><button className="button button-secondary" type="button" onClick={load}>Atualizar</button></div>
    <ErrorMessage>{error}</ErrorMessage>{message && <div className="alert alert-success">{message}</div>}
    <div className={`content-grid${canWrite ? '' : ' content-grid-single'}`}>
      {canWrite && <form className="panel form-panel" onSubmit={submit}><h2>Nova matrícula</h2>
        {[['studentId', 'ID do aluno'], ['classId', 'ID da turma'], ['enrollmentDate', 'Data da matrícula', 'date']].map(([name, label, type]) => <label className="field" key={name}><span>{label}</span><input required type={type || 'text'} value={values[name] || ''} onChange={(event) => setValues({ ...values, [name]: event.target.value })} /></label>)}
        <button className="button" disabled={busy}>{busy ? 'Salvando…' : 'Matricular aluno'}</button>
      </form>}
      <div className="panel table-panel"><h2>Matrículas registradas</h2>{loading ? <div className="state-message">Carregando matrículas…</div> : <DataTable rows={records} columns={Object.keys(records[0] || { id: '', studentId: '', classId: '', enrollmentDate: '', status: '' }).map((key) => [key, key])} />}</div>
    </div>
  </section>;
}

export function GradesPage() {
  const [enrollments, setEnrollments] = useState([]);
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState({});
  const [editing, setEditing] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const canWrite = useCanWrite('grades');

  const loadEnrollments = useCallback(async () => {
    try {
      const items = recordsFrom(await http.get('/api/academic/enrollments'));
      setEnrollments(items);
      if (!selected && items.length) setSelected(String(items[0].id));
    } catch (requestError) { setError(requestError.message); setLoading(false); }
  }, [selected]);
  useEffect(() => { loadEnrollments(); }, [loadEnrollments]);
  const loadGrades = useCallback(async () => {
    if (!selected) { setRecords([]); setLoading(false); return; }
    setLoading(true);
    try { setRecords(recordsFrom(await http.get(`/api/academic/grades?enrollmentId=${encodeURIComponent(selected)}`))); setError(''); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [selected]);
  useEffect(() => { loadGrades(); }, [loadGrades]);

  const average = useMemo(() => {
    const totals = records.reduce((result, item) => {
      const score = Number(item.value ?? item.grade ?? item.score);
      const weight = Number(item.weight ?? 1);
      if (Number.isFinite(score) && Number.isFinite(weight) && weight > 0) {
        result.weightedScore += score * weight;
        result.weight += weight;
      }
      return result;
    }, { weightedScore: 0, weight: 0 });
    return totals.weight ? (totals.weightedScore / totals.weight).toFixed(2) : '—';
  }, [records]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const payload = { ...values, weight: values.weight ?? 1, enrollmentId: selected };
    try {
      if (editing) await http.put(`/api/academic/grades/${encodeURIComponent(editing)}`, payload);
      else await http.post('/api/academic/grades', payload);
      setValues({}); setEditing(''); setMessage(editing ? 'Nota atualizada.' : 'Nota registrada.');
      await loadGrades();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  function edit(record) {
    setEditing(String(record.id));
    setValues({ value: record.value ?? record.grade ?? record.score ?? '', subject: record.subject ?? '', weight: record.weight ?? 1 });
  }
  async function remove(record) {
    if (!window.confirm('Excluir esta nota?')) return;
    try { await http.delete(`/api/academic/grades/${encodeURIComponent(record.id)}`); setMessage('Nota excluída.'); await loadGrades(); }
    catch (requestError) { setError(requestError.message); }
  }
  return <section className="page">
    <div className="page-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h1>Notas</h1></div><span className="average-badge">Média <strong>{average}</strong></span></div>
    <ErrorMessage>{error}</ErrorMessage>{message && <div className="alert alert-success">{message}</div>}
    <div className="panel selection-panel"><label className="field"><span>Selecione a matrícula</span><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Selecione uma matrícula</option>{enrollments.map((item) => <option value={item.id} key={item.id}>#{item.id} · aluno {item.studentName || item.studentId || item.student_id || '—'} · turma {item.className || item.classId || item.course_id || '—'}</option>)}</select></label></div>
    <div className={`content-grid${canWrite ? '' : ' content-grid-single'}`}>
      {canWrite && <form className="panel form-panel" onSubmit={submit}><h2>{editing ? 'Editar nota' : 'Lançar nota'}</h2>
        <label className="field"><span>Avaliação</span><input value={values.subject || ''} onChange={(event) => setValues({ ...values, subject: event.target.value })} /></label>
        <label className="field"><span>Peso</span><input required type="number" min="0.001" step="0.001" value={values.weight ?? 1} onChange={(event) => setValues({ ...values, weight: event.target.value })} /></label>
        <label className="field"><span>Nota</span><input required type="number" step="0.01" value={values.value ?? ''} onChange={(event) => setValues({ ...values, value: event.target.value })} /></label>
        <div className="form-actions"><button className="button" disabled={busy || !selected}>{busy ? 'Salvando…' : editing ? 'Salvar nota' : 'Registrar nota'}</button>{editing && <button className="button button-quiet" onClick={() => { setEditing(''); setValues({}); }} type="button">Cancelar</button>}</div>
      </form>}
      <div className="panel table-panel"><h2>Notas da matrícula</h2>{loading ? <div className="state-message">Carregando notas…</div> : records.length === 0 ? <div className="state-message">Nenhuma nota cadastrada.</div> : <div className="table-scroll"><table><thead><tr><th>Avaliação</th><th>Nota</th><th>Peso</th>{canWrite && <th>Ações</th>}</tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.subject || '—'}</td><td>{record.value ?? record.grade ?? record.score ?? '—'}</td><td>{record.weight ?? '—'}</td>{canWrite && <td className="row-actions"><button className="text-button" onClick={() => edit(record)} type="button">Editar</button><button className="text-button danger-text" onClick={() => remove(record)} type="button">Excluir</button></td>}</tr>)}</tbody></table></div>}</div>
    </div>
  </section>;
}

export function AttendancePage() {
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const [studentIds, setStudentIds] = useState('');
  const [status, setStatus] = useState('present');
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const canWrite = useCanWrite('attendance');
  async function loadSummary(event) {
    event?.preventDefault();
    if (!classId) return;
    setError('');
    try {
      setSummary(await http.get(`/api/academic/attendance/summary?classId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`));
    } catch (requestError) { setError(requestError.message); }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const ids = studentIds.split(/[,\s]+/).map((id) => id.trim()).filter(Boolean);
    try {
      await http.post('/api/academic/attendance', { classId, date, records: ids.map((studentId) => ({ studentId, status })) });
      setMessage(`${ids.length} registro(s) de frequência enviado(s).`);
      await loadSummary();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <section className="page">
    <div className="page-heading"><div><p className="eyebrow">PRESENÇA E PARTICIPAÇÃO</p><h1>Frequência</h1></div></div>
    <ErrorMessage>{error}</ErrorMessage>{message && <div className="alert alert-success">{message}</div>}
    <div className={`content-grid${canWrite ? '' : ' content-grid-single'}`}>
      {canWrite && <form className="panel form-panel" onSubmit={submit}><h2>Registro em lote</h2>
        <label className="field"><span>ID da turma</span><input required value={classId} onChange={(event) => setClassId(event.target.value)} /></label>
        <label className="field"><span>Data</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="field"><span>IDs dos alunos (separados por vírgula ou espaço)</span><textarea required rows="3" value={studentIds} onChange={(event) => setStudentIds(event.target.value)} /></label>
        <label className="field"><span>Registro</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="present">Presente</option><option value="absent">Ausente</option><option value="justified">Falta justificada</option></select></label>
        <button className="button" disabled={busy}>{busy ? 'Enviando…' : 'Registrar frequência'}</button>
      </form>}
      <div className="panel table-panel"><div className="table-heading"><h2>Resumo de frequência</h2>{!canWrite && <><input className="search" placeholder="ID da turma" value={classId} onChange={(event) => setClassId(event.target.value)} /><input className="search" type="date" aria-label="Data" value={date} onChange={(event) => setDate(event.target.value)} /></>}<button className="button button-secondary" type="button" onClick={loadSummary}>Consultar</button></div>
        {!summary ? <div className="state-message">Informe a turma e consulte para ver o resumo diário.</div> : typeof summary === 'object' && !Array.isArray(summary) ? <div className="summary-grid">{Object.entries(summary).map(([key, value]) => <div className="summary-item" key={key}><span>{key}</span><strong>{String(value)}</strong></div>)}</div> : <DataTable rows={recordsFrom(summary)} columns={Object.keys(recordsFrom(summary)[0] || {}).map((key) => [key, key])} /> }
      </div>
    </div>
  </section>;
}

export function NotificationsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { setRecords(recordsFrom(await http.get('/api/notifications'))); setError(''); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  const { connected, latest, markSeen } = useNotifications();
  useEffect(() => { load(); }, [load, connected]);
  const newest = latest[0]?.event_id;
  useEffect(() => { markSeen(); }, [markSeen, newest]);
  const merged = useMemo(() => {
    const known = new Set(records.map((item) => item.event_id));
    return [...latest.filter((item) => !known.has(item.event_id)), ...records];
  }, [latest, records]);
  return <section className="page">
    <div className="page-heading"><div><p className="eyebrow">COMUNICAÇÃO</p><h1>Notificações</h1></div><span className={`status-pill ${connected ? 'status-ok' : 'status-down'}`}>{connected ? 'Ao vivo' : 'Reconectando…'}</span></div>
    <ErrorMessage>{error}</ErrorMessage>
    <div className="panel table-panel"><h2>Eventos recebidos</h2>
      {loading ? <div className="state-message">Carregando…</div> : merged.length === 0 ? <div className="state-message">Nenhuma notificação recebida.</div> : <div className="notification-list">{merged.map((item) => <article className="notification-item" key={item.event_id}><div><h3>{item.type || 'Notificação'}</h3><p>{item.message}</p><small>{item.occurred_at || item.received_at || ''}</small></div></article>)}</div>}
    </div>
  </section>;
}
