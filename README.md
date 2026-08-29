# Conector MCP de MercadoLibre — Algoritmo Digital

Servidor [MCP](https://modelcontextprotocol.io) que le da a Claude acceso a la operación
de una cuenta de MercadoLibre: ventas, plata, publicaciones, stock, preguntas, reclamos
y competencia.

No habla directo con la API de MercadoLibre: consulta el **CRM de Algoritmo Digital**,
que ya sincroniza contra la API oficial, resuelve el OAuth multicuenta, cachea y calcula
rentabilidad real. Eso significa que las respuestas llegan al instante y sin gastar el
rate limit de MercadoLibre.

> "¿Cómo viene el día?" · "¿Qué se me está por quedar sin stock?" · "¿Cuánta plata tengo
> por acreditar esta semana?" · "Contestá las preguntas pendientes" · "¿Por qué cayeron
> las ventas del set de mates?"

---

## Herramientas

**Cuenta**

| Herramienta | Qué hace |
|---|---|
| `ml_cuentas` | Cuentas de ML vinculadas y estado de la conexión |
| `ml_sincronizar` | Fuerza una sincronización contra MercadoLibre |

**Ventas y plata**

| Herramienta | Qué hace |
|---|---|
| `ml_panel` | Foto del día: ventas, preguntas, reclamos, alertas |
| `ml_metricas` | Ventas, facturado, neto, ticket y top productos (30 días) |
| `ml_ordenes` | Últimas órdenes con comisión, neto y fecha de acreditación |
| `ml_caja` | Disponible, por acreditar, últimos 14 días y proyección |
| `ml_facturacion` | Facturación y comisiones por período |
| `ml_rentabilidad` | Margen real tras comisión, envío, costo e impuestos |
| `ml_ventas_geo` | Ventas por provincia |
| `ml_embudo` | Visitas → preguntas → ventas |

**Publicaciones y stock**

| Herramienta | Qué hace |
|---|---|
| `ml_publicaciones` | Catálogo con precio, stock, vendidos y estado |
| `ml_actualizar_publicacion` | ✍️ Cambia precio, stock, título o estado en ML |
| `ml_stock` | Quiebres de stock y cobertura en Fulfillment |
| `ml_salud_publicaciones` | Puntaje de calidad y tareas para subirlo |
| `ml_rendimiento_publicaciones` | Visitas vs. ventas y conversión |
| `ml_visitas` | Serie histórica de visitas |
| `ml_costos_publicaciones` | Comisión y costo de envío por categoría |
| `ml_simular_precios` | Simula reglas de precio sin tocar nada |

**Preguntas y post-venta**

| Herramienta | Qué hace |
|---|---|
| `ml_preguntas` | Preguntas pendientes y respondidas, con filtros |
| `ml_responder_pregunta` | ✍️ Publica la respuesta en MercadoLibre |
| `ml_preguntas_estadisticas` | Tasa de respuesta, demora y conversión |
| `ml_mensajes` | Mensajería post-venta |
| `ml_reclamos` | Reclamos, devoluciones e impacto en reputación |
| `ml_reputacion` | Termómetro y métricas de MercadoLíder |

**Inteligencia de mercado**

| Herramienta | Qué hace |
|---|---|
| `ml_competidores` | Vendedores monitoreados |
| `ml_competitividad` | Mi precio contra el mercado |
| `ml_mercado` | Tendencias, categorías y más vendidos |
| `ml_cambios_precio` | Movimientos de precio propios y de la competencia |
| `ml_publicidad` | Product Ads: inversión, clics y ACOS |
| `ml_promociones` | Promociones disponibles y elegibles |
| `ml_catalogo` | Quién gana la caja de compra y a qué precio |
| `ml_alertas` | Alertas automáticas del sistema |

Las tres marcadas con ✍️ escriben de verdad en MercadoLibre. Están anotadas como
`destructiveHint`, así que Claude pide confirmación antes de ejecutarlas. Se pueden
desactivar por completo con `ALLOW_WRITE=0`.

---

## Instalación

### Opción A — local (stdio)

Para vos o tu equipo, corriendo en la máquina de cada uno.

```bash
npm install -g @algoritmodigital/mcp-mercadolibre
```

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
usuario y clave. Con `ML_CUENTA` fijás una cuenta de ML por defecto.

### Opción B — remoto (conector con OAuth)

Un solo servidor para todos los clientes: cada uno lo agrega en Claude y se loguea
con su usuario del panel.

```bash
git clone https://github.com/<usuario>/mercadolibre-algoritmodigital.git
cd mercadolibre-algoritmodigital
npm install
cp .env.example .env   # completar PUBLIC_URL y OAUTH_SIGNING_SECRET
npm run start:http
```

Publicalo detrás de HTTPS (nginx, Caddy, Railway, Fly.io) y en Claude:
**Configuración → Conectores → Agregar conector personalizado** con la URL
`https://tu-dominio/mcp`.

Implementa OAuth 2.1 completo: registro dinámico de clientes (RFC 7591), PKCE S256
obligatorio, metadata de servidor de autorización (RFC 8414) y de recurso protegido
(RFC 9728), access tokens de 1 hora y refresh tokens de 7 días.

---

## Variables de entorno

| Variable | Modo | Descripción |
|---|---|---|
| `CRM_BASE_URL` | ambos | **Obligatoria.** URL del backend, sin barra final |
| `CRM_TOKEN` | stdio | JWT del panel (alternativa a usuario/clave) |
| `CRM_USERNAME` / `CRM_PASSWORD` | stdio | Credenciales del panel |
| `ML_CUENTA` | stdio | ID de cuenta de ML por defecto |
| `PORT` | http | Puerto de escucha. Default `8787` |
| `PUBLIC_URL` | http | URL pública con HTTPS. Debe coincidir con la real |
| `OAUTH_SIGNING_SECRET` | http | Secreto HMAC, mínimo 24 caracteres |
| `STORE_FILE` | http | Dónde persistir clientes y sesiones |
| `ALLOW_WRITE` | ambos | `0` deja solo herramientas de lectura |

---

## Arquitectura

```
Claude ──MCP──> este servidor ──HTTP+JWT──> CRM Algoritmo Digital ──OAuth──> API MercadoLibre
                     │                              │
              formatea en markdown          sincroniza, cachea,
              y aplica límites              calcula rentabilidad
```

```
src/
├── client.js          cliente HTTP del CRM: login, cache de JWT, reintento ante 401
├── format.js          tablas markdown, moneda ARS, fechas AR, truncado
├── server.js          arma el McpServer y registra las herramientas
├── oauth.js           servidor de autorización OAuth 2.1 (PKCE + DCR)
├── stdio.js           bin: transporte stdio
├── http.js            bin: transporte Streamable HTTP + OAuth
└── tools/             las 32 herramientas, agrupadas por dominio
```

Cada herramienta devuelve **markdown ya formateado**, no JSON crudo: tablas legibles,
importes en pesos y listas acotadas. Eso baja mucho el consumo de contexto y hace que
Claude razone sobre los números en vez de sobre la forma del JSON.

---

## Desarrollo

```bash
npm install
npm run inspect     # MCP Inspector
npm start           # stdio
npm run start:http  # HTTP + OAuth
```

---

## Seguridad

- Las credenciales nunca se guardan: en modo remoto se cambian por un JWT del CRM
  y solo se persiste ese token, asociado a un ID de sesión aleatorio.
- Los access tokens se firman con HMAC-SHA256 y se comparan en tiempo constante.
- PKCE S256 es obligatorio; sin `code_verifier` válido no se emite ningún token.
- Todo request a `/mcp` construye un servidor y un cliente HTTP nuevos, sin estado
  compartido entre usuarios.
- Las herramientas de escritura se pueden apagar con `ALLOW_WRITE=0`.

---

MIT · [Algoritmo Digital](https://algoritmodigital.com.ar)
