const ADMIN_RE = /observ|coment|nota|descri|texto|titulo|respons|atualiza|autor|usu[aá]rio|formata/i;
const STATUS_RE = /status|situa[cç][aã]o|estado|conclu|baix|encerr/i;
const DATE_RE = /data|prazo|in[ií]cio|fim|abertura|previs[aã]o|baixa|atualiza/i;
const KM_RE = /(^|\b)km($|\b)|quilometr/i;

export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function normalizeKm(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1000) / 1000;
  const text = String(value).trim().replace(/^KM\s*/i, '');
  const plus = text.match(/(-?\d+)\s*\+\s*(\d+(?:[.,]\d+)?)/);
  if (plus) return Number(plus[1]) * 1000 + Number(plus[2].replace(',', '.'));
  const cleaned = text.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : foldText(value);
}

export function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? foldText(text) : parsed.toISOString().slice(0, 10);
}

export function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1e9) / 1e9;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = text.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  return /^-?\d+(?:\.\d+)?%?$/.test(numeric)
    ? Math.round(Number(numeric.replace('%', '')) * (numeric.endsWith('%') ? 0.01 : 1) * 1e9) / 1e9
    : null;
}

export function normalizeValue(value, field = '') {
  if (value === null || value === undefined || value === '') return null;
  if (KM_RE.test(field)) return normalizeKm(value);
  if (DATE_RE.test(field)) return normalizeDate(value);
  const number = normalizeNumber(value);
  if (number !== null) return number;
  return foldText(value);
}

export function fieldKind(field) {
  if (STATUS_RE.test(field)) return 'status';
  if (ADMIN_RE.test(field)) return 'administrative';
  return 'business';
}

export function stableKey(values, fields = []) {
  return values.map((value, index) => String(normalizeValue(value, fields[index] || '') ?? '∅')).join('¦');
}
