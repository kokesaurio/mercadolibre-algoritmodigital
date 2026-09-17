// dev/entorno.js — Entorno de desarrollo autocontenido para el conector.
//
// Permite desarrollar y probar TODO el proyecto sin CRM real ni VPS
// (pensado para trabajar el repo dentro del entorno de Claude / Claude Code):
//
//   npm run dev   → levanta un CRM simulado (:9999) + el conector HTTP (:8787)
//   npm test      → corre la suite E2E completa (OAuth, login ML, fallback,
//                   herramientas por stdio y por HTTP) y sale con código != 0 si algo falla
//
// Usuario del CRM simulado: demo / demo

import express from 'express';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as esperar } from 'node:timers/promises';

const PUERTO_CRM = Number(process.env.MOCK_PORT || 9999);
const PUERTO_MCP = Number(process.env.PORT || 8787);
const SECRET = 'secreto-de-desarrollo-no-usar-en-produccion-1234';

// ─────────────────────────── CRM simulado ───────────────────────────
export function crearMockCrm({ conLoginMl = true } = {}) {
  const app = express();
  app.use(express.json());
  const base = (req) => `http://localhost:${req.socket.localPort}`;
  const regla = { activa: false, max_desc_vendedor: 10, min_aporte_meli: 0, precio_minimo: 0 };

  // Auth clásica del panel
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === 'demo' && password === 'demo') return res.json({ token: 'jwt-demo-panel' });
    res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  });

  // Login con MercadoLibre (delegado): el "MercadoLibre" también es simulado acá
  if (conLoginMl) {
    app.get('/api/auth/ml/url', (req, res) => {
      const u = new URL(base(req) + '/ml-simulado/authorization');
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', 'APP-DEMO');
      u.searchParams.set('redirect_uri', String(req.query.redirect_uri || ''));
      u.searchParams.set('state', String(req.query.state || ''));
      res.json({ url: u.toString() });
    });
    app.get('/ml-simulado/authorization', (req, res) => {
      // Simula que el usuario autorizó con su cuenta de ML
      const u = new URL(String(req.query.redirect_uri));
      u.searchParams.set('code', 'CODE-ML-DEMO');
      u.searchParams.set('state', String(req.query.state || ''));
      res.redirect(302, u.toString());
    });
    app.post('/api/auth/ml', (req, res) => {
      if (req.body?.code !== 'CODE-ML-DEMO') return res.status(401).json({ error: 'code inválido' });
      res.json({ token: 'jwt-demo-panel', nombre: 'TIENDA_DEMO' });
    });
  }

  // Autenticación de las rutas de datos
  app.use('/api/ml', (req, res, next) => {
    if (req.headers.authorization !== 'Bearer jwt-demo-panel') return res.status(401).json({ error: 'No autorizado' });
    next();
  });

  // Datos de ejemplo de las rutas principales
  app.get('/api/ml/cuentas', (_q, res) => res.json([{ id: 1, nombre: 'TIENDA_DEMO', user_id: 123456, activa: true }]));
  app.get('/api/ml/status', (_q, res) => res.json({ app_id_set: true, secret_set: true, conectado: true, cuentas: 1 }));
  app.get('/api/ml/panel', (_q, res) => res.json({ hoy: { ventas: 7, facturacion: 315000 }, ayer_misma_hora: { ventas: 5, facturacion: 240000 } }));
  app.get('/api/ml/promociones', (_q, res) => res.json({ promos: [{ id: 'P-DEMO', name: 'Promo demo', type: 'DEAL', status: 'candidate' }] }));
  app.get('/api/ml/promociones/:id/items', (_q, res) => res.json({ items: [
    { item_id: 'MLA111', title: 'Termo Demo 1L', price: 42000, suggested_discounted_price: 37800, meli_percentage: 5 },
    { item_id: 'MLA222', title: 'Mate Demo', price: 18500, suggested_discounted_price: 15900, meli_percentage: 4 },
  ] }));
  app.post('/api/ml/promociones/:id/aceptar', (req, res) => {
    const ids = (req.body?.items || []).map((i) => i.id);
    res.json({ aceptados: ids, errores: [] });
  });
  app.get('/api/ml/promociones/regla', (_q, res) => res.json(regla));
  app.put('/api/ml/promociones/regla', (req, res) => { Object.assign(regla, req.body || {}, { activa: true }); res.json(regla); });

  // Cualquier otra ruta de datos: respuesta vacía válida (las herramientas muestran "sin datos")
  app.all(/^\/api\/ml\/.*/, (_q, res) => res.json({ demo: true, items: [] }));
  return app;
}

