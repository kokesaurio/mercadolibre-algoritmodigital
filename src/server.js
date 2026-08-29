import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS } from './tools/index.js';
import { CrmError, CrmClient } from './client.js';
import { error } from './format.js';

export const INSTRUCCIONES = [
  'Conector de MercadoLibre de Algoritmo Digital.',
  '',
  'Los datos salen del CRM del vendedor, que sincroniza contra la API oficial de MercadoLibre.',
  'Guía rápida:',
  '- Empezá por `ml_panel` cuando la pregunta es general ("cómo viene el día", "cómo va la cuenta").',
  '- Si hay varias cuentas vinculadas, resolvé el ID con `ml_cuentas` antes de filtrar.',
  '- Para plata: `ml_caja` (disponible / por acreditar) y `ml_rentabilidad` (margen real).',
  '- Para "por qué no vendo": `ml_rendimiento_publicaciones`, `ml_competitividad` y `ml_salud_publicaciones`.',
  '- `ml_actualizar_publicacion`, `ml_responder_pregunta` y `ml_sincronizar` escriben de verdad en MercadoLibre:',
  '  mostrale al usuario exactamente qué vas a hacer y esperá confirmación explícita antes de llamarlas.',
  '- Los importes están en pesos argentinos y las fechas en zona horaria de Argentina.',
].join('\n');

/**
 * Construye un McpServer con todas las herramientas registradas.
 * @param {object} opts
 * @param {CrmClient} opts.crm
 * @param {boolean} [opts.allowWrite]
 */
export function crearServidor({ crm, allowWrite = true }) {
  const server = new McpServer(
    { name: 'mercadolibre-algoritmodigital', version: '1.0.0' },
    { instructions: INSTRUCCIONES }
  );

  for (const tool of TOOLS) {
    if (!tool.readOnly && !allowWrite) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: !!tool.readOnly,
          destructiveHint: !!tool.destructive,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          return await tool.run(args || {}, { crm });
        } catch (e) {
          if (e instanceof CrmError) {
            if (e.status === 401) return error('El CRM rechazó las credenciales. Revisá el token o volvé a iniciar sesión en el conector.');
            if (e.status === 404) return error('El backend no tiene ese recurso (' + tool.name + '). Puede que la versión del CRM sea anterior.');
            if (e.status === 0) return error(e.message);
            return error('El CRM respondió con un error: ' + e.message);
          }
          return error('Falló ' + tool.name + ': ' + (e?.message || String(e)));
        }
      }
    );
  }

  return server;
}

export { CrmClient };
