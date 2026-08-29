#!/usr/bin/env node
// Transporte HTTP (Streamable) con OAuth 2.1: para publicar el conector y que
// cualquiera lo agregue desde Claude con su usuario del panel.
import express from 'express';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { crearServidor } from './server.js';
import { CrmClient } from './client.js';
import { Almacen, montarOAuth } from './oauth.js';

const env = process.env;
const PORT = Number(env.PORT || 8787);
const PUBLIC_URL = (env.PUBLIC_URL || 'http://localhost:' + PORT).replace(/\/+$/, '');
const CRM_BASE_URL = env.CRM_BASE_URL;
const SECRET = env.OAUTH_SIGNING_SECRET;
const ALLOW_WRITE = env.ALLOW_WRITE !== '0';

if (!CRM_BASE_URL) {
  console.error('[mcp-mercadolibre] Falta CRM_BASE_URL: la URL del backend contra el que corre este conector.');
  process.exit(1);
}
if (!SECRET || SECRET.length < 24) {
  console.error('[mcp-mercadolibre] Falta OAUTH_SIGNING_SECRET (minimo 24 caracteres).');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS: los clientes MCP web necesitan leer el header de sesion.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const almacen = new Almacen(env.STORE_FILE || path.join(process.cwd(), '.mcp-store.json'));

const sesionDe = montarOAuth(app, {
  publicUrl: PUBLIC_URL,
  secret: SECRET,
  almacen,
  loginCrm: async (username, password) => {
    const c = new CrmClient({ baseUrl: CRM_BASE_URL, username, password });
    const token = await c.login();
    return { token, nombre: username };
  },
});

app.get('/', (_q, res) => {
  res.type('html').send(
    '<!doctype html><meta charset="utf-8"><title>MCP MercadoLibre · Algoritmo Digital</title>' +
    '<style>body{font:15px/1.6 system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8eaed}' +
    'code{background:#181b21;padding:2px 6px;border-radius:5px}div{max-width:520px;padding:32px}</style>' +
    '<div><h1>Conector MCP de MercadoLibre</h1>' +
    '<p>Servidor MCP de Algoritmo Digital. Agregalo en Claude como conector personalizado con esta URL:</p>' +
    '<p><code>' + PUBLIC_URL + '/mcp</code></p>' +
    '<p>Claude te va a pedir que inicies sesión con tu usuario del panel.</p></div>'
  );
});

// No expone el backend: el health check es publico.
app.get('/health', (_q, res) => res.json({ ok: true }));

function pedirAuth(res) {
  res.setHeader('WWW-Authenticate',
    'Bearer resource_metadata="' + PUBLIC_URL + '/.well-known/oauth-protected-resource"');
  return res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'No autorizado. Conectá tu cuenta de Algoritmo Digital.' },
    id: null,
  });
}

// Streamable HTTP sin estado: un servidor efimero por request, aislado por usuario.
app.post('/mcp', async (req, res) => {
  const sesion = sesionDe(req);
  if (!sesion) return pedirAuth(res);

  const crm = new CrmClient({ baseUrl: CRM_BASE_URL, token: sesion.crmToken });
  const server = crearServidor({ crm, allowWrite: ALLOW_WRITE });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp] error:', e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno' }, id: null });
    }
  }
});

// En modo sin estado no hay stream server→cliente ni sesiones que borrar.
app.get('/mcp', (req, res) => (sesionDe(req) ? res.status(405).json({ error: 'method_not_allowed' }) : pedirAuth(res)));
app.delete('/mcp', (req, res) => (sesionDe(req) ? res.status(204).end() : pedirAuth(res)));

app.listen(PORT, () => {
  console.log('[mcp-mercadolibre] escuchando en :' + PORT);
  console.log('[mcp-mercadolibre] URL publica: ' + PUBLIC_URL + '/mcp');
  console.log('[mcp-mercadolibre] backend CRM: ' + CRM_BASE_URL);
});
