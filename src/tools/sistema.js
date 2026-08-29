import { z } from 'zod';
import { texto, tabla, kv, num, fecha, encabezado } from '../format.js';

export const sistema = [
  {
    name: 'ml_cuentas',
    title: 'Cuentas conectadas',
    description: 'Lista las cuentas de MercadoLibre vinculadas y el estado de la conexión (app configurada, cuentas activas, webhook). Usar al principio cuando hay más de una cuenta, para saber qué ID pasar en el parámetro "cuenta" del resto de las herramientas.',
    readOnly: true,
    schema: {},
    async run(_args, { crm }) {
      const [cuentas, status] = await Promise.all([
        crm.ml('/cuentas').catch(() => []),
        crm.ml('/status').catch(() => ({})),
      ]);
      return texto([
        encabezado('Cuentas de MercadoLibre'),
        kv(status, [
          ['App configurada', (x) => (x.app_id_set && x.secret_set ? 'sí' : 'no')],
          ['Conectado', (x) => (x.conectado ? 'sí' : 'no')],
          ['Cuentas activas', (x) => num(x.cuentas)],
        ]),
        '',
        tabla(cuentas || [], [
          { h: 'ID', get: (r) => r.id },
          { h: 'Nombre', get: (r) => r.nombre },
          { h: 'User ID ML', get: (r) => r.user_id },
          { h: 'Activa', get: (r) => (r.activa ? 'sí' : 'no') },
          { h: 'Desde', get: (r) => fecha(r.creado_en) },
        ]),
      ].join('\n'));
    },
  },
  {
    name: 'ml_sincronizar',
    title: 'Sincronizar con MercadoLibre',
    description: 'Fuerza una sincronización de órdenes, publicaciones y preguntas contra la API de MercadoLibre. Puede tardar. Usar solo si el usuario dice que faltan datos recientes; el sistema ya sincroniza solo.',
    readOnly: false,
    schema: {},
    async run(_args, { crm }) {
      const d = await crm.ml('/sync', { method: 'POST' });
      const detalle = Object.entries(d)
        .filter(([k]) => k !== 'ok')
        .map(([k, v]) => '- **' + k + ':** ' + (typeof v === 'object' ? JSON.stringify(v) : v))
        .join('\n');
      return texto('✅ Sincronización disparada.\n\n' + (detalle || '_sin detalle_'));
    },
  },
];
