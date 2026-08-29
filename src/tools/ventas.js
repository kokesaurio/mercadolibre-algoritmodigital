import { z } from 'zod';
import { texto, tabla, kv, money, num, pct, fecha, fechaHora, corto, encabezado, conCrudo } from '../format.js';

const cuentaArg = z.number().int().optional().describe('ID de la cuenta de MercadoLibre. Omitir para usar la cuenta por defecto / todas.');

export const ventas = [
  {
    name: 'ml_panel',
    title: 'Panel en vivo',
    description: 'Foto del día en MercadoLibre: ventas de hoy, facturación, preguntas sin responder, reclamos abiertos, stock crítico y alertas. Es la herramienta para empezar cuando el usuario pregunta "cómo viene el día" o "cómo está la cuenta".',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/en-vivo', { query: crm.conCuenta({}, cuenta) });
      if (!d || !Object.keys(d).length) return texto('No hay ninguna cuenta de MercadoLibre conectada todavía.');
      const md = [
        encabezado('Panel en vivo' + (d.cuenta ? ' — ' + (d.cuenta.nombre || d.cuenta) : '')),
        '```json',
        JSON.stringify(d, null, 1).slice(0, 6000),
        '```',
      ].join('\n');
      return texto(md);
    },
  },
  {
    name: 'ml_metricas',
    title: 'Métricas de venta (30 días)',
    description: 'Resumen de los últimos 30 días: cantidad de ventas, facturado, neto tras comisiones, ticket promedio, desglose por tipo de envío (full/flex/colecta) y top 12 productos por facturación.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/metricas', { query: crm.conCuenta({}, cuenta) });
      const md = [
        encabezado('Métricas — últimos 30 días'),
        kv(d, [
          ['Ventas', (x) => num(x.ventas)],
          ['Facturado', (x) => money(x.facturado)],
          ['Neto (tras comisiones)', (x) => money(x.neto)],
          ['Ticket promedio', (x) => money(x.ticket)],
          ['Publicaciones con ventas', (x) => num(x.publicaciones_con_ventas)],
        ]),
        '',
        '### Por tipo de envío',
        tabla(d.por_envio || [], [
          { h: 'Tipo', get: (r) => r.tipo },
          { h: 'Ventas', align: 'r', get: (r) => num(r.n) },
          { h: 'Monto', align: 'r', get: (r) => money(r.monto) },
        ]),
        '',
        '### Top productos',
        tabla(d.top_productos || [], [
          { h: 'Producto', get: (r) => corto(r.titulo, 45) },
          { h: 'ID', get: (r) => r.item_id },
          { h: 'U.', align: 'r', get: (r) => num(r.unidades) },
          { h: 'Ventas', align: 'r', get: (r) => num(r.ventas) },
          { h: 'Facturación', align: 'r', get: (r) => money(r.facturacion) },
          { h: 'Full', get: (r) => (r.full ? 'sí' : '') },
        ]),
      ].join('\n');
      return texto(md);
    },
  },
  {
    name: 'ml_ordenes',
    title: 'Órdenes recientes',
    description: 'Últimas ventas con comprador, total, comisión, neto, estado del pago y fecha de acreditación del dinero. Máximo 100 órdenes, de la más reciente a la más vieja.',
    readOnly: true,
    schema: {
      cuenta: cuentaArg,
      limite: z.number().int().min(1).max(100).optional().describe('Cuántas órdenes mostrar (por defecto 25).'),
    },
    async run({ cuenta, limite = 25 }, { crm }) {
      const rows = await crm.ml('/ordenes', { query: crm.conCuenta({}, cuenta) });
      const lista = (rows || []).slice(0, limite);
      const md = [
        encabezado('Órdenes', 'mostrando ' + lista.length + ' de ' + (rows || []).length + ' sincronizadas'),
        tabla(lista, [
          { h: 'Fecha', get: (r) => fechaHora(r.fecha) },
          { h: 'Orden', get: (r) => r.ml_id },
          { h: 'Comprador', get: (r) => corto(r.comprador, 22) },
          { h: 'Total', align: 'r', get: (r) => money(r.total) },
          { h: 'Comisión', align: 'r', get: (r) => money(r.comision) },
          { h: 'Neto', align: 'r', get: (r) => money(r.neto) },
          { h: 'Estado', get: (r) => r.estado },
          { h: 'Pago', get: (r) => r.pago_status || r.estado_pago || '-' },
          { h: 'Acredita', get: (r) => fecha(r.money_release_date) },
        ]),
      ].join('\n');
      return texto(md);
    },
  },
  {
    name: 'ml_caja',
    title: 'Caja y acreditaciones',
    description: 'Dinero de MercadoLibre: modo "dia" = liberado y por entrar de una fecha; modo "rango" = últimos 14 días; modo "proyeccion" = plata que todavía no se acreditó, día por día. Usar cuando preguntan por plata disponible, cuándo cobran o cuánto entra esta semana.',
    readOnly: true,
    schema: {
      modo: z.enum(['dia', 'rango', 'proyeccion']).default('dia').describe('dia | rango (14 días) | proyeccion (lo que falta acreditar)'),
      fecha: z.string().optional().describe('Fecha YYYY-MM-DD, solo para modo "dia". Por defecto hoy.'),
      cuenta: cuentaArg,
    },
    async run({ modo = 'dia', fecha: f, cuenta }, { crm }) {
      const q = crm.conCuenta({}, cuenta);
      if (modo === 'rango') {
        const rows = await crm.ml('/caja-rango', { query: q });
        return texto([
          encabezado('Caja — últimos 14 días'),
          tabla(rows || [], [
            { h: 'Fecha', get: (r) => fecha(r.f) },
            { h: 'Ventas', align: 'r', get: (r) => num(r.ventas) },
            { h: 'Monto', align: 'r', get: (r) => money(r.monto) },
            { h: 'Liberado', get: (r) => (r.algun_liberado ? 'sí' : 'no') },
          ]),
        ].join('\n'));
      }
      if (modo === 'proyeccion') {
        const d = await crm.ml('/proyeccion', { query: q });
        return texto([
          encabezado('Proyección de acreditaciones', 'total por entrar: ' + money(d.total_por_entrar)),
          tabla(d.dias || [], [
            { h: 'Fecha', get: (r) => fecha(r.f) },
            { h: 'Ventas', align: 'r', get: (r) => num(r.ventas) },
            { h: 'Monto', align: 'r', get: (r) => money(r.monto) },
          ]),
        ].join('\n'));
      }
      const d = await crm.ml('/caja', { query: { ...q, fecha: f } });
      return texto([
        encabezado('Caja del ' + fecha(d.fecha)),
        kv(d, [
          ['Ventas que acreditan ese día', (x) => num(x.ventas)],
          ['Monto del día', (x) => money(x.monto)],
          ['Disponible (liberado)', (x) => money(x.disponible)],
          ['Total por entrar', (x) => money(x.por_entrar)],
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_facturacion',
    title: 'Facturación por período',
    description: 'Evolución de facturación y comisiones en los últimos N días, con los totales necesarios para conciliar contra AFIP o para un cierre de mes.',
    readOnly: true,
    schema: {
      dias: z.number().int().min(1).max(365).default(30).describe('Ventana en días (por defecto 30).'),
      cuenta: cuentaArg,
    },
    async run({ dias = 30, cuenta }, { crm }) {
      const d = await crm.ml('/facturacion', { query: crm.conCuenta({ dias }, cuenta) });
      return texto(conCrudo(encabezado('Facturación — últimos ' + dias + ' días'), d, { max: 8000 }));
    },
  },
  {
    name: 'ml_rentabilidad',
    title: 'Rentabilidad real',
    description: 'Margen real después de comisión de ML, costo de envío, costo del producto e impuestos. Modo "periodo" para un rango puntual, modo "mensual" para la serie mes a mes. Es la herramienta correcta cuando preguntan si ganan plata, cuánto margen dejan o qué producto no conviene.',
    readOnly: true,
    schema: {
      modo: z.enum(['periodo', 'mensual']).default('periodo'),
      dias: z.number().int().min(1).max(365).optional().describe('Ventana en días para modo "periodo".'),
      desde: z.string().optional().describe('YYYY-MM-DD (modo periodo).'),
      hasta: z.string().optional().describe('YYYY-MM-DD (modo periodo).'),
      meses: z.number().int().min(1).max(24).optional().describe('Cuántos meses en modo "mensual".'),
      cuenta: cuentaArg,
    },
    async run({ modo = 'periodo', dias, desde, hasta, meses, cuenta }, { crm }) {
      if (modo === 'mensual') {
        const d = await crm.ml('/rentabilidad/mensual', { query: crm.conCuenta({ meses }, cuenta) });
        const md = [
          encabezado('Rentabilidad mensual' + (d.cuenta ? ' — ' + d.cuenta : '')),
          d.sincronizando_costos ? '> ⏳ Faltan sincronizar ' + d.costos_pendientes + ' costos; los números pueden moverse.' : '',
          tabla(d.meses || [], [
            { h: 'Mes', get: (r) => r.mes },
            { h: 'Ventas', align: 'r', get: (r) => num(r.ventas) },
            { h: 'Facturado', align: 'r', get: (r) => money(r.facturado ?? r.total) },
            { h: 'Costos', align: 'r', get: (r) => money(r.costos ?? r.costo) },
            { h: 'Margen', align: 'r', get: (r) => money(r.margen ?? r.ganancia) },
            { h: '%', align: 'r', get: (r) => pct(r.margen_pct ?? r.pct) },
          ]),
        ].filter(Boolean).join('\n');
        return texto(md);
      }
      const d = await crm.ml('/rentabilidad', { query: crm.conCuenta({ dias, desde, hasta }, cuenta) });
      if (!d || !Object.keys(d).length) return texto('No hay cuenta conectada o todavía no hay datos de rentabilidad.');
      const aviso = d.sincronizando_costos ? '> ⏳ Faltan sincronizar ' + d.costos_pendientes + ' costos; los números pueden moverse.\n' : '';
      return texto(conCrudo(encabezado('Rentabilidad', d.rango || d.periodo || '') + '\n' + aviso, d, { max: 9000 }));
    },
  },
  {
    name: 'ml_ventas_geo',
    title: 'Mapa de ventas por provincia',
    description: 'Distribución de las ventas por provincia. Sirve para decidir depósitos, costos de envío o dónde pautar.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/mapa-ventas', { query: crm.conCuenta({}, cuenta) });
      return texto([
        encabezado('Ventas por provincia', 'total: ' + num(d.total)),
        tabla(d.provincias || [], [
          { h: 'Provincia', get: (r) => r.provincia || r.nombre || '-' },
          { h: 'Ventas', align: 'r', get: (r) => num(r.n ?? r.ventas) },
          { h: 'Monto', align: 'r', get: (r) => money(r.monto) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_embudo',
    title: 'Embudo visitas → ventas',
    description: 'Cuántas visitas, preguntas y ventas genera cada publicación, para detectar dónde se cae la conversión.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/embudo', { query: crm.conCuenta({}, cuenta) });
      const items = d.items || d || [];
      return texto([
        encabezado('Embudo visitas → ventas'),
        tabla(items.slice(0, 40), [
          { h: 'Publicación', get: (r) => corto(r.titulo, 42) },
          { h: 'Visitas', align: 'r', get: (r) => num(r.visitas) },
          { h: 'Preguntas', align: 'r', get: (r) => num(r.preguntas) },
          { h: 'Ventas', align: 'r', get: (r) => num(r.ventas) },
          { h: 'Conv.', align: 'r', get: (r) => pct(r.conversion) },
        ]),
      ].join('\n'));
    },
  },
];
