// Helpers de formateo: el objetivo es que la respuesta sea legible para el modelo
// y no un volcado gigante de JSON.

const MONEDA = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('es-AR');

export const money = (n) => (n == null || n === '' ? '-' : MONEDA.format(Number(n) || 0));
export const num = (n) => (n == null || n === '' ? '-' : NUM.format(Number(n) || 0));
export const pct = (n) => (n == null || n === '' ? '-' : (Math.round(Number(n) * 10) / 10) + '%');

export function fecha(d) {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x)) return String(d);
  return x.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function fechaHora(d) {
  if (!d) return '-';
  const x = new Date(d);
  if (isNaN(x)) return String(d);
  return x.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export const corto = (s, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** Tabla markdown a partir de filas + columnas [{ h, get, align }]. */
export function tabla(rows, cols, { vacio = '_Sin datos._' } = {}) {
  if (!Array.isArray(rows) || !rows.length) return vacio;
  const head = '| ' + cols.map((c) => c.h).join(' | ') + ' |';
  const sep = '| ' + cols.map((c) => (c.align === 'r' ? '---:' : '---')).join(' | ') + ' |';
  const body = rows.map((r) => '| ' + cols.map((c) => {
    let v;
    try { v = c.get(r); } catch { v = ''; }
    return String(v ?? '-').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }).join(' | ') + ' |');
  return [head, sep, ...body].join('\n');
}

/** Lista de "clave: valor" para bloques de metricas. */
export function kv(obj, pares) {
  return pares
    .map(([label, get]) => {
      let v;
      try { v = typeof get === 'function' ? get(obj) : obj?.[get]; } catch { v = null; }
      return '- **' + label + ':** ' + (v ?? '-');
    })
    .join('\n');
}

/** Envuelve texto markdown como resultado MCP. */
export const texto = (md) => ({ content: [{ type: 'text', text: md }] });

/** Resultado de error legible. */
export const error = (msg) => ({ content: [{ type: 'text', text: '⚠️ ' + msg }], isError: true });

/** Anexa el JSON crudo recortado, util cuando el modelo necesita campos extra. */
export function conCrudo(md, data, { max = 4000 } = {}) {
  let raw;
  try { raw = JSON.stringify(data); } catch { return md; }
  if (raw.length > max) return md;
  return md + '\n\n<details><summary>datos crudos</summary>\n\n```json\n' + raw + '\n```\n\n</details>';
}

export function encabezado(titulo, sub) {
  return '## ' + titulo + (sub ? '\n_' + sub + '_' : '');
}
