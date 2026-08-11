export const RAIL_PACKAGES = [
  { id: 'P01', name: 'Pacote 01', start: 0, end: 38100, color: '#0075a9' },
  { id: 'P02', name: 'Pacote 02', start: 38100, end: 71300, color: '#55a646' },
  { id: 'P03', name: 'Pacote 03', start: 71300, end: 104500, color: '#ee7623' },
  { id: 'P04', name: 'Pacote 04', start: 104500, end: 131260, color: '#7b61a8' },
  { id: 'P05', name: 'Pacote 05', start: 131260, end: 167300, color: '#008a8a' },
  { id: 'P06', name: 'Pacote 06', start: 167300, end: 225000, color: '#c34f5d' },
  { id: 'P07', name: 'Pacote 07', start: 225000, end: 239950, color: '#657583' },
  { id: 'P08', name: 'Pacote 08', start: 239950, end: 292260, color: '#b27a19' }
];

export function packageAt(stationM) {
  return RAIL_PACKAGES.find((item) => stationM >= item.start && stationM < item.end) || RAIL_PACKAGES.at(-1);
}

export function packageCollection(sliceAxis, maximum) {
  return {
    type: 'FeatureCollection',
    features: RAIL_PACKAGES.map((item) => ({
      type: 'Feature',
      properties: item,
      geometry: { type: 'LineString', coordinates: sliceAxis(item.start, Math.min(item.end, maximum)) }
    }))
  };
}
