const EQUIPMENT = ['LOCO001','LOCO002','LOCO003','LOCO004','LOCO005','LOCO006','LOCO007','EGPS001','EGPS002','EGPS003','EGPR001','EGPR002','EGPR003','NTC001'];
const grid = document.getElementById('qr-grid');
EQUIPMENT.forEach((equipmentId) => {
  const url = `https://automacaofico.github.io/rastreamento/assumir/?equipamento=${equipmentId}`;
  const card = document.createElement('article'); card.className = 'qr-card';
  const qr = document.createElement('div'); qr.className = 'qr';
  const copy = document.createElement('div'); copy.className = 'copy';
  const label = document.createElement('small'); label.textContent = 'ASSUMIR EQUIPAMENTO';
  const name = document.createElement('strong'); name.textContent = equipmentId;
  const instruction = document.createElement('p'); instruction.textContent = 'Aponte a câmera, informe sua matrícula e o PIN pessoal.';
  const address = document.createElement('code'); address.textContent = url;
  copy.append(label, name, instruction, address); card.append(qr, copy); grid.append(card);
  if (window.QRCode) new QRCode(qr, { text: url, width: 220, height: 220, colorDark: '#082b4c', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  else qr.textContent = 'QR indisponível';
});
