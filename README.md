# MCP MercadoLibre — conectá MercadoLibre con Claude AI

[![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-000?style=flat-square)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D20-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Herramientas](https://img.shields.io/badge/herramientas-32-ffe600?style=flat-square)](#todo-lo-que-hace)

**Servidor MCP (Model Context Protocol) de MercadoLibre para Claude.** Conectá tu
cuenta de MercadoLibre a Claude AI y consultá ventas, facturación, rentabilidad real,
stock, publicaciones, preguntas de compradores, reclamos, reputación, Product Ads y
precios de la competencia — todo en lenguaje natural, desde el chat.

Compatible con **Claude Desktop**, **Claude Code** y cualquier cliente MCP. Funciona
como conector local (stdio) o como conector remoto con OAuth 2.1. Pensado para
vendedores de MercadoLibre Argentina, México, Brasil, Chile y Colombia.

> **Palabras clave:** MCP MercadoLibre · MercadoLibre API · Claude AI MercadoLibre ·
> conector MCP · Model Context Protocol · automatizar MercadoLibre · ERP MercadoLibre ·
> analytics MercadoLibre · rentabilidad MercadoLibre · MercadoLibre Claude Desktop

No es un panel más. Es la capacidad de preguntar lo que quieras sobre tu cuenta y que
alguien cruce los datos por vos.

```
"¿Cómo viene el día?"
"¿Cuánta plata tengo por acreditar esta semana?"
"¿Qué se me está por quedar sin stock antes del finde?"
"El set de mates dejó de vender, ¿por qué?"
"¿Estoy caro contra la competencia en los productos que más facturan?"
"Contestá las preguntas pendientes, pero mostrame los textos antes"
"¿Cuánto gano realmente con cada venta después de comisión, envío e impuestos?"
```

---

## Contenido

- [Qué problema resuelve](#qué-problema-resuelve)
- [Cómo funciona](#cómo-funciona)
- [Todo lo que hace: las 32 herramientas](#todo-lo-que-hace)
  - [Cuenta y sincronización](#cuenta-y-sincronización)
  - [Ventas y plata](#ventas-y-plata)
  - [Publicaciones, precios y stock](#publicaciones-precios-y-stock)
  - [Preguntas, mensajes y post-venta](#preguntas-mensajes-y-post-venta)
  - [Inteligencia de mercado y competencia](#inteligencia-de-mercado-y-competencia)
- [Qué NO hace](#qué-no-hace)
- [Cómo instalar el MCP de MercadoLibre en Claude](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Preguntas frecuentes](#preguntas-frecuentes)
- [English summary](#english-summary)

---

## Qué problema resuelve

MercadoLibre te da paneles sueltos: uno de ventas, uno de publicidad, uno de
reputación, uno de stock en Full. Ninguno te contesta las preguntas que importan,
porque esas preguntas cruzan dos o tres paneles a la vez.

*"¿Por qué cayó la facturación este mes?"* no está en ningún reporte. La respuesta
puede ser que perdiste la caja de compra en tres publicaciones de catálogo, que un
competidor bajó el precio, que se te agotó el stock en Full de tu producto estrella,
o que subió el ACOS de la pauta y dejaste de ser rentable. Sacar eso a mano son
cuarenta minutos de pestañas.

Este conector le da a Claude las 32 puertas de entrada a esos datos, y Claude arma
el cruce solo.

---

## Cómo funciona

```
Claude ──MCP──> este servidor ──HTTP+JWT──> CRM Algoritmo Digital ──OAuth──> API MercadoLibre
                      │                            │
              formatea en markdown          sincroniza, cachea,
              y acota los resultados        calcula rentabilidad real
```

El conector **no habla directo con la API de MercadoLibre**, y eso es a propósito:

- **Sin rate limit.** MercadoLibre limita fuerte las llamadas. El CRM ya sincroniza y
  cachea, así que Claude consulta una base local y responde al instante, sin quemar
  cuota ni arriesgar un 429 en medio de una conversación.
- **Datos que la API no te da.** La rentabilidad real necesita el costo de tus
  productos, tu situación fiscal y el histórico de comisiones. Eso vive en el CRM,
  no en MercadoLibre.
- **Multicuenta resuelto.** El OAuth, el refresh de tokens y el manejo de varias
  cuentas ya están hechos del lado del CRM.
- **Histórico.** Cambios de precio, visitas y reputación acumulados en el tiempo,
  algo que la API solo devuelve como foto del momento.

Cada herramienta devuelve **markdown ya formateado** —tablas legibles, pesos
argentinos, fechas locales, listas acotadas— en lugar de JSON crudo. Baja mucho el
consumo de contexto y hace que Claude razone sobre los números, no sobre la forma
del JSON.

---

## Todo lo que hace

Las 32 herramientas MCP que este servidor le expone a Claude, agrupadas por lo que
resuelven. Cada una es una consulta que podés hacer en lenguaje natural.

### Cuenta y sincronización

| Herramienta | Qué devuelve |
|---|---|
| `ml_cuentas` | Cuentas de MercadoLibre vinculadas, con su ID interno, el user_id de ML, si están activas y desde cuándo. Además el estado de la conexión: si la app está configurada y cuántas cuentas responden. Es el primer paso cuando manejás más de una cuenta, porque devuelve el ID que el resto de las herramientas usa para filtrar. |
| `ml_sincronizar` | Fuerza una sincronización de órdenes, publicaciones y preguntas contra la API oficial. El sistema ya sincroniza solo cada media hora; esto es para cuando necesitás el dato de hace dos minutos. |

### Ventas y plata

| Herramienta | Qué devuelve |
|---|---|
| `ml_panel` | La foto del día completa en una sola llamada: ventas de hoy, facturación, preguntas sin responder, reclamos abiertos, publicaciones pausadas, stock crítico y alertas activas. Es por donde conviene empezar cuando la pregunta es general. |
| `ml_metricas` | Los últimos 30 días: cantidad de ventas, facturado bruto, neto después de comisiones, ticket promedio, cuántas publicaciones tuvieron al menos una venta, el desglose por tipo de envío (Full, Flex, colecta, a acordar) y el top 12 de productos por facturación con unidades y si están en Full. |
| `ml_ordenes` | Las últimas 100 ventas, una por fila: fecha y hora, número de orden, comprador, total, comisión que se llevó MercadoLibre, neto, estado de la venta, estado del pago y **la fecha en que ese dinero se acredita**. |
| `ml_caja` | Tres modos. `dia`: cuánto acredita una fecha puntual, cuánto ya está liberado y cuánto falta. `rango`: los últimos 14 días día por día. `proyeccion`: todo lo que todavía no se acreditó, con la fecha de cada acreditación futura. Es la herramienta para "¿cuándo cobro?" y "¿me alcanza para pagarle al proveedor el jueves?". |
| `ml_facturacion` | Facturación y comisiones agregadas por el período que pidas, hasta 365 días. Pensada para conciliar contra AFIP o armar un cierre de mes. |
| `ml_rentabilidad` | **La más importante y la que ningún panel de ML te da.** Margen real después de comisión, costo de envío, costo del producto e impuestos. Modo `periodo` para un rango puntual (o por días), modo `mensual` para la serie mes a mes con margen en pesos y en porcentaje. Avisa si todavía faltan sincronizar costos, para que no leas un número incompleto como si fuera definitivo. |
| `ml_ventas_geo` | Ventas y monto por provincia. Sirve para decidir dónde conviene un depósito, cómo negociar envíos o dónde pautar. |
| `ml_embudo` | Por publicación: visitas, preguntas que generó y ventas que cerró, con la tasa de conversión. Muestra en qué escalón se cae cada producto. |

### Publicaciones, precios y stock

| Herramienta | Qué devuelve |
|---|---|
| `ml_publicaciones` | El catálogo con precio, stock, unidades vendidas, estado y link. Acepta una búsqueda por título o por código MLA. |
| `ml_actualizar_publicacion` | ✍️ **Escribe en MercadoLibre.** Cambia precio, stock, título o estado (activar / pausar / cerrar) de una publicación. El cambio es inmediato y visible para los compradores. |
| `ml_stock` | Modo `bajo`: publicaciones por debajo del umbral que le pases. Modo `full`: panorama del stock en Fulfillment con días de cobertura estimados y riesgo de quiebre, que es lo que te avisa **antes** de quedarte sin stock, no después. |
| `ml_salud_publicaciones` | El puntaje de calidad que MercadoLibre le pone a cada publicación y, sobre todo, las tareas concretas para subirlo: faltan fotos, falta ficha técnica, falta garantía, la descripción es pobre. La salud impacta directo en el posicionamiento. |
| `ml_rendimiento_publicaciones` | Visitas contra ventas de los últimos 30 días, con la conversión de cada publicación. Detecta el caso más caro de todos: la que recibe tráfico y no vende, donde ya pagaste el costo de atraer al comprador. |
| `ml_visitas` | La serie histórica de visitas por publicación, para ver si el tráfico viene subiendo o cayendo. |
| `ml_costos_publicaciones` | Cuánto se lleva MercadoLibre de cada venta: comisión y costo de envío por publicación, agrupado por categoría. Es el número que hay que tener antes de fijar un precio. |
| `ml_simular_precios` | Aplica tus reglas de precio (porcentaje o monto fijo) sobre todo el catálogo y te muestra el precio nuevo y la diferencia de cada publicación **sin tocar nada**. Para ver el impacto de un aumento antes de aplicarlo. |

### Preguntas, mensajes y post-venta

| Herramienta | Qué devuelve |
|---|---|
| `ml_preguntas` | Las preguntas de los compradores, filtrables por pendientes o respondidas, por publicación, por mes o por texto. Devuelve el ID que necesitás para contestar. Por defecto trae las pendientes, que es lo que quema. |
| `ml_responder_pregunta` | ✍️ **Escribe en MercadoLibre.** Publica la respuesta, visible para cualquiera que entre a la publicación. |
| `ml_preguntas_estadisticas` | Tasa de respuesta, demora promedio en minutos, cuántas preguntas terminaron en venta y con qué tasa de conversión, qué publicaciones generan más preguntas y la distribución por hora del día. Con eso se decide en qué franja horaria hay que tener a alguien contestando. |
| `ml_mensajes` | La mensajería post-venta atada a cada orden, para detectar un reclamo antes de que se convierta en reclamo formal. |
| `ml_reclamos` | Reclamos abiertos, devoluciones en curso, cuáles afectan la reputación, cuáles tienen plazo de acción por vencer y cuánta plata hay en juego. Lo primero a mirar cuando el termómetro baja. |
| `ml_reputacion` | Color de reputación, nivel MercadoLíder, porcentaje de reclamos, cancelaciones y demoras de envío. |

### Inteligencia de mercado y competencia

| Herramienta | Qué devuelve |
|---|---|
| `ml_competidores` | Los vendedores que estás monitoreando, con su reputación, cantidad de publicaciones, ventas estimadas y precio promedio. |
| `ml_competitividad` | Publicación por publicación: tu precio contra el del mercado, la diferencia en porcentaje y si estás compitiendo o quedaste afuera. La respuesta a "¿estoy caro?". |
| `ml_mercado` | Modo `tendencias`: las búsquedas que están creciendo en MercadoLibre. Modo `categorias`: las categorías relevantes para tu cuenta. Modo `categoria`: los más vendidos de una categoría puntual y su rango de precios. Sirve tanto para decidir qué publicar como para entender la estacionalidad. |
| `ml_cambios_precio` | Los movimientos de precio detectados, propios y de los competidores que seguís, con el antes, el después y la variación. Para reaccionar el mismo día a una baja de la competencia. |
| `ml_publicidad` | Product Ads: inversión, impresiones, clics, ACOS y ventas atribuidas por campaña. La pregunta que contesta es si la pauta te deja plata o te la come. |
| `ml_promociones` | Las promociones que MercadoLibre te ofrece —Hot Sale, ofertas del día, descuentos por campaña— y, si le pasás un ID, qué publicaciones tuyas son elegibles. |
| `ml_catalogo` | Para un producto de catálogo: quiénes compiten por la caja de compra, a qué precio, con qué envío, cuánto vendieron y **quién la está ganando**. La respuesta a "¿por qué no gano el catálogo?". |
| `ml_alertas` | Las alertas automáticas del sistema: quiebres de stock, bajas de precio de competidores, reclamos nuevos, publicaciones pausadas. Buen segundo paso después de `ml_panel`. |

Las tres marcadas con ✍️ escriben de verdad en MercadoLibre. Están anotadas con
`destructiveHint`, así que Claude te muestra qué va a hacer y espera confirmación.
Se pueden apagar por completo con `ALLOW_WRITE=0`, dejando el conector en modo
solo lectura.

---

## Qué NO hace

Vale la pena ser explícito:

- No crea publicaciones nuevas ni las elimina.
- No despacha envíos ni imprime etiquetas.
- No emite facturas (lee la configuración de factura electrónica, no factura).
- No mueve plata: no retira, no transfiere, no cancela ventas.
- No cambia la configuración de la cuenta de MercadoLibre.
- No cierra reclamos ni negocia devoluciones.

Lo que escribe se limita a tres acciones acotadas: precio/stock/título/estado de una
publicación, la respuesta a una pregunta, y disparar una sincronización.

---

## Instalación

Cómo conectar MercadoLibre con Claude, en dos modos.

### Opción A — local (stdio)

Para vos o tu equipo, corriendo en la máquina de cada uno.

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "npx",
      "args": ["-y", "@algoritmodigital/mcp-mercadolibre"],
      "env": {
        "CRM_BASE_URL": "https://tu-crm.ejemplo.com",
        "CRM_USERNAME": "tu-usuario",
        "CRM_PASSWORD": "tu-clave"
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add mercadolibre \
  -e CRM_BASE_URL=https://tu-crm.ejemplo.com \
  -e CRM_USERNAME=tu-usuario -e CRM_PASSWORD=tu-clave \
  -- npx -y @algoritmodigital/mcp-mercadolibre
```

Si la cuenta tiene 2FA, generá un JWT desde el panel y usá `CRM_TOKEN` en lugar de
usuario y clave. Con `ML_CUENTA` fijás una cuenta de ML por defecto y te ahorrás
pasarla en cada consulta.

### Opción B — remoto (conector con OAuth)

Un solo servidor para todos tus clientes: cada uno lo agrega en Claude y se loguea
con su propio usuario del panel. Nadie configura nada.

```bash
git clone https://github.com/kokesaurio/mercadolibre-algoritmodigital.git
cd mercadolibre-algoritmodigital
npm install
cp .env.example .env    # completar CRM_BASE_URL, PUBLIC_URL y OAUTH_SIGNING_SECRET
npm run start:http
```

Publicalo detrás de HTTPS (nginx, Caddy, Railway, Fly.io) y en Claude entrá a
**Configuración → Conectores → Agregar conector personalizado** con la URL
`https://tu-dominio/mcp`. Claude descubre solo el servidor de autorización, se
registra, y le muestra al usuario la pantalla de login.

Implementa OAuth 2.1 completo: registro dinámico de clientes (RFC 7591), PKCE S256
obligatorio, metadata de servidor de autorización (RFC 8414) y de recurso protegido
(RFC 9728), access tokens de 1 hora y refresh tokens de 7 días.

---

## Variables de entorno

| Variable | Modo | Descripción |
|---|---|---|
| `CRM_BASE_URL` | ambos | **Obligatoria.** URL del backend, sin barra final |
| `CRM_TOKEN` | stdio | JWT del panel (alternativa a usuario/clave, necesaria con 2FA) |
| `CRM_USERNAME` / `CRM_PASSWORD` | stdio | Credenciales del panel |
| `ML_CUENTA` | stdio | ID de cuenta de ML por defecto |
| `PORT` | http | Puerto de escucha. Default `8787` |
| `PUBLIC_URL` | http | URL pública con HTTPS. Debe coincidir con la real |
| `OAUTH_SIGNING_SECRET` | http | Secreto HMAC, mínimo 24 caracteres |
| `STORE_FILE` | http | Dónde persistir clientes y sesiones |
| `ALLOW_WRITE` | ambos | `0` deja el conector en modo solo lectura |

---

## Estructura

```
src/
├── client.js          cliente HTTP del CRM: login, cache de JWT, reintento ante 401
├── format.js          tablas markdown, moneda ARS, fechas AR, truncado
├── server.js          arma el McpServer y registra las herramientas
├── oauth.js           servidor de autorización OAuth 2.1 (PKCE + registro dinámico)
├── stdio.js           bin: transporte stdio
├── http.js            bin: transporte Streamable HTTP + OAuth
└── tools/
    ├── sistema.js       cuentas y sincronización
    ├── ventas.js        panel, métricas, órdenes, caja, rentabilidad, geo, embudo
    ├── publicaciones.js catálogo, precios, stock, salud, rendimiento, costos
    ├── preguntas.js     preguntas, respuestas, mensajes, reclamos, reputación
    └── mercado.js       competidores, competitividad, tendencias, ads, catálogo
```

---

## Desarrollo

```bash
npm install
npm run inspect      # MCP Inspector: probar las herramientas a mano
npm start            # stdio
npm run start:http   # HTTP + OAuth
```

---

## Seguridad

- Las credenciales no se guardan: en modo remoto se cambian por un JWT del CRM y solo
  se persiste ese token, asociado a un ID de sesión aleatorio.
- Los access tokens se firman con HMAC-SHA256 y se comparan en tiempo constante.
- PKCE S256 es obligatorio; sin `code_verifier` válido no se emite ningún token.
- Los códigos de autorización son de un solo uso y vencen a los 5 minutos.
- Cada request a `/mcp` construye un servidor y un cliente HTTP nuevos, sin estado
  compartido entre usuarios.
- El health check no expone la URL del backend.
- Las herramientas de escritura se apagan con `ALLOW_WRITE=0`.

---

## Preguntas frecuentes

### ¿Qué es un servidor MCP?
MCP (Model Context Protocol) es el estándar abierto que usa Claude para conectarse a
sistemas externos. Un servidor MCP le expone un conjunto de herramientas al modelo;
Claude decide cuál usar según lo que le pidas. Es la forma oficial de darle a Claude
acceso a datos privados sin subirlos a ningún lado.

### ¿Cómo conecto MercadoLibre con Claude?
Instalás este conector (local con `npx`, o remoto agregándolo como conector
personalizado), le das la URL de tu backend y tus credenciales, y Claude ya puede
consultar tu cuenta. La guía completa está en [Instalación](#instalación).

### ¿Necesito una app en el DevCenter de MercadoLibre?
No para este conector. El OAuth con MercadoLibre lo resuelve el CRM que está detrás,
que es el que mantiene los tokens y sincroniza. Este servidor solo consulta ese CRM.

### ¿Funciona con Claude Desktop y con Claude Code?
Con los dos, y con cualquier cliente que hable MCP. En modo remoto también funciona
desde Claude en el navegador y desde el celular.

### ¿Puede modificar mis publicaciones sin que yo lo sepa?
No. Las tres herramientas que escriben están marcadas como destructivas, así que
Claude te muestra qué va a hacer y espera tu confirmación. Y podés dejarlo en modo
solo lectura con `ALLOW_WRITE=0`.

### ¿Consume el rate limit de la API de MercadoLibre?
No. Las consultas van contra la base ya sincronizada del CRM, no contra MercadoLibre.
Solo `ml_sincronizar` y las dos herramientas de escritura tocan la API oficial.

### ¿Sirve para MercadoLibre México, Brasil, Chile o Colombia?
Sí. La API de MercadoLibre es la misma para todos los sitios; lo que cambia es el
site_id de la cuenta conectada. El formato de moneda y fecha está en pesos argentinos
y se ajusta en `src/format.js`.

### ¿Puedo usarlo con varias cuentas de MercadoLibre?
Sí, es multicuenta. `ml_cuentas` te devuelve los IDs y el resto de las herramientas
acepta el parámetro `cuenta` para filtrar.

### ¿Los datos de mi cuenta pasan por algún servidor de terceros?
No. El conector corre donde vos lo pongas —tu máquina o tu servidor— y habla
directo con tu backend. Claude recibe únicamente el resultado de cada consulta.

---

## English summary

**MCP server for MercadoLibre.** Connect your MercadoLibre seller account to Claude AI
and query sales, revenue, real profitability, inventory, listings, buyer questions,
claims, seller reputation, Product Ads and competitor pricing in plain language.

32 tools across five areas: account management, sales and cash flow, listings and
stock, buyer questions and after-sales, and market intelligence. Ships with two
transports — stdio for local use with Claude Desktop and Claude Code, and Streamable
HTTP with full OAuth 2.1 (dynamic client registration, PKCE S256) to run it as a
hosted remote connector for multiple users.

Built for MercadoLibre sellers in Latin America. Documentation is in Spanish; the
codebase and tool schemas are self-describing. MIT licensed.

---

MIT · [Algoritmo Digital](https://algoritmodigital.com.ar)
