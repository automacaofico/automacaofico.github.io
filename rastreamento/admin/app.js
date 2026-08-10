const API_BASE = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? "http://127.0.0.1:8791"
  : "https://fico-tracking-api.automacaofico.workers.dev";
const EQUIPMENT = [
  "LOCO001",
  "LOCO002",
  "LOCO003",
  "LOCO004",
  "LOCO005",
  "LOCO006",
  "LOCO007",
  "EGPS001",
  "EGPS002",
  "EGPS003",
  "EGPR001",
  "EGPR002",
  "EGPR003",
  "NTC001",
];
const $ = (id) => document.getElementById(id);
const els = {
  loginCard: $("login-card"),
  loginForm: $("login-form"),
  password: $("admin-password"),
  loginMessage: $("login-message"),
  panel: $("admin-panel"),
  generateForm: $("generate-form"),
  equipment: $("equipment"),
  validDays: $("valid-days"),
  generated: $("generated-code"),
  generatedValue: $("generated-value"),
  copy: $("copy-generated"),
  generateMessage: $("generate-message"),
  refresh: $("refresh"),
  list: $("codes-list"),
  active: $("active-count"),
  used: $("used-count"),
  expired: $("expired-count"),
  deviceForm: $("device-form"),
  deviceOperator: $("device-operator"),
  devicePlatform: $("device-platform"),
  deviceLabel: $("device-label"),
  deviceMessage: $("device-message"),
  deviceResult: $("device-result"),
  devicesList: $("devices-list"),
  operatorCreateForm: $("operator-create-form"),
  operatorNewName: $("operator-new-name"),
  operatorNewRegistration: $("operator-new-registration"),
  operatorNewPin: $("operator-new-pin"),
  operatorSearch: $("operator-search"),
  operatorMessage: $("operator-message"),
  operatorsList: $("operators-list"),
  operatorsActive: $("operators-active"),
  operatorsInactive: $("operators-inactive"),
  operatorDialog: $("operator-dialog"),
  operatorEditForm: $("operator-edit-form"),
  operatorEditTitle: $("operator-edit-title"),
  operatorEditRegistration: $("operator-edit-registration"),
  operatorEditName: $("operator-edit-name"),
  operatorEditPin: $("operator-edit-pin"),
  operatorEditMessage: $("operator-edit-message"),
  operatorDialogClose: $("operator-dialog-close"),
  operatorDialogCancel: $("operator-dialog-cancel"),
};
let adminPassword = "";
let currentDevices = [];
let currentOperators = [];

