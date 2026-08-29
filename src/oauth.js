// Servidor de autorizacion OAuth 2.1 minimo (PKCE obligatorio + registro dinamico).
// Puentea la identidad del CRM de Algoritmo Digital: el usuario se loguea con su
// usuario del panel y nosotros emitimos tokens propios que envuelven su JWT del CRM.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const b64url = (b) => Buffer.from(b).toString('base64url');
const rnd = (n = 32) => crypto.randomBytes(n).toString('base64url');

export function firmar(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + mac;
}

export function verificar(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const esperado = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac || '');
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

/** Almacen simple con persistencia opcional en disco (clientes y sesiones). */
export class Almacen {
  constructor(file) {
    this.file = file || null;
    this.data = { clients: {}, sessions: {} };
    if (this.file && fs.existsSync(this.file)) {
      try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* archivo corrupto: arrancamos limpio */ }
    }
  }
  guardar() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
    } catch { /* best effort */ }
  }
  cliente(id) { return this.data.clients[id]; }
  registrarCliente(c) { this.data.clients[c.client_id] = c; this.guardar(); return c; }
  sesion(id) { return this.data.sessions[id]; }
  guardarSesion(s) { this.data.sessions[s.id] = s; this.guardar(); return s; }
  borrarSesion(id) { delete this.data.sessions[id]; this.guardar(); }
}

