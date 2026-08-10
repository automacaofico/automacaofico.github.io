const API_BASE = 'https://fico-tracking-api.automacaofico.workers.dev';
const EQUIPMENT = ['LOCO001','LOCO002','LOCO003','LOCO004','LOCO005','LOCO006','LOCO007','EGPS001','EGPS002','EGPS003','EGPR001','EGPR002','EGPR003','NTC001'];
const $ = (id) => document.getElementById(id);
const els = { loginCard:$('login-card'), loginForm:$('login-form'), password:$('admin-password'), loginMessage:$('login-message'), panel:$('admin-panel'), generateForm:$('generate-form'), equipment:$('equipment'), validDays:$('valid-days'), generated:$('generated-code'), generatedValue:$('generated-value'), copy:$('copy-generated'), generateMessage:$('generate-message'), refresh:$('refresh'), list:$('codes-list'), active:$('active-count'), used:$('used-count'), expired:$('expired-count') };
let adminPassword = '';

function message(element, text) { element.textContent = text; element.hidden = !text; }
function formatDate(value) { return new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' }).format(new Date(value)); }
async function api(path, body) {
  const response = await fetch(`${API_BASE}${path}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

function renderCodes(codes) {
  const counts = { active:0, used:0, expired:0 }; codes.forEach((item) => counts[item.status]++);
  els.active.textContent = counts.active; els.used.textContent = counts.used; els.expired.textContent = counts.expired;
  els.list.replaceChildren();
  if (!codes.length) { const empty=document.createElement('div'); empty.className='empty'; empty.textContent='Nenhum código cadastrado.'; els.list.append(empty); return; }
  codes.forEach((item) => {
    const row=document.createElement('article'); row.className='code-row';
    const equipment=document.createElement('span'); equipment.className='equipment'; equipment.textContent=item.equipmentId;
    const copy=document.createElement('div');
    const code=document.createElement('strong'); code.textContent=item.code || (item.status==='used'?'Código já utilizado':item.status==='expired'?'Código expirado':'Código anterior não recuperável');
    const detail=document.createElement('small'); detail.textContent=item.status==='used'?`Utilizado em ${formatDate(item.usedAt)}`:`Validade: ${formatDate(item.expiresAt)}`;
    copy.append(code,detail);
    const status=document.createElement('span'); status.className=`status ${item.status}`; status.textContent={active:'Ativo',used:'Utilizado',expired:'Expirado'}[item.status];
    row.append(equipment,copy,status);
    if(item.code){ row.title='Clique para copiar o código'; row.tabIndex=0; const copyCode=()=>navigator.clipboard.writeText(item.code); row.addEventListener('click',copyCode); row.addEventListener('keydown',(event)=>{if(event.key==='Enter')copyCode();}); }
    els.list.append(row);
  });
}

async function loadCodes() {
  els.refresh.disabled=true;
  try { const data=await api('/api/v1/admin/activation-codes/list',{adminPassword}); renderCodes(data.codes); }
  finally { els.refresh.disabled=false; }
}

EQUIPMENT.forEach((id)=>els.equipment.add(new Option(id,id)));
els.loginForm.addEventListener('submit',async(event)=>{
  event.preventDefault(); message(els.loginMessage,''); adminPassword=els.password.value; const button=els.loginForm.querySelector('button'); button.disabled=true;
  try { await loadCodes(); els.loginCard.hidden=true; els.panel.hidden=false; els.password.value=''; }
  catch(error){ adminPassword=''; message(els.loginMessage,error.message); }
  finally{ button.disabled=false; }
});
els.generateForm.addEventListener('submit',async(event)=>{
  event.preventDefault(); message(els.generateMessage,''); const button=els.generateForm.querySelector('button'); button.disabled=true;
  try {
    const data=await api('/api/v1/admin/activation-codes/generate',{adminPassword,equipmentId:els.equipment.value,validDays:Number(els.validDays.value)});
    els.generatedValue.textContent=data.activationCode.code; els.generated.hidden=false; await loadCodes();
  } catch(error){ message(els.generateMessage,error.message); }
  finally{ button.disabled=false; }
});
els.copy.addEventListener('click',async()=>{ await navigator.clipboard.writeText(els.generatedValue.textContent); els.copy.textContent='COPIADO'; setTimeout(()=>els.copy.textContent='COPIAR',1200); });
els.refresh.addEventListener('click',()=>loadCodes().catch((error)=>message(els.generateMessage,error.message)));
