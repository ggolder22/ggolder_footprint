// Cliente de Climatiq a través del proxy /api/climatiq. El proxy usa la API key del usuario logueado.
window.Climatiq = (function () {
  let settings = { apiBase: '/api/climatiq', dataVersion: '^39', calculationMethod: 'ar6' };
  let tokenProvider = async () => null;

  function configure(s) { settings = { ...settings, ...s }; }
  function setTokenProvider(fn) { tokenProvider = fn; }

  async function call(path, { method = 'GET', query = {}, body } = {}) {
    const url = new URL(settings.apiBase, location.origin);
    url.searchParams.set('path', path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    const headers = { 'Content-Type': 'application/json' };
    const token = await tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor (/api/climatiq).');
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
    if (!res.ok) throw new Error(data.message || data.error || `Error HTTP ${res.status}`);
    return data;
  }

  function search(params) {
    return call('data/v1/search', { query: { data_version: settings.dataVersion, results_per_page: 25, ...params } });
  }

  async function batched(path, bodies) {
    const out = [];
    for (let i = 0; i < bodies.length; i += 100) {
      const data = await call(path, { method: 'POST', body: bodies.slice(i, i + 100) });
      out.push(...(data.results || []));
    }
    return out;
  }

  return {
    configure, setTokenProvider, call, search,
    estimateBatch: (b) => batched('data/v1/estimate/batch', b),
    electricityBatch: (b) => batched('energy/v1.5/electricity/batch', b),
    get settings() { return settings; },
  };
})();
