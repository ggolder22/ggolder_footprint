// Motor de cálculo, validación y completitud. Sin dependencias de interfaz.
(function (root) {
  'use strict';
  const S = root.STD;
  const Un = root.Units;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const isBlank = (v) => v === '' || v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));

  // ------------------------------------------------------------
  // Factores de biblioteca
  // ------------------------------------------------------------
  function libFactor(lib, id) { return (lib || []).find((f) => f.id === id) || null; }

  // Cálculo local con factor propio: devuelve { kg, qtyConverted } o { error }
  function libraryEmission(s, lib) {
    const f = libFactor(lib, s.libraryFactorId);
    if (!f) return { error: 'Elegí un factor de la biblioteca del cliente.' };
    const chk = Un.checkPair(s.unit, f.activity_unit);
    if (!chk.ok) return { error: chk.msg };
    const q = Un.convert(num(s.quantity), s.unit, f.activity_unit);
    return { kg: q * num(f.value), qtyConverted: q, factor: f };
  }

  // ------------------------------------------------------------
  // Validación de una fuente → { level: 'ok'|'warn'|'error', issues: [{level,msg}] }
  // ------------------------------------------------------------
  function validateSource(s, ctx) {
    const { project, lib } = ctx;
    const issues = [];
    const add = (level, msg) => issues.push({ level, msg });
    const type = project.type;

    if (s.include === 'pending') add('error', 'Falta decidir si la fuente se incluye.');
    if (s.include === 'no') {
      if (!String(s.justification || '').trim()) add('error', 'Justificá por qué se excluye.');
      return finish();
    }
    if (!s.groupId || !project.groups.some((g) => g.id === s.groupId)) add('error', `Asigná ${S.FOOTPRINT_TYPES[type].groupName.toLowerCase()}.`);
    if (type === 'organizacion') {
      const st = project.boundaries.categories[s.catId];
      if (!st) add('error', 'Elegí la categoría de emisión.');
      else if (st.status !== 'included') add('warn', 'La categoría está excluida en los límites de informe: la fuente no suma al total.');
    }

    if (s.method === 'library') {
      const f = libFactor(lib, s.libraryFactorId);
      if (!f) add('error', 'Elegí un factor de la biblioteca del cliente.');
      if (isBlank(s.quantity)) add('error', 'Falta el dato de actividad.');
      else if (num(s.quantity) < 0) add('error', 'El dato de actividad no puede ser negativo.');
      else if (num(s.quantity) === 0) add('warn', 'El dato de actividad es 0.');
      if (f) {
        const chk = Un.checkPair(s.unit, f.activity_unit);
        if (!chk.ok) add('error', chk.msg);
        else if (chk.convert) add('info', `${chk.msg} ${fmt(num(s.quantity))} ${Un.label(s.unit)} = ${fmt(Un.convert(num(s.quantity), s.unit, f.activity_unit))} ${Un.label(f.activity_unit)}.`);
        if (num(f.value) <= 0 && !s.isRemoval) add('warn', `El factor ${f.code} vale ${f.value}: revisalo.`);
        if (!String(f.source || '').trim()) add('warn', `El factor ${f.code} no tiene fuente o referencia documentada.`);
      }
    } else if (s.method === 'climatiq') {
      if (!s.factor) add('error', 'Elegí un factor de Climatiq.');
      else {
        const spec = S.UNIT_TYPES[s.factor.unit_type];
        if (!spec) add('error', `Tipo de unidad ${s.factor.unit_type} no soportado.`);
        else spec.forEach((p) => {
          if (isBlank(s.params[p.key])) add('error', `Falta ${p.label.toLowerCase()}.`);
          else if (num(s.params[p.key]) < 0) add('error', `${p.label} no puede ser negativo.`);
        });
      }
    } else if (s.method === 'electricity') {
      if (isBlank(s.elec.energy) || num(s.elec.energy) <= 0) add('error', 'Falta el consumo eléctrico.');
      if (num(s.elec.recs) > num(s.elec.energy)) add('error', 'Los certificados renovables superan el consumo total.');
      if (num(s.elec.direct) > num(s.elec.energy)) add('error', 'La energía renovable directa supera el consumo total.');
      const g = project.groups.find((x) => x.id === s.groupId);
      if (g && !g.region) add('error', 'La instalación no tiene código de región (p. ej. AR).');
    }

    if (!String(s.evidence || '').trim()) add('warn', 'Sin evidencia documental.');
    if (!String(s.custodian || '').trim()) add('warn', 'Sin responsable del dato.');
    if (type === 'producto' && !String(s.allocation || '').trim()) add('warn', 'Sin criterio de asignación al lote.');
    if (s.result && isStale(s, ctx)) add('warn', 'El factor cambió después del último cálculo: recalculá.');

    // Posible doble conteo: misma instalación/etapa, mismo factor y misma cantidad
    const dup = project.sources.find((o) => o !== s && o.include === 'yes' && o.groupId === s.groupId && o.method === s.method
      && ((s.method === 'library' && o.libraryFactorId && o.libraryFactorId === s.libraryFactorId && num(o.quantity) === num(s.quantity))
        || (s.method === 'climatiq' && o.factor && s.factor && o.factor.id === s.factor.id && JSON.stringify(o.params) === JSON.stringify(s.params))));
    if (dup) add('warn', `Posible doble conteo con "${dup.description}".`);
    return finish();

    function finish() {
      const level = issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warn') ? 'warn' : 'ok';
      return { level, issues };
    }
  }
  const fmt = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 4 });

  function isStale(s, ctx) {
    if (!s.result) return false;
    if (s.method === 'library') {
      const f = libFactor(ctx.lib, s.libraryFactorId);
      return !f || num(f.value) !== num(s.result.factorValue) || f.activity_unit !== s.result.factorUnit;
    }
    return false;
  }

  // ------------------------------------------------------------
  // Participación de consolidación (solo organización)
  // ------------------------------------------------------------
  function groupShare(project, groupId) {
    if (project.type !== 'organizacion') return 1;
    const g = project.groups.find((x) => x.id === groupId);
    if (!g) return 1;
    return project.consolidation === 'equity' ? num(g.equity) / 100 : (g.control ? 1 : 0);
  }

  function uncertaintyOf(s) {
    const uA = num(s.quality.uActivity);
    let uF;
    if (!isBlank(s.quality.uFactor)) uF = num(s.quality.uFactor);
    else if (s.result && !isBlank(s.result.factorUncertainty)) uF = num(s.result.factorUncertainty);
    else if (s.factor && !isBlank(s.factor.uncertainty)) uF = num(s.factor.uncertainty);
    else uF = S.FACTOR_UNCERTAINTY_DEFAULT;
    return Math.sqrt(uA ** 2 + uF ** 2);
  }

  // ------------------------------------------------------------
  // Agregación de resultados
  // ------------------------------------------------------------
  function compute(project, lib) {
    const ctx = { project, lib };
    const type = project.type;
    const useMkt = project.settings.scope2Totals === 'market';
    const catOn = (id) => project.boundaries && project.boundaries.categories[id] && project.boundaries.categories[id].status === 'included';
    const t = {
      type, s1: 0, s2loc: 0, s2mkt: 0, s3: 0, removals: 0, biogenic: 0, total: 0,
      byCat: {}, byIso: {}, byGroup: {}, gases: { co2: 0, ch4: 0, n2o: 0, other: 0 },
      rows: [], pending: [], errors: [], excluded: [], validations: {}, factors: [],
      counts: { total: project.sources.length, included: 0, complete: 0, excluded: 0, pendingDecision: 0, withErrors: 0 },
    };
    const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };

    project.sources.forEach((s) => {
      const v = validateSource(s, ctx);
      t.validations[s.id] = v;
      if (s.include === 'no') { t.counts.excluded++; t.excluded.push(s); return; }
      if (s.include === 'pending') { t.counts.pendingDecision++; t.pending.push(s); return; }
      if (type === 'organizacion' && !catOn(s.catId)) { t.counts.excluded++; t.excluded.push(s); return; }
      t.counts.included++;
      if (v.level === 'error') t.counts.withErrors++;
      if (s.error) t.errors.push(s);
      if (!s.result || v.level === 'error' || isStale(s, ctx)) { t.pending.push(s); return; }
      t.counts.complete++;

      const k = groupShare(project, s.groupId);
      const u = uncertaintyOf(s);
      if (s.isRemoval) { t.removals += Math.abs(s.result.co2e) * k; return; }
      t.biogenic += num(s.biogenic) * k;
      const cat = type === 'organizacion' ? S.byId[s.catId] : null;

      if (s.result.location) {
        const L = s.result.location, M = s.result.market;
        const loc = L.consumption * k, mkt = M.consumption * k;
        const val = useMkt ? mkt : loc;
        t.s2loc += loc; t.s2mkt += mkt;
        add(t.byCat, s.catId, val); add(t.byIso, 2, val); add(t.byGroup, s.groupId, val);
        t.rows.push({ s, cat, scope: 2, kg: val, loc, mkt, u, share: k });
        if (catOn('s3_3')) {
          const up = useMkt ? M : L;
          const v3 = (up.wtt + up.td + up.wtt_td) * k;
          t.s3 += v3; add(t.byCat, 's3_3', v3); add(t.byIso, 4, v3); add(t.byGroup, s.groupId, v3);
          t.rows.push({ s, cat: S.byId.s3_3, scope: 3, kg: v3, u, share: k, derived: true });
        }
        return;
      }
      const val = s.result.co2e * k;
      if (cat) {
        if (cat.scope === 1) t.s1 += val;
        else if (cat.scope === 2) { t.s2loc += val; t.s2mkt += val; }
        else t.s3 += val;
        add(t.byCat, s.catId, val); add(t.byIso, cat.iso, val);
      }
      add(t.byGroup, s.groupId, val);
      if (s.result.gases) ['co2', 'ch4', 'n2o', 'other'].forEach((g) => { if (!isBlank(s.result.gases[g])) t.gases[g] += num(s.result.gases[g]) * k; });
      t.rows.push({ s, cat, scope: cat ? cat.scope : null, kg: val, u, share: k });
    });

    if (type === 'organizacion') {
      t.s2 = useMkt ? t.s2mkt : t.s2loc;
      t.total = t.s1 + t.s2 + t.s3;
    } else {
      t.total = t.rows.reduce((a, r) => a + r.kg, 0);
    }
    const sumSq = t.rows.reduce((a, r) => a + (r.kg * r.u / 100) ** 2, 0);
    t.uncertainty = t.total > 0 ? (Math.sqrt(sumSq) / t.total) * 100 : 0;

    // Completitud: fuentes completas / fuentes que deben calcularse (incluidas + sin decidir)
    const denom = t.counts.included + t.counts.pendingDecision;
    t.completeness = denom > 0 ? t.counts.complete / denom : 0;
    t.isPartial = t.completeness < 1 || denom === 0;

    // Indicadores funcionales
    if (type === 'evento') {
      const att = num(project.event && project.event.attendees);
      t.perAttendee = att > 0 ? t.total / att : null;
    }
    if (type === 'producto') {
      const lot = num(project.product && project.product.lotSize);
      t.perUnit = lot > 0 ? t.total / lot : null;
    }

    // Factores usados (para el informe)
    const seen = new Set();
    project.sources.filter((s) => s.include === 'yes').forEach((s) => {
      if (s.method === 'climatiq' && s.factor && !seen.has('c' + s.factor.id)) { seen.add('c' + s.factor.id); t.factors.push({ kind: 'climatiq', f: s.factor }); }
      if (s.method === 'library') { const f = libFactor(lib, s.libraryFactorId); if (f && !seen.has('l' + f.id)) { seen.add('l' + f.id); t.factors.push({ kind: 'library', f }); } }
      if (s.method === 'electricity' && s.result && s.result.location && !seen.has('e' + s.groupId)) { seen.add('e' + s.groupId); t.factors.push({ kind: 'electricity', s }); }
    });
    return t;
  }

  // ------------------------------------------------------------
  // Escenarios de reducción (evento)
  // adjustments: [{ sourceId, qtyPct, factorId }]
  // ------------------------------------------------------------
  function scenarioResult(project, lib, scenario, base) {
    base = base || compute(project, lib);
    let total = 0;
    const detail = [];
    base.rows.forEach((r) => {
      const adj = (scenario.adjustments || []).find((a) => a.sourceId === r.s.id);
      let kg = r.kg;
      let note = '';
      if (adj) {
        const mult = 1 + num(adj.qtyPct) / 100;
        if (adj.factorId && r.s.method === 'library') {
          const nf = libFactor(lib, adj.factorId);
          const q = nf ? Un.convert(num(r.s.quantity), r.s.unit, nf.activity_unit) : null;
          if (nf && q !== null) { kg = q * mult * num(nf.value) * r.share; note = `factor ${nf.code}`; }
          else note = 'factor alternativo con unidad incompatible: se ignora';
        } else kg = r.kg * mult;
      }
      total += kg;
      detail.push({ s: r.s, base: r.kg, scenario: kg, note });
    });
    return { total, reduction: base.total - total, reductionPct: base.total > 0 ? ((base.total - total) / base.total) * 100 : 0, detail };
  }

  // ------------------------------------------------------------
  // Sensibilidad (producto): variación % del factor de una fuente
  // ------------------------------------------------------------
  function sensitivityResult(project, lib, row, base) {
    base = base || compute(project, lib);
    const r = base.rows.find((x) => x.s.id === row.sourceId);
    const delta = r ? r.kg * num(row.pct) / 100 : 0;
    return { sourceKg: r ? r.kg : 0, delta, total: base.total + delta, deltaPct: base.total > 0 ? (delta / base.total) * 100 : 0, found: !!r };
  }

  root.Calc = { validateSource, compute, libraryEmission, libFactor, isStale, groupShare, scenarioResult, sensitivityResult, uncertaintyOf };
})(typeof window !== 'undefined' ? window : globalThis);
