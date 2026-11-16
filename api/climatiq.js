// Proxy serverless (Vercel) hacia la API de Climatiq.
// 1) Verifica la sesión de Supabase del usuario (Authorization: Bearer <access_token>).
// 2) Lee la API key de Climatiq de ESE usuario con la service role (nunca llega al navegador).
// 3) Reenvía la llamada solo a las rutas permitidas.
//
// Variables de entorno (Vercel > Settings > Environment Variables):
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (sb_publishable_…), SUPABASE_SECRET_KEY (sb_secret_…)
//   Se aceptan también los nombres anteriores SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.

const env = () => ({
  url: process.env.SUPABASE_URL,
  publishable: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
  secret: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
});
// Las claves nuevas (sb_…) no son JWT: van solo en el header apikey. Las antiguas también se mandan como Bearer.
const keyHeaders = (key) => (String(key).startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` });

const ROUTES = {
  'data/v1/search': 'GET',
  'data/v1/estimate': 'POST',
  'data/v1/estimate/batch': 'POST',
  'energy/v1.5/electricity': 'POST',
  'energy/v1.5/electricity/batch': 'POST',
  'energy/v1.5/electricity/suppliers': 'GET',
};

async function getUser(token) {
  const { url, publishable } = env();
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: publishable, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}

async function getClimatiqKey(userId) {
  const { url, secret } = env();
  const r = await fetch(`${url}/rest/v1/api_keys?user_id=eq.${encodeURIComponent(userId)}&select=climatiq_key`, { headers: keyHeaders(secret) });
  if (!r.ok) throw new Error(`No se pudo leer la API key (${r.status})`);
  const rows = await r.json();
  return rows[0] ? rows[0].climatiq_key : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cfg = env();
  if (!cfg.url || !cfg.publishable || !cfg.secret) {
    return res.status(500).json({ error: 'config', message: 'Faltan variables en Vercel: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY o SUPABASE_SECRET_KEY.' });
  }

  const query = { ...(req.query || {}) };
  const path = String(query.path || '');
  delete query.path;
  const method = ROUTES[path];
  if (!method) return res.status(400).json({ error: 'bad_request', message: `Ruta no permitida: ${path}` });
  if (req.method !== method) return res.status(405).json({ error: 'method_not_allowed', message: `Usá ${method} para ${path}` });

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'unauthorized', message: 'Sesión no iniciada.' });

  let key;
  try {
    const user = await getUser(token);
    if (!user || !user.id) return res.status(401).json({ error: 'unauthorized', message: 'La sesión expiró. Volvé a ingresar.' });
    key = await getClimatiqKey(user.id);
  } catch (err) {
    return res.status(502).json({ error: 'auth_error', message: err.message });
  }
  if (!key) {
    return res.status(400).json({ error: 'missing_key', message: 'No cargaste tu API key de Climatiq. Andá a Mi cuenta para configurarla.' });
  }

  const url = new URL(`https://api.climatiq.io/${path}`);
  if (method === 'GET') {
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  try {
    const upstream = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: method === 'POST' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) : undefined,
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: 'upstream_error', message: `No se pudo contactar a Climatiq: ${err.message}` });
  }
};
