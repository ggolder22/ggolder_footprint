// Proxy serverless para Vercel: protege la API key de Climatiq.
// La key vive en la variable de entorno CLIMATIQ_API_KEY (Vercel > Settings > Environment Variables).
// Opcional: APP_ACCESS_CODE exige que el navegador envíe el header x-app-code con ese valor,
// para que terceros no consuman tu cuota usando tu despliegue.

const ROUTES = {
  'data/v1/search': 'GET',
  'data/v1/estimate': 'POST',
  'data/v1/estimate/batch': 'POST',
  'energy/v1.5/electricity': 'POST',
  'energy/v1.5/electricity/batch': 'POST',
  'energy/v1.5/electricity/suppliers': 'GET',
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const query = { ...(req.query || {}) };
  const path = String(query.path || '');
  delete query.path;

  const method = ROUTES[path];
  if (!method) {
    return res.status(400).json({ error: 'bad_request', message: `Ruta no permitida: ${path}` });
  }
  if (req.method !== method) {
    return res.status(405).json({ error: 'method_not_allowed', message: `Usa ${method} para ${path}` });
  }

  const accessCode = process.env.APP_ACCESS_CODE;
  if (accessCode && req.headers['x-app-code'] !== accessCode) {
    return res.status(401).json({ error: 'unauthorized', message: 'Código de acceso inválido. Configúralo en Ajustes.' });
  }

  const key = process.env.CLIMATIQ_API_KEY || req.headers['x-climatiq-key'];
  if (!key) {
    return res.status(500).json({
      error: 'missing_key',
      message: 'Falta la API key: define CLIMATIQ_API_KEY en Vercel o ingresa tu key en Ajustes.',
    });
  }

  const url = new URL(`https://api.climatiq.io/${path}`);
  if (method === 'GET') {
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }

  try {
    let body;
    if (method === 'POST') {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    }
    const upstream = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: 'upstream_error', message: `No se pudo contactar a Climatiq: ${err.message}` });
  }
};
