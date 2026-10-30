import { LOGIN_URL } from '../config/constants';
import { maybeDecrypt } from './fhir';

export async function doLogin(email, password) {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 400) throw new Error('Invalid credentials. Please try again.');
    throw new Error(`Login failed (${res.status}). Please try again.`);
  }

  const raw = await res.json();
  const data = await maybeDecrypt(raw);
  const token = data.idToken || data.token || data.access_token;
  if (!token) throw new Error('Login failed: no token received.');

  const name = data.displayName || data.name || email.split('@')[0];
  localStorage.setItem('cb_token', token);
  localStorage.setItem('cb_user', name);
  localStorage.setItem('cb_email', email);
  localStorage.setItem('cb_login_ts', Date.now().toString());
  return name;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export function isSessionExpired() {
  const ts = localStorage.getItem('cb_login_ts');
  if (!ts) return true;
  return Date.now() - parseInt(ts, 10) > SESSION_TIMEOUT_MS;
}

export function clearSession() {
  localStorage.removeItem('cb_token');
  localStorage.removeItem('cb_user');
  localStorage.removeItem('cb_email');
  localStorage.removeItem('cb_login_ts');
}

export function getTimeUntilExpiry() {
  const ts = localStorage.getItem('cb_login_ts');
  if (!ts) return 0;
  const remaining = SESSION_TIMEOUT_MS - (Date.now() - parseInt(ts, 10));
  return Math.max(remaining, 0);
}
