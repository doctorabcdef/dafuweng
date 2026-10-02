export const STORAGE_KEY = 'dafuweng:v1';
export function readStored(storage, key, fallback = null) {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
export function writeStored(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function newRoomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
export function parseRoom(hash) {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('room');
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function checkCloudConfig(config) {
  if (!config?.supabaseUrl || !config?.supabaseKey) throw new Error('请先配置云端项目地址和公开密钥。');
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('云端地址必须是 HTTPS 项目地址。');
  const key = config.supabaseKey.trim();
  if (key.startsWith('sb_secret_')) throw new Error('不能使用 secret key，请填写 publishable key 或 anon key。');
  if (!key.startsWith('sb_publishable_')) {
    try {
      const role = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
      if (role !== 'anon') throw new Error('wrong_role');
    } catch { throw new Error('请填写公开 publishable key 或 anon key，不能使用 service_role 密钥。'); }
  }
  return { supabaseUrl: url.origin + url.pathname.replace(/\/+$/, ''), supabaseKey: key };
}
export class CloudStore {
  constructor(config, request = (...args) => globalThis.fetch(...args)) { this.config = checkCloudConfig(config); this.request = request; }
  async rpc(name, args) {
    const { supabaseUrl, supabaseKey } = this.config;
    const headers = { apikey: supabaseKey, 'Content-Type': 'application/json' };
    // New publishable keys aren't JWTs and must not be sent as Bearer tokens.
    if (!supabaseKey.startsWith('sb_publishable_')) headers.Authorization = 'Bearer ' + supabaseKey;
    const response = await this.request(supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10000), cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.message || '云端请求失败');
      error.code = body.code; throw error;
    }
    return body;
  }
  create(token, state) { return this.rpc('create_game', { p_token: token, p_state: state }); }
  read(token) { return this.rpc('read_game', { p_token: token }); }
  save(token, revision, state) { return this.rpc('save_game', { p_token: token, p_expected_revision: revision, p_state: state }); }
}
