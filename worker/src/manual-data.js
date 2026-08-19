import { AppError } from './errors.js';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new AppError(message, 422, 'INVALID_MANUAL_DATA');
}

// Dados que a base bruta (EAP) não contém e continuam editados à mão pela página:
// cabeçalho do painel, mobilização por pacote, cenários de projeção e alertas.
export function validateManualData(data) {
  if (!isPlainObject(data)) fail('Dados manuais inválidos: corpo precisa ser um objeto.');
  const { meta, pacotes, cenarios, alertas } = data;

  if (!isPlainObject(meta)) fail('Campo "meta" ausente ou inválido.');
  if (!Array.isArray(pacotes)) fail('Campo "pacotes" ausente ou inválido.');
  if (!Array.isArray(cenarios)) fail('Campo "cenarios" ausente ou inválido.');
  if (!Array.isArray(alertas)) fail('Campo "alertas" ausente ou inválido.');

  pacotes.forEach((row, index) => {
    if (!isPlainObject(row) || !row.PACOTE || !row.EMPRESA) {
      fail(`Item ${index + 1} de "pacotes" precisa ter PACOTE e EMPRESA.`);
    }
  });
  cenarios.forEach((row, index) => {
    if (!isPlainObject(row) || !row.PACOTE) {
      fail(`Item ${index + 1} de "cenarios" precisa ter PACOTE.`);
    }
  });
  alertas.forEach((row, index) => {
    if (!isPlainObject(row) || !row.PACOTE || !row.TITULO) {
      fail(`Item ${index + 1} de "alertas" precisa ter PACOTE e TITULO.`);
    }
  });

  return { meta, pacotes, cenarios, alertas };
}
