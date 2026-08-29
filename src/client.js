// Cliente HTTP contra el backend CRM de Algoritmo Digital.
// Encapsula login, cache de JWT y reintento ante 401.

export class CrmError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'CrmError';
    this.status = status;
    this.body = body;
  }
}

export class CrmClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl     URL del backend, sin barra final
   * @param {string} [opts.token]     JWT ya emitido por el CRM
   * @param {string} [opts.username]  usuario del panel (para login automatico)
   * @param {string} [opts.password]  clave del panel
   * @param {number|string} [opts.cuenta] id de cuenta ML por defecto
   * @param {number} [opts.timeoutMs]
   */
  constructor({ baseUrl, token, username, password, cuenta, timeoutMs = 45000 }) {
    if (!baseUrl) throw new Error('Falta CRM_BASE_URL');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.token = token || null;
    this.username = username || null;
    this.password = password || null;
    this.cuenta = cuenta ? Number(cuenta) : null;
    this.timeoutMs = timeoutMs;
    this._loginPromise = null;
  }

  async login() {
    if (!this.username || !this.password) {
      throw new CrmError(
        'No hay credenciales. Configura CRM_TOKEN, o CRM_USERNAME + CRM_PASSWORD.',
        401
      );
    }
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = (async () => {
      const r = await fetch(this.baseUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new CrmError(j.error || ('Login fallido (' + r.status + ')'), r.status, j);
      if (j.require2fa) {
        throw new CrmError(
          'La cuenta tiene 2FA activo. Genera un token desde el panel y usalo en CRM_TOKEN.',
          401,
          j
        );
      }
      if (!j.token) throw new CrmError('El CRM no devolvio token.', 500, j);
      this.token = j.token;
      return j.token;
    })().finally(() => { this._loginPromise = null; });
    return this._loginPromise;
  }

  async ensureToken() {
    if (this.token) return this.token;
    return this.login();
  }

  /**
   * @param {string} path   ruta relativa a /api/ml (ej. '/ordenes')
   * @param {object} [opts] { method, query, body, raw }
   */
  async ml(path, opts = {}) {
    return this.request('/api/ml' + path, opts);
  }

  async request(path, { method = 'GET', query = null, body = null, retry = true } = {}) {
    const token = await this.ensureToken();
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    if (body != null) headers['Content-Type'] = 'application/json';

    let r;
    try {
      r = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const msg = e.name === 'TimeoutError'
        ? 'El backend tardo demasiado en responder (' + this.timeoutMs + ' ms).'
        : 'No se pudo conectar con ' + this.baseUrl + ': ' + e.message;
      throw new CrmError(msg, 0);
    }

    // Token vencido: reintentar una vez si podemos re-loguear.
    if (r.status === 401 && retry && this.username && this.password) {
      this.token = null;
      await this.login();
      return this.request(path, { method, query, body, retry: false });
    }

    const text = await r.text();
    let j;
    try { j = text ? JSON.parse(text) : null; } catch { j = { raw: text }; }

    if (!r.ok) {
      const msg = (j && (j.error || j.message)) || ('HTTP ' + r.status);
      throw new CrmError(msg, r.status, j);
    }
    return j;
  }

  /** Agrega el filtro de cuenta por defecto si el llamador no especifico uno. */
  conCuenta(query = {}, cuenta) {
    const c = cuenta ?? this.cuenta;
    return c ? { ...query, cuenta: c } : query;
  }
}