export function montarOAuth(app, opts) {
  const {
    publicUrl,
    secret,
    almacen,
    loginCrm,          // async (username, password) => { token, nombre }
    ttlAccess = 3600,
    ttlRefresh = 60 * 60 * 24 * 7,
  } = opts;

  const codigos = new Map(); // code -> { client_id, redirect_uri, challenge, sessionId, exp }
  const issuer = publicUrl.replace(/\/+$/, '');

  const metadataAS = {
    issuer,
    authorization_endpoint: issuer + '/authorize',
    token_endpoint: issuer + '/token',
    registration_endpoint: issuer + '/register',
    revocation_endpoint: issuer + '/revoke',
    scopes_supported: ['mercadolibre'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };

  const metadataRS = {
    resource: issuer + '/mcp',
    authorization_servers: [issuer],
    scopes_supported: ['mercadolibre'],
    bearer_methods_supported: ['header'],
  };

  app.get('/.well-known/oauth-authorization-server', (_q, r) => r.json(metadataAS));
  app.get('/.well-known/oauth-authorization-server/mcp', (_q, r) => r.json(metadataAS));
  app.get('/.well-known/oauth-protected-resource', (_q, r) => r.json(metadataRS));
  app.get('/.well-known/oauth-protected-resource/mcp', (_q, r) => r.json(metadataRS));

  // ── Registro dinamico de clientes (RFC 7591) ──
  app.post('/register', (req, res) => {
    const b = req.body || {};
    const redirects = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (!redirects.length) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Falta redirect_uris' });
    const cliente = {
      client_id: 'ad_' + rnd(12),
      client_name: String(b.client_name || 'Cliente MCP').slice(0, 80),
      redirect_uris: redirects.slice(0, 8).map(String),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    almacen.registrarCliente(cliente);
    res.status(201).json(cliente);
  });

  // ── Pantalla de login ──
  const formulario = (params, aviso = '') => `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar MercadoLibre · Algoritmo Digital</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8eaed;
font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{width:min(380px,92vw);background:#181b21;border:1px solid #2a2f3a;border-radius:14px;padding:28px}
h1{font-size:18px;margin:0 0 4px}p.sub{margin:0 0 22px;color:#9aa3b2;font-size:13px}
label{display:block;font-size:12px;color:#9aa3b2;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #2a2f3a;
background:#0f1115;color:#e8eaed;font-size:14px}
input:focus{outline:2px solid #ffe600;outline-offset:0;border-color:transparent}
button{width:100%;margin-top:20px;padding:11px;border:0;border-radius:8px;background:#ffe600;color:#111;
font-weight:600;font-size:14px;cursor:pointer}
.err{margin-top:16px;padding:10px 12px;border-radius:8px;background:#3b1d1d;border:1px solid #6b2b2b;font-size:13px}
.pie{margin-top:20px;text-align:center;font-size:11px;color:#69707d}
</style></head><body><form class="card" method="post" action="/authorize">
<h1>Conectar con MercadoLibre</h1>
<p class="sub">Ingresá con tu usuario del panel de Algoritmo Digital.</p>
${Object.entries(params).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v ?? '').replace(/"/g, '&quot;')}">`).join('')}
<label for="u">Usuario o email</label><input id="u" name="username" autocomplete="username" autofocus required>
<label for="p">Contraseña</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Autorizar</button>
${aviso ? `<div class="err">${aviso}</div>` : ''}
<div class="pie">Algoritmo Digital · conector MCP</div>
</form></body></html>`;

  app.get('/authorize', (req, res) => {
    const q = req.query || {};
    const cliente = almacen.cliente(String(q.client_id || ''));
    if (!cliente) return res.status(400).send('client_id desconocido. Volvé a agregar el conector.');
    if (!cliente.redirect_uris.includes(String(q.redirect_uri || ''))) {
      return res.status(400).send('redirect_uri no registrada para este cliente.');
    }
    if (q.code_challenge_method !== 'S256' || !q.code_challenge) {
      return res.status(400).send('Se requiere PKCE con S256.');
    }
    res.type('html').send(formulario({
      client_id: q.client_id,
      redirect_uri: q.redirect_uri,
      state: q.state || '',
      code_challenge: q.code_challenge,
      scope: q.scope || 'mercadolibre',
    }));
  });

  app.post('/authorize', async (req, res) => {
    const b = req.body || {};
    const cliente = almacen.cliente(String(b.client_id || ''));
    if (!cliente || !cliente.redirect_uris.includes(String(b.redirect_uri || ''))) {
      return res.status(400).send('Solicitud invalida.');
    }
    const params = {
      client_id: b.client_id, redirect_uri: b.redirect_uri,
      state: b.state, code_challenge: b.code_challenge, scope: b.scope,
    };
    let sesion;
    try {
      const r = await loginCrm(String(b.username || ''), String(b.password || ''));
      sesion = almacen.guardarSesion({
        id: rnd(18),
        crmToken: r.token,
        nombre: r.nombre || b.username,
        creado: Date.now(),
      });
    } catch (e) {
      return res.status(401).type('html').send(formulario(params, e.message || 'No pudimos validar tus datos.'));
    }
    const code = rnd(24);
    codigos.set(code, {
      client_id: b.client_id,
      redirect_uri: b.redirect_uri,
      challenge: b.code_challenge,
      sessionId: sesion.id,
      exp: Date.now() + 5 * 60 * 1000,
    });
    const url = new URL(String(b.redirect_uri));
    url.searchParams.set('code', code);
    if (b.state) url.searchParams.set('state', String(b.state));
    res.redirect(302, url.toString());
  });

  const emitir = (sesion) => ({
    access_token: firmar({ sid: sesion.id, sub: sesion.nombre, exp: Math.floor(Date.now() / 1000) + ttlAccess }, secret),
    token_type: 'Bearer',
    expires_in: ttlAccess,
    refresh_token: firmar({ sid: sesion.id, typ: 'refresh', exp: Math.floor(Date.now() / 1000) + ttlRefresh }, secret),
    scope: 'mercadolibre',
  });

  app.post('/token', (req, res) => {
    const b = req.body || {};
    if (b.grant_type === 'refresh_token') {
      const p = verificar(String(b.refresh_token || ''), secret);
      if (!p || p.typ !== 'refresh') return res.status(400).json({ error: 'invalid_grant' });
      const sesion = almacen.sesion(p.sid);
      if (!sesion) return res.status(400).json({ error: 'invalid_grant', error_description: 'Sesion expirada, volvé a conectar.' });
      return res.json(emitir(sesion));
    }
    if (b.grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    const c = codigos.get(String(b.code || ''));
    if (!c) return res.status(400).json({ error: 'invalid_grant' });
    codigos.delete(String(b.code));
    if (c.exp < Date.now()) return res.status(400).json({ error: 'invalid_grant', error_description: 'Codigo vencido.' });
    if (c.client_id !== b.client_id || c.redirect_uri !== b.redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const calc = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
    if (calc !== c.challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE invalido.' });
    const sesion = almacen.sesion(c.sessionId);
    if (!sesion) return res.status(400).json({ error: 'invalid_grant' });
    res.json(emitir(sesion));
  });

  app.post('/revoke', (req, res) => {
    const p = verificar(String((req.body || {}).token || ''), secret);
    if (p && p.sid) almacen.borrarSesion(p.sid);
    res.status(200).json({});
  });

  /** Devuelve la sesion del CRM a partir del header Authorization, o null. */
  return function sesionDe(req) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = verificar(h.slice(7).trim(), secret);
    if (!p || p.typ === 'refresh' || !p.sid) return null;
    return almacen.sesion(p.sid) || null;
  };
}
