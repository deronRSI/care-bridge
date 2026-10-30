import { FHIR_BASE } from '../config/constants';

const DECRYPT_KEY_B64 = import.meta.env.VITE_DECRYPT_KEY || '';

function b64ToUint8(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

let _cryptoKey = null;
async function getCryptoKey() {
  if (_cryptoKey) return _cryptoKey;
  if (!DECRYPT_KEY_B64) return null;
  const raw = b64ToUint8(DECRYPT_KEY_B64);
  _cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  return _cryptoKey;
}

export async function decryptPayload(payloadB64) {
  const key = await getCryptoKey();
  if (!key) throw new Error('No decryption key configured');
  const data = b64ToUint8(payloadB64);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export async function maybeDecrypt(json) {
  if (json && json.encrypted === true && typeof json.payload === 'string') {
    return await decryptPayload(json.payload);
  }
  return json;
}

export function getAuthHeader() {
  const token = localStorage.getItem('cb_token');
  if (!token) {
    window.location.reload();
    throw new Error('No auth token');
  }
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function callFhirApi(url) {
  const res = await fetch(url, { headers: getAuthHeader() });
  if (res.status === 401) {
    localStorage.removeItem('cb_token');
    localStorage.removeItem('cb_user');
    window.location.reload();
    throw new Error('Unauthorized');
  }
  const json = await res.json();
  return maybeDecrypt(json);
}

export function buildUrl(path, params) {
  const url = new URL(`${FHIR_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.append(k, v);
    }
  });
  return url.toString();
}
