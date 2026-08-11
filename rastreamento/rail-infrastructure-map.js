import { buildInfrastructure } from './rail-infrastructure.js?v=20260811-2';

const LAYERS = ['fico-infra-points', 'fico-infra-bridges', 'fico-infra-special', 'fico-infra-dto', 'fico-infra-double'];

function popupContent(properties) {
  const content = document.createElement('section'); content.className = `rail-infra-popup ${properties.kind || ''}`;
  const category = document.createElement('span'); category.textContent = properties.category || 'INFRAESTRUTURA FERROVIÁRIA';
  const name = document.createElement('strong'); name.textContent = properties.name;
  const km = document.createElement('b'); km.textContent = `KM ${properties.km}`;
  content.append(category, name, km);
  if (properties.kind === 'dto') { const detail = document.createElement('small'); detail.textContent = 'Desvio temporário de obra · linha provisória para estacionamento e cruzamento'; content.append(detail); }
  return content;
}

export function addInfrastructureLayers(map, helpers) {
  const data = buildInfrastructure(helpers), collection = (features) => ({ type: 'FeatureCollection', features });
  map.addSource('fico-infra-lines', { type: 'geojson', data: collection(data.lines) });
  map.addLayer({ id: 'fico-infra-double-case', type: 'line', source: 'fico-infra-lines', filter: ['!=', ['get', 'kind'], 'special'], paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': .9 } });
  map.addLayer({ id: 'fico-infra-double', type: 'line', source: 'fico-infra-lines', filter: ['all', ['!=', ['get', 'kind'], 'special'], ['==', ['get', 'provisional'], false]], paint: { 'line-color': '#143e5b', 'line-width': 4 } });
  map.addLayer({ id: 'fico-infra-dto', type: 'line', source: 'fico-infra-lines', filter: ['all', ['!=', ['get', 'kind'], 'special'], ['==', ['get', 'provisional'], true]], paint: { 'line-color': '#ef8b22', 'line-width': 4, 'line-dasharray': [1.4, .7] } });
  map.addLayer({ id: 'fico-infra-special', type: 'line', source: 'fico-infra-lines', filter: ['==', ['get', 'kind'], 'special'], paint: { 'line-color': ['case', ['get', 'provisional'], '#ef8b22', '#7e5bc4'], 'line-width': 4, 'line-dasharray': [1.2, .8] } });
  map.addSource('fico-infra-bridges', { type: 'geojson', data: collection(data.bridges) });
  map.addLayer({ id: 'fico-infra-bridges', type: 'line', source: 'fico-infra-bridges', paint: { 'line-color': '#20a8d8', 'line-width': 9, 'line-opacity': .95 } });
  map.addSource('fico-infra-points', { type: 'geojson', data: collection(data.points) });
  map.addLayer({ id: 'fico-infra-points-halo', type: 'circle', source: 'fico-infra-points', paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-opacity': .92 } });
  map.addLayer({ id: 'fico-infra-points', type: 'circle', source: 'fico-infra-points', paint: { 'circle-radius': ['case', ['==', ['get', 'kind'], 'pn'], 4.5, 5], 'circle-color': ['case', ['==', ['get', 'kind'], 'pn'], '#f28b22', ['==', ['get', 'status'], 'provisional'], '#e14e46', '#54ad36'], 'circle-stroke-color': '#082b4c', 'circle-stroke-width': 1 } });
  let popup;
  const show = (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: LAYERS }); if (!features.length) return;
    map.getCanvas().style.cursor = 'pointer';
    if (!popup) popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'rail-infrastructure-popup', maxWidth: '330px' });
    popup.setLngLat(event.lngLat).setDOMContent(popupContent(features[0].properties)).addTo(map);
  };
  for (const layer of LAYERS) { map.on('mousemove', layer, show); map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; popup?.remove(); }); }
  return { layers: LAYERS, data };
}
