const API = /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8791' : 'https://fico-tracking-api.automacaofico.workers.dev';
const $ = (id) => document.getElementById(id), token = sessionStorage.getItem('ficoCcoToken') || '';
const el = { app:$('app'), denied:$('access-denied'), controller:$('controller-name'), from:$('from'), to:$('to'), type:$('type'), status:$('status'), line:$('line'), search:$('search'), apply:$('apply'), clear:$('clear'), refresh:$('refresh'), export:$('export'), message:$('message'), total:$('kpi-total'), ldl:$('kpi-ldl'), people:$('kpi-people'), circulation:$('kpi-circulation'), permissive:$('kpi-permissive'), safety:$('kpi-safety'), duration:$('kpi-duration'), trend:$('trend-chart'), trendCaption:$('trend-caption'), statusChart:$('status-chart'), ranking:$('ranking'), body:$('records-body'), count:$('result-count'), freshness:$('freshness'), detail:$('detail-dialog'), detailTitle:$('detail-title'), detailBody:$('detail-body') };
let records = [], filtered = [], serverTime = null;
const TYPES = { ldl:'LDL', circulation:'Circulação', permissive:'Permissivo', safety:'Segurança' };
const STATUS = { active:'Ativa', returned:'Devolvida', cancelled:'Cancelada', authorized:'Autorizada', completed:'Concluída', resolved:'Resolvida' };
const LINES = { line01:'Linha 01', line02:'Linha 02', south_loop:'Alça Sul', line_egp:'Linha EGP', welding_yard:'Estaleiro de Solda' };
const COLORS = { ldl:'#c83f39', circulation:'#2b82c4', permissive:'#d4a514', safety:'#8e2020' };

