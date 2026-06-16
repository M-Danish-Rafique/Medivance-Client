import axios from 'axios';

const baseURL =
  process.env.REACT_APP_API_URL?.trim() ||
  (process.env.NODE_ENV === 'production' ? '' : '/api');

if (process.env.NODE_ENV === 'production' && !process.env.REACT_APP_API_URL?.trim()) {
  console.warn(
    'REACT_APP_API_URL is not set. API calls will fail in production. ' +
    'Set it in Vercel to your Railway backend URL, e.g. https://your-app.up.railway.app/api'
  );
}

const api = axios.create({
  baseURL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('medivance_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      localStorage.removeItem('medivance_token');
      localStorage.removeItem('medivance_user');
      localStorage.removeItem('medivance_perms');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
