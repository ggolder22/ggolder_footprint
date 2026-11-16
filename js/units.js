// Catálogo de unidades, conversión y control de coherencia.
// Cada unidad pertenece a una "dimensión"; solo se convierte dentro de la misma dimensión.
(function (root) {
  'use strict';

  // id: { label, dim, k }  →  valor_en_base = valor × k
  const U = {
    // Energía (base kWh)
    Wh: { label: 'Wh', dim: 'energia', k: 0.001 },
    kWh: { label: 'kWh', dim: 'energia', k: 1 },
    MWh: { label: 'MWh', dim: 'energia', k: 1000 },
    GWh: { label: 'GWh', dim: 'energia', k: 1e6 },
    MJ: { label: 'MJ', dim: 'energia', k: 1 / 3.6 },
    GJ: { label: 'GJ', dim: 'energia', k: 1000 / 3.6 },
    TJ: { label: 'TJ', dim: 'energia', k: 1e6 / 3.6 },
    kcal: { label: 'kcal', dim: 'energia', k: 0.00116222 },
    therm: { label: 'therm', dim: 'energia', k: 29.3071 },
    MMBTU: { label: 'MMBTU', dim: 'energia', k: 293.071 },
    // Volumen (base L)
    ml: { label: 'mL', dim: 'volumen', k: 0.001 },
    l: { label: 'L', dim: 'volumen', k: 1 },
    m3: { label: 'm³', dim: 'volumen', k: 1000 },
    gallon_us: { label: 'galón (EE. UU.)', dim: 'volumen', k: 3.78541 },
    bbl: { label: 'barril', dim: 'volumen', k: 158.987 },
    cubic_foot: { label: 'pie³', dim: 'volumen', k: 28.3168 },
    // Masa (base kg)
    g: { label: 'g', dim: 'masa', k: 0.001 },
    kg: { label: 'kg', dim: 'masa', k: 1 },
    t: { label: 't', dim: 'masa', k: 1000 },
    lb: { label: 'lb', dim: 'masa', k: 0.453592 },
    ton: { label: 'short ton (EE. UU.)', dim: 'masa', k: 907.185 },
    // Distancia (base km)
    m: { label: 'm', dim: 'distancia', k: 0.001 },
    km: { label: 'km', dim: 'distancia', k: 1 },
    mi: { label: 'milla', dim: 'distancia', k: 1.609344 },
    nmi: { label: 'milla náutica', dim: 'distancia', k: 1.852 },
    ft: { label: 'pie', dim: 'distancia', k: 0.0003048 },
    // Transporte (no se convierten entre sí)
    tkm: { label: 't·km', dim: 'carga', k: 1 },
    kgkm: { label: 'kg·km', dim: 'carga', k: 0.001 },
    vkm: { label: 'vehículo·km', dim: 'vehiculo_km', k: 1 },
    pkm: { label: 'pasajero·km', dim: 'pasajero_km', k: 1 },
    teukm: { label: 'TEU·km', dim: 'teu_km', k: 1 },
    // Superficie (base m²)
    m2: { label: 'm²', dim: 'superficie', k: 1 },
    ha: { label: 'ha', dim: 'superficie', k: 10000 },
    km2: { label: 'km²', dim: 'superficie', k: 1e6 },
    // Tiempo (base hora)
    min: { label: 'min', dim: 'tiempo', k: 1 / 60 },
    hour: { label: 'hora', dim: 'tiempo', k: 1 },
    day: { label: 'día', dim: 'tiempo', k: 24 },
    // Conteos (cada uno es su propia dimensión)
    unidad: { label: 'unidad', dim: 'n_unidad', k: 1 },
    comida: { label: 'comida', dim: 'n_comida', k: 1 },
    noche: { label: 'noche de hotel', dim: 'n_noche', k: 1 },
    persona: { label: 'persona', dim: 'n_persona', k: 1 },
    asistente: { label: 'asistente', dim: 'n_asistente', k: 1 },
    envio: { label: 'envío', dim: 'n_envio', k: 1 },
    // Dinero (cada moneda es su propia dimensión; no se aplican tipos de cambio)
    ars: { label: 'ARS', dim: 'dinero_ars', k: 1 },
    usd: { label: 'USD', dim: 'dinero_usd', k: 1 },
    eur: { label: 'EUR', dim: 'dinero_eur', k: 1 },
  };

  const DIM_LABEL = {
    energia: 'energía', volumen: 'volumen', masa: 'masa', distancia: 'distancia', carga: 'carga transportada (t·km)',
    vehiculo_km: 'vehículo·km', pasajero_km: 'pasajero·km', teu_km: 'TEU·km', superficie: 'superficie', tiempo: 'tiempo',
  };
  const dimLabel = (d) => DIM_LABEL[d] || (d.startsWith('dinero_') ? 'dinero (' + d.slice(7).toUpperCase() + ')' : d.startsWith('n_') ? 'cantidad de ' + d.slice(2) : d);

  const GROUPS = [
    ['Energía', ['kWh', 'MWh', 'GJ', 'MJ', 'TJ', 'Wh', 'GWh', 'kcal', 'therm', 'MMBTU']],
    ['Volumen', ['l', 'm3', 'ml', 'gallon_us', 'bbl', 'cubic_foot']],
    ['Masa', ['kg', 't', 'g', 'lb', 'ton']],
    ['Distancia', ['km', 'm', 'mi', 'nmi', 'ft']],
    ['Transporte', ['tkm', 'kgkm', 'vkm', 'pkm', 'teukm']],
    ['Superficie', ['m2', 'ha', 'km2']],
    ['Tiempo', ['hour', 'day', 'min']],
    ['Conteo', ['unidad', 'comida', 'noche', 'persona', 'asistente', 'envio']],
    ['Dinero', ['ars', 'usd', 'eur']],
  ];

  // Alias para interpretar texto libre (p. ej. pegado desde Excel)
  const ALIAS = {
    'kwh': 'kWh', 'mwh': 'MWh', 'gwh': 'GWh', 'wh': 'Wh', 'mj': 'MJ', 'gj': 'GJ', 'tj': 'TJ', 'kcal': 'kcal', 'therm': 'therm', 'mmbtu': 'MMBTU',
    'l': 'l', 'lt': 'l', 'lts': 'l', 'litro': 'l', 'litros': 'l', 'ml': 'ml', 'm3': 'm3', 'm³': 'm3', 'metro cubico': 'm3', 'metros cubicos': 'm3',
    'gal': 'gallon_us', 'galon': 'gallon_us', 'gallon': 'gallon_us', 'bbl': 'bbl', 'barril': 'bbl',
    'g': 'g', 'gr': 'g', 'kg': 'kg', 'kgs': 'kg', 'kilo': 'kg', 'kilos': 'kg', 'kg fugados': 'kg', 'kg recargados': 'kg',
    't': 't', 'tn': 't', 'ton metrica': 't', 'tonelada': 't', 'toneladas': 't', 'lb': 'lb',
    'm': 'm', 'km': 'km', 'mi': 'mi', 'milla': 'mi', 'millas': 'mi',
    't·km': 'tkm', 'tkm': 'tkm', 't.km': 'tkm', 't-km': 'tkm', 't*km': 'tkm', 'tn·km': 'tkm', 'tonkm': 'tkm', 'kg·km': 'kgkm',
    'vehículo·km': 'vkm', 'vehiculo·km': 'vkm', 'vehículo-km': 'vkm', 'vehiculo-km': 'vkm', 'veh·km': 'vkm', 'vkm': 'vkm', 'vehiculo km': 'vkm', 'vehículo km': 'vkm',
    'pasajero·km': 'pkm', 'pasajero-km': 'pkm', 'pax·km': 'pkm', 'pkm': 'pkm', 'pasajero km': 'pkm', 'p·km': 'pkm',
    'teu·km': 'teukm',
    'm2': 'm2', 'm²': 'm2', 'ha': 'ha', 'km2': 'km2', 'km²': 'km2',
    'h': 'hour', 'hora': 'hour', 'horas': 'hour', 'dia': 'day', 'día': 'day', 'dias': 'day', 'días': 'day', 'min': 'min',
    'unidad': 'unidad', 'unidades': 'unidad', 'u': 'unidad', 'un': 'unidad', 'caja': 'unidad', 'cajas': 'unidad',
    'comida': 'comida', 'comidas': 'comida', 'cubierto': 'comida', 'cubiertos': 'comida',
    'noche': 'noche', 'noches': 'noche', 'persona': 'persona', 'personas': 'persona', 'asistente': 'asistente', 'asistentes': 'asistente',
    'envio': 'envio', 'envío': 'envio', 'envios': 'envio', 'envíos': 'envio',
    'ars': 'ars', '$': 'ars', 'pesos': 'ars', 'usd': 'usd', 'us$': 'usd', 'u$s': 'usd', 'eur': 'eur', '€': 'eur',
  };

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[x×]\s*km/g, '·km').replace(/\s*·\s*/g, '·');

  function parseUnit(text) {
    if (!text) return null;
    if (U[text]) return text;
    const n = norm(text);
    if (ALIAS[n]) return ALIAS[n];
    const noAccent = n.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (ALIAS[noAccent]) return ALIAS[noAccent];
    return null;
  }

  // "kgCO₂e/m³" → { unit: 'm3', mult: 1 } ; "tCO2e/t" → { unit: 't', mult: 1000 }
  function parseFactorUnit(text) {
    const s = String(text || '').trim();
    const i = s.indexOf('/');
    if (i < 0) return { unit: parseUnit(s), mult: 1 };
    const num = s.slice(0, i).toLowerCase().replace(/\s/g, '');
    const den = s.slice(i + 1);
    let mult = 1;
    if (/^tco/.test(num)) mult = 1000;
    else if (/^gco/.test(num)) mult = 0.001;
    return { unit: parseUnit(den), mult };
  }

  const label = (id) => (U[id] ? U[id].label : id || '—');
  const dim = (id) => (U[id] ? U[id].dim : null);

  function convert(value, from, to) {
    if (!U[from] || !U[to] || U[from].dim !== U[to].dim) return null;
    return (Number(value) * U[from].k) / U[to].k;
  }

  // Coherencia entre la unidad del dato y la del factor (kgCO2e por factorUnit)
  function checkPair(activityUnit, factorUnit) {
    if (!activityUnit) return { ok: false, level: 'error', msg: 'Elegí la unidad del dato de actividad.' };
    if (!U[activityUnit]) return { ok: false, level: 'error', msg: `Unidad desconocida: ${activityUnit}.` };
    if (!U[factorUnit]) return { ok: false, level: 'error', msg: `El factor tiene una unidad desconocida (${factorUnit}).` };
    if (U[activityUnit].dim !== U[factorUnit].dim) {
      return { ok: false, level: 'error', msg: `Unidades incoherentes: el dato está en ${label(activityUnit)} (${dimLabel(U[activityUnit].dim)}) y el factor es kgCO₂e/${label(factorUnit)} (${dimLabel(U[factorUnit].dim)}).` };
    }
    if (activityUnit !== factorUnit) {
      return { ok: true, level: 'info', convert: true, msg: `Se convierte ${label(activityUnit)} → ${label(factorUnit)}.` };
    }
    return { ok: true, level: 'ok' };
  }

  function sameDimUnits(id) {
    if (!U[id]) return Object.keys(U);
    return Object.keys(U).filter((k) => U[k].dim === U[id].dim);
  }

  root.Units = { U, GROUPS, parseUnit, parseFactorUnit, label, dim, dimLabel, convert, checkPair, sameDimUnits };
})(typeof window !== 'undefined' ? window : globalThis);
