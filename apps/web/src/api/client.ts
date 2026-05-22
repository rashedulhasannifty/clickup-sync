import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const key = localStorage.getItem('adminApiKey') ?? (import.meta.env.VITE_ADMIN_API_KEY as string) ?? '';
  if (key) config.headers['x-admin-key'] = key;
  const userName = localStorage.getItem('adminUserName')?.trim() ?? '';
  if (userName) config.headers['x-admin-user'] = userName;
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('adminApiKey');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