// ─────────────────────── Arranque del conector ───────────────────────
function lanzarConector(env = {}) {
  const hijo = spawn(process.execPath, ['src/http.js'], {
    env: {
      ...process.env,
      CRM_BASE_URL: `http://localhost:${PUERTO_CRM}`,
      OAUTH_SIGNING_SECRET: SECRET,
      PORT: String(PUERTO_MCP),
      MCP_STORE: '.mcp-store.dev.json',
      ...env,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return hijo;
}

// ────────────────────────────── Pruebas ──────────────────────────────
const S256 = (v) => crypto.createHash('sha256').update(v).digest('base64url');

async function pruebas() {
  const base = `http://localhost:${PUERTO_MCP}`;
  const resultados = [];
  const caso = async (nombre, fn) => {
    try { await fn(); resultados.push([nombre, true]); }
    catch (e) { resultados.push([nombre, false, e.message]); }
  };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t.replace(/^event:.*\ndata: /m, '').trim()); } catch { return { _crudo: t }; } };

  let token = '';
  let clientId = '';
  const verifier = 'verificador-de-prueba-suficientemente-largo-0123456789';
  const redirect = 'http://localhost:7777/cb';

  await caso('metadata OAuth (RFC 8414 y 9728)', async () => {
    const a = await (await fetch(base + '/.well-known/oauth-authorization-server')).json();
    const b = await (await fetch(base + '/.well-known/oauth-protected-resource')).json();
    if (!a.authorization_endpoint || !b.resource) throw new Error('metadata incompleta');
  });

  await caso('registro dinámico de cliente (RFC 7591)', async () => {
    const r = await j(await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'test', redirect_uris: [redirect] }) }));
    if (!r.client_id) throw new Error('sin client_id');
    clientId = r.client_id;
  });

  let codigo = '';
  await caso('login con MercadoLibre: /authorize redirige a ML y vuelve con code', async () => {
    const u = `${base}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${S256(verifier)}&code_challenge_method=S256&state=est1`;
    const r1 = await fetch(u, { redirect: 'manual' });
    const aMl = r1.headers.get('location');
    if (r1.status !== 302 || !aMl?.includes('/ml-simulado/authorization')) throw new Error('no redirigió a ML');
    const r2 = await fetch(aMl, { redirect: 'manual' });
    const aCb = r2.headers.get('location');
    if (!aCb?.includes('/ml/callback')) throw new Error('ML no volvió al callback');
    const r3 = await fetch(aCb, { redirect: 'manual' });
    const final = new URL(r3.headers.get('location'));
    if (final.origin + final.pathname !== redirect) throw new Error('no volvió a Claude');
    if (final.searchParams.get('state') !== 'est1') throw new Error('state perdido');
    codigo = final.searchParams.get('code');
    if (!codigo) throw new Error('sin code');
  });

  await caso('canje del code con PKCE + refresh token', async () => {
    const cuerpo = new URLSearchParams({ grant_type: 'authorization_code', code: codigo, client_id: clientId, redirect_uri: redirect, code_verifier: verifier });
    const r = await j(await fetch(base + '/token', { method: 'POST', body: cuerpo }));
    if (!r.access_token || !r.refresh_token) throw new Error('token incompleto: ' + JSON.stringify(r));
    token = r.access_token;
    const r2 = await j(await fetch(base + '/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r.refresh_token }) }));
    if (!r2.access_token) throw new Error('refresh falló');
  });

  await caso('/mcp sin token devuelve 401 con WWW-Authenticate', async () => {
    const r = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 200 || !r.headers.get('www-authenticate')) throw new Error('no exige token');
  });

  const mcp = (cuerpo) => fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + token }, body: JSON.stringify(cuerpo) });

  await caso('initialize + herramienta real contra el CRM simulado', async () => {
    const ini = await j(await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }));
    if (ini.result?.serverInfo?.name !== 'mercadolibre-algoritmodigital') throw new Error('initialize falló');
    const r = await (await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ml_cuentas', arguments: {} } })).text();
    if (!r.includes('TIENDA_DEMO')) throw new Error('la herramienta no trajo datos del CRM');
  });

  await caso('modo stdio: initialize + tools/list (33 herramientas)', async () => {
    const hijo = spawn(process.execPath, ['src/stdio.js'], { env: { ...process.env, CRM_BASE_URL: `http://localhost:${PUERTO_CRM}`, CRM_TOKEN: 'jwt-demo-panel' } });
    let salida = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    hijo.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    hijo.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    await esperar(2500);
    hijo.kill();
    const linea = salida.split('\n').find((l) => l.includes('"id":2'));
    const total = linea ? JSON.parse(linea).result.tools.length : 0;
    if (total < 30) throw new Error('tools/list devolvió ' + total);
  });

  return resultados;
}

