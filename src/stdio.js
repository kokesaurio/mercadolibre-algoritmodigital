#!/usr/bin/env node
// Transporte stdio: para usar el conector localmente desde Claude Desktop o Claude Code.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { crearServidor } from './server.js';
import { CrmClient } from './client.js';

const env = process.env;

function fatal(msg) {
  // stdout es el canal del protocolo: los errores van SIEMPRE a stderr.
  process.stderr.write('[mcp-mercadolibre] ' + msg + '\n');
  process.exit(1);
}

const baseUrl = env.CRM_BASE_URL;
if (!baseUrl) {
  fatal('Falta CRM_BASE_URL: la URL del backend contra el que corre este conector.');
}
if (!env.CRM_TOKEN && !(env.CRM_USERNAME && env.CRM_PASSWORD)) {
  fatal('Faltan credenciales. Defini CRM_TOKEN, o CRM_USERNAME y CRM_PASSWORD.');
}

const crm = new CrmClient({
  baseUrl,
  token: env.CRM_TOKEN,
  username: env.CRM_USERNAME,
  password: env.CRM_PASSWORD,
  cuenta: env.ML_CUENTA,
});

const server = crearServidor({ crm, allowWrite: env.ALLOW_WRITE !== '0' });

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('[mcp-mercadolibre] conectado a ' + baseUrl + '\n');
