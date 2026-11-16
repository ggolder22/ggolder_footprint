// Informes: un modelo de bloques por tipo de huella → vista HTML y documento Word (.docx).
window.Report = (function () {
  'use strict';
  const S = window.STD;
  const Un = window.Units;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmtT = (kg, d = 2) => (num(kg) / 1000).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtK = (kg, d = 2) => num(kg).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtN = (n, d = 2) => num(n).toLocaleString('es-AR', { maximumFractionDigits: d });
  const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
  const d = (v) => (String(v ?? '').trim() ? String(v) : '—');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function builder() {
    const B = [];
    return {
      B,
      h1: (text) => B.push({ t: 'h1', text }),
      h2: (text) => B.push({ t: 'h2', text }),
      h3: (text) => B.push({ t: 'h3', text }),
      eyebrow: (text) => B.push({ t: 'eyebrow', text }),
      para: (...runs) => B.push({ t: 'p', runs: runs.map((r) => (typeof r === 'string' ? { text: r } : r)) }),
      note: (text) => B.push({ t: 'p', muted: true, runs: [{ text }] }),
      alert: (text) => B.push({ t: 'alert', text }),
      kv: (rows) => B.push({ t: 'kv', rows }),
      table: (head, rows, opt = {}) => B.push({ t: 'table', head, rows, ...opt }),
      sign: (lines) => B.push({ t: 'sign', lines }),
    };
  }

  const groupName = (p, id) => { const g = p.groups.find((x) => x.id === id); return g ? g.name : '—'; };
  const verifTxt = (v) => ({ none: 'Sin verificación', internal: 'Revisión interna', limited: 'Verificación externa con aseguramiento limitado', reasonable: 'Verificación externa con aseguramiento razonable' }[v] || '—');

  function header(b, ctx, title) {
    const { project: p, client: c, t, draft, version } = ctx;
    b.eyebrow(S.FOOTPRINT_TYPES[p.type].name + (draft ? ' · BORRADOR' : version ? ` · Versión ${version}` : ''));
    b.h1(title);
    b.note(`Preparado tomando como referencia ${S.FOOTPRINT_TYPES[p.type].norms}. ${draft ? 'Generado' : 'Emitido'} el ${new Date().toLocaleDateString('es-AR')}.`);
    if (draft) b.alert(`BORRADOR — Completitud ${fmtN(t.completeness * 100, 0)}%. Este documento no es apto para comunicación externa: faltan fuentes por calcular o hay errores de validación.`);
    b.h2('Organización que informa');
    b.kv([['Razón social', d(c.name)], ['CUIT', d(S.formatCuit(c.cuit))], ['Sector', d(c.sector)],
      ['Domicilio', d([c.address, c.province].filter(Boolean).join(', '))], ['Responsable', d([p.purpose.responsible, p.purpose.responsibleRole].filter(Boolean).join(', '))]]);
  }

  function sourcesTable(b, ctx, opt = {}) {
    const { project: p, t } = ctx;
    b.table(['Fuente', S.FOOTPRINT_TYPES[p.type].groupName, ...(opt.cat ? ['Categoría'] : []), 'kgCO₂e', '±%'],
      t.rows.map((r) => [r.s.description + (r.derived ? ' (aguas arriba)' : ''), groupName(p, r.s.groupId),
        ...(opt.cat ? [r.cat ? (r.scope === 3 ? '3.' + r.cat.cat : 'A' + r.scope) + ' ' + r.cat.name : '—'] : []), fmtK(r.kg), fmtN(r.u, 0)]),
      { num: opt.cat ? [3, 4] : [2, 3], widths: opt.cat ? [3, 2, 3, 1.4, 0.6] : [4, 3, 2, 1], empty: 'Sin fuentes calculadas.' });
  }

  function factorsTable(b, ctx) {
    const { project: p, t, settings } = ctx;
    b.table(['Factor', 'Valor', 'Fuente', 'Año / región'], t.factors.map((x) => {
      if (x.kind === 'library') return [`${x.f.code} — ${x.f.name}`, `${fmtN(x.f.value, 6)} kgCO₂e/${Un.label(x.f.activity_unit)}`, d(x.f.source), d(x.f.year)];
      if (x.kind === 'climatiq') return [`${x.f.name}\n${x.f.activity_id}`, x.f.factor != null ? `${fmtN(x.f.factor, 6)} ${x.f.unit}` : 'según Climatiq', `${x.f.source}${x.f.source_dataset ? ' · ' + x.f.source_dataset : ''}`, `${d(x.f.year)} · ${d(x.f.region_name || x.f.region)}`];
      const g = p.groups.find((gg) => gg.id === x.s.groupId);
      const trail = (x.s.result.location.trail || []).map((tr) => tr.source || tr.name || '').filter(Boolean).join(', ') || 'factores de red';
      return [`Electricidad de red — ${groupName(p, x.s.groupId)}`, 'ubicación y mercado', `Climatiq Energy API v1.5 (${trail})`, `${d(x.s.elec.year || 'último disp.')} · ${d(g && g.region)}`];
    }), { widths: [3.6, 2.2, 2.8, 1.4], empty: 'Sin factores.' });
    b.note(`Factores de Climatiq: versión de datos ${settings.dataVersion}, PCG IPCC ${settings.calculationMethod.toUpperCase()}. Factores propios: biblioteca del cliente con la fuente indicada.`);
  }

  function exclusions(b, ctx) {
    const ex = ctx.project.sources.filter((s) => s.include === 'no');
    if (ex.length) b.table(['Fuente excluida', 'Justificación'], ex.map((s) => [s.description, d(s.justification)]), { widths: [4, 6] });
    else b.para('No se excluyeron fuentes identificadas.');
  }

  function quality(b, ctx, principles) {
    const { project: p, t } = ctx;
    b.para('Completitud: ', { text: `${fmtN(t.completeness * 100, 0)}%`, b: true }, ` (${t.counts.complete} de ${t.counts.included + t.counts.pendingDecision} fuentes). Incertidumbre combinada estimada: `,
      { text: `±${fmtN(t.uncertainty, 1)}%`, b: true }, ' (propagación de errores, IPCC 2006, enfoque 1).');
    b.para(`Principios confirmados: ${principles.filter((x) => p.purpose.principles[x.id]).map((x) => x.name).join(', ') || 'ninguno'}.`);
  }

  function closing(b, ctx) {
    const { project: p } = ctx;
    b.h2('Declaración');
    b.para(`Este estudio fue preparado tomando como referencia ${S.FOOTPRINT_TYPES[p.type].norms}. ` +
      (p.purpose.verification === 'limited' || p.purpose.verification === 'reasonable'
        ? `Será sometido a ${verifTxt(p.purpose.verification).toLowerCase()} conforme a ISO 14064-3.`
        : 'No fue verificado por un tercero independiente.'));
    b.sign([d(p.purpose.responsible), d(p.purpose.responsibleRole)]);
  }

  // ------------------------------------------------------------
  function orgModel(ctx) {
    const { project: p, client: c, t } = ctx;
    const b = builder();
    const s2name = p.settings.scope2Totals === 'market' ? 'mercado' : 'ubicación';
    const statusTxt = { included: 'Incluida', excluded: 'Excluida', pending: 'Por evaluar' };
    const catLabel = (cat) => `${cat.scope === 3 ? '3.' + cat.cat : 'A' + cat.scope} ${cat.name}`;
    header(b, ctx, `${d(c.name)} — Inventario de GEI ${p.period.year}`);

    b.h2('Resumen');
    b.table(['Indicador', 'Valor'], [
      [`Emisiones totales (Alcance 2 por ${s2name})${t.isPartial ? ' — PARCIAL' : ''}`, fmtT(t.total) + ' tCO₂e'],
      ['Alcance 1', fmtT(t.s1) + ' tCO₂e'], ['Alcance 2 — ubicación / mercado', `${fmtT(t.s2loc)} / ${fmtT(t.s2mkt)} tCO₂e`], ['Alcance 3', fmtT(t.s3) + ' tCO₂e'],
      ['Completitud', fmtN(t.completeness * 100, 0) + '%'], ['Incertidumbre combinada', '±' + fmtN(t.uncertainty, 1) + '%'],
    ], { num: [1] });

    b.h2('Propósito y usuarios');
    b.kv([['Objetivo', d(p.purpose.objective)], ['Usuarios previstos', d(p.purpose.users)], ['Verificación', verifTxt(p.purpose.verification) + (p.purpose.verifier ? ' — ' + p.purpose.verifier : '')],
      ['Período', `${p.period.start} a ${p.period.end}`]]);

    b.h2('Límites organizacionales');
    b.para('Enfoque de consolidación: ', { text: S.CONSOLIDATION[p.consolidation].name, b: true }, '. ' + S.CONSOLIDATION[p.consolidation].help);
    b.table(['Instalación', 'Región', 'Domicilio', '% consolidado'], p.groups.map((g) => [d(g.name), d(g.region), d(g.address), fmtN(window.Calc.groupShare(p, g.id) * 100, 1) + '%']), { num: [3], widths: [3, 1, 4, 2] });

    b.h2('Límites de informe');
    b.para(`Umbral de materialidad para exclusiones: ${fmtN(p.boundaries.materiality, 1)}% de las emisiones totales.`);
    b.table(['Alcance / categoría', 'ISO', 'Estado', 'Criterios / justificación'], S.CATEGORIES.map((cat) => {
      const st = p.boundaries.categories[cat.id];
      const crit = S.RELEVANCE_CRITERIA.filter((r) => st.criteria && st.criteria[r.id]).map((r) => r.label).join(', ');
      return [catLabel(cat), String(cat.iso), statusTxt[st.status], [crit, st.justification].filter(Boolean).join(' — ')];
    }), { widths: [3.2, 0.7, 1.2, 4.9] });

    b.h2('Año base');
    b.kv([['Año base', String(p.baseYear.year)], ['Justificación', d(p.baseYear.justification)], ['Política de recálculo', `${d(p.baseYear.policy)} Umbral: ${fmtN(p.baseYear.threshold, 1)}%.`]]);

    b.h2('Resultados');
    b.table(['Alcance', 'tCO₂e', '%'], [
      ['Alcance 1 — emisiones directas', fmtT(t.s1), fmtN(pct(t.s1, t.total), 1)],
      ['Alcance 2 — basado en ubicación', fmtT(t.s2loc), p.settings.scope2Totals === 'location' ? fmtN(pct(t.s2, t.total), 1) : '—'],
      ['Alcance 2 — basado en mercado', fmtT(t.s2mkt), p.settings.scope2Totals === 'market' ? fmtN(pct(t.s2, t.total), 1) : '—'],
      ['Alcance 3 — otras indirectas', fmtT(t.s3), fmtN(pct(t.s3, t.total), 1)],
      [`Total (Alcance 2 por ${s2name})${t.isPartial ? ' — PARCIAL' : ''}`, fmtT(t.total), '100'],
      ['Remociones (no netas)', fmtT(t.removals), ''], ['CO₂ biogénico (fuera de alcances)', fmtT(t.biogenic), ''],
    ], { num: [1, 2], total: 4, sub: [5, 6], widths: [6, 2, 2] });
    b.h3('Por categoría ISO 14064-1');
    b.table(['Categoría', 'tCO₂e'], Object.entries(S.ISO_CATEGORIES).map(([k, l]) => [l, fmtT(t.byIso[k] || 0)]), { num: [1], widths: [8, 2] });
    b.h3('Por instalación');
    b.table(['Instalación', 'tCO₂e'], p.groups.map((g) => [g.name, fmtT(t.byGroup[g.id] || 0)]), { num: [1], widths: [8, 2] });
    b.h3('Detalle por fuente');
    sourcesTable(b, ctx, { cat: true });

    b.h2('Metodología y factores de emisión');
    b.para('Emisiones = dato de actividad × factor de emisión. Cuando la unidad del dato difiere de la del factor dentro de la misma magnitud, se convierte antes de multiplicar. El Alcance 2 se reporta por los métodos de ubicación y de mercado (GHG Protocol Scope 2 Guidance).');
    factorsTable(b, ctx);
    b.h2('Exclusiones');
    const exCats = S.CATEGORIES.filter((cat) => p.boundaries.categories[cat.id].status === 'excluded');
    if (exCats.length) b.table(['Categoría excluida', 'Justificación'], exCats.map((cat) => [catLabel(cat), d(p.boundaries.categories[cat.id].justification)]), { widths: [4, 6] });
    exclusions(b, ctx);
    b.h2('Calidad e incertidumbre');
    quality(b, ctx, S.PRINCIPLES);
    closing(b, ctx);
    return b.B;
  }

  function eventModel(ctx) {
    const { project: p, t, lib } = ctx;
    const e = p.event;
    const b = builder();
    header(b, ctx, `Huella de carbono del evento: ${d(e.name)}`);
    b.h2('Resumen');
    b.table(['Indicador', 'Valor'], [
      [`Huella del evento${t.isPartial ? ' — PARCIAL' : ''}`, `${fmtK(t.total)} kgCO₂e (${fmtT(t.total, 3)} tCO₂e)`],
      ['Asistentes', fmtN(e.attendees, 0)], ['Indicador por asistente', t.perAttendee != null ? fmtK(t.perAttendee, 3) + ' kgCO₂e/asistente' : '—'],
      ['Completitud', fmtN(t.completeness * 100, 0) + '%'], ['Incertidumbre combinada', '±' + fmtN(t.uncertainty, 1) + '%'],
    ], { num: [1] });
    b.h2('Objetivo y límites del estudio');
    b.kv([['Objetivo', d(p.purpose.objective)], ['Usuarios previstos', d(p.purpose.users)], ['Lugar', d([e.venue, e.city].filter(Boolean).join(', '))],
      ['Fechas', `${d(e.startDate)} a ${d(e.endDate)}`], ['Límite temporal', d(e.temporalLimit)], ['Límite espacial', d(e.spatialLimit)], ['Exclusiones del límite', d(e.exclusions)]]);
    b.h2('Resultados por componente');
    b.table(['Componente', 'kgCO₂e', 'kgCO₂e/asistente', '%'], [...p.groups.map((g) => {
      const v = t.byGroup[g.id] || 0;
      return [g.name, fmtK(v), num(e.attendees) > 0 ? fmtK(v / num(e.attendees), 3) : '—', fmtN(pct(v, t.total), 1)];
    }), [`Total${t.isPartial ? ' — PARCIAL' : ''}`, fmtK(t.total), t.perAttendee != null ? fmtK(t.perAttendee, 3) : '—', '100']], { num: [1, 2, 3], total: p.groups.length, widths: [4, 2, 2, 2] });
    b.h3('Detalle por fuente');
    sourcesTable(b, ctx);
    if ((p.scenarios || []).length) {
      b.h2('Escenarios de reducción');
      b.table(['Escenario', 'Descripción', 'kgCO₂e', 'Reducción'], p.scenarios.map((sc) => {
        const r = window.Calc.scenarioResult(p, lib, sc, t);
        return [d(sc.name), d(sc.description), fmtK(r.total), `${fmtK(r.reduction)} kg (${fmtN(r.reductionPct, 1)}%)`];
      }), { num: [2, 3], widths: [2.5, 4.5, 1.5, 2] });
    }
    b.h2('Metodología y factores de emisión');
    b.para('Emisiones = dato de actividad × factor de emisión. Los traslados en auto se expresan en vehículo·km y los de ómnibus en pasajero·km, con factores en la misma unidad. La huella del evento no se suma a la huella organizacional ni a la de producto.');
    factorsTable(b, ctx);
    b.h2('Exclusiones');
    exclusions(b, ctx);
    if ((p.iso20121 || []).length) {
      b.h2('Gestión sostenible del evento (ISO 20121)');
      b.note('Evaluación cualitativa: no genera tCO₂e ni sustituye la cuantificación de GEI.');
      b.table(['Aspecto', 'Estado', 'Responsable', 'Mejora propuesta'], p.iso20121.map((a) => [`${a.aspect}\n${a.question}`, d(a.status), d(a.responsible), d(a.improvement)]), { widths: [4, 1.5, 1.5, 3] });
    }
    b.h2('Calidad e incertidumbre');
    quality(b, ctx, S.PRINCIPLES);
    closing(b, ctx);
    return b.B;
  }

  function productModel(ctx) {
    const { project: p, t, lib } = ctx;
    const pr = p.product;
    const b = builder();
    header(b, ctx, `Huella de carbono de producto: ${d(pr.name)}`);
    b.h2('Resumen');
    b.table(['Indicador', 'Valor'], [
      [`Huella por unidad declarada${t.isPartial ? ' — PARCIAL' : ''}`, t.perUnit != null ? `${fmtK(t.perUnit, 4)} kgCO₂e / ${d(pr.declaredUnit)}` : '—'],
      [`Huella del lote estudiado (${fmtN(pr.lotSize, 0)} unidades)`, `${fmtK(t.total)} kgCO₂e`],
      ['Límite del sistema', d(S.PRODUCT_BOUNDARIES[pr.boundary])], ['Completitud', fmtN(t.completeness * 100, 0) + '%'], ['Incertidumbre combinada', '±' + fmtN(t.uncertainty, 1) + '%'],
    ], { num: [1] });
    b.h2('Objetivo y alcance del estudio');
    b.kv([['Objetivo', d(p.purpose.objective)], ['Usuarios previstos', d(p.purpose.users)], ['Unidad declarada / funcional', d(pr.declaredUnit)],
      ['Tamaño del lote', fmtN(pr.lotSize, 0) + ' unidades'], ['Límite del sistema', d(S.PRODUCT_BOUNDARIES[pr.boundary])], ['Regla de asignación', d(pr.allocationRule)], ['Exclusiones del límite', d(pr.exclusions)]]);
    b.h2('Resultados por etapa');
    b.table(['Etapa', 'kgCO₂e lote', 'kgCO₂e/unidad', '%'], [...p.groups.map((g) => {
      const v = t.byGroup[g.id] || 0;
      return [g.name, fmtK(v), num(pr.lotSize) > 0 ? fmtK(v / num(pr.lotSize), 4) : '—', fmtN(pct(v, t.total), 1)];
    }), [`Total${t.isPartial ? ' — PARCIAL' : ''}`, fmtK(t.total), t.perUnit != null ? fmtK(t.perUnit, 4) : '—', '100']], { num: [1, 2, 3], total: p.groups.length, widths: [4, 2, 2, 2] });
    b.h3('Detalle por fuente');
    b.table(['Fuente', 'Etapa', 'Asignación', 'kgCO₂e'], t.rows.map((r) => [r.s.description, groupName(p, r.s.groupId), d(r.s.allocation), fmtK(r.kg)]), { num: [3], widths: [3, 2.5, 3, 1.5] });
    if ((p.sensitivity || []).length) {
      b.h2('Análisis de sensibilidad');
      b.table(['Variable', 'Variación', 'Δ kgCO₂e', 'Nuevo total', 'Δ %'], p.sensitivity.map((row) => {
        const src = p.sources.find((s) => s.id === row.sourceId);
        const r = window.Calc.sensitivityResult(p, lib, row, t);
        return [`Factor de "${src ? src.description : '—'}"`, `${num(row.pct) > 0 ? '+' : ''}${fmtN(row.pct, 1)}%`, fmtK(r.delta), fmtK(r.total), fmtN(r.deltaPct, 2) + '%'];
      }), { num: [1, 2, 3, 4], widths: [3.5, 1.3, 1.6, 1.8, 1.3] });
      b.note('Cada variación afecta solo a la fuente indicada; el resto de los factores no se modifica.');
    }
    b.h2('Metodología y factores de emisión');
    b.para('Emisiones = dato de actividad asignado al lote × factor de emisión. Los factores de materias primas incluyen su producción aguas arriba; los factores de recortes representan solo su gestión, sin créditos por reciclaje. Los recortes ya contenidos en la materia prima no se vuelven a sumar.');
    factorsTable(b, ctx);
    b.h2('Exclusiones');
    exclusions(b, ctx);
    b.h2('Calidad e incertidumbre');
    quality(b, ctx, S.PRODUCT_PRINCIPLES);
    closing(b, ctx);
    return b.B;
  }

  function model(ctx) {
    if (ctx.project.type === 'evento') return eventModel(ctx);
    if (ctx.project.type === 'producto') return productModel(ctx);
    return orgModel(ctx);
  }

  // ------------------------------------------------------------
  function toHtml(blocks) {
    const runs = (rs) => rs.map((r) => (r.b ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join('');
    const cell = (c) => { const [a, ...rest] = String(c).split('\n'); return esc(a) + (rest.length ? `<br><small class="muted">${esc(rest.join(' '))}</small>` : ''); };
    return blocks.map((b) => {
      switch (b.t) {
        case 'eyebrow': return `<div class="report-eyebrow">${esc(b.text)}</div>`;
        case 'h1': return `<h1>${esc(b.text)}</h1>`;
        case 'h2': return `<h2>${esc(b.text)}</h2>`;
        case 'h3': return `<h3>${esc(b.text)}</h3>`;
        case 'p': return `<p${b.muted ? ' class="muted small"' : ''}>${runs(b.runs)}</p>`;
        case 'alert': return `<div class="callout warn"><p><strong>${esc(b.text)}</strong></p></div>`;
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

  // ------------------------------------------------------------
  const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js';
  function loadDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    if (loadDocx.p) return loadDocx.p;
    loadDocx.p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = DOCX_URL;
      s.onload = () => (window.docx ? resolve(window.docx) : reject(new Error('La librería de Word no se inicializó.')));
      s.onerror = () => { loadDocx.p = null; reject(new Error('No se pudo descargar la librería de Word. Revisá tu conexión.')); };
      document.head.appendChild(s);
    });
    return loadDocx.p;
  }

  async function toDocxBlob(blocks, meta) {
    const D = await loadDocx();
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, Footer, Header, PageNumber } = D;
    const GREEN = '1F7A5A', MUTED = '5D6B64', LINE = 'D5DBD3';
    const PAGE_W = 11906, MARGIN = 1134, CW = PAGE_W - 2 * MARGIN;
    const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const paras = (text, o = {}) => String(text ?? '').split('\n').map((line, i) => new Paragraph({
      alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: line, bold: !!o.bold, size: i > 0 ? 15 : 18, color: o.color || (i > 0 ? MUTED : undefined), font: i > 0 ? 'Consolas' : undefined })],
    }));
    const widths = (b) => { const w = b.widths || b.head.map(() => 1); const s = w.reduce((a, x) => a + x, 0); return w.map((x) => Math.round((x / s) * CW)); };
    const table = (b) => {
      const cols = widths(b);
      const right = (i) => (b.num || []).includes(i);
      const head = new TableRow({ tableHeader: true, children: b.head.map((h, i) => new TableCell({ width: { size: cols[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E3F1EA' }, margins: { left: 90, right: 90 }, children: paras(h, { bold: true, right: right(i), color: '165C43' }) })) });
      const rows = b.rows.length ? b.rows.map((r, ri) => new TableRow({ children: r.map((c, i) => new TableCell({
        width: { size: cols[i], type: WidthType.DXA }, margins: { left: 90, right: 90 },
        shading: ri === b.total ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F0F2EE' } : undefined,
        children: paras(c, { right: right(i), bold: ri === b.total, color: (b.sub || []).includes(ri) ? MUTED : undefined }) })) }))
        : [new TableRow({ children: [new TableCell({ columnSpan: b.head.length, width: { size: CW, type: WidthType.DXA }, children: paras(b.empty || 'Sin datos.', { color: MUTED }) })] })];
      return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: cols, rows: [head, ...rows], borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border } });
    };
    const kv = (b) => {
      const c0 = Math.round(CW * 0.3), cols = [c0, CW - c0];
      return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: cols, borders: { top: none, bottom: none, left: none, right: none, insideVertical: none, insideHorizontal: border },
        rows: b.rows.map(([k, v]) => new TableRow({ children: [new TableCell({ width: { size: cols[0], type: WidthType.DXA }, children: paras(k, { color: MUTED }) }), new TableCell({ width: { size: cols[1], type: WidthType.DXA }, children: paras(v) })] })) });
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
        case 'alert': children.push(new Paragraph({ spacing: { before: 120, after: 160 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF4DC' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: '9A6400', space: 6 } }, children: [new TextRun({ text: b.text, bold: true, color: '7A4F00' })] })); break;
        case 'kv': children.push(kv(b), gap()); break;
        case 'table': children.push(table(b), gap()); break;
        case 'sign': children.push(new Paragraph({ spacing: { before: 720 }, children: [new TextRun('______________________________')] }), new Paragraph({ children: [new TextRun(b.lines[0])] }), new Paragraph({ children: [new TextRun({ text: b.lines[1], color: MUTED })] })); break;
        default: break;
      }
    });
    const doc = new Document({
      creator: 'Huella de Carbono', title: meta.title, description: meta.description,
      styles: { default: {
        document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { line: 276 } } },
        title: { run: { font: 'Calibri', size: 40, bold: true, color: '1B2420' }, paragraph: { spacing: { after: 120 } } },
        heading1: { run: { font: 'Calibri', size: 28, bold: true, color: GREEN }, paragraph: { spacing: { before: 360, after: 140 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 4 } } } },
        heading2: { run: { font: 'Calibri', size: 23, bold: true, color: '1B2420' }, paragraph: { spacing: { before: 240, after: 100 } } },
      } },
      sections: [{
        properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: meta.header, size: 16, color: meta.draft ? '9A6400' : MUTED, bold: !!meta.draft })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ size: 16, color: MUTED, children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES] })] })] }) },
        children,
      }],
    });
    return Packer.toBlob(doc);
  }

  return { model, toHtml, toDocxBlob, loadDocx };
})();
