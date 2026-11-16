// Capa de datos sobre Supabase (auth + tablas). Todas las consultas quedan filtradas por RLS.
window.DB = (function () {
  'use strict';
  let sb = null;
  let config = null;

  async function init() {
    const res = await fetch('/api/config', { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) {
      let msg = 'No se pudo leer /api/config.';
      try { const j = await res.json(); msg = j.message || msg; } catch { /* sin cuerpo */ }
      throw new Error(msg);
    }
    config = await res.json();
    if (!window.supabase || !window.supabase.createClient) throw new Error('No se pudo cargar la librería de Supabase.');
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return sb;
  }

  const unwrap = ({ data, error }) => { if (error) throw new Error(translate(error.message)); return data; };
  function translate(msg) {
    const m = String(msg || '');
    if (/Invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
    if (/Email not confirmed/i.test(m)) return 'Todavía no confirmaste tu email. Revisá tu casilla de correo.';
    if (/User already registered/i.test(m)) return 'Ya existe una cuenta con ese email.';
    if (/Password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
    if (/duplicate key.*factors_client_id_code/i.test(m)) return 'Ya existe un factor con ese código en este cliente.';
    if (/rate limit/i.test(m)) return 'Demasiados intentos. Esperá unos minutos.';
    return m;
  }

  // ---------------- Auth ----------------
  const auth = {
    async session() { return unwrap(await sb.auth.getSession()).session; },
    async signIn(email, password) { return unwrap(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, meta) {
      return unwrap(await sb.auth.signUp({ email, password, options: { data: meta, emailRedirectTo: location.origin + '/' } }));
    },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { return unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/#/nueva-clave' })); },
    async updatePassword(password) { return unwrap(await sb.auth.updateUser({ password })); },
    onChange(cb) { return sb.auth.onAuthStateChange(cb); },
    async token() { const s = await auth.session(); return s ? s.access_token : null; },
  };

  // ---------------- Perfil y API key ----------------
  const profile = {
    async get() { const s = await auth.session(); return unwrap(await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle()); },
    async update(p) { const s = await auth.session(); return unwrap(await sb.from('profiles').upsert({ id: s.user.id, ...p }).select().single()); },
    async keyStatus() { const rows = unwrap(await sb.rpc('climatiq_key_status')); return rows && rows[0] ? rows[0] : { has_key: false }; },
    async setKey(key) { return unwrap(await sb.rpc('set_climatiq_key', { p_key: key })); },
    async deleteKey() { return unwrap(await sb.rpc('delete_climatiq_key')); },
  };

  // ---------------- Clientes ----------------
  const clients = {
    async list() { return unwrap(await sb.from('clients').select('*, footprints(id, type, status)').order('name')); },
    async get(id) { return unwrap(await sb.from('clients').select('*').eq('id', id).single()); },
    async create(c) { return unwrap(await sb.from('clients').insert(c).select().single()); },
    async update(id, c) { return unwrap(await sb.from('clients').update(c).eq('id', id).select().single()); },
    async remove(id) { return unwrap(await sb.from('clients').delete().eq('id', id)); },
  };

  // ---------------- Biblioteca de factores ----------------
  const factors = {
    async list(clientId) { return unwrap(await sb.from('factors').select('*').eq('client_id', clientId).order('code')); },
    async create(f) { return unwrap(await sb.from('factors').insert(f).select().single()); },
    async update(id, f) { return unwrap(await sb.from('factors').update(f).eq('id', id).select().single()); },
    async remove(id) { return unwrap(await sb.from('factors').delete().eq('id', id)); },
    async bulkInsert(rows) { return unwrap(await sb.from('factors').insert(rows).select()); },
  };

  // ---------------- Huellas ----------------
  const footprints = {
    async list(clientId) { return unwrap(await sb.from('footprints').select('id, client_id, type, name, period_year, status, completeness, total_kg, created_at, updated_at').eq('client_id', clientId).order('updated_at', { ascending: false })); },
    async get(id) { return unwrap(await sb.from('footprints').select('*').eq('id', id).single()); },
    async create(f) { return unwrap(await sb.from('footprints').insert(f).select().single()); },
    async update(id, f) { return unwrap(await sb.from('footprints').update(f).eq('id', id).select('id, status, updated_at').single()); },
    async remove(id) { return unwrap(await sb.from('footprints').delete().eq('id', id)); },
    async versions(id) { return unwrap(await sb.from('footprint_versions').select('id, version, note, totals, created_at').eq('footprint_id', id).order('version', { ascending: false })); },
    async addVersion(v) { return unwrap(await sb.from('footprint_versions').insert(v).select().single()); },
    async getVersion(id) { return unwrap(await sb.from('footprint_versions').select('*').eq('id', id).single()); },
  };

  // ---------------- Auditoría ----------------
  const audit = {
    async log(entry) {
      try { await sb.from('audit_log').insert(entry); } catch (e) { console.warn('audit', e); }
    },
    async list({ clientId, footprintId, limit = 200 } = {}) {
      let q = sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
      if (footprintId) q = q.eq('footprint_id', footprintId);
      else if (clientId) q = q.eq('client_id', clientId);
      return unwrap(await q);
    },
  };

  return { init, auth, profile, clients, factors, footprints, audit, get client() { return sb; } };
})();
