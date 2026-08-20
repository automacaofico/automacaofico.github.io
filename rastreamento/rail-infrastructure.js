export const LINE_LABELS = {
  line01: 'Linha 01',
  line02: 'Linha 02',
  south_loop: 'Alça Sul',
  line_egp: 'Linha EGP',
  welding_yard: 'Estaleiro de Solda'
};

export const DOUBLE_TRACKS = [
  { id: 'patio01', name: 'Pátio 01', kind: 'yard', start: 3880, end: 6929, provisional: false },
  { id: 'patio03', name: 'Pátio 03', kind: 'yard', start: 32182, end: 34217, provisional: false },
  { id: 'dto02', name: 'DTO 02', kind: 'dto', start: 47902, end: 48502, provisional: true },
  { id: 'patio05', name: 'Pátio 05', kind: 'yard', start: 59878, end: 61914, provisional: false },
  { id: 'dto03', name: 'DTO 03', kind: 'dto', start: 72242, end: 72842, provisional: true },
  { id: 'patio07', name: 'Pátio 07', kind: 'yard', start: 84222, end: 86207, provisional: false },
  { id: 'dto04', name: 'DTO 04', kind: 'dto', start: 101202, end: 101802, provisional: true },
  { id: 'patio09', name: 'Pátio 09', kind: 'yard', start: 110662, end: 112737, provisional: false },
  { id: 'dto05', name: 'DTO 05', kind: 'dto', start: 120192, end: 120792, provisional: true }
];

export const SPECIAL_TRACKS = [
  { id: 'south_loop', name: 'Alça Sul', start: 0, end: 2734, offsetM: -70, provisional: false },
  { id: 'line_egp', name: 'Linha EGP', start: 5520, end: 6084, offsetM: 72, provisional: true },
  { id: 'welding_yard', name: 'Estaleiro de Solda', start: 6099, end: 6538, offsetM: -72, provisional: true }
];

export const LEVEL_CROSSINGS = [7639, 9067, 13473, 15013, 19552, 25353, 26828, 40105, 45040, 50020, 57229, 59740, 63765, 65380, 67260, 70550, 75721, 80671, 83540, 86541, 90017, 92700, 97140, 100700, 103300, 106190, 108080, 110035, 114740, 118158, 120026, 126595, 129151].map((station, index) => ({ id: `pn-${String(index + 1).padStart(2, '0')}`, name: `PN KM ${formatKm(station)}`, station }));

export const BRIDGES = [
  { id: 'rio-dos-bois', name: 'Ponte Rio dos Bois', start: 30903, end: 31045 },
  { id: 'ribeirao-do-meio', name: 'Ponte Ribeirão do Meio', start: 46155, end: 46251 },
  { id: 'rio-peixe', name: 'Ponte Rio Peixe', start: 71122, end: 71219 },
  { id: 'crixas-acu', name: 'Ponte Crixás-Açu', start: 87747, end: 87841 },
  { id: 'corrego-baldaia', name: 'Ponte Córrego Baldaia', start: 100086, end: 100292 },
  { id: 'rio-vermelho', name: 'Ponte Rio Vermelho', start: 105010, end: 105184 },
  { id: 'ribeirao-danta', name: 'Ponte Ribeirão Danta', start: 116421, end: 116532 },
  { id: 'ribeirao-santa-maria', name: 'Ponte Ribeirão Santa Maria', start: 131185, end: 131387 }
];

const baseSwitches = DOUBLE_TRACKS.flatMap((track) => [
  { id: `${track.id}-a`, name: `${track.provisional ? 'AMV provisório' : 'AMV definitivo'} · ${track.name}`, station: track.start, status: track.provisional ? 'provisional' : 'definitive' },
  { id: `${track.id}-b`, name: `${track.provisional ? 'AMV provisório' : 'AMV definitivo'} · ${track.name}`, station: track.end, status: track.provisional ? 'provisional' : 'definitive' }
]);
export const SWITCHES = [
  { id: 'amv02', name: 'AMV 02', station: 2734, status: 'definitive' },
  ...baseSwitches.filter((item) => !['patio01-a', 'patio01-b'].includes(item.id)),
  { id: 'amv04', name: 'AMV 04', station: 3880, status: 'definitive' },
  { id: 'amv05', name: 'AMV 05', station: 5520, status: 'provisional' },
  { id: 'amv07', name: 'AMV 07', station: 5989, status: 'provisional' },
  { id: 'amv08', name: 'AMV 08', station: 6084, status: 'provisional' },
  { id: 'amv09', name: 'AMV 09', station: 6099, status: 'provisional' },
  { id: 'amv06', name: 'AMV 06', station: 6118, status: 'provisional' },
  { id: 'amv09a', name: 'AMV 09A', station: 6538, status: 'provisional' },
  { id: 'amv10', name: 'AMV 10', station: 6929, status: 'definitive' }
];

