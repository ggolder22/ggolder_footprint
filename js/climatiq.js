// Cliente de Climatiq a través del proxy /api/climatiq (nunca llama directo para no exponer la key).
window.Climatiq = (function () {
  let settings = { apiBase: '/api/climatiq', apiKey: '', accessCode: '', dataVersion: '^39', calculationMethod: 'ar6' };

  function configure(s) { settings = { ...settings, ...s }; }

  async function call(path, { method = 'GET', query = {}, body } = {}) {
    if (location.protocol === 'file:') {
      throw new Error('La API necesita un servidor: ejecuta "npx vercel dev" o usa el sitio desplegado en Vercel. Mientras tanto puedes usar factores manuales.');
    }
    const url = new URL(settings.apiBase, location.origin);
    url.searchParams.set('path', path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['x-climatiq-key'] = settings.apiKey;
    if (settings.accessCode) headers['x-app-code'] = settings.accessCode;

    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error('No se pudo conectar con el proxy /api/climatiq. ¿Estás en Vercel o en "vercel dev"?');
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
    if (!res.ok) {
      if (res.status === 404 && !data.error) throw new Error('No existe /api/climatiq en este servidor. Usa "npx vercel dev" o despliega en Vercel.');
      throw new Error(data.message || data.error || `Error HTTP ${res.status}`);
    }
    return data;
  }

  function search(params) {
    return call('data/v1/search', {
      query: { data_version: settings.dataVersion, results_per_page: 25, ...params },
    });
  }

  // bodies: [{ emission_factor, parameters }] — se divide en lotes de 100
  async function estimateBatch(bodies) {
    const out = [];
    for (let i = 0; i < bodies.length; i += 100) {
      const chunk = bodies.slice(i, i + 100);
      const data = await call('data/v1/estimate/batch', { method: 'POST', body: chunk });
      out.push(...(data.results || []));
    }
    return out;
  }

  async function electricityBatch(bodies) {
    const out = [];
    for (let i = 0; i < bodies.length; i += 100) {
      const chunk = bodies.slice(i, i + 100);
      const data = await call('energy/v1.5/electricity/batch', { method: 'POST', body: chunk });
      out.push(...(data.results || []));
    }
    return out;
  }

  return { configure, call, search, estimateBatch, electricityBatch, get settings() { return settings; } };
})();
