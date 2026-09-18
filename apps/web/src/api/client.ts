import axios from 'axios';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const csrf = readCookie('csrf');
    if (csrf) config.headers['x-csrf-token'] = csrf;
  }
  return config;
});

// Public routes a logged-out visitor is allowed to sit on. A 401 here (e.g. the
// AuthProvider's `/auth/me` probe finding no session) must NOT bounce them to
// /login — otherwise invite/signup links are unusable.
const PUBLIC_ROUTE = /^\/(login|signup|invite)(\/|$)/;

apiClient.interceptors.response.use(
  (r) => r,
  (error) => {
    // Axios's own `error.message` is always the useless "Request failed with
    // status code N". Every call site reads `(err as Error).message` to build a
    // banner, so the server's actual explanation ("ClickUp rejected the request
    // (HTTP 400): Webhook endpoint unreachable") was being thrown away at the
    // one place the operator would have read it. Promote it here, once.
    const serverMessage = error.response?.data?.message;
    if (typeof serverMessage === 'string' && serverMessage) error.message = serverMessage;
    else if (Array.isArray(serverMessage) && serverMessage.length) error.message = serverMessage.join('; ');

    const url: string = error.config?.url ?? '';
    // `/auth/me` is an auth *probe*: a 401 just means "not logged in" and is
    // handled by AuthProvider's catch. Never hard-redirect on it.
    const isAuthProbe = url.includes('/auth/me');
    if (
      error.response?.status === 401 &&
      !isAuthProbe &&
      !PUBLIC_ROUTE.test(location.pathname)
    ) {
      location.href = '/login';
    }
    return Promise.reject(error);
  },
);
