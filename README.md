# Calculadora de Huella de Carbono (GHG Protocol + ISO 14064-1)

Herramienta web para elaborar inventarios corporativos de gases de efecto invernadero (GEI) paso a paso, con factores de emisión de la API de [Climatiq](https://www.climatiq.io/docs).

## Qué hace

Guía el proceso completo que piden el **GHG Protocol Corporate Standard** (más las guías de Alcance 2 y Alcance 3) y la **ISO 14064-1:2018**:

| Paso | Contenido | Referencia |
|---|---|---|
| 1. Organización y objetivo | Organización que informa, responsable, propósito, usuarios previstos y verificación | ISO 14064-1 §9 · GHG cap. 2 |
| 2. Límites organizacionales | Enfoque de consolidación (control operacional, control financiero o participación accionaria) e instalaciones | ISO 14064-1 §5.1 · GHG cap. 3 |
| 3. Límites de informe | Alcance 1, 2 y 3 (15 categorías) con su equivalencia en las categorías 1 a 6 de ISO, criterios de relevancia y exclusiones justificadas | ISO 14064-1 §5.2 · GHG cap. 4 · Scope 3 Std. |
| 4. Período y año base | Período, año base, política de recálculo y umbral de significancia | ISO 14064-1 §6.4 · GHG cap. 5 |
| 5. Fuentes y datos de actividad | Fuentes por instalación, búsqueda de factores en Climatiq, factores propios y calidad del dato | ISO 14064-1 §6.2 · GHG cap. 6 |
| 6. Cálculo y resultados | Cálculo por lotes; Alcance 2 dual (ubicación y mercado); resultados por alcance, categoría ISO, instalación y gas | Scope 2 Guidance |
| 7. Calidad e incertidumbre | Principios, lista de verificación e incertidumbre combinada (IPCC 2006, enfoque 1) | ISO 14064-1 §8 · GHG cap. 7 |
| 8. Informe | Informe imprimible o en PDF con el contenido de ISO 14064-1 §9.3, más exportación a CSV y JSON | ISO 14064-1 §9 · GHG cap. 9 |

Los datos se guardan automáticamente en el navegador (localStorage). Usa **Guardar archivo** para descargar el proyecto en JSON y **Abrir archivo** para retomarlo en otro equipo o pasárselo a un cliente.

## Estructura

```
index.html          Página principal
styles.css          Estilos (modo claro y oscuro, imprimible)
js/standards.js     Contenido normativo: categorías, mapeo ISO, criterios y unidades
js/climatiq.js      Cliente de la API (siempre pasa por el proxy)
js/app.js           Asistente, cálculo, resultados e informe
api/climatiq.js     Función serverless de Vercel que guarda la API key en secreto
```

No requiere build ni dependencias.

## Endpoints de Climatiq usados

- `GET /data/v1/search`: busca factores de emisión.
- `POST /data/v1/estimate/batch`: calcula hasta 100 fuentes por llamada con el selector `id`.
- `POST /energy/v1.5/electricity/batch`: calcula la electricidad con los métodos de ubicación y de mercado, más las emisiones aguas arriba (WTT y pérdidas de T&D), que se asignan a la categoría 3.3.

## Despliegue en Vercel

1. Crea una cuenta en [climatiq.io](https://www.climatiq.io) y genera una API key.
2. Sube este proyecto a GitHub:
   ```bash
   git init
   git add .
   git commit -m "Calculadora de huella de carbono"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/huella-de-carbono.git
   git push -u origin main
   ```
3. En [vercel.com](https://vercel.com), elige **Add New → Project**, importa el repositorio y deja el framework en **Other**. No hay build.
4. En **Settings → Environment Variables**, agrega:
   - `CLIMATIQ_API_KEY` = tu key (obligatoria).
   - `APP_ACCESS_CODE` = una clave cualquiera (opcional, pero recomendada). Así, solo quien tenga el código puede usar tu cuota de Climatiq. Los usuarios lo ingresan en **Ajustes**.
5. Vuelve a desplegar (**Redeploy**) para que tome las variables.

## Desarrollo local

```bash
npm i -g vercel
vercel dev          # sirve la página y la función /api/climatiq en http://localhost:3000
```

Crea un archivo `.env` con `CLIMATIQ_API_KEY=...`, o ingresa la key en **Ajustes** solo para pruebas. Si abres `index.html` directamente (`file://`), la interfaz y los factores propios funcionan, pero la API de Climatiq no.

## Notas metodológicas

- **PCG (GWP):** por defecto IPCC AR6, a 100 años. Se puede cambiar en Ajustes.
- **Versión de datos:** por defecto `^39`. Revisa la versión vigente en la [documentación de Climatiq](https://www.climatiq.io/docs/api-reference/data-versioning) y fíjala para que los resultados se puedan reproducir.
- **Alcance 2:** se reportan siempre ambos métodos. En el paso 3 eliges cuál suma al total.
- **Remociones y CO₂ biogénico:** se reportan por separado y no se restan del total, como exige ISO 14064-1.
- **Mapeo de Alcance 3 a ISO:** es orientativo. Las categorías 3.14 y 3.15 se asignan a la categoría 6 de ISO.
- **Incertidumbre:** los valores por defecto son orientativos (medido ±2%, calculado ±5%, estimado ±20%, basado en gasto ±30%, factor ±10%). Ajústalos con información de cada fuente.
- **Desglose por gas:** Climatiq lo entrega en masa (kg de cada gas) solo cuando el factor de origen lo publica.
- La herramienta **no sustituye la verificación** de un tercero independiente según ISO 14064-3.
