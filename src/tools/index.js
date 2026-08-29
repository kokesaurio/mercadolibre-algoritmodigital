import { ventas } from './ventas.js';
import { publicaciones } from './publicaciones.js';
import { preguntas } from './preguntas.js';
import { mercado } from './mercado.js';
import { sistema } from './sistema.js';

export const TOOLS = [...sistema, ...ventas, ...publicaciones, ...preguntas, ...mercado];

export const TOOLS_LECTURA = TOOLS.filter((t) => t.readOnly);
export const TOOLS_ESCRITURA = TOOLS.filter((t) => !t.readOnly);
