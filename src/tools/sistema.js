import { z } from 'zod';
import { texto, tabla, kv, num, fecha, corto, encabezado } from '../format.js';

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
    name: 'ml_conectar',
    title: 'Conectar una tienda de MercadoLibre',
    description: 'Genera el link de autorizacion para vincular una cuenta de MercadoLibre nueva, y muestra el estado de las que ya estan conectadas. Usar cuando el usuario dice "quiero conectar mi tienda", "agregar otra cuenta", "vincular MercadoLibre" o cuando alguna herramienta falla porque no hay cuentas. Devuelve un link que el usuario abre en el navegador: no autoriza nada por su cuenta.',
    readOnly: true,
    schema: {
      diagnostico: z.boolean().optional().describe('true para revisar la configuracion en detalle cuando algo no funciona.'),
    },
    async run({ diagnostico }, { crm }) {
      const [status, cuentas] = await Promise.all([
        crm.ml('/status').catch(() => ({})),
        crm.ml('/cuentas').catch(() => []),
      ]);
      const activas = (cuentas || []).filter((c) => c.activa);
      const partes = [encabezado('Conectar MercadoLibre')];

      if (activas.length) {
        partes.push('Tiendas ya conectadas:', '');
        partes.push(tabla(activas, [
          { h: 'ID', get: (r) => r.id },
          { h: 'Tienda', get: (r) => r.nombre },
          { h: 'User ID ML', get: (r) => r.user_id },
          { h: 'Desde', get: (r) => fecha(r.creado_en) },
        ]));
        partes.push('');
      } else {
        partes.push('Todavia no hay ninguna tienda conectada.', '');
      }

      if (!status.app_id_set || !status.secret_set) {
        partes.push(
          '⚠️ Falta configurar la aplicacion de MercadoLibre (App ID y Secret) en el panel,',
          'en la seccion Conexion. Sin eso no se puede generar el link de autorizacion.'
        );
        return texto(partes.join('\n'));
      }

      try {
        const { url } = await crm.ml('/connect');
        partes.push(
          '### Conectar una tienda nueva',
          '',
          '**[→ Autorizar MercadoLibre](' + url + ')**',
          '',
          'Abri ese link, inicia sesion con la cuenta que quieras vincular y aceptá los permisos.',
          'Tiene que ser una cuenta **manager** o administradora de la tienda.',
          'Al volver, la tienda ya aparece en `ml_cuentas` y suma al resumen consolidado.'
        );
      } catch (e) {
        partes.push('⚠️ No se pudo generar el link: ' + e.message);
      }

      if (diagnostico) {
        const d = await crm.ml('/diagnostico').catch(() => null);
        if (d) {
          partes.push('', '### Diagnostico (' + d.ok + '/' + d.total + ')', '');
          partes.push(tabla(d.checks || [], [
            { h: '', get: (c) => (c.ok ? '✅' : '❌') },
            { h: 'Punto', get: (c) => c.titulo },
            { h: 'Detalle', get: (c) => corto(c.detalle, 60) },
            { h: 'Que hacer', get: (c) => corto(c.arreglo, 60) },
          ]));
        }
      }

      partes.push(
        '',
        '---',
        '_Otros canales: este conector cubre MercadoLibre. WooCommerce esta integrado en el',
        'panel pero todavia no expuesto por MCP; Tiendanube aun no tiene integracion._'
      );
      return texto(partes.join('\n'));
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