export function formatKm(meters) {
  const value = Math.max(0, Math.round(Number(meters) || 0));
  return `${Math.floor(value / 1000)}+${String(value % 1000).padStart(3, '0')}`;
}

export function availableLines(start, end) {
  const first = Math.min(Number(start), Number(end)), last = Math.max(Number(start), Number(end));
  const doubleTrack = DOUBLE_TRACKS.find((item) => first >= item.start && last <= item.end);
  const specialTracks = SPECIAL_TRACKS.filter((item) => first >= item.start && last <= item.end);
  const partialStructures = [...DOUBLE_TRACKS, ...SPECIAL_TRACKS].filter((item) => first < item.end && last > item.start && !(first >= item.start && last <= item.end));
  return {
    lines: ['line01', ...(doubleTrack ? ['line02'] : []), ...specialTracks.map((item) => item.id)],
    structure: doubleTrack || specialTracks[0] || null,
    structures: [doubleTrack, ...specialTracks].filter(Boolean),
    partialDoubleTrack: !doubleTrack && DOUBLE_TRACKS.some((item) => first < item.end && last > item.start),
    partialStructures
  };
}

function offsetCoordinates(coordinates, offsetM, tapered = true) {
  return coordinates.map((coordinate, index) => {
    const previous = coordinates[Math.max(0, index - 1)], next = coordinates[Math.min(coordinates.length - 1, index + 1)];
    const lat = coordinate[1] * Math.PI / 180, dx = (next[0] - previous[0]) * Math.cos(lat), dy = next[1] - previous[1], length = Math.hypot(dx, dy) || 1;
    const edge = Math.min(index, coordinates.length - 1 - index), taper = tapered ? Math.min(1, edge / 2) : 1, meters = offsetM * taper;
    return [coordinate[0] - (dy / length) * meters / (111320 * Math.cos(lat)), coordinate[1] + (dx / length) * meters / 111320];
  });
}

export function lineCoordinates(lineId, start, end, helpers) {
  const base = helpers.sliceAxis(Number(start), Number(end));
  if (lineId === 'line02') {
    const structure = DOUBLE_TRACKS.find((item) => Number(start) >= item.start && Number(end) <= item.end);
    return structure ? offsetCoordinates(base, 32) : base;
  }
  const special = SPECIAL_TRACKS.find((item) => item.id === lineId && Number(start) >= item.start && Number(end) <= item.end);
  return special ? offsetCoordinates(base, special.offsetM) : base;
}

export function buildInfrastructure(helpers) {
  const lines = [
    ...DOUBLE_TRACKS.map((item) => ({ type: 'Feature', properties: { ...item, category: item.provisional ? 'DTO · DESVIO TEMPORÁRIO DE OBRA' : 'PÁTIO · LINHA DUPLA', km: `${formatKm(item.start)}–${formatKm(item.end)}` }, geometry: { type: 'LineString', coordinates: offsetCoordinates(helpers.sliceAxis(item.start, item.end), 32) } })),
    ...SPECIAL_TRACKS.map((item) => ({ type: 'Feature', properties: { ...item, kind: 'special', category: item.provisional ? 'LINHA PROVISÓRIA' : 'RAMAL', km: `${formatKm(item.start)}–${formatKm(item.end)}` }, geometry: { type: 'LineString', coordinates: offsetCoordinates(helpers.sliceAxis(item.start, item.end), item.offsetM) } }))
  ];
  const bridges = BRIDGES.map((item) => ({ type: 'Feature', properties: { ...item, kind: 'bridge', category: 'PONTE', km: `${formatKm(item.start)}–${formatKm(item.end)}` }, geometry: { type: 'LineString', coordinates: helpers.sliceAxis(item.start, item.end) } }));
  const points = [
    ...LEVEL_CROSSINGS.map((item) => ({ type: 'Feature', properties: { ...item, kind: 'pn', category: 'PASSAGEM DE NÍVEL', km: formatKm(item.station) }, geometry: { type: 'Point', coordinates: helpers.pointAtStation(item.station) } })),
    ...SWITCHES.map((item) => ({ type: 'Feature', properties: { ...item, kind: 'switch', category: item.status === 'provisional' ? 'AMV PROVISÓRIO' : 'AMV DEFINITIVO', km: formatKm(item.station) }, geometry: { type: 'Point', coordinates: helpers.pointAtStation(item.station) } }))
  ];
  return { lines, bridges, points };
}