function localDate(value){ const date=new Date(value); return new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function fmtDate(value){ return value ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—'; }
function fmtKm(value){ const n=Math.max(0,Math.round(Number(value)||0)); return `${Math.floor(n/1000)}+${String(n%1000).padStart(3,'0')}`; }
function durationMs(item){ const end=item.closed_at ? Date.parse(item.closed_at) : NaN; return Number.isFinite(end) ? Math.max(0,end-Date.parse(item.start_at)) : null; }
function durationLabel(ms){ if(!Number.isFinite(ms)) return '—'; const minutes=Math.round(ms/60000); if(minutes<60)return `${minutes} min`; const hours=Math.floor(minutes/60), rest=minutes%60; return hours<48?`${hours}h ${rest}min`:`${Math.floor(hours/24)}d ${hours%24}h`; }
function searchable(item){ return [item.code,item.status,item.subject_code,item.subject_name,item.subject_detail,item.controller_code,item.controller_name,item.description,item.lines?.join(' ')].join(' ').toLocaleLowerCase('pt-BR'); }
function notify(text){ el.message.textContent=text; el.message.hidden=!text; }
async function api(path){ const response=await fetch(`${API}${path}`,{headers:{authorization:`Bearer ${token}`}}); const data=await response.json().catch(()=>({})); if(!response.ok){ const error=new Error(data.error||'Falha ao consultar o histórico.'); error.status=response.status; throw error; } return data; }

function initializeDates(){ const now=new Date(), first=new Date(now.getFullYear(),now.getMonth(),1); el.from.value=localDate(first); el.to.value=localDate(now); }
function dateBounds(){ return { from:new Date(`${el.from.value}T00:00:00`).toISOString(), to:new Date(`${el.to.value}T23:59:59.999`).toISOString() }; }
function populateOptions(){
  const currentStatus=el.status.value, currentLine=el.line.value;
  const statuses=[...new Set(records.map(x=>x.status))].sort(), lines=[...new Set(records.flatMap(x=>x.lines||[]))].sort();
  el.status.replaceChildren(new Option('Todas','all'),...statuses.map(x=>new Option(STATUS[x]||x,x)));
  el.line.replaceChildren(new Option('Todas','all'),...lines.map(x=>new Option(LINES[x]||x,x)));
  if(statuses.includes(currentStatus))el.status.value=currentStatus;if(lines.includes(currentLine))el.line.value=currentLine;
}
function applyFilters(){
  const q=el.search.value.trim().toLocaleLowerCase('pt-BR');
  filtered=records.filter(item=>(el.type.value==='all'||item.type===el.type.value)&&(el.status.value==='all'||item.status===el.status.value)&&(el.line.value==='all'||item.lines?.includes(el.line.value))&&(!q||searchable(item).includes(q)));
  render();
}
function renderKpis(){
  el.total.textContent=filtered.length.toLocaleString('pt-BR');
  for(const type of ['ldl','circulation','permissive','safety'])el[type].textContent=filtered.filter(x=>x.type===type).length.toLocaleString('pt-BR');
  el.people.textContent=`${filtered.filter(x=>x.type==='ldl').reduce((sum,x)=>sum+Number(x.workforce||0),0).toLocaleString('pt-BR')} pessoas mobilizadas`;
  const durations=filtered.map(durationMs).filter(Number.isFinite); el.duration.textContent=durations.length?durationLabel(durations.reduce((a,b)=>a+b,0)/durations.length):'—';
}
function trendKey(value,spanDays){ const d=new Date(value); if(spanDays>120)return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(spanDays>45){ const start=new Date(d);start.setDate(d.getDate()-d.getDay());return localDate(start); } return localDate(d); }
function trendLabel(key,spanDays){ if(spanDays>120){const [y,m]=key.split('-');return `${m}/${String(y).slice(2)}`;} const [y,m,d]=key.split('-');return `${d}/${m}`; }
function renderTrend(){
  const {from,to}=dateBounds(),span=Math.ceil((Date.parse(to)-Date.parse(from))/86400000), buckets=new Map();
  for(const item of filtered){const key=trendKey(item.recorded_at,span), bucket=buckets.get(key)||{ldl:0,circulation:0,permissive:0,safety:0};bucket[item.type]++;buckets.set(key,bucket);}
  const entries=[...buckets.entries()].sort(([a],[b])=>a.localeCompare(b)), max=Math.max(1,...entries.flatMap(([,v])=>Object.values(v)));
  el.trend.replaceChildren(); entries.forEach(([key,values],index)=>{const group=document.createElement('div');group.className='trend-group';for(const type of Object.keys(COLORS)){const bar=document.createElement('i');bar.className='trend-bar';bar.style.setProperty('--value',String(values[type]/max*100));bar.style.setProperty('--color',COLORS[type]);group.append(bar);}const tip=document.createElement('span');tip.className='trend-tip';tip.textContent=`${trendLabel(key,span)} · LDL ${values.ldl} · CIRC ${values.circulation} · PERM ${values.permissive} · Segurança ${values.safety}`;group.append(tip);if(index===0||index===entries.length-1||index%Math.max(1,Math.ceil(entries.length/7))===0){const label=document.createElement('b');label.className='trend-label';label.textContent=trendLabel(key,span);group.append(label);}el.trend.append(group);});
  if(!entries.length)el.trend.innerHTML='<div class="empty-state">Nenhum registro para desenhar a evolução.</div>';
  el.trendCaption.textContent=span>120?'agrupamento mensal':span>45?'agrupamento semanal':'agrupamento diário';
}
function renderStatuses(){ const counts={};for(const item of filtered)counts[item.status]=(counts[item.status]||0)+1;const max=Math.max(1,...Object.values(counts));el.statusChart.replaceChildren();Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([status,count])=>{const row=document.createElement('div');row.className='status-row';row.innerHTML='<header><span></span><b></b></header><div class="status-track"><div class="status-fill"></div></div>';row.querySelector('span').textContent=STATUS[status]||status;row.querySelector('b').textContent=count.toLocaleString('pt-BR');row.querySelector('.status-fill').style.setProperty('--width',`${count/max*100}%`);el.statusChart.append(row);});if(!Object.keys(counts).length)el.statusChart.innerHTML='<div class="empty-state">Sem dados.</div>'; }
function renderRanking(){ const counts={};for(const item of filtered){const key=`${item.subject_code||'—'} · ${item.subject_name||'Não informado'}`;counts[key]=(counts[key]||0)+1;}el.ranking.replaceChildren();Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,7).forEach(([name,count],i)=>{const li=document.createElement('li');li.innerHTML='<i></i><span></span><b></b>';li.querySelector('i').textContent=String(i+1).padStart(2,'0');li.querySelector('span').textContent=name;li.querySelector('b').textContent=count;el.ranking.append(li);});if(!Object.keys(counts).length)el.ranking.innerHTML='<li><span>Sem dados.</span></li>'; }
function showDetail(item){
  el.detailTitle.textContent=`${TYPES[item.type]} · ${item.code}`; const lines=[['Situação',STATUS[item.status]||item.status],['Responsável/equipamento',`${item.subject_code} · ${item.subject_name}`],['Complemento',item.subject_detail],['Linha',(item.lines||[]).map(x=>LINES[x]||x).join(' + ')],['Trecho',`${fmtKm(item.km_start)} – ${fmtKm(item.km_end)}`],['Registro',fmtDate(item.recorded_at)],['Início',fmtDate(item.start_at)],['Fim previsto',fmtDate(item.planned_end_at)],['Encerramento',fmtDate(item.closed_at)],['Duração efetiva',durationLabel(durationMs(item))],['Controlador',`${item.controller_code} · ${item.controller_name}`],['Revisão',item.revision??0],['Descrição / serviço',item.description||'—'],['Composição / formação',[item.equipment_members,item.composition].filter(Boolean).join('\n')||'—'],['Justificativa',item.justification||'—']];
  el.detailBody.replaceChildren();for(const [label,value] of lines){const box=document.createElement('div');box.className=`detail-item ${['Descrição / serviço','Composição / formação','Justificativa'].includes(label)?'wide':''}`;const span=document.createElement('span'),strong=document.createElement('strong');span.textContent=label;strong.textContent=value??'—';box.append(span,strong);el.detailBody.append(box);}el.detail.showModal();
}
function renderTable(){ el.body.replaceChildren();for(const item of filtered){const row=el.body.insertRow();row.innerHTML='<td><span class="type-badge"></span></td><td></td><td><span class="status-badge"></span></td><td></td><td></td><td></td><td></td><td></td><td></td><td><button class="detail-link">DETALHES</button></td>';const cells=row.cells;const type=cells[0].querySelector('span');type.className=`type-badge ${item.type}`;type.textContent=TYPES[item.type];cells[1].textContent=item.code;const status=cells[2].querySelector('span');status.className=`status-badge ${item.status}`;status.textContent=STATUS[item.status]||item.status;cells[3].textContent=`${item.subject_code} · ${item.subject_name}`;cells[4].textContent=(item.lines||[]).map(x=>LINES[x]||x).join(' + ');cells[5].textContent=`${fmtKm(item.km_start)}–${fmtKm(item.km_end)}`;cells[6].textContent=fmtDate(item.start_at);cells[7].textContent=fmtDate(item.closed_at);cells[8].textContent=`${item.controller_code} · ${item.controller_name}`;row.onclick=()=>showDetail(item);}
  if(!filtered.length){const row=el.body.insertRow(),cell=row.insertCell();cell.colSpan=10;cell.className='empty-state';cell.textContent='Nenhum registro encontrado com os filtros selecionados.';}el.count.textContent=`${filtered.length.toLocaleString('pt-BR')} resultado${filtered.length===1?'':'s'}`;
}
function render(){renderKpis();renderTrend();renderStatuses();renderRanking();renderTable();el.freshness.textContent=`Fonte: banco operacional CCO · atualização ${fmtDate(serverTime)} · filtros aplicados a todos os indicadores`;}
async function load(){
  if(!token){el.denied.hidden=false;el.controller.textContent='ACESSO NECESSÁRIO';return;}notify('');el.app.classList.add('loading');
  try{const bounds=dateBounds(),data=await api(`/api/v1/cco/history?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`);records=data.records||[];serverTime=data.serverTime;el.controller.textContent=`${data.controller.code} · ${data.controller.name}`;el.denied.hidden=true;el.app.hidden=false;populateOptions();applyFilters();}
  catch(error){if(error.status===401){el.app.hidden=true;el.denied.hidden=false;el.controller.textContent='SESSÃO EXPIRADA';}else notify(error.message);}
  finally{el.app.classList.remove('loading');}
}
function csvCell(value){return `"${String(value??'').replaceAll('"','""')}"`;}
function exportCsv(){const rows=[['Tipo','Código','Situação','Responsável/equipamento','Detalhe','Linhas','KM inicial','KM final','Início','Fim previsto','Encerramento','Controlador','Descrição']];for(const x of filtered)rows.push([TYPES[x.type],x.code,STATUS[x.status]||x.status,`${x.subject_code} - ${x.subject_name}`,x.subject_detail,(x.lines||[]).map(y=>LINES[y]||y).join(' + '),fmtKm(x.km_start),fmtKm(x.km_end),x.start_at,x.planned_end_at,x.closed_at,`${x.controller_code} - ${x.controller_name}`,x.description]);const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`historico-cco-${el.from.value}-a-${el.to.value}.csv`;a.click();URL.revokeObjectURL(url);}

initializeDates();el.apply.onclick=load;el.refresh.onclick=load;el.clear.onclick=()=>{el.type.value='all';el.status.value='all';el.line.value='all';el.search.value='';applyFilters();};el.export.onclick=exportCsv;for(const input of [el.type,el.status,el.line])input.onchange=applyFilters;el.search.oninput=applyFilters;$('detail-close').onclick=$('detail-ok').onclick=()=>el.detail.close();setInterval(()=>$('clock').textContent=new Date().toLocaleTimeString('pt-BR'),1000);load();
