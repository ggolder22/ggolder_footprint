// Contenido normativo: GHG Protocol (Corporate Standard, Scope 2 Guidance, Scope 3 Standard)
// e ISO 14064-1:2018. El mapeo Alcance 3 -> categorías ISO es orientativo.
(function (root) { root.STD = (function () {
  const ISO_CATEGORIES = {
    1: 'Cat. 1 · Emisiones y remociones directas',
    2: 'Cat. 2 · Indirectas por energía importada',
    3: 'Cat. 3 · Indirectas por transporte',
    4: 'Cat. 4 · Indirectas por productos que usa la organización',
    5: 'Cat. 5 · Indirectas asociadas al uso de productos de la organización',
    6: 'Cat. 6 · Indirectas de otras fuentes',
  };

  // Cada categoría: alcance GHG, categoría ISO, sugerencias de búsqueda en Climatiq (en inglés).
  const CATEGORIES = [
    // ---------- Alcance 1 ----------
    { id: 's1_stationary', scope: 1, iso: 1, name: 'Combustión estacionaria',
      desc: 'Calderas, hornos, generadores y equipos fijos que queman combustible en instalaciones propias o controladas.',
      queries: ['natural gas', 'diesel', 'LPG', 'fuel oil', 'coal', 'wood pellets'],
      data: 'Facturas de combustible, lecturas de medidor (m³, L, kWh, t).' },
    { id: 's1_mobile', scope: 1, iso: 1, name: 'Combustión móvil',
      desc: 'Vehículos, maquinaria y flota propios o controlados.',
      queries: ['diesel', 'petrol', 'passenger vehicle', 'light duty truck', 'heavy goods vehicle'],
      data: 'Litros de combustible (preferente) o km recorridos por tipo de vehículo.' },
    { id: 's1_process', scope: 1, iso: 1, name: 'Emisiones de proceso',
      desc: 'Reacciones químicas o físicas: calcinación (cemento, cal), producción de metales, química.',
      queries: ['clinker', 'lime production', 'cement'],
      data: 'Producción (t) y balances de masa; a menudo requiere factor propio.' },
    { id: 's1_fugitive', scope: 1, iso: 1, name: 'Emisiones fugitivas',
      desc: 'Fugas de refrigerantes (HFC), SF₆ en equipos eléctricos, extintores, CH₄ de tratamiento propio de aguas.',
      queries: ['HFC-134a', 'R-410A', 'R-404A', 'refrigerant', 'sulfur hexafluoride'],
      data: 'kg de refrigerante recargado (método de balance de masa) o inventario de equipos.' },
    { id: 's1_lulucf', scope: 1, iso: 1, name: 'Uso de suelo y remociones',
      desc: 'Cambio de uso de suelo, biomasa y remociones (sumideros). ISO 14064-1 exige reportar remociones por separado.',
      queries: ['land use change', 'forest'],
      data: 'Superficie (ha), inventarios forestales. Normalmente factor propio.' },
    // ---------- Alcance 2 ----------
    { id: 's2_electricity', scope: 2, iso: 2, name: 'Electricidad adquirida',
      desc: 'Electricidad comprada y consumida. El GHG Protocol exige reporte dual: método de ubicación y método de mercado.',
      queries: ['electricity grid'], electricity: true,
      data: 'kWh de facturas eléctricas por instalación; certificados de energía renovable (I-REC/REC/GO) y contratos PPA.' },
    { id: 's2_heat', scope: 2, iso: 2, name: 'Calor, vapor y frío adquiridos',
      desc: 'Calefacción distrital, vapor o agua fría comprados a terceros.',
      queries: ['district heating', 'steam', 'district cooling'],
      data: 'kWh / GJ facturados por el proveedor.' },
    // ---------- Alcance 3 (upstream) ----------
    { id: 's3_1', scope: 3, cat: 1, iso: 4, name: 'Bienes y servicios adquiridos',
      desc: 'Emisiones de cuna a puerta de los bienes y servicios comprados.',
      queries: ['paper', 'steel', 'plastics', 'office supplies', 'professional services', 'food'],
      data: 'Cantidades físicas por proveedor (kg, unidades) o gasto (método basado en gasto).' },
    { id: 's3_2', scope: 3, cat: 2, iso: 4, name: 'Bienes de capital',
      desc: 'Activos fijos adquiridos en el período (equipos, maquinaria, edificios, vehículos).',
      queries: ['computers', 'machinery', 'motor vehicles', 'construction'],
      data: 'Gasto en activos fijos o inventario físico del período.' },
    { id: 's3_3', scope: 3, cat: 3, iso: 4, name: 'Actividades de combustible y energía',
      desc: 'Extracción y transporte de combustibles (WTT) y pérdidas de transmisión y distribución (T&D). Se calcula automáticamente desde las fuentes de electricidad.',
      queries: ['well to tank', 'transmission and distribution losses'],
      data: 'Los mismos datos de Alcance 1 y 2.' },
    { id: 's3_4', scope: 3, cat: 4, iso: 3, name: 'Transporte y distribución upstream',
      desc: 'Transporte de compras pagado por la empresa y logística entre instalaciones propias por terceros.',
      queries: ['freight truck', 'sea freight', 'air freight', 'rail freight'],
      data: 't·km por modo de transporte o gasto en fletes.' },
    { id: 's3_5', scope: 3, cat: 5, iso: 4, name: 'Residuos generados en operaciones',
      desc: 'Tratamiento por terceros de residuos sólidos y aguas residuales.',
      queries: ['waste landfill', 'recycling', 'composting', 'wastewater', 'incineration'],
      data: 'Toneladas por tipo de residuo y tratamiento (certificados del gestor).' },
    { id: 's3_6', scope: 3, cat: 6, iso: 3, name: 'Viajes de negocios',
      desc: 'Transporte de empleados por trabajo en vehículos no propios y estadías en hoteles.',
      queries: ['flight', 'hotel stay', 'taxi', 'rail', 'bus'],
      data: 'km por modo (pasajero·km), noches de hotel; informe de la agencia de viajes.' },
    { id: 's3_7', scope: 3, cat: 7, iso: 3, name: 'Desplazamiento de empleados',
      desc: 'Traslado casa–trabajo de los empleados (y opcionalmente teletrabajo).',
      queries: ['passenger car', 'bus', 'metro', 'motorbike', 'homeworking'],
      data: 'Encuesta de movilidad: modo, distancia, días trabajados.' },
    { id: 's3_8', scope: 3, cat: 8, iso: 4, name: 'Activos arrendados (upstream)',
      desc: 'Operación de activos que la organización arrienda y no están en Alcance 1 y 2.',
      queries: ['electricity', 'natural gas', 'office building'],
      data: 'Consumo energético del activo arrendado o m² ocupados.' },
    // ---------- Alcance 3 (downstream) ----------
    { id: 's3_9', scope: 3, cat: 9, iso: 3, name: 'Transporte y distribución downstream',
      desc: 'Transporte de productos vendidos no pagado por la empresa, hasta el cliente final.',
      queries: ['freight truck', 'sea freight', 'delivery van'],
      data: 't·km por modo de transporte.' },
    { id: 's3_10', scope: 3, cat: 10, iso: 5, name: 'Procesamiento de productos vendidos',
      desc: 'Procesamiento por terceros de productos intermedios vendidos.',
      queries: ['manufacturing', 'processing'],
      data: 'Toneladas de producto intermedio y energía de procesamiento.' },
    { id: 's3_11', scope: 3, cat: 11, iso: 5, name: 'Uso de productos vendidos',
      desc: 'Emisiones durante la vida útil de los productos vendidos (energía, combustibles, gases).',
      queries: ['electricity', 'fuel'],
      data: 'Unidades vendidas × consumo durante la vida útil.' },
    { id: 's3_12', scope: 3, cat: 12, iso: 5, name: 'Fin de vida de productos vendidos',
      desc: 'Tratamiento de residuos de los productos vendidos y sus embalajes.',
      queries: ['waste landfill', 'recycling', 'packaging waste'],
      data: 'Toneladas de producto y embalaje por destino final esperado.' },
    { id: 's3_13', scope: 3, cat: 13, iso: 5, name: 'Activos arrendados (downstream)',
      desc: 'Operación de activos de la organización arrendados a terceros.',
      queries: ['electricity', 'natural gas'],
      data: 'Consumo energético reportado por los arrendatarios o m².' },
    { id: 's3_14', scope: 3, cat: 14, iso: 6, name: 'Franquicias',
      desc: 'Operación de franquicias no incluidas en Alcance 1 y 2.',
      queries: ['electricity', 'natural gas', 'restaurant'],
      data: 'Consumo energético por franquicia.' },
    { id: 's3_15', scope: 3, cat: 15, iso: 6, name: 'Inversiones',
      desc: 'Emisiones de inversiones (acciones, deuda, proyectos). Clave para el sector financiero.',
      queries: ['financial services'],
      data: 'Participación × emisiones de la participada (metodología PCAF).' },
  ];

  const byId = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  // Criterios de relevancia del GHG Protocol Scope 3 Standard (tabla 6.1) / ISO 14064-1 Anexo H.
  const RELEVANCE_CRITERIA = [
    { id: 'size', label: 'Magnitud', help: 'Contribuye significativamente al total de emisiones esperado.' },
    { id: 'influence', label: 'Influencia', help: 'La organización puede reducir estas emisiones.' },
    { id: 'risk', label: 'Riesgo', help: 'Expone a riesgos regulatorios, de cadena de suministro, reputacionales o financieros.' },
    { id: 'stakeholders', label: 'Partes interesadas', help: 'Clientes, inversionistas o la comunidad lo consideran crítico.' },
    { id: 'outsourcing', label: 'Tercerización', help: 'Actividades tercerizadas que antes eran propias o que en el sector suelen ser propias.' },
    { id: 'sector', label: 'Guía sectorial', help: 'Una guía de su sector la identifica como relevante.' },
  ];

  const CONSOLIDATION = {
    operational: { name: 'Control operacional', help: 'Se reporta el 100% de las emisiones de las operaciones donde la organización tiene autoridad para introducir e implementar políticas operativas. Es el enfoque más usado.' },
    financial: { name: 'Control financiero', help: 'Se reporta el 100% de las emisiones de las operaciones que la organización controla financieramente (dirige políticas financieras y operativas para obtener beneficios económicos).' },
    equity: { name: 'Participación accionaria', help: 'Se reporta la fracción de emisiones según el porcentaje de participación económica en cada operación.' },
  };

  const PRINCIPLES = [
    { id: 'relevance', name: 'Pertinencia', help: 'El inventario refleja las emisiones de la organización y sirve a las decisiones de los usuarios.' },
    { id: 'completeness', name: 'Integridad (completitud)', help: 'Se incluyen todas las fuentes dentro de los límites; las exclusiones se justifican.' },
    { id: 'consistency', name: 'Coherencia', help: 'Metodologías consistentes que permiten comparar en el tiempo; los cambios se documentan.' },
    { id: 'transparency', name: 'Transparencia', help: 'Supuestos, métodos y fuentes de datos se documentan para permitir la verificación.' },
    { id: 'accuracy', name: 'Exactitud', help: 'Se reducen sesgos e incertidumbres tanto como sea práctico.' },
  ];

  const GASES = [
    { id: 'co2', name: 'CO₂' }, { id: 'ch4', name: 'CH₄' }, { id: 'n2o', name: 'N₂O' },
    { id: 'hfcs', name: 'HFCs' }, { id: 'pfcs', name: 'PFCs' }, { id: 'sf6', name: 'SF₆' }, { id: 'nf3', name: 'NF₃' },
  ];

  // Parámetros de Climatiq por unit_type (docs: api-reference/models/parameters)
  const DIST = ['km', 'm', 'mi', 'nmi', 'ft'];
  const WEIGHT = ['kg', 't', 'g', 'lb', 'ton'];
  const TIME = ['hour', 'day', 'year', 'min', 's'];
  const UNIT_TYPES = {
    Energy: [{ key: 'energy', label: 'Energía', units: ['kWh', 'MWh', 'GWh', 'Wh', 'MJ', 'GJ', 'TJ', 'therm', 'MMBTU'] }],
    Weight: [{ key: 'weight', label: 'Peso', units: WEIGHT }],
    Volume: [{ key: 'volume', label: 'Volumen', units: ['l', 'm3', 'ml', 'gallon_us', 'bbl', 'cubic_foot'] }],
    Distance: [{ key: 'distance', label: 'Distancia', units: DIST }],
    Money: [{ key: 'money', label: 'Gasto', units: ['usd', 'eur', 'ars', 'brl', 'gbp'] }],
    Number: [{ key: 'number', label: 'Cantidad', units: null }],
    Area: [{ key: 'area', label: 'Superficie', units: ['m2', 'ha', 'km2', 'ft2'] }],
    Time: [{ key: 'time', label: 'Tiempo', units: TIME }],
    Data: [{ key: 'data', label: 'Datos', units: ['GB', 'MB', 'TB'] }],
    Power: [{ key: 'power', label: 'Potencia', units: ['kW', 'W', 'MW'] }],
    WeightOverDistance: [
      { key: 'weight', label: 'Peso transportado', units: WEIGHT },
      { key: 'distance', label: 'Distancia', units: DIST }],
    PassengerOverDistance: [
      { key: 'passengers', label: 'Pasajeros', units: null, integer: true },
      { key: 'distance', label: 'Distancia', units: DIST }],
    ContainerOverDistance: [
      { key: 'twenty_foot_equivalent', label: 'TEU', units: null },
      { key: 'distance', label: 'Distancia', units: DIST }],
    WeightOverTime: [
      { key: 'weight', label: 'Peso', units: WEIGHT },
      { key: 'time', label: 'Tiempo', units: TIME }],
    DistanceOverTime: [
      { key: 'distance', label: 'Distancia', units: DIST },
      { key: 'time', label: 'Tiempo', units: TIME }],
    AreaOverTime: [
      { key: 'area', label: 'Superficie', units: ['m2', 'ha', 'km2', 'ft2'] },
      { key: 'time', label: 'Tiempo', units: TIME }],
    DataOverTime: [
      { key: 'data', label: 'Datos', units: ['GB', 'MB', 'TB'] },
      { key: 'time', label: 'Tiempo', units: TIME }],
    NumberOverTime: [
      { key: 'number', label: 'Cantidad', units: null },
      { key: 'time', label: 'Tiempo', units: TIME }],
  };

  // Incertidumbre por defecto del dato de actividad (orientativa, editable por fuente)
  const ACTIVITY_UNCERTAINTY = { measured: 2, calculated: 5, estimated: 20, spend: 30 };
  const FACTOR_UNCERTAINTY_DEFAULT = 10;

  const DATA_METHODS = {
    measured: 'Medido (medidor, factura)',
    calculated: 'Calculado (balance, registros)',
    estimated: 'Estimado (supuestos, extrapolación)',
    spend: 'Basado en gasto',
  };

  // ---------------- Tipos de huella ----------------
  const FOOTPRINT_TYPES = {
    organizacion: {
      name: 'Huella organizacional', short: 'Organización',
      norms: 'GHG Protocol Corporate Standard · ISO 14064-1:2018',
      desc: 'Inventario anual de la organización por Alcances 1, 2 y 3 (categorías 1 a 6 de ISO), con límites organizacionales y operacionales.',
      groupName: 'Instalación', groupPlural: 'Instalaciones',
    },
    evento: {
      name: 'Huella de evento', short: 'Evento',
      norms: 'GHG Protocol (cuantificación) · ISO 20121:2024 (gestión sostenible)',
      desc: 'Emisiones de un evento entre el montaje y el desmontaje, por componente, con indicador por asistente y escenarios de reducción.',
      groupName: 'Componente', groupPlural: 'Componentes',
      defaultGroups: ['Montaje y operación', 'Visitantes', 'Catering', 'Residuos', 'Desmontaje'],
    },
    producto: {
      name: 'Huella de producto', short: 'Producto',
      norms: 'ISO 14067:2018 · GHG Protocol Product Life Cycle Standard · ISO 14040/14044',
      desc: 'Huella de carbono de un producto por unidad declarada o funcional, por etapa del ciclo de vida, con asignación y análisis de sensibilidad.',
      groupName: 'Etapa', groupPlural: 'Etapas del ciclo de vida',
      defaultGroups: ['Actividades previas (materias primas y transporte)', 'Etapa 1', 'Etapa 2', 'Etapa 3'],
    },
  };

  const PRODUCT_BOUNDARIES = {
    'cuna-puerta': 'De la cuna a la puerta (hasta que el producto sale de la planta)',
    'cuna-tumba': 'De la cuna a la tumba (incluye distribución, uso y fin de vida)',
    'puerta-puerta': 'De puerta a puerta (solo procesos propios)',
  };

  const PRODUCT_PRINCIPLES = [
    { id: 'lifecycle', name: 'Perspectiva de ciclo de vida', help: 'Se consideran las etapas relevantes dentro del límite del sistema declarado.' },
    { id: 'relevance', name: 'Pertinencia', help: 'Datos y métodos adecuados a la unidad declarada y al objetivo del estudio.' },
    { id: 'completeness', name: 'Integridad', help: 'Se incluyen todas las emisiones significativas dentro del límite del sistema.' },
    { id: 'consistency', name: 'Coherencia', help: 'Supuestos, métodos y datos se aplican del mismo modo en todo el estudio.' },
    { id: 'nodouble', name: 'Evitar el doble conteo', help: 'Ningún flujo se contabiliza dos veces (p. ej. recortes ya incluidos en la materia prima).' },
    { id: 'accuracy', name: 'Exactitud', help: 'Se reducen sesgos e incertidumbres tanto como sea práctico.' },
    { id: 'transparency', name: 'Transparencia', help: 'Reglas de asignación, supuestos y fuentes documentados.' },
  ];

  const ISO20121_DEFAULT = [
    { aspect: 'Accesibilidad', question: '¿Se garantiza el acceso a personas con discapacidad?', evidence: 'Plano y verificación de acceso', responsible: 'Organizador' },
    { aspect: 'Compras responsables', question: '¿Qué criterios se aplican a los proveedores?', evidence: 'Condiciones de contratación', responsible: 'Compras' },
    { aspect: 'Transporte', question: '¿Hubo incentivos al transporte compartido o público?', evidence: 'Comunicaciones y encuesta', responsible: 'Logística' },
    { aspect: 'Alimentación', question: '¿Se consideraron los menús y el desperdicio?', evidence: 'Pedidos y registro de sobrantes', responsible: 'Catering' },
    { aspect: 'Residuos', question: '¿Existe separación y destinos acreditados?', evidence: 'Actas de retiro y pesajes', responsible: 'Ambiente' },
    { aspect: 'Energía', question: '¿Se gestionó el consumo eléctrico y su origen?', evidence: 'Registros de medidores', responsible: 'Montaje' },
    { aspect: 'Partes interesadas', question: '¿Se escuchó a asistentes y comunidad?', evidence: 'Encuesta y observaciones', responsible: 'Organizador' },
  ];

  const PROVINCES = ['Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];

  // Validación de CUIT (dígito verificador módulo 11)
  function validCuit(cuit) {
    const d = String(cuit || '').replace(/\D/g, '');
    if (d.length !== 11) return false;
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
    let v = 11 - (sum % 11);
    if (v === 11) v = 0;
    if (v === 10) v = 9;
    return v === Number(d[10]);
  }
  const formatCuit = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : c; };

  return {
    ISO_CATEGORIES, CATEGORIES, byId, RELEVANCE_CRITERIA, CONSOLIDATION, PRINCIPLES, GASES,
    UNIT_TYPES, ACTIVITY_UNCERTAINTY, FACTOR_UNCERTAINTY_DEFAULT, DATA_METHODS,
    FOOTPRINT_TYPES, PRODUCT_BOUNDARIES, PRODUCT_PRINCIPLES, ISO20121_DEFAULT, PROVINCES, validCuit, formatCuit,
  };
})(); })(typeof window !== "undefined" ? window : globalThis);
