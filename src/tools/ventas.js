import { z } from 'zod';
import { texto, tabla, kv, money, num, pct, fecha, fechaHora, corto, encabezado, conCrudo } from '../format.js';

const cuentaArg = z.number().int().optional().describe('ID de la cuenta de MercadoLibre. Omitir para usar la cuenta por defecto / todas.');

export const ventas = [
  {
    name: 'ml_panel',
    title: 'Resumen consolidado del dia',
    description: 'La foto del dia SUMANDO TODAS las tiendas conectadas: ventas de hoy, facturacion, unidades, comparacion contra ayer a la misma hora, desglose tienda por tienda y las ultimas ventas. Es la herramienta para empezar cuando el usuario pregunta "como viene el dia", "como va todo" o "como estan las tiendas". Si le pasas una cuenta, muestra solo esa.',
    readOnly: true,
    schema: {
      cuenta: z.number().int().optional().describe('ID de una tienda puntual. Omitir para el consolidado de todas.'),
    },
    async run({ cuenta }, { crm }) {
      // Una sola tienda: sin consolidar.
      if (cuenta || crm.cuenta) {
        const d = await crm.ml('/en-vivo', { query: { cuenta: cuenta ?? crm.cuenta } });
        if (!d || !d.hoy) return texto('No hay datos para esa tienda.');
        return texto(panelUna(d));
      }

      const cuentas = (await crm.ml('/cuentas').catch(() => [])).filter((c) => c.activa);
      if (!cuentas.length) return texto('No hay ninguna tienda de MercadoLibre conectada todavia. Usa `ml_conectar` para vincular la primera.');

      const datos = await Promise.all(cuentas.map(async (c) => {
        try {
          const d = await crm.ml('/en-vivo', { query: { cuenta: c.id } });
          return d && d.hoy ? { c, d } : null;
        } catch { return null; }
      }));
      const ok = datos.filter(Boolean);
      if (!ok.length) return texto('Hay tiendas conectadas pero ninguna devolvio datos todavia.');
      if (ok.length === 1) return texto(panelUna(ok[0].d));

      const sum = (sel) => ok.reduce((a, x) => a + (Number(sel(x.d)) || 0), 0);
      const hoyV = sum((d) => d.hoy.ventas);
      const hoyF = sum((d) => d.hoy.facturacion);
      const hoyU = sum((d) => d.hoy.unidades);
      const ayerV = sum((d) => (d.ayer_hasta_ahora || {}).ventas);
      const ayerF = sum((d) => (d.ayer_hasta_ahora || {}).facturacion);
      const ayerTotF = sum((d) => d.ayer.facturacion);
      const hora = ok[0].d.hora;

      // Curva horaria consolidada.
      const horas = new Map();
      for (const { d } of ok) {
        for (const h of d.por_hora || []) {
          const prev = horas.get(h.h) || { ventas: 0, monto: 0 };
          horas.set(h.h, { ventas: prev.ventas + (h.ventas || 0), monto: prev.monto + (Number(h.monto) || 0) });
        }
      }
      const curva = [...horas.entries()].sort((a, b) => a[0] - b[0])
        .map(([h, v]) => String(h).padStart(2, '0') + 'h ' + v.ventas).join(' · ');

      // Ultimas ventas de todas las tiendas, mezcladas por fecha.
      const ultimas = ok.flatMap(({ c, d }) => (d.ultimas || []).map((u) => ({ ...u, tienda: c.nombre || d.cuenta || ('#' + c.id) })))
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 12);

      return texto([
        encabezado('Resumen del dia — ' + ok.length + ' tiendas', 'consolidado, ' + String(hora).padStart(2, '0') + ' hs'),
        kv({}, [
          ['Ventas hoy', () => num(hoyV) + delta(hoyV, ayerV)],
          ['Facturacion hoy', () => money(hoyF) + delta(hoyF, ayerF)],
          ['Unidades hoy', () => num(hoyU)],
          ['Ayer a esta hora', () => num(ayerV) + ' ventas · ' + money(ayerF)],
          ['Ayer cerro en', () => money(ayerTotF)],
        ]),
        '',
        '### Por tienda',
        tabla(ok, [
          { h: 'Tienda', get: (x) => corto(x.c.nombre || x.d.cuenta || ('#' + x.c.id), 24) },
          { h: 'Ventas', align: 'r', get: (x) => num(x.d.hoy.ventas) },
          { h: 'Facturacion', align: 'r', get: (x) => money(x.d.hoy.facturacion) },
          { h: 'Unidades', align: 'r', get: (x) => num(x.d.hoy.unidades) },
          { h: 'vs ayer', align: 'r', get: (x) => deltaCorto(x.d.hoy.facturacion, (x.d.ayer_hasta_ahora || {}).facturacion) },
          { h: '% del total', align: 'r', get: (x) => (hoyF > 0 ? Math.round((Number(x.d.hoy.facturacion) / hoyF) * 100) + '%' : '-') },
        ]),
        '',
        '### Ventas por hora (todas las tiendas)',
        curva || '_sin ventas todavia_',
        '',
        '### Ultimas ventas',
        tabla(ultimas, [
          { h: 'Hora', get: (u) => fechaHora(u.fecha) },
          { h: 'Tienda', get: (u) => corto(u.tienda, 16) },
          { h: 'Producto', get: (u) => corto(u.titulo, 40) },
          { h: 'Total', align: 'r', get: (u) => money(u.total) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_metricas',
    title: 'Métricas de venta (30 días)',
    description: 'Resumen de los ultimos 30 dias SUMANDO TODAS las tiendas: cantidad de ventas, facturado, neto tras comisiones, ticket promedio, aporte de cada tienda al total, desglose por tipo de envio (full/flex/colecta) y top 12 productos por facturacion. Si le pasas una cuenta, muestra solo esa.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const filtro = cuenta ?? crm.cuenta ?? null;
      const d = await crm.ml('/metricas', { query: filtro ? { cuenta: filtro } : {} });

      // Sin filtro, el backend ya suma todas las tiendas: agregamos el aporte de cada una.
      let porTienda = '';
      if (!filtro) {
        const cuentas = (await crm.ml('/cuentas').catch(() => [])).filter((c) => c.activa);
        if (cuentas.length > 1) {
          const filas = (await Promise.all(cuentas.map(async (c) => {
            try { return { c, m: await crm.ml('/metricas', { query: { cuenta: c.id } }) }; }
            catch { return null; }
          }))).filter(Boolean);
          const totF = Number(d.facturado) || 0;
          porTienda = [
            '',
            '### Por tienda',
            tabla(filas, [
              { h: 'Tienda', get: (x) => corto(x.c.nombre || ('#' + x.c.id), 24) },
              { h: 'Ventas', align: 'r', get: (x) => num(x.m.ventas) },
              { h: 'Facturado', align: 'r', get: (x) => money(x.m.facturado) },
              { h: 'Neto', align: 'r', get: (x) => money(x.m.neto) },
              { h: 'Ticket', align: 'r', get: (x) => money(x.m.ticket) },
              { h: '% del total', align: 'r', get: (x) => (totF > 0 ? Math.round((Number(x.m.facturado) / totF) * 100) + '%' : '-') },
            ]),
          ].join('\n');
        }
      }

      const md = [
        encabezado('Metricas — ultimos 30 dias', filtro ? 'una tienda' : 'consolidado de todas las tiendas'),
        kv(d, [
          ['Ventas', (x) => num(x.ventas)],
          ['Facturado', (x) => money(x.facturado)],
          ['Neto (tras comisiones)', (x) => money(x.neto)],
          ['Ticket promedio', (x) => money(x.ticket)],
          ['Publicaciones con ventas', (x) => num(x.publicaciones_con_ventas)],
        ]),
        porTienda,
        '',
        '### Por tipo de envio',
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

/** Variacion porcentual pelada, para columnas de tabla. */
function deltaCorto(hoy, ayer) {
  const a = Number(ayer) || 0;
  const h = Number(hoy) || 0;
  if (!a) return h ? 'nuevo' : '-';
  const p = Math.round(((h - a) / a) * 100);
  return (p > 0 ? '+' : '') + p + '%';
}

/** Variacion contra el mismo momento de ayer, en texto corto. */
function delta(hoy, ayer) {
  const a = Number(ayer) || 0;
  const h = Number(hoy) || 0;
  if (!a) return h ? ' (ayer 0)' : '';
  const p = Math.round(((h - a) / a) * 100);
  if (p === 0) return ' (igual que ayer)';
  return ' (' + (p > 0 ? '+' : '') + p + '% vs ayer)';
}

/** Panel de una sola tienda. */
function panelUna(d) {
  const ah = d.ayer_hasta_ahora || {};
  return [
    encabezado('Resumen del dia' + (d.cuenta ? ' — ' + d.cuenta : ''), String(d.hora).padStart(2, '0') + ' hs'),
    kv(d, [
      ['Ventas hoy', (x) => num(x.hoy.ventas) + delta(x.hoy.ventas, ah.ventas)],
      ['Facturacion hoy', (x) => money(x.hoy.facturacion) + delta(x.hoy.facturacion, ah.facturacion)],
      ['Unidades hoy', (x) => num(x.hoy.unidades)],
      ['Ayer a esta hora', () => num(ah.ventas) + ' ventas · ' + money(ah.facturacion)],
      ['Ayer cerro en', (x) => money(x.ayer.facturacion)],
    ]),
    '',
    '### Ventas por hora',
    (d.por_hora || []).map((h) => String(h.h).padStart(2, '0') + 'h ' + h.ventas).join(' · ') || '_sin ventas todavia_',
    '',
    '### Ultimas ventas',
    tabla(d.ultimas || [], [
      { h: 'Hora', get: (u) => fechaHora(u.fecha) },
      { h: 'Producto', get: (u) => corto(u.titulo, 45) },
      { h: 'Comprador', get: (u) => corto(u.comprador, 20) },
      { h: 'Total', align: 'r', get: (u) => money(u.total) },
    ]),
  ].join('\n');
}