async function pruebaFallback() {
  // CRM viejo (sin login ML) en otro puerto → /authorize debe mostrar el formulario
  const puertoCrm = PUERTO_CRM + 1;
  const puertoMcp = PUERTO_MCP + 1;
  const mock = crearMockCrm({ conLoginMl: false }).listen(puertoCrm);
  const srv = lanzarConector({ CRM_BASE_URL: `http://localhost:${puertoCrm}`, PORT: String(puertoMcp), MCP_STORE: '.mcp-store.dev2.json' });
  await esperar(1500);
  const base = `http://localhost:${puertoMcp}`;
  try {
    const reg = await (await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://localhost:7777/cb'] }) })).json();
    const u = `${base}/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent('http://localhost:7777/cb')}&code_challenge=${S256('x'.repeat(48))}&code_challenge_method=S256`;
    const html = await (await fetch(u)).text();
    if (!html.includes('name="username"')) throw new Error('no cayó al formulario clásico');
    return [['fallback: CRM sin login ML muestra formulario clásico', true]];
  } catch (e) {
    return [['fallback: CRM sin login ML muestra formulario clásico', false, e.message]];
  } finally {
    mock.close(); srv.kill();
  }
}

// ─────────────────────────────── main ───────────────────────────────
const modo = process.argv[2] || 'dev';

if (modo === 'test') {
  const mock = crearMockCrm().listen(PUERTO_CRM);
  const srv = lanzarConector();
  await esperar(1500);
  const resultados = [...await pruebas(), ...await pruebaFallback()];
  mock.close(); srv.kill();
  let fallas = 0;
  for (const [nombre, ok, err] of resultados) {
    console.log((ok ? '  ✅ ' : '  ❌ ') + nombre + (ok ? '' : ' — ' + err));
    if (!ok) fallas++;
  }
  console.log(fallas ? `\n${fallas} prueba(s) fallaron` : `\nTodo OK (${resultados.length} pruebas)`);
  process.exit(fallas ? 1 : 0);
} else {
  crearMockCrm().listen(PUERTO_CRM, () => console.log(`[dev] CRM simulado en http://localhost:${PUERTO_CRM} (usuario demo / demo)`));
  lanzarConector();
  console.log(`[dev] Conector MCP en http://localhost:${PUERTO_MCP}/mcp — Ctrl+C para frenar`);
}
