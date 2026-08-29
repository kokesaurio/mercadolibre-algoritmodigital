import { z } from 'zod';
import { texto, tabla, kv, money, num, pct, corto, encabezado, conCrudo } from '../format.js';

const cuentaArg = z.number().int().optional().describe('ID de la cuenta de MercadoLibre. Omitir para la cuenta por defecto.');

export const publicaciones = [
  {
    name: 'ml_publicaciones',
    title: 'Listar publicaciones',
    description: 'Publicaciones sincronizadas con título, precio, stock, vendidos, estado y link. Acepta un filtro de texto para buscar por título o MLA.',
    readOnly: true,
    schema: {
      buscar: z.string().optional().describe('Filtra por título o ID (MLA...).'),
      limite: z.number().int().min(1).max(200).default(40),
      cuenta: cuentaArg,
    },
    async run({ buscar, limite = 40, cuenta }, { crm }) {
      const rows = await crm.ml('/items', { query: crm.conCuenta({}, cuenta) });
      let lista = rows || [];
      if (buscar) {
        const q = buscar.toLowerCase();
        lista = lista.filter((r) => String(r.titulo || '').toLowerCase().includes(q) || String(r.ml_id || '').toLowerCase().includes(q));
      }
      const total = lista.length;
      lista = lista.slice(0, limite);
      return texto([
        encabezado('Publicaciones', 'mostrando ' + lista.length + ' de ' + total),
        tabla(lista, [
          { h: 'ID', get: (r) => r.ml_id },
          { h: 'Título', get: (r) => corto(r.titulo, 48) },
          { h: 'Precio', align: 'r', get: (r) => money(r.precio) },
          { h: 'Stock', align: 'r', get: (r) => num(r.stock) },
          { h: 'Vendidos', align: 'r', get: (r) => num(r.vendidos) },
          { h: 'Estado', get: (r) => r.estado },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_actualizar_publicacion',
    title: 'Actualizar publicación',
    description: 'Modifica precio, stock, título o estado (active/paused) de una publicación EN MERCADOLIBRE. Es una escritura real y visible para los compradores: confirmá con el usuario antes de ejecutarla.',
    readOnly: false,
    destructive: true,
    schema: {
      item_id: z.string().describe('ID de la publicación, ej. MLA123456789.'),
      precio: z.number().positive().optional(),
      stock: z.number().int().min(0).optional().describe('Cantidad disponible.'),
      titulo: z.string().min(3).optional(),
      estado: z.enum(['active', 'paused', 'closed']).optional(),
    },
    async run({ item_id, precio, stock, titulo, estado }, { crm }) {
      const body = {};
      if (precio != null) body.price = precio;
      if (stock != null) body.available_quantity = stock;
      if (titulo) body.title = titulo;
      if (estado) body.status = estado;
      if (!Object.keys(body).length) return texto('No indicaste ningún campo para modificar.');
      await crm.ml('/items/' + encodeURIComponent(item_id), { method: 'PUT', body });
      const cambios = Object.entries(body).map(([k, v]) => '`' + k + '` → ' + v).join(', ');
      return texto('✅ Publicación **' + item_id + '** actualizada en MercadoLibre: ' + cambios + '.');
    },
  },
  {
    name: 'ml_stock',
    title: 'Stock y quiebres',
    description: 'Modo "bajo": publicaciones con stock por debajo de un umbral. Modo "full": panorama de stock en Fulfillment con días de cobertura y riesgo de quiebre. Usar cuando preguntan qué se va a quedar sin stock o qué reponer.',
    readOnly: true,
    schema: {
      modo: z.enum(['bajo', 'full']).default('bajo'),
      maximo: z.number().int().min(0).max(100).default(5).describe('Umbral de stock para modo "bajo".'),
      cuenta: cuentaArg,
    },
    async run({ modo = 'bajo', maximo = 5, cuenta }, { crm }) {
      if (modo === 'full') {
        const d = await crm.ml('/stock-quiebre', { query: crm.conCuenta({}, cuenta) });
        const aviso = d.actualizando ? '> ⏳ Sincronizando con MercadoLibre, los datos pueden estar incompletos.\n' : '';
        return texto([
          encabezado('Stock Fulfillment' + (d.cuenta ? ' — ' + d.cuenta : '')),
          aviso,
          d.stats ? kv(d.stats, Object.keys(d.stats).map((k) => [k, k])) : '',
          '',
          tabla((d.rows || []).slice(0, 50), [
            { h: 'ID', get: (r) => r.ml_id || r.item_id },
            { h: 'Título', get: (r) => corto(r.titulo, 40) },
            { h: 'Stock', align: 'r', get: (r) => num(r.stock ?? r.disponible) },
            { h: 'Días cob.', align: 'r', get: (r) => num(r.dias_cobertura ?? r.dias) },
            { h: 'Riesgo', get: (r) => r.riesgo || r.estado || '-' },
          ]),
        ].filter(Boolean).join('\n'));
      }
      const rows = await crm.ml('/quiebre', { query: crm.conCuenta({ max: maximo }, cuenta) });
      return texto([
        encabezado('Publicaciones con stock ≤ ' + maximo, (rows || []).length + ' publicaciones'),
        tabla(rows || [], [
          { h: 'ID', get: (r) => r.ml_id },
          { h: 'Título', get: (r) => corto(r.titulo, 48) },
          { h: 'Stock', align: 'r', get: (r) => num(r.stock) },
          { h: 'Precio', align: 'r', get: (r) => money(r.precio) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_salud_publicaciones',
    title: 'Salud de publicaciones',
    description: 'Puntaje de calidad por publicación según MercadoLibre (fotos, ficha técnica, descripción, garantía) y las tareas concretas para subirlo. Usar cuando preguntan cómo mejorar el posicionamiento o por qué una publicación no vende.',
    readOnly: true,
    schema: { cuenta: cuentaArg, limite: z.number().int().min(1).max(100).default(30) },
    async run({ cuenta, limite = 30 }, { crm }) {
      const d = await crm.ml('/salud', { query: crm.conCuenta({}, cuenta) });
      const s = d.stats || {};
      return texto([
        encabezado('Salud de publicaciones' + (d.cuenta ? ' — ' + d.cuenta : '')),
        d.actualizando ? '> ⏳ Análisis en curso.' : '',
        kv(s, [
          ['Promedio', (x) => (x.promedio != null ? x.promedio : '-')],
          ['Analizadas', (x) => num(x.total)],
          ['Con problemas', (x) => num(x.con_problemas)],
          ['Buenas', (x) => num(x.buenas)],
        ]),
        '',
        tabla((d.rows || []).slice(0, limite), [
          { h: 'ID', get: (r) => r.ml_id || r.item_id },
          { h: 'Título', get: (r) => corto(r.titulo, 40) },
          { h: 'Puntaje', align: 'r', get: (r) => r.puntaje ?? r.score ?? '-' },
          { h: 'Problemas', get: (r) => corto((r.problemas || r.tareas || []).join?.(', ') || r.detalle || '', 55) },
        ]),
      ].filter(Boolean).join('\n'));
    },
  },
  {
    name: 'ml_rendimiento_publicaciones',
    title: 'Visitas y conversión por publicación',
    description: 'Cruce de visitas contra ventas de los últimos 30 días con la tasa de conversión de cada publicación. Detecta las que reciben tráfico pero no venden.',
    readOnly: true,
    schema: { cuenta: cuentaArg, limite: z.number().int().min(1).max(100).default(30) },
    async run({ cuenta, limite = 30 }, { crm }) {
      const rows = await crm.ml('/analisis', { query: crm.conCuenta({}, cuenta) });
      return texto([
        encabezado('Visitas y conversión — 30 días'),
        tabla((rows || []).slice(0, limite), [
          { h: 'ID', get: (r) => r.ml_id },
          { h: 'Título', get: (r) => corto(r.titulo, 40) },
          { h: 'Visitas', align: 'r', get: (r) => num(r.visitas) },
          { h: 'Ventas', align: 'r', get: (r) => num(r.ventas) },
          { h: 'Unid.', align: 'r', get: (r) => num(r.unidades) },
          { h: 'Conv.', align: 'r', get: (r) => pct(r.conversion) },
          { h: 'Stock', align: 'r', get: (r) => num(r.stock) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_visitas',
    title: 'Historial de visitas',
    description: 'Serie de visitas por publicación en el tiempo, para ver si el tráfico sube o baja.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/visitas', { query: crm.conCuenta({}, cuenta) });
      return texto(conCrudo(encabezado('Historial de visitas'), d, { max: 9000 }));
    },
  },
  {
    name: 'ml_costos_publicaciones',
    title: 'Costos por publicación',
    description: 'Comisión y costo de envío que cobra MercadoLibre por cada publicación, agrupado por categoría. Sirve para saber cuánto se lleva ML de cada venta antes de fijar precio.',
    readOnly: true,
    schema: { cuenta: cuentaArg },
    async run({ cuenta }, { crm }) {
      const d = await crm.ml('/publicaciones-costos', { query: crm.conCuenta({}, cuenta) });
      return texto(conCrudo(
        encabezado('Costos por publicación' + (d.cuenta ? ' — ' + d.cuenta : '')) +
          (d.actualizando ? '\n> ⏳ Sincronizando.' : ''),
        d, { max: 9000 }
      ));
    },
  },
  {
    name: 'ml_simular_precios',
    title: 'Simular cambio de precios',
    description: 'Aplica las reglas de precio configuradas (porcentaje o monto fijo) sobre el catálogo y devuelve el precio nuevo y el delta de cada publicación, SIN tocar nada en MercadoLibre. Es una simulación.',
    readOnly: true,
    schema: { cuenta: cuentaArg, limite: z.number().int().min(1).max(200).default(40) },
    async run({ cuenta, limite = 40 }, { crm }) {
      const d = await crm.ml('/precios/simular', { query: crm.conCuenta({}, cuenta) });
      const reglas = (d.reglas || []).map((r) => r.tipo + ' ' + r.valor).join(' → ') || 'sin reglas configuradas';
      return texto([
        encabezado('Simulación de precios', 'reglas: ' + reglas),
        tabla((d.items || []).slice(0, limite), [
          { h: 'ID', get: (r) => r.ml_id },
          { h: 'Título', get: (r) => corto(r.titulo, 42) },
          { h: 'Actual', align: 'r', get: (r) => money(r.precio) },
          { h: 'Nuevo', align: 'r', get: (r) => money(r.precio_nuevo) },
          { h: 'Δ', align: 'r', get: (r) => money(r.delta) },
        ]),
        '',
        '_Esto no modifica nada en MercadoLibre. Para aplicar un cambio usá `ml_actualizar_publicacion`._',
      ].join('\n'));
    },
  },
];
