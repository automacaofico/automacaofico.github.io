const API_BASE = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8791' : 'https://fico-tracking-api.automacaofico.workers.dev';
const EQUIPMENT = ['LOCO001','LOCO002','LOCO003','LOCO004','LOCO005','LOCO006','LOCO007','EGPS001','EGPS002','EGPS003','EGPR001','EGPR002','EGPR003','EGPR004','NTC001'];
const $ = (id) => document.getElementById(id);
const els = {
  equipment: $('equipment'), equipmentTitle: $('equipment-title'), current: $('current-session'), sessionForm: $('session-form'),
  registration: $('registration'), pin: $('pin'), formMessage: $('form-message'), start: $('start-shift'), end: $('end-shift'), force: $('force-shift'),
  registerForm: $('register-form'), newName: $('new-name'), newRegistration: $('new-registration'), newPin: $('new-pin'), adminPassword: $('admin-password'), registerMessage: $('register-message')
};
let pendingForce = false;

function message(element, text, success = false) {
  element.textContent = text; element.hidden = !text; element.classList.toggle('success', success);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || 'Não foi possível concluir.'); error.status = response.status; error.body = body; throw error; }
  return body;
}

async function loadSession() {
  const equipmentId = els.equipment.value;
  els.equipmentTitle.textContent = equipmentId;
  els.current.className = 'current-session empty'; els.current.textContent = 'Consultando turno atual…';
  els.force.hidden = true; pendingForce = false;
  try {
    const data = await api(`/api/v1/operator/session?equipmentId=${encodeURIComponent(equipmentId)}`);
    if (!data.session) { els.current.textContent = 'Nenhum operador com turno aberto.'; return; }
    els.current.className = 'current-session';
    els.current.textContent = `${data.session.operatorName} · matrícula ${data.session.operatorRegistration} · desde ${formatDate(data.session.startedAt)}`;
  } catch (error) { els.current.textContent = error.message; }
}

function credentials() {
  return { equipmentId: els.equipment.value, registration: els.registration.value.trim().toUpperCase(), pin: els.pin.value.trim() };
}

async function startShift(force = false) {
  message(els.formMessage, ''); els.start.disabled = true; els.end.disabled = true; els.force.disabled = true;
  try {
    const data = await api('/api/v1/operator/session/start', { method: 'POST', body: JSON.stringify({ ...credentials(), force }) });
    localStorage.setItem('ficoOperatorRegistration', data.session.operatorRegistration);
    const previous = data.changedEquipment ? ` O turno no ${data.previousEquipmentId} foi encerrado automaticamente.` : '';
    message(els.formMessage, `${data.session.operatorName} agora está associado ao ${data.session.equipmentId}.${previous}`, true);
    els.pin.value = ''; els.force.hidden = true; pendingForce = false; await loadSession();
  } catch (error) {
    if (error.status === 409 && error.body?.conflict) {
      pendingForce = true; els.force.hidden = false;
      message(els.formMessage, `${error.body.conflict.operatorName} já está neste equipamento. Confirme somente se estiver realizando a troca de operador.`);
    } else message(els.formMessage, error.message);
  } finally { els.start.disabled = false; els.end.disabled = false; els.force.disabled = false; }
}

async function endShift() {
  message(els.formMessage, ''); els.start.disabled = true; els.end.disabled = true;
  try {
    await api('/api/v1/operator/session/end', { method: 'POST', body: JSON.stringify(credentials()) });
    message(els.formMessage, 'Turno encerrado com sucesso.', true); els.pin.value = ''; await loadSession();
  } catch (error) { message(els.formMessage, error.message); }
  finally { els.start.disabled = false; els.end.disabled = false; }
}

EQUIPMENT.forEach((id) => els.equipment.add(new Option(id, id)));
const requested = new URLSearchParams(location.search).get('equipamento')?.toUpperCase();
if (EQUIPMENT.includes(requested)) els.equipment.value = requested;
const requestedRegistration = new URLSearchParams(location.search).get('matricula')?.trim().toUpperCase();
els.registration.value = requestedRegistration || localStorage.getItem('ficoOperatorRegistration') || '';
els.equipment.addEventListener('change', loadSession);
els.sessionForm.addEventListener('submit', (event) => { event.preventDefault(); startShift(false); });
els.end.addEventListener('click', endShift);
els.force.addEventListener('click', () => pendingForce && startShift(true));
els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault(); message(els.registerMessage, '');
  const button = els.registerForm.querySelector('button'); button.disabled = true;
  try {
    const data = await api('/api/v1/operators', { method: 'POST', body: JSON.stringify({ name: els.newName.value, registration: els.newRegistration.value, pin: els.newPin.value, adminPassword: els.adminPassword.value }) });
    els.registration.value = data.operator.registration; els.pin.value = els.newPin.value;
    localStorage.setItem('ficoOperatorRegistration', data.operator.registration);
    message(els.registerMessage, `${data.operator.name} cadastrado. Agora já pode assumir o equipamento.`, true);
    els.newName.value = ''; els.newRegistration.value = ''; els.newPin.value = ''; els.adminPassword.value = '';
  } catch (error) { message(els.registerMessage, error.message); }
  finally { button.disabled = false; }
});
loadSession();
