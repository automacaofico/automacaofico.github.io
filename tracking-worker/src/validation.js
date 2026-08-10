const EQUIPMENT_ID = /^(?:LOCO00[1-7]|EGPS00[1-3]|EGPR00[1-3]|NTC001)$/;

export function validatePosition(value) {
  if (!value || typeof value !== 'object') return 'Posição inválida.';
  if (!EQUIPMENT_ID.test(String(value.equipmentId || ''))) return 'Equipamento inválido.';
  const lat = Number(value.latitude);
  const lon = Number(value.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude inválida.';
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'Longitude inválida.';
  const captured = Date.parse(value.capturedAt);
  if (!Number.isFinite(captured)) return 'Data de captura inválida.';
  const drift = Math.abs(Date.now() - captured);
  if (drift > 8 * 24 * 60 * 60 * 1000) return 'Data de captura fora da janela permitida.';
  if (value.accuracyM != null && (!Number.isFinite(Number(value.accuracyM)) || Number(value.accuracyM) < 0 || Number(value.accuracyM) > 5000)) return 'Precisão inválida.';
  if (value.batteryPct != null && (!Number.isInteger(Number(value.batteryPct)) || Number(value.batteryPct) < 0 || Number(value.batteryPct) > 100)) return 'Bateria inválida.';
  return null;
}

export function normalizePosition(value, receivedAt) {
  const optional = (key) => value[key] == null ? null : Number(value[key]);
  return {
    equipmentId: String(value.equipmentId),
    capturedAt: new Date(value.capturedAt).toISOString(),
    receivedAt,
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    accuracyM: optional('accuracyM'),
    speedMps: optional('speedMps'),
    bearingDeg: optional('bearingDeg'),
    altitudeM: optional('altitudeM'),
    batteryPct: optional('batteryPct'),
    sequenceNo: optional('sequenceNo')
  };
}

export function publicEquipmentId(value) {
  return EQUIPMENT_ID.test(String(value || '')) ? String(value) : null;
}
