(function () {
  'use strict';
  const S = window.STD, Un = window.Units, C = window.Calc, API = window.Climatiq, R = window.Report;
  const SETTINGS_KEY = 'huella.settings.v2';

  // ============================================================
  // Utilidades
  // ============================================================
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmtT = (kg, d = 2) => (num(kg) / 1000).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtK = (kg, d = 2) => num(kg).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtN = (n, d = 2) => num(n).toLocaleString('es-AR', { maximumFractionDigits: d });
  const fmtDate = (s) => (s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
  const storage = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };
  const slug = (s) => String(s || 'huella').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast' + (isError ? ' error' : ''); }, isError ? 7000 : 3000);
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ============================================================
  // Estado
  // ============================================================
  let settings = { dataVersion: '^39', calculationMethod: 'ar6', theme: 'auto', ...(storage.get(SETTINGS_KEY) || {}) };
  API.configure(settings);
  API.setTokenProvider(() => DB.auth.token());

  const state = {
    ready: false, configError: null, session: null, profile: null, keyStatus: null,
    clients: null, client: null, lib: [], footprints: [], audit: [],
    fp: null,        // fila de la huella abierta (sin data)
    versions: [],
  };
  let project = null; // data de la huella abierta
  const ui = { open: {}, search: null, modal: null, form: {}, busy: false, wordBusy: false, navOpen: false, clientFilter: '', groupFilter: '', authMsg: null, saveStatus: '' };

  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }
  applyTheme();

  // ============================================================
  // Modelo de datos de una huella
  // ============================================================
  function defaultCategories() {
    const c = {};
    S.CATEGORIES.forEach((cat) => { c[cat.id] = { status: cat.scope === 3 ? 'pending' : 'included', criteria: {}, justification: '' }; });
    return c;
  }
  function newProjectData(type, year, extra = {}) {
    const y = Number(year) || new Date().getFullYear() - 1;
    const p = {
      version: 2, type,
      purpose: { objective: '', users: '', intendedUse: '', verification: 'none', verifier: '', responsible: '', responsibleRole: '', principles: {} },
      period: { year: y, start: `${y}-01-01`, end: `${y}-12-31` },
      groups: [], sources: [], settings: { scope2Totals: 'location', defaultMethod: 'library' },
    };
    if (type === 'organizacion') {
      Object.assign(p, {
        consolidation: 'operational',
        boundaries: { categories: defaultCategories(), materiality: 5 },
        baseYear: { year: y, justification: 'Primer año con datos completos y verificables.', threshold: 5,
          policy: 'El año base se recalculará ante cambios estructurales (fusiones, adquisiciones, desinversiones, tercerización), cambios de metodología o de factores de emisión, o errores, cuando su efecto acumulado supere el umbral de significancia.' },
      });
      p.groups.push({ id: uid(), name: 'Sede principal', type: 'office', region: 'AR', address: '', province: '', equity: 100, control: true });
    }
    if (type === 'evento') {
      p.event = { name: extra.name || '', venue: '', city: '', startDate: '', endDate: '', attendees: '', temporalLimit: 'Desde el inicio del montaje hasta la finalización del desmontaje.', spatialLimit: '', exclusions: '' };
      p.groups = S.FOOTPRINT_TYPES.evento.defaultGroups.map((n) => ({ id: uid(), name: n, description: '' }));
      p.scenarios = [];
      p.iso20121 = S.ISO20121_DEFAULT.map((a) => ({ id: uid(), ...a, status: '', improvement: '' }));
    }
    if (type === 'producto') {
      p.product = { name: extra.name || '', declaredUnit: '', lotSize: '', boundary: 'cuna-puerta', allocationRule: '', exclusions: '' };
      p.groups = S.FOOTPRINT_TYPES.producto.defaultGroups.map((n) => ({ id: uid(), name: n, description: '' }));
      p.sensitivity = [];
    }
    return p;
  }
  function newSource(groupId, catId) {
    const cat = catId ? S.byId[catId] : null;
    const method = cat && cat.electricity ? 'electricity' : project.settings.defaultMethod || 'library';
    return {
      id: uid(), groupId: groupId || '', catId: catId || null, description: cat ? cat.name : '', activityType: '',
      include: 'yes', justification: '', custodian: '', assumptions: '', notes: '', allocation: '',
      method, libraryFactorId: '', quantity: '', unit: '',
      factor: null, params: {}, searchHint: cat ? cat.queries[0] : '',
      elec: { energy: '', unit: 'kWh', recs: '', direct: '', year: '' },
      quality: { method: 'measured', uActivity: S.ACTIVITY_UNCERTAINTY.measured, uFactor: '' },
      evidence: '', isRemoval: false, biogenic: '', result: null, error: null,
    };
  }

  // ============================================================
  // Bindings de formularios
  // ============================================================
  const root = () => ({ p: project, ui, settings });
  function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root()); }
  function setPath(path, val) {
    const keys = path.split('.');
    let o = root();
    for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
  }
  function field(label, path, o = {}) {
    const v = getPath(path);
    const attrs = `data-bind="${path}"${o.rerender ? ' data-rerender' : ''}${o.required ? ' required' : ''}${o.disabled ? ' disabled' : ''}`;
    let input;
    if (o.type === 'select') {
      input = `<select ${attrs}>${o.options.map((opt) => {
        if (opt.group) return `<optgroup label="${esc(opt.group)}">${opt.options.map(([val, lab]) => `<option value="${esc(val)}"${String(v ?? '') === String(val) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</optgroup>`;
        const [val, lab] = opt;
        return `<option value="${esc(val)}"${String(v ?? '') === String(val) ? ' selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select>`;
    } else if (o.type === 'textarea') {
      input = `<textarea ${attrs} placeholder="${esc(o.placeholder || '')}">${esc(v ?? '')}</textarea>`;
    } else {
      const t = o.type || 'text';
      input = `<input type="${t}" ${attrs}${t === 'number' ? ' data-num' : ''} value="${esc(v ?? '')}" placeholder="${esc(o.placeholder || '')}"${o.min != null ? ` min="${o.min}"` : ''}${o.step ? ` step="${o.step}"` : ''}${o.autocomplete ? ` autocomplete="${o.autocomplete}"` : ''}>`;
    }
    return `<label class="field${o.cls ? ' ' + o.cls : ''}"><span>${label}</span>${input}${o.help ? `<small class="help">${o.help}</small>` : ''}</label>`;
  }
  function check(label, path, o = {}) {
    return `<label class="check" title="${esc(o.title || '')}"><input type="checkbox" data-bind="${path}"${o.rerender ? ' data-rerender' : ''}${getPath(path) ? ' checked' : ''}><span>${label}</span></label>`;
  }
  const unitOptions = (preferUnit) => {
    if (preferUnit && Un.U[preferUnit]) {
      const same = Un.sameDimUnits(preferUnit);
      const other = Object.keys(Un.U).filter((k) => !same.includes(k));
      return [{ group: 'Compatibles con el factor', options: same.map((k) => [k, Un.label(k)]) }, { group: '⚠ Incompatibles con el factor', options: other.map((k) => [k, Un.label(k)]) }];
    }
    return Un.GROUPS.map(([g, ids]) => ({ group: g, options: ids.map((k) => [k, Un.label(k)]) }));
  };

  // ============================================================
  // Rutas
  // ============================================================
  function parseRoute() {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    return { name: parts[0] || '', a: parts[1], b: parts[2] };
  }
  const AUTH_ROUTES = ['ingresar', 'registro', 'recuperar', 'nueva-clave'];
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  async function route() {
    const r = parseRoute();
    ui.navOpen = false;
    if (!state.ready) return;
    if (state.configError) return renderSetupError();
    if (!state.session && !AUTH_ROUTES.includes(r.name) && r.name !== 'ayuda') return go('#/ingresar');
    if (state.session && ['ingresar', 'registro', 'recuperar'].includes(r.name)) return go('#/clientes');
    if (!r.name) return go(state.session ? '#/clientes' : '#/ingresar');
    try {
      if (r.name === 'clientes') await loadClients();
      if (r.name === 'cliente') await loadClient(r.a, true);
      if (r.name === 'huella') await loadFootprint(r.a);
      if (r.name === 'cuenta') await loadAccount();
      if (r.name === 'cuenta') ui.form = {};
      if (r.name === 'cliente' && r.b === 'datos') ui.form = { ...state.client };
      if (r.name === 'huella' && state.fp && ui.lastFp !== state.fp.id) { ui.lastFp = state.fp.id; ui.groupFilter = ''; }
    } catch (e) {
      render(`<div class="card"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p><a class="btn ghost" href="#/clientes">Volver a clientes</a></div>`);
      return;
    }
    render();
  }

  async function loadClients() { state.clients = await DB.clients.list(); }
  async function loadClient(id, full) {
    if (!state.client || state.client.id !== id) {
      state.client = await DB.clients.get(id);
      state.lib = await DB.factors.list(id);
    }
    if (full) {
      [state.footprints, state.lib] = await Promise.all([DB.footprints.list(id), DB.factors.list(id)]);
      state.audit = await DB.audit.list({ clientId: id, limit: 150 });
    }
  }
  async function loadFootprint(id) {
    if (!state.fp || state.fp.id !== id) {
      const row = await DB.footprints.get(id);
      await loadClient(row.client_id, false);
      state.lib = await DB.factors.list(row.client_id);
      state.fp = { ...row, data: undefined };
      project = migrateProject(row.data, row.type, row.period_year);
      state.versions = await DB.footprints.versions(id);
      ui.open = {};
    }
  }
  async function loadAccount() {
    [state.profile, state.keyStatus] = await Promise.all([DB.profile.get(), DB.profile.keyStatus()]);
  }
  function migrateProject(data, type, year) {
    const base = newProjectData(type, year);
    if (!data || !data.type) return base;
    const p = { ...base, ...data, purpose: { ...base.purpose, ...data.purpose }, settings: { ...base.settings, ...data.settings } };
    if (type === 'organizacion') p.boundaries = { ...base.boundaries, ...data.boundaries, categories: { ...base.boundaries.categories, ...((data.boundaries || {}).categories || {}) } };
    return p;
  }

  // ============================================================
  // Guardado de la huella
  // ============================================================
  let saveTimer;
  function saveFootprint(immediate) {
    if (!state.fp || !project) return;
    clearTimeout(saveTimer);
    setSaveStatus('Guardando…');
    const run = async () => {
      const t = C.compute(project, state.lib);
      const patch = { data: project, completeness: t.completeness, total_kg: t.total, period_year: num(project.period.year) || null };
      if (state.fp.status === 'emitido') {
        patch.status = 'borrador';
        toast('Modificaste una huella emitida: vuelve a borrador. La versión emitida queda guardada sin cambios.');
      }
      try {
        const row = await DB.footprints.update(state.fp.id, patch);
        state.fp.status = row.status; state.fp.updated_at = row.updated_at;
        setSaveStatus('Guardado ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        setSaveStatus('⚠ Error al guardar');
        toast('No se pudo guardar: ' + e.message, true);
      }
    };
    if (immediate) return run();
    saveTimer = setTimeout(run, 700);
  }
  function setSaveStatus(s) { ui.saveStatus = s; const el = document.getElementById('save-status'); if (el) el.textContent = s; }
  window.addEventListener('beforeunload', (e) => { if (ui.saveStatus === 'Guardando…') { e.preventDefault(); e.returnValue = ''; } });

  function audit(action, detail, entity = 'huella') {
    DB.audit.log({ client_id: state.client ? state.client.id : null, footprint_id: state.fp ? state.fp.id : null, entity, action, detail: detail || null });
  }

  // ============================================================
  // Pasos del asistente por tipo de huella
  // ============================================================
  const STEP_DEFS = {
    organizacion: [
      ['datos', 'Objetivo y responsables'], ['limites-org', 'Límites organizacionales'], ['limites-informe', 'Límites de informe'], ['periodo', 'Período y año base'],
      ['fuentes', 'Fuentes y datos'], ['resultados', 'Resultados'], ['calidad', 'Calidad y validación'], ['informe', 'Informe'],
    ],
    evento: [
      ['datos', 'Evento y límites'], ['grupos', 'Componentes'], ['fuentes', 'Fuentes y datos'], ['resultados', 'Resultados'],
      ['escenarios', 'Escenarios de reducción'], ['gestion', 'Gestión ISO 20121'], ['calidad', 'Calidad y validación'], ['informe', 'Informe'],
    ],
    producto: [
      ['datos', 'Producto y límites'], ['grupos', 'Etapas del ciclo de vida'], ['fuentes', 'Fuentes y datos'], ['resultados', 'Resultados'],
      ['sensibilidad', 'Sensibilidad'], ['calidad', 'Calidad y validación'], ['informe', 'Informe'],
    ],
  };
  const principlesFor = () => (project.type === 'producto' ? S.PRODUCT_PRINCIPLES : S.PRINCIPLES);
  function stepDone(id, t) {
    const p = project;
    switch (id) {
      case 'datos':
        if (p.type === 'evento') return !!(p.purpose.objective && p.event.name && num(p.event.attendees) > 0);
        if (p.type === 'producto') return !!(p.purpose.objective && p.product.name && p.product.declaredUnit && num(p.product.lotSize) > 0);
        return !!(p.purpose.objective && p.purpose.responsible);
      case 'limites-org': return p.groups.length > 0 && p.groups.every((g) => g.name && g.region);
      case 'grupos': return p.groups.length > 0 && p.groups.every((g) => g.name);
      case 'limites-informe': return boundaryIssues().length === 0;
      case 'periodo': return !!(p.period.start && p.period.end && p.baseYear.year);
      case 'fuentes': return p.sources.length > 0 && !p.sources.some((s) => t.validations[s.id] && t.validations[s.id].level === 'error');
      case 'resultados': return p.sources.length > 0 && t.completeness === 1;
      case 'escenarios': return (p.scenarios || []).length > 0;
      case 'gestion': return (p.iso20121 || []).length > 0 && p.iso20121.every((a) => a.status);
      case 'sensibilidad': return (p.sensitivity || []).length > 0;
      case 'calidad': return principlesFor().every((x) => p.purpose.principles[x.id]);
      case 'informe': return state.fp.status === 'emitido';
      default: return false;
    }
  }
  function boundaryIssues() {
    if (project.type !== 'organizacion') return [];
    const out = [];
    S.CATEGORIES.forEach((cat) => {
      const st = project.boundaries.categories[cat.id];
      if (st.status === 'pending') out.push(`${cat.name}: evaluación pendiente`);
      if (st.status === 'excluded' && !String(st.justification || '').trim()) out.push(`${cat.name}: falta justificar la exclusión`);
    });
    return out;
  }

  // ============================================================
  // Render principal
  // ============================================================
  // Redibuja conservando el foco y la selección del campo activo
  function render(override) {
    const ae = document.activeElement;
    const focusBind = ae && ae.dataset ? ae.dataset.bind : null;
    let selRange = null;
    try { if (focusBind && typeof ae.selectionStart === 'number') selRange = [ae.selectionStart, ae.selectionEnd]; } catch { /* inputs sin selección */ }
    renderInner(override);
    if (focusBind) {
      const el = document.querySelector(`[data-bind="${CSS.escape(focusBind)}"]`);
      if (el && el !== document.activeElement) {
        el.focus({ preventScroll: true });
        try { if (selRange) el.setSelectionRange(selRange[0], selRange[1]); } catch { /* tipo sin selección */ }
      }
    }
  }
  let deferTimer;
  function deferRender() { clearTimeout(deferTimer); deferTimer = setTimeout(() => render(), 0); }

  function renderInner(override) {
    const r = parseRoute();
    renderTopbar(r);
    const layout = document.getElementById('layout');
    const nav = document.getElementById('steps-nav');
    const main = document.getElementById('main');
    const inFootprint = r.name === 'huella' && project && state.fp;
    layout.className = 'layout' + (inFootprint ? '' : ' no-nav') + (AUTH_ROUTES.includes(r.name) ? ' auth' : '');
    if (override) { nav.innerHTML = ''; main.innerHTML = override; renderModal(); return; }
    let html = '';
    if (AUTH_ROUTES.includes(r.name)) html = renderAuth(r.name);
    else if (r.name === 'clientes') html = renderClients();
    else if (r.name === 'cliente') html = renderClient(r.b || 'huellas');
    else if (r.name === 'cuenta') html = renderAccount();
    else if (r.name === 'ayuda') html = renderHelp();
    else if (inFootprint) html = renderFootprint(r.b || 'datos');
    main.innerHTML = html;
    if (inFootprint) renderStepsNav(r.b || 'datos'); else nav.innerHTML = '';
    nav.classList.toggle('open', ui.navOpen);
    renderModal();
  }

  function renderTopbar(r) {
    const top = document.getElementById('topbar');
    const logged = !!state.session;
    const inFootprint = r.name === 'huella' && project && state.fp;
    top.innerHTML = `
      ${inFootprint ? '<button class="icon-btn menu-btn" data-action="toggle-nav" aria-label="Abrir pasos">☰</button>' : ''}
      <a class="brand" href="#/clientes">
        <span class="brand-mark" aria-hidden="true"></span>
        <div><div class="brand-title">Huella de Carbono</div><div class="brand-sub">GHG Protocol · ISO 14064 · ISO 14067 · ISO 20121</div></div>
      </a>
      ${logged ? `<div class="topbar-actions">
        ${inFootprint ? `<span id="save-status" class="save-status">${esc(ui.saveStatus)}</span>
          <button class="btn" data-action="export-word" ${ui.wordBusy ? 'disabled' : ''}>Descargar Word</button>` : ''}
        <a class="btn ghost" href="#/clientes">Clientes</a>
        <a class="btn ghost hide-sm" href="#/ayuda">Instrucciones</a>
        <a class="btn ghost" href="#/cuenta">Mi cuenta</a>
      </div>` : `<div class="topbar-actions"><a class="btn ghost" href="#/ayuda">Instrucciones</a></div>`}`;
  }

  function renderSetupError() {
    document.getElementById('topbar').innerHTML = '<div class="brand"><span class="brand-mark"></span><div class="brand-title">Huella de Carbono</div></div>';
    document.getElementById('layout').className = 'layout no-nav';
    document.getElementById('main').innerHTML = `
      <div class="card" style="max-width:720px;margin:40px auto">
        <h2>Falta configurar el servidor</h2>
        <div class="callout danger"><p>${esc(state.configError)}</p></div>
        <ol class="help-list">
          <li>Creá un proyecto en <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> y ejecutá <code>supabase/schema.sql</code> en el SQL Editor.</li>
          <li>En Vercel → Settings → Environment Variables, cargá <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code> y <code>SUPABASE_SERVICE_ROLE_KEY</code>.</li>
          <li>Hacé <strong>Redeploy</strong>. En local, usá <code>vercel dev</code> con un archivo <code>.env</code>.</li>
        </ol>
        <p class="muted small">Los pasos completos están en el README del repositorio.</p>
      </div>`;
  }

  // ============================================================
  // Auth
  // ============================================================
  function renderAuth(name) {
    ui.form = ui.form || {};
    const msg = ui.authMsg ? `<div class="callout ${ui.authMsg.error ? 'danger' : ''}"><p>${esc(ui.authMsg.text)}</p></div>` : '';
    const wrap = (title, body, foot) => `<div class="auth-card card"><div class="auth-brand"><span class="brand-mark"></span><strong>Huella de Carbono</strong></div><h1>${title}</h1>${msg}<form data-action-submit="${name}">${body}</form><div class="auth-foot">${foot}</div></div>`;
    if (name === 'registro') return wrap('Crear cuenta', `
      <div class="grid">${field('Nombre y apellido', 'ui.form.full_name', { autocomplete: 'name', required: true })}${field('Empresa o estudio', 'ui.form.company', { autocomplete: 'organization' })}</div>
      ${field('Email', 'ui.form.email', { type: 'email', autocomplete: 'email', required: true })}
      <div class="grid">${field('Contraseña', 'ui.form.password', { type: 'password', autocomplete: 'new-password', required: true, help: 'Mínimo 8 caracteres.' })}${field('Repetir contraseña', 'ui.form.password2', { type: 'password', autocomplete: 'new-password', required: true })}</div>
      <button class="btn block" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spinner"></span>' : 'Crear cuenta'}</button>`,
      '¿Ya tenés cuenta? <a href="#/ingresar">Ingresá</a>');
    if (name === 'recuperar') return wrap('Recuperar contraseña', `
      ${field('Email', 'ui.form.email', { type: 'email', autocomplete: 'email', required: true })}
      <button class="btn block" type="submit" ${ui.busy ? 'disabled' : ''}>Enviar enlace</button>`, '<a href="#/ingresar">Volver a ingresar</a>');
    if (name === 'nueva-clave') return wrap('Nueva contraseña', `
      ${field('Nueva contraseña', 'ui.form.password', { type: 'password', autocomplete: 'new-password', required: true })}
      ${field('Repetir contraseña', 'ui.form.password2', { type: 'password', autocomplete: 'new-password', required: true })}
      <button class="btn block" type="submit" ${ui.busy ? 'disabled' : ''}>Guardar contraseña</button>`, '');
    return wrap('Ingresar', `
      ${field('Email', 'ui.form.email', { type: 'email', autocomplete: 'email', required: true })}
      ${field('Contraseña', 'ui.form.password', { type: 'password', autocomplete: 'current-password', required: true })}
      <button class="btn block" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spinner"></span>' : 'Ingresar'}</button>`,
      '<a href="#/registro">Crear cuenta</a> · <a href="#/recuperar">Olvidé mi contraseña</a>');
  }

  async function submitAuth(name) {
    const f = ui.form;
    ui.authMsg = null;
    if (name === 'registro' || name === 'nueva-clave') {
      if (String(f.password || '').length < 8) { ui.authMsg = { error: true, text: 'La contraseña debe tener al menos 8 caracteres.' }; return render(); }
      if (f.password !== f.password2) { ui.authMsg = { error: true, text: 'Las contraseñas no coinciden.' }; return render(); }
    }
    ui.busy = true; render();
    try {
      if (name === 'ingresar') {
        await DB.auth.signIn(String(f.email).trim(), f.password);
        ui.form = {}; return; // onAuthStateChange redirige
      }
      if (name === 'registro') {
        const r = await DB.auth.signUp(String(f.email).trim(), f.password, { full_name: f.full_name || '', company: f.company || '' });
        ui.form = {};
        if (!r.session) ui.authMsg = { text: 'Cuenta creada. Te enviamos un email para confirmar tu dirección; después podés ingresar.' };
        go('#/ingresar');
      }
      if (name === 'recuperar') {
        await DB.auth.resetPassword(String(f.email).trim());
        ui.authMsg = { text: 'Si el email está registrado, vas a recibir un enlace para crear una nueva contraseña.' };
      }
      if (name === 'nueva-clave') {
        await DB.auth.updatePassword(f.password);
        ui.form = {}; toast('Contraseña actualizada.'); go('#/clientes');
      }
    } catch (e) {
      ui.authMsg = { error: true, text: e.message };
    } finally { ui.busy = false; render(); }
  }

  // ============================================================
  // Clientes
  // ============================================================
  function pageHead(eyebrow, title, intro, actions) {
    return `<div class="page-head"><div class="row"><div class="grow">${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1></div>${actions || ''}</div>${intro ? `<p>${intro}</p>` : ''}</div>`;
  }

  function renderClients() {
    const list = (state.clients || []).filter((c) => !ui.clientFilter || (c.name + ' ' + (c.cuit || '')).toLowerCase().includes(ui.clientFilter.toLowerCase()));
    const noKey = state.keyStatus && !state.keyStatus.has_key;
    return pageHead('Panel', 'Clientes', 'Cada cliente tiene su biblioteca de factores, sus huellas (organizacional, de evento y de producto) y su historial de cambios.',
      '<button class="btn" data-action="new-client">+ Nuevo cliente</button>') + `
      ${noKey ? '<div class="callout warn"><p>Todavía no cargaste tu API key de Climatiq. Podés trabajar con la biblioteca de factores propios; para usar los factores de Climatiq, configurala en <a href="#/cuenta">Mi cuenta</a>.</p></div>' : ''}
      <div class="row" style="margin-bottom:14px"><input type="search" placeholder="Buscar por nombre o CUIT…" data-bind="ui.clientFilter" data-live="clients" style="max-width:340px" value="${esc(ui.clientFilter || '')}"></div>
      ${!list.length ? `<div class="card empty">${state.clients && state.clients.length ? 'Sin resultados.' : 'Todavía no tenés clientes. Creá el primero para empezar.'}</div>` : ''}
      <div class="cards" id="clients-list">${list.map((c) => {
        const fps = c.footprints || [];
        const count = (t) => fps.filter((f) => f.type === t).length;
        return `<a class="client-card card" href="#/cliente/${c.id}">
          <div class="client-name">${esc(c.name)}</div>
          <div class="muted small">${c.cuit ? 'CUIT ' + esc(S.formatCuit(c.cuit)) : 'Sin CUIT'}${c.province ? ' · ' + esc(c.province) : ''}</div>
          <div class="row" style="margin-top:10px;gap:6px">
            <span class="badge s1">${count('organizacion')} organización</span>
            <span class="badge s2">${count('evento')} evento</span>
            <span class="badge s3">${count('producto')} producto</span>
          </div></a>`;
      }).join('')}</div>`;
  }

  function clientForm() {
    return `
      <div class="grid">
        ${field('Razón social', 'ui.form.name', { required: true })}
        ${field('CUIT', 'ui.form.cuit', { placeholder: '30-12345678-9', help: ui.form.cuit && !S.validCuit(ui.form.cuit) ? '⚠ El CUIT no es válido (dígito verificador).' : '' })}
      </div>
      <div class="grid" style="margin-top:12px">
        ${field('Sector / actividad', 'ui.form.sector')}
        ${field('Provincia', 'ui.form.province', { type: 'select', options: [['', 'Elegí…'], ...S.PROVINCES.map((x) => [x, x])] })}
      </div>
      <div style="margin-top:12px">${field('Domicilio', 'ui.form.address')}</div>
      <div class="grid" style="margin-top:12px">
        ${field('Contacto', 'ui.form.contact_name')}
        ${field('Email de contacto', 'ui.form.contact_email', { type: 'email' })}
      </div>
      <div style="margin-top:12px">${field('Notas', 'ui.form.notes', { type: 'textarea' })}</div>`;
  }

  // ------------------------------------------------------------
  function renderClient(tab) {
    const c = state.client;
    const tabs = [['huellas', 'Huellas'], ['factores', `Biblioteca de factores (${state.lib.length})`], ['datos', 'Datos del cliente'], ['historial', 'Historial']];
    let body = '';
    if (tab === 'factores') body = renderLibrary();
    else if (tab === 'datos') body = renderClientData();
    else if (tab === 'historial') body = renderAuditList(state.audit);
    else body = renderFootprintList();
    return `<div class="crumbs"><a href="#/clientes">Clientes</a> / ${esc(c.name)}</div>` +
      pageHead('Cliente', esc(c.name), `${c.cuit ? 'CUIT ' + esc(S.formatCuit(c.cuit)) : ''}${c.sector ? ' · ' + esc(c.sector) : ''}${c.province ? ' · ' + esc(c.province) : ''}`) +
      `<div class="tabs" role="tablist">${tabs.map(([id, l]) => `<a role="tab" class="tab${tab === id ? ' on' : ''}" href="#/cliente/${c.id}/${id}">${l}</a>`).join('')}</div>${body}`;
  }

  function renderFootprintList() {
    const list = state.footprints;
    return `
      <div class="row" style="margin:16px 0"><span class="grow muted small">Las huellas de organización, evento y producto tienen objetos de estudio y límites distintos: <strong>nunca se suman entre sí</strong>.</span>
        <button class="btn" data-action="new-footprint">+ Nueva huella</button></div>
      ${!list.length ? '<div class="card empty">Este cliente todavía no tiene huellas.</div>' : ''}
      <div class="table-wrap card" style="padding:0">${list.length ? `<table>
        <thead><tr><th>Huella</th><th>Tipo</th><th>Período</th><th>Estado</th><th class="num">Completitud</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${list.map((f) => `<tr>
          <td><a href="#/huella/${f.id}/datos"><strong>${esc(f.name)}</strong></a><div class="muted small">Modificada ${fmtDate(f.updated_at)}</div></td>
          <td><span class="badge ${f.type === 'organizacion' ? 's1' : f.type === 'evento' ? 's2' : 's3'}">${S.FOOTPRINT_TYPES[f.type].short}</span></td>
          <td>${esc(f.period_year || '—')}</td>
          <td>${f.status === 'emitido' ? '<span class="badge ok">Emitida</span>' : '<span class="badge">Borrador</span>'}</td>
          <td class="num">${fmtN(num(f.completeness) * 100, 0)}%</td>
          <td class="num">${f.total_kg != null ? fmtT(f.total_kg) + ' t' : '—'}${num(f.completeness) < 1 && f.total_kg ? ' <span class="badge warn">parcial</span>' : ''}</td>
          <td class="num"><button class="btn danger small" data-action="delete-footprint" data-id="${f.id}" data-name="${esc(f.name)}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table>` : ''}</div>`;
  }

  function renderClientData() {
    return `<div class="card" style="margin-top:16px">${clientForm()}
      <div class="row" style="margin-top:16px"><button class="btn" data-action="save-client">Guardar cambios</button><span class="grow"></span>
      <button class="btn danger" data-action="delete-client">Eliminar cliente</button></div></div>`;
  }

  function renderAuditList(rows) {
    const label = (r) => {
      const d = r.detail || {};
      const map = {
        'cliente:creado': 'Cliente creado', 'cliente:modificado': 'Datos del cliente modificados', 'cliente:eliminado': 'Cliente eliminado',
        'factor:creado': `Factor ${d.codigo} creado: ${fmtN(d.valor, 6)} kgCO₂e/${Un.label(d.unidad)}`,
        'factor:modificado': `Factor ${d.codigo} modificado: ${d.antes ? fmtN(d.antes.valor, 6) + ' kgCO₂e/' + Un.label(d.antes.unidad) : ''} → ${d.despues ? fmtN(d.despues.valor, 6) + ' kgCO₂e/' + Un.label(d.despues.unidad) : ''}`,
        'factor:eliminado': `Factor ${d.codigo} eliminado`,
        'factor:importados': `${d.cantidad} factores importados`,
        'huella:creada': `Huella creada: ${d.nombre} (${d.tipo})`, 'huella:eliminada': `Huella eliminada: ${d.nombre}`,
        'huella:estado_emitido': `Huella emitida · total ${d.total_kg != null ? fmtT(d.total_kg) + ' t' : '—'}`, 'huella:estado_borrador': 'Huella vuelta a borrador por modificaciones',
        'huella:calculo': `Cálculo ejecutado · completitud ${fmtN(num(d.completitud) * 100, 0)}% · ${fmtT(d.total_kg)} t`,
        'huella:informe_emitido': `Informe emitido · versión ${d.version}`, 'huella:informe_descargado': `Informe Word descargado${d.borrador ? ' (borrador)' : d.version ? ' · versión ' + d.version : ''}`,
        'fuente:agregada': `Fuente agregada: ${d.descripcion || ''}`, 'fuente:eliminada': `Fuente eliminada: ${d.descripcion || ''}`,
      };
      return map[`${r.entity}:${r.action}`] || `${r.entity} · ${r.action}`;
    };
    if (!rows || !rows.length) return '<div class="card empty" style="margin-top:16px">Sin movimientos registrados.</div>';
    return `<div class="card" style="margin-top:16px"><p class="muted small">Registro automático e inalterable de cambios (trazabilidad). Los cambios en factores y en el estado de las huellas los registra la base de datos.</p>
      <table><tbody>${rows.map((r) => `<tr><td class="nowrap muted small">${fmtDate(r.created_at)}</td><td>${esc(label(r))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ------------------------------------------------------------
  // Biblioteca de factores
  // ------------------------------------------------------------
  function renderLibrary() {
    const lib = state.lib;
    return `
      <div class="callout" style="margin-top:16px"><p>Factores de emisión propios de este cliente, en <strong>kgCO₂e por unidad de actividad</strong>. Al cargar las fuentes elegís, para cada una, si usás un factor de esta biblioteca o uno oficial de Climatiq. Cada cambio de valor queda registrado en el historial.</p></div>
      <div class="row" style="margin-bottom:12px">
        <button class="btn" data-action="new-factor">+ Nuevo factor</button>
        <button class="btn ghost" data-action="paste-factors">Pegar desde Excel</button>
        ${lib.length ? '<button class="btn ghost" data-action="export-factors">Exportar CSV</button>' : ''}
      </div>
      ${!lib.length ? '<div class="card empty">La biblioteca está vacía. Podés cargar factores uno por uno o pegar la tabla "Biblioteca_FE" directamente desde Excel.</div>' : `
      <div class="card table-wrap" style="padding:0"><table>
        <thead><tr><th>Código</th><th>Actividad</th><th class="num">Factor</th><th>Unidad</th><th>Fuente</th><th>Año</th><th></th></tr></thead>
        <tbody>${lib.map((f) => `<tr>
          <td><strong>${esc(f.code)}</strong></td><td>${esc(f.name)}${f.notes ? `<div class="muted small">${esc(f.notes)}</div>` : ''}</td>
          <td class="num">${fmtN(f.value, 6)}</td><td class="nowrap">kgCO₂e/${esc(Un.label(f.activity_unit))}</td>
          <td>${esc(f.source || '')}${!f.source ? '<span class="badge warn">sin fuente</span>' : ''}</td><td>${esc(f.year || '')}</td>
          <td class="num nowrap"><button class="btn ghost small" data-action="edit-factor" data-id="${f.id}">Editar</button> <button class="btn danger small" data-action="delete-factor" data-id="${f.id}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table></div>`}`;
  }

  function factorFormModal() {
    const f = ui.form;
    const editing = !!f.id;
    return modalShell(editing ? `Editar factor ${esc(f.code)}` : 'Nuevo factor', `
      <form data-action-submit="save-factor">
        <div class="grid">
          ${field('Código', 'ui.form.code', { required: true, placeholder: 'NG, DSL, EL…', help: 'Único dentro del cliente.' })}
          ${field('Actividad / gas', 'ui.form.name', { required: true, placeholder: 'Gas natural' })}
        </div>
        <div class="grid" style="margin-top:12px">
          ${field('Factor (kgCO₂e por unidad)', 'ui.form.value', { type: 'number', step: 'any', required: true })}
          ${field('Unidad de actividad', 'ui.form.activity_unit', { type: 'select', options: [['', 'Elegí…'], ...unitOptions()] , help: 'El factor se expresa en kgCO₂e por esta unidad.' })}
        </div>
        <div class="grid" style="margin-top:12px">
          ${field('Fuente / referencia', 'ui.form.source', { placeholder: 'Ej. Secretaría de Energía 2024, IPCC 2006, proveedor', help: 'Obligatoria para la transparencia del informe.' })}
          ${field('Año', 'ui.form.year', { type: 'number', step: 1 })}
          ${field('Incertidumbre (±%)', 'ui.form.uncertainty', { type: 'number', step: 'any', min: 0 })}
        </div>
        <div style="margin-top:12px">${field('Notas / advertencias', 'ui.form.notes', { type: 'textarea' })}</div>
        <div class="row" style="margin-top:16px"><span class="grow"></span><button class="btn ghost" type="button" data-action="close-modal">Cancelar</button><button class="btn" type="submit">Guardar</button></div>
      </form>`, 'narrow');
  }

  // "1.000,5" → 1000.5 · "0.120" → 0.12 · "2,65" → 2.65 · "1,234,567" → 1234567
  function parseNumber(raw) {
    let x = String(raw ?? '').replace(/[\s ]/g, '');
    if (!x) return NaN;
    const lastDot = x.lastIndexOf('.'), lastComma = x.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',';
      x = x.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else if (lastComma >= 0) {
      x = x.split(',').length > 2 ? x.split(',').join('') : x.replace(',', '.');
    } else if (x.split('.').length > 2) {
      x = x.split('.').join('');
    }
    return Number(x);
  }
  // Pegado desde Excel: Código | Actividad | Factor | Unidad del factor | Origen [| Año]
  function parsePasted(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    lines.forEach((line, i) => {
      const cols = line.split(/\t|;(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim());
      if (cols.length < 4) { out.push({ line: i + 1, raw: line, error: 'Faltan columnas (se esperan: código, actividad, factor, unidad, fuente).' }); return; }
      const [code, name, valueRaw, unitRaw, source, yearRaw] = cols;
      if (/^c[oó]digo$/i.test(code)) return; // encabezado
      const value = parseNumber(valueRaw);
      const pu = Un.parseFactorUnit(unitRaw);
      const row = { line: i + 1, code, name, value: Number.isFinite(value) ? value * pu.mult : NaN, activity_unit: pu.unit, unitRaw, source: source || '', year: Number(yearRaw) || null };
      if (!code) row.error = 'Sin código.';
      else if (!Number.isFinite(row.value)) row.error = `Factor no numérico: "${valueRaw}".`;
      else if (!pu.unit) row.error = `Unidad no reconocida: "${unitRaw}".`;
      else if (state.lib.some((f) => f.code.toLowerCase() === code.toLowerCase())) row.warn = 'Ya existe: se omite.';
      else if (out.some((o) => !o.error && o.code && o.code.toLowerCase() === code.toLowerCase())) row.error = 'Código repetido en lo pegado.';
      out.push(row);
    });
    return out;
  }
  function pasteModal() {
    const rows = parsePasted(ui.form.paste);
    const valid = rows.filter((r) => !r.error && !r.warn);
    return modalShell('Pegar factores desde Excel', `
      <p class="muted small">Copiá en Excel las columnas <strong>Código · Actividad · Factor · Unidad del factor · Origen</strong> (opcional: Año) y pegalas acá. La unidad puede venir como <code>kgCO₂e/m³</code>, <code>kgCO₂e/t·km</code>, <code>tCO2e/t</code>, etc.</p>
      ${field('Datos pegados', 'ui.form.paste', { type: 'textarea', placeholder: 'NG\tGas natural\t2\tkgCO₂e/m³\tEcoEtika' })}
      <button class="btn ghost small" data-action="refresh-paste" style="margin-top:8px">Revisar</button>
      ${rows.length ? `<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Línea</th><th>Código</th><th>Actividad</th><th class="num">Factor</th><th>Unidad</th><th>Estado</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${r.line}</td><td>${esc(r.code || '')}</td><td>${esc(r.name || '')}</td><td class="num">${Number.isFinite(r.value) ? fmtN(r.value, 6) : '—'}</td><td>${r.activity_unit ? 'kgCO₂e/' + esc(Un.label(r.activity_unit)) : esc(r.unitRaw || '')}</td>
          <td>${r.error ? `<span class="badge err">${esc(r.error)}</span>` : r.warn ? `<span class="badge warn">${esc(r.warn)}</span>` : '<span class="badge ok">OK</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <div class="row" style="margin-top:16px"><span class="grow muted small">${valid.length} factor(es) para importar</span><button class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn" data-action="import-factors" ${valid.length ? '' : 'disabled'}>Importar ${valid.length}</button></div>`);
  }

  // ============================================================
  // Mi cuenta
  // ============================================================
  function renderAccount() {
    const k = state.keyStatus || {};
    const pr = state.profile || {};
    if (!ui.form.__account) ui.form = { __account: true, full_name: pr.full_name || '', company: pr.company || '', key: '' };
    return pageHead('Cuenta', 'Mi cuenta', esc(state.session.user.email)) + `
      <div class="grid two">
        <div class="card">
          <h2>API de Climatiq</h2>
          <p class="muted small">Cada usuario usa su propia API key. Se guarda en una tabla protegida de la base de datos que el navegador no puede leer: solo la usa el servidor para consultar Climatiq.</p>
          ${k.has_key ? `<div class="callout"><p>✓ API key configurada (termina en <code>${esc(k.key_hint)}</code>) · actualizada ${fmtDate(k.updated_at)}</p></div>` : '<div class="callout warn"><p>Sin API key. Creá una gratis en <a href="https://www.climatiq.io" target="_blank" rel="noopener">climatiq.io</a>.</p></div>'}
          ${field(k.has_key ? 'Reemplazar API key' : 'API key', 'ui.form.key', { type: 'password', autocomplete: 'off' })}
          <div class="row" style="margin-top:12px">
            <button class="btn" data-action="save-key">Guardar key</button>
            ${k.has_key ? '<button class="btn ghost" data-action="test-api">Probar conexión</button><button class="btn danger" data-action="delete-key">Eliminar</button>' : ''}
          </div>
          <div class="api-status" style="margin-top:12px"></div>
        </div>
        <div class="card">
          <h2>Perfil</h2>
          ${field('Nombre y apellido', 'ui.form.full_name')}
          <div style="margin-top:12px">${field('Empresa o estudio', 'ui.form.company')}</div>
          <div class="row" style="margin-top:12px"><button class="btn" data-action="save-profile">Guardar perfil</button></div>
        </div>
      </div>
      <div class="grid two">
        <div class="card">
          <h2>Preferencias de cálculo</h2>
          <div class="grid">
            ${field('Versión de datos de Climatiq', 'settings.dataVersion', { help: 'Fijala durante todo un inventario para que sea reproducible.' })}
            ${field('PCG (GWP) del IPCC', 'settings.calculationMethod', { type: 'select', options: [['ar6', 'AR6 (recomendado)'], ['ar5', 'AR5'], ['ar4', 'AR4']] })}
          </div>
          <div style="margin-top:12px">${field('Tema', 'settings.theme', { type: 'select', options: [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']] })}</div>
        </div>
        <div class="card">
          <h2>Seguridad</h2>
          ${field('Nueva contraseña', 'ui.form.newpass', { type: 'password', autocomplete: 'new-password' })}
          <div class="row" style="margin-top:12px"><button class="btn ghost" data-action="change-password">Cambiar contraseña</button><span class="grow"></span><button class="btn danger" data-action="logout">Cerrar sesión</button></div>
        </div>
      </div>`;
  }

  // ============================================================
  // Huella: asistente
  // ============================================================
  function renderStepsNav(cur) {
    const t = C.compute(project, state.lib);
    const steps = STEP_DEFS[project.type];
    const nav = document.getElementById('steps-nav');
    nav.innerHTML = `
      <div class="nav-head"><a href="#/cliente/${state.client.id}" class="muted small">← ${esc(state.client.name)}</a>
        <div class="nav-title">${esc(state.fp.name)}</div>
        <span class="badge ${project.type === 'organizacion' ? 's1' : project.type === 'evento' ? 's2' : 's3'}">${S.FOOTPRINT_TYPES[project.type].name}</span>
        ${state.fp.status === 'emitido' ? ' <span class="badge ok">Emitida</span>' : ''}
      </div>
      ${steps.map(([id, title], i) => `<a class="step-link${id === cur ? ' active' : ''}${stepDone(id, t) ? ' done' : ''}" href="#/huella/${state.fp.id}/${id}">
        <span class="step-num">${stepDone(id, t) ? '✓' : i + 1}</span><span>${esc(title)}</span></a>`).join('')}
      <div class="steps-foot">
        <div class="row" style="justify-content:space-between"><span>Completitud</span><strong>${fmtN(t.completeness * 100, 0)}%</strong></div>
        <div class="meter"><div style="width:${t.completeness * 100}%"></div></div>
        <div style="margin-top:6px">${t.counts.complete} de ${t.counts.included + t.counts.pendingDecision} fuentes calculadas</div>
      </div>`;
  }

  function navButtons(cur) {
    const steps = STEP_DEFS[project.type];
    const i = steps.findIndex(([id]) => id === cur);
    const prev = steps[i - 1], next = steps[i + 1];
    return `<div class="nav-buttons">
      ${prev ? `<a class="btn ghost" href="#/huella/${state.fp.id}/${prev[0]}">← ${esc(prev[1])}</a>` : '<span></span>'}
      ${next ? `<a class="btn" href="#/huella/${state.fp.id}/${next[0]}">${esc(next[1])} →</a>` : ''}</div>`;
  }

  function renderFootprint(step) {
    const map = {
      datos: renderDatos, 'limites-org': renderLimitesOrg, grupos: renderGrupos, 'limites-informe': renderLimitesInf, periodo: renderPeriodo,
      fuentes: renderFuentes, resultados: renderResultados, escenarios: renderEscenarios, gestion: renderGestion, sensibilidad: renderSensibilidad,
      calidad: renderCalidad, informe: renderInforme,
    };
    const fn = map[step] && STEP_DEFS[project.type].some(([id]) => id === step) ? map[step] : renderDatos;
    return fn() + navButtons(step);
  }
  const stepHead = (n, title, intro) => pageHead(`Paso ${n} · ${S.FOOTPRINT_TYPES[project.type].name}`, title, intro);
  const stepNum = (id) => STEP_DEFS[project.type].findIndex(([x]) => x === id) + 1;

  // ---------------- Paso: datos ----------------
  function purposeCard() {
    return `<div class="card">
      <h2>Objetivo, usuarios y responsables</h2>
      <div class="grid two">
        ${field('Objetivo del estudio', 'p.purpose.objective', { type: 'textarea', placeholder: 'Ej. Establecer la línea base para un plan de reducción y reportar a clientes.' })}
        ${field('Usuarios previstos', 'p.purpose.users', { type: 'textarea', placeholder: 'Ej. Directorio, clientes, inversores, organismos públicos.' })}
      </div>
      <div class="grid" style="margin-top:14px">
        ${field('Responsable del estudio', 'p.purpose.responsible')}
        ${field('Cargo del responsable', 'p.purpose.responsibleRole')}
        ${field('Verificación', 'p.purpose.verification', { type: 'select', options: [['none', 'Sin verificación'], ['internal', 'Revisión interna'], ['limited', 'Externa — aseguramiento limitado'], ['reasonable', 'Externa — aseguramiento razonable']], help: 'Niveles de ISO 14064-3.' })}
        ${field('Organismo verificador', 'p.purpose.verifier', { placeholder: 'Si aplica' })}
      </div></div>`;
  }
  function renderDatos() {
    const p = project;
    if (p.type === 'evento') {
      return stepHead(1, 'Evento, objetivo y límites', 'Definí el evento, la unidad de reporte (asistentes) y los límites temporal y espacial. La gestión sostenible sigue ISO 20121; la cuantificación de GEI sigue el GHG Protocol.') + `
        <div class="card"><h2>Evento</h2>
          <div class="grid">
            ${field('Nombre del evento', 'p.event.name')}
            ${field('Lugar / predio', 'p.event.venue')}
            ${field('Ciudad', 'p.event.city')}
            ${field('Asistentes (unidad de reporte)', 'p.event.attendees', { type: 'number', min: 0, step: 1, help: 'El resultado se expresa también en kgCO₂e/asistente.' })}
          </div>
          <div class="grid" style="margin-top:14px">
            ${field('Inicio (montaje)', 'p.event.startDate', { type: 'date' })}
            ${field('Fin (desmontaje)', 'p.event.endDate', { type: 'date' })}
            ${field('Año del reporte', 'p.period.year', { type: 'number', step: 1 })}
          </div>
          <div class="grid two" style="margin-top:14px">
            ${field('Límite temporal', 'p.event.temporalLimit', { type: 'textarea' })}
            ${field('Límite espacial', 'p.event.spatialLimit', { type: 'textarea', placeholder: 'Ej. Predio del evento, traslados de asistentes y proveedores hasta el predio.' })}
          </div>
          <div style="margin-top:14px">${field('Exclusiones del límite y su justificación', 'p.event.exclusions', { type: 'textarea', placeholder: 'Ej. Alojamiento de asistentes: fuera del límite por falta de datos (<5% estimado).' })}</div>
        </div>${purposeCard()}`;
    }
    if (p.type === 'producto') {
      return stepHead(1, 'Producto, unidad declarada y límites', 'ISO 14067 exige definir la unidad declarada o funcional, el límite del sistema y las reglas de asignación antes de cuantificar.') + `
        <div class="card"><h2>Producto</h2>
          <div class="grid">
            ${field('Producto', 'p.product.name', { placeholder: 'Caja premium para vino' })}
            ${field('Unidad declarada / funcional', 'p.product.declaredUnit', { placeholder: '1 caja terminada para una botella' })}
            ${field('Unidades del lote estudiado', 'p.product.lotSize', { type: 'number', min: 1, step: 1, help: 'Los datos de actividad corresponden a este lote.' })}
            ${field('Año del estudio', 'p.period.year', { type: 'number', step: 1 })}
          </div>
          <div class="grid two" style="margin-top:14px">
            ${field('Límite del sistema', 'p.product.boundary', { type: 'select', rerender: true, options: Object.entries(S.PRODUCT_BOUNDARIES) })}
            ${field('Regla de asignación al lote', 'p.product.allocationRule', { type: 'textarea', placeholder: 'Ej. Consumos de equipos asignados por horas-máquina del lote; materias primas por masa.' })}
          </div>
          <div style="margin-top:14px">${field('Exclusiones del límite y su justificación', 'p.product.exclusions', { type: 'textarea', placeholder: 'Ej. Uso y fin de vida: fuera del límite cuna-puerta.' })}</div>
        </div>${purposeCard()}`;
    }
    return stepHead(1, 'Objetivo y responsables', 'ISO 14064-1 exige describir a la organización que informa, a la persona responsable, el propósito del informe y sus usuarios previstos. Los datos de la empresa se toman de la ficha del cliente.') +
      `<div class="callout"><p><strong>${esc(state.client.name)}</strong>${state.client.cuit ? ' · CUIT ' + esc(S.formatCuit(state.client.cuit)) : ' · <span class="badge warn">sin CUIT</span>'}${state.client.sector ? ' · ' + esc(state.client.sector) : ''}. <a href="#/cliente/${state.client.id}/datos">Editar ficha del cliente</a></p></div>` +
      purposeCard() + `<div class="card"><div class="grid">${field('Uso previsto', 'p.purpose.intendedUse', { type: 'select', options: [['', 'Elegí…'], ['internal', 'Gestión interna'], ['public', 'Comunicación pública / reporte de sostenibilidad'], ['program', 'Programa voluntario (CDP, SBTi, etc.)'], ['regulatory', 'Requisito regulatorio o de clientes'], ['offset', 'Base para neutralidad o compensación']] })}</div></div>`;
  }

  // ---------------- Paso: límites organizacionales (org) ----------------
  function renderLimitesOrg() {
    const c = project.consolidation;
    const controlLabel = c === 'financial' ? 'Tiene control financiero' : 'Tiene control operacional';
    return stepHead(stepNum('limites-org'), 'Límites organizacionales', 'Elegí un enfoque de consolidación y aplicalo de forma coherente a todas las instalaciones (GHG Protocol cap. 3, ISO 14064-1 §5.1).') + `
      <div class="card"><h2>Enfoque de consolidación</h2><div class="grid">
        ${Object.entries(S.CONSOLIDATION).map(([k, v]) => `<label class="scope-box check${c === k ? ' selected' : ''}"><input type="radio" name="consol" value="${k}" data-bind="p.consolidation" data-rerender${c === k ? ' checked' : ''}><span><strong>${v.name}</strong><br><small class="muted">${v.help}</small></span></label>`).join('')}
      </div></div>
      <div class="card">
        <div class="card-head"><h2>Instalaciones y operaciones</h2><button class="btn small" data-action="add-group">+ Agregar instalación</button></div>
        <p class="muted small">El <strong>código de región</strong> (<code>AR</code>, o el de otro país para operaciones en el exterior) se usa para la electricidad de red y para filtrar factores en Climatiq.</p>
        ${project.groups.map((g, i) => `<div class="scope-box" style="margin-bottom:10px">
          <div class="grid">
            ${field('Nombre', `p.groups.${i}.name`)}
            ${field('Tipo', `p.groups.${i}.type`, { type: 'select', options: [['office', 'Oficina'], ['plant', 'Planta / fábrica'], ['warehouse', 'Depósito / centro de distribución'], ['store', 'Local / sucursal'], ['fleet', 'Flota'], ['field', 'Campo / yacimiento'], ['other', 'Otro']] })}
            ${field('Provincia', `p.groups.${i}.province`, { type: 'select', options: [['', '—'], ...S.PROVINCES.map((x) => [x, x])] })}
            ${field('Código de región', `p.groups.${i}.region`, { placeholder: 'AR' })}
          </div>
          <div class="row" style="margin-top:12px">
            <div class="grow">${field('Domicilio', `p.groups.${i}.address`)}</div>
            ${c === 'equity' ? `<div style="width:200px">${field('Participación (%)', `p.groups.${i}.equity`, { type: 'number', min: 0, step: 'any' })}</div>` : `<div style="padding-top:22px">${check(controlLabel, `p.groups.${i}.control`, { rerender: true })}</div>`}
          </div>
          <div class="row" style="margin-top:8px"><span class="badge ${C.groupShare(project, g.id) > 0 ? 'ok' : 'warn'}">Se consolida al ${fmtN(C.groupShare(project, g.id) * 100, 1)}%</span><span class="grow"></span><button class="btn danger small" data-action="remove-group" data-id="${g.id}">Eliminar</button></div>
        </div>`).join('')}
      </div>`;
  }

  // ---------------- Paso: componentes / etapas ----------------
  function renderGrupos() {
    const T = S.FOOTPRINT_TYPES[project.type];
    const isProd = project.type === 'producto';
    const intro = isProd
      ? 'Definí las etapas del ciclo de vida dentro del límite del sistema. Cada fuente se asigna a una etapa; las que quedan fuera del límite se marcan como excluidas en el paso de fuentes.'
      : 'Definí los componentes del evento. Cada fuente se asigna a un componente; el resultado se informa por componente y por asistente.';
    const cradleGrave = isProd && project.product.boundary === 'cuna-tumba';
    const missing = cradleGrave ? ['Distribución', 'Uso del producto', 'Fin de vida'].filter((n) => !project.groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) : [];
    return stepHead(2, T.groupPlural, intro) + `
      ${missing.length ? `<div class="callout warn"><p>El límite es de la cuna a la tumba: faltan etapas típicas (${missing.join(', ')}). <button class="btn small ghost" data-action="add-lifecycle">Agregarlas</button></p></div>` : ''}
      <div class="card"><div class="card-head"><h2>${T.groupPlural}</h2><button class="btn small" data-action="add-group">+ Agregar ${T.groupName.toLowerCase()}</button></div>
        ${project.groups.map((g, i) => {
          const used = project.sources.filter((s) => s.groupId === g.id).length;
          return `<div class="group-row">
            <span class="step-num">${i + 1}</span>
            <div class="grow">${field('Nombre', `p.groups.${i}.name`)}</div>
            <div class="grow">${field('Descripción', `p.groups.${i}.description`)}</div>
            <div class="row nowrap" style="padding-top:22px"><span class="badge">${used} fuente(s)</span>
              <button class="icon-btn" data-action="move-group" data-id="${g.id}" data-dir="-1" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-action="move-group" data-id="${g.id}" data-dir="1" title="Bajar" ${i === project.groups.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn danger small" data-action="remove-group" data-id="${g.id}">Eliminar</button></div>
          </div>`;
        }).join('')}
      </div>`;
  }

  // ---------------- Paso: límites de informe (org) ----------------
  function catRow(cat) {
    const base = `p.boundaries.categories.${cat.id}`;
    const st = project.boundaries.categories[cat.id];
    const label = cat.scope === 3 ? `${cat.cat}. ${cat.name}` : cat.name;
    return `<div class="cat-row"><div>
        <div class="cat-title">${esc(label)} <span class="badge">${S.ISO_CATEGORIES[cat.iso].split(' · ')[0]}</span></div>
        <div class="cat-desc">${esc(cat.desc)}</div>
        ${cat.scope === 3 ? `<div class="criteria">${S.RELEVANCE_CRITERIA.map((r) => check(r.label, `${base}.criteria.${r.id}`, { title: r.help })).join('')}</div>` : ''}
        ${st.status === 'excluded' ? `<div style="margin-top:8px">${field('Justificación de la exclusión', `${base}.justification`, { placeholder: cat.scope === 3 ? 'Ej. No significativa (<1% estimado), sin influencia, sin datos…' : 'Ej. No existen fuentes de este tipo.' })}</div>` : ''}
      </div>
      <div style="min-width:160px">${field('Estado', `${base}.status`, { type: 'select', rerender: true, options: cat.scope === 3 ? [['pending', 'Por evaluar'], ['included', 'Incluida'], ['excluded', 'Excluida']] : [['included', 'Aplica / incluida'], ['excluded', 'No aplica']] })}</div></div>`;
  }
  function renderLimitesInf() {
    const issues = boundaryIssues();
    const box = (scope, title, intro) => `<div class="card"><h2><span class="badge s${scope}">Alcance ${scope}</span> ${title}</h2><p class="muted small">${intro}</p>${S.CATEGORIES.filter((c) => c.scope === scope).map(catRow).join('')}</div>`;
    return stepHead(3, 'Límites de informe (operacionales)', 'Alcance 1 y 2 son obligatorios. Para el Alcance 3 (categorías 3 a 6 de ISO), aplicá criterios de significancia y justificá las exclusiones.') + `
      <div class="card"><div class="grid">
        ${field('Umbral de materialidad para exclusiones (%)', 'p.boundaries.materiality', { type: 'number', min: 0, step: 'any', help: 'Referencia habitual: las exclusiones no superan el 5% del total.' })}
        ${field('Alcance 2 en el total', 'p.settings.scope2Totals', { type: 'select', options: [['location', 'Basado en ubicación'], ['market', 'Basado en mercado']], help: 'Ambos se reportan siempre.' })}
      </div></div>
      ${issues.length ? `<div class="callout warn"><p><strong>Pendiente:</strong> ${issues.map(esc).join(' · ')}</p></div>` : '<div class="callout"><p>✓ Todas las categorías tienen una decisión documentada.</p></div>'}
      ${box(1, 'Emisiones directas', 'Fuentes propias o controladas. ISO 14064-1 categoría 1. Incluye CO₂, CH₄, N₂O, HFCs, PFCs, SF₆ y NF₃.')}
      ${box(2, 'Indirectas por energía', 'Electricidad, vapor, calor y frío adquiridos. ISO 14064-1 categoría 2.')}
      ${box(3, 'Otras indirectas (cadena de valor)', 'Las 15 categorías del GHG Protocol Scope 3 Standard, con su equivalencia orientativa en ISO 14064-1.')}`;
  }

  // ---------------- Paso: período (org) ----------------
  function renderPeriodo() {
    return stepHead(4, 'Período de reporte y año base', 'El año base permite seguir el desempeño. Debe tener datos verificables y una política de recálculo explícita (GHG Protocol cap. 5, ISO 14064-1 §6.4).') + `
      <div class="card"><h2>Período</h2><div class="grid">
        ${field('Año del inventario', 'p.period.year', { type: 'number', step: 1 })}
        ${field('Inicio', 'p.period.start', { type: 'date' })}
        ${field('Fin', 'p.period.end', { type: 'date' })}
      </div></div>
      <div class="card"><h2>Año base</h2><div class="grid">
        ${field('Año base', 'p.baseYear.year', { type: 'number', step: 1 })}
        ${field('Umbral de recálculo (%)', 'p.baseYear.threshold', { type: 'number', min: 0, step: 'any' })}
      </div>
      <div class="grid two" style="margin-top:14px">
        ${field('Justificación', 'p.baseYear.justification', { type: 'textarea' })}
        ${field('Política de recálculo', 'p.baseYear.policy', { type: 'textarea' })}
      </div></div>`;
  }

  // ---------------- Paso: fuentes ----------------
  function renderFuentes() {
    const p = project;
    const T = S.FOOTPRINT_TYPES[p.type];
    const t = C.compute(p, state.lib);
    const isOrg = p.type === 'organizacion';
    const includedCats = isOrg ? S.CATEGORIES.filter((c) => p.boundaries.categories[c.id].status === 'included') : [];
    const groups = p.groups;
    const shown = p.sources.filter((s) => !ui.groupFilter || s.groupId === ui.groupFilter);
    const sections = groups.filter((g) => !ui.groupFilter || g.id === ui.groupFilter).map((g) => ({ g, items: shown.filter((s) => s.groupId === g.id) }));
    const orphan = shown.filter((s) => !groups.some((g) => g.id === s.groupId));
    const errCount = p.sources.filter((s) => t.validations[s.id].level === 'error').length;
    return stepHead(stepNum('fuentes'), 'Fuentes de emisión y datos de actividad', 'Por cada fuente: decidí si se incluye, cargá el dato de actividad y elegí el factor: de la <strong>biblioteca del cliente</strong> o <strong>oficial de Climatiq</strong>. La app valida unidades y datos al instante.') + `
      ${!state.lib.length ? `<div class="callout warn"><p>La biblioteca de factores de ${esc(state.client.name)} está vacía. <a href="#/cliente/${state.client.id}/factores">Cargala</a> o usá factores de Climatiq.</p></div>` : ''}
      <div class="card">
        <div class="card-head"><h2>Agregar fuente</h2>${completenessBadge(t)}</div>
        <div class="grid">
          <label class="field"><span>${T.groupName}</span><select id="new-group">${groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>
          ${isOrg ? `<label class="field"><span>Categoría</span><select id="new-cat">${[1, 2, 3].map((sc) => `<optgroup label="Alcance ${sc}">${includedCats.filter((c) => c.scope === sc).map((c) => `<option value="${c.id}">${c.scope === 3 ? c.cat + '. ' : ''}${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select><small class="help">Solo las categorías incluidas en el paso 3.</small></label>` : ''}
          ${field('Método por defecto', 'p.settings.defaultMethod', { type: 'select', options: [['library', 'Biblioteca del cliente'], ['climatiq', 'Climatiq (oficial)']] })}
          <div class="field"><span>&nbsp;</span><button class="btn" data-action="add-source">+ Agregar fuente</button></div>
        </div>
      </div>
      <div class="row" style="margin-bottom:12px">
        <label class="field" style="width:260px"><span>Filtrar por ${T.groupName.toLowerCase()}</span><select data-bind="ui.groupFilter" data-rerender><option value="">Todas</option>${groups.map((g) => `<option value="${g.id}"${ui.groupFilter === g.id ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
        <span class="grow"></span>
        ${errCount ? `<span class="badge err">${errCount} con errores</span>` : ''}
        <button class="btn" data-action="calculate" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spinner"></span> Calculando…' : 'Calcular emisiones'}</button>
      </div>
      ${!p.sources.length ? '<div class="card empty">Todavía no hay fuentes.</div>' : ''}
      ${sections.filter((x) => x.items.length).map((x) => `<h2 class="group-title">${esc(x.g.name)} <span class="muted small">${fmtK(t.byGroup[x.g.id] || 0)} kgCO₂e</span></h2>${x.items.map((s) => renderSource(s, t)).join('')}`).join('')}
      ${orphan.length ? `<h2 class="group-title">Sin ${T.groupName.toLowerCase()}</h2>${orphan.map((s) => renderSource(s, t)).join('')}` : ''}`;
  }

  function completenessBadge(t) {
    return `<span class="row" style="gap:8px"><span class="muted small">Completitud</span><span class="meter" style="width:120px"><div style="width:${t.completeness * 100}%"></div></span><strong>${fmtN(t.completeness * 100, 0)}%</strong></span>`;
  }

  function sourceStatus(s, t) {
    const v = t.validations[s.id];
    if (s.include === 'no') return '<span class="badge">Excluida</span>';
    if (s.include === 'pending') return '<span class="badge warn">Sin decidir</span>';
    if (project.type === 'organizacion' && project.boundaries.categories[s.catId] && project.boundaries.categories[s.catId].status !== 'included') return '<span class="badge warn">Categoría excluida</span>';
    if (v.level === 'error') return '<span class="badge err">Inválida</span>';
    if (s.error) return '<span class="badge err">Error</span>';
    const row = t.rows.find((r) => r.s.id === s.id && !r.derived);
    if (row) return `<span class="badge ok">${fmtK(row.kg)} kgCO₂e</span>${v.level === 'warn' ? ' <span class="badge warn">!</span>' : ''}`;
    return '<span class="badge">Listo para calcular</span>';
  }

  function renderSource(s, t) {
    const i = project.sources.indexOf(s);
    const P = `p.sources.${i}`;
    const isOrg = project.type === 'organizacion';
    const cat = isOrg ? S.byId[s.catId] : null;
    const open = !!ui.open[s.id];
    const v = t.validations[s.id];
    const methods = [['library', 'Biblioteca del cliente'], ['climatiq', 'Climatiq (oficial)'], ...(cat && cat.electricity ? [['electricity', 'Electricidad de red (ubicación + mercado)']] : [])];
    let body = '';
    if (open) {
      body = `<div class="source-body">
        <div class="grid" style="margin-top:12px">
          ${field('Descripción', `${P}.description`)}
          ${field(S.FOOTPRINT_TYPES[project.type].groupName, `${P}.groupId`, { type: 'select', rerender: true, options: project.groups.map((g) => [g.id, g.name]) })}
          ${isOrg ? field('Categoría', `${P}.catId`, { type: 'select', rerender: true, options: [1, 2, 3].map((sc) => ({ group: 'Alcance ' + sc, options: S.CATEGORIES.filter((c) => c.scope === sc).map((c) => [c.id, (c.scope === 3 ? c.cat + '. ' : '') + c.name]) })) }) : field(project.type === 'producto' ? 'Tipo de flujo' : 'Tipo de actividad', `${P}.activityType`, { placeholder: project.type === 'producto' ? 'Materia prima, energía, residuo…' : 'Energía, transporte, alimentos…' })}
        </div>
        <div class="grid" style="margin-top:12px">
          ${field('¿Se incluye?', `${P}.include`, { type: 'select', rerender: true, options: [['yes', 'Sí'], ['no', 'No (excluida)'], ['pending', 'Pendiente de decidir']] })}
          <div style="grid-column: span 2">${field(s.include === 'no' ? 'Justificación de la exclusión (obligatoria)' : 'Límite y justificación', `${P}.justification`, { placeholder: s.include === 'no' ? 'Ej. Fuera del límite temporal del evento.' : 'Por qué está dentro del límite' })}</div>
        </div>
        ${s.include !== 'no' ? `
        <div style="margin:16px 0 10px" class="row"><span class="small strong">Factor de emisión</span>
          <div class="method-tabs">${methods.map(([m, l]) => `<button class="${s.method === m ? 'on' : ''}" data-action="set-method" data-id="${s.id}" data-method="${m}">${l}</button>`).join('')}</div></div>
        ${s.method === 'library' ? renderLibraryInputs(s, P) : ''}
        ${s.method === 'climatiq' ? renderClimatiqInputs(s, P, cat) : ''}
        ${s.method === 'electricity' ? renderElectricityInputs(s, P) : ''}
        <h3 style="margin-top:18px">Trazabilidad y calidad del dato</h3>
        <div class="grid">
          ${field('Evidencia documental', `${P}.evidence`, { placeholder: 'Ej. Facturas de gas 2025' })}
          ${field('Responsable del dato (custodio)', `${P}.custodian`, { placeholder: 'Ej. Administración' })}
          ${field('Tipo de dato', `${P}.quality.method`, { type: 'select', rerender: true, options: Object.entries(S.DATA_METHODS) })}
          ${field('Incertidumbre del dato (±%)', `${P}.quality.uActivity`, { type: 'number', min: 0, step: 'any' })}
          ${field('Incertidumbre del factor (±%)', `${P}.quality.uFactor`, { type: 'number', min: 0, step: 'any', placeholder: 'auto', help: 'Vacío: la del factor o 10%.' })}
        </div>
        <div class="grid two" style="margin-top:12px">
          ${field('Calidad / supuestos', `${P}.assumptions`, { type: 'textarea', placeholder: 'Ej. Pérdida estimada de refrigerante, sin recarga registrada.' })}
          ${field('Observaciones', `${P}.notes`, { type: 'textarea' })}
        </div>
        ${project.type === 'producto' ? `<div style="margin-top:12px">${field('Criterio de asignación al lote', `${P}.allocation`, { placeholder: 'Ej. kWh medidos en el sector durante la producción del lote.' })}</div>` : ''}
        ${isOrg ? `<div class="grid" style="margin-top:12px">
          ${field('CO₂ biogénico (kg, se informa aparte)', `${P}.biogenic`, { type: 'number', min: 0, step: 'any' })}
          ${s.catId === 's1_lulucf' ? `<div class="field"><span>&nbsp;</span>${check('Es una remoción (se informa aparte)', `${P}.isRemoval`)}</div>` : ''}
        </div>` : ''}` : ''}
        ${validationPanel(v)}
        ${s.error ? `<div class="callout danger" style="margin-top:12px"><p>${esc(s.error)}</p></div>` : ''}
        ${s.result && s.result.location ? electricityResult(s) : ''}
        <div class="row" style="margin-top:12px"><span class="grow"></span>
          <button class="btn ghost small" data-action="dup-source" data-id="${s.id}">Duplicar</button>
          <button class="btn danger small" data-action="remove-source" data-id="${s.id}">Eliminar</button></div>
      </div>`;
    }
    return `<div class="source${v.level === 'error' && s.include !== 'no' ? ' invalid' : ''}">
      <div class="source-head" data-action="toggle-source" data-id="${s.id}">
        <span aria-hidden="true">${open ? '▾' : '▸'}</span>
        <span class="title">${esc(s.description || '(sin descripción)')}</span>
        ${cat ? `<span class="badge s${cat.scope}">${cat.scope === 3 ? '3.' + cat.cat : 'A' + cat.scope} ${esc(cat.name)}</span>` : ''}
        <span class="badge">${s.method === 'library' ? 'Biblioteca' : s.method === 'climatiq' ? 'Climatiq' : 'Red eléctrica'}</span>
        <span class="status-slot">${sourceStatus(s, t)}</span>
      </div>${body}</div>`;
  }

  function validationPanel(v) {
    const items = v.issues;
    if (!items.length) return '<div class="validation ok">✓ Datos coherentes</div>';
    const icon = { error: '✕', warn: '!', info: 'i' };
    return `<ul class="validation">${items.map((x) => `<li class="${x.level}"><span>${icon[x.level]}</span>${esc(x.msg)}</li>`).join('')}</ul>`;
  }

  function renderLibraryInputs(s, P) {
    const f = C.libFactor(state.lib, s.libraryFactorId);
    const opts = [['', state.lib.length ? 'Elegí un factor…' : 'La biblioteca está vacía'], ...state.lib.map((x) => [x.id, `${x.code} — ${x.name} (${fmtN(x.value, 6)} kgCO₂e/${Un.label(x.activity_unit)})`])];
    const calc = f && s.quantity !== '' ? C.libraryEmission(s, state.lib) : null;
    return `<div class="grid">
        <div style="grid-column: span 2">${field('Factor de la biblioteca', `${P}.libraryFactorId`, { type: 'select', rerender: true, options: opts })}</div>
        ${field('Dato de actividad', `${P}.quantity`, { type: 'number', step: 'any', min: 0 })}
        ${field('Unidad del dato', `${P}.unit`, { type: 'select', rerender: true, options: [['', 'Elegí…'], ...unitOptions(f && f.activity_unit)] })}
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn ghost small" data-action="new-factor-inline" data-id="${s.id}">+ Nuevo factor en la biblioteca</button>
        <span class="grow"></span>
        ${calc && !calc.error ? `<span class="calc-preview">${fmtN(s.quantity, 4)} ${esc(Un.label(s.unit))}${s.unit !== f.activity_unit ? ` = ${fmtN(calc.qtyConverted, 4)} ${esc(Un.label(f.activity_unit))}` : ''} × ${fmtN(f.value, 6)} = <strong>${fmtK(calc.kg)} kgCO₂e</strong></span>` : ''}
      </div>`;
  }

  function renderClimatiqInputs(s, P, cat) {
    const f = s.factor;
    const spec = f ? S.UNIT_TYPES[f.unit_type] : null;
    return `<div class="factor-box">
        ${f ? `<div class="grow"><strong>${esc(f.name)}</strong><br><span class="muted small">${esc(f.source)}${f.source_dataset ? ' · ' + esc(f.source_dataset) : ''} · ${esc(f.region_name || f.region)} · ${esc(f.year)} · ${esc(f.unit_type)}</span><br><code>${esc(f.activity_id)}</code></div>
          <button class="btn ghost small" data-action="open-search" data-id="${s.id}">Cambiar</button>`
        : `<div class="grow">Sin factor. Buscá en la base de datos de Climatiq.</div><button class="btn small" data-action="open-search" data-id="${s.id}">Buscar factor</button>`}
      </div>
      ${spec ? `<div class="grid" style="margin-top:12px">${spec.map((p) => `${field(p.label, `${P}.params.${p.key}`, { type: 'number', min: 0, step: p.integer ? 1 : 'any' })}${p.units ? field('Unidad', `${P}.params.${p.key}_unit`, { type: 'select', options: p.units.map((u) => [u, u]) }) : ''}`).join('')}</div>` : ''}
      ${cat ? `<p class="muted small" style="margin-top:8px">Datos típicos: ${esc(cat.data)}</p>` : ''}
      ${s.result && !s.result.location ? `<div class="calc-preview" style="margin-top:8px">Resultado Climatiq: <strong>${fmtK(s.result.co2e)} kgCO₂e</strong> · PCG ${esc(String(s.result.gwp || '').toUpperCase())}</div>` : ''}`;
  }

  function renderElectricityInputs(s, P) {
    const g = project.groups.find((x) => x.id === s.groupId);
    return `<div class="callout"><p>Endpoint de electricidad de Climatiq: <strong>Alcance 2 por ubicación y por mercado</strong>, y emisiones aguas arriba (WTT y pérdidas de T&D) en <strong>Alcance 3.3</strong> si esa categoría está incluida. Región: <code>${esc((g && g.region) || 'sin definir')}</code>. Si Climatiq no tiene datos para tu región, usá la biblioteca con el factor de la red argentina publicado por la Secretaría de Energía.</p></div>
      <div class="grid">
        ${field('Consumo total', `${P}.elec.energy`, { type: 'number', min: 0, step: 'any' })}
        ${field('Unidad', `${P}.elec.unit`, { type: 'select', options: S.UNIT_TYPES.Energy[0].units.map((u) => [u, u]) })}
        ${field('Certificados renovables', `${P}.elec.recs`, { type: 'number', min: 0, step: 'any', help: 'Misma unidad. Solo afecta el método de mercado.' })}
        ${field('Renovable con conexión directa', `${P}.elec.direct`, { type: 'number', min: 0, step: 'any' })}
        ${field('Año del factor', `${P}.elec.year`, { type: 'number', step: 1, placeholder: 'Último disponible' })}
      </div>`;
  }
  function electricityResult(s) {
    const r = s.result;
    const row = (k, l) => `<tr><td>${l}</td><td class="num">${fmtK(r.location[k])}</td><td class="num">${fmtK(r.market[k])}</td></tr>`;
    return `<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>kgCO₂e</th><th class="num">Ubicación</th><th class="num">Mercado</th></tr></thead>
      <tbody>${row('consumption', 'Alcance 2 — consumo')}${row('wtt', '3.3 — extracción de combustibles')}${row('td', '3.3 — pérdidas T&D')}${row('wtt_td', '3.3 — WTT de pérdidas')}</tbody></table></div>`;
  }

  // ---------------- Cálculo ----------------
  function computeLibrarySource(s) {
    if (s.method !== 'library' || s.include !== 'yes') return;
    const v = C.validateSource(s, { project, lib: state.lib });
    if (v.issues.some((x) => x.level === 'error' && !/evidencia|responsable/i.test(x.msg))) { s.result = null; return; }
    const r = C.libraryEmission(s, state.lib);
    if (r.error) { s.result = null; return; }
    s.result = { co2e: r.kg, factorValue: num(r.factor.value), factorUnit: r.factor.activity_unit, factorCode: r.factor.code, factorUncertainty: r.factor.uncertainty, qtyConverted: r.qtyConverted, at: new Date().toISOString() };
    s.error = null;
  }

  async function calculateAll() {
    const ctx = { project, lib: state.lib };
    const todo = project.sources.filter((s) => s.include === 'yes' && C.validateSource(s, ctx).level !== 'error');
    if (!todo.length) { toast('No hay fuentes válidas para calcular. Revisá los errores de validación.', true); render(); return; }
    ui.busy = true; render();
    const now = new Date().toISOString();
    todo.filter((s) => s.method === 'library').forEach(computeLibrarySource);

    let apiError = null;
    const cq = todo.filter((s) => s.method === 'climatiq');
    if (cq.length) {
      const bodies = cq.map((s) => {
        const ef = { id: s.factor.id };
        if ((s.factor.supported_calculation_methods || []).includes(settings.calculationMethod)) ef.calculation_method = settings.calculationMethod;
        const parameters = {};
        (S.UNIT_TYPES[s.factor.unit_type] || []).forEach((p) => {
          parameters[p.key] = p.integer ? Math.round(num(s.params[p.key])) : num(s.params[p.key]);
          if (p.units) parameters[p.key + '_unit'] = s.params[p.key + '_unit'] || p.units[0];
        });
        return { emission_factor: ef, parameters };
      });
      try {
        const res = await API.estimateBatch(bodies);
        cq.forEach((s, k) => {
          const r = res[k];
          if (!r || r.error) { s.error = (r && r.message) || 'Error desconocido'; s.result = null; return; }
          const cg = r.constituent_gases || {};
          s.result = { co2e: r.co2e_unit === 't' ? num(r.co2e) * 1000 : num(r.co2e), gwp: r.co2e_calculation_method, at: now, notices: r.notices || [], gases: { co2: cg.co2, ch4: cg.ch4, n2o: cg.n2o, other: cg.co2e_other } };
          s.error = null;
        });
      } catch (e) { apiError = e.message; cq.forEach((s) => { s.error = e.message; }); }
    }
    const el = todo.filter((s) => s.method === 'electricity');
    if (el.length) {
      const bodies = el.map((s) => {
        const g = project.groups.find((x) => x.id === s.groupId);
        const unit = s.elec.unit || 'kWh';
        const b = { region: String(g.region).trim().toUpperCase(), amount: { energy: num(s.elec.energy), energy_unit: unit } };
        if (s.elec.year) b.year = Math.round(num(s.elec.year));
        if (num(s.elec.recs) > 0) b.recs = { energy: num(s.elec.recs), energy_unit: unit };
        if (num(s.elec.direct) > 0) b.components = [{ amount: { energy: num(s.elec.direct), energy_unit: unit }, connection_type: 'direct', energy_source: 'renewable' }];
        return b;
      });
      try {
        const res = await API.electricityBatch(bodies);
        el.forEach((s, k) => {
          const r = res[k];
          if (!r || r.error) { s.error = (r && r.message) || 'Error desconocido'; s.result = null; return; }
          const kg = (x) => (x ? (x.co2e_unit === 't' ? num(x.co2e) * 1000 : num(x.co2e)) : 0);
          const pick = (m) => ({ consumption: kg(m.consumption), wtt: kg(m.well_to_tank), td: kg(m.transmission_and_distribution), wtt_td: kg(m.well_to_tank_of_transmission_and_distribution), trail: m.consumption && m.consumption.source_trail });
          s.result = { location: pick(r.location || {}), market: pick(r.market || {}), at: now, notices: r.notices || [] };
          s.error = null;
        });
      } catch (e) { apiError = e.message; el.forEach((s) => { s.error = e.message; }); }
    }
    ui.busy = false;
    const t = C.compute(project, state.lib);
    await saveFootprint(true);
    audit('calculo', { completitud: t.completeness, total_kg: t.total, fuentes: t.counts.complete });
    render();
    if (apiError) toast(apiError, true);
    else if (t.completeness < 1) toast(`Cálculo hecho. Completitud ${fmtN(t.completeness * 100, 0)}%: el total es PARCIAL.`);
    else toast('Cálculo completo: 100% de las fuentes.');
  }

  // ---------------- Paso: resultados ----------------
  function bars(entries, cls) {
    const max = Math.max(...entries.map((e) => e.v), 0);
    if (!entries.length || max <= 0) return '<div class="empty">Sin datos calculados.</div>';
    return `<div class="bars">${entries.map((e) => `<div class="bar-row"><span>${esc(e.label)}</span><div class="bar-track"><div class="bar-fill ${e.cls || cls || ''}" style="width:${(e.v / max) * 100}%"></div></div><span class="num">${e.text || fmtK(e.v) + ' kg'}</span></div>`).join('')}</div>`;
  }
  function partialBanner(t) {
    if (!t.isPartial) return '<div class="callout"><p>✓ Inventario completo: todas las fuentes incluidas están calculadas y validadas.</p></div>';
    return `<div class="callout warn"><p><strong>Resultado PARCIAL — completitud ${fmtN(t.completeness * 100, 0)}%.</strong> Faltan ${t.counts.included + t.counts.pendingDecision - t.counts.complete} fuente(s) por decidir, completar o calcular. Un total parcial sirve para trabajar, pero <strong>no se debe comunicar</strong> como la huella del ${project.type === 'organizacion' ? 'inventario' : project.type}: el principio de integridad (GHG Protocol, ISO 14064-1, ISO 14067) exige incluir todas las fuentes dentro del límite o justificar su exclusión.</p></div>`;
  }
  function renderResultados() {
    const p = project, t = C.compute(p, state.lib);
    const tag = t.isPartial ? ' <span class="badge warn">PARCIAL</span>' : '';
    const groupEntries = p.groups.map((g) => ({ label: g.name, v: t.byGroup[g.id] || 0 }));
    let kpis = '', extra = '';
    if (p.type === 'organizacion') {
      const total = t.total || 1;
      kpis = `<div class="kpi"><div class="label">Total${tag}</div><div class="value">${fmtT(t.total)}</div><div class="unit">tCO₂e</div></div>
        <div class="kpi s1"><div class="label">Alcance 1</div><div class="value">${fmtT(t.s1)}</div><div class="unit">tCO₂e · ${fmtN(pct(t.s1, total), 1)}%</div></div>
        <div class="kpi s2"><div class="label">Alcance 2 (${p.settings.scope2Totals === 'market' ? 'mercado' : 'ubicación'})</div><div class="value">${fmtT(t.s2)}</div><div class="unit">tCO₂e · ${fmtN(pct(t.s2, total), 1)}%</div></div>
        <div class="kpi s3"><div class="label">Alcance 3</div><div class="value">${fmtT(t.s3)}</div><div class="unit">tCO₂e · ${fmtN(pct(t.s3, total), 1)}%</div></div>`;
      const catEntries = Object.entries(t.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ label: (S.byId[id].scope === 3 ? '3.' + S.byId[id].cat + ' ' : '') + S.byId[id].name, v, cls: 's' + S.byId[id].scope }));
      extra = `<div class="card"><h3>Distribución por alcance</h3><div class="stack"><div style="width:${pct(t.s1, total)}%;background:var(--s1)"></div><div style="width:${pct(t.s2, total)}%;background:var(--s2)"></div><div style="width:${pct(t.s3, total)}%;background:var(--s3)"></div></div>
          <div class="legend"><span><i style="background:var(--s1)"></i>Alcance 1</span><span><i style="background:var(--s2)"></i>Alcance 2</span><span><i style="background:var(--s3)"></i>Alcance 3</span></div></div>
        <div class="grid two"><div class="card"><h3>Por categoría</h3>${bars(catEntries)}</div><div class="card"><h3>Por instalación</h3>${bars(groupEntries)}</div></div>
        <div class="grid two">
          <div class="card"><h3>Alcance 2 — reporte dual</h3><table><tbody><tr><td>Basado en ubicación</td><td class="num">${fmtT(t.s2loc)} t</td></tr><tr><td>Basado en mercado</td><td class="num">${fmtT(t.s2mkt)} t</td></tr></tbody></table></div>
          <div class="card"><h3>Por categoría ISO 14064-1</h3><table><tbody>${Object.entries(S.ISO_CATEGORIES).map(([k, l]) => `<tr><td>${esc(l)}</td><td class="num">${fmtT(t.byIso[k] || 0)} t</td></tr>`).join('')}</tbody></table></div>
        </div>
        <div class="card"><h3>Informados por separado</h3><table><tbody><tr><td>Remociones</td><td class="num">${fmtT(t.removals)} tCO₂e</td></tr><tr><td>CO₂ biogénico</td><td class="num">${fmtT(t.biogenic)} tCO₂</td></tr></tbody></table></div>`;
    } else if (p.type === 'evento') {
      kpis = `<div class="kpi"><div class="label">Huella del evento${tag}</div><div class="value">${fmtK(t.total)}</div><div class="unit">kgCO₂e · ${fmtT(t.total, 3)} t</div></div>
        <div class="kpi s2"><div class="label">Por asistente</div><div class="value">${t.perAttendee != null ? fmtK(t.perAttendee, 2) : '—'}</div><div class="unit">kgCO₂e/asistente · ${fmtN(p.event.attendees, 0)} asistentes</div></div>
        <div class="kpi"><div class="label">Incertidumbre</div><div class="value">±${fmtN(t.uncertainty, 1)}%</div><div class="unit">combinada estimada</div></div>`;
      extra = `<div class="card"><h3>Por componente</h3>${bars(groupEntries.map((e) => ({ ...e, text: `${fmtK(e.v)} kg · ${num(p.event.attendees) > 0 ? fmtK(e.v / num(p.event.attendees), 3) : '—'}/asist.` })))}</div>`;
    } else {
      kpis = `<div class="kpi"><div class="label">Por unidad declarada${tag}</div><div class="value">${t.perUnit != null ? fmtK(t.perUnit, 4) : '—'}</div><div class="unit">kgCO₂e / ${esc(p.product.declaredUnit || 'unidad')}</div></div>
        <div class="kpi s3"><div class="label">Lote estudiado</div><div class="value">${fmtK(t.total)}</div><div class="unit">kgCO₂e · ${fmtN(p.product.lotSize, 0)} unidades</div></div>
        <div class="kpi"><div class="label">Incertidumbre</div><div class="value">±${fmtN(t.uncertainty, 1)}%</div><div class="unit">combinada estimada</div></div>`;
      extra = `<div class="card"><h3>Por etapa del ciclo de vida</h3>${bars(groupEntries.map((e) => ({ ...e, text: `${fmtK(e.v)} kg · ${fmtN(pct(e.v, t.total), 1)}%` })), 's3')}</div>`;
    }
    return stepHead(stepNum('resultados'), 'Resultados', 'Emisiones = dato de actividad × factor de emisión, en CO₂ equivalente.') + `
      <div class="row" style="margin-bottom:16px"><button class="btn" data-action="calculate" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spinner"></span> Calculando…' : 'Calcular / recalcular'}</button>${completenessBadge(t)}</div>
      ${partialBanner(t)}
      <div class="kpis">${kpis}</div>${extra}
      <div class="card"><div class="card-head"><h3>Detalle por fuente</h3><button class="btn ghost small" data-action="export-csv">Exportar CSV</button></div>
        <div class="table-wrap"><table><thead><tr><th>Fuente</th><th>${S.FOOTPRINT_TYPES[p.type].groupName}</th><th>Factor</th><th class="num">kgCO₂e</th><th class="num">±%</th></tr></thead>
        <tbody>${t.rows.map((r) => `<tr><td>${esc(r.s.description)}${r.derived ? ' <span class="badge">aguas arriba</span>' : ''}</td><td>${esc((p.groups.find((g) => g.id === r.s.groupId) || {}).name || '—')}</td>
          <td class="small">${r.s.method === 'library' ? esc((C.libFactor(state.lib, r.s.libraryFactorId) || {}).code || '') + ' (biblioteca)' : r.s.method === 'climatiq' ? 'Climatiq' : 'Red eléctrica'}</td>
          <td class="num">${fmtK(r.kg)}</td><td class="num">${fmtN(r.u, 0)}</td></tr>`).join('')}
          <tr class="total"><td colspan="3">Total${t.isPartial ? ' (parcial)' : ''}</td><td class="num">${fmtK(t.total)}</td><td class="num">${fmtN(t.uncertainty, 1)}</td></tr></tbody></table></div></div>`;
  }

  // ---------------- Paso: escenarios (evento) ----------------
  function renderEscenarios() {
    const p = project, t = C.compute(p, state.lib);
    const srcOpts = [['', 'Elegí una fuente…'], ...t.rows.filter((r) => !r.derived).map((r) => [r.s.id, r.s.description])];
    const facOpts = [['', 'Mismo factor'], ...state.lib.map((f) => [f.id, `${f.code} — ${f.name} (kgCO₂e/${Un.label(f.activity_unit)})`])];
    return stepHead(stepNum('escenarios'), 'Escenarios de reducción', 'Proponé medidas (transporte compartido, cambio de menú, energía renovable) y documentá la reducción calculada respecto del escenario base.') + `
      ${t.isPartial ? partialBanner(t) : ''}
      <div class="row" style="margin-bottom:12px"><span class="grow muted">Escenario base: <strong>${fmtK(t.total)} kgCO₂e</strong>${t.perAttendee != null ? ` · ${fmtK(t.perAttendee, 2)} kg/asistente` : ''}</span><button class="btn" data-action="add-scenario">+ Nuevo escenario</button></div>
      ${!(p.scenarios || []).length ? '<div class="card empty">Sin escenarios. Ejemplos: 40% de asistentes en transporte compartido; menú vegetariano; electricidad con certificado renovable.</div>' : ''}
      ${(p.scenarios || []).map((sc, i) => {
        const r = C.scenarioResult(p, state.lib, sc, t);
        return `<div class="card">
          <div class="grid two">${field('Nombre del escenario', `p.scenarios.${i}.name`)}${field('Descripción y supuestos', `p.scenarios.${i}.description`)}</div>
          <table style="margin-top:12px"><thead><tr><th>Fuente</th><th>Cambio del dato (%)</th><th>Factor alternativo (biblioteca)</th><th></th></tr></thead><tbody>
            ${(sc.adjustments || []).map((a, j) => `<tr>
              <td>${field('', `p.scenarios.${i}.adjustments.${j}.sourceId`, { type: 'select', rerender: true, options: srcOpts })}</td>
              <td>${field('', `p.scenarios.${i}.adjustments.${j}.qtyPct`, { type: 'number', step: 'any', placeholder: 'Ej. -40' })}</td>
              <td>${field('', `p.scenarios.${i}.adjustments.${j}.factorId`, { type: 'select', rerender: true, options: facOpts })}</td>
              <td><button class="icon-btn" data-action="remove-adjustment" data-i="${i}" data-j="${j}" title="Quitar">×</button></td></tr>`).join('')}
          </tbody></table>
          <div class="row" style="margin-top:10px"><button class="btn ghost small" data-action="add-adjustment" data-i="${i}">+ Agregar cambio</button><span class="grow"></span>
            <span class="calc-preview">Escenario: <strong>${fmtK(r.total)} kgCO₂e</strong> · reducción <strong>${fmtK(r.reduction)} kg (${fmtN(r.reductionPct, 1)}%)</strong>${num(p.event.attendees) > 0 ? ` · ${fmtK(r.total / num(p.event.attendees), 2)} kg/asistente` : ''}</span>
            <button class="btn danger small" data-action="remove-scenario" data-i="${i}">Eliminar</button></div>
        </div>`;
      }).join('')}
`;
  }

  // ---------------- Paso: gestión ISO 20121 (evento) ----------------
  function renderGestion() {
    const statusOpts = [['', 'Sin evaluar'], ['Cumple', 'Cumple'], ['Parcial', 'Parcial'], ['No cumple', 'No cumple'], ['No aplica', 'No aplica']];
    return stepHead(stepNum('gestion'), 'Gestión sostenible del evento (ISO 20121)', 'Evaluación cualitativa de temas ambientales, sociales y de organización. <strong>No genera tCO₂e</strong> ni sustituye la cuantificación de GEI.') + `
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Aspecto y pregunta</th><th>Evidencia esperada</th><th>Estado</th><th>Responsable</th><th>Mejora propuesta</th><th></th></tr></thead><tbody>
        ${project.iso20121.map((a, i) => `<tr>
          <td style="min-width:220px">${field('', `p.iso20121.${i}.aspect`)}${field('', `p.iso20121.${i}.question`)}</td>
          <td>${field('', `p.iso20121.${i}.evidence`)}</td>
          <td style="min-width:120px">${field('', `p.iso20121.${i}.status`, { type: 'select', rerender: true, options: statusOpts })}</td>
          <td>${field('', `p.iso20121.${i}.responsible`)}</td>
          <td style="min-width:200px">${field('', `p.iso20121.${i}.improvement`, { type: 'textarea' })}</td>
          <td><button class="icon-btn" data-action="remove-iso" data-i="${i}" title="Quitar">×</button></td></tr>`).join('')}
      </tbody></table></div>
      <button class="btn ghost small" data-action="add-iso" style="margin-top:10px">+ Agregar aspecto</button></div>`;
  }

  // ---------------- Paso: sensibilidad (producto) ----------------
  function renderSensibilidad() {
    const p = project, t = C.compute(p, state.lib);
    const srcOpts = [['', 'Elegí una fuente…'], ...t.rows.map((r) => [r.s.id, `${r.s.description} (${fmtK(r.kg)} kg)`])];
    return stepHead(stepNum('sensibilidad'), 'Análisis de sensibilidad', 'Evaluá cómo cambia el resultado si varía el factor de una fuente (p. ej. +10% en el factor del papel). Cada variación afecta solo a esa fuente.') + `
      ${t.isPartial ? partialBanner(t) : ''}
      <div class="row" style="margin-bottom:12px"><span class="grow muted">Base: <strong>${fmtK(t.total)} kgCO₂e</strong> por lote${t.perUnit != null ? ` · ${fmtK(t.perUnit, 4)} kg/unidad` : ''}</span><button class="btn" data-action="add-sensitivity">+ Agregar análisis</button></div>
      ${!(p.sensitivity || []).length ? '<div class="card empty">Sin análisis. Empezá por la fuente que más pesa.</div>' : `
      <div class="card table-wrap"><table><thead><tr><th>Fuente</th><th>Variación del factor (%)</th><th class="num">Δ kgCO₂e</th><th class="num">Nuevo total</th><th class="num">Δ %</th><th class="num">Nuevo kg/unidad</th><th></th></tr></thead><tbody>
        ${p.sensitivity.map((row, i) => {
          const r = C.sensitivityResult(p, state.lib, row, t);
          return `<tr><td style="min-width:240px">${field('', `p.sensitivity.${i}.sourceId`, { type: 'select', rerender: true, options: srcOpts })}</td>
            <td>${field('', `p.sensitivity.${i}.pct`, { type: 'number', step: 'any' })}</td>
            <td class="num">${r.found ? fmtK(r.delta) : '—'}</td><td class="num">${r.found ? fmtK(r.total) : '—'}</td><td class="num">${r.found ? fmtN(r.deltaPct, 2) + '%' : '—'}</td>
            <td class="num">${r.found && num(p.product.lotSize) > 0 ? fmtK(r.total / num(p.product.lotSize), 4) : '—'}</td>
            <td><button class="icon-btn" data-action="remove-sensitivity" data-i="${i}">×</button></td></tr>`;
        }).join('')}
      </tbody></table></div>`}`;
  }

  // ---------------- Paso: calidad ----------------
  function renderCalidad() {
    const p = project, t = C.compute(p, state.lib);
    const withIssues = p.sources.filter((s) => t.validations[s.id].issues.some((x) => x.level !== 'info'));
    const byMethod = {};
    t.rows.forEach((r) => { const m = r.s.quality.method; byMethod[m] = (byMethod[m] || 0) + r.kg; });
    const checks = [
      ['Objetivo y responsable documentados', !!(p.purpose.objective && p.purpose.responsible)],
      ['Sin fuentes pendientes de decisión', t.counts.pendingDecision === 0],
      ['Exclusiones justificadas', p.sources.filter((s) => s.include === 'no').every((s) => String(s.justification || '').trim())],
      ['Sin errores de validación (unidades, datos, factores)', t.counts.withErrors === 0],
      ['Todas las fuentes incluidas calculadas (completitud 100%)', t.completeness === 1 && p.sources.length > 0],
      ['Todas las fuentes con evidencia y responsable', p.sources.filter((s) => s.include === 'yes').every((s) => String(s.evidence || '').trim() && String(s.custodian || '').trim())],
      ['Factores de la biblioteca con fuente documentada', t.factors.filter((x) => x.kind === 'library').every((x) => String(x.f.source || '').trim())],
      ...(p.type === 'organizacion' ? [['Límites de informe evaluados', boundaryIssues().length === 0]] : []),
      ...(p.type === 'producto' ? [['Criterio de asignación en cada fuente', p.sources.filter((s) => s.include === 'yes').every((s) => String(s.allocation || '').trim())]] : []),
    ];
    return stepHead(stepNum('calidad'), 'Calidad, validación e incertidumbre', 'La app valida coherencia de unidades, datos faltantes o negativos, factores sin fuente, cambios de factor posteriores al cálculo y posibles dobles conteos.') + `
      ${partialBanner(t)}
      <div class="grid two">
        <div class="card"><h2>Lista de verificación</h2><table><tbody>${checks.map(([l, ok]) => `<tr><td>${ok ? '<span class="badge ok">✓</span>' : '<span class="badge warn">Pendiente</span>'}</td><td>${l}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><h2>Indicadores</h2>
          <div class="kpi-inline"><span>Completitud</span><strong>${fmtN(t.completeness * 100, 0)}%</strong></div><div class="meter"><div style="width:${t.completeness * 100}%"></div></div>
          <div class="kpi-inline" style="margin-top:12px"><span>Incertidumbre combinada</span><strong>±${fmtN(t.uncertainty, 1)}%</strong></div>
          <p class="muted small">Propagación de errores (IPCC 2006, vol. 1, cap. 3, enfoque 1): U = √Σ(Eᵢ·Uᵢ)² / ΣEᵢ.</p>
          <h3>Emisiones según tipo de dato</h3>${bars(Object.entries(byMethod).map(([m, v]) => ({ label: S.DATA_METHODS[m] || m, v })))}
        </div>
      </div>
      <div class="card"><h2>Validación por fuente</h2>
        ${withIssues.length ? withIssues.map((s) => `<div class="val-item"><a href="#/huella/${state.fp.id}/fuentes" data-action="focus-source" data-id="${s.id}"><strong>${esc(s.description)}</strong></a>${validationPanel(t.validations[s.id])}</div>`).join('') : '<p>✓ Ninguna fuente tiene observaciones.</p>'}
      </div>
      <div class="card"><h2>Principios</h2>
        ${principlesFor().map((pr) => `<div class="principle">${check(`<strong>${pr.name}</strong> — <span class="muted">${pr.help}</span>`, `p.purpose.principles.${pr.id}`, { rerender: true })}</div>`).join('')}
      </div>`;
  }

  // ---------------- Paso: informe ----------------
  function reportCtx(draft, version) {
    const t = C.compute(project, state.lib);
    return { project, client: state.client, lib: state.lib, t, settings, draft, version };
  }
  function emitBlockers(t) {
    const out = [];
    if (t.completeness < 1) out.push(`Completitud ${fmtN(t.completeness * 100, 0)}%: faltan fuentes por decidir o calcular.`);
    if (t.counts.withErrors) out.push(`${t.counts.withErrors} fuente(s) con errores de validación.`);
    if (!project.sources.length) out.push('No hay fuentes.');
    boundaryIssues().forEach((x) => out.push(x));
    if (!project.purpose.objective) out.push('Falta el objetivo del estudio.');
    return out;
  }
  function renderInforme() {
    const t = C.compute(project, state.lib);
    const blockers = emitBlockers(t);
    const draft = blockers.length > 0;
    const blocks = R.model(reportCtx(draft, null));
    const nextV = (state.versions[0] ? state.versions[0].version : 0) + 1;
    return `
      <div class="row no-print" style="margin-bottom:16px">
        <button class="btn" data-action="export-word" ${ui.wordBusy ? 'disabled' : ''}>${ui.wordBusy ? '<span class="spinner"></span> Generando…' : draft ? 'Descargar Word (borrador)' : 'Descargar Word'}</button>
        <button class="btn ${draft ? 'ghost' : ''}" data-action="emit" ${draft ? 'disabled title="Resolvé los pendientes para emitir"' : ''}>Emitir informe (versión ${nextV})</button>
        <button class="btn ghost" data-action="print">Imprimir / PDF</button>
        <button class="btn ghost" data-action="export-csv">Exportar CSV</button>
      </div>
      ${draft ? `<div class="callout warn no-print"><p><strong>No se puede emitir todavía:</strong></p><ul>${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul><p>El Word se descarga marcado como <strong>BORRADOR</strong>.</p></div>` : '<div class="callout no-print"><p>✓ Listo para emitir. Al emitir se guarda una versión inmutable con los datos, factores y resultados, que queda en el historial.</p></div>'}
      ${state.versions.length ? `<div class="card no-print"><h3>Versiones emitidas</h3><table><thead><tr><th>Versión</th><th>Fecha</th><th class="num">Total</th><th></th></tr></thead><tbody>
        ${state.versions.map((v) => `<tr><td>v${v.version}</td><td>${fmtDate(v.created_at)}</td><td class="num">${v.totals ? fmtK(v.totals.total_kg) + ' kgCO₂e' : '—'}</td><td class="num"><button class="btn ghost small" data-action="download-version" data-id="${v.id}">Descargar Word</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <article class="report">${R.toHtml(blocks)}</article>`;
  }

  async function exportWord(fromSnapshot) {
    ui.wordBusy = true; render();
    try {
      let ctx, version = null;
      if (fromSnapshot) {
        const v = fromSnapshot;
        const snap = v.data;
        const t = C.compute(snap.project, snap.lib);
        ctx = { project: snap.project, client: snap.client, lib: snap.lib, t, settings: snap.settings, draft: false, version: v.version };
        version = v.version;
      } else {
        const t = C.compute(project, state.lib);
        const draft = emitBlockers(t).length > 0;
        const last = state.fp.status === 'emitido' && state.versions[0] ? state.versions[0].version : null;
        ctx = { ...reportCtx(draft, draft ? null : last) };
        version = draft ? null : last;
      }
      const blocks = R.model(ctx);
      const blob = await R.toDocxBlob(blocks, {
        title: `${S.FOOTPRINT_TYPES[ctx.project.type].name} — ${ctx.client.name}`, description: S.FOOTPRINT_TYPES[ctx.project.type].norms,
        header: `${ctx.client.name} · ${state.fp.name}${ctx.draft ? ' · BORRADOR' : version ? ' · v' + version : ''}`, draft: ctx.draft,
      });
      download(`${slug(ctx.client.name)}-${slug(state.fp.name)}${ctx.draft ? '-BORRADOR' : version ? '-v' + version : ''}.docx`, blob);
      audit('informe_descargado', { borrador: !!ctx.draft, version });
      toast(ctx.draft ? 'Word descargado como BORRADOR.' : 'Informe Word descargado.');
    } catch (e) { toast('No se pudo generar el Word: ' + e.message, true); }
    finally { ui.wordBusy = false; render(); }
  }

  async function emit() {
    const t = C.compute(project, state.lib);
    if (emitBlockers(t).length) return toast('Hay pendientes: no se puede emitir.', true);
    // Evita que un guardado automático pendiente se ejecute después de emitir y la devuelva a borrador
    clearTimeout(saveTimer);
    const nextV = (state.versions[0] ? state.versions[0].version : 0) + 1;
    if (!confirm(`Vas a emitir la versión ${nextV} de "${state.fp.name}". Se guarda una copia inmutable con los datos, los factores y los resultados actuales. ¿Continuar?`)) return;
    const usedIds = new Set(project.sources.map((s) => s.libraryFactorId).filter(Boolean));
    (project.scenarios || []).forEach((sc) => (sc.adjustments || []).forEach((a) => a.factorId && usedIds.add(a.factorId)));
    const snapshot = { project: JSON.parse(JSON.stringify(project)), lib: state.lib.filter((f) => usedIds.has(f.id)), client: state.client, settings: { ...settings } };
    const totals = { total_kg: t.total, completeness: t.completeness, s1: t.s1, s2loc: t.s2loc, s2mkt: t.s2mkt, s3: t.s3, perUnit: t.perUnit ?? null, perAttendee: t.perAttendee ?? null, uncertainty: t.uncertainty };
    try {
      const v = await DB.footprints.addVersion({ footprint_id: state.fp.id, version: nextV, data: snapshot, totals });
      await DB.footprints.update(state.fp.id, { status: 'emitido', total_kg: t.total, completeness: t.completeness, data: project });
      state.fp.status = 'emitido';
      state.versions = await DB.footprints.versions(state.fp.id);
      audit('informe_emitido', { version: nextV, total_kg: t.total });
      toast(`Versión ${nextV} emitida.`);
      render();
      await exportWord(v);
    } catch (e) { toast('No se pudo emitir: ' + e.message, true); }
  }

  function exportCsv() {
    const t = C.compute(project, state.lib);
    const head = [S.FOOTPRINT_TYPES[project.type].groupName, 'Fuente', ...(project.type === 'organizacion' ? ['Alcance', 'Categoria'] : ['Tipo']), 'Incluida', 'Metodo', 'Factor', 'Valor factor', 'Unidad factor', 'Fuente factor', 'Dato actividad', 'Unidad dato', 'kgCO2e', 'Incertidumbre %', 'Evidencia', 'Responsable', 'Justificacion'];
    const rows = project.sources.map((s) => {
      const f = C.libFactor(state.lib, s.libraryFactorId);
      const r = t.rows.find((x) => x.s.id === s.id && !x.derived);
      const cat = S.byId[s.catId];
      let fname = '', fval = '', funit = '', fsrc = '', qty = '', unit = '';
      if (s.method === 'library' && f) { fname = f.code + ' ' + f.name; fval = f.value; funit = 'kgCO2e/' + Un.label(f.activity_unit); fsrc = f.source; qty = s.quantity; unit = Un.label(s.unit); }
      if (s.method === 'climatiq' && s.factor) { fname = s.factor.name; fsrc = s.factor.source; const sp = S.UNIT_TYPES[s.factor.unit_type] || []; qty = sp.map((p) => s.params[p.key]).join(' x '); unit = sp.map((p) => s.params[p.key + '_unit'] || p.key).join(' x '); }
      if (s.method === 'electricity') { fname = 'Red eléctrica'; fsrc = 'Climatiq Energy API'; qty = s.elec.energy; unit = s.elec.unit; }
      return [(project.groups.find((g) => g.id === s.groupId) || {}).name, s.description, ...(project.type === 'organizacion' ? [cat ? cat.scope : '', cat ? cat.name : ''] : [s.activityType]),
        { yes: 'Si', no: 'No', pending: 'Pendiente' }[s.include], s.method, fname, fval, funit, fsrc, qty, unit, r ? r.kg.toFixed(4) : '', r ? r.u.toFixed(1) : '', s.evidence, s.custodian, s.justification];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(`${slug(state.client.name)}-${slug(state.fp.name)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  }

  // ============================================================
  // Modales
  // ============================================================
  function modalShell(title, body, size) {
    return `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal${size ? ' ' + size : ''}" role="dialog" aria-modal="true"><div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">×</button></div><div class="modal-body">${body}</div></div></div>`;
  }
  function renderModal() {
    const el = document.getElementById('modal-root');
    const m = ui.modal;
    if (!m) { el.innerHTML = ''; return; }
    if (m === 'search') el.innerHTML = searchModal();
    else if (m === 'factor') el.innerHTML = factorFormModal();
    else if (m === 'paste') el.innerHTML = pasteModal();
    else if (m === 'client') el.innerHTML = modalShell('Nuevo cliente', `<form data-action-submit="create-client">${clientForm()}<div class="row" style="margin-top:16px"><span class="grow"></span><button class="btn ghost" type="button" data-action="close-modal">Cancelar</button><button class="btn" type="submit">Crear cliente</button></div></form>`, 'narrow');
    else if (m === 'footprint') el.innerHTML = footprintModal();
  }
  function footprintModal() {
    const f = ui.form;
    return modalShell('Nueva huella', `<form data-action-submit="create-footprint">
      <p class="muted small">Elegí el tipo de huella. Cada tipo tiene su propio asistente, sus límites y su informe.</p>
      <div class="type-cards">${Object.entries(S.FOOTPRINT_TYPES).map(([k, v]) => `<label class="type-card${f.type === k ? ' on' : ''}"><input type="radio" name="fptype" value="${k}" data-bind="ui.form.type" data-rerender${f.type === k ? ' checked' : ''}>
        <strong>${v.name}</strong><span class="muted small">${v.desc}</span><span class="badge">${v.norms}</span></label>`).join('')}</div>
      <div class="grid" style="margin-top:14px">
        ${field(f.type === 'evento' ? 'Nombre del evento' : f.type === 'producto' ? 'Producto' : 'Nombre de la huella', 'ui.form.name', { required: true, placeholder: f.type === 'evento' ? 'Convención comercial 2025' : f.type === 'producto' ? 'Caja premium para vino' : 'Inventario GEI 2025' })}
        ${field('Año', 'ui.form.year', { type: 'number', step: 1 })}
      </div>
      <div class="row" style="margin-top:16px"><span class="grow"></span><button class="btn ghost" type="button" data-action="close-modal">Cancelar</button><button class="btn" type="submit" ${f.type ? '' : 'disabled'}>Crear</button></div></form>`);
  }
  function searchModal() {
    const q = ui.search;
    const s = project.sources.find((x) => x.id === q.sourceId);
    const cat = s && S.byId[s.catId];
    const pf = q.possible || {};
    const opt = (arr, cur) => `<option value="">Todos</option>${(arr || []).map((v) => `<option${String(cur) === String(v) ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
    return modalShell('Buscar factor en Climatiq', `
      <form data-action-submit="run-search"><div class="grid">
        ${field('Búsqueda (en inglés)', 'ui.search.query', { type: 'search', placeholder: 'natural gas, diesel, electricity…' })}
        ${field('Región', 'ui.search.region', { placeholder: 'AR (vacío = todas)' })}
        ${field('Año', 'ui.search.year', { type: 'number', step: 1 })}
      </div><div class="grid" style="margin-top:10px">
        <label class="field"><span>Tipo de unidad</span><select data-bind="ui.search.unit_type">${opt(pf.unit_type, q.unit_type)}</select></label>
        <label class="field"><span>Fuente</span><select data-bind="ui.search.source">${opt((pf.source || []).map((x) => x.source), q.source)}</select></label>
        <div class="field"><span>&nbsp;</span><button class="btn" type="submit">${q.loading ? '<span class="spinner"></span>' : 'Buscar'}</button></div>
      </div></form>
      ${cat ? `<div class="chips" style="margin-top:12px"><span class="muted small">Sugerencias:</span>${cat.queries.map((x) => `<button class="chip" data-action="search-chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
      ${q.error ? `<div class="callout danger" style="margin-top:14px"><p>${esc(q.error)}</p></div>` : ''}
      ${q.results ? `<p class="muted small" style="margin-top:14px">${q.total} resultado(s). Preferí factores del país, del año más cercano y de fuentes oficiales. Si no hay datos para AR, quitá la región.</p>` : ''}
      ${(q.results || []).map((r, k) => `<div class="result-item"><div><strong>${esc(r.name)}</strong>
        <div class="meta"><b>${esc(r.source)}</b>${r.source_dataset ? ' · ' + esc(r.source_dataset) : ''} · <b>${esc(r.region_name || r.region)}</b> · ${esc(r.year)} · ${esc(r.unit_type)}${r.factor != null ? ` · <b>${fmtN(r.factor, 5)} ${esc(r.unit)}</b>` : ''}</div>
        <div class="meta"><code>${esc(r.activity_id)}</code></div></div><div><button class="btn small" data-action="pick-factor" data-k="${k}">Usar</button></div></div>`).join('')}
      ${q.results && !q.results.length ? '<div class="empty">Sin resultados. Probá otra palabra en inglés o quitá la región.</div>' : ''}`);
  }
  async function runSearch() {
    const q = ui.search;
    q.loading = true; q.error = null; renderModal();
    try {
      const data = await API.search({ query: q.query, region: q.region ? q.region.trim().toUpperCase() : '', year: q.year, unit_type: q.unit_type, source: q.source });
      q.results = data.results || []; q.total = data.total_results ?? q.results.length; q.possible = data.possible_filters || q.possible;
      if ((data.notices || []).some((n) => n.code === 'premium_data_available') && !q.results.length) q.error = 'No hay datos públicos; existen factores premium que coinciden.';
    } catch (e) { q.error = e.message; q.results = null; }
    q.loading = false; renderModal();
  }

  // ============================================================
  // Acciones
  // ============================================================
  const findSource = (id) => project.sources.find((x) => x.id === id);
  const actions = {
    'toggle-nav'() { ui.navOpen = !ui.navOpen; document.getElementById('steps-nav').classList.toggle('open', ui.navOpen); },
    refresh() { render(); },
    'close-modal'() { ui.modal = null; ui.search = null; renderModal(); },
    'close-modal-bg'(d, el, ev) { if (ev.target === el) actions['close-modal'](); },
    async logout() { await DB.auth.signOut(); },

    // ----- clientes -----
    'new-client'() { ui.form = {}; ui.modal = 'client'; renderModal(); },
    async 'save-client'() {
      try {
        const f = ui.form;
        if (f.cuit && !S.validCuit(f.cuit) && !confirm('El CUIT no es válido. ¿Guardar igual?')) return;
        state.client = await DB.clients.update(state.client.id, pickClient(f));
        toast('Cliente actualizado.'); render();
      } catch (e) { toast(e.message, true); }
    },
    async 'delete-client'() {
      const name = prompt(`Para eliminar "${state.client.name}" con todas sus huellas y factores, escribí su nombre:`);
      if (name !== state.client.name) { if (name !== null) toast('El nombre no coincide.', true); return; }
      try { await DB.clients.remove(state.client.id); state.client = null; toast('Cliente eliminado.'); go('#/clientes'); } catch (e) { toast(e.message, true); }
    },

    // ----- huellas -----
    'new-footprint'() { ui.form = { type: 'organizacion', year: new Date().getFullYear() - 1, name: '' }; ui.modal = 'footprint'; renderModal(); },
    async 'delete-footprint'(d) {
      if (!confirm(`¿Eliminar la huella "${d.name}" y sus versiones emitidas? Esta acción no se puede deshacer.`)) return;
      try { await DB.footprints.remove(d.id); state.footprints = state.footprints.filter((f) => f.id !== d.id); if (state.fp && state.fp.id === d.id) { state.fp = null; project = null; } toast('Huella eliminada.'); render(); } catch (e) { toast(e.message, true); }
    },

    // ----- factores -----
    'new-factor'() { ui.form = { activity_unit: '' }; ui.modal = 'factor'; renderModal(); },
    'new-factor-inline'(d) { ui.form = { activity_unit: '', __forSource: d.id }; ui.modal = 'factor'; renderModal(); },
    'edit-factor'(d) { const f = state.lib.find((x) => x.id === d.id); ui.form = { ...f }; ui.modal = 'factor'; renderModal(); },
    async 'delete-factor'(d) {
      const f = state.lib.find((x) => x.id === d.id);
      if (!confirm(`¿Eliminar el factor ${f.code}? Las fuentes que lo usan quedarán inválidas hasta que elijas otro.`)) return;
      try { await DB.factors.remove(d.id); state.lib = state.lib.filter((x) => x.id !== d.id); toast('Factor eliminado.'); render(); } catch (e) { toast(e.message, true); }
    },
    'paste-factors'() { ui.form = { paste: '' }; ui.modal = 'paste'; renderModal(); },
    'refresh-paste'() { renderModal(); },
    async 'import-factors'() {
      const rows = parsePasted(ui.form.paste).filter((r) => !r.error && !r.warn);
      try {
        const created = await DB.factors.bulkInsert(rows.map((r) => ({ client_id: state.client.id, code: r.code, name: r.name || r.code, value: r.value, activity_unit: r.activity_unit, source: r.source || null, year: r.year })));
        state.lib = await DB.factors.list(state.client.id);
        audit('importados', { cantidad: created.length }, 'factor');
        ui.modal = null; toast(`${created.length} factores importados.`); render();
      } catch (e) { toast(e.message, true); }
    },
    'export-factors'() {
      const csv = [['Codigo', 'Actividad', 'Factor', 'Unidad del factor', 'Fuente', 'Año', 'Incertidumbre', 'Notas'], ...state.lib.map((f) => [f.code, f.name, f.value, 'kgCO2e/' + Un.label(f.activity_unit), f.source, f.year, f.uncertainty, f.notes])]
        .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
      download(`factores-${slug(state.client.name)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
    },

    // ----- cuenta -----
    async 'save-key'() {
      const k = String(ui.form.key || '').trim();
      if (k.length < 10) return toast('Ingresá una API key válida.', true);
      try { await DB.profile.setKey(k); ui.form.key = ''; state.keyStatus = await DB.profile.keyStatus(); toast('API key guardada.'); render(); actions['test-api'](); } catch (e) { toast(e.message, true); }
    },
    async 'delete-key'() {
      if (!confirm('¿Eliminar tu API key de Climatiq?')) return;
      try { await DB.profile.deleteKey(); state.keyStatus = await DB.profile.keyStatus(); toast('API key eliminada.'); render(); } catch (e) { toast(e.message, true); }
    },
    async 'test-api'() {
      const show = (html) => document.querySelectorAll('.api-status').forEach((b) => { b.innerHTML = html; });
      show('<span class="muted"><span class="spinner"></span> Probando…</span>');
      try {
        const r = await API.search({ query: 'electricity', results_per_page: 1 });
        show(`<div class="callout"><p>✓ Conexión correcta: ${fmtN(r.total_results, 0)} factores para "electricity" (versión ${esc(settings.dataVersion)}).</p></div>`);
      } catch (e) { show(`<div class="callout danger"><p>${esc(e.message)}</p></div>`); }
    },
    async 'save-profile'() {
      try { state.profile = await DB.profile.update({ full_name: ui.form.full_name, company: ui.form.company }); toast('Perfil guardado.'); } catch (e) { toast(e.message, true); }
    },
    async 'change-password'() {
      const pw = String(ui.form.newpass || '');
      if (pw.length < 8) return toast('La contraseña debe tener al menos 8 caracteres.', true);
      try { await DB.auth.updatePassword(pw); ui.form.newpass = ''; toast('Contraseña actualizada.'); render(); } catch (e) { toast(e.message, true); }
    },

    // ----- grupos -----
    'add-group'() {
      const T = S.FOOTPRINT_TYPES[project.type];
      project.groups.push(project.type === 'organizacion'
        ? { id: uid(), name: '', type: 'office', region: 'AR', address: '', province: '', equity: 100, control: true }
        : { id: uid(), name: `${T.groupName} ${project.groups.length + 1}`, description: '' });
      saveFootprint(); render();
    },
    'add-lifecycle'() {
      ['Distribución', 'Uso del producto', 'Fin de vida'].forEach((n) => { if (!project.groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) project.groups.push({ id: uid(), name: n, description: '' }); });
      saveFootprint(); render();
    },
    'remove-group'(d) {
      const used = project.sources.filter((s) => s.groupId === d.id).length;
      if (used && !confirm(`Tiene ${used} fuente(s) asignadas, que quedarán sin asignar (y serán inválidas). ¿Eliminar?`)) return;
      project.groups = project.groups.filter((g) => g.id !== d.id); saveFootprint(); render();
    },
    'move-group'(d) {
      const i = project.groups.findIndex((g) => g.id === d.id), j = i + Number(d.dir);
      if (j < 0 || j >= project.groups.length) return;
      [project.groups[i], project.groups[j]] = [project.groups[j], project.groups[i]]; saveFootprint(); render();
    },

    // ----- fuentes -----
    'add-source'() {
      const gid = (document.getElementById('new-group') || {}).value;
      const catEl = document.getElementById('new-cat');
      if (!gid) return toast(`Primero agregá ${S.FOOTPRINT_TYPES[project.type].groupName.toLowerCase()}s.`, true);
      if (project.type === 'organizacion' && !(catEl && catEl.value)) return toast('Incluí al menos una categoría en el paso 3.', true);
      const s = newSource(gid, catEl ? catEl.value : null);
      project.sources.push(s); ui.open[s.id] = true;
      audit('agregada', { descripcion: s.description }, 'fuente');
      saveFootprint(); render();
    },
    'toggle-source'(d) { ui.open[d.id] = !ui.open[d.id]; render(); },
    'focus-source'(d) { ui.open = { [d.id]: true }; ui.groupFilter = ''; },
    'remove-source'(d) {
      const s = findSource(d.id);
      if (!confirm(`¿Eliminar la fuente "${s.description}"?`)) return;
      project.sources = project.sources.filter((x) => x.id !== d.id);
      (project.sensitivity || []).forEach((r) => { if (r.sourceId === d.id) r.sourceId = ''; });
      audit('eliminada', { descripcion: s.description }, 'fuente');
      saveFootprint(); render();
    },
    'dup-source'(d) {
      const s = findSource(d.id);
      const c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.description += ' (copia)'; c.result = null; c.error = null;
      project.sources.splice(project.sources.indexOf(s) + 1, 0, c); ui.open[c.id] = true; saveFootprint(); render();
    },
    'set-method'(d) { const s = findSource(d.id); s.method = d.method; s.result = null; s.error = null; computeLibrarySource(s); saveFootprint(); render(); },
    'open-search'(d) {
      const s = findSource(d.id);
      const g = project.groups.find((x) => x.id === s.groupId);
      ui.search = { sourceId: s.id, query: s.searchHint || (S.byId[s.catId] || { queries: [''] }).queries[0], region: (g && g.region) || '', year: '', unit_type: '', source: '', results: null, possible: null };
      ui.modal = 'search'; renderModal(); runSearch();
    },
    'search-chip'(d) { ui.search.query = d.q; ui.search.unit_type = ''; ui.search.source = ''; runSearch(); },
    'pick-factor'(d) {
      const r = ui.search.results[Number(d.k)];
      const s = findSource(ui.search.sourceId);
      const keep = s.params || {};
      s.factor = { id: r.id, activity_id: r.activity_id, name: r.name, source: r.source, source_dataset: r.source_dataset, year: r.year, region: r.region, region_name: r.region_name, unit_type: r.unit_type, unit: r.unit, factor: r.factor, uncertainty: r.uncertainty, supported_calculation_methods: r.supported_calculation_methods };
      const params = {};
      (S.UNIT_TYPES[r.unit_type] || []).forEach((p) => {
        params[p.key] = keep[p.key] ?? (p.key === 'passengers' ? 1 : '');
        if (p.units) params[p.key + '_unit'] = p.units.includes(keep[p.key + '_unit']) ? keep[p.key + '_unit'] : p.units[0];
      });
      s.params = params; s.searchHint = ui.search.query; s.result = null; s.error = null;
      ui.search = null; ui.modal = null; saveFootprint(); render();
    },
    calculate() { calculateAll(); },

    // ----- escenarios / sensibilidad / ISO -----
    'add-scenario'() { project.scenarios.push({ id: uid(), name: `Escenario ${project.scenarios.length + 1}`, description: '', adjustments: [{ sourceId: '', qtyPct: '', factorId: '' }] }); saveFootprint(); render(); },
    'remove-scenario'(d) { project.scenarios.splice(Number(d.i), 1); saveFootprint(); render(); },
    'add-adjustment'(d) { project.scenarios[Number(d.i)].adjustments.push({ sourceId: '', qtyPct: '', factorId: '' }); saveFootprint(); render(); },
    'remove-adjustment'(d) { project.scenarios[Number(d.i)].adjustments.splice(Number(d.j), 1); saveFootprint(); render(); },
    'add-sensitivity'() { const t = C.compute(project, state.lib); const top = t.rows.slice().sort((a, b) => b.kg - a.kg)[0]; project.sensitivity.push({ id: uid(), sourceId: top ? top.s.id : '', pct: 10 }); saveFootprint(); render(); },
    'remove-sensitivity'(d) { project.sensitivity.splice(Number(d.i), 1); saveFootprint(); render(); },
    'add-iso'() { project.iso20121.push({ id: uid(), aspect: '', question: '', evidence: '', status: '', responsible: '', improvement: '' }); saveFootprint(); render(); },
    'remove-iso'(d) { project.iso20121.splice(Number(d.i), 1); saveFootprint(); render(); },

    // ----- informe -----
    'export-word'() { if (!ui.wordBusy) exportWord(); },
    async 'download-version'(d) { try { const v = await DB.footprints.getVersion(d.id); await exportWord(v); } catch (e) { toast(e.message, true); } },
    emit() { emit(); },
    print() { window.print(); },
    'export-csv'() { exportCsv(); },
  };

  function pickClient(f) {
    const out = {};
    ['name', 'cuit', 'sector', 'address', 'province', 'contact_name', 'contact_email', 'notes'].forEach((k) => { out[k] = f[k] === '' ? null : f[k]; });
    if (out.cuit) out.cuit = String(out.cuit).replace(/\D/g, '');
    return out;
  }

  const submits = {
    ingresar: () => submitAuth('ingresar'), registro: () => submitAuth('registro'), recuperar: () => submitAuth('recuperar'), 'nueva-clave': () => submitAuth('nueva-clave'),
    'run-search': () => runSearch(),
    async 'create-client'() {
      const f = ui.form;
      if (!String(f.name || '').trim()) return toast('Ingresá la razón social.', true);
      if (f.cuit && !S.validCuit(f.cuit) && !confirm('El CUIT no es válido. ¿Guardar igual?')) return;
      try { const c = await DB.clients.create(pickClient(f)); ui.modal = null; toast('Cliente creado.'); go(`#/cliente/${c.id}`); } catch (e) { toast(e.message, true); }
    },
    async 'create-footprint'() {
      const f = ui.form;
      if (!f.type || !String(f.name || '').trim()) return toast('Elegí el tipo y escribí un nombre.', true);
      const data = newProjectData(f.type, f.year, { name: f.name });
      try {
        const row = await DB.footprints.create({ client_id: state.client.id, type: f.type, name: f.name.trim(), period_year: Number(f.year) || null, data, completeness: 0 });
        ui.modal = null; state.fp = null; go(`#/huella/${row.id}/datos`);
      } catch (e) { toast(e.message, true); }
    },
    async 'save-factor'() {
      const f = ui.form;
      if (!String(f.code || '').trim() || !String(f.name || '').trim()) return toast('Completá código y actividad.', true);
      if (f.value === '' || f.value == null || !Number.isFinite(Number(f.value))) return toast('El factor debe ser numérico.', true);
      if (!f.activity_unit) return toast('Elegí la unidad de actividad.', true);
      if (!String(f.source || '').trim() && !confirm('El factor no tiene fuente o referencia. Para un informe verificable conviene documentarla. ¿Guardar igual?')) return;
      const row = { code: f.code.trim(), name: f.name.trim(), value: Number(f.value), activity_unit: f.activity_unit, source: f.source || null, year: f.year || null, uncertainty: f.uncertainty === '' ? null : f.uncertainty ?? null, notes: f.notes || null };
      try {
        let saved;
        if (f.id) saved = await DB.factors.update(f.id, row);
        else saved = await DB.factors.create({ ...row, client_id: state.client.id });
        state.lib = await DB.factors.list(state.client.id);
        if (f.__forSource && project) { const s = findSource(f.__forSource); if (s) { s.libraryFactorId = saved.id; if (!s.unit) s.unit = saved.activity_unit; computeLibrarySource(s); saveFootprint(); } }
        if (f.id && project) { project.sources.forEach((s) => { if (s.libraryFactorId === f.id) computeLibrarySource(s); }); saveFootprint(); }
        ui.modal = null; toast('Factor guardado.'); render();
      } catch (e) { toast(e.message, true); }
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    if (el.tagName === 'BUTTON' || (el.tagName === 'A' && el.getAttribute('href') === '#')) ev.preventDefault();
    const fn = actions[el.dataset.action];
    if (fn) fn(el.dataset, el, ev);
  });
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-action-submit]');
    if (!form) return;
    ev.preventDefault();
    const fn = submits[form.dataset.actionSubmit];
    if (fn) fn();
  });

  function readInput(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'radio') return el.value;
    if (el.hasAttribute('data-num')) return el.value === '' ? '' : Number(el.value);
    return el.value;
  }
  function onBind(ev) {
    const el = ev.target;
    const path = el.dataset && el.dataset.bind;
    if (!path) return;
    if (el.type === 'radio' && !el.checked) return;
    setPath(path, readInput(el));
    if (path.startsWith('settings.')) {
      storage.set(SETTINGS_KEY, settings); API.configure(settings);
      if (path === 'settings.theme') applyTheme();
      return;
    }
    if (path === 'ui.clientFilter' && el.dataset.live === 'clients') {
      const list = document.getElementById('clients-list');
      if (list) { const keep = el.selectionStart; render(); const inp = document.querySelector('[data-bind="ui.clientFilter"]'); if (inp) { inp.focus(); inp.setSelectionRange(keep, keep); } }
      return;
    }
    if (path.startsWith('p.')) {
      const m = path.match(/^p\.sources\.(\d+)\.(\w+)/);
      if (m) {
        const s = project.sources[Number(m[1])];
        if (['params', 'elec', 'libraryFactorId', 'quantity', 'unit', 'groupId', 'method', 'include', 'catId'].includes(m[2])) {
          s.error = null;
          if (m[2] === 'catId' && s.method === 'electricity' && !(S.byId[s.catId] || {}).electricity) s.method = project.settings.defaultMethod || 'library';
          if (m[2] === 'libraryFactorId') {
            const f = C.libFactor(state.lib, s.libraryFactorId);
            if (f && (!s.unit || Un.dim(s.unit) !== Un.dim(f.activity_unit))) s.unit = f.activity_unit;
          }
          if (s.method === 'library') computeLibrarySource(s); else s.result = null;
          if (m[2] === 'include' && s.include !== 'yes') s.result = s.method === 'library' ? null : s.result;
          if (ev.type === 'input' && s.method === 'library') updateSourceHeader(s);
        }
        if (m[2] === 'quality' && /quality\.method$/.test(path)) s.quality.uActivity = S.ACTIVITY_UNCERTAINTY[el.value] ?? 10;
      }
      saveFootprint();
    }
    if (ev.type === 'change' && el.hasAttribute('data-rerender')) render();
  }
  // Actualización liviana mientras se escribe (sin re-render completo)
  function updateSourceHeader(s) {
    const t = C.compute(project, state.lib);
    const head = document.querySelector(`.source-head[data-id="${s.id}"]`);
    const slot = head && head.querySelector('.status-slot');
    if (slot) slot.innerHTML = sourceStatus(s, t);
    renderStepsNav(parseRoute().b || 'fuentes');
  }
  document.addEventListener('input', onBind);
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') onBind(ev);
    // Al salir de un campo de texto de la huella se actualizan validaciones y totales (sin perder el foco del siguiente campo)
    else if (el.dataset && el.dataset.bind && (el.hasAttribute('data-rerender') || /^p\./.test(el.dataset.bind))) deferRender();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.modal) actions['close-modal'](); });
  window.addEventListener('hashchange', () => { route().then(() => window.scrollTo(0, 0)); });

  // ============================================================
  // Ayuda
  // ============================================================
  function renderHelp() {
    const step = (n, title, body) => `<div class="help-step"><div class="help-num">${n}</div><div><h3>${title}</h3>${body}</div></div>`;
    const faq = (q, a) => `<details class="faq"><summary>${q}</summary><div>${a}</div></details>`;
    return pageHead('Ayuda', 'Instrucciones de uso', 'Cómo trabajar con clientes, bibliotecas de factores y los tres tipos de huella.') + `
      <div class="card"><h2>Flujo de trabajo</h2>
        ${step(1, 'Configurá tu cuenta', '<p>En <strong>Mi cuenta</strong> cargá tu API key de Climatiq (gratuita en climatiq.io). Se guarda en la base de datos y el navegador nunca la vuelve a leer. Sin key podés trabajar solo con factores propios.</p>')}
        ${step(2, 'Creá el cliente', '<p>Razón social, CUIT (se valida el dígito verificador), provincia y contacto.</p>')}
        ${step(3, 'Cargá su biblioteca de factores', '<p>En la pestaña <strong>Biblioteca de factores</strong>, cargá los factores propios del cliente (kgCO₂e por unidad) con su fuente. Podés copiar la tabla desde Excel con las columnas <em>Código · Actividad · Factor · Unidad del factor · Origen</em> y pegarla con <strong>Pegar desde Excel</strong>. Cada cambio de valor queda en el historial.</p>')}
        ${step(4, 'Creá la huella y elegí el tipo', '<p><strong>Organizacional</strong> (GHG Protocol / ISO 14064-1), <strong>de evento</strong> (GHG + ISO 20121) o <strong>de producto</strong> (ISO 14067). Cada tipo tiene su propio asistente. Las tres huellas nunca se suman entre sí.</p>')}
        ${step(5, 'Completá los límites', '<p>Organización: consolidación, instalaciones, alcances y año base. Evento: asistentes, límites temporal y espacial, componentes. Producto: unidad declarada, lote, límite del sistema, etapas y regla de asignación.</p>')}
        ${step(6, 'Cargá las fuentes', '<p>Para cada fuente: <strong>¿se incluye?</strong> (si no, justificá), dato de actividad, <strong>factor de la biblioteca o de Climatiq</strong>, evidencia y responsable del dato. La app valida al instante las unidades (convierte L↔m³, kg↔t, kWh↔GJ y rechaza, por ejemplo, vehículo·km contra pasajero·km), los datos faltantes o negativos y los posibles dobles conteos.</p>')}
        ${step(7, 'Calculá y revisá', '<p>Los factores propios se calculan al instante; los de Climatiq, con <strong>Calcular</strong>. Mientras falten fuentes, el total se marca como <strong>PARCIAL</strong> con su % de completitud.</p>')}
        ${step(8, 'Emití el informe', '<p>Con completitud del 100% y sin errores se habilita <strong>Emitir informe</strong>: se guarda una versión inmutable (datos, factores y resultados) y se descarga el Word. Antes de eso, el Word sale marcado como BORRADOR.</p>')}
      </div>
      <div class="grid two">
        <div class="card"><h2>¿Por qué "parcial"?</h2><p class="small">El GHG Protocol, ISO 14064-1 e ISO 14067 aplican el principio de <strong>integridad</strong> al estudio que se informa: todas las fuentes dentro del límite deben estar cuantificadas o su exclusión justificada. Ver un parcial mientras trabajás es útil para priorizar datos; comunicarlo como resultado final, no.</p></div>
        <div class="card"><h2>Trazabilidad</h2><p class="small">La base de datos registra automáticamente: altas, cambios y bajas de clientes y factores (con valor anterior y nuevo), creación y estado de las huellas, cálculos, descargas y emisiones. Lo ves en la pestaña <strong>Historial</strong> de cada cliente. Las versiones emitidas no se pueden modificar.</p></div>
      </div>
      <div class="card"><h2>Problemas frecuentes</h2>
        ${faq('"No cargaste tu API key de Climatiq"', 'Andá a Mi cuenta y guardala. Después usá "Probar conexión".')}
        ${faq('Unidades incoherentes', 'La unidad del dato no es de la misma magnitud que la del factor (p. ej. dato en vehículo·km y factor por t·km). Corregí la unidad o elegí otro factor.')}
        ${faq('Climatiq no tiene factor de red para AR', 'Cargá en la biblioteca el factor de emisión de la red argentina publicado por la Secretaría de Energía y usalo con el método "Biblioteca del cliente".')}
        ${faq('No se habilita "Emitir informe"', 'El paso Informe lista lo que falta: fuentes sin decidir o sin calcular, errores de validación o límites sin evaluar.')}
        ${faq('Edité una huella emitida', 'Vuelve a estado borrador. La versión emitida sigue guardada sin cambios y se puede descargar desde el paso Informe.')}
      </div>`;
  }

  // ============================================================
  // Arranque
  // ============================================================
  async function boot() {
    // Los enlaces de email de Supabase vuelven con tokens en el hash (#access_token=…&type=recovery)
    const initialHash = location.hash;
    const fromEmail = /access_token=|error_description=/.test(initialHash);
    try {
      await DB.init();
      state.session = await DB.auth.session();
      if (fromEmail) {
        const params = new URLSearchParams(initialHash.replace(/^#\/?/, ''));
        let target = state.session ? '#/clientes' : '#/ingresar';
        if (params.get('type') === 'recovery' && state.session) target = '#/nueva-clave';
        if (params.get('error_description')) ui.authMsg = { error: true, text: 'El enlace no es válido o expiró: ' + params.get('error_description').replace(/\+/g, ' ') };
        else if (params.get('type') === 'signup') toast('Email confirmado. ¡Bienvenido!');
        history.replaceState(null, '', location.pathname + target);
      }
      DB.auth.onChange(async (event, session) => {
        const was = !!state.session;
        state.session = session;
        if (event === 'PASSWORD_RECOVERY') { go('#/nueva-clave'); return; }
        if (event === 'SIGNED_OUT') { state.clients = null; state.client = null; state.fp = null; project = null; go('#/ingresar'); return; }
        if (event === 'SIGNED_IN' && !was) {
          state.keyStatus = await DB.profile.keyStatus().catch(() => null);
          if (AUTH_ROUTES.includes(parseRoute().name) && parseRoute().name !== 'nueva-clave') go('#/clientes');
        }
      });
      if (state.session) state.keyStatus = await DB.profile.keyStatus().catch(() => null);
    } catch (e) {
      state.configError = e.message;
    }
    state.ready = true;
    route();
  }
  boot();
})();
