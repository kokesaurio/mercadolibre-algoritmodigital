import { z } from 'zod';
import { texto, tabla, kv, money, num, pct, fechaHora, corto, encabezado, conCrudo } from '../format.js';

const cuentaArg = z.number().int().optional().describe('ID de la cuenta de MercadoLibre.');

export const preguntas = [
  {
    name: 'ml_preguntas',
    title: 'Preguntas de compradores',
    description: 'Preguntas hechas en las publicaciones, con filtros por estado (pendientes o respondidas), publicación, mes o texto. Por defecto trae las pendientes, que es lo urgente. Devuelve el ID interno que necesita ml_responder_pregunta.',
    readOnly: true,
    schema: {
      estado: z.enum(['pend', 'resp', 'todas']).default('pend').describe('pend = sin responder, resp = respondidas, todas.'),
      item_id: z.string().optional().describe('Filtrar por publicación (MLA...).'),
      mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('Filtrar por mes YYYY-MM.'),
      buscar: z.string().optional().describe('Texto a buscar en la pregunta, la respuesta o el título.'),
      limite: z.number().int().min(1).max(100).default(25),
      cuenta: cuentaArg,
    },
    async run({ estado = 'pend', item_id, mes, buscar, limite = 25, cuenta }, { crm }) {
      const query = crm.conCuenta({ item_id, mes, q: buscar }, cuenta);
      if (estado !== 'todas') query.estado = estado;
      const d = await crm.ml('/preguntas/lista', { query });
      const lista = (d.preguntas || []).slice(0, limite);
      const etiqueta = estado === 'pend' ? 'sin responder' : estado === 'resp' ? 'respondidas' : 'todas';
      return texto([
        encabezado('Preguntas (' + etiqueta + ')', 'mostrando ' + lista.length + ' de ' + (d.total ?? lista.length)),
        tabla(lista, [
          { h: 'ID', get: (r) => r.id },
          { h: 'Fecha', get: (r) => fechaHora(r.fecha) },
          { h: 'Publicación', get: (r) => corto(r.item_titulo || r.item_id, 32) },
          { h: 'Pregunta', get: (r) => corto(r.texto, 70) },
          { h: 'Respuesta', get: (r) => (r.respondida ? corto(r.respuesta, 45) : '—') },
        ]),
        '',
        estado === 'pend' && lista.length
          ? '_Para contestar: `ml_responder_pregunta` con el **ID** de la primera columna._'
          : '',
      ].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'ml_responder_pregunta',
    title: 'Responder una pregunta',
    description: 'Publica la respuesta a una pregunta EN MERCADOLIBRE, visible para todos. Es una escritura real e irreversible: mostrale el texto al usuario y esperá su confirmación antes de ejecutarla. El id es el que devuelve ml_preguntas.',
    readOnly: false,
    destructive: true,
    schema: {
      id: z.number().int().describe('ID interno de la pregunta (columna ID de ml_preguntas).'),
      texto: z.string().min(1).max(2000).describe('Texto de la respuesta, tal como lo van a leer los compradores.'),
    },
    async run({ id, texto: cuerpo }, { crm }) {
      await crm.ml('/preguntas/' + encodeURIComponent(id) + '/responder', { method: 'POST', body: { texto: cuerpo } });
      return texto('✅ Respuesta publicada en la pregunta #' + id + ':\n\n> ' + cuerpo);
    },
  },
  {
    name: 'ml_preguntas_estadisticas',
    title: 'Estadísticas de preguntas',
    description: 'Tasa de respuesta, tiempo promedio de respuesta en minutos, cuántas preguntas terminaron en venta, publicaciones que más preguntas generan y distribución por hora del día. Sirve para dimensionar la atención y decidir horarios de cobertura.',
    readOnly: true,
    schema: {
      dias: z.number().int().min(1).max(180).default(30),
      cuenta: cuentaArg,
    },
    async run({ dias = 30, cuenta }, { crm }) {
      const d = await crm.ml('/preguntas/estadisticas', { query: crm.conCuenta({ dias }, cuenta) });
      return texto([
        encabezado('Preguntas — últimos ' + d.dias + ' días'),
        kv(d, [
          ['Total', (x) => num(x.total)],
          ['Respondidas', (x) => num(x.respondidas)],
          ['Sin responder', (x) => num(x.sin_responder)],
          ['Tasa de respuesta', (x) => pct(x.tasa_respuesta)],
          ['Demora promedio', (x) => num(x.minutos_promedio) + ' min'],
          ['Terminaron en venta', (x) => num(x.convertidas) + ' (' + pct(x.tasa_conversion) + ')'],
        ]),
        '',
        '### Publicaciones con más preguntas',
        tabla(d.top_items || [], [
          { h: 'Publicación', get: (r) => corto(r.item, 55) },
          { h: 'Preguntas', align: 'r', get: (r) => num(r.n) },
        ]),
        '',
        '### Por hora del día',
        (d.por_hora || []).map((h) => String(h.hora).padStart(2, '0') + 'h: ' + h.n).join(' · ') || '_sin datos_',
      ].join('\n'));
    },
  },
  {
    name: 'ml_mensajes',
    title: 'Mensajería post-venta',
    description: 'Mensajes intercambiados con compradores después de la compra, asociados a cada orden. Sirve para detectar reclamos incipientes o pedidos de cambio.',
    readOnly: true,
    schema: { limite: z.number().int().min(1).max(100).default(30), cuenta: cuentaArg },
    async run({ limite = 30, cuenta }, { crm }) {
      const rows = await crm.ml('/mensajes', { query: crm.conCuenta({}, cuenta) });
      return texto([
        encabezado('Mensajes post-venta'),
        tabla((rows || []).slice(0, limite), [
          { h: 'Fecha', get: (r) => fechaHora(r.fecha) },
          { h: 'Orden', get: (r) => r.order_id },
          { h: 'Mensaje', get: (r) => corto(r.texto, 90) },
          { h: 'Leído', get: (r) => (r.leido ? 'sí' : 'no') },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_reclamos',
    title: 'Reclamos y devoluciones',
    description: 'Reclamos abiertos, devoluciones en curso, cuáles afectan la reputación, cuáles tienen plazo de acción vencido y el monto en juego. Es lo primero a mirar cuando la reputación baja.',
    readOnly: true,
    schema: { cuenta: cuentaArg, limite: z.number().int().min(1).max(100).default(30) },
    async run({ cuenta, limite = 30 }, { crm }) {
      const d = await crm.ml('/reclamos', { query: crm.conCuenta({}, cuenta) });
      const s = d.stats || {};
      return texto([
        encabezado('Reclamos' + (d.cuenta ? ' — ' + d.cuenta : ''), d.total + ' en total'),
        d.actualizando ? '> ⏳ Sincronizando con MercadoLibre.' : '',
        kv(s, [
          ['Abiertos', (x) => num(x.abiertos)],
          ['Devoluciones', (x) => num(x.devoluciones)],
          ['Requieren acción', (x) => num(x.accion)],
          ['Monto en juego', (x) => money(x.monto)],
        ]),
        '',
        tabla((d.reclamos || []).slice(0, limite), [
          { h: 'Reclamo', get: (r) => r.id },
          { h: 'Orden', get: (r) => r.order_id },
          { h: 'Tipo', get: (r) => r.tipo },
          { h: 'Estado', get: (r) => r.estado + (r.etapa ? ' / ' + r.etapa : '') },
          { h: 'Razón', get: (r) => corto(r.razon, 32) },
          { h: 'Monto', align: 'r', get: (r) => money(r.monto) },
          { h: 'Reput.', get: (r) => (r.afecta_reputacion ? '⚠️' : '') },
          { h: 'Acción', get: (r) => corto(r.accion, 24) },
        ]),
      ].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'ml_reputacion',
    title: 'Reputación del vendedor',
    description: 'Color de reputación, nivel MercadoLíder, porcentaje de reclamos, cancelaciones y demoras de envío. Usar cuando preguntan por el termómetro o por qué bajó la reputación.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/reputacion', { query: crm.conCuenta({}, cuenta) });
      if (!d) return texto('Todavía no hay datos de reputación sincronizados para esta cuenta.');
      return texto(conCrudo(encabezado('Reputación'), d, { max: 6000 }));
    },
  },
];
