const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
const TOKEN_KEY = 'school_access_token';

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let response;
  try {
    response = await fetch(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`, {
      ...options,
      headers,
      body: options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
    });
  } catch {
    throw new ApiError('Não foi possível conectar à API. Verifique se o servidor está disponível.', 0);
  }

  if (response.status === 401) {
    window.dispatchEvent(new Event('school:unauthorized'));
  }

  const raw = response.status === 204 ? '' : await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || (response.status === 409
      ? 'Conflito: o registro informado não pode ser criado neste horário.'
      : `Falha na solicitação (${response.status}).`);
    throw new ApiError(message, response.status, data);
  }
  return data;
}

export const http = {
  get: (path) => api(path),
  post: (path, body) => api(path, { method: 'POST', body }),
  put: (path, body) => api(path, { method: 'PUT', body }),
  delete: (path) => api(path, { method: 'DELETE' }),
};

export { API_URL, TOKEN_KEY };
