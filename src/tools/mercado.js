import { z } from 'zod';
import { texto, tabla, kv, money, num, pct, fecha, corto, encabezado, conCrudo } from '../format.js';

const cuentaArg = z.number().int().optional().describe('ID de la cuenta de MercadoLibre.');

export const mercado = [
  {
    name: 'ml_competidores',
    title: 'Competidores seguidos',
    description: 'Vendedores que se están monitoreando: reputación, cantidad de publicaciones, ventas estimadas y precio promedio. Usar cuando preguntan cómo están contra la competencia.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/competidores', { query: crm.conCuenta({}, cuenta) });
      const rows = Array.isArray(d) ? d : d.competidores || d.rows || [];
      return texto([
        encabezado('Competidores monitoreados'),
        tabla(rows, [
          { h: 'ID', get: (r) => r.id },
          { h: 'Vendedor', get: (r) => corto(r.nickname || r.nombre, 26) },
          { h: 'Reputación', get: (r) => r.reputacion || r.nivel || '-' },
          { h: 'Publicaciones', align: 'r', get: (r) => num(r.publicaciones ?? r.items) },
          { h: 'Ventas', align: 'r', get: (r) => num(r.ventas) },
          { h: 'Precio prom.', align: 'r', get: (r) => money(r.precio_promedio ?? r.precio) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_competitividad',
    title: 'Competitividad de precios',
    description: 'Compara el precio de cada publicación propia contra el mercado: si está por encima, por debajo o si perdió la caja de compra. Usar cuando preguntan si están caros o por qué cayeron las ventas.',
    readOnly: true,
    schema: { cuenta: cuentaArg, limite: z.number().int().min(1).max(100).default(30) },
    async run({ cuenta, limite = 30 }, { crm }) {
      const d = await crm.ml('/competitividad', { query: crm.conCuenta({}, cuenta) });
      if (!d.cuenta) return texto('No hay cuenta conectada.');
      const m = d.metricas || {};
      return texto([
        encabezado('Competitividad — ' + (d.cuenta.nombre || d.cuenta.id)),
        kv(m, Object.keys(m).map((k) => [k, k])),
        '',
        tabla((d.items || []).slice(0, limite), [
          { h: 'ID', get: (r) => r.ml_id || r.item_id },
          { h: 'Título', get: (r) => corto(r.titulo, 38) },
          { h: 'Mi precio', align: 'r', get: (r) => money(r.precio) },
          { h: 'Mercado', align: 'r', get: (r) => money(r.precio_mercado ?? r.precio_min) },
          { h: 'Δ', align: 'r', get: (r) => pct(r.diferencia ?? r.delta_pct) },
          { h: 'Estado', get: (r) => r.estado_competitividad || r.situacion || '-' },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_mercado',
    title: 'Tendencias y categorías',
    description: 'Inteligencia de mercado de MercadoLibre. Modo "tendencias": búsquedas que están creciendo. Modo "categorias": categorías más relevantes para la cuenta. Modo "categoria": los más vendidos y el rango de precios de una categoría puntual (requiere categoria_id, ej. MLA1234).',
    readOnly: true,
    schema: {
      modo: z.enum(['tendencias', 'categorias', 'categoria']).default('tendencias'),
      categoria_id: z.string().optional().describe('ID de categoría de ML (MLA...), obligatorio en modo "categoria".'),
      cuenta: cuentaArg,
    },
    async run({ modo = 'tendencias', categoria_id, cuenta }, { crm }) {
      const q = crm.conCuenta({}, cuenta);
      if (modo === 'categoria') {
        if (!categoria_id) return texto('Falta `categoria_id` (ej. MLA1234). Podés obtenerlo con modo "categorias".');
        const d = await crm.ml('/mercado/categoria/' + encodeURIComponent(categoria_id), { query: q });
        return texto(conCrudo(encabezado('Categoría ' + categoria_id), d, { max: 9000 }));
      }
      if (modo === 'categorias') {
        const d = await crm.ml('/mercado/categorias', { query: q });
        return texto(conCrudo(encabezado('Categorías'), d, { max: 9000 }));
      }
      const d = await crm.ml('/tendencias', { query: q });
      if (d.listas) {
        const md = (d.listas || []).map((l) => {
          const kws = (l.keywords || []).map((k) => (typeof k === 'string' ? k : k.keyword || k.nombre)).filter(Boolean);
          return '**' + l.titulo + '** (' + l.scope + ')\n' + kws.slice(0, 30).join(' · ');
        }).join('\n\n');
        return texto(encabezado('Tendencias', 'actualizado: ' + fecha(d.actualizado)) + '\n\n' + (md || '_sin datos_'));
      }
      return texto(conCrudo(encabezado('Tendencias'), d, { max: 9000 }));
    },
  },
  {
    name: 'ml_cambios_precio',
    title: 'Cambios de precio detectados',
    description: 'Movimientos de precio recientes, propios y de competidores monitoreados. Sirve para reaccionar a una baja de un competidor o auditar cambios propios.',
    readOnly: true,
    schema: { cuenta: cuentaArg, limite: z.number().int().min(1).max(100).default(40) },
    async run({ cuenta, limite = 40 }, { crm }) {
      const d = await crm.ml('/cambios-precio', { query: crm.conCuenta({}, cuenta) });
      return texto([
        encabezado('Cambios de precio', d.total + ' detectados'),
        tabla((d.cambios || []).slice(0, limite), [
          { h: 'Fecha', get: (r) => fecha(r.fecha) },
          { h: 'Publicación', get: (r) => corto(r.titulo || r.item_id, 38) },
          { h: 'Antes', align: 'r', get: (r) => money(r.precio_anterior ?? r.antes) },
          { h: 'Ahora', align: 'r', get: (r) => money(r.precio_nuevo ?? r.ahora ?? r.precio) },
          { h: 'Δ', align: 'r', get: (r) => pct(r.variacion ?? r.delta_pct) },
          { h: 'Quién', get: (r) => corto(r.vendedor || r.origen || 'propio', 18) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_publicidad',
    title: 'Product Ads',
    description: 'Campañas de publicidad de MercadoLibre: inversión, impresiones, clics, ACOS y ventas atribuidas. Usar cuando preguntan si conviene la pauta o cuánto están gastando en ads.',
    readOnly: true,
    schema: {
      dias: z.number().int().min(1).max(180).default(30),
      cuenta: cuentaArg,
    },
    async run({ dias = 30, cuenta }, { crm }) {
      const d = await crm.ml('/publicidad', { query: crm.conCuenta({ dias }, cuenta) });
      if (!d.cuenta) return texto('No hay cuenta conectada.');
      if (!d.activo) return texto('La cuenta no tiene Product Ads activo.');
      const m = d.metricas || {};
      return texto([
        encabezado('Product Ads — ' + dias + ' días' + (d.desde_cache ? ' (cache)' : '')),
        kv(m, Object.keys(m).map((k) => [k, k])),
        '',
        tabla(d.campanas || [], [
          { h: 'Campaña', get: (r) => corto(r.nombre || r.name, 32) },
          { h: 'Estado', get: (r) => r.estado || r.status },
          { h: 'Inversión', align: 'r', get: (r) => money(r.inversion ?? r.cost) },
          { h: 'Clics', align: 'r', get: (r) => num(r.clics ?? r.clicks) },
          { h: 'Ventas', align: 'r', get: (r) => money(r.ventas ?? r.amount) },
          { h: 'ACOS', align: 'r', get: (r) => pct(r.acos) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_promociones',
    title: 'Promociones disponibles',
    description: 'Campañas y promociones que MercadoLibre ofrece a la cuenta, y qué publicaciones podrían entrar. Usar cuando preguntan si conviene entrar a una promo o al Hot Sale.',
    readOnly: true,
    schema: {
      promocion_id: z.string().optional().describe('Si se indica, lista las publicaciones elegibles de esa promoción.'),
      tipo: z.string().optional().describe('Tipo de promoción, para filtrar los ítems.'),
      cuenta: cuentaArg,
    },
    async run({ promocion_id, tipo, cuenta }, { crm }) {
      const q = crm.conCuenta({}, cuenta);
      if (promocion_id) {
        const d = await crm.ml('/promociones/' + encodeURIComponent(promocion_id) + '/items', { query: { ...q, tipo } });
        return texto(conCrudo(encabezado('Promoción ' + promocion_id), d, { max: 9000 }));
      }
      const d = await crm.ml('/promociones', { query: q });
      if (!d.cuenta) return texto('No hay cuenta conectada.');
      return texto([
        encabezado('Promociones — ' + d.cuenta, d.total + ' disponibles'),
        tabla(d.promos || [], [
          { h: 'ID', get: (r) => r.id },
          { h: 'Nombre', get: (r) => corto(r.name || r.nombre, 38) },
          { h: 'Tipo', get: (r) => r.type || r.tipo },
          { h: 'Estado', get: (r) => r.status || r.estado },
          { h: 'Desde', get: (r) => fecha(r.start_date || r.desde) },
          { h: 'Hasta', get: (r) => fecha(r.finish_date || r.hasta) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_catalogo',
    title: 'Catálogo de MercadoLibre',
    description: 'Busca un producto de catálogo y muestra quiénes compiten por la caja de compra, a qué precio y quién la está ganando. Usar cuando preguntan por qué no ganan el catálogo.',
    readOnly: true,
    schema: {
      buscar: z.string().describe('Nombre del producto o product_id de catálogo.'),
      cuenta: cuentaArg,
    },
    async run({ buscar, cuenta }, { crm }) {
      const d = await crm.ml('/catalogo', { query: crm.conCuenta({ q: buscar }, cuenta) });
      return texto([
        encabezado('Catálogo — ' + (d.nombre || buscar), (d.mostrados ?? 0) + ' de ' + (d.total ?? 0) + ' competidores'),
        tabla(d.items || [], [
          { h: 'Vendedor', get: (r) => corto(r.vendedor || r.seller || r.nickname, 24) },
          { h: 'Precio', align: 'r', get: (r) => money(r.price ?? r.precio) },
          { h: 'Envío', get: (r) => (r.free_shipping || r.envio_gratis ? 'gratis' : '-') },
          { h: 'Vendidos', align: 'r', get: (r) => num(r.sold_quantity ?? r.vendidos) },
          { h: 'Ganador', get: (r) => (r.winner || r.ganador ? '🏆' : '') },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_alertas',
    title: 'Alertas del sistema',
    description: 'Alertas automáticas generadas por el sistema: quiebres de stock, caídas de precio de competidores, reclamos nuevos, publicaciones pausadas. Es un buen segundo paso después de ml_panel.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/alertas', { query: crm.conCuenta({}, cuenta) });
      return texto([
        encabezado('Alertas', d.total + ' activas'),
        tabla(d.alertas || [], [
          { h: 'Tipo', get: (r) => r.tipo },
          { h: 'Detalle', get: (r) => corto(r.mensaje || r.detalle || r.texto, 80) },
          { h: 'Fecha', get: (r) => fecha(r.fecha || r.creado_en) },
        ]),
      ].join('\n'));
    },
  },
];
