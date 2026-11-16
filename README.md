# Huella de Carbono: organización, evento y producto

Aplicación web para consultoras y profesionales que calculan huellas de carbono para clientes en Argentina. Cada usuario tiene su cuenta, sus clientes, una **biblioteca de factores de emisión por cliente** y su propia API key de [Climatiq](https://www.climatiq.io/docs). Todo cambio queda registrado para la trazabilidad.

## Tipos de huella

| Tipo | Normas | Resultado | Pasos propios |
|---|---|---|---|
| **Organizacional** | GHG Protocol Corporate Standard · ISO 14064-1:2018 | tCO₂e/año por Alcance 1, 2 y 3 y por categoría ISO 1 a 6 | Consolidación, instalaciones, límites de informe con criterios de relevancia, año base, Alcance 2 dual (ubicación y mercado) |
| **De evento** | GHG Protocol + ISO 20121:2024 | kgCO₂e del evento y kgCO₂e/asistente, por componente | Límites temporal y espacial, componentes, escenarios de reducción, matriz de gestión ISO 20121 |
| **De producto** | ISO 14067:2018 · GHG Product Standard · ISO 14040/44 | kgCO₂e por unidad declarada, por etapa | Unidad declarada, lote, límite del sistema, criterio de asignación, sensibilidad |

Las tres huellas **nunca se suman entre sí**: tienen objetos de estudio y límites distintos.

## Qué hace

- **Factores por fuente:** en cada fuente elegís entre la *biblioteca del cliente* (factores propios) o un factor *oficial de Climatiq*. La biblioteca se puede pegar directamente desde Excel, con las columnas Código · Actividad · Factor · Unidad · Origen.
- **Control de unidades:** convierte dentro de la misma magnitud (L↔m³, kg↔t, kWh↔GJ) y marca como inválidas las combinaciones incoherentes, como vehículo·km contra pasajero·km o t·km contra km.
- **Validación:** datos faltantes o negativos, factores sin fuente, fuentes sin evidencia o sin responsable, posibles dobles conteos y factores que cambiaron después del cálculo.
- **Completitud:** muestra un indicador de completitud y marca el total como **PARCIAL** mientras falten fuentes. El Word sale como **BORRADOR** hasta llegar al 100% sin errores. Recién entonces se puede **emitir**, lo que guarda una versión inmutable.
- **Trazabilidad:** la base de datos registra las altas, los cambios y las bajas de clientes y factores (con los valores anteriores y los nuevos), la creación y el estado de cada huella, los cálculos, las descargas y las emisiones.
- **Informe Word (.docx)** con el contenido que exige cada norma. También exporta a CSV.

## Arquitectura

```
index.html, styles.css    Interfaz (sin build)
js/standards.js           Contenido normativo, tipos de huella y validación de CUIT
js/units.js               Catálogo de unidades, conversión y control de coherencia
js/calc.js                Motor de cálculo, validación, completitud, escenarios y sensibilidad
js/report.js              Modelo de informe por tipo → HTML y Word
js/db.js                  Acceso a Supabase (auth y tablas)
js/climatiq.js            Cliente de la API (pasa siempre por el proxy)
js/app.js                 Interfaz: cuentas, clientes, biblioteca y asistentes
api/climatiq.js           Proxy de Vercel: verifica la sesión y usa la API key del usuario
api/config.js             Entrega al navegador la URL y la anon key de Supabase
supabase/schema.sql       Tablas, seguridad por fila (RLS), auditoría y funciones
```

## Puesta en marcha

### 1. Supabase
1. Creá un proyecto en [supabase.com](https://supabase.com). El plan gratuito alcanza para empezar.
2. En **SQL Editor → New query**, pegá todo el contenido de `supabase/schema.sql` y ejecutalo con **Run**. Se puede volver a ejecutar sin perder datos.
3. En **Authentication → URL Configuration**, cargá en **Site URL** la dirección de tu sitio en Vercel (p. ej. `https://ggolder-footprint.vercel.app`) y agregala también en **Redirect URLs**. Esto hace que funcionen los emails de confirmación y de recuperación de contraseña.
4. Opcional: en **Authentication → Providers → Email** podés desactivar *Confirm email* para pruebas internas.
5. En **Project Settings → Data API**, copiá la *Project URL*. En **Project Settings → API Keys**, copiá la *Publishable key* (`sb_publishable_…`) y la *Secret key* (`sb_secret_…`).

### 2. Vercel
En **Settings → Environment Variables**, cargá:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_…`, **secreta**: solo va en Vercel, nunca en el código) |

Si tu proyecto todavía usa las claves anteriores (anon y service_role), también funcionan con los nombres `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.

Después hacé **Redeploy**. Las variables `CLIMATIQ_API_KEY` y `APP_ACCESS_CODE` de la versión anterior ya no se usan y podés borrarlas.

### 3. Uso
1. Registrate en el sitio.
2. En **Mi cuenta**, cargá tu API key de Climatiq. El navegador no puede volver a leerla; solo la usa el servidor.
3. Creá un cliente, cargá su biblioteca de factores y creá la primera huella.

### Desarrollo local
```bash
vercel dev    # crea un archivo .env con las 3 variables de arriba
```

## Seguridad
- Cada tabla tiene **RLS**: un usuario solo ve y modifica sus propios datos.
- La API key de Climatiq vive en una tabla sin políticas de lectura. Solo se escribe con funciones de la base de datos y solo la lee el proxy con la Secret key.
- Las versiones emitidas y el registro de auditoría no tienen políticas de modificación ni de borrado.

## Notas metodológicas
- **PCG:** IPCC AR6 a 100 años por defecto (configurable en Mi cuenta).
- **Versión de datos de Climatiq:** `^39` por defecto. Mantenela fija durante todo un inventario para que sea reproducible.
- **Electricidad en Argentina:** si Climatiq no tiene factor de red para `AR`, cargá en la biblioteca el factor publicado por la Secretaría de Energía.
- **Incertidumbre:** se combina por propagación de errores (IPCC 2006, enfoque 1). Los valores por defecto son orientativos.
- La herramienta **no reemplaza la verificación** de un tercero independiente (ISO 14064-3).
