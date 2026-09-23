/* Client for the SmallTV Pro theme API. No DOM access.
 *
 * Two transports:
 *  - "relay":  through serve.py, which can read the device's answers (recommended).
 *  - "direct": straight from the page. The firmware sends no CORS headers, so the answers are
 *              unreadable ("opaque"). Only requests the browser treats as simple can be sent.
 */
export type Transport = 'relay' | 'direct';
export interface Auth { user: string; pass: string }
export interface DeviceStatus { variant?: string; version?: string }
export interface InstalledTheme { id: string; valid?: boolean }
export interface ThemeList { themes?: InstalledTheme[]; freeBytes?: number; selected?: string }

const GUARD = { 'X-SmallTV-Studio': '1' };
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(:\d{1,5})?$/;
let transportPromise: Promise<Transport> | null = null;

/* Accepts "192.168.1.42", "http://192.168.1.42/", "smalltv.local:80". Returns '' when unusable. */
export function cleanHost(text: string): string {
  const host = String(text || '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
  return HOST_RE.test(host) ? host : '';
}
export function transport(): Promise<Transport> {
  transportPromise ??= (async () => {
    if (!/^https?:$/.test(location.protocol)) return 'direct';
    try {
      const response = await fetch('/__device/ping', { headers: GUARD, cache: 'no-store' });
      return response.ok && (await response.json()).relay === true ? 'relay' : 'direct';
    } catch { return 'direct'; }
  })();
  return transportPromise;
}
export class DeviceError extends Error {
  status: number;
  auth: boolean;
  constructor(message: string, { status = 0, auth = false } = {}) { super(message); this.status = status; this.auth = auth; }
}

interface CallOptions { body?: BodyInit; type?: string; auth?: Auth | null }
async function relay<T>(host: string, method: string, path: string, { body, type, auth }: CallOptions): Promise<T> {
  const headers: Record<string, string> = { ...GUARD };
  if (type) headers['Content-Type'] = type;
  if (auth) { headers['X-Device-User'] = auth.user; headers['X-Device-Pass'] = auth.pass; }
  let response: Response;
  try { response = await fetch('/__device/' + host + path, { method, headers, body, cache: 'no-store' }); }
  catch { throw new DeviceError('The editor server stopped answering. Restart serve.py.'); }
  const text = await response.text();
  let json: (T & { error?: string }) | null = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!response.ok) throw new DeviceError(json?.error || text || 'HTTP ' + response.status, { status: response.status, auth: response.status === 401 });
  return json as T;
}
/* Direct mode can send but never read. Resolves with null once the browser has sent the request. */
async function direct(host: string, method: string, path: string, { body, type }: CallOptions): Promise<null> {
  if (location.protocol === 'https:') throw new DeviceError('This page is served over HTTPS, so the browser blocks requests to the TV (plain HTTP). Open the editor from serve.py instead.');
  try { await fetch('http://' + host + path, { method, mode: 'no-cors', body, headers: type ? { 'Content-Type': type } : undefined, cache: 'no-store' }); }
  catch { throw new DeviceError('The browser could not reach ' + host + '. Check the address and that the TV is on the same network.'); }
  return null;
}
async function call<T>(host: string, method: string, path: string, options: CallOptions = {}): Promise<T | null> {
  return (await transport()) === 'relay' ? relay<T>(host, method, path, options) : direct(host, method, path, options);
}

export const status = (host: string, auth: Auth | null) => call<DeviceStatus>(host, 'GET', '/api/status', { auth });
export const list = (host: string, auth: Auth | null) => call<ThemeList>(host, 'GET', '/api/themes', { auth });
export function install(host: string, bytes: Uint8Array<ArrayBuffer>, id: string, auth: Auth | null) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), id + '.stheme');
  return call(host, 'POST', '/api/themes/install', { body: form, auth });
}
/* text/plain keeps the request "simple" so direct mode needs no CORS preflight; the firmware reads the raw body either way. */
const post = (host: string, path: string, id: string, auth: Auth | null) => call(host, 'POST', path, { body: JSON.stringify({ id }), type: 'text/plain', auth });
export const select = (host: string, id: string, auth: Auth | null) => post(host, '/api/themes/select', id, auth);
export const remove = (host: string, id: string, auth: Auth | null) => post(host, '/api/themes/delete', id, auth);