function message(element, text, success = false) {
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle("success", success);
}
function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Nunca";
}
async function api(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir.");
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}
function copyText(value) {
  return navigator.clipboard.writeText(value);
}
function downloadConfiguration(device) {
  const blob = new Blob([JSON.stringify(device.configuration, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `FICO-${device.operatorRegistration}-${device.deviceId}.otrc`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function openOperatorEditor(operator) {
  els.operatorEditTitle.textContent = operator.name;
  els.operatorEditRegistration.value = operator.registration;
  els.operatorEditName.value = operator.name;
  els.operatorEditPin.value = "";
  message(els.operatorEditMessage, "");
  els.operatorDialog.showModal();
}

async function changeOperatorStatus(operator) {
  const activating = !operator.active;
  const warning = activating
    ? `Reativar ${operator.name}? O operador precisará vincular novamente seus dispositivos.`
    : `Desativar ${operator.name}? O acesso será bloqueado e ${operator.activeDevicesCount} dispositivo(s) serão revogados. O histórico será preservado.`;
  if (!confirm(warning)) return;
  message(els.operatorMessage, "");
  try {
    await api("/api/v2/admin/operators/status", {
      adminPassword,
      registration: operator.registration,
      active: activating,
    });
    await Promise.all([loadOperators(), loadDevices()]);
    message(
      els.operatorMessage,
      activating
        ? `${operator.name} foi reativado.`
        : `${operator.name} foi desativado e seus dispositivos foram revogados.`,
      true,
    );
  } catch (error) {
    message(els.operatorMessage, error.message);
  }
}

async function forceEndOperatorSession(operator) {
  if (
    !confirm(
      `Encerrar remotamente o turno de ${operator.name} no ${operator.activeEquipment}? O aplicativo deixará de enviar posições para este equipamento até uma nova identificação.`,
    )
  )
    return;
  message(els.operatorMessage, "");
  try {
    await api("/api/v2/admin/operators/end-session", {
      adminPassword,
      registration: operator.registration,
    });
    await loadOperators();
    message(
      els.operatorMessage,
      `Turno de ${operator.name} no ${operator.activeEquipment} encerrado remotamente.`,
      true,
    );
  } catch (error) {
    message(els.operatorMessage, error.message);
  }
}

function renderOperators() {
  const query = els.operatorSearch.value.trim().toLocaleLowerCase("pt-BR");
  const operators = currentOperators.filter((item) =>
    `${item.name} ${item.registration}`
      .toLocaleLowerCase("pt-BR")
      .includes(query),
  );
  els.operatorsActive.textContent = currentOperators.filter(
    (item) => item.active,
  ).length;
  els.operatorsInactive.textContent = currentOperators.filter(
    (item) => !item.active,
  ).length;
  els.operatorsList.replaceChildren();
  if (!operators.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = query
      ? "Nenhum operador encontrado."
      : "Nenhum operador cadastrado.";
    els.operatorsList.append(empty);
    return;
  }
  operators.forEach((operator) => {
    const row = document.createElement("article");
    row.className = `operator-row${operator.active ? "" : " inactive"}`;
    const identity = document.createElement("div");
    identity.className = "operator-identity";
    const title = document.createElement("strong");
    title.textContent = operator.name;
    const registration = document.createElement("code");
    registration.textContent = operator.registration;
    identity.append(title, registration);
    const operational = document.createElement("div");
    operational.className = "operator-operational";
    const status = document.createElement("span");
    status.className = `operator-status ${operator.active ? "active" : "inactive"}`;
    status.textContent = operator.active ? "Ativo" : "Inativo";
    const detail = document.createElement("small");
    detail.textContent = operator.activeEquipment
      ? `Em turno · ${operator.activeEquipment}`
      : `${operator.sessionsCount} turno(s) · ${operator.activeDevicesCount}/${operator.devicesCount} dispositivo(s) ativos`;
    operational.append(status, detail);
    const actions = document.createElement("div");
    actions.className = "operator-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "EDITAR / PIN";
    edit.onclick = () => openOperatorEditor(operator);
    if (operator.activeEquipment) {
      const endSession = document.createElement("button");
      endSession.type = "button";
      endSession.className = "end-session";
      endSession.textContent = "ENCERRAR TURNO";
      endSession.title = `Derrubar vínculo atual com ${operator.activeEquipment}`;
      endSession.onclick = () => forceEndOperatorSession(operator);
      actions.append(endSession);
    }
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = operator.active ? "danger" : "activate";
    toggle.textContent = operator.active ? "DESATIVAR" : "REATIVAR";
    toggle.disabled = Boolean(operator.activeEquipment);
    if (operator.activeEquipment)
      toggle.title = `Encerre primeiro o turno no ${operator.activeEquipment}`;
    toggle.onclick = () => changeOperatorStatus(operator);
    actions.append(edit, toggle);
    row.append(identity, operational, actions);
    els.operatorsList.append(row);
  });
}

function renderDeviceResult(device) {
  els.deviceResult.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = `${device.operatorName} · ${device.deviceId}`;
  const credentials = document.createElement("code");
  credentials.textContent = `UserID: ${device.username}\nPassword: ${device.password}`;
  const actions = document.createElement("div");
  actions.className = "device-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "COPIAR DADOS";
  copy.onclick = () =>
    copyText(`UserID: ${device.username}\nPassword: ${device.password}`);
  actions.append(copy);
  if (device.configuration) {
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "BAIXAR .OTRC";
    download.onclick = () => downloadConfiguration(device);
    actions.append(download);
  }
  els.deviceResult.append(title, credentials, actions);
  els.deviceResult.hidden = false;
}

function renderDevices(devices) {
  currentDevices = devices;
  els.devicesList.replaceChildren();
  if (!devices.length) {
    els.devicesList.textContent = "Nenhum dispositivo pessoal cadastrado.";
    return;
  }
  devices.forEach((device) => {
    const row = document.createElement("article");
    row.className = "device-row";
    const identity = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${device.operatorName} · ${device.platform.toUpperCase()}`;
    const detail = document.createElement("small");
    detail.textContent = `${device.deviceId} · ${device.label} · último sinal: ${formatDate(device.lastSeenAt)}`;
    identity.append(title, detail);
    const credentials = document.createElement("code");
    credentials.textContent = device.active
      ? `${device.username}\n${device.password}`
      : "Revogado";
    const actions = document.createElement("div");
    actions.className = "device-actions";
    if (device.active) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "COPIAR";
      copy.onclick = () =>
        copyText(`UserID: ${device.username}\nPassword: ${device.password}`);
      actions.append(copy);
      if (device.configuration) {
        const download = document.createElement("button");
        download.type = "button";
        download.textContent = ".OTRC";
        download.onclick = () => downloadConfiguration(device);
        actions.append(download);
      }
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "danger";
      revoke.textContent = "REVOGAR";
      revoke.onclick = async () => {
        if (!confirm(`Revogar ${device.deviceId}?`)) return;
        await api("/api/v2/admin/devices/revoke", {
          adminPassword,
          deviceId: device.deviceId,
        });
        await loadDevices();
      };
      actions.append(revoke);
    }
    row.append(identity, credentials, actions);
    els.devicesList.append(row);
  });
}

function renderCodes(codes) {
  const counts = { active: 0, used: 0, expired: 0 };
  codes.forEach((item) => counts[item.status]++);
  els.active.textContent = counts.active;
  els.used.textContent = counts.used;
  els.expired.textContent = counts.expired;
  els.list.replaceChildren();
  if (!codes.length) {
    els.list.textContent = "Nenhum código cadastrado.";
    return;
  }
  codes.forEach((item) => {
    const row = document.createElement("article");
    row.className = "code-row";
    const equipment = document.createElement("span");
    equipment.className = "equipment";
    equipment.textContent = item.equipmentId;
    const copy = document.createElement("div");
    const code = document.createElement("strong");
    code.textContent =
      item.code ||
      (item.status === "used"
        ? "Código já utilizado"
        : item.status === "expired"
          ? "Código expirado"
          : "Código anterior não recuperável");
    const detail = document.createElement("small");
    detail.textContent =
      item.status === "used"
        ? `Utilizado em ${formatDate(item.usedAt)}`
        : `Validade: ${formatDate(item.expiresAt)}`;
    copy.append(code, detail);
    const status = document.createElement("span");
    status.className = `status ${item.status}`;
    status.textContent = {
      active: "Ativo",
      used: "Utilizado",
      expired: "Expirado",
    }[item.status];
    row.append(equipment, copy, status);
    if (item.code) row.onclick = () => copyText(item.code);
    els.list.append(row);
  });
}

async function loadDevices() {
  const devicesData = await api("/api/v2/admin/devices/list", {
    adminPassword,
  });
  renderDevices(devicesData.devices);
}
async function loadOperators() {
  const data = await api("/api/v2/admin/operators/list", { adminPassword });
  currentOperators = data.operators;
  els.deviceOperator.replaceChildren(
    ...currentOperators
      .filter((item) => item.active)
      .map(
        (item) =>
          new Option(`${item.name} · ${item.registration}`, item.registration),
      ),
  );
  renderOperators();
}
async function loadCodes() {
  els.refresh.disabled = true;
  try {
    const data = await api("/api/v1/admin/activation-codes/list", {
      adminPassword,
    });
    renderCodes(data.codes);
  } finally {
    els.refresh.disabled = false;
  }
}

EQUIPMENT.forEach((id) => els.equipment.add(new Option(id, id)));
els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(els.loginMessage, "");
  adminPassword = els.password.value;
  const button = els.loginForm.querySelector("button");
  button.disabled = true;
  try {
    await Promise.all([loadCodes(), loadOperators(), loadDevices()]);
    els.loginCard.hidden = true;
    els.panel.hidden = false;
    els.password.value = "";
  } catch (error) {
    adminPassword = "";
    message(els.loginMessage, error.message);
  } finally {
    button.disabled = false;
  }
});
els.operatorSearch.addEventListener("input", renderOperators);
els.operatorCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(els.operatorMessage, "");
  const button = els.operatorCreateForm.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("/api/v2/admin/operators/create", {
      adminPassword,
      name: els.operatorNewName.value,
      registration: els.operatorNewRegistration.value,
      pin: els.operatorNewPin.value,
    });
    els.operatorCreateForm.reset();
    await loadOperators();
    message(
      els.operatorMessage,
      `${data.operator.name} foi cadastrado com sucesso.`,
      true,
    );
  } catch (error) {
    message(els.operatorMessage, error.message);
  } finally {
    button.disabled = false;
  }
});
els.operatorEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(els.operatorEditMessage, "");
  const button = els.operatorEditForm.querySelector("button.primary");
  button.disabled = true;
  try {
    const data = await api("/api/v2/admin/operators/update", {
      adminPassword,
      registration: els.operatorEditRegistration.value,
      name: els.operatorEditName.value,
      pin: els.operatorEditPin.value,
    });
    await Promise.all([loadOperators(), loadDevices()]);
    els.operatorDialog.close();
    message(
      els.operatorMessage,
      `${data.operator.name} foi atualizado${data.pinChanged ? " e recebeu um novo PIN" : ""}.`,
      true,
    );
  } catch (error) {
    message(els.operatorEditMessage, error.message);
  } finally {
    button.disabled = false;
  }
});
els.operatorDialogClose.addEventListener("click", () =>
  els.operatorDialog.close(),
);
els.operatorDialogCancel.addEventListener("click", () =>
  els.operatorDialog.close(),
);
els.deviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(els.deviceMessage, "");
  const button = els.deviceForm.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("/api/v2/admin/devices/create", {
      adminPassword,
      registration: els.deviceOperator.value,
      platform: els.devicePlatform.value,
      label: els.deviceLabel.value,
    });
    renderDeviceResult(data.device);
    els.deviceLabel.value = "";
    await loadDevices();
  } catch (error) {
    message(els.deviceMessage, error.message);
  } finally {
    button.disabled = false;
  }
});
els.generateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(els.generateMessage, "");
  const button = els.generateForm.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("/api/v1/admin/activation-codes/generate", {
      adminPassword,
      equipmentId: els.equipment.value,
      validDays: Number(els.validDays.value),
    });
    els.generatedValue.textContent = data.activationCode.code;
    els.generated.hidden = false;
    await loadCodes();
  } catch (error) {
    message(els.generateMessage, error.message);
  } finally {
    button.disabled = false;
  }
});
els.copy.addEventListener("click", async () => {
  await copyText(els.generatedValue.textContent);
  els.copy.textContent = "COPIADO";
  setTimeout(() => (els.copy.textContent = "COPIAR"), 1200);
});
els.refresh.addEventListener("click", () =>
  Promise.all([loadCodes(), loadOperators(), loadDevices()]).catch((error) =>
    message(els.generateMessage, error.message),
  ),
);
