import { useCallback, useEffect, useMemo, useState } from 'react';
import { http } from '../api/client';

function display(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function CrudPage({ title, endpoint, fields, columns, search = true, extraQuery = '', canEdit = true, canDelete = canEdit, rowActions = canEdit }) {
  const [records, setRecords] = useState([]);
  const [values, setValues] = useState({});
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fieldList = fields.filter((field) => !field.adminOnly || canEdit);
  const encodedQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (filter) params.set('type', filter);
    if (extraQuery) new URLSearchParams(extraQuery).forEach((value, key) => params.set(key, value));
    const suffix = params.toString();
    return suffix ? `?${suffix}` : '';
  }, [query, filter, extraQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await http.get(`${endpoint}${encodedQuery}`);
      setRecords(Array.isArray(result) ? result : result?.items || result?.data || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, encodedQuery]);

  useEffect(() => { load(); }, [load]);

  function startCreate() {
    setEditing(null);
    setValues({});
    setError('');
  }

  function startEdit(record) {
    setEditing(record.id);
    setValues(Object.fromEntries(fieldList.map((field) => [
      field.name,
      record[field.name] === null || record[field.name] === undefined
        ? ''
        : field.valueType === 'boolean' || field.type === 'number'
          ? String(record[field.name])
          : record[field.name],
    ])));
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { ...values };
      for (const field of fieldList) {
        const value = payload[field.name];
        if (value === undefined || value === '') {
          if (field.valueType === 'boolean') delete payload[field.name];
          continue;
        }
        if (field.type === 'number') payload[field.name] = Number(value);
        if (field.valueType === 'boolean') payload[field.name] = value === 'true';
      }
      if (editing !== null && !payload.password) delete payload.password;
      if (editing !== null) await http.put(`${endpoint}/${encodeURIComponent(editing)}`, payload);
      else await http.post(endpoint, payload);
      startCreate();
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(record) {
    if (!window.confirm(`Excluir ${record.name || record.title || record.id}?`)) return;
    setError('');
    try {
      await http.delete(`${endpoint}/${encodeURIComponent(record.id)}`);
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const visibleColumns = columns || ['id', ...fieldList.slice(0, 3).map((field) => field.name)];
  return (
    <section className="page">
      <div className="page-heading">
        <div><p className="eyebrow">GESTÃO ESCOLAR</p><h1>{title}</h1></div>
        <button className="button button-secondary" onClick={load} type="button">Atualizar</button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="content-grid">
        {canEdit && <form className="panel form-panel" onSubmit={submit}>
          <h2>{editing !== null ? 'Editar registro' : 'Novo registro'}</h2>
          {fieldList.map((field) => (
            <label className="field" key={field.name}>
              <span>{field.label}</span>
              {field.options ? <select required={field.required} value={values[field.name] ?? ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}>
                <option value="">Selecione</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select> : <input
                type={field.type || 'text'}
                required={field.required && !(editing !== null && field.name === 'password')}
                placeholder={field.placeholder || ''}
                value={values[field.name] ?? ''}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              />}
            </label>
          ))}
          <div className="form-actions">
            <button className="button" disabled={busy} type="submit">{busy ? 'Salvando…' : editing !== null ? 'Salvar alterações' : 'Cadastrar'}</button>
            {editing !== null && <button className="button button-quiet" onClick={startCreate} type="button">Cancelar</button>}
          </div>
        </form>}
        <div className="panel table-panel">
          <div className="table-heading">
            <h2>Registros</h2>
            {search && <input className="search" aria-label="Buscar" placeholder="Buscar…" value={query} onChange={(event) => setQuery(event.target.value)} />}
          </div>
          {fields.some((field) => field.filterOptions) && <label className="field filter-field">
            <span>Filtrar por tipo</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="">Todos</option>{fields.find((field) => field.filterOptions).filterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>}
          {loading ? <div className="state-message">Carregando registros…</div> : records.length === 0 ? <div className="state-message">Nenhum registro encontrado.</div> : (
            <div className="table-scroll"><table><thead><tr>{visibleColumns.map((column) => <th key={column}>{column === 'id' ? 'ID' : fieldList.find((field) => field.name === column)?.label || column}</th>)}{rowActions && <th>Ações</th>}</tr></thead>
              <tbody>{records.map((record, index) => <tr key={record.id ?? index}>
                {visibleColumns.map((column) => <td key={column}>{display(record[column])}</td>)}
                {rowActions && <td className="row-actions"><button className="text-button" onClick={() => startEdit(record)} type="button">Editar</button>{canDelete && <button className="text-button danger-text" onClick={() => remove(record)} type="button">Excluir</button>}</td>}
              </tr>)}</tbody></table></div>
          )}
        </div>
      </div>
    </section>
  );
}
