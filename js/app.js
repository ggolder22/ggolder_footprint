(function () {
  'use strict';
  const S = window.STD;
  const API = window.Climatiq;
  const STORE_KEY = 'huella.project.v1';
  const SETTINGS_KEY = 'huella.settings.v1';

  // ============================================================
  // Utilidades
  // ============================================================
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmtT = (kg, d = 2) => (num(kg) / 1000).toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtN = (n, d = 2) => num(n).toLocaleString('es', { maximumFractionDigits: d });
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
  const toKg = (v, unit) => (String(unit).toLowerCase() === 't' ? num(v) * 1000 : num(v));
  const storage = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  // ============================================================
  // Estado
  // ============================================================
  function defaultCategories() {
    const c = {};
    S.CATEGORIES.forEach((cat) => {
      c[cat.id] = { status: cat.scope === 3 ? 'pending' : 'included', criteria: {}, justification: '' };
    });
    return c;
  }

  function newProject() {
    const y = new Date().getFullYear() - 1;
    return {
      version: 1,
      org: { name: '', taxId: '', sector: '', country: '', address: '', responsible: '', responsibleRole: '', description: '' },
      purpose: { objective: '', users: '', intendedUse: '', verification: 'none', verifier: '', principles: {} },
      period: { year: y, start: `${y}-01-01`, end: `${y}-12-31` },
      baseYear: {
        year: y, justification: 'Primer año con datos completos y verificables.', threshold: 5, totalT: '',
        policy: 'El año base se recalculará ante cambios estructurales (fusiones, adquisiciones, desinversiones, tercerización), cambios en metodologías o factores de emisión, o descubrimiento de errores, cuando su efecto acumulado supere el umbral de significancia.',
      },
      consolidation: 'operational',
      facilities: [],
      boundaries: { categories: defaultCategories(), materiality: 5 },
      sources: [],
      settings: { scope2Totals: 'location' },
    };
  }

  function newSource(catId, facilityId) {
    const cat = S.byId[catId];
    return {
      id: uid(), catId, facilityId: facilityId || '', description: cat ? cat.name : '',
      method: cat && cat.electricity ? 'electricity' : 'climatiq',
      factor: null, params: {}, searchHint: cat ? cat.queries[0] : '',
      elec: { energy: '', unit: 'kWh', recs: '', direct: '', year: '' },
      manual: { factor: '', unit: '', quantity: '', ref: '' },
      quality: { method: 'measured', uActivity: S.ACTIVITY_UNCERTAINTY.measured, uFactor: '' },
      evidence: '', isRemoval: false, biogenic: '', result: null, error: null,
    };
  }

  let project = migrate(storage.get(STORE_KEY)) || newProject();
  let settings = { apiBase: '/api/climatiq', apiKey: '', accessCode: '', dataVersion: '^39', calculationMethod: 'ar6', theme: 'auto', ...(storage.get(SETTINGS_KEY) || {}) };
  const ui = { open: {}, search: null, busy: false, navOpen: false, facilityFilter: '' };
  API.configure(settings);
  applyTheme();

  function migrate(p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.sources)) return null;
    const base = newProject();
    const merged = { ...base, ...p, org: { ...base.org, ...p.org }, purpose: { ...base.purpose, ...p.purpose },
      period: { ...base.period, ...p.period }, baseYear: { ...base.baseYear, ...p.baseYear },
      settings: { ...base.settings, ...p.settings } };
    merged.boundaries = { ...base.boundaries, ...(p.boundaries || {}) };
    merged.boundaries.categories = { ...base.boundaries.categories, ...((p.boundaries || {}).categories || {}) };
    return merged;
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const ok = storage.set(STORE_KEY, project);
      const el = document.getElementById('save-status');
      if (el) el.textContent = ok ? `Guardado en este navegador · ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : 'No se pudo guardar localmente: usa "Guardar archivo"';
    }, 300);
  }

  const root = () => ({ p: project, ui, settings });
  function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root()); }
  function setPath(path, val) {
    const keys = path.split('.');
    let o = root();
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null) o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = val;
  }

  // ============================================================
  // Helpers de formulario
  // ============================================================
  function field(label, path, o = {}) {
    const v = getPath(path);
    const attrs = `data-bind="${path}"${o.rerender ? ' data-rerender' : ''}${o.num ? ' data-num' : ''}`;
    let input;
    if (o.type === 'select') {
      input = `<select ${attrs}>${o.options.map(([val, lab]) => `<option value="${esc(val)}"${String(v ?? '') === String(val) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    } else if (o.type === 'textarea') {
      input = `<textarea ${attrs} placeholder="${esc(o.placeholder || '')}">${esc(v ?? '')}</textarea>`;
    } else {
      const t = o.type || 'text';
      input = `<input type="${t}" ${attrs}${t === 'number' ? ' data-num' : ''} value="${esc(v ?? '')}" placeholder="${esc(o.placeholder || '')}"${o.min != null ? ` min="${o.min}"` : ''}${o.step ? ` step="${o.step}"` : ''}>`;
    }
    return `<label class="field${o.cls ? ' ' + o.cls : ''}"><span>${label}</span>${input}${o.help ? `<small class="help">${o.help}</small>` : ''}</label>`;
  }
  function check(label, path, o = {}) {
    return `<label class="check" title="${esc(o.title || '')}"><input type="checkbox" data-bind="${path}"${o.rerender ? ' data-rerender' : ''}${getPath(path) ? ' checked' : ''}><span>${label}</span></label>`;
  }

  function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast' + (isError ? ' error' : ''); }, isError ? 6000 : 3000);
  }

  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }

  // ============================================================
  // Pasos
  // ============================================================
  const STEPS = [
    { id: 'inicio', title: 'Inicio', render: renderInicio, done: () => true },
    { id: 'organizacion', title: 'Organización y objetivo', render: renderOrg, done: () => !!(project.org.name && project.purpose.objective) },
    { id: 'limites-org', title: 'Límites organizacionales', render: renderLimitesOrg, done: () => project.facilities.length > 0 && project.facilities.every((f) => f.name) },
    { id: 'limites-informe', title: 'Límites de informe', render: renderLimitesInf, done: () => boundaryIssues().length === 0 },
    { id: 'periodo', title: 'Período y año base', render: renderPeriodo, done: () => !!(project.period.start && project.period.end && project.baseYear.year) },
    { id: 'fuentes', title: 'Fuentes y datos de actividad', render: renderFuentes, done: () => project.sources.length > 0 && project.sources.every((s) => sourceReady(s)) },
    { id: 'resultados', title: 'Cálculo y resultados', render: renderResultados, done: () => project.sources.length > 0 && project.sources.every((s) => s.result) },
    { id: 'calidad', title: 'Calidad e incertidumbre', render: renderCalidad, done: () => S.PRINCIPLES.every((p) => project.purpose.principles[p.id]) },
    { id: 'informe', title: 'Informe', render: renderInforme, done: () => false },
  ];
  const HELP = { id: 'ayuda', title: 'Instrucciones de uso', render: () => renderAyuda() };
  const currentStep = () => {
    const id = (location.hash || '').replace(/^#\/?/, '');
    if (id === 'ayuda') return HELP;
    return STEPS.find((s) => s.id === id) || STEPS[0];
  };

  function renderNav() {
    const cur = currentStep();
    const nav = document.getElementById('steps-nav');
    nav.className = 'steps no-print' + (ui.navOpen ? ' open' : '');
    nav.innerHTML = STEPS.map((s, i) => `
      <button class="step-link${s === cur ? ' active' : ''}${i > 0 && s.done() ? ' done' : ''}" data-action="go" data-step="${s.id}">
        <span class="step-num">${i > 0 && s.done() ? '✓' : i}</span><span>${esc(s.title)}</span>
      </button>`).join('') +
      `<button class="step-link${cur === HELP ? ' active' : ''}" data-action="go" data-step="ayuda" style="margin-top:10px"><span class="step-num">?</span><span>Instrucciones de uso</span></button>` +
      `<div class="steps-foot">${project.org.name ? `<strong>${esc(project.org.name)}</strong><br>` : ''}Período ${esc(project.period.year)} · ${project.sources.length} fuentes</div>`;
  }

  function navButtons() {
    const i = STEPS.indexOf(currentStep());
    const prev = STEPS[i - 1], next = STEPS[i + 1];
    return `<div class="nav-buttons">
      ${prev ? `<button class="btn ghost" data-action="go" data-step="${prev.id}">← ${esc(prev.title)}</button>` : '<span></span>'}
      ${next ? `<button class="btn" data-action="go" data-step="${next.id}">${esc(next.title)} →</button>` : ''}
    </div>`;
  }

  function pageHead(eyebrow, title, intro) {
    return `<div class="page-head"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${intro ? `<p>${intro}</p>` : ''}</div>`;
  }

  function render() {
    const main = document.getElementById('main');
    const step = currentStep();
    main.innerHTML = step.render() + (step.id !== 'inicio' && step !== HELP ? navButtons() : '');
    renderNav();
    renderModal();
  }

  // ------------------------------------------------------------
  // 0. Inicio
  // ------------------------------------------------------------
  function renderInicio() {
    const has = project.org.name || project.sources.length;
    return `
      <div class="hero">
        <div>
          <div class="page-head" style="margin:0">
            <div class="eyebrow">Inventario corporativo de GEI</div>
            <h1>Calcula la huella de carbono de una organización, paso a paso</h1>
            <p>Esta herramienta guía el proceso que exigen el <strong>GHG Protocol Corporate Standard</strong> (con sus guías de Alcance 2 y Alcance 3) y la norma <strong>ISO 14064-1:2018</strong>. Los factores de emisión provienen de la base de datos de <strong>Climatiq</strong> (DEFRA, EPA, IPCC, ecoinvent, OEKOBAUDAT, entre otras) o los puedes ingresar manualmente con su referencia.</p>
          </div>
          <div class="row" style="margin-top:16px">
            <button class="btn" data-action="go" data-step="organizacion">${has ? 'Continuar inventario' : 'Comenzar inventario'} →</button>
            <button class="btn ghost" data-action="go" data-step="ayuda">Ver instrucciones</button>
            <button class="btn ghost" data-action="load-example">Cargar ejemplo</button>
            ${has ? '<button class="btn danger" data-action="reset">Nuevo inventario en blanco</button>' : ''}
          </div>
        </div>
        <div class="card" style="margin:0">
          <h3>Normas de referencia</h3>
          <p class="muted" style="font-size:.88rem"><strong>ISO 14064-1:2018</strong> — cuantificación e informe de emisiones y remociones de GEI a nivel de organización.<br>
          <strong>ISO 14064-3</strong> — verificación y validación de declaraciones de GEI.<br>
          <strong>ISO 14067</strong> — huella de carbono de productos (fuera del alcance de esta herramienta).<br>
          <strong>GHG Protocol</strong> — Corporate Standard, Scope 2 Guidance y Corporate Value Chain (Scope 3) Standard.</p>
        </div>
      </div>

      <div class="card" style="margin-top:20px">
        <h2>El proceso</h2>
        <ol class="process">
          <li><div><strong>Organización y objetivo</strong><span>Quién reporta, para qué, para quién y si habrá verificación (ISO 14064-1 §9, GHG Protocol cap. 2).</span></div></li>
          <li><div><strong>Límites organizacionales</strong><span>Enfoque de consolidación (control operacional, financiero o participación accionaria) e instalaciones incluidas.</span></div></li>
          <li><div><strong>Límites de informe (operacionales)</strong><span>Qué fuentes se incluyen: Alcance 1, 2 y 3 (categorías 1 a 6 en ISO). Evaluación de relevancia y justificación de exclusiones.</span></div></li>
          <li><div><strong>Período y año base</strong><span>Período de reporte, año base y política de recálculo con umbral de significancia.</span></div></li>
          <li><div><strong>Fuentes y datos de actividad</strong><span>Identificar cada fuente por instalación, recopilar el dato de actividad y elegir el factor de emisión adecuado.</span></div></li>
          <li><div><strong>Cálculo</strong><span>Emisiones = dato de actividad × factor de emisión × PCG (GWP). Alcance 2 con reporte dual: ubicación y mercado.</span></div></li>
          <li><div><strong>Calidad e incertidumbre</strong><span>Principios de pertinencia, integridad, coherencia, transparencia y exactitud; evaluación de incertidumbre.</span></div></li>
          <li><div><strong>Informe</strong><span>Informe de GEI con el contenido requerido por ISO 14064-1 §9.3, listo para imprimir o exportar.</span></div></li>
        </ol>
      </div>

      <div class="card">
        <div class="card-head"><h2>Conexión con Climatiq</h2><button class="btn ghost small" data-action="test-api">Probar conexión</button></div>
        <p class="muted" style="font-size:.9rem">La API key se guarda como variable de entorno <code>CLIMATIQ_API_KEY</code> en Vercel y nunca llega al navegador. Para pruebas locales puedes ingresar tu key en <a href="#" data-action="open-settings">Ajustes</a>. Versión de datos: <code>${esc(settings.dataVersion)}</code> · PCG: <code>${esc(settings.calculationMethod.toUpperCase())}</code>.</p>
        <div class="api-status"></div>
      </div>`;
  }

  // ------------------------------------------------------------
  // 1. Organización
  // ------------------------------------------------------------
  function renderOrg() {
    return pageHead('Paso 1', 'Organización y objetivo del inventario',
      'ISO 14064-1 exige describir la organización que informa, la persona responsable, el propósito del informe y sus usuarios previstos. Esto condiciona el nivel de detalle y si se requerirá verificación.') + `
      <div class="card">
        <h2>Organización que informa</h2>
        <div class="grid">
          ${field('Razón social', 'p.org.name', { placeholder: 'Empresa S.A.' })}
          ${field('Identificador tributario', 'p.org.taxId', { placeholder: 'RUT / RFC / NIT / CUIT' })}
          ${field('Sector / actividad', 'p.org.sector', { placeholder: 'Ej. Manufactura de alimentos' })}
          ${field('País', 'p.org.country', { placeholder: 'Chile' })}
        </div>
        <div class="grid" style="margin-top:14px">
          ${field('Dirección principal', 'p.org.address')}
          ${field('Responsable del inventario', 'p.org.responsible')}
          ${field('Cargo del responsable', 'p.org.responsibleRole')}
        </div>
        <div style="margin-top:14px">${field('Descripción de la organización', 'p.org.description', { type: 'textarea', placeholder: 'Actividades principales, número de empleados, productos o servicios…' })}</div>
      </div>
      <div class="card">
        <h2>Propósito y usuarios</h2>
        <div class="grid two">
          ${field('Objetivo del inventario', 'p.purpose.objective', { type: 'textarea', placeholder: 'Ej. Establecer la línea base para un plan de reducción y reportar a clientes.' })}
          ${field('Usuarios previstos', 'p.purpose.users', { type: 'textarea', placeholder: 'Ej. Directorio, clientes, inversionistas, programa HuellaChile.' })}
        </div>
        <div class="grid" style="margin-top:14px">
          ${field('Uso previsto', 'p.purpose.intendedUse', { type: 'select', options: [['', 'Selecciona…'], ['internal', 'Gestión interna'], ['public', 'Comunicación pública / reporte de sostenibilidad'], ['program', 'Programa voluntario (p. ej. HuellaChile, CDP, SBTi)'], ['regulatory', 'Requisito regulatorio o de cliente'], ['offset', 'Base para neutralidad / compensación']] })}
          ${field('Verificación', 'p.purpose.verification', { type: 'select', options: [['none', 'Sin verificación'], ['internal', 'Revisión interna'], ['limited', 'Verificación externa — aseguramiento limitado'], ['reasonable', 'Verificación externa — aseguramiento razonable']], help: 'ISO 14064-3 define los niveles de aseguramiento.' })}
          ${field('Organismo verificador', 'p.purpose.verifier', { placeholder: 'Si aplica' })}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------
  // 2. Límites organizacionales
  // ------------------------------------------------------------
  function facilityShare(f) {
    if (!f) return 1;
    return project.consolidation === 'equity' ? num(f.equity) / 100 : (f.control ? 1 : 0);
  }
  function renderLimitesOrg() {
    const c = project.consolidation;
    const controlLabel = c === 'financial' ? 'Tiene control financiero' : 'Tiene control operacional';
    return pageHead('Paso 2', 'Límites organizacionales',
      'Define qué operaciones forman parte del inventario. Elige un enfoque de consolidación y aplícalo de forma coherente a todas las instalaciones (GHG Protocol cap. 3, ISO 14064-1 §5.1).') + `
      <div class="card">
        <h2>Enfoque de consolidación</h2>
        <div class="grid">
          ${Object.entries(S.CONSOLIDATION).map(([k, v]) => `
            <label class="scope-box check" style="cursor:pointer;${c === k ? 'border-color:var(--accent);background:var(--accent-soft)' : ''}">
              <input type="radio" name="consol" value="${k}" data-bind="p.consolidation" data-rerender${c === k ? ' checked' : ''}>
              <span><strong>${v.name}</strong><br><small class="muted">${v.help}</small></span>
            </label>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h2>Instalaciones y operaciones</h2>
          <button class="btn small" data-action="add-facility">+ Agregar instalación</button>
        </div>
        <p class="muted" style="font-size:.85rem">El <strong>código de región</strong> (ISO 3166, p. ej. <code>CL</code>, <code>MX</code>, <code>ES</code>, <code>US-CA</code>) se usa para elegir el factor de la red eléctrica y filtrar factores en Climatiq.</p>
        ${project.facilities.length === 0 ? '<div class="empty">Aún no hay instalaciones. Agrega oficinas, plantas, bodegas, tiendas o flotas.</div>' : ''}
        ${project.facilities.map((f, i) => `
          <div class="scope-box" style="margin-bottom:10px">
            <div class="grid">
              ${field('Nombre', `p.facilities.${i}.name`, { placeholder: 'Casa matriz' })}
              ${field('Tipo', `p.facilities.${i}.type`, { type: 'select', options: [['office', 'Oficina'], ['plant', 'Planta / fábrica'], ['warehouse', 'Bodega / centro de distribución'], ['store', 'Tienda / sucursal'], ['fleet', 'Flota'], ['field', 'Faena / campo'], ['other', 'Otro']] })}
              ${field('Código de región', `p.facilities.${i}.region`, { placeholder: 'CL' })}
              ${field('Dirección', `p.facilities.${i}.address`)}
            </div>
            <div class="row" style="margin-top:12px">
              ${c === 'equity'
                ? `<div style="width:200px">${field('Participación accionaria (%)', `p.facilities.${i}.equity`, { type: 'number', min: 0, step: 'any' })}</div>`
                : check(controlLabel, `p.facilities.${i}.control`, { rerender: true })}
              <span class="badge ${facilityShare(f) > 0 ? 'ok' : 'warn'}">Se consolida al ${fmtN(facilityShare(f) * 100, 1)}%</span>
              <span class="spacer"></span>
              <button class="btn danger small" data-action="remove-facility" data-id="${f.id}">Eliminar</button>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // ------------------------------------------------------------
  // 3. Límites de informe
  // ------------------------------------------------------------
  function boundaryIssues() {
    const out = [];
    S.CATEGORIES.forEach((cat) => {
      const st = project.boundaries.categories[cat.id];
      if (st.status === 'pending') out.push(`${cat.name}: evaluación pendiente`);
      if (st.status === 'excluded' && !String(st.justification || '').trim()) out.push(`${cat.name}: falta justificar la exclusión`);
    });
    return out;
  }
  function catRow(cat) {
    const base = `p.boundaries.categories.${cat.id}`;
    const st = project.boundaries.categories[cat.id];
    const label = cat.scope === 3 ? `${cat.cat}. ${cat.name}` : cat.name;
    return `<div class="cat-row">
      <div>
        <div class="cat-title">${esc(label)} <span class="badge">${S.ISO_CATEGORIES[cat.iso].split(' · ')[0]}</span></div>
        <div class="cat-desc">${esc(cat.desc)}</div>
        ${cat.scope === 3 ? `<div class="criteria">${S.RELEVANCE_CRITERIA.map((r) => check(r.label, `${base}.criteria.${r.id}`, { title: r.help })).join('')}</div>` : ''}
        ${st.status === 'excluded' ? `<div style="margin-top:8px">${field('Justificación de la exclusión', `${base}.justification`, { placeholder: cat.scope === 3 ? 'Ej. No significativa (<1% estimado), sin influencia, sin datos disponibles…' : 'Ej. No existen fuentes de este tipo en la organización.' })}</div>` : ''}
      </div>
      <div style="min-width:160px">${field('Estado', `${base}.status`, { type: 'select', rerender: true, options: cat.scope === 3 ? [['pending', 'Por evaluar'], ['included', 'Incluida'], ['excluded', 'Excluida']] : [['included', 'Aplica / incluida'], ['excluded', 'No aplica']] })}</div>
    </div>`;
  }
  function renderLimitesInf() {
    const issues = boundaryIssues();
    const scopeBox = (scope, title, intro) => `
      <div class="card">
        <h2><span class="badge s${scope}">Alcance ${scope}</span> ${title}</h2>
        <p class="muted" style="font-size:.87rem">${intro}</p>
        ${S.CATEGORIES.filter((c) => c.scope === scope).map(catRow).join('')}
      </div>`;
    return pageHead('Paso 3', 'Límites de informe (operacionales)',
      'Identifica las emisiones asociadas a las operaciones dentro de los límites. Alcance 1 y 2 son obligatorios en el GHG Protocol. Para Alcance 3 (ISO categorías 3 a 6) la organización debe aplicar criterios de significancia y justificar las exclusiones.') + `
      <div class="callout">
        <p><strong>Criterios de relevancia (Alcance 3):</strong> marca los criterios que aplican a cada categoría — magnitud, influencia, riesgo, partes interesadas, tercerización y guía sectorial. Si alguno aplica, la categoría suele considerarse significativa. ISO 14064-1 §5.2.3 exige documentar el proceso y los criterios usados.</p>
      </div>
      <div class="card">
        <div class="grid">
          ${field('Umbral de materialidad para exclusiones (%)', 'p.boundaries.materiality', { type: 'number', min: 0, step: 'any', help: 'Referencia habitual: las exclusiones no deberían superar el 5% de las emisiones totales.' })}
          ${field('Método de Alcance 2 para el total', 'p.settings.scope2Totals', { type: 'select', options: [['location', 'Basado en ubicación'], ['market', 'Basado en mercado']], help: 'Ambos se reportan siempre; esto define cuál suma al total.' })}
        </div>
      </div>
      ${issues.length ? `<div class="callout warn"><p><strong>Pendiente:</strong> ${issues.map(esc).join(' · ')}</p></div>` : '<div class="callout"><p>✓ Todas las categorías tienen una decisión documentada.</p></div>'}
      ${scopeBox(1, 'Emisiones directas', 'Fuentes que son propiedad o están controladas por la organización. ISO 14064-1 categoría 1. Cuantifica por separado cada gas: CO₂, CH₄, N₂O, HFCs, PFCs, SF₆ y NF₃.')}
      ${scopeBox(2, 'Indirectas por energía', 'Generación de la electricidad, vapor, calor y frío adquiridos y consumidos. ISO 14064-1 categoría 2.')}
      ${scopeBox(3, 'Otras indirectas (cadena de valor)', 'Las 15 categorías del GHG Protocol Scope 3 Standard, con su equivalencia orientativa en las categorías 3 a 6 de ISO 14064-1.')}`;
  }

  // ------------------------------------------------------------
  // 4. Período y año base
  // ------------------------------------------------------------
  function renderPeriodo() {
    return pageHead('Paso 4', 'Período de reporte y año base',
      'El año base permite seguir el desempeño en el tiempo. Debe tener datos verificables y una política de recálculo explícita (GHG Protocol cap. 5, ISO 14064-1 §6.4).') + `
      <div class="card">
        <h2>Período de reporte</h2>
        <div class="grid">
          ${field('Año del inventario', 'p.period.year', { type: 'number', step: 1 })}
          ${field('Fecha de inicio', 'p.period.start', { type: 'date' })}
          ${field('Fecha de término', 'p.period.end', { type: 'date' })}
        </div>
      </div>
      <div class="card">
        <h2>Año base</h2>
        <div class="grid">
          ${field('Año base', 'p.baseYear.year', { type: 'number', step: 1 })}
          ${field('Umbral de significancia para recálculo (%)', 'p.baseYear.threshold', { type: 'number', min: 0, step: 'any', help: 'Valor común: 5%.' })}
          ${field('Emisiones del año base (tCO₂e)', 'p.baseYear.totalT', { type: 'number', min: 0, step: 'any', help: 'Si el año base es distinto al actual y ya lo calculaste.' })}
        </div>
        <div class="grid two" style="margin-top:14px">
          ${field('Justificación de la elección', 'p.baseYear.justification', { type: 'textarea' })}
          ${field('Política de recálculo', 'p.baseYear.policy', { type: 'textarea' })}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------
  // 5. Fuentes
  // ------------------------------------------------------------
  function sourceReady(s) {
    if (s.method === 'manual') return num(s.manual.factor) !== 0 && s.manual.quantity !== '' && s.manual.quantity != null;
    if (s.method === 'electricity') return num(s.elec.energy) > 0;
    if (!s.factor) return false;
    const spec = S.UNIT_TYPES[s.factor.unit_type] || [];
    return spec.length > 0 && spec.every((p) => s.params[p.key] !== '' && s.params[p.key] != null);
  }
  function facilityName(id) { const f = project.facilities.find((x) => x.id === id); return f ? f.name || '(sin nombre)' : '—'; }

  function renderFuentes() {
    const included = S.CATEGORIES.filter((c) => project.boundaries.categories[c.id].status === 'included');
    const list = project.sources.filter((s) => !ui.facilityFilter || s.facilityId === ui.facilityFilter);
    const ready = project.sources.filter(sourceReady).length;
    const groups = [1, 2, 3].map((scope) => ({ scope, items: list.filter((s) => (S.byId[s.catId] || {}).scope === scope) }));
    return pageHead('Paso 5', 'Fuentes de emisión y datos de actividad',
      'Para cada instalación, registra cada fuente con su dato de actividad y el factor de emisión. Prioriza datos primarios medidos (facturas, medidores) sobre estimaciones, y factores específicos del país y año.') + `
      ${project.facilities.length === 0 ? '<div class="callout warn"><p>Primero agrega instalaciones en <a href="#/limites-org">Límites organizacionales</a>.</p></div>' : ''}
      <div class="card">
        <div class="card-head">
          <h2>Agregar fuente</h2>
          <span class="muted" style="font-size:.85rem">${ready} de ${project.sources.length} fuentes con datos completos</span>
        </div>
        <div class="grid">
          <label class="field"><span>Categoría</span><select id="new-cat">
            ${[1, 2, 3].map((sc) => `<optgroup label="Alcance ${sc}">${included.filter((c) => c.scope === sc).map((c) => `<option value="${c.id}">${c.scope === 3 ? c.cat + '. ' : ''}${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}
          </select><small class="help">Solo aparecen las categorías incluidas en el paso 3.</small></label>
          <label class="field"><span>Instalación</span><select id="new-fac">
            ${project.facilities.map((f) => `<option value="${f.id}">${esc(f.name || '(sin nombre)')}</option>`).join('') || '<option value="">—</option>'}
          </select></label>
          <div class="field"><span>&nbsp;</span><button class="btn" data-action="add-source">+ Agregar fuente</button></div>
        </div>
      </div>
      <div class="row" style="margin-bottom:12px">
        <label class="field" style="width:260px"><span>Filtrar por instalación</span>
          <select data-bind="ui.facilityFilter" data-rerender><option value="">Todas</option>${project.facilities.map((f) => `<option value="${f.id}"${ui.facilityFilter === f.id ? ' selected' : ''}>${esc(f.name || '(sin nombre)')}</option>`).join('')}</select>
        </label>
        <span class="spacer"></span>
        <button class="btn" data-action="calculate" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spinner"></span> Calculando…' : 'Calcular emisiones'}</button>
      </div>
      ${list.length === 0 ? '<div class="card empty">No hay fuentes registradas todavía.</div>' : ''}
      ${groups.filter((g) => g.items.length).map((g) => `
        <h2 style="margin:18px 0 10px"><span class="badge s${g.scope}">Alcance ${g.scope}</span></h2>
        ${g.items.map(renderSource).join('')}`).join('')}`;
  }

  function sourceStatus(s) {
    const st = project.boundaries.categories[s.catId];
    if (st && st.status !== 'included') return '<span class="badge warn">Categoría excluida</span>';
    if (s.error) return '<span class="badge err">Error</span>';
    if (s.result) {
      const kg = s.result.location ? (project.settings.scope2Totals === 'market' ? s.result.market.consumption : s.result.location.consumption) : s.result.co2e;
      return `<span class="badge ok">${fmtT(kg, 3)} tCO₂e</span>`;
    }
    return sourceReady(s) ? '<span class="badge">Listo para calcular</span>' : '<span class="badge warn">Datos incompletos</span>';
  }

  function renderSource(s) {
    const i = project.sources.indexOf(s);
    const cat = S.byId[s.catId];
    const P = `p.sources.${i}`;
    const open = !!ui.open[s.id];
    const methods = [['climatiq', 'Factor Climatiq'], ...(cat && cat.electricity ? [['electricity', 'Electricidad (ubicación + mercado)']] : []), ['manual', 'Factor propio']];
    let body = '';
    if (open) {
      body = `<div class="source-body">
        <div class="grid" style="margin-top:12px">
          ${field('Descripción', `${P}.description`)}
          ${field('Instalación', `${P}.facilityId`, { type: 'select', rerender: true, options: project.facilities.map((f) => [f.id, f.name || '(sin nombre)']) })}
        </div>
        <div style="margin:14px 0 10px" class="row">
          <span style="font-size:.82rem;font-weight:600">Método de cálculo</span>
          <div class="method-tabs">${methods.map(([m, l]) => `<button class="${s.method === m ? 'on' : ''}" data-action="set-method" data-id="${s.id}" data-method="${m}">${l}</button>`).join('')}</div>
        </div>
        ${s.method === 'climatiq' ? renderClimatiqInputs(s, P, cat) : ''}
        ${s.method === 'electricity' ? renderElectricityInputs(s, P) : ''}
        ${s.method === 'manual' ? renderManualInputs(s, P) : ''}
        <h3 style="margin-top:16px">Calidad del dato</h3>
        <div class="grid">
          ${field('Tipo de dato de actividad', `${P}.quality.method`, { type: 'select', rerender: true, options: Object.entries(S.DATA_METHODS) })}
          ${field('Incertidumbre del dato (±%)', `${P}.quality.uActivity`, { type: 'number', min: 0, step: 'any' })}
          ${field('Incertidumbre del factor (±%)', `${P}.quality.uFactor`, { type: 'number', min: 0, step: 'any', placeholder: s.factor && s.factor.uncertainty != null ? String(s.factor.uncertainty) : String(S.FACTOR_UNCERTAINTY_DEFAULT), help: 'Vacío = valor de la fuente o 10%.' })}
          ${field('Evidencia / documento de respaldo', `${P}.evidence`, { placeholder: 'Ej. Facturas ENEL ene–dic' })}
        </div>
        <div class="grid" style="margin-top:12px">
          ${field('CO₂ biogénico (kg, se reporta aparte)', `${P}.biogenic`, { type: 'number', min: 0, step: 'any', help: 'Combustión de biomasa o biocombustibles.' })}
          ${s.catId === 's1_lulucf' ? `<div class="field"><span>&nbsp;</span>${check('Es una remoción (sumidero), se reporta por separado', `${P}.isRemoval`)}</div>` : ''}
        </div>
        ${s.error ? `<div class="callout danger" style="margin-top:12px"><p>${esc(s.error)}</p></div>` : ''}
        ${s.result ? renderSourceResult(s) : ''}
        <div class="row" style="margin-top:12px">
          <span class="spacer"></span>
          <button class="btn ghost small" data-action="dup-source" data-id="${s.id}">Duplicar</button>
          <button class="btn danger small" data-action="remove-source" data-id="${s.id}">Eliminar</button>
        </div>
      </div>`;
    }
    return `<div class="source">
      <div class="source-head" data-action="toggle-source" data-id="${s.id}">
        <span aria-hidden="true">${open ? '▾' : '▸'}</span>
        <span class="title">${esc(s.description || '(sin descripción)')}</span>
        <span class="badge">${esc(cat ? (cat.scope === 3 ? `3.${cat.cat} ` : '') + cat.name : s.catId)}</span>
        <span class="badge">${esc(facilityName(s.facilityId))}</span>
        ${sourceStatus(s)}
      </div>${body}</div>`;
  }

  function renderClimatiqInputs(s, P, cat) {
    const f = s.factor;
    const spec = f ? S.UNIT_TYPES[f.unit_type] : null;
    return `
      <div class="factor-box">
        ${f ? `<div class="grow"><strong>${esc(f.name)}</strong><br>
            <span class="muted">${esc(f.source)}${f.source_dataset ? ' · ' + esc(f.source_dataset) : ''} · ${esc(f.region_name || f.region)} · ${esc(f.year)} · ${esc(f.unit_type)}${f.factor != null ? ` · ${fmtN(f.factor, 4)} ${esc(f.unit)}` : ''}</span><br>
            <code>${esc(f.activity_id)}</code></div>
            <button class="btn ghost small" data-action="open-search" data-id="${s.id}">Cambiar factor</button>`
          : `<div class="grow">Sin factor seleccionado. Busca en la base de datos de Climatiq.</div>
            <button class="btn small" data-action="open-search" data-id="${s.id}">Buscar factor</button>`}
      </div>
      ${f && !spec ? `<div class="callout warn" style="margin-top:10px"><p>Tipo de unidad <code>${esc(f.unit_type)}</code> no soportado por la interfaz. Usa un factor propio.</p></div>` : ''}
      ${spec ? `<div class="grid" style="margin-top:12px">${spec.map((p) => `
        ${field(`${p.label}`, `${P}.params.${p.key}`, { type: 'number', min: 0, step: p.integer ? 1 : 'any' })}
        ${p.units ? field('Unidad', `${P}.params.${p.key}_unit`, { type: 'select', options: p.units.map((u) => [u, u]) }) : ''}`).join('')}</div>` : ''}
      ${cat ? `<p class="muted" style="font-size:.8rem;margin-top:8px">Datos típicos: ${esc(cat.data)}</p>` : ''}`;
  }

  function renderElectricityInputs(s, P) {
    const fac = project.facilities.find((f) => f.id === s.facilityId);
    return `
      <div class="callout"><p>Se usa el endpoint de electricidad de Climatiq, que entrega <strong>Alcance 2 basado en ubicación y en mercado</strong> y, además, las emisiones aguas arriba (extracción de combustibles y pérdidas de T&D) que se asignan a <strong>Alcance 3, categoría 3</strong> si esa categoría está incluida. Región: <code>${esc((fac && fac.region) || 'sin definir')}</code> (de la instalación).</p></div>
      <div class="grid">
        ${field('Consumo total', `${P}.elec.energy`, { type: 'number', min: 0, step: 'any' })}
        ${field('Unidad', `${P}.elec.unit`, { type: 'select', options: S.UNIT_TYPES.Energy[0].units.map((u) => [u, u]) })}
        ${field('Certificados renovables (REC / I-REC / GO)', `${P}.elec.recs`, { type: 'number', min: 0, step: 'any', help: 'Misma unidad. Afecta solo el método de mercado.' })}
        ${field('Renovable con conexión directa (PPA físico / autogeneración)', `${P}.elec.direct`, { type: 'number', min: 0, step: 'any', help: 'Parte del consumo total.' })}
        ${field('Año del factor', `${P}.elec.year`, { type: 'number', step: 1, placeholder: 'Último disponible' })}
      </div>`;
  }

  function renderManualInputs(s, P) {
    return `
      <div class="callout warn"><p>Usa un factor propio cuando no exista uno adecuado en Climatiq (p. ej. factor nacional oficial, factor del proveedor o de cálculo de proceso). <strong>Documenta siempre la referencia</strong>: es requisito de transparencia.</p></div>
      <div class="grid">
        ${field('Cantidad (dato de actividad)', `${P}.manual.quantity`, { type: 'number', step: 'any' })}
        ${field('Unidad del dato', `${P}.manual.unit`, { placeholder: 'kWh, L, kg, km…' })}
        ${field('Factor de emisión (kgCO₂e por unidad)', `${P}.manual.factor`, { type: 'number', step: 'any' })}
        ${field('Referencia del factor', `${P}.manual.ref`, { placeholder: 'Ej. Factor SEN 2024, Ministerio de Energía' })}
      </div>`;
  }

  function renderSourceResult(s) {
    const r = s.result;
    if (r.location) {
      const row = (k, l) => `<tr><td>${l}</td><td class="num">${fmtT(r.location[k], 3)}</td><td class="num">${fmtT(r.market[k], 3)}</td></tr>`;
      return `<div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Resultado (tCO₂e)</th><th class="num">Ubicación</th><th class="num">Mercado</th></tr></thead>
        <tbody>${row('consumption', 'Alcance 2 — consumo')}${row('wtt', 'Alcance 3.3 — extracción combustibles (WTT)')}${row('td', 'Alcance 3.3 — pérdidas T&D')}${row('wtt_td', 'Alcance 3.3 — WTT de pérdidas T&D')}</tbody>
      </table></div>${noticesHtml(r.notices)}`;
    }
    const g = r.gases || {};
    const gasTxt = ['co2', 'ch4', 'n2o'].filter((k) => g[k] != null).map((k) => `${k.toUpperCase()}: ${fmtN(g[k], 4)} kg`).join(' · ');
    return `<div class="factor-box" style="margin-top:12px"><div class="grow"><strong>${fmtT(r.co2e, 4)} tCO₂e</strong>
      ${gasTxt ? `<br><span class="muted">Gases (masa): ${gasTxt}</span>` : ''}
      <br><span class="muted">Calculado ${new Date(r.at).toLocaleString('es')} · PCG ${esc((r.gwp || '').toUpperCase())}</span></div></div>${noticesHtml(r.notices)}`;
  }
  function noticesHtml(n) {
    if (!n || !n.length) return '';
    return `<ul class="muted" style="font-size:.8rem;margin:8px 0 0">${n.map((x) => `<li>${esc(x.severity)}: ${esc(x.message)}</li>`).join('')}</ul>`;
  }

  // ------------------------------------------------------------
  // Cálculo
  // ------------------------------------------------------------
  async function calculateAll() {
    const included = (s) => project.boundaries.categories[s.catId] && project.boundaries.categories[s.catId].status === 'included';
    const targets = project.sources.filter((s) => included(s));
    const notReady = targets.filter((s) => !sourceReady(s));
    notReady.forEach((s) => { s.error = 'Datos incompletos: falta el factor o la cantidad.'; s.result = null; });
    const todo = targets.filter(sourceReady);
    if (!todo.length) { toast('No hay fuentes listas para calcular.', true); render(); return; }
    ui.busy = true; render();
    const now = new Date().toISOString();

    // Factores propios (sin API)
    todo.filter((s) => s.method === 'manual').forEach((s) => {
      s.result = { co2e: num(s.manual.quantity) * num(s.manual.factor), gases: null, at: now, gwp: 'propio', notices: [] };
      s.error = null;
    });

    let apiError = null;
    // Climatiq — estimate batch
    const cq = todo.filter((s) => s.method === 'climatiq');
    if (cq.length) {
      const bodies = cq.map((s) => {
        const ef = { id: s.factor.id };
        const sup = s.factor.supported_calculation_methods || [];
        if (sup.includes(settings.calculationMethod)) ef.calculation_method = settings.calculationMethod;
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
          s.result = {
            co2e: toKg(r.co2e, r.co2e_unit), gwp: r.co2e_calculation_method, at: now, notices: r.notices || [],
            gases: { co2: cg.co2, ch4: cg.ch4, n2o: cg.n2o, other: cg.co2e_other },
            factorUsed: r.emission_factor,
          };
          s.error = null;
        });
      } catch (e) { apiError = e.message; cq.forEach((s) => { s.error = e.message; }); }
    }

    // Electricidad — reporte dual
    const el = todo.filter((s) => s.method === 'electricity');
    if (el.length) {
      const valid = [];
      el.forEach((s) => {
        const fac = project.facilities.find((f) => f.id === s.facilityId);
        if (!fac || !fac.region) { s.error = 'La instalación no tiene código de región (paso 2).'; s.result = null; } else valid.push([s, fac]);
      });
      if (valid.length) {
        const bodies = valid.map(([s, fac]) => {
          const unit = s.elec.unit || 'kWh';
          const b = { region: fac.region.trim().toUpperCase(), amount: { energy: num(s.elec.energy), energy_unit: unit } };
          if (s.elec.year) b.year = Math.round(num(s.elec.year));
          if (num(s.elec.recs) > 0) b.recs = { energy: num(s.elec.recs), energy_unit: unit };
          if (num(s.elec.direct) > 0) b.components = [{ amount: { energy: num(s.elec.direct), energy_unit: unit }, connection_type: 'direct', energy_source: 'renewable' }];
          return b;
        });
        try {
          const res = await API.electricityBatch(bodies);
          valid.forEach(([s], k) => {
            const r = res[k];
            if (!r || r.error) { s.error = (r && r.message) || 'Error desconocido'; s.result = null; return; }
            const pick = (m) => ({
              consumption: toKg(m.consumption && m.consumption.co2e, m.consumption && m.consumption.co2e_unit),
              wtt: toKg(m.well_to_tank && m.well_to_tank.co2e, m.well_to_tank && m.well_to_tank.co2e_unit),
              td: toKg(m.transmission_and_distribution && m.transmission_and_distribution.co2e, m.transmission_and_distribution && m.transmission_and_distribution.co2e_unit),
              wtt_td: toKg(m.well_to_tank_of_transmission_and_distribution && m.well_to_tank_of_transmission_and_distribution.co2e, m.well_to_tank_of_transmission_and_distribution && m.well_to_tank_of_transmission_and_distribution.co2e_unit),
              method: m.consumption && m.consumption.co2e_calculation_method,
              trail: m.consumption && m.consumption.source_trail,
            });
            s.result = { location: pick(r.location || {}), market: pick(r.market || {}), at: now, gwp: (r.location && r.location.consumption && r.location.consumption.co2e_calculation_method) || '', notices: r.notices || [] };
            s.error = null;
          });
        } catch (e) { apiError = e.message; valid.forEach(([s]) => { s.error = e.message; }); }
      }
    }

    ui.busy = false;
    save(); render();
    const errs = project.sources.filter((s) => s.error).length;
    if (apiError) toast(apiError, true);
    else if (errs) toast(`Cálculo terminado con ${errs} fuente(s) con error. Revisa el detalle.`, true);
    else toast('Cálculo completado.');
  }

  // ------------------------------------------------------------
  // Agregación de resultados
  // ------------------------------------------------------------
  function compute() {
    const p = project;
    const useMkt = p.settings.scope2Totals === 'market';
    const catOn = (id) => p.boundaries.categories[id] && p.boundaries.categories[id].status === 'included';
    const t = { s1: 0, s2loc: 0, s2mkt: 0, s3: 0, removals: 0, biogenic: 0, byCat: {}, byIso: {}, byFac: {}, gases: { co2: 0, ch4: 0, n2o: 0, other: 0 }, rows: [], pending: [], errors: [], excluded: [], factors: [] };
    const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };

    p.sources.forEach((s) => {
      const cat = S.byId[s.catId];
      if (!cat) return;
      if (!catOn(s.catId)) { t.excluded.push(s); return; }
      if (s.error) t.errors.push(s);
      if (!s.result) { t.pending.push(s); return; }
      const fac = p.facilities.find((f) => f.id === s.facilityId);
      const k = facilityShare(fac);
      const facKey = s.facilityId || '_';
      const uA = num(s.quality.uActivity);
      const uF = s.quality.uFactor !== '' && s.quality.uFactor != null ? num(s.quality.uFactor) : (s.factor && s.factor.uncertainty != null ? num(s.factor.uncertainty) : S.FACTOR_UNCERTAINTY_DEFAULT);
      const u = Math.sqrt(uA ** 2 + uF ** 2);

      if (s.isRemoval) { t.removals += Math.abs(s.result.co2e) * k; return; }
      t.biogenic += num(s.biogenic) * k;

      if (s.result.location) {
        const L = s.result.location, M = s.result.market;
        const loc = L.consumption * k, mkt = M.consumption * k;
        const val = useMkt ? mkt : loc;
        t.s2loc += loc; t.s2mkt += mkt;
        add(t.byCat, s.catId, val); add(t.byIso, 2, val); add(t.byFac, facKey, val);
        t.rows.push({ s, cat, scope: 2, kg: val, loc, mkt, u, share: k });
        if (catOn('s3_3')) {
          const up = useMkt ? M : L;
          const v = (up.wtt + up.td + up.wtt_td) * k;
          t.s3 += v; add(t.byCat, 's3_3', v); add(t.byIso, 4, v); add(t.byFac, facKey, v);
          t.rows.push({ s, cat: S.byId.s3_3, scope: 3, kg: v, u, share: k, derived: true });
        }
      } else {
        const v = s.result.co2e * k;
        if (cat.scope === 1) t.s1 += v;
        else if (cat.scope === 2) { t.s2loc += v; t.s2mkt += v; }
        else t.s3 += v;
        add(t.byCat, s.catId, v); add(t.byIso, cat.iso, v); add(t.byFac, facKey, v);
        if (s.result.gases) ['co2', 'ch4', 'n2o', 'other'].forEach((g) => { if (s.result.gases[g] != null) t.gases[g] += num(s.result.gases[g]) * k; });
        t.rows.push({ s, cat, scope: cat.scope, kg: v, u, share: k });
      }
    });

    t.s2 = useMkt ? t.s2mkt : t.s2loc;
    t.total = t.s1 + t.s2 + t.s3;
    const sumSq = t.rows.reduce((a, r) => a + (r.kg * r.u / 100) ** 2, 0);
    t.uncertainty = t.total > 0 ? (Math.sqrt(sumSq) / t.total) * 100 : 0;
    const seen = new Set();
    p.sources.forEach((s) => {
      if (s.method === 'climatiq' && s.factor && !seen.has(s.factor.id)) { seen.add(s.factor.id); t.factors.push({ kind: 'climatiq', f: s.factor }); }
      if (s.method === 'manual' && s.manual.ref) { const key = 'm:' + s.manual.ref + s.manual.factor; if (!seen.has(key)) { seen.add(key); t.factors.push({ kind: 'manual', s }); } }
      if (s.method === 'electricity' && s.result && s.result.location) { const key = 'e:' + facilityName(s.facilityId); if (!seen.has(key)) { seen.add(key); t.factors.push({ kind: 'electricity', s }); } }
    });
    return t;
  }

  // ------------------------------------------------------------
  // 6. Resultados
  // ------------------------------------------------------------
  function bars(entries, cls) {
    const max = Math.max(...entries.map((e) => e.v), 0);
    if (!entries.length || max <= 0) return '<div class="empty">Sin datos.</div>';
    return `<div class="bars">${entries.map((e) => `
      <div class="bar-row"><span>${esc(e.label)}</span>
        <div class="bar-track"><div class="bar-fill ${e.cls || cls || ''}" style="width:${(e.v / max) * 100}%"></div></div>
        <span class="num" style="text-align:right">${fmtT(e.v)} t</span></div>`).join('')}</div>`;
  }

  function renderResultados() {
    const t = compute();
    const scopeOf = (id) => S.byId[id].scope;
    const catEntries = Object.entries(t.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([id, v]) => ({ label: (scopeOf(id) === 3 ? `3.${S.byId[id].cat} ` : '') + S.byId[id].name, v, cls: 's' + scopeOf(id) }));
    const facEntries = Object.entries(t.byFac).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ label: facilityName(id), v }));
    const total = t.total || 1;
    return pageHead('Paso 6', 'Cálculo y resultados',
      'Emisiones = dato de actividad × factor de emisión, expresadas en toneladas de CO₂ equivalente usando los potenciales de calentamiento global (PCG) del IPCC.') + `
      <div class="row" style="margin-bottom:16px">
        <button class="btn" data-action="calculate" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spinner"></span> Calculando…' : 'Calcular / recalcular todo'}</button>
        <span class="muted" style="font-size:.85rem">Alcance 2 en el total: <strong>${project.settings.scope2Totals === 'market' ? 'mercado' : 'ubicación'}</strong> · PCG ${esc(settings.calculationMethod.toUpperCase())} · Datos Climatiq ${esc(settings.dataVersion)}</span>
      </div>
      ${t.pending.length ? `<div class="callout warn"><p><strong>${t.pending.length} fuente(s) sin calcular:</strong> ${t.pending.map((s) => esc(s.description)).join(', ')}.</p></div>` : ''}
      ${t.errors.length ? `<div class="callout danger"><p><strong>Errores:</strong> ${t.errors.map((s) => `${esc(s.description)} — ${esc(s.error)}`).join('<br>')}</p></div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="label">Total inventario</div><div class="value">${fmtT(t.total)}</div><div class="unit">tCO₂e</div></div>
        <div class="kpi s1"><div class="label">Alcance 1</div><div class="value">${fmtT(t.s1)}</div><div class="unit">tCO₂e · ${fmtN(pct(t.s1, total), 1)}%</div></div>
        <div class="kpi s2"><div class="label">Alcance 2 (${project.settings.scope2Totals === 'market' ? 'mercado' : 'ubicación'})</div><div class="value">${fmtT(t.s2)}</div><div class="unit">tCO₂e · ${fmtN(pct(t.s2, total), 1)}%</div></div>
        <div class="kpi s3"><div class="label">Alcance 3</div><div class="value">${fmtT(t.s3)}</div><div class="unit">tCO₂e · ${fmtN(pct(t.s3, total), 1)}%</div></div>
      </div>
      <div class="card">
        <h3>Distribución por alcance</h3>
        <div class="stack">
          <div style="width:${pct(t.s1, total)}%;background:var(--s1)"></div>
          <div style="width:${pct(t.s2, total)}%;background:var(--s2)"></div>
          <div style="width:${pct(t.s3, total)}%;background:var(--s3)"></div>
        </div>
        <div class="legend"><span><i style="background:var(--s1)"></i>Alcance 1</span><span><i style="background:var(--s2)"></i>Alcance 2</span><span><i style="background:var(--s3)"></i>Alcance 3</span></div>
      </div>
      <div class="grid two">
        <div class="card"><h3>Por categoría</h3>${bars(catEntries)}</div>
        <div class="card"><h3>Por instalación</h3>${bars(facEntries)}</div>
      </div>
      <div class="grid two">
        <div class="card">
          <h3>Alcance 2 — reporte dual</h3>
          <table><tbody>
            <tr><td>Basado en ubicación</td><td class="num">${fmtT(t.s2loc)} tCO₂e</td></tr>
            <tr><td>Basado en mercado</td><td class="num">${fmtT(t.s2mkt)} tCO₂e</td></tr>
          </tbody></table>
          <p class="muted" style="font-size:.8rem;margin-top:8px">El GHG Protocol Scope 2 Guidance exige reportar ambos métodos.</p>
        </div>
        <div class="card">
          <h3>Por categoría ISO 14064-1</h3>
          <table><tbody>${Object.entries(S.ISO_CATEGORIES).map(([k, l]) => `<tr><td>${esc(l)}</td><td class="num">${fmtT(t.byIso[k] || 0)} t</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
      <div class="grid two">
        <div class="card">
          <h3>Gases (masa, fuentes con desglose)</h3>
          <table><tbody>
            <tr><td>CO₂</td><td class="num">${fmtT(t.gases.co2, 3)} t</td></tr>
            <tr><td>CH₄</td><td class="num">${fmtT(t.gases.ch4, 4)} t</td></tr>
            <tr><td>N₂O</td><td class="num">${fmtT(t.gases.n2o, 4)} t</td></tr>
            <tr><td>Otros (CO₂e)</td><td class="num">${fmtT(t.gases.other, 3)} t</td></tr>
          </tbody></table>
          <p class="muted" style="font-size:.8rem;margin-top:8px">Solo incluye fuentes cuyo factor publica el desglose por gas.</p>
        </div>
        <div class="card">
          <h3>Reportados por separado</h3>
          <table><tbody>
            <tr><td>Remociones de GEI</td><td class="num">${fmtT(t.removals)} tCO₂e</td></tr>
            <tr><td>CO₂ biogénico</td><td class="num">${fmtT(t.biogenic)} tCO₂</td></tr>
            <tr><td>Incertidumbre combinada estimada</td><td class="num">±${fmtN(t.uncertainty, 1)}%</td></tr>
            ${project.baseYear.totalT !== '' && num(project.baseYear.totalT) > 0 ? `<tr><td>Variación vs. año base ${esc(project.baseYear.year)}</td><td class="num">${fmtN(pct(t.total / 1000 - num(project.baseYear.totalT), num(project.baseYear.totalT)), 1)}%</td></tr>` : ''}
          </tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Detalle por fuente</h3><button class="btn ghost small" data-action="export-csv">Exportar CSV</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Fuente</th><th>Instalación</th><th>Categoría</th><th class="num">% consol.</th><th class="num">tCO₂e</th><th class="num">±%</th></tr></thead>
          <tbody>${t.rows.map((r) => `<tr><td>${esc(r.s.description)}${r.derived ? ' <span class="badge">aguas arriba</span>' : ''}</td><td>${esc(facilityName(r.s.facilityId))}</td><td><span class="badge s${r.scope}">${r.scope === 3 ? '3.' + r.cat.cat : r.scope}</span> ${esc(r.cat.name)}</td><td class="num">${fmtN(r.share * 100, 0)}%</td><td class="num">${fmtT(r.kg, 3)}</td><td class="num">${fmtN(r.u, 0)}</td></tr>`).join('')}
            <tr class="total"><td colspan="4">Total</td><td class="num">${fmtT(t.total, 3)}</td><td class="num">${fmtN(t.uncertainty, 1)}</td></tr></tbody>
        </table></div>
      </div>`;
  }

  // ------------------------------------------------------------
  // 7. Calidad e incertidumbre
  // ------------------------------------------------------------
  function renderCalidad() {
    const t = compute();
    const byMethod = {};
    t.rows.forEach((r) => { const m = r.s.quality.method; byMethod[m] = (byMethod[m] || 0) + r.kg; });
    const excludedCats = S.CATEGORIES.filter((c) => project.boundaries.categories[c.id].status === 'excluded');
    const checks = [
      ['Organización y objetivo documentados', !!(project.org.name && project.purpose.objective)],
      ['Al menos una instalación con región definida', project.facilities.some((f) => f.region)],
      ['Todas las categorías evaluadas y exclusiones justificadas', boundaryIssues().length === 0],
      ['Todas las fuentes incluidas calculadas sin errores', t.pending.length === 0 && t.errors.length === 0 && project.sources.length > 0],
      ['Fuentes con evidencia documentada', project.sources.length > 0 && project.sources.every((s) => String(s.evidence || '').trim())],
      ['Factores propios con referencia', project.sources.filter((s) => s.method === 'manual').every((s) => String(s.manual.ref || '').trim())],
      ['Alcance 2 reportado por ubicación y mercado', project.sources.some((s) => s.result && s.result.location) || !project.sources.some((s) => s.catId === 's2_electricity')],
    ];
    return pageHead('Paso 7', 'Calidad del inventario e incertidumbre',
      'ISO 14064-1 §8 pide gestionar la calidad de la información y evaluar la incertidumbre. La incertidumbre combinada se estima por propagación de errores (IPCC 2006, Vol. 1, cap. 3, enfoque 1): U = √Σ(Eᵢ·Uᵢ)² / ΣEᵢ.') + `
      <div class="card">
        <h2>Principios (GHG Protocol cap. 1 / ISO 14064-1 §4)</h2>
        <p class="muted" style="font-size:.87rem">Confirma que el inventario cumple cada principio.</p>
        ${S.PRINCIPLES.map((pr) => `<div style="padding:8px 0;border-top:1px solid var(--border)">${check(`<strong>${pr.name}</strong> — <span class="muted">${pr.help}</span>`, `p.purpose.principles.${pr.id}`, { rerender: true })}</div>`).join('')}
      </div>
      <div class="card">
        <h2>Lista de verificación</h2>
        <table><tbody>${checks.map(([l, ok]) => `<tr><td>${ok ? '<span class="badge ok">✓</span>' : '<span class="badge warn">Pendiente</span>'}</td><td>${l}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="grid two">
        <div class="card">
          <h3>Emisiones según tipo de dato</h3>
          ${bars(Object.entries(byMethod).map(([m, v]) => ({ label: S.DATA_METHODS[m] || m, v })))}
          <p class="muted" style="font-size:.8rem;margin-top:10px">Mientras mayor sea la proporción de datos medidos, mayor la exactitud. Prioriza mejorar los datos de las fuentes más grandes.</p>
        </div>
        <div class="card">
          <h3>Incertidumbre combinada</h3>
          <div class="value" style="font-size:2rem;font-weight:700">±${fmtN(t.uncertainty, 1)}%</div>
          <p class="muted" style="font-size:.85rem">Valores por defecto orientativos: medido ±2%, calculado ±5%, estimado ±20%, basado en gasto ±30%; factor ±10% si la fuente no informa su incertidumbre. Ajústalos por fuente en el paso 5.</p>
        </div>
      </div>
      <div class="card">
        <h3>Exclusiones declaradas</h3>
        ${excludedCats.length ? `<table><thead><tr><th>Categoría</th><th>Justificación</th></tr></thead><tbody>${excludedCats.map((c) => `<tr><td>${c.scope === 3 ? '3.' + c.cat + ' ' : 'A' + c.scope + ' · '}${esc(c.name)}</td><td>${esc(project.boundaries.categories[c.id].justification || '— sin justificar —')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No hay exclusiones.</p>'}
      </div>`;
  }

  // ------------------------------------------------------------
  // 8. Informe — un único modelo alimenta la vista HTML y el Word
  // ------------------------------------------------------------
  function reportModel() {
    const p = project, t = compute(), o = p.org;
    const d = (v) => (String(v ?? '').trim() ? String(v) : '—');
    const verif = { none: 'Sin verificación', internal: 'Revisión interna', limited: 'Verificación externa con aseguramiento limitado', reasonable: 'Verificación externa con aseguramiento razonable' }[p.purpose.verification] || '—';
    const use = { internal: 'Gestión interna', public: 'Comunicación pública', program: 'Programa voluntario', regulatory: 'Requisito regulatorio o de cliente', offset: 'Base para neutralidad / compensación' }[p.purpose.intendedUse] || '';
    const statusTxt = { included: 'Incluida', excluded: 'Excluida', pending: 'Por evaluar' };
    const catLabel = (c) => `${c.scope === 3 ? '3.' + c.cat : 'A' + c.scope} ${c.name}`;
    const s2name = p.settings.scope2Totals === 'market' ? 'mercado' : 'ubicación';
    const hasBase = p.baseYear.totalT !== '' && num(p.baseYear.totalT) > 0;
    const B = [];
    const h2 = (text) => B.push({ t: 'h2', text });
    const h3 = (text) => B.push({ t: 'h3', text });
    const para = (...runs) => B.push({ t: 'p', runs: runs.map((r) => (typeof r === 'string' ? { text: r } : r)) });
    const note = (text) => B.push({ t: 'p', muted: true, runs: [{ text }] });
    const kv = (rows) => B.push({ t: 'kv', rows });
    const table = (head, rows, opt = {}) => B.push({ t: 'table', head, rows, ...opt });

    B.push({ t: 'eyebrow', text: 'Informe de gases de efecto invernadero' });
    B.push({ t: 'h1', text: `${d(o.name)} — Inventario de GEI ${p.period.year}` });
    note(`Preparado tomando como referencia ISO 14064-1:2018 y el GHG Protocol Corporate Standard. Emitido el ${new Date().toLocaleDateString('es')}.`);

    h2('Resumen');
    table(['Indicador', 'Valor'], [
      ['Emisiones totales (Alcance 2 por ' + s2name + ')', fmtT(t.total) + ' tCO₂e'],
      ['Alcance 1', fmtT(t.s1) + ' tCO₂e'],
      ['Alcance 2 — ubicación / mercado', `${fmtT(t.s2loc)} / ${fmtT(t.s2mkt)} tCO₂e`],
      ['Alcance 3', fmtT(t.s3) + ' tCO₂e'],
      ['Incertidumbre combinada estimada', '±' + fmtN(t.uncertainty, 1) + '%'],
      ...(hasBase ? [[`Variación vs. año base ${p.baseYear.year}`, fmtN(pct(t.total / 1000 - num(p.baseYear.totalT), num(p.baseYear.totalT)), 1) + '%']] : []),
    ], { num: [1] });

    h2('1. Organización que informa');
    kv([['Razón social', d(o.name)], ['Identificador', d(o.taxId)], ['Sector', d(o.sector)],
      ['País / dirección', d([o.country, o.address].filter(Boolean).join(' — '))],
      ['Responsable', d([o.responsible, o.responsibleRole].filter(Boolean).join(', '))], ['Descripción', d(o.description)]]);

    h2('2. Propósito, usuarios y verificación');
    kv([['Objetivo', d(p.purpose.objective)], ['Usuarios previstos', d(p.purpose.users)], ['Uso previsto', d(use)],
      ['Verificación', verif + (p.purpose.verifier ? ' — ' + p.purpose.verifier : '')], ['Período de reporte', `${p.period.start} a ${p.period.end}`]]);

    h2('3. Límites organizacionales');
    para('Enfoque de consolidación: ', { text: S.CONSOLIDATION[p.consolidation].name, b: true }, '. ' + S.CONSOLIDATION[p.consolidation].help);
    table(['Instalación', 'Región', 'Dirección', '% consolidado'],
      p.facilities.map((f) => [d(f.name), d(f.region), d(f.address), fmtN(facilityShare(f) * 100, 1) + '%']), { num: [3], widths: [3, 1, 4, 2] });

    h2('4. Límites de informe');
    para(`Umbral de materialidad para exclusiones: ${fmtN(p.boundaries.materiality, 1)}% de las emisiones totales.`);
    table(['Alcance / categoría', 'ISO', 'Estado', 'Criterios / justificación'], S.CATEGORIES.map((c) => {
      const st = p.boundaries.categories[c.id];
      const crit = S.RELEVANCE_CRITERIA.filter((r) => st.criteria && st.criteria[r.id]).map((r) => r.label).join(', ');
      return [catLabel(c), String(c.iso), statusTxt[st.status], [crit, st.justification].filter(Boolean).join(' — ')];
    }), { widths: [3.2, 0.7, 1.2, 4.9] });

    h2('5. Año base');
    kv([['Año base', `${p.baseYear.year}${hasBase ? ` — ${fmtN(p.baseYear.totalT)} tCO₂e` : ''}`], ['Justificación', d(p.baseYear.justification)],
      ['Política de recálculo', `${d(p.baseYear.policy)} Umbral: ${fmtN(p.baseYear.threshold, 1)}%.`]]);

    h2('6. Resultados');
    table(['Alcance', 'tCO₂e', '%'], [
      ['Alcance 1 — emisiones directas', fmtT(t.s1), fmtN(pct(t.s1, t.total), 1)],
      ['Alcance 2 — basado en ubicación', fmtT(t.s2loc), p.settings.scope2Totals === 'location' ? fmtN(pct(t.s2, t.total), 1) : '—'],
      ['Alcance 2 — basado en mercado', fmtT(t.s2mkt), p.settings.scope2Totals === 'market' ? fmtN(pct(t.s2, t.total), 1) : '—'],
      ['Alcance 3 — otras indirectas', fmtT(t.s3), fmtN(pct(t.s3, t.total), 1)],
      [`Total (Alcance 2 por ${s2name})`, fmtT(t.total), '100'],
      ['Remociones (no netas)', fmtT(t.removals), ''],
      ['CO₂ biogénico (tCO₂, fuera de alcances)', fmtT(t.biogenic), ''],
    ], { num: [1, 2], total: 4, sub: [5, 6], widths: [6, 2, 2] });
    h3('Por categoría ISO 14064-1');
    table(['Categoría', 'tCO₂e'], Object.entries(S.ISO_CATEGORIES).map(([k, l]) => [l, fmtT(t.byIso[k] || 0)]), { num: [1], widths: [8, 2] });
    h3('Por categoría GHG Protocol');
    table(['Categoría', 'tCO₂e'], S.CATEGORIES.filter((c) => t.byCat[c.id]).map((c) => [catLabel(c), fmtT(t.byCat[c.id])]), { num: [1], widths: [8, 2] });
    h3('Por instalación');
    table(['Instalación', 'tCO₂e'], Object.entries(t.byFac).sort((a, b) => b[1] - a[1]).map(([id, v]) => [facilityName(id), fmtT(v)]), { num: [1], widths: [8, 2] });
    h3('Por gas (masa)');
    table(['Gas', 'Toneladas'], [['CO₂', fmtT(t.gases.co2, 3)], ['CH₄', fmtT(t.gases.ch4, 4)], ['N₂O', fmtT(t.gases.n2o, 4)], ['Otros GEI (HFCs, PFCs, SF₆, NF₃) en CO₂e', fmtT(t.gases.other, 3)]], { num: [1], widths: [8, 2] });
    note('Desglose disponible solo para factores que publican emisiones por gas.');

    h2('7. Metodología de cuantificación');
    para(`Las emisiones se cuantificaron como dato de actividad × factor de emisión, expresadas en CO₂e con los potenciales de calentamiento global del IPCC ${settings.calculationMethod.toUpperCase()} (horizonte de 100 años) cuando el factor lo permite. Los factores provienen de la base de datos de Climatiq (versión de datos ${settings.dataVersion}) y de fuentes propias documentadas. El Alcance 2 se calculó con los métodos basado en ubicación y basado en mercado según el GHG Protocol Scope 2 Guidance; las emisiones aguas arriba de la electricidad se asignaron a Alcance 3, categoría 3${p.boundaries.categories.s3_3.status === 'included' ? '' : ' (categoría excluida en este inventario)'}.`);
    table(['Factor', 'Fuente', 'Región', 'Año'], t.factors.map((x) => {
      if (x.kind === 'climatiq') return [`${x.f.name}\n${x.f.activity_id}`, `${x.f.source}${x.f.source_dataset ? ' · ' + x.f.source_dataset : ''}`, d(x.f.region_name || x.f.region), d(x.f.year)];
      if (x.kind === 'manual') return [`${x.s.description} — ${fmtN(x.s.manual.factor, 6)} kgCO₂e/${x.s.manual.unit}`, x.s.manual.ref, '—', '—'];
      const fac = p.facilities.find((f) => f.id === x.s.facilityId);
      const trail = (x.s.result.location.trail || []).map((tr) => tr.source || tr.name || '').filter(Boolean).join(', ') || 'factores de red';
      return [`Electricidad de red — ${facilityName(x.s.facilityId)}`, `Climatiq Energy API v1.5 (${trail})`, d(fac && fac.region), d(x.s.elec.year || 'último disp.')];
    }), { widths: [4.5, 3.5, 1.2, 0.8], empty: 'Sin factores.' });

    h3('Detalle por fuente');
    table(['Fuente', 'Instalación', 'Categoría', 'tCO₂e', '±%'], t.rows.map((r) => [
      r.s.description + (r.derived ? ' (aguas arriba)' : ''), facilityName(r.s.facilityId),
      (r.scope === 3 ? '3.' + r.cat.cat : 'A' + r.scope) + ' ' + r.cat.name, fmtT(r.kg, 3), fmtN(r.u, 0)]), { num: [3, 4], widths: [3, 2, 3, 1.2, 0.8], empty: 'Sin fuentes calculadas.' });

    h2('8. Exclusiones');
    const exc = S.CATEGORIES.filter((c) => p.boundaries.categories[c.id].status === 'excluded');
    if (exc.length) exc.forEach((c) => para({ text: catLabel(c) + ': ', b: true }, d(p.boundaries.categories[c.id].justification)));
    else para('No se declararon exclusiones.');

    h2('9. Incertidumbre y calidad de datos');
    para('Incertidumbre combinada estimada del inventario: ', { text: `±${fmtN(t.uncertainty, 1)}%`, b: true },
      ` (propagación de errores, IPCC 2006 enfoque 1). Principios confirmados: ${S.PRINCIPLES.filter((x) => p.purpose.principles[x.id]).map((x) => x.name).join(', ') || 'ninguno'}.`);

    h2('10. Declaración');
    para('Este inventario fue preparado tomando como referencia la norma ISO 14064-1:2018 y el GHG Protocol. ' +
      (p.purpose.verification === 'limited' || p.purpose.verification === 'reasonable'
        ? `Será sometido a verificación externa (${verif.toLowerCase()}) conforme a ISO 14064-3.`
        : 'Este informe no ha sido verificado por un tercero independiente.'));
    B.push({ t: 'sign', lines: [d(o.responsible), d(o.responsibleRole)] });
    return { blocks: B, t };
  }

  function blocksToHtml(blocks) {
    const runs = (rs) => rs.map((r) => (r.b ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join('');
    const cell = (c) => esc(c).replace(/\n/g, '<br><small class="muted">') + (String(c).includes('\n') ? '</small>' : '');
    return blocks.map((b) => {
      switch (b.t) {
        case 'eyebrow': return `<div style="color:var(--accent);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em">${esc(b.text)}</div>`;
        case 'h1': return `<h1>${esc(b.text)}</h1>`;
        case 'h2': return `<h2>${esc(b.text)}</h2>`;
        case 'h3': return `<h3>${esc(b.text)}</h3>`;
        case 'p': return `<p${b.muted ? ' class="muted" style="font-size:.85rem"' : ''}>${runs(b.runs)}</p>`;
        case 'kv': return `<dl>${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
        case 'sign': return `<p style="margin-top:40px">______________________________<br>${esc(b.lines[0])}<br><span class="muted">${esc(b.lines[1])}</span></p>`;
        case 'table': {
          const n = (i) => ((b.num || []).includes(i) ? ' class="num"' : '');
          const body = b.rows.length ? b.rows.map((r, ri) => `<tr${ri === b.total ? ' class="total"' : (b.sub || []).includes(ri) ? ' class="sub"' : ''}>${r.map((c, i) => `<td${n(i)}>${cell(c)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${b.head.length}" class="muted">${esc(b.empty || 'Sin datos.')}</td></tr>`;
          return `<div class="table-wrap"><table><thead><tr>${b.head.map((h, i) => `<th${n(i)}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
        }
        default: return '';
      }
    }).join('\n');
  }

  function renderInforme() {
    const { blocks, t } = reportModel();
    return `
      <div class="row no-print" style="margin-bottom:16px">
        <button class="btn" data-action="export-word" ${ui.wordBusy ? 'disabled' : ''}>${ui.wordBusy ? '<span class="spinner"></span> Generando…' : 'Descargar informe Word'}</button>
        <button class="btn ghost" data-action="print">Imprimir / guardar PDF</button>
        <button class="btn ghost" data-action="export-csv">Exportar CSV</button>
        <button class="btn ghost" data-action="export-json">Guardar proyecto (JSON)</button>
      </div>
      ${t.pending.length || boundaryIssues().length ? '<div class="callout warn no-print"><p>El informe tiene elementos pendientes (fuentes sin calcular o categorías sin evaluar). Revisa los pasos 3, 5 y 7.</p></div>' : ''}
      <article class="report">${blocksToHtml(blocks)}</article>`;
  }

  // ------------------------------------------------------------
  // Exportación a Word (.docx) con la librería docx (se carga solo al usarla)
  // ------------------------------------------------------------
  const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js';
  function loadDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    if (loadDocx.p) return loadDocx.p;
    loadDocx.p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = DOCX_URL;
      s.onload = () => (window.docx ? resolve(window.docx) : reject(new Error('La librería docx no se inicializó.')));
      s.onerror = () => { loadDocx.p = null; reject(new Error('No se pudo descargar la librería para Word. Revisa tu conexión a internet.')); };
      document.head.appendChild(s);
    });
    return loadDocx.p;
  }

  async function exportWord() {
    ui.wordBusy = true; if (currentStep().id === 'informe') render();
    try {
      const D = await loadDocx();
      const { blocks } = reportModel();
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, Footer, Header, PageNumber } = D;
      const GREEN = '1F7A5A', MUTED = '5D6B64', LINE = 'D5DBD3';
      const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN;
      const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
      const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

      const cellParas = (text, o = {}) => String(text ?? '').split('\n').map((line, i) => new Paragraph({
        alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text: line, bold: !!o.bold, size: i > 0 ? 15 : 18, color: o.color || (i > 0 ? MUTED : undefined), font: i > 0 ? 'Consolas' : undefined })],
      }));
      const widthsFor = (b) => {
        const w = b.widths || b.head.map(() => 1);
        const sum = w.reduce((a, x) => a + x, 0);
        return w.map((x) => Math.round((x / sum) * CONTENT_W));
      };
      const mkTable = (b) => {
        const cols = widthsFor(b);
        const right = (i) => (b.num || []).includes(i);
        const head = new TableRow({ tableHeader: true, children: b.head.map((h, i) => new TableCell({
          width: { size: cols[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E3F1EA' },
          margins: { left: 90, right: 90 }, children: cellParas(h, { bold: true, right: right(i), color: '165C43' }) })) });
        const rows = b.rows.length ? b.rows.map((r, ri) => new TableRow({ children: r.map((c, i) => new TableCell({
          width: { size: cols[i], type: WidthType.DXA }, margins: { left: 90, right: 90 },
          shading: ri === b.total ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F0F2EE' } : undefined,
          children: cellParas(c, { right: right(i), bold: ri === b.total, color: (b.sub || []).includes(ri) ? MUTED : undefined }) })) }))
          : [new TableRow({ children: [new TableCell({ columnSpan: b.head.length, width: { size: CONTENT_W, type: WidthType.DXA }, children: cellParas(b.empty || 'Sin datos.', { color: MUTED }) })] })];
        return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: cols, rows: [head, ...rows],
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border } });
      };
      const mkKv = (b) => {
        const cols = [Math.round(CONTENT_W * 0.3), CONTENT_W - Math.round(CONTENT_W * 0.3)];
        return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: cols,
          borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideVertical: noBorder, insideHorizontal: border },
          rows: b.rows.map(([k, v]) => new TableRow({ children: [
            new TableCell({ width: { size: cols[0], type: WidthType.DXA }, margins: { right: 120 }, children: cellParas(k, { color: MUTED }) }),
            new TableCell({ width: { size: cols[1], type: WidthType.DXA }, children: cellParas(v) })] })) });
      };
      const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

      const children = [];
      blocks.forEach((b) => {
        switch (b.t) {
          case 'eyebrow': children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: b.text.toUpperCase(), bold: true, color: GREEN, size: 17, characterSpacing: 20 })] })); break;
          case 'h1': children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(b.text)] })); break;
          case 'h2': children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(b.text)] })); break;
          case 'h3': children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.text)] })); break;
          case 'p': children.push(new Paragraph({ spacing: { after: 120 }, children: b.runs.map((r) => new TextRun({ text: r.text, bold: !!r.b, color: b.muted ? MUTED : undefined, size: b.muted ? 18 : undefined })) })); break;
          case 'kv': children.push(mkKv(b), gap()); break;
          case 'table': children.push(mkTable(b), gap()); break;
          case 'sign': children.push(
            new Paragraph({ spacing: { before: 720 }, children: [new TextRun('______________________________')] }),
            new Paragraph({ children: [new TextRun(b.lines[0])] }),
            new Paragraph({ children: [new TextRun({ text: b.lines[1], color: MUTED })] })); break;
          default: break;
        }
      });

      const doc = new Document({
        creator: 'Calculadora Huella de Carbono',
        title: `Inventario de GEI ${project.period.year} — ${project.org.name || ''}`,
        description: 'Informe de gases de efecto invernadero (GHG Protocol / ISO 14064-1)',
        styles: {
          default: {
            document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { line: 276 } } },
            title: { run: { font: 'Calibri', size: 40, bold: true, color: '1B2420' }, paragraph: { spacing: { after: 120 } } },
            heading1: { run: { font: 'Calibri', size: 28, bold: true, color: GREEN }, paragraph: { spacing: { before: 360, after: 140 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 4 } } } },
            heading2: { run: { font: 'Calibri', size: 23, bold: true, color: '1B2420' }, paragraph: { spacing: { before: 240, after: 100 } } },
          },
        },
        sections: [{
          properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
          headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${project.org.name || 'Inventario de GEI'} · Inventario ${project.period.year}`, size: 16, color: MUTED })] })] }) },
          footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ size: 16, color: MUTED, children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES] })] })] }) },
          children,
        }],
      });
      const blob = await Packer.toBlob(doc);
      download(`informe-huella-${slug()}-${project.period.year}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      toast('Informe Word descargado.');
    } catch (e) {
      toast('No se pudo generar el Word: ' + e.message, true);
    } finally {
      ui.wordBusy = false; if (currentStep().id === 'informe') render();
    }
  }

  // ------------------------------------------------------------
  // Instrucciones de uso
  // ------------------------------------------------------------
  function renderAyuda() {
    const step = (n, id, title, body) => `
      <div class="help-step">
        <div class="help-num">${n}</div>
        <div><h3><a href="#/${id}">${title}</a></h3>${body}</div>
      </div>`;
    const faq = (q, a) => `<details class="faq"><summary>${q}</summary><div>${a}</div></details>`;
    return pageHead('Ayuda', 'Instrucciones de uso',
      'Cómo elaborar un inventario de gases de efecto invernadero con esta herramienta, de la recopilación de datos al informe en Word.') + `
      <div class="card">
        <h2>Antes de empezar</h2>
        <div class="grid two">
          <div>
            <h3>Datos que debes pedir a la organización</h3>
            <ul class="help-list">
              <li><strong>Electricidad:</strong> facturas de los 12 meses por instalación (kWh) y certificados renovables (I-REC, GO) o contratos PPA, si existen.</li>
              <li><strong>Combustibles:</strong> facturas o registros de gas natural, GLP, diésel, gasolina y otros (m³, L, kg o kWh).</li>
              <li><strong>Flota:</strong> litros cargados por vehículo, o kilómetros recorridos y tipo de vehículo.</li>
              <li><strong>Refrigerantes:</strong> informes de mantención con los kg recargados por tipo de gas (R-410A, R-134a, etc.).</li>
              <li><strong>Alcance 3:</strong> compras (kg o gasto), residuos (t por tratamiento), viajes (km o tramos), transporte de carga (t·km) y una encuesta de traslado de los empleados.</li>
            </ul>
          </div>
          <div>
            <h3>Configuración</h3>
            <ul class="help-list">
              <li>La conexión a Climatiq usa la API key configurada en Vercel. Prueba que funcione con <a href="#/inicio">Inicio → Probar conexión</a>.</li>
              <li>Si el sitio pide un código de acceso, ingrésalo en <a href="#" data-action="open-settings">Ajustes</a>; queda guardado en este navegador.</li>
              <li>En Ajustes también eliges el PCG (AR6 recomendado) y la versión de datos de Climatiq. Mantén la misma versión durante todo el inventario.</li>
              <li>¿Primera vez? Presiona <strong>Cargar ejemplo</strong> en Inicio para ver un inventario completo de muestra.</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Paso a paso</h2>
        ${step(1, 'organizacion', 'Organización y objetivo', '<p>Completa los datos de la empresa, el responsable del inventario, el objetivo (p. ej. línea base, reporte a clientes, HuellaChile) y quiénes usarán el informe. Indica si habrá verificación externa: eso define el nivel de exigencia de la evidencia.</p>')}
        ${step(2, 'limites-org', 'Límites organizacionales', '<p>Elige el enfoque de consolidación; lo más común es <strong>control operacional</strong>. Agrega cada instalación (oficina, planta, bodega, flota) con su <strong>código de región</strong>, por ejemplo <code>CL</code>, <code>MX</code> o <code>ES</code>. Ese código es necesario para calcular la electricidad.</p>')}
        ${step(3, 'limites-informe', 'Límites de informe', '<p>Alcance 1 y 2 vienen incluidos; marca como "No aplica" lo que no exista y explica por qué. En el Alcance 3, evalúa cada una de las 15 categorías: marca los criterios de relevancia y decide entre <strong>Incluida</strong> o <strong>Excluida</strong> (con justificación). No deben quedar categorías "Por evaluar". Aquí también eliges si el total usa el Alcance 2 por ubicación o por mercado.</p>')}
        ${step(4, 'periodo', 'Período y año base', '<p>Define el período (normalmente un año calendario) y el año base. Si es el primer inventario, el año base suele ser el mismo año. Revisa la política de recálculo propuesta y el umbral (5%).</p>')}
        ${step(5, 'fuentes', 'Fuentes y datos de actividad', `<p>Elige la categoría y la instalación, y presiona <strong>+ Agregar fuente</strong>. Abre la fuente y elige un método:</p>
          <ul class="help-list">
            <li><strong>Factor Climatiq:</strong> presiona <em>Buscar factor</em>, escribe en inglés (o usa las sugerencias), revisa fuente, región y año, y presiona <em>Usar</em>. Luego ingresa la cantidad y la unidad.</li>
            <li><strong>Electricidad:</strong> ingresa los kWh totales, los certificados renovables y la energía renovable con conexión directa. Se calculan ubicación y mercado, y las pérdidas de red van a la categoría 3.3.</li>
            <li><strong>Factor propio:</strong> úsalo para factores oficiales nacionales o del proveedor. Indica siempre la referencia.</li>
          </ul>
          <p>Completa la calidad del dato (medido, calculado o estimado) y la <strong>evidencia</strong> (qué documento respalda el dato). Usa <em>Duplicar</em> para registrar fuentes parecidas más rápido.</p>`)}
        ${step(6, 'resultados', 'Cálculo y resultados', '<p>Presiona <strong>Calcular / recalcular todo</strong>. Revisa los totales por alcance, categoría, instalación y gas. Si una fuente muestra error, ábrela en el paso 5 para ver el detalle. Si cambias un dato, esa fuente vuelve a quedar pendiente hasta que recalcules.</p>')}
        ${step(7, 'calidad', 'Calidad e incertidumbre', '<p>Confirma los cinco principios y revisa la lista de verificación: todo debe quedar en ✓ antes de emitir el informe. Ajusta la incertidumbre de las fuentes grandes si tienes mejor información.</p>')}
        ${step(8, 'informe', 'Informe', '<p>Revisa el informe en pantalla y presiona <strong>Descargar informe Word</strong> para obtener un <code>.docx</code> editable, con portada de datos, tablas, metodología, exclusiones y espacio para la firma. También puedes imprimirlo o guardarlo en PDF, o exportar el detalle a CSV para Excel.</p>')}
      </div>

      <div class="grid two">
        <div class="card">
          <h2>Guardar y compartir</h2>
          <ul class="help-list">
            <li>El trabajo se <strong>guarda solo</strong> en este navegador. Si borras los datos del navegador o cambias de equipo, se pierde.</li>
            <li><strong>Guardar proyecto</strong> descarga un archivo <code>.json</code>, que es el respaldo editable. Guárdalo en la carpeta del cliente.</li>
            <li><strong>Abrir proyecto</strong> carga ese <code>.json</code> para seguir trabajando, en este u otro equipo.</li>
            <li><strong>Descargar Word</strong> genera el informe final (<code>.docx</code>) para revisar, editar y entregar al cliente.</li>
            <li>Para trabajar con varios clientes, guarda un <code>.json</code> por cliente y ábrelo cuando lo necesites.</li>
          </ul>
        </div>
        <div class="card">
          <h2>Consejos para elegir factores</h2>
          <ul class="help-list">
            <li>Prefiere factores <strong>del país</strong> y del <strong>año más cercano</strong> al período.</li>
            <li>Busca en inglés: <em>natural gas, diesel, petrol, LPG, R-410A, flight, hotel stay, landfill, paper</em>.</li>
            <li>Si no hay resultados para tu país, borra la región para ver factores de otras regiones (p. ej. DEFRA o EPA) y deja documentado el supuesto.</li>
            <li>Para la electricidad de Chile, si Climatiq no tiene datos para <code>CL</code>, usa <strong>Factor propio</strong> con el factor oficial del Sistema Eléctrico Nacional publicado por el Ministerio de Energía.</li>
            <li>Los datos físicos (kWh, litros, kg) son más exactos que los basados en gasto (dinero).</li>
          </ul>
        </div>
      </div>

      <div class="card">
        <h2>Problemas frecuentes</h2>
        ${faq('"Falta la API key"', 'La variable <code>CLIMATIQ_API_KEY</code> no está configurada en Vercel o no se hizo <em>Redeploy</em> después de agregarla.')}
        ${faq('"Código de acceso inválido"', 'Ingresa en <a href="#" data-action="open-settings">Ajustes</a> exactamente el mismo valor que <code>APP_ACCESS_CODE</code> en Vercel.')}
        ${faq('La búsqueda no encuentra factores', 'Escribe en inglés, quita el filtro de región o de año, o prueba un término más general. Si aparece "existen factores premium", esos datos requieren un plan pagado de Climatiq.')}
        ${faq('"La instalación no tiene código de región"', 'Ve a <a href="#/limites-org">Límites organizacionales</a> y completa el código (p. ej. <code>CL</code>) de la instalación de esa fuente.')}
        ${faq('Una fuente dice "Datos incompletos"', 'Falta elegir el factor o ingresar la cantidad. En el factor propio se necesitan la cantidad y el factor.')}
        ${faq('Una categoría no aparece al agregar una fuente', 'Solo aparecen las categorías marcadas como <strong>Incluida</strong> en el paso 3.')}
        ${faq('El Word no se descarga', 'La primera descarga necesita internet para cargar el generador de Word. Revisa tu conexión y que el navegador no esté bloqueando las descargas.')}
        ${faq('Abrí la página como archivo y la búsqueda no funciona', 'La API solo funciona en el sitio publicado en Vercel o con <code>vercel dev</code>. Abriendo <code>index.html</code> directamente solo funcionan los factores propios.')}
      </div>

      <div class="card">
        <h2>Flujo sugerido para ofrecer el servicio</h2>
        <ol class="help-list">
          <li><strong>Reunión inicial:</strong> objetivo, usuarios del informe, instalaciones y enfoque de consolidación (pasos 1 y 2).</li>
          <li><strong>Evaluación de límites:</strong> revisa con el cliente qué categorías de Alcance 3 son relevantes (paso 3).</li>
          <li><strong>Solicitud de datos:</strong> envía la lista de "Datos que debes pedir", con un plazo.</li>
          <li><strong>Carga y cálculo:</strong> registra las fuentes, calcula y revisa los valores atípicos (pasos 5 y 6).</li>
          <li><strong>Control de calidad:</strong> completa la lista de verificación (paso 7).</li>
          <li><strong>Entrega:</strong> descarga el Word, agrega conclusiones y recomendaciones de reducción, y entrégalo junto con el <code>.json</code> de respaldo.</li>
        </ol>
      </div>`;
  }

  // ============================================================
  // Modales
  // ============================================================
  function renderModal() {
    const rootEl = document.getElementById('modal-root');
    if (ui.search) rootEl.innerHTML = searchModal();
    else if (ui.settingsOpen) rootEl.innerHTML = settingsModal();
    else rootEl.innerHTML = '';
  }

  function searchModal() {
    const q = ui.search;
    const s = project.sources.find((x) => x.id === q.sourceId);
    const cat = s && S.byId[s.catId];
    const pf = q.possible || {};
    const opt = (arr, cur) => `<option value="">Todos</option>${(arr || []).map((v) => `<option${String(cur) === String(v) ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
    return `<div class="modal-backdrop" data-action="close-modal-bg">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="search-title">
        <div class="modal-head"><h2 id="search-title">Buscar factor de emisión</h2><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">×</button></div>
        <div class="modal-body">
          <form data-action-submit="run-search">
            <div class="grid">
              ${field('Búsqueda (en inglés)', 'ui.search.query', { type: 'search', placeholder: 'natural gas, diesel, electricity…' })}
              ${field('Región', 'ui.search.region', { placeholder: 'CL, ES, MX… (vacío = todas)', help: 'Usa * como comodín: US-*' })}
              ${field('Año', 'ui.search.year', { type: 'number', step: 1, placeholder: 'Cualquiera' })}
            </div>
            <div class="grid" style="margin-top:10px">
              <label class="field"><span>Tipo de unidad</span><select data-bind="ui.search.unit_type">${opt(pf.unit_type, q.unit_type)}</select></label>
              <label class="field"><span>Fuente</span><select data-bind="ui.search.source">${opt((pf.source || []).map((x) => x.source), q.source)}</select></label>
              <label class="field"><span>Etapa LCA</span><select data-bind="ui.search.source_lca_activity">${opt(pf.source_lca_activity, q.source_lca_activity)}</select></label>
              <div class="field"><span>&nbsp;</span><button class="btn" type="submit">${q.loading ? '<span class="spinner"></span>' : 'Buscar'}</button></div>
            </div>
          </form>
          ${cat ? `<div class="chips" style="margin-top:12px"><span class="muted" style="font-size:.8rem">Sugerencias para ${esc(cat.name)}:</span>${cat.queries.map((x) => `<button class="chip" data-action="search-chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
          ${q.error ? `<div class="callout danger" style="margin-top:14px"><p>${esc(q.error)}</p></div>` : ''}
          ${q.results ? `<p class="muted" style="font-size:.82rem;margin-top:14px">${q.total} resultado(s)${q.total > q.results.length ? `, mostrando ${q.results.length}` : ''}. Prefiere factores de tu país, del año más cercano al período y de fuentes oficiales.</p>` : ''}
          ${(q.results || []).map((r, k) => `
            <div class="result-item">
              <div>
                <strong>${esc(r.name)}</strong>
                <div class="meta"><b>${esc(r.source)}</b>${r.source_dataset ? ' · ' + esc(r.source_dataset) : ''} · <b>${esc(r.region_name || r.region)}</b> · ${esc(r.year)} · ${esc(r.unit_type)}${r.factor != null ? ` · <b>${fmtN(r.factor, 5)} ${esc(r.unit)}</b>` : ''}${r.source_lca_activity ? ' · ' + esc(r.source_lca_activity) : ''}${r.access_type && r.access_type !== 'public' ? ` · <span class="badge warn">${esc(r.access_type)}</span>` : ''}</div>
                <div class="meta"><code>${esc(r.activity_id)}</code></div>
              </div>
              <div><button class="btn small" data-action="pick-factor" data-k="${k}">Usar</button></div>
            </div>`).join('')}
          ${q.results && q.results.length === 0 ? '<div class="empty">Sin resultados. Prueba otra palabra en inglés o quita el filtro de región.</div>' : ''}
        </div>
      </div></div>`;
  }

  function settingsModal() {
    return `<div class="modal-backdrop" data-action="close-modal-bg">
      <div class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-head"><h2 id="settings-title">Ajustes</h2><button class="icon-btn" data-action="close-modal" aria-label="Cerrar">×</button></div>
        <div class="modal-body">
          <div class="grid">
            ${field('Versión de datos Climatiq', 'settings.dataVersion', { help: '"^39" = compatible con la versión 39. Revisa la última en la documentación de Climatiq.' })}
            ${field('PCG (GWP) del IPCC', 'settings.calculationMethod', { type: 'select', options: [['ar6', 'AR6 (recomendado)'], ['ar5', 'AR5'], ['ar4', 'AR4']] })}
          </div>
          <div style="margin-top:14px">${field('API key de Climatiq (solo pruebas)', 'settings.apiKey', { type: 'password', help: 'En producción configura CLIMATIQ_API_KEY en Vercel y deja esto vacío. Si la ingresas aquí se guarda en este navegador.' })}</div>
          <div style="margin-top:14px">${field('Código de acceso', 'settings.accessCode', { type: 'password', help: 'Solo si definiste APP_ACCESS_CODE en Vercel.' })}</div>
          <div style="margin-top:14px">${field('Tema', 'settings.theme', { type: 'select', options: [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']] })}</div>
          <div class="row" style="margin-top:18px"><button class="btn ghost" data-action="test-api">Probar conexión</button><span class="spacer"></span><button class="btn" data-action="close-modal">Listo</button></div>
          <div class="api-status" style="margin-top:12px"></div>
        </div>
      </div></div>`;
  }

  async function runSearch() {
    const q = ui.search;
    q.loading = true; q.error = null; renderModal();
    try {
      const params = { query: q.query, region: q.region ? q.region.trim().toUpperCase() : '', year: q.year, unit_type: q.unit_type, source: q.source, source_lca_activity: q.source_lca_activity };
      const data = await API.search(params);
      q.results = data.results || [];
      q.total = data.total_results ?? q.results.length;
      q.possible = data.possible_filters || q.possible;
      if (data.notices && data.notices.some((n) => n.code === 'premium_data_available') && !q.results.length) q.error = 'No hay datos públicos, pero existen factores premium que coinciden.';
    } catch (e) { q.error = e.message; q.results = null; }
    q.loading = false; renderModal();
    const input = document.querySelector('[data-bind="ui.search.query"]');
    if (input) input.focus();
  }

  // ============================================================
  // Exportaciones
  // ============================================================
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const slug = () => (project.org.name || 'inventario').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function exportCsv() {
    const t = compute();
    const head = ['Instalacion', 'Alcance', 'Categoria GHG', 'Categoria ISO', 'Fuente', 'Metodo', 'Factor', 'Fuente factor', 'Anio factor', 'Region factor', 'Dato actividad', 'Unidad', '% consolidado', 'tCO2e', 'tCO2e ubicacion', 'tCO2e mercado', 'Incertidumbre %', 'Tipo de dato', 'Evidencia'];
    const rows = t.rows.map((r) => {
      const s = r.s; const f = s.factor || {};
      let qty = '', unit = '';
      if (s.method === 'manual') { qty = s.manual.quantity; unit = s.manual.unit; }
      else if (s.method === 'electricity') { qty = s.elec.energy; unit = s.elec.unit; }
      else { const sp = (S.UNIT_TYPES[f.unit_type] || []); qty = sp.map((p) => s.params[p.key]).join(' x '); unit = sp.map((p) => s.params[p.key + '_unit'] || p.key).join(' x '); }
      return [facilityName(s.facilityId), r.scope, (r.scope === 3 ? '3.' + r.cat.cat + ' ' : '') + r.cat.name + (r.derived ? ' (aguas arriba electricidad)' : ''), r.cat.iso, s.description,
        s.method, s.method === 'manual' ? s.manual.factor + ' kgCO2e/' + s.manual.unit : (f.name || 'Red electrica'), s.method === 'manual' ? s.manual.ref : (f.source || 'Climatiq Energy API'),
        f.year || s.elec.year || '', f.region || '', qty, unit, (r.share * 100).toFixed(1), (r.kg / 1000).toFixed(4),
        r.loc != null ? (r.loc / 1000).toFixed(4) : '', r.mkt != null ? (r.mkt / 1000).toFixed(4) : '', r.u.toFixed(1), S.DATA_METHODS[s.quality.method] || '', s.evidence];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(`huella-${slug()}-${project.period.year}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  }

  // ============================================================
  // Ejemplo
  // ============================================================
  function exampleProject() {
    const p = newProject();
    const y = p.period.year;
    p.org = { name: 'Café Andino SpA (ejemplo)', taxId: '76.000.000-0', sector: 'Tostaduría y distribución de café', country: 'Chile', address: 'Av. Ejemplo 123, Santiago', responsible: 'Ana Pérez', responsibleRole: 'Jefa de Sostenibilidad', description: 'Empresa ficticia de 45 empleados que importa café verde, lo tuesta y lo distribuye a cafeterías.' };
    p.purpose = { objective: 'Establecer la línea base de emisiones para definir metas de reducción.', users: 'Gerencia, clientes corporativos y programa HuellaChile.', intendedUse: 'program', verification: 'limited', verifier: '', principles: {} };
    const f1 = { id: uid(), name: 'Oficina central', type: 'office', region: 'CL', address: 'Santiago', equity: 100, control: true };
    const f2 = { id: uid(), name: 'Planta de tostado', type: 'plant', region: 'CL', address: 'Quilicura', equity: 100, control: true };
    p.facilities = [f1, f2];
    const C = p.boundaries.categories;
    C.s1_process = { status: 'excluded', criteria: {}, justification: 'El tostado no genera emisiones de proceso; solo combustión (registrada en combustión estacionaria).' };
    C.s1_lulucf = { status: 'excluded', criteria: {}, justification: 'La organización no posee terrenos con cambio de uso de suelo.' };
    C.s2_heat = { status: 'excluded', criteria: {}, justification: 'No se adquiere calor, vapor ni frío de terceros.' };
    const inc = (id, crit) => { C[id] = { status: 'included', criteria: Object.fromEntries(crit.map((c) => [c, true])), justification: '' }; };
    const exc = (id, j) => { C[id] = { status: 'excluded', criteria: {}, justification: j }; };
    inc('s3_1', ['size', 'influence', 'stakeholders']); inc('s3_3', ['size']); inc('s3_4', ['size', 'outsourcing']); inc('s3_5', ['influence']); inc('s3_6', ['influence']); inc('s3_7', ['stakeholders']);
    exc('s3_2', 'Sin adquisiciones relevantes de bienes de capital en el período (<1% estimado).');
    exc('s3_8', 'No hay activos arrendados fuera de Alcance 1 y 2.');
    exc('s3_9', 'La distribución es propia (Alcance 1) o pagada por la empresa (3.4).');
    exc('s3_10', 'El producto vendido es final, no requiere procesamiento.');
    exc('s3_11', 'El café no consume energía directa en su uso; preparación fuera de influencia.');
    exc('s3_12', 'Embalajes de bajo peso; se evaluará el próximo año (<1% estimado).');
    exc('s3_13', 'No aplica.'); exc('s3_14', 'No aplica: sin franquicias.'); exc('s3_15', 'No aplica: sin inversiones significativas.');
    const src = (catId, fac, desc, extra) => Object.assign(newSource(catId, fac.id), { description: desc }, extra);
    p.sources = [
      src('s2_electricity', f1, 'Electricidad oficina', { elec: { energy: 18000, unit: 'kWh', recs: '', direct: '', year: '' }, evidence: 'Boletas eléctricas ene–dic ' + y }),
      src('s2_electricity', f2, 'Electricidad planta', { elec: { energy: 95000, unit: 'kWh', recs: 20000, direct: '', year: '' }, evidence: 'Facturas + certificados I-REC' }),
      src('s1_stationary', f2, 'Gas natural tostadora', { searchHint: 'natural gas', params: { volume: 12000, volume_unit: 'm3', energy: 130000, energy_unit: 'kWh' }, evidence: 'Facturas Metrogas' }),
      src('s1_mobile', f2, 'Diésel camiones de reparto', { searchHint: 'diesel', params: { volume: 8500, volume_unit: 'l' }, evidence: 'Tarjetas de combustible' }),
      src('s1_fugitive', f1, 'Recarga refrigerante aire acondicionado', { searchHint: 'R-410A', params: { weight: 3, weight_unit: 'kg' }, quality: { method: 'calculated', uActivity: 5, uFactor: '' }, evidence: 'Informe de mantención HVAC' }),
      src('s3_1', f2, 'Café verde importado', { searchHint: 'coffee', params: { weight: 60, weight_unit: 't' }, quality: { method: 'calculated', uActivity: 5, uFactor: '' }, evidence: 'Facturas de importación' }),
      src('s3_6', f1, 'Vuelos de negocio', { searchHint: 'flight', params: { passengers: 1, distance: 42000, distance_unit: 'km' }, quality: { method: 'estimated', uActivity: 20, uFactor: '' }, evidence: 'Reporte agencia de viajes' }),
      src('s3_5', f2, 'Residuos a relleno sanitario', { searchHint: 'landfill', params: { weight: 12, weight_unit: 't' }, quality: { method: 'calculated', uActivity: 5, uFactor: '' }, evidence: 'Certificados del gestor' }),
    ];
    return p;
  }

  // ============================================================
  // Eventos
  // ============================================================
  const actions = {
    go(d) { location.hash = '#/' + d.step; ui.navOpen = false; },
    'toggle-nav'() { ui.navOpen = !ui.navOpen; renderNav(); },
    'load-example'() {
      if ((project.org.name || project.sources.length) && !confirm('Esto reemplazará el inventario actual. ¿Continuar?')) return;
      project = exampleProject(); save(); location.hash = '#/fuentes'; render();
      toast('Ejemplo cargado: busca un factor en cada fuente de Climatiq y presiona "Calcular".');
    },
    reset() {
      if (!confirm('¿Borrar el inventario actual y empezar uno nuevo? Descarga antes un respaldo con "Guardar archivo".')) return;
      project = newProject(); save(); render();
    },
    'add-facility'() {
      project.facilities.push({ id: uid(), name: '', type: 'office', region: (project.facilities[0] || {}).region || '', address: '', equity: 100, control: true });
      save(); render();
    },
    'remove-facility'(d) {
      const used = project.sources.filter((s) => s.facilityId === d.id).length;
      if (used && !confirm(`Esta instalación tiene ${used} fuente(s) asociadas, que quedarán sin instalación. ¿Eliminar?`)) return;
      project.facilities = project.facilities.filter((f) => f.id !== d.id);
      save(); render();
    },
    'add-source'() {
      const catId = document.getElementById('new-cat').value;
      const facId = document.getElementById('new-fac').value;
      if (!catId) { toast('Incluye al menos una categoría en el paso 3.', true); return; }
      const s = newSource(catId, facId);
      project.sources.push(s); ui.open[s.id] = true; save(); render();
    },
    'toggle-source'(d) { ui.open[d.id] = !ui.open[d.id]; render(); },
    'remove-source'(d) {
      if (!confirm('¿Eliminar esta fuente?')) return;
      project.sources = project.sources.filter((s) => s.id !== d.id); save(); render();
    },
    'dup-source'(d) {
      const s = project.sources.find((x) => x.id === d.id);
      const c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.description += ' (copia)'; c.result = null; c.error = null;
      project.sources.splice(project.sources.indexOf(s) + 1, 0, c); ui.open[c.id] = true; save(); render();
    },
    'set-method'(d) {
      const s = project.sources.find((x) => x.id === d.id);
      s.method = d.method; s.result = null; s.error = null; save(); render();
    },
    'open-search'(d) {
      const s = project.sources.find((x) => x.id === d.id);
      const fac = project.facilities.find((f) => f.id === s.facilityId);
      ui.search = { sourceId: s.id, query: s.searchHint || (S.byId[s.catId] || {}).queries?.[0] || '', region: (fac && fac.region) || '', year: '', unit_type: '', source: '', source_lca_activity: '', results: null, possible: null };
      renderModal(); runSearch();
    },
    'search-chip'(d) { ui.search.query = d.q; ui.search.unit_type = ''; ui.search.source = ''; runSearch(); },
    'pick-factor'(d) {
      const r = ui.search.results[Number(d.k)];
      const s = project.sources.find((x) => x.id === ui.search.sourceId);
      const keep = s.params || {};
      s.factor = {
        id: r.id, activity_id: r.activity_id, name: r.name, source: r.source, source_dataset: r.source_dataset, year: r.year,
        region: r.region, region_name: r.region_name, unit_type: r.unit_type, unit: r.unit, factor: r.factor, uncertainty: r.uncertainty,
        supported_calculation_methods: r.supported_calculation_methods, source_lca_activity: r.source_lca_activity, source_link: r.source_link,
      };
      const params = {};
      (S.UNIT_TYPES[r.unit_type] || []).forEach((p) => {
        params[p.key] = keep[p.key] ?? (p.key === 'passengers' ? 1 : '');
        if (p.units) params[p.key + '_unit'] = p.units.includes(keep[p.key + '_unit']) ? keep[p.key + '_unit'] : p.units[0];
      });
      s.params = params; s.searchHint = ui.search.query; s.result = null; s.error = null;
      ui.search = null; save(); render();
      toast('Factor asignado. Completa la cantidad y calcula.');
    },
    'close-modal'() { ui.search = null; ui.settingsOpen = false; API.configure(settings); renderModal(); render(); },
    'close-modal-bg'(d, el, ev) { if (ev.target === el) actions['close-modal'](); },
    'open-settings'() { ui.settingsOpen = true; renderModal(); },
    async 'test-api'() {
      const show = (html) => document.querySelectorAll('.api-status').forEach((b) => { b.innerHTML = html; });
      show('<span class="muted"><span class="spinner"></span> Probando…</span>');
      API.configure(settings);
      try {
        const r = await API.search({ query: 'electricity', results_per_page: 1 });
        show(`<div class="callout"><p>✓ Conexión correcta. ${fmtN(r.total_results, 0)} factores encontrados para "electricity" con la versión ${esc(settings.dataVersion)}.</p></div>`);
      } catch (e) {
        show(`<div class="callout danger"><p>${esc(e.message)}</p></div>`);
      }
    },
    calculate() { calculateAll(); },
    print() { window.print(); },
    'export-word'() { if (!ui.wordBusy) exportWord(); },
    'export-csv'() { exportCsv(); },
    'export-json'() { download(`huella-${slug()}-${project.period.year}.json`, JSON.stringify(project, null, 2), 'application/json'); },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
    const fn = actions[el.dataset.action];
    if (fn) fn(el.dataset, el, ev);
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-action-submit]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.actionSubmit === 'run-search') runSearch();
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
    if (path.startsWith('p.')) {
      // Cambiar datos de una fuente invalida su resultado
      const m = path.match(/^p\.sources\.(\d+)\.(params|elec|manual|facilityId)/);
      if (m) { const s = project.sources[Number(m[1])]; s.result = null; s.error = null; }
      // Al cambiar el tipo de dato se propone su incertidumbre por defecto
      const q = path.match(/^p\.sources\.(\d+)\.quality\.method$/);
      if (q) project.sources[Number(q[1])].quality.uActivity = S.ACTIVITY_UNCERTAINTY[el.value] ?? 10;
      save();
    }
    if (ev.type === 'change' && el.hasAttribute('data-rerender')) render();
  }
  document.addEventListener('input', onBind);
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'import-file') return importFile(ev.target);
    if (ev.target.type === 'checkbox' || ev.target.type === 'radio' || ev.target.tagName === 'SELECT') onBind(ev);
    else if (ev.target.hasAttribute && ev.target.hasAttribute('data-rerender')) render();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && (ui.search || ui.settingsOpen)) actions['close-modal'](); });

  function importFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = migrate(JSON.parse(reader.result));
        if (!data) throw new Error('Formato no reconocido');
        project = data; save(); location.hash = '#/organizacion'; render();
        toast('Proyecto cargado.');
      } catch (e) { toast('No se pudo leer el archivo: ' + e.message, true); }
      input.value = '';
    };
    reader.readAsText(file);
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  render();
})();
