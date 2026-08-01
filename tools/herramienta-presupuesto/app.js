/* Herramienta de Control de Presupuesto de Compras ALVSOL — V1.4 */
(() => {
'use strict';

const DB_NAME = 'alvsol_presupuesto_compras_v1';
const DB_VERSION = 2;
const STORE = 'app';
const FILE_STORE = 'files';
const APP_KEY = 'state';

const BRANCHES = [
  {code:'BPH', name:'BOX Pradera Huehue', aliases:['BOX PRADERA HUEHUE','INVENTARIO BOX PRADERA HUEHUE']},
  {code:'BUU', name:'BOX Utz Ulew', aliases:['BOX UTZ ULEW','INVENTARIO BOX UTZ ULEW']},
  {code:'BMB', name:'BOX Mont Blanc', aliases:['BOX MONT BLANC','INVENTARIO BOX MONT BLANC']},
  {code:'BL', name:'BOX León (Bodega)', aliases:['BOX LEON','BOX LEÓN','BOX LEON BODEGA','BOX LEÓN BODEGA','INVENTARIO BOX LEON','INVENTARIO BOX LEÓN','INVENTARIO BOX LEON BODEGA','INVENTARIO BOX LEÓN BODEGA']},
  {code:'CCX', name:'Cute Pradera Xela', aliases:['CUTE PRADERA XELA','CUTE CASE XELA','INVENTARIO CUTE PRADERA XELA','INVENTARIO CUTE CASE XELA']},
  {code:'BA', name:'BOX Alturas Mall', aliases:['BOX ALTURAS MALL','BOX ALTURAS','INVENTARIO BOX ALTURAS MALL','INVENTARIO BOX ALTURAS']},
  {code:'CPH', name:'Cute Pradera Huehue', aliases:['CUTE PRADERA HUEHUE','INVENTARIO CUTE PRADERA HUEHUE']},
  {code:'CCA', name:'Cute Alturas Mall', aliases:['CUTE ALTURAS MALL','CUTE CASE ALTURAS','INVENTARIO CUTE ALTURAS MALL','INVENTARIO CUTE CASE ALTURAS']},
  {code:'CCZ', name:'Cute Pradera Zacapa', aliases:['CUTE PRADERA ZACAPA','CUTE CASE ZACAPA','INVENTARIO CUTE PRADERA ZACAPA','INVENTARIO CUTE CASE ZACAPA']},
  {code:'CCC', name:'Cute Pradera Chiquimula', aliases:['CUTE PRADERA CHIQUIMULA','CUTE CASE CHIQUIMULA','INVENTARIO CUTE PRADERA CHIQUIMULA','INVENTARIO CUTE CASE CHIQUIMULA']}
];
const INACTIVE_ALIASES = ['CUTE CASE BARRIOS','PUERTO BARRIOS','CUTE PRADERA BARRIOS','INVENTARIO CUTE CASE BARRIOS'];
const BODEGA_ALIASES = ['INVENTARIO BOX LEON BODEGA','INVENTARIO BOX LEÓN BODEGA','BOX LEON BODEGA','BOX LEÓN BODEGA','BOX LEON (BODEGA)','BOX LEÓN (BODEGA)'];

const NAV = [
  ['dashboard','⌂','Inicio'],
  ['documents','⇧','Documentos'],
  ['purchases','▤','Compras y pagos'],
  ['providers','◫','Proveedores'],
  ['transfers','⇄','Transferencias'],
  ['budget','Q','Presupuesto'],
  ['bank','✓','Conciliación'],
  ['alerts','!','Advertencias'],
  ['close','□','Cierre y exportación']
];

let state = emptyState();
let currentView = 'dashboard';
let db = null;
let ocrWorker = null;
let processing = false;
let saveIndicatorTimer = null;

function emptyState(){
  return {
    schema:2,
    createdAt:new Date().toISOString(),
    currentPeriodId:null,
    periods:[], documents:[], budgets:[], payments:[], purchases:[], transfers:[], bodegaAssignments:[], distributions:[], bankAdjustments:[],
    settings:{lastBackupAt:null,lastSavedAt:null}
  };
}

function normalizeState(){
  let changed=false;if(Number(state.schema)<2){state.schema=2;changed=true;}
  state.periods=Array.isArray(state.periods)?state.periods:[];
  state.documents=Array.isArray(state.documents)?state.documents:[];
  state.budgets=Array.isArray(state.budgets)?state.budgets:[];
  state.payments=Array.isArray(state.payments)?state.payments:[];
  state.purchases=Array.isArray(state.purchases)?state.purchases:[];
  state.transfers=Array.isArray(state.transfers)?state.transfers:[];
  state.bodegaAssignments=Array.isArray(state.bodegaAssignments)?state.bodegaAssignments:[];
  state.distributions=Array.isArray(state.distributions)?state.distributions:[];
  state.bankAdjustments=Array.isArray(state.bankAdjustments)?state.bankAdjustments:[];
  state.settings=state.settings||{lastBackupAt:null,lastSavedAt:null};
  if(state.settings.lastSavedAt===undefined)state.settings.lastSavedAt=null;
  state.settings.migrations=state.settings.migrations||{};
  for(const p of state.periods){
    p.branchBalances=p.branchBalances||{};
    for(const b of BRANCHES)if(p.branchBalances[b.code]==null){p.branchBalances[b.code]=0;changed=true;}
  }
  for(const pu of state.purchases){
    if(pu.destination!=='Inventario BOX León (Bodega)'){pu.destination='Inventario BOX León (Bodega)';changed=true;}
    if(!pu.budgetOriginMode){pu.budgetOriginMode='auto';changed=true;}
    if(pu.manualBudgetOriginPeriodId===undefined){pu.manualBudgetOriginPeriodId='';changed=true;}
  }
  for(const pay of state.payments){
    if(!Array.isArray(pay.allocations)){pay.allocations=[];changed=true;}
    for(const a of pay.allocations){if(!a.createdAt){a.createdAt=pay.createdAt||new Date().toISOString();changed=true;}}
  }
  for(const t of state.transfers){
    const b=BRANCHES.find(x=>x.code===t.destinationCode);if(b&&t.destinationName!==b.name){t.destinationName=b.name;changed=true;}
    for(const l of (t.lines||[])){
      if(!l.allocationType){l.allocationType=l.overrideCurrentQty===0?'prior':(l.overrideCurrentQty!=null&&l.overrideCurrentQty!==''?'split':'auto');changed=true;}
      if(l.manualCost===0&&l.costUsed===0){l.manualCost=null;changed=true;}
      if(!l.providerAllocationMode){l.providerAllocationMode='auto';changed=true;}
      if(!Array.isArray(l.manualProviderAllocations)){l.manualProviderAllocations=[];changed=true;}
    }
  }
  for(const a of state.bodegaAssignments)for(const l of (a.lines||[])){
    if(!l.providerAllocationMode){l.providerAllocationMode='auto';changed=true;}
    if(!Array.isArray(l.manualProviderAllocations)){l.manualProviderAllocations=[];changed=true;}
  }
  // V1.2: corrige el legado donde el saldo inicial de sucursales se duplicó como pendiente general.
  if(!state.settings.migrations.v12OpeningPending){
    for(const p of state.periods){
      const branchOpening=round2(BRANCHES.reduce((sum,b)=>sum+n((p.branchBalances||{})[b.code]),0));
      const openingBank=round2(p.openingBank), openingGeneral=round2(p.openingGeneralPending);
      if(Math.abs(openingGeneral-branchOpening)<=0.01 && Math.abs(openingBank-branchOpening)<=0.01 && Math.abs(branchOpening)>0.01){
        p.openingGeneralPending=0;
        p.migrationNotes=[...(p.migrationNotes||[]),'V1.2: se eliminó la duplicación del saldo inicial de sucursales en el pendiente general.'];
        changed=true;
      }
    }
    state.settings.migrations.v12OpeningPending=true;changed=true;
  }
  if(!state.settings.migrations.v14CrossPeriod){
    state.settings.migrations.v14CrossPeriod=true;
    state.schema=2;
    changed=true;
  }
  return changed;
}

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const uid = (p='id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const round2 = v => Math.round((n(v)+Number.EPSILON)*100)/100;
const round4 = v => Math.round((n(v)+Number.EPSILON)*10000)/10000;
const money = v => new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ',minimumFractionDigits:2}).format(round2(v));
const num = v => new Intl.NumberFormat('es-GT',{maximumFractionDigits:4}).format(n(v));
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const isoToday = () => new Date().toISOString().slice(0,10);
const periodName = p => p ? `${monthName(p.month)} ${p.year}` : 'Sin periodo activo';
const monthName = m => ['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][Number(m)] || '';
const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const currentPeriod = () => state.periods.find(p=>p.id===state.currentPeriodId) || null;
const inPeriod = (arr,pid=state.currentPeriodId) => arr.filter(x=>x.periodId===pid && x.status!=='anulado');
const dateTime = s => s ? new Date(`${s}T12:00:00`).toLocaleDateString('es-GT') : '—';

function parseMoney(v){
  if(typeof v==='number') return round2(v);
  let s=String(v||'').replace(/Q|GTQ|\s/gi,'').replace(/[^0-9,.-]/g,'');
  if(!s) return 0;
  const neg=s.includes('-'); s=s.replace(/-/g,'');
  if(s.includes(',') && s.includes('.')){
    if(s.lastIndexOf('.')>s.lastIndexOf(',')) s=s.replace(/,/g,'');
    else s=s.replace(/\./g,'').replace(',','.');
  } else if(s.includes(',')) {
    const parts=s.split(',');
    if(parts[parts.length-1].length===2) s=parts.slice(0,-1).join('')+'.'+parts.at(-1); else s=s.replace(/,/g,'');
  } else if((s.match(/\./g)||[]).length>1) {
    const parts=s.split('.'); s=parts.slice(0,-1).join('')+'.'+parts.at(-1);
  }
  return round2((neg?-1:1)*(parseFloat(s)||0));
}
function parseCost(v){
  if(typeof v==='number') return round4(v);
  let s=String(v||'').replace(/Q|GTQ|\s/gi,'').replace(/[^0-9,.-]/g,'');
  if(!s) return 0;
  const neg=s.includes('-'); s=s.replace(/-/g,'');
  if(s.includes(',') && s.includes('.')){ if(s.lastIndexOf('.')>s.lastIndexOf(',')) s=s.replace(/,/g,''); else s=s.replace(/\./g,'').replace(',','.'); }
  else if(s.includes(',')){ const parts=s.split(','); if(parts[parts.length-1].length<=4) s=parts.slice(0,-1).join('')+'.'+parts.at(-1); else s=s.replace(/,/g,''); }
  else if((s.match(/\./g)||[]).length>1){ const parts=s.split('.'); s=parts.slice(0,-1).join('')+'.'+parts.at(-1); }
  return round4((neg?-1:1)*(parseFloat(s)||0));
}
function costFmt(v){return `Q ${n(v).toLocaleString('es-GT',{minimumFractionDigits:4,maximumFractionDigits:4})}`}
function parseDate(v){
  const s=String(v||'').trim(); if(!s) return '';
  let m=s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){ let y=Number(m[3]); if(y<100)y+=2000; return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`; }
  m=s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/); if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  const d=new Date(s); return isNaN(d)?'':d.toISOString().slice(0,10);
}
function branchFromText(text){
  const t=norm(text);
  if(INACTIVE_ALIASES.some(a=>t.includes(norm(a)))) return {inactive:true,code:'INACTIVA',name:'Cute Case Barrios / Puerto Barrios'};
  if(BODEGA_ALIASES.some(a=>t.includes(norm(a)))) return {bodega:true,code:'BL',name:'BOX León (Bodega)'};
  for(const b of BRANCHES){ if([b.name,...b.aliases].some(a=>t.includes(norm(a)))) return b; }
  return null;
}
function providerKey(s){ return norm(s).replace(/\b(S A|SA|SOCIEDAD ANONIMA|LTDA|LIMITADA|GUATEMALA)\b/g,'').trim(); }
function statusBadge(text,type='muted'){ return `<span class="badge ${type}">${esc(text)}</span>`; }
function valueClass(v){return n(v)<0?'negative':n(v)>0?'positive':''}

function periodKeyById(periodId){const p=state.periods.find(x=>x.id===periodId);return p?`${String(p.year).padStart(4,'0')}-${String(p.month).padStart(2,'0')}`:'9999-99'}
function periodLabelById(periodId){return periodName(state.periods.find(x=>x.id===periodId))}
function comparePeriodIds(a,b){return periodKeyById(a).localeCompare(periodKeyById(b))}
function paymentAppliedAmount(pay){return round2((pay?.allocations||[]).reduce((s,a)=>s+n(a.amount),0))}
function paymentRemaining(pay){return round2(Math.max(0,n(pay?.amount)-paymentAppliedAmount(pay)))}
function purchaseUnpaid(pu){return round2(Math.max(0,n(pu?.recalcTotal)-paidForPurchase(pu?.id)))}
function purchaseFundingBreakdown(pu){
  if(!pu)return[];const total=round2(Math.max(0,n(pu.recalcTotal)));if(total<=.001)return[];
  if(pu.budgetOriginMode==='manual'&&pu.manualBudgetOriginPeriodId){return [{periodId:pu.manualBudgetOriginPeriodId,amount:total,source:'manual'}]}
  const grouped={};
  for(const pay of state.payments.filter(x=>x.status!=='anulado'))for(const a of (pay.allocations||[]))if(a.purchaseId===pu.id&&n(a.amount)>0)grouped[pay.periodId]=round2(n(grouped[pay.periodId])+n(a.amount));
  const rows=[];let remaining=total;
  for(const periodId of Object.keys(grouped).sort(comparePeriodIds)){const take=round2(Math.min(remaining,n(grouped[periodId])));if(take>0)rows.push({periodId,amount:take,source:'payment'});remaining=round2(remaining-take);if(remaining<=.001)break;}
  if(remaining>.001){const existing=rows.find(r=>r.periodId===pu.periodId);if(existing)existing.amount=round2(existing.amount+remaining);else rows.push({periodId:pu.periodId,amount:remaining,source:'unpaid'});}
  return rows.sort((a,b)=>comparePeriodIds(a.periodId,b.periodId));
}
function purchaseOriginSummary(pu){
  const rows=purchaseFundingBreakdown(pu);if(!rows.length)return 'Sin origen definido';
  return rows.map(r=>`${periodLabelById(r.periodId)} · ${money(r.amount)}${r.source==='unpaid'?' pendiente':''}`).join(' | ');
}
function purchaseHasPriorFunding(pu,referencePeriodId=pu?.periodId){return purchaseFundingBreakdown(pu).some(r=>comparePeriodIds(r.periodId,referencePeriodId)<0&&n(r.amount)>0)}
function pendingPaymentsBefore(periodId){return state.payments.filter(x=>x.status!=='anulado'&&comparePeriodIds(x.periodId,periodId)<0&&paymentRemaining(x)>.01).sort((a,b)=>comparePeriodIds(a.periodId,b.periodId)||(a.date||'').localeCompare(b.date||''))}
function pendingPurchasesBefore(periodId){return state.purchases.filter(x=>x.status!=='anulado'&&comparePeriodIds(x.periodId,periodId)<0&&purchaseUnpaid(x)>.01).sort((a,b)=>comparePeriodIds(a.periodId,b.periodId)||(a.date||'').localeCompare(b.date||''))}

async function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{ const d=req.result; if(!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); if(!d.objectStoreNames.contains(FILE_STORE)) d.createObjectStore(FILE_STORE); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function loadState(){
  db=await openDB();
  const val=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).get(APP_KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  if(val && [1,2].includes(Number(val.schema))) state=val;
  const changed=normalizeState();
  if(changed)await saveState();
}
function setSaveIndicator(status='saved',stamp=null){
  const el=$('#saveIndicator'),text=$('#saveIndicatorText');if(!el||!text)return;
  el.className=`save-indicator ${status}`;
  const labels={saving:'Guardando…',saved:'Todos los cambios guardados',error:'Error al guardar'};
  const when=stamp?` · ${new Date(stamp).toLocaleString('es-GT')}`:'';
  text.textContent=(labels[status]||labels.saved)+(status==='saved'?when:'');
  if(saveIndicatorTimer)clearTimeout(saveIndicatorTimer);
  if(status==='saved')saveIndicatorTimer=setTimeout(()=>el.classList.add('quiet'),4500);else el.classList.remove('quiet');
}
async function saveState(){
  setSaveIndicator('saving');
  try{
    if(!db) db=await openDB();
    const stamp=new Date().toISOString();state.settings=state.settings||{};state.settings.lastSavedAt=stamp;
    await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(state,APP_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    setSaveIndicator('saved',stamp);
  }catch(err){setSaveIndicator('error');throw err;}
}
async function putStoredFile(id,dataUrl){ if(!db)db=await openDB(); await new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,'readwrite');tx.objectStore(FILE_STORE).put(dataUrl,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)}); }
async function getStoredFile(id){ if(!db)db=await openDB(); return new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,'readonly');const r=tx.objectStore(FILE_STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)}); }
async function deleteStoredFile(id){ if(!db)db=await openDB(); await new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,'readwrite');tx.objectStore(FILE_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)}); }
async function getAllStoredFiles(){ if(!db)db=await openDB(); return new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,'readonly');const store=tx.objectStore(FILE_STORE);const out={};const r=store.openCursor();r.onsuccess=e=>{const c=e.target.result;if(c){out[c.key]=c.value;c.continue()}else resolve(out)};r.onerror=()=>reject(r.error)}); }
async function clearStoredFiles(){ if(!db)db=await openDB(); await new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,'readwrite');tx.objectStore(FILE_STORE).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)}); }

function toast(message,type=''){ const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;$('#toastRoot').appendChild(el);setTimeout(()=>el.remove(),4200); }
function modal(title,body,{size='',footer=''}={}){
  $('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal ${size}"><div class="modal-head"><h2>${esc(title)}</h2><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-foot">${footer}</div>`:''}</div></div>`;
}
function closeModal(){ $('#modalRoot').innerHTML=''; }
function confirmBox(title,message,onYes){ modal(title,`<p>${message}</p>`,{size:'small',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="confirmYes" class="btn btn-danger">Confirmar</button>`});$('#confirmYes').onclick=()=>{closeModal();onYes();}; }

function renderNav(){
  $('#nav').innerHTML=NAV.map(([id,icon,label])=>`<button data-nav="${id}" class="${currentView===id?'active':''}"><span class="nav-icon">${icon}</span>${label}</button>`).join('');
}
function renderPeriodSelector(){
  const sel=$('#periodSelector');
  sel.innerHTML=state.periods.length?state.periods.slice().sort((a,b)=>`${b.year}-${b.month}`.localeCompare(`${a.year}-${a.month}`)).map(p=>`<option value="${p.id}" ${p.id===state.currentPeriodId?'selected':''}>${periodName(p)}${p.status==='cerrado'?' · cerrado':''}</option>`).join(''):'<option value="">Sin periodos</option>';
  $('#periodLabel').textContent=periodName(currentPeriod());
}
function setView(v){ currentView=v; render(); }
function render(){
  renderNav();renderPeriodSelector();
  const titles={dashboard:'Inicio',documents:'Documentos',purchases:'Compras y pagos',providers:'Análisis por proveedor',transfers:'Transferencias',budget:'Presupuesto por sucursal',bank:'Conciliación bancaria',alerts:'Advertencias',close:'Cierre y exportación'};
  $('#pageTitle').textContent=titles[currentView]||'Herramienta';
  const view=$('#view');
  if(!currentPeriod() && currentView!=='close') {view.innerHTML=renderNoPeriod();return;}
  const fn={dashboard:renderDashboard,documents:renderDocuments,purchases:renderPurchases,providers:renderProviders,transfers:renderTransfers,budget:renderBudget,bank:renderBank,alerts:renderAlerts,close:renderClose}[currentView]||renderDashboard;
  view.innerHTML=fn();
  setSaveIndicator('saved',state.settings?.lastSavedAt);
  afterRender();
}
function renderNoPeriod(){ return `<div class="card"><div class="empty"><strong>Aún no hay un periodo de trabajo</strong>Registra el mes, el saldo inicial del banco, el pendiente general y los saldos anteriores por sucursal.<div class="section-gap"><button class="btn btn-primary" data-action="new-period">Crear primer periodo</button></div></div></div>`; }

function calc(pid=state.currentPeriodId){
  const p=state.periods.find(x=>x.id===pid); if(!p) return null;
  recomputeTransfers(pid);
  const budgets=inPeriod(state.budgets,pid), payments=inPeriod(state.payments,pid), purchases=inPeriod(state.purchases,pid), transfers=inPeriod(state.transfers,pid), bodegaAssignments=inPeriod(state.bodegaAssignments,pid), distributions=inPeriod(state.distributions,pid), adjustments=inPeriod(state.bankAdjustments,pid);
  const budgetsTotal=round2(budgets.reduce((s,x)=>s+n(x.amount),0));
  const paymentsTotal=round2(payments.reduce((s,x)=>s+n(x.amount),0));
  const purchasesTotal=round2(purchases.reduce((s,x)=>s+n(x.recalcTotal),0));
  const distTotal=round2(distributions.reduce((s,d)=>s+(d.allocations||[]).reduce((a,x)=>a+n(x.amount),0),0));
  const adjustmentsTotal=round2(adjustments.reduce((s,x)=>s+(x.direction==='resta'?-n(x.amount):n(x.amount)),0));
  const expectedBank=round2(n(p.openingBank)+budgetsTotal-paymentsTotal+adjustmentsTotal);
  const actualBank=p.actualBank===''||p.actualBank==null?null:round2(p.actualBank);
  const bankDiff=actualBank==null?null:round2(actualBank-expectedBank);
  const generalPending=round2(n(p.openingGeneralPending)+budgetsTotal-distTotal);
  const transferCurrentValue=round2(transfers.reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.currentValue),0),0));
  const bodegaCurrentValue=round2(bodegaAssignments.reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.currentValue),0),0));
  const currentTransferValue=round2(transferCurrentValue+bodegaCurrentValue);
  const priorTransferValue=round2(transfers.reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.priorValue),0),0));
  const priorTransferQty=round2(transfers.reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.priorQty),0),0));
  const carriedTransferValue=round2([...transfers,...bodegaAssignments].reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.carriedValue),0),0));
  const carriedTransferQty=round2([...transfers,...bodegaAssignments].reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.carriedQty),0),0));
  const currentBudgetTransferValue=round2([...transfers,...bodegaAssignments].reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.currentBudgetValue),0),0));
  const currentBudgetTransferQty=round2([...transfers,...bodegaAssignments].reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.currentBudgetQty),0),0));
  const transferCurrentQty=round2(transfers.reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.currentQty),0),0));
  const bodegaCurrentQty=round2(bodegaAssignments.reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.currentQty),0),0));
  const currentTransferQty=round2(transferCurrentQty+bodegaCurrentQty);
  const pendingInventory=currentPeriodPendingInventory(pid);
  const pendingMerchandiseValue=round2(pendingInventory.reduce((s,r)=>s+n(r.value),0));
  const branchRows=BRANCHES.map(b=>{
    const opening=n((p.branchBalances||{})[b.code]);
    const allocated=round2(distributions.reduce((s,d)=>s+n((d.allocations||[]).find(x=>x.branchCode===b.code)?.amount),0));
    const transferCurrent=round2(transfers.filter(t=>t.destinationCode===b.code).reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.currentValue),0),0));
    const internalCurrent=b.code==='BL'?bodegaCurrentValue:0;
    const current=round2(transferCurrent+internalCurrent);
    const prior=round2(transfers.filter(t=>t.destinationCode===b.code).reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.priorValue),0),0));
    const carried=round2(transfers.filter(t=>t.destinationCode===b.code).reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.carriedValue),0),0)+(b.code==='BL'?bodegaAssignments.reduce((s,t)=>s+(t.lines||[]).reduce((a,l)=>a+n(l.carriedValue),0),0):0));
    const currentBudget=round2(current-carried);
    const final=round2(opening+allocated-current);
    const need=round2(Math.max(0,current-opening-allocated));
    return {...b,opening,allocated,current,prior,carried,currentBudget,final,need};
  });
  const branchOpeningTotal=round2(branchRows.reduce((s,r)=>s+n(r.opening),0));
  const branchPendingTotal=round2(branchRows.reduce((s,r)=>s+n(r.final),0));
  const totalBudgetPending=round2(generalPending+branchPendingTotal);
  const budgetVsBankGap=round2(totalBudgetPending-expectedBank);
  const paymentAllocated=round2(payments.reduce((s,x)=>s+(x.allocations||[]).reduce((a,z)=>a+n(z.amount),0),0));
  const unpaidPurchases=round2(purchases.reduce((s,pu)=>s+Math.max(0,n(pu.recalcTotal)-paidForPurchase(pu.id)),0));
  const unappliedPayments=round2(payments.reduce((s,pay)=>s+paymentRemaining(pay),0));
  const priorPendingPayments=pendingPaymentsBefore(pid),priorPendingPurchases=pendingPurchasesBefore(pid);
  const carriedPurchases=purchases.filter(pu=>purchaseHasPriorFunding(pu,pid));
  const priorPendingPaymentTotal=round2(priorPendingPayments.reduce((s,x)=>s+paymentRemaining(x),0));
  const priorPendingPurchaseTotal=round2(priorPendingPurchases.reduce((s,x)=>s+purchaseUnpaid(x),0));
  const providerData=buildProviderAnalytics(pid,purchases,transfers,bodegaAssignments);
  return {p,budgets,payments,purchases,transfers,bodegaAssignments,distributions,adjustments,budgetsTotal,paymentsTotal,purchasesTotal,distTotal,adjustmentsTotal,expectedBank,actualBank,bankDiff,generalPending,branchOpeningTotal,branchPendingTotal,totalBudgetPending,budgetVsBankGap,currentTransferValue,transferCurrentValue,bodegaCurrentValue,priorTransferValue,priorTransferQty,carriedTransferValue,carriedTransferQty,currentBudgetTransferValue,currentBudgetTransferQty,currentTransferQty,transferCurrentQty,bodegaCurrentQty,pendingInventory,pendingMerchandiseValue,branchRows,paymentAllocated,unpaidPurchases,unappliedPayments,priorPendingPayments,priorPendingPurchases,carriedPurchases,priorPendingPaymentTotal,priorPendingPurchaseTotal,...providerData};
}

function buildProviderAnalytics(pid,purchases,transfers,bodegaAssignments){
  const purchaseMap=new Map();
  for(const pu of purchases){
    const display=String(pu.provider||'Proveedor sin nombre').trim()||'Proveedor sin nombre';const key=providerKey(display)||norm(display)||'SIN_PROVEEDOR';
    let row=purchaseMap.get(key);if(!row){row={key,provider:display,purchaseIds:new Set(),units:0,amount:0,paid:0,pending:0};purchaseMap.set(key,row)}
    row.purchaseIds.add(pu.id);row.units+=round2((pu.lines||[]).reduce((sum,l)=>sum+n(l.qtyAccounting),0));row.amount+=n(pu.recalcTotal);row.paid+=paidForPurchase(pu.id);
  }
  const purchaseRows=[...purchaseMap.values()].map(r=>({...r,purchaseCount:r.purchaseIds.size,units:round2(r.units),amount:round2(r.amount),paid:round2(r.paid),pending:round2(Math.max(0,r.amount-r.paid)),share:0}));
  const totalPurchased=round2(purchaseRows.reduce((s,r)=>s+r.amount,0));for(const r of purchaseRows)r.share=totalPurchased?round4(r.amount/totalPurchased):0;
  purchaseRows.sort((a,b)=>b.amount-a.amount||a.provider.localeCompare(b.provider));
  const consumptionRows=[];
  const addMovement=(record,branchCode,branchName,movementType,reference,line)=>{
    let attributed=0;
    for(const a of (line.providerAllocations||[])){
      const provider=String(a.provider||purchaseProvider(a.purchaseId)||'Proveedor sin nombre');
      const carried=comparePeriodIds(a.budgetOriginPeriodId||record.periodId,record.periodId)<0;
      consumptionRows.push({providerKey:providerKey(provider)||norm(provider),provider,branchCode,branchName,movementType,reference,date:record.date||'',sku:line.sku||'',product:line.product||'',purchaseId:a.purchaseId||'',purchaseNumber:a.purchaseNumber||state.purchases.find(x=>x.id===a.purchaseId)?.number||'',qty:round2(a.qty),budgetCost:round4(line.costUsed),budgetValue:round2(n(a.qty)*n(line.costUsed)),sourceCost:round4(a.sourceCost),sourceValue:round2(n(a.qty)*n(a.sourceCost)),budgetOriginPeriodId:a.budgetOriginPeriodId||record.periodId,budgetOriginLabel:a.budgetOriginLabel||periodLabelById(a.budgetOriginPeriodId||record.periodId),classification:carried?'Presupuesto arrastrado':'Compra del periodo'});attributed+=n(a.qty);
    }
    const unresolved=round2(Math.max(0,n(line.currentQty)-attributed));
    if(unresolved>.0001)consumptionRows.push({providerKey:'SIN_PROVEEDOR',provider:'Sin proveedor determinado',branchCode,branchName,movementType,reference,date:record.date||'',sku:line.sku||'',product:line.product||'',purchaseId:'',purchaseNumber:'',qty:unresolved,budgetCost:round4(line.costUsed),budgetValue:round2(unresolved*n(line.costUsed)),sourceCost:0,sourceValue:0,budgetOriginPeriodId:'',budgetOriginLabel:'Sin origen',classification:'Compra controlada sin origen'});
    if(n(line.priorQty)>.0001)consumptionRows.push({providerKey:'STOCK_ANTERIOR',provider:'Stock anterior / proveedor no determinado',branchCode,branchName,movementType,reference,date:record.date||'',sku:line.sku||'',product:line.product||'',purchaseId:'',purchaseNumber:'',qty:round2(line.priorQty),budgetCost:round4(line.costUsed),budgetValue:round2(line.priorValue),sourceCost:0,sourceValue:0,budgetOriginPeriodId:'',budgetOriginLabel:'Stock anterior',classification:'Stock anterior'});
  };
  for(const t of transfers){const branch=BRANCHES.find(b=>b.code===t.destinationCode);for(const l of (t.lines||[]))addMovement(t,t.destinationCode||'',branch?.name||t.destinationName||t.destinationRaw||'Destino no identificado','Transferencia',t.number||'',l);}
  for(const a of bodegaAssignments)for(const l of (a.lines||[]))addMovement(a,'BL','BOX León (Bodega)','Asignación interna',a.reference||'Asignación a Bodega',l);
  const summaryMap=new Map();
  for(const r of consumptionRows){const key=r.providerKey||'SIN_PROVEEDOR';let x=summaryMap.get(key);if(!x){x={key,provider:r.provider,consumedUnits:0,consumedValue:0,sourceValue:0,branches:new Set()};summaryMap.set(key,x)}x.consumedUnits+=n(r.qty);x.consumedValue+=n(r.budgetValue);x.sourceValue+=n(r.sourceValue);x.branches.add(r.branchCode);}
  const providerRows=[];const allKeys=new Set([...purchaseMap.keys(),...summaryMap.keys()]);
  for(const key of allKeys){const pr=purchaseRows.find(r=>r.key===key),cr=summaryMap.get(key);providerRows.push({key,provider:pr?.provider||cr?.provider||'Proveedor sin nombre',purchaseCount:pr?.purchaseCount||0,purchasedUnits:round2(pr?.units||0),purchasedAmount:round2(pr?.amount||0),paid:round2(pr?.paid||0),pending:round2(pr?.pending||0),share:pr?.share||0,consumedUnits:round2(cr?.consumedUnits||0),consumedValue:round2(cr?.consumedValue||0),sourceConsumedValue:round2(cr?.sourceValue||0),branchCount:cr?.branches?.size||0});}
  providerRows.sort((a,b)=>b.purchasedAmount-a.purchasedAmount||b.consumedValue-a.consumedValue||a.provider.localeCompare(b.provider));
  return {providerPurchaseRows:purchaseRows,providerConsumptionRows:consumptionRows,providerRows,totalProviderPurchased:totalPurchased,totalProviderConsumed:round2(consumptionRows.reduce((s,r)=>s+n(r.budgetValue),0))};
}

function purchaseHistoryForSku(sku,date='9999-12-31'){
  const key=norm(sku);
  return state.purchases.filter(x=>x.status!=='anulado').flatMap(pu=>(pu.lines||[]).filter(x=>norm(x.sku)===key&&n(x.cost)>0).map(x=>({date:pu.date||'0000-00-00',cost:n(x.cost),purchaseId:pu.id,purchaseNumber:pu.number||'',provider:pu.provider||'',product:x.product||''}))).filter(x=>x.date<=date).sort((a,b)=>a.date.localeCompare(b.date)||String(a.purchaseNumber).localeCompare(String(b.purchaseNumber)));
}
function suggestedCostForSku(sku,date='9999-12-31'){
  const last=purchaseHistoryForSku(sku,date).at(-1);
  return last?{cost:round4(last.cost),purchaseId:last.purchaseId,label:`Compra ${last.purchaseNumber||'s/n'} · ${dateTime(last.date)}`}:{cost:null,purchaseId:null,label:'Sin registro de costo'};
}
function providerCandidatesForSku(sku,date='9999-12-31',pid=null){
  const key=norm(sku);if(!key)return[];
  const rows=[];
  for(const pu of state.purchases.filter(x=>x.status!=='anulado'&&(!pid||x.periodId===pid)&&(x.date||periodStartDate(x.periodId))<=date)){
    const matching=(pu.lines||[]).filter(l=>norm(l.sku)===key&&n(l.qtyAccounting)>0);
    if(!matching.length)continue;
    rows.push({purchaseId:pu.id,purchaseNumber:pu.number||'',provider:pu.provider||'Proveedor sin nombre',date:pu.date||'',qty:round2(matching.reduce((q,l)=>q+n(l.qtyAccounting),0)),cost:round4(matching.at(-1)?.cost||0)});
  }
  return rows.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||String(a.purchaseNumber).localeCompare(String(b.purchaseNumber)));
}
function purchaseProvider(purchaseId){const pu=state.purchases.find(x=>x.id===purchaseId);return pu?.provider||'Proveedor sin nombre'}
function providerAllocationSummary(line){
  const source=(Array.isArray(line.providerAllocations)&&line.providerAllocations.length?line.providerAllocations:(line.providerAllocationMode==='manual'?line.manualProviderAllocations:[]))||[];
  const parts=[];
  if(source.length){const grouped={};for(const a of source){const provider=a.provider||purchaseProvider(a.purchaseId);grouped[provider]=round2(n(grouped[provider])+n(a.qty));}parts.push(...Object.entries(grouped).map(([provider,qty])=>`${provider}: ${num(qty)} u.`));}
  else if(n(line.currentQty)>0)parts.push('Sin proveedor determinado');
  if(n(line.priorQty)>0)parts.push(`Stock anterior: ${num(line.priorQty)} u.`);
  return parts.join(' · ')||'—';
}
function periodStartDate(periodId){const p=state.periods.find(x=>x.id===periodId);return p?`${p.year}-${String(p.month).padStart(2,'0')}-01`:'0000-00-00'}
function periodEndDate(periodId){const p=state.periods.find(x=>x.id===periodId);if(!p)return'9999-12-31';const d=new Date(Number(p.year),Number(p.month),0);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function effectiveRecordDate(record){return record?.date||periodStartDate(record?.periodId)}
function buildPurchaseLotEvents(){
  const events=[];let eventSeq=0;
  for(const pu of state.purchases.filter(x=>x.status!=='anulado')){
    const funding=purchaseFundingBreakdown(pu);const total=Math.max(.0001,n(pu.recalcTotal));
    for(const l of (pu.lines||[])){
      const key=norm(l.sku),qty=Math.max(0,n(l.qtyAccounting));if(!key||qty<=0)continue;
      let assigned=0;
      funding.forEach((f,i)=>{const lotQty=i===funding.length-1?round4(qty-assigned):round4(qty*n(f.amount)/total);assigned=round4(assigned+lotQty);if(lotQty<=.00001)return;events.push({eventId:`${pu.id}_${eventSeq++}`,date:pu.date||periodStartDate(pu.periodId),key,sku:l.sku,product:l.product||'',qty:lotQty,cost:round4(l.cost),purchaseId:pu.id,purchaseNumber:pu.number||'',provider:pu.provider||'Proveedor sin nombre',registrationPeriodId:pu.periodId,budgetOriginPeriodId:f.periodId,budgetOriginLabel:periodLabelById(f.periodId)});});
    }
  }
  return events.sort((a,b)=>a.date.localeCompare(b.date)||comparePeriodIds(a.budgetOriginPeriodId,b.budgetOriginPeriodId)||String(a.purchaseNumber).localeCompare(String(b.purchaseNumber)));
}
function recomputeTransfers(pid){
  const purchaseEvents=buildPurchaseLotEvents();
  const movements=[...state.transfers.filter(x=>x.status!=='anulado').map(x=>({kind:'transfer',record:x})),...state.bodegaAssignments.filter(x=>x.status!=='anulado').map(x=>({kind:'bodega',record:x}))].sort((a,b)=>effectiveRecordDate(a.record).localeCompare(effectiveRecordDate(b.record))||(a.record.createdAt||'').localeCompare(b.record.createdAt||''));
  const lotsBySku={},addedEvents=new Set();
  const sortLots=key=>(lotsBySku[key]||[]).sort((a,b)=>comparePeriodIds(a.budgetOriginPeriodId,b.budgetOriginPeriodId)||a.date.localeCompare(b.date)||String(a.purchaseNumber).localeCompare(String(b.purchaseNumber)));
  const availableFor=key=>sortLots(key).reduce((sum,lot)=>sum+n(lot.availableQty),0);
  const addAllocation=(arr,lot,qty)=>{if(qty<=0)return;let row=arr.find(a=>a.purchaseId===lot.purchaseId&&a.budgetOriginPeriodId===lot.budgetOriginPeriodId);if(!row){row={purchaseId:lot.purchaseId,purchaseNumber:lot.purchaseNumber,provider:lot.provider,date:lot.date,qty:0,sourceCost:lot.cost,sourceValue:0,budgetValue:0,budgetOriginPeriodId:lot.budgetOriginPeriodId,budgetOriginLabel:lot.budgetOriginLabel,registrationPeriodId:lot.registrationPeriodId};arr.push(row)}row.qty=round4(row.qty+qty);row.sourceValue=round2(row.qty*n(row.sourceCost));};
  const consume=(key,qty,allocations,predicate=()=>true)=>{let remaining=round4(qty);for(const lot of sortLots(key)){if(remaining<=.00001)break;if(!predicate(lot)||n(lot.availableQty)<=0)continue;const take=round4(Math.min(remaining,n(lot.availableQty)));lot.availableQty=round4(n(lot.availableQty)-take);remaining=round4(remaining-take);addAllocation(allocations,lot,take);}return remaining;};
  for(const m of movements){
    const r=m.record,movementDate=effectiveRecordDate(r);
    for(const e of purchaseEvents){if(addedEvents.has(e.eventId)||e.date>movementDate||comparePeriodIds(e.registrationPeriodId,r.periodId)>0)continue;addedEvents.add(e.eventId);(lotsBySku[e.key]||(lotsBySku[e.key]=[])).push({...e,availableQty:e.qty});}
    for(const l of (r.lines||[])){
      const key=norm(l.sku),sent=Math.max(0,n(m.kind==='bodega'?l.qty:l.qtySent)),avail=Math.max(0,availableFor(key));
      const type=m.kind==='bodega'?'current':(l.allocationType||'auto');let requestedCurrent;
      if(type==='prior')requestedCurrent=0;else if(type==='current')requestedCurrent=sent;else if(type==='split'||(l.overrideCurrentQty!==null&&l.overrideCurrentQty!==undefined&&l.overrideCurrentQty!==''))requestedCurrent=Math.max(0,Math.min(sent,n(l.overrideCurrentQty)));else requestedCurrent=Math.min(sent,avail);
      const targetCurrent=Math.max(0,Math.min(requestedCurrent,avail)),allocations=[],issues=[];let remaining=targetCurrent;
      const manualMode=l.providerAllocationMode==='manual'&&Array.isArray(l.manualProviderAllocations)&&l.manualProviderAllocations.length;
      if(manualMode){let requestedManual=0;for(const ma of l.manualProviderAllocations){const requested=Math.max(0,Math.min(remaining,n(ma.qty)));if(requested<=0)continue;requestedManual+=n(ma.qty);const left=consume(key,requested,allocations,lot=>lot.purchaseId===ma.purchaseId);const used=round4(requested-left);remaining=round4(remaining-used);if(left>.0001)issues.push(`Compra ${state.purchases.find(x=>x.id===ma.purchaseId)?.number||'seleccionada'} sin ${num(left)} unidad(es) disponibles`);if(remaining<=.0001)break;}if(requestedManual>targetCurrent+.001)issues.push('La distribución manual supera la cantidad de compra controlada');}
      if(remaining>.0001)remaining=consume(key,remaining,allocations);
      if(remaining>.0001)issues.push(`${num(remaining)} unidad(es) sin compra de origen`);
      const currentQty=round4(allocations.reduce((sum,a)=>sum+n(a.qty),0));const priorQty=m.kind==='bodega'?0:round4(sent-currentQty);
      const suggestion=suggestedCostForSku(l.sku,movementDate),hasManual=l.manualCost!==null&&l.manualCost!==undefined&&l.manualCost!=='',cost=hasManual?n(l.manualCost):n(suggestion.cost);
      for(const a of allocations)a.budgetValue=round2(n(a.qty)*cost);
      const carriedQty=round4(allocations.filter(a=>comparePeriodIds(a.budgetOriginPeriodId,r.periodId)<0).reduce((sum,a)=>sum+n(a.qty),0));
      const currentBudgetQty=round4(Math.max(0,currentQty-carriedQty));
      const originGroups={};for(const a of allocations){const label=a.budgetOriginLabel||periodLabelById(a.budgetOriginPeriodId);originGroups[label]=round4(n(originGroups[label])+n(a.qty));}
      l.allocationType=type;l.suggestedCost=suggestion.cost;l.costSuggestionLabel=suggestion.label;l.costSourcePurchaseId=suggestion.purchaseId;l.costUsed=round4(cost);l.costSourceLabel=hasManual?'Costo manual':suggestion.label;
      l.currentQty=currentQty;l.priorQty=priorQty;l.currentValue=round2(currentQty*cost);l.priorValue=round2(priorQty*cost);l.carriedQty=carriedQty;l.carriedValue=round2(carriedQty*cost);l.currentBudgetQty=currentBudgetQty;l.currentBudgetValue=round2(currentBudgetQty*cost);
      l.currentShortage=round4(Math.max(0,requestedCurrent-currentQty));l.providerAllocationMode=l.providerAllocationMode||'auto';l.manualProviderAllocations=Array.isArray(l.manualProviderAllocations)?l.manualProviderAllocations:[];l.providerAllocations=allocations;l.providerAllocationIssue=issues.join(' · ');l.providerSourceLabel=providerAllocationSummary(l);l.budgetOriginLabel=Object.entries(originGroups).map(([label,qty])=>`${label}: ${num(qty)} u.`).join(' · ')||(priorQty>0?'Stock anterior':'—');
      if(m.kind==='bodega'){l.qty=sent;l.unassignedQty=l.currentShortage;}
    }
  }
}
function currentPeriodPendingInventory(pid,skipAssignmentId=null){
  recomputeTransfersCoreGuard(pid);const end=periodEndDate(pid),lots=new Map();
  for(const e of buildPurchaseLotEvents().filter(x=>x.date<=end&&comparePeriodIds(x.registrationPeriodId,pid)<=0)){const k=`${e.purchaseId}|${e.key}|${e.budgetOriginPeriodId}`,row=lots.get(k)||{...e,purchasedQty:0,usedQty:0};row.purchasedQty=round4(row.purchasedQty+n(e.qty));lots.set(k,row);}
  const movements=[...state.transfers.filter(x=>x.status!=='anulado'&&effectiveRecordDate(x)<=end),...state.bodegaAssignments.filter(x=>x.status!=='anulado'&&x.id!==skipAssignmentId&&effectiveRecordDate(x)<=end)];
  for(const r of movements)for(const l of (r.lines||[]))for(const a of (l.providerAllocations||[])){const key=`${a.purchaseId}|${norm(l.sku)}|${a.budgetOriginPeriodId||state.purchases.find(x=>x.id===a.purchaseId)?.periodId||''}`,lot=lots.get(key);if(lot)lot.usedQty=round4(n(lot.usedQty)+n(a.qty));}
  const grouped={};
  for(const lot of lots.values()){const available=round4(Math.max(0,n(lot.purchasedQty)-n(lot.usedQty)));if(available<=.0001)continue;const key=lot.key,r=grouped[key]||(grouped[key]={sku:lot.sku,product:lot.product||'',purchasedQty:0,usedQty:0,availableQty:0,lastCost:0,lastDate:'',value:0,originPeriods:new Set(),purchaseNumbers:new Set()});r.purchasedQty+=n(lot.purchasedQty);r.usedQty+=n(lot.usedQty);r.availableQty+=available;r.originPeriods.add(lot.budgetOriginLabel||periodLabelById(lot.budgetOriginPeriodId));r.purchaseNumbers.add(lot.purchaseNumber||'s/n');if(lot.date>=r.lastDate){r.lastDate=lot.date;r.lastCost=n(lot.cost);r.product=lot.product||r.product;}}
  return Object.values(grouped).map(r=>({...r,purchasedQty:round4(r.purchasedQty),usedQty:round4(r.usedQty),availableQty:round4(r.availableQty),originSummary:[...r.originPeriods].join(', '),purchaseSummary:[...r.purchaseNumbers].join(', '),value:round2(r.availableQty*r.lastCost)})).sort((a,b)=>a.product.localeCompare(b.product)||String(a.sku).localeCompare(String(b.sku)));
}
let recomputeGuard=false;
function recomputeTransfersCoreGuard(pid){if(recomputeGuard)return;recomputeGuard=true;try{recomputeTransfers(pid)}finally{recomputeGuard=false}}

function chartPercent(value,max){return max>0?Math.max(0,Math.min(100,n(value)/max*100)):0}
function renderBankFlowChart(c){
  const items=[
    {label:'Saldo inicial',value:n(c.p.openingBank),cls:'bank-opening'},
    {label:'Presupuesto recibido',value:c.budgetsTotal,cls:'bank-income'},
    {label:'Pagos',value:c.paymentsTotal,cls:'bank-payment'},
    {label:'Saldo esperado',value:c.expectedBank,cls:'bank-balance'}
  ];
  const max=Math.max(1,...items.map(x=>Math.abs(x.value)));
  return `<div class="chart-bars vertical">${items.map(x=>`<div class="vbar-item"><div class="vbar-value">${money(x.value)}</div><div class="vbar-track"><span class="vbar-fill ${x.cls}" style="height:${chartPercent(Math.abs(x.value),max)}%"></span></div><div class="vbar-label">${esc(x.label)}</div></div>`).join('')}</div>`;
}
function renderBranchChart(c){
  const max=Math.max(1,...c.branchRows.flatMap(r=>[Math.abs(n(r.current)),Math.abs(n(r.allocated))]));
  return `<div class="branch-chart"><div class="chart-legend"><span><i class="legend-dot expenses"></i>Gastos</span><span><i class="legend-dot increases"></i>Aumentos</span></div>${c.branchRows.map(r=>`<div class="branch-chart-row"><div class="branch-chart-name" title="${esc(r.name)}">${esc(r.name)}</div><div class="branch-chart-bars"><div class="hbar-track"><span class="hbar-fill expenses" style="width:${chartPercent(Math.abs(r.current),max)}%"></span><strong>${money(r.current)}</strong></div><div class="hbar-track"><span class="hbar-fill increases" style="width:${chartPercent(Math.abs(r.allocated),max)}%"></span><strong>${money(r.allocated)}</strong></div></div></div>`).join('')}</div>`;
}
function renderBudgetComposition(c){
  const unassigned=Math.max(0,n(c.generalPending));
  const branchAvailable=Math.max(0,n(c.branchPendingTotal));
  const consumed=Math.max(0,n(c.currentTransferValue));
  const deficit=Math.max(0,-n(c.branchPendingTotal));
  const total=Math.max(1,unassigned+branchAvailable+consumed);
  const values=[
    {label:'Consumido por sucursales/Bodega',value:consumed,cls:'used'},
    {label:'Disponible en sucursales',value:branchAvailable,cls:'branches'},
    {label:'No asignado',value:unassigned,cls:'unassigned'}
  ];
  return `<div class="composition-chart"><div class="composition-strip">${values.map(x=>`<span class="composition-segment ${x.cls}" style="width:${chartPercent(x.value,total)}%" title="${esc(x.label)}: ${money(x.value)}"></span>`).join('')}</div><div class="composition-list">${values.map(x=>`<div><i class="legend-dot ${x.cls}"></i><span>${esc(x.label)}</span><strong>${money(x.value)}</strong></div>`).join('')}${deficit?`<div class="composition-deficit"><i class="legend-dot deficit"></i><span>Déficit neto en sucursales</span><strong>${money(deficit)}</strong></div>`:''}</div><div class="chart-total">Total presupuestario administrado: <strong>${money(round2(unassigned+branchAvailable+consumed))}</strong></div></div>`;
}
function renderProviderChart(c){
  const rows=c.providerPurchaseRows.filter(r=>r.amount>0).slice(0,8);if(!rows.length)return `<div class="empty"><strong>Sin compras por proveedor</strong>Registra compras para visualizar la distribución.</div>`;
  const max=Math.max(1,...rows.map(r=>r.amount));
  return `<div class="provider-bars">${rows.map(r=>`<div class="provider-bar-row"><div class="provider-bar-name" title="${esc(r.provider)}">${esc(r.provider)}</div><div class="provider-bar-track"><div class="provider-bar-fill" style="width:${chartPercent(r.amount,max)}%"></div></div><div class="provider-bar-value">${money(r.amount)}</div></div>`).join('')}</div>`;
}
function renderProviders(){
  const c=calc(),rows=c.providerRows,top=c.providerPurchaseRows[0];
  const providerOptions=rows.map(r=>`<option value="${esc(r.key)}">${esc(r.provider)}</option>`).join('');
  const branchOptions=BRANCHES.map(b=>`<option value="${b.code}">${esc(b.name)}</option>`).join('');
  const matrixProviders=rows.filter(r=>r.purchasedAmount>0||r.consumedUnits>0);
  const cell=(branchCode,key)=>{const rr=c.providerConsumptionRows.filter(x=>x.branchCode===branchCode&&x.providerKey===key);const units=round2(rr.reduce((q,x)=>q+n(x.qty),0)),value=round2(rr.reduce((q,x)=>q+n(x.budgetValue),0));return units?`<span class="money">${money(value)}</span><span class="small muted">${num(units)} u.</span>`:'—'};
  return `<div class="grid cards">
    ${kpi('Proveedores con compras',String(c.providerPurchaseRows.length),`${c.purchases.length} compra(s) registradas`,'info')}
    ${kpi('Total comprado',money(c.totalProviderPurchased),`${num(c.providerPurchaseRows.reduce((q,r)=>q+r.units,0))} unidades`,'success')}
    ${kpi('Consumo atribuido',money(c.totalProviderConsumed),`${num(c.providerConsumptionRows.reduce((q,r)=>q+r.qty,0))} unidades asignadas`,'info')}
    ${kpi('Proveedor principal',top?esc(top.provider):'—',top?`${money(top.amount)} · ${(top.share*100).toFixed(1)}% de compras`:'Sin datos',top?'success':'info')}
  </div>
  <div class="grid two section-gap">
    <div class="card chart-card"><div class="card-head"><div><h2>Compras por proveedor</h2><div class="muted small">Principales proveedores por monto comprado</div></div></div>${renderProviderChart(c)}</div>
    <div class="card"><div class="card-head"><div><h2>Lectura del análisis</h2><div class="muted small">Compra real versus consumo presupuestario asignado</div></div></div><div class="notice"><strong>Compra por proveedor</strong><br>Usa el costo real registrado en cada compra BlueLake.</div><div class="notice section-gap"><strong>Consumo por tienda</strong><br>Usa el último costo aplicado al presupuesto y conserva la compra/proveedor de origen por separado.</div><div class="notice warning section-gap"><strong>Stock anterior</strong><br>Se presenta como proveedor no determinado hasta que exista trazabilidad histórica suficiente.</div></div>
  </div>
  <div class="card section-gap"><div class="card-head"><h2>Resumen de compras y consumo por proveedor</h2><span class="muted">Montos y unidades del periodo</span></div>${rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Proveedor</th><th>Compras</th><th>Unidades compradas</th><th>Monto comprado</th><th>% compras</th><th>Pagado aplicado</th><th>Pendiente pago</th><th>Unidades consumidas</th><th>Consumo presupuestario</th><th>Sucursales</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="strong">${esc(r.provider)}</td><td>${r.purchaseCount}</td><td>${num(r.purchasedUnits)}</td><td class="money">${money(r.purchasedAmount)}</td><td>${(n(r.share)*100).toFixed(1)}%</td><td class="money">${money(r.paid)}</td><td class="money ${r.pending>.01?'negative':''}">${money(r.pending)}</td><td>${num(r.consumedUnits)}</td><td class="money">${money(r.consumedValue)}</td><td>${r.branchCount}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>Sin datos de proveedores</strong>Registra compras para iniciar el análisis.</div>`}</div>
  <div class="card section-gap"><div class="card-head"><h2>Consumo por sucursal y proveedor</h2><span class="muted">Valor presupuestario y unidades</span></div>${matrixProviders.length?`<div class="table-wrap"><table class="table provider-matrix"><thead><tr><th>Sucursal</th>${matrixProviders.map(r=>`<th>${esc(r.provider)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${BRANCHES.map(b=>{const all=c.providerConsumptionRows.filter(x=>x.branchCode===b.code);const totalU=round2(all.reduce((q,x)=>q+n(x.qty),0)),totalV=round2(all.reduce((q,x)=>q+n(x.budgetValue),0));return `<tr><td class="strong">${esc(b.name)}</td>${matrixProviders.map(r=>`<td>${cell(b.code,r.key)}</td>`).join('')}<td><span class="money">${money(totalV)}</span><span class="small muted">${num(totalU)} u.</span></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty"><strong>Sin consumo atribuido</strong>Registra transferencias o asignaciones internas.</div>`}</div>
  <div class="card section-gap"><div class="card-head"><h2>Detalle de consumo</h2><span id="providerDetailCount" class="muted">${c.providerConsumptionRows.length} movimiento(s)</span></div><div class="provider-filter-bar"><div class="field"><label>Proveedor</label><select id="providerFilter" class="control"><option value="">Todos</option>${providerOptions}</select></div><div class="field"><label>Sucursal</label><select id="providerBranchFilter" class="control"><option value="">Todas</option>${branchOptions}</select></div></div><div class="table-wrap section-gap"><table class="table"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Sucursal</th><th>Origen</th><th>Documento</th><th>Compra fuente</th><th>Periodo presupuestario</th><th>SKU</th><th>Producto</th><th>Clasificación</th><th>Unidades</th><th>Costo aplicado</th><th>Consumo</th><th>Costo origen</th></tr></thead><tbody id="providerDetailBody">${c.providerConsumptionRows.map(r=>`<tr class="provider-detail-row" data-provider="${esc(r.providerKey)}" data-branch="${esc(r.branchCode)}"><td>${dateTime(r.date)}</td><td class="strong">${esc(r.provider)}</td><td>${esc(r.branchName)}</td><td>${esc(r.movementType)}</td><td>${esc(r.reference||'—')}</td><td>${esc(r.purchaseNumber||'—')}</td><td>${esc(r.budgetOriginLabel||'—')}</td><td>${esc(r.sku)}</td><td>${esc(r.product)}</td><td>${esc(r.classification)}</td><td>${num(r.qty)}</td><td class="money">${r.budgetCost?costFmt(r.budgetCost):'—'}</td><td class="money">${money(r.budgetValue)}</td><td class="money">${r.sourceCost?costFmt(r.sourceCost):'—'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function renderDashboard(){
  const c=calc(); const alerts=buildAlerts();
  return `<div class="grid cards">
    ${kpi('Saldo esperado en banco',money(c.expectedBank),c.bankDiff==null?'Falta ingresar el saldo real':c.bankDiff===0?'Conciliación cuadrada':`Diferencia ${money(c.bankDiff)}`,c.bankDiff===0?'success':c.bankDiff==null?'info':'danger')}
    ${kpi('Presupuesto no asignado',money(c.generalPending),`En sucursales: ${money(c.branchPendingTotal)}`,c.generalPending<0?'danger':'info')}
    ${kpi('Total presupuestario pendiente',money(c.totalBudgetPending),`Diferencia vs banco: ${money(c.budgetVsBankGap)}`,Math.abs(c.budgetVsBankGap)>.01?'warning':'success')}
    ${kpi('Pagos a proveedores',money(c.paymentsTotal),`Asociado en el periodo: ${money(c.paymentAllocated)}`,c.unappliedPayments>0?'warning':'success')}
    ${kpi('Anticipos arrastrados',money(c.priorPendingPaymentTotal),`${c.priorPendingPayments.length} pago(s) pendientes de periodos anteriores`,c.priorPendingPaymentTotal?'warning':'success')}
  </div>
  <div class="grid dashboard-charts section-gap">
    <div class="card chart-card"><div class="card-head"><div><h2>Flujo bancario</h2><div class="muted small">Entradas, pagos y saldo esperado del periodo</div></div><button class="btn btn-secondary btn-sm" data-nav="bank">Ver conciliación</button></div>${renderBankFlowChart(c)}</div>
    <div class="card chart-card"><div class="card-head"><div><h2>Composición del presupuesto</h2><div class="muted small">Uso, saldos asignados y monto no asignado</div></div><button class="btn btn-secondary btn-sm" data-nav="budget">Ver presupuesto</button></div>${renderBudgetComposition(c)}</div>
  </div>
  <div class="card section-gap chart-card"><div class="card-head"><div><h2>Gastos y aumentos por sucursal</h2><div class="muted small">Comparación de mercadería cargada y presupuesto aprobado</div></div><button class="btn btn-secondary btn-sm" data-nav="budget">Ver detalle</button></div>${renderBranchChart(c)}</div>
  <div class="card section-gap chart-card"><div class="card-head"><div><h2>Compras por proveedor</h2><div class="muted small">Participación de los principales proveedores del periodo</div></div><button class="btn btn-secondary btn-sm" data-nav="providers">Ver análisis</button></div>${renderProviderChart(c)}</div>
  <div class="grid two section-gap">
    <div class="card"><div class="card-head"><h2>Flujo del periodo</h2><div><button class="btn btn-secondary btn-sm" data-action="edit-period">Editar saldos iniciales</button> <button class="btn btn-primary btn-sm" data-action="upload-docs">Subir documentos</button></div></div>
      <div class="branch-balance"><div class="head">Concepto</div><div class="head">Monto</div><div class="head">Concepto</div><div class="head">Monto</div><div class="head">Concepto</div><div class="head">Monto</div>
      <div>Presupuesto recibido</div><div class="money">${money(c.budgetsTotal)}</div><div>Compras registradas</div><div class="money">${money(c.purchasesTotal)}</div><div>Mercadería controlada asignada</div><div class="money">${money(c.currentTransferValue)}</div>
      <div>Pagos realizados</div><div class="money">${money(c.paymentsTotal)}</div><div>Compras sin pago aplicado</div><div class="money ${c.unpaidPurchases?'negative':''}">${money(c.unpaidPurchases)}</div><div>De presupuesto arrastrado</div><div class="money">${money(c.carriedTransferValue)}</div>
      <div>Anticipos arrastrados</div><div class="money">${money(c.priorPendingPaymentTotal)}</div><div>Compras anteriores pendientes</div><div class="money">${money(c.priorPendingPurchaseTotal)}</div><div>Stock anterior sin compra</div><div class="money">${money(c.priorTransferValue)}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Estado por sucursal</h2><button class="btn btn-secondary btn-sm" data-nav="budget">Ver detalle</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Sucursal</th><th>Transferido actual</th><th>Saldo final</th></tr></thead><tbody>${c.branchRows.map(r=>`<tr><td>${esc(r.name)}</td><td class="money">${money(r.current)}</td><td class="money ${valueClass(r.final)}">${money(r.final)}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </div>
  <div class="card section-gap"><div class="card-head"><h2>Atención requerida</h2><button class="btn btn-secondary btn-sm" data-nav="alerts">Todas las advertencias</button></div>${renderAlertList(alerts.slice(0,5))}</div>`;
}
function kpi(label,value,note,type=''){return `<div class="card kpi ${type}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-note">${esc(note)}</div></div>`}

function renderDocuments(){
  const docs=inPeriod(state.documents).slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  return `<div class="card"><div id="dropzone" class="dropzone"><div class="dropzone-title">Arrastra aquí comprobantes, imágenes o PDF</div><div class="dropzone-sub">La herramienta intentará clasificarlos como presupuesto, pago, compra o transferencia.</div><div class="section-gap"><button class="btn btn-primary" data-action="upload-docs">Seleccionar archivos</button> <button class="btn btn-secondary" data-action="manual-document">Registrar manualmente</button></div></div><div id="processStatus" class="section-gap"></div></div>
  <div class="card section-gap"><div class="card-head"><h2>Documentos del periodo</h2><span class="muted">${docs.length} archivo(s)</span></div>${docs.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha de carga</th><th>Archivo</th><th>Clasificación</th><th>Estado</th><th>Registro relacionado</th><th></th></tr></thead><tbody>${docs.map(d=>`<tr><td>${new Date(d.createdAt).toLocaleString('es-GT')}</td><td>${esc(d.name)}</td><td>${esc(typeLabel(d.type))}</td><td>${statusBadge(d.status||'validado',d.status==='requiere_revision'?'warning':d.status==='duplicado'?'danger':'success')}</td><td>${esc(d.relatedLabel||'—')}</td><td class="actions">${d.status==='requiere_revision'?`<button class="btn btn-primary btn-sm" data-action="review-doc" data-id="${d.id}">Revisar</button> `:''}<button class="btn btn-secondary btn-sm" data-action="open-doc" data-id="${d.id}">Abrir</button> <button class="btn btn-danger btn-sm" data-action="delete-doc" data-id="${d.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>No hay documentos cargados</strong>Sube los comprobantes y PDF del periodo.</div>`}</div>`;
}

function renderPurchases(){
  const c=calc(),hasCarry=c.priorPendingPayments.length||c.priorPendingPurchases.length;
  return `<div class="grid cards">
    ${kpi('Compras registradas',money(c.purchasesTotal),`${c.purchases.length} compra(s) del periodo`,'info')}
    ${kpi('Pagos registrados',money(c.paymentsTotal),`${c.payments.length} pago(s) del periodo`,'info')}
    ${kpi('Anticipos arrastrados',money(c.priorPendingPaymentTotal),`${c.priorPendingPayments.length} pago(s) de periodos anteriores`,c.priorPendingPaymentTotal?'warning':'success')}
    ${kpi('Compras anteriores pendientes',money(c.priorPendingPurchaseTotal),`${c.priorPendingPurchases.length} compra(s) por completar`,c.priorPendingPurchaseTotal?'warning':'success')}
  </div>
  <div class="card section-gap carryover-card"><div class="card-head"><div><h2>Compromisos de periodos anteriores</h2><div class="muted small">Pagos, anticipos y compras que continúan vigentes aunque el periodo de origen ya esté cerrado.</div></div>${statusBadge(hasCarry?'Pendientes':'Al día',hasCarry?'warning':'success')}</div>
    ${hasCarry?`${c.priorPendingPayments.length?`<h3>Pagos o anticipos pendientes</h3>${renderPaymentsTable(c.priorPendingPayments,true)}`:''}${c.priorPendingPurchases.length?`<div class="divider"></div><h3>Compras anteriores pendientes de pago</h3>${renderPurchasesTable(c.priorPendingPurchases,true)}`:''}`:`<div class="empty"><strong>No hay compromisos arrastrados</strong>Los pagos y compras de periodos anteriores están completamente asociados.</div>`}
  </div>
  ${c.carriedPurchases.length?`<div class="card section-gap"><div class="card-head"><div><h2>Compras registradas en ${esc(periodName(c.p))} con presupuesto arrastrado</h2><div class="muted small">El pago conserva su efecto bancario en el periodo de origen; la mercadería puede asignarse en el periodo actual.</div></div><span>${statusBadge(`${c.carriedPurchases.length} compra(s)`,'info')}</span></div>${renderPurchasesTable(c.carriedPurchases,false)}</div>`:''}
  <div class="card section-gap"><div class="card-head"><h2>Pagos a proveedores del periodo</h2><div><button class="btn btn-secondary btn-sm" data-action="manual-add" data-type="payment">Agregar manual</button></div></div>${renderPaymentsTable(c.payments,false)}</div>
  <div class="card section-gap"><div class="card-head"><h2>Compras BlueLake registradas en el periodo</h2><div><button class="btn btn-secondary btn-sm" data-action="manual-add" data-type="purchase">Agregar manual</button></div></div>${renderPurchasesTable(c.purchases,false)}</div>`;
}
function renderPaymentsTable(rows,showPeriod=false){
  if(!rows.length)return `<div class="empty"><strong>No hay pagos</strong>Sube un comprobante bancario o registra uno manualmente.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>${showPeriod?'<th>Periodo de origen</th>':''}<th>Fecha</th><th>Referencia</th><th>Proveedor</th><th>Monto</th><th>Aplicado</th><th>Pendiente</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(x=>{const applied=paymentAppliedAmount(x),rem=paymentRemaining(x);return `<tr>${showPeriod?`<td>${esc(periodLabelById(x.periodId))}</td>`:''}<td>${dateTime(x.date)}</td><td class="strong">${esc(x.reference||'—')}</td><td>${esc(x.provider||'—')}</td><td class="money">${money(x.amount)}</td><td class="money">${money(applied)}</td><td class="money ${rem>.01?'negative':''}">${money(rem)}</td><td>${rem<=.01?statusBadge('Asociado','success'):applied?statusBadge('Parcial','warning'):statusBadge(x.isAdvance?'Anticipo':'Sin asociar','warning')}</td><td class="actions"><button class="btn btn-primary btn-sm" data-action="allocate-payment" data-id="${x.id}">${showPeriod?'Revisar y asociar':'Asociar'}</button> <button class="btn btn-secondary btn-sm" data-action="edit-payment" data-id="${x.id}">Editar</button> <button class="btn btn-danger btn-sm" data-action="delete-payment" data-id="${x.id}">Anular</button></td></tr>`}).join('')}</tbody></table></div>`;
}
function renderPurchasesTable(rows,showPeriod=false){
  if(!rows.length)return `<div class="empty"><strong>No hay compras</strong>Sube un PDF de compra BlueLake o registra una compra manual.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>${showPeriod?'<th>Periodo de registro</th>':''}<th>No. compra</th><th>Fecha</th><th>Proveedor</th><th>Descripción</th><th>Origen presupuestario</th><th>Total correcto</th><th>Pagado</th><th>Pendiente</th><th></th></tr></thead><tbody>${rows.map(x=>{const paid=paidForPurchase(x.id),pending=purchaseUnpaid(x);return `<tr>${showPeriod?`<td>${esc(periodLabelById(x.periodId))}</td>`:''}<td class="strong">${esc(x.number||'—')}</td><td>${dateTime(x.date)}</td><td>${esc(x.provider||'—')}</td><td>${esc(x.description||'')}</td><td class="small">${esc(purchaseOriginSummary(x))}</td><td class="money">${money(x.recalcTotal)}</td><td class="money">${money(paid)}</td><td class="money ${pending>.01?'negative':'positive'}">${money(pending)}</td><td class="actions"><button class="btn btn-primary btn-sm" data-action="match-purchase-payment" data-id="${x.id}">Buscar pagos</button> <button class="btn btn-secondary btn-sm" data-action="view-purchase" data-id="${x.id}">Detalle</button> <button class="btn btn-secondary btn-sm" data-action="edit-purchase" data-id="${x.id}">Editar</button></td></tr>`}).join('')}</tbody></table></div>`;
}

function renderTransfers(){
  const c=calc();
  const missingCurrent=c.transfers.reduce((s,t)=>s+(t.lines||[]).filter(l=>n(l.currentQty)>0&&!n(l.costUsed)).length,0);
  return `<div class="grid cards">${kpi('Transferencias',String(c.transfers.length),`${num(c.transferCurrentQty+c.priorTransferQty)} unidades enviadas`,'info')}${kpi('Mercadería controlada',money(c.currentTransferValue),`Incluye ${money(c.bodegaCurrentValue)} para Bodega`,'success')}${kpi('Presupuesto arrastrado',money(c.carriedTransferValue),`${num(c.carriedTransferQty)} unidades con origen anterior`,c.carriedTransferQty?'warning':'success')}${kpi('Stock anterior sin compra',money(c.priorTransferValue),`${num(c.priorTransferQty)} unidades informativas`,c.priorTransferQty?'warning':'success')}${kpi('Compra controlada sin costo',String(missingCurrent),'Stock anterior sin costo no genera alerta',missingCurrent?'danger':'success')}</div>
  <div class="card section-gap"><div class="card-head"><h2>Transferencias BlueLake</h2><div><button class="btn btn-success btn-sm" data-action="add-bodega-assignment">Asignar mercadería a BOX León (Bodega)</button> <button class="btn btn-secondary btn-sm" data-action="manual-add" data-type="transfer">Agregar transferencia manual</button></div></div>${c.transfers.length?`<div class="table-wrap"><table class="table"><thead><tr><th>No.</th><th>Fecha</th><th>Destino</th><th>Estado</th><th>Unidades</th><th>Mercadería controlada</th><th>Presupuesto arrastrado</th><th>Stock anterior sin compra</th><th></th></tr></thead><tbody>${c.transfers.map(t=>{const sent=(t.lines||[]).reduce((s,l)=>s+n(l.qtySent),0),cur=(t.lines||[]).reduce((s,l)=>s+n(l.currentValue),0),carried=(t.lines||[]).reduce((s,l)=>s+n(l.carriedValue),0),old=(t.lines||[]).reduce((s,l)=>s+n(l.priorValue),0);return `<tr><td class="strong">${esc(t.number||'—')}</td><td>${dateTime(t.date)}</td><td>${esc(t.destinationName||t.destinationRaw||'—')}</td><td>${statusBadge(t.transferStatus||'—',norm(t.transferStatus)==='RUTA'?'warning':'info')}</td><td>${num(sent)}</td><td class="money">${money(cur)}</td><td class="money">${money(carried)}</td><td class="money">${money(old)}</td><td class="actions"><button class="btn btn-secondary btn-sm" data-action="view-transfer" data-id="${t.id}">Detalle</button> <button class="btn btn-secondary btn-sm" data-action="edit-transfer" data-id="${t.id}">Editar</button></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty"><strong>No hay transferencias</strong>Sube los PDF generados por BlueLake.</div>`}</div>
  <div class="card section-gap"><div class="card-head"><h2>Asignaciones internas a BOX León (Bodega)</h2><span class="muted">Mercadería comprada que se queda en Bodega</span></div>${c.bodegaAssignments.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Referencia</th><th>Líneas</th><th>Unidades</th><th>Valor asignado</th><th>Observación</th><th></th></tr></thead><tbody>${c.bodegaAssignments.map(a=>`<tr><td>${dateTime(a.date)}</td><td class="strong">${esc(a.reference||'Asignación interna')}</td><td>${(a.lines||[]).length}</td><td>${num((a.lines||[]).reduce((s,l)=>s+n(l.currentQty),0))}</td><td class="money">${money((a.lines||[]).reduce((s,l)=>s+n(l.currentValue),0))}</td><td>${esc(a.notes||'')}</td><td class="actions"><button class="btn btn-secondary btn-sm" data-action="edit-bodega-assignment" data-id="${a.id}">Editar</button> <button class="btn btn-danger btn-sm" data-action="delete-bodega-assignment" data-id="${a.id}">Anular</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>No hay asignaciones internas</strong>La mercadería continúa pendiente hasta transferirse o asignarse formalmente a Bodega.</div>`}</div>
  <div class="card section-gap"><div class="card-head"><div><h2>Mercadería comprada pendiente de asignar</h2><div class="muted small">Incluye compras del periodo y compras arrastradas que siguen identificadas.</div></div><span class="money">${money(c.pendingMerchandiseValue)}</span></div>${c.pendingInventory.length?`<div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Producto</th><th>Periodo(s) de origen</th><th>Compra(s)</th><th>Comprado</th><th>Ya asignado</th><th>Disponible</th><th>Último costo</th><th>Valor pendiente</th></tr></thead><tbody>${c.pendingInventory.map(r=>`<tr><td>${esc(r.sku)}</td><td>${esc(r.product)}</td><td>${esc(r.originSummary||'—')}</td><td>${esc(r.purchaseSummary||'—')}</td><td>${num(r.purchasedQty)}</td><td>${num(r.usedQty)}</td><td class="strong">${num(r.availableQty)}</td><td class="money">${costFmt(r.lastCost)}</td><td class="money">${money(r.value)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>Sin mercadería pendiente</strong>Todo lo comprado y arrastrado ya fue asignado.</div>`}</div>`;
}

function renderBudget(){
  const c=calc();
  return `<div class="grid cards">${kpi('Disponible para distribuir',money(c.generalPending),'Pendiente general actual',c.generalPending<0?'danger':'info')}${kpi('Distribuido en el periodo',money(c.distTotal),`${c.distributions.length} distribución(es)`,'success')}${kpi('Necesidad sin cubrir',money(c.branchRows.reduce((s,r)=>s+r.need,0)),'Considera saldos anteriores',c.branchRows.some(r=>r.need>0)?'warning':'success')}${kpi('Sucursales negativas',String(c.branchRows.filter(r=>r.final<-.01).length),'Saldo que se arrastrará',c.branchRows.some(r=>r.final<-.01)?'danger':'success')}</div>
  <div class="card section-gap"><div class="card-head"><h2>Presupuesto por sucursal</h2><button class="btn btn-primary" data-action="suggest-distribution">Calcular distribución sugerida</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Sucursal</th><th>Saldo anterior</th><th>Asignado del periodo</th><th>Transferencias actuales</th><th>Stock anterior</th><th>Saldo final</th><th>Necesidad</th></tr></thead><tbody>${c.branchRows.map(r=>`<tr><td class="strong">${esc(r.name)}</td><td class="money ${valueClass(r.opening)}">${money(r.opening)}</td><td class="money">${money(r.allocated)}</td><td class="money">${money(r.current)}</td><td class="money">${money(r.prior)}</td><td class="money ${valueClass(r.final)}">${money(r.final)}</td><td class="money ${r.need?'negative':''}">${money(r.need)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card section-gap"><div class="card-head"><h2>Distribuciones aprobadas</h2></div>${c.distributions.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Método</th><th>Monto</th><th>Detalle</th><th></th></tr></thead><tbody>${c.distributions.map(d=>`<tr><td>${dateTime(d.date)}</td><td>${esc(d.method||'Manual')}</td><td class="money">${money((d.allocations||[]).reduce((s,a)=>s+n(a.amount),0))}</td><td>${(d.allocations||[]).filter(a=>n(a.amount)).map(a=>`${esc(BRANCHES.find(b=>b.code===a.branchCode)?.name||a.branchCode)}: ${money(a.amount)}`).join('<br>')}</td><td><button class="btn btn-danger btn-sm" data-action="delete-distribution" data-id="${d.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>No hay distribuciones</strong>El presupuesto recibido permanece pendiente general hasta que apruebes una distribución.</div>`}</div>`;
}

function renderBank(){
  const c=calc(), p=c.p;
  return `<div class="grid two"><div class="card"><h2>Conciliación bancaria</h2><div class="branch-balance section-gap"><div class="head">Concepto</div><div class="head">Monto</div><div class="head">Concepto</div><div class="head">Monto</div><div class="head">Concepto</div><div class="head">Monto</div>
  <div>Saldo inicial</div><div class="money">${money(p.openingBank)}</div><div>Presupuestos recibidos</div><div class="money">${money(c.budgetsTotal)}</div><div>Pagos a proveedores</div><div class="money negative">-${money(c.paymentsTotal)}</div>
  <div>Ajustes excepcionales</div><div class="money">${money(c.adjustmentsTotal)}</div><div>Saldo esperado</div><div class="money strong">${money(c.expectedBank)}</div><div>Saldo real</div><div class="money">${c.actualBank==null?'Pendiente':money(c.actualBank)}</div></div>
  <div class="divider"></div><div class="form-grid"><div class="field"><label>Saldo real en la cuenta</label><input id="actualBankInput" class="control" type="number" step="0.01" value="${c.actualBank==null?'':c.actualBank}"></div><div class="field"><label>Diferencia</label><div class="control money ${c.bankDiff==null?'':valueClass(c.bankDiff)}" style="background:#f6f9fb">${c.bankDiff==null?'Pendiente':money(c.bankDiff)}</div></div></div><div class="section-gap"><button class="btn btn-primary" data-action="save-bank-balance">Guardar saldo real</button> <button class="btn btn-secondary" data-action="add-adjustment">Ajuste excepcional</button></div></div>
  <div class="card"><h2>Resultado</h2>${c.bankDiff==null?`<div class="notice">Ingresa el saldo real que aparece en el banco para completar la conciliación.</div>`:Math.abs(c.bankDiff)<=.01?`<div class="notice"><strong>Cuenta cuadrada.</strong><br>El saldo bancario coincide con los movimientos registrados.</div>`:`<div class="notice danger"><strong>Diferencia de ${money(c.bankDiff)}.</strong><br>${c.bankDiff>0?'El banco tiene más dinero que la herramienta. Revisa presupuestos recibidos o pagos duplicados.':'El banco tiene menos dinero que la herramienta. Revisa pagos faltantes o montos incorrectos.'}</div>`}
  <div class="divider"></div><h3>Composición del control</h3><p class="muted">La conciliación bancaria compara exclusivamente dinero recibido y pagos realizados. El presupuesto pendiente general puede incluir dinero todavía en banco y recursos ya convertidos en mercadería.</p></div></div>
  <div class="card section-gap"><div class="card-head"><h2>Presupuestos recibidos</h2><button class="btn btn-secondary btn-sm" data-action="manual-add" data-type="budget">Agregar manual</button></div>${c.budgets.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Autorización</th><th>Comentario</th><th>Monto</th><th></th></tr></thead><tbody>${c.budgets.map(x=>`<tr><td>${dateTime(x.date)}</td><td>${esc(x.authorization||'—')}</td><td>${esc(x.comment||'')}</td><td class="money">${money(x.amount)}</td><td class="actions"><button class="btn btn-secondary btn-sm" data-action="edit-budget" data-id="${x.id}">Editar</button> <button class="btn btn-danger btn-sm" data-action="delete-budget" data-id="${x.id}">Anular</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>No hay presupuestos recibidos</strong>Sube el comprobante de la transferencia o regístralo manualmente.</div>`}</div>
  <div class="card section-gap"><div class="card-head"><h2>Ajustes excepcionales</h2></div>${c.adjustments.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Motivo</th><th></th></tr></thead><tbody>${c.adjustments.map(x=>`<tr><td>${dateTime(x.date)}</td><td>${x.direction==='resta'?'Resta':'Suma'}</td><td class="money">${money(x.amount)}</td><td>${esc(x.reason)}</td><td><button class="btn btn-danger btn-sm" data-action="delete-adjustment" data-id="${x.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><strong>Sin ajustes</strong>Úsalos solo para reversiones o errores bancarios excepcionales.</div>`}</div>`;
}

function renderAlerts(){ const alerts=buildAlerts();return `<div class="card"><div class="card-head"><h2>Advertencias y guía de corrección</h2><span>${statusBadge(`${alerts.length} abierta(s)`,alerts.length?'warning':'success')}</span></div>${renderAlertList(alerts)}</div>`; }
function renderAlertList(alerts){
  if(!alerts.length)return `<div class="empty"><strong>Todo en orden</strong>No hay advertencias relevantes en este periodo.</div>`;
  return `<div class="alert-list">${alerts.map(a=>`<div class="alert-item ${a.severity||''}"><div class="alert-title">${esc(a.title)}</div><div>${esc(a.message)}</div><div class="alert-meta">${esc(a.guide||'')}</div>${a.action?`<div class="alert-actions"><button class="btn btn-secondary btn-sm" data-action="${a.action}" data-id="${a.id||''}">${esc(a.buttonLabel||'Revisar')}</button></div>`:a.nav?`<div class="alert-actions"><button class="btn btn-secondary btn-sm" data-nav="${a.nav}">${esc(a.buttonLabel||'Revisar')}</button></div>`:''}</div>`).join('')}</div>`;
}
function buildAlerts(){
  const c=calc(); if(!c)return[]; const out=[];
  if(c.actualBank==null)out.push({title:'Falta saldo bancario real',message:'La conciliación no está completa.',guide:'Ingresa el saldo que muestra la cuenta bancaria.',nav:'bank',severity:'info'});
  else if(Math.abs(c.bankDiff)>.01)out.push({title:'Diferencia bancaria',message:`Existe una diferencia de ${money(c.bankDiff)}.`,guide:c.bankDiff>0?'Revisa ingresos no registrados o pagos duplicados.':'Revisa pagos faltantes o ingresos registrados de más.',nav:'bank',severity:'danger'});
  const currentPendingPayments=c.payments.filter(p=>paymentRemaining(p)>.01);if(currentPendingPayments.length)out.push({title:'Pagos del periodo pendientes de aplicar',message:`${currentPendingPayments.length} pago(s) suman ${money(currentPendingPayments.reduce((s,p)=>s+paymentRemaining(p),0))} sin aplicar.`,guide:'Asócialos con compras o mantenlos como anticipos.',nav:'purchases',severity:'warning',buttonLabel:'Ver pagos'});
  for(const p of c.payments){const applied=paymentAppliedAmount(p);if(applied>n(p.amount)+.01)out.push({title:'Pago sobreaplicado',message:`El pago ${p.reference||''} tiene ${money(applied-n(p.amount))} aplicado de más.`,guide:'Corrige la asociación.',action:'allocate-payment',id:p.id,severity:'danger'});}
  const currentPendingPurchases=c.purchases.filter(pu=>purchaseUnpaid(pu)>.01);if(currentPendingPurchases.length)out.push({title:'Compras del periodo pendientes de pago',message:`${currentPendingPurchases.length} compra(s) tienen ${money(currentPendingPurchases.reduce((s,pu)=>s+purchaseUnpaid(pu),0))} pendiente.`,guide:'Busca pagos del periodo actual o de periodos anteriores.',nav:'purchases',severity:'warning',buttonLabel:'Ver compras'});
  for(const pu of c.purchases)if(Math.abs(n(pu.pdfTotal)-n(pu.recalcTotal))>.01)out.push({title:'PDF de compra inconsistente',message:`Compra ${pu.number||''}: PDF ${money(pu.pdfTotal)} vs total correcto ${money(pu.recalcTotal)}.`,guide:'La herramienta usa cantidad contable × costo; verifica el detalle.',action:'edit-purchase',id:pu.id,severity:'warning',buttonLabel:'Revisar compra'});
  const inactive=c.transfers.filter(t=>t.inactiveDestination);if(inactive.length)out.push({title:'Sucursal inactiva detectada',message:`${inactive.length} transferencia(s) apuntan a Puerto Barrios / Cute Case Barrios.`,guide:`Revisa: ${inactive.map(t=>t.number||'s/n').join(', ')}.`,nav:'transfers',severity:'danger'});
  const invalidOrigin=c.transfers.filter(t=>t.originValid===false);if(invalidOrigin.length)out.push({title:'Transferencias con origen no válido',message:`${invalidOrigin.length} transferencia(s) no tienen como origen BOX León (Bodega).`,guide:`Revisa: ${invalidOrigin.map(t=>t.number||'s/n').join(', ')}.`,nav:'transfers',severity:'danger'});
  const missing=[];const shortage=[];
  for(const t of c.transfers)for(const l of (t.lines||[])){if(n(l.currentQty)>0&&!n(l.costUsed))missing.push({source:`Transferencia ${t.number||'s/n'}`,l});if(n(l.currentShortage)>0&&l.allocationType==='current')shortage.push({t,l});}
  for(const a of c.bodegaAssignments)for(const l of (a.lines||[]))if(n(l.currentQty)>0&&!n(l.costUsed))missing.push({source:a.reference||'Asignación a Bodega',l});
  if(missing.length)out.push({title:'Productos de mercadería controlada sin costo',message:`${missing.length} línea(s) requieren costo para afectar presupuesto.`,guide:`Registros: ${[...new Set(missing.map(x=>x.source))].join(', ')}. Las líneas de stock anterior pueden permanecer sin costo.`,nav:'transfers',severity:'danger'});
  if(shortage.length)out.push({title:'Mercadería controlada forzada sin unidades disponibles',message:`${shortage.length} línea(s) superan las compras disponibles del periodo.`,guide:'Reduce la cantidad controlada, marca stock anterior o libera una asignación de Bodega.',nav:'transfers',severity:'warning'});
  const bodegaShort=c.bodegaAssignments.flatMap(a=>(a.lines||[]).filter(l=>n(l.unassignedQty)>0).map(l=>({a,l})));if(bodegaShort.length)out.push({title:'Asignación a Bodega superior a lo disponible',message:`${bodegaShort.length} línea(s) no pudieron asignarse completamente.`,guide:'Reduce la cantidad o revisa las transferencias que consumieron ese SKU.',nav:'transfers',severity:'danger'});
  const providerIssues=[...c.transfers.flatMap(t=>(t.lines||[]).filter(l=>l.providerAllocationIssue).map(l=>({source:`Transferencia ${t.number||'s/n'}`,l}))),...c.bodegaAssignments.flatMap(a=>(a.lines||[]).filter(l=>l.providerAllocationIssue).map(l=>({source:a.reference||'Asignación a Bodega',l})))];
  if(providerIssues.length)out.push({title:'Origen de proveedor requiere revisión',message:`${providerIssues.length} línea(s) tienen una distribución manual que no coincide con las compras disponibles.`,guide:`Revisa: ${[...new Set(providerIssues.map(x=>x.source))].join(', ')}.`,nav:'providers',severity:'warning'});
  if(c.priorPendingPurchases.length)out.push({title:'Compras pendientes de periodos anteriores',message:`${c.priorPendingPurchases.length} compra(s) suman ${money(c.priorPendingPurchaseTotal)} pendiente.`,guide:'Se mantienen visibles en Compromisos de periodos anteriores y pueden asociarse con pagos nuevos.',nav:'purchases',severity:'warning',buttonLabel:'Ver compromisos'});
  if(c.priorPendingPayments.length)out.push({title:'Pagos o anticipos arrastrados',message:`${c.priorPendingPayments.length} pago(s) suman ${money(c.priorPendingPaymentTotal)} sin aplicar.`,guide:'Al registrar una compra, la herramienta buscará estos pagos y te pedirá aprobar la asociación.',nav:'purchases',severity:'warning',buttonLabel:'Ver compromisos'});
  for(const r of c.branchRows)if(r.final<-.01)out.push({title:'Sucursal con saldo negativo',message:`${r.name}: ${money(r.final)}.`,guide:'Inclúyela en la siguiente distribución o arrastra el saldo al próximo mes.',nav:'budget',severity:'warning'});
  if(c.generalPending<-.01)out.push({title:'Presupuesto general negativo',message:`El pendiente general es ${money(c.generalPending)}.`,guide:'La distribución aprobada supera los recursos disponibles.',nav:'budget',severity:'danger'});
  return out;
}

function renderClose(){
  if(!currentPeriod())return `<div class="card"><div class="empty"><strong>No hay periodo</strong><button class="btn btn-primary" data-action="new-period">Crear periodo</button></div></div>`;
  const c=calc(),alerts=buildAlerts(),closed=c.p.status==='cerrado';
  return `<div class="grid two"><div class="card"><h2>Estado de cierre</h2><p>Periodo: <strong>${periodName(c.p)}</strong></p><p>Estado: ${statusBadge(closed?'Cerrado':'Abierto',closed?'success':'info')}</p><div class="divider"></div><div class="branch-balance"><div class="head">Concepto</div><div class="head">Valor</div><div class="head">Concepto</div><div class="head">Valor</div><div class="head">Concepto</div><div class="head">Valor</div><div>Saldo bancario esperado</div><div class="money">${money(c.expectedBank)}</div><div>Presupuesto no asignado</div><div class="money">${money(c.generalPending)}</div><div>Saldo en sucursales</div><div class="money ${valueClass(c.branchPendingTotal)}">${money(c.branchPendingTotal)}</div><div>Total presupuestario pendiente</div><div class="money">${money(c.totalBudgetPending)}</div><div>Diferencia vs banco</div><div class="money ${Math.abs(c.budgetVsBankGap)>.01?'negative':'positive'}">${money(c.budgetVsBankGap)}</div><div>Alertas</div><div>${alerts.length}</div></div><div class="section-gap">${closed?`<button class="btn btn-warning" data-action="reopen-period">Reabrir periodo</button> <button class="btn btn-primary" data-action="create-next-period">Crear siguiente periodo</button>`:`<button class="btn btn-primary" data-action="close-period">Cerrar periodo</button>`}</div></div>
  <div class="card"><h2>Exportación y seguridad</h2><p class="muted">Genera el libro operativo, un resumen ejecutivo o un respaldo completo.</p><div class="grid two section-gap"><button class="btn btn-success" data-action="export-executive">Exportar resumen ejecutivo</button><button class="btn btn-success" data-action="export-excel">Exportar Excel completo</button><button class="btn btn-secondary" data-action="backup">Crear respaldo JSON</button><button class="btn btn-secondary" data-action="restore">Restaurar respaldo</button><button class="btn btn-secondary" data-action="export-evidence">Exportar listado de evidencias</button></div><div class="divider"></div><div class="small muted">Último respaldo: ${state.settings.lastBackupAt?new Date(state.settings.lastBackupAt).toLocaleString('es-GT'):'No registrado'}</div></div></div>
  <div class="card section-gap"><h2>Validaciones antes del cierre</h2>${renderAlertList(alerts)}</div>`;
}

function afterRender(){
  const dz=$('#dropzone');
  if(dz){
    dz.addEventListener('click',e=>{if(!e.target.closest('button'))$('#hiddenFileInput').click()});
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
    dz.addEventListener('drop',e=>processFiles([...e.dataTransfer.files]));
  }
  const providerFilter=$('#providerFilter'),branchFilter=$('#providerBranchFilter');
  if(providerFilter&&branchFilter){const apply=()=>{let visible=0;$$('.provider-detail-row').forEach(row=>{const show=(!providerFilter.value||row.dataset.provider===providerFilter.value)&&(!branchFilter.value||row.dataset.branch===branchFilter.value);row.classList.toggle('hidden',!show);if(show)visible++});const count=$('#providerDetailCount');if(count)count.textContent=`${visible} movimiento(s)`};providerFilter.onchange=apply;branchFilter.onchange=apply;apply();}
}

function typeLabel(t){return ({budget:'Presupuesto recibido',payment:'Pago a proveedor',purchase:'Compra BlueLake',transfer:'Transferencia BlueLake',unknown:'Sin clasificar'})[t]||t||'Sin clasificar'}

async function handleAction(action,el){
  const id=el?.dataset?.id, type=el?.dataset?.type;
  const modifying=new Set(['upload-docs','manual-document','manual-add','edit-period','edit-payment','delete-payment','edit-budget','delete-budget','edit-purchase','edit-transfer','add-bodega-assignment','edit-bodega-assignment','delete-bodega-assignment','allocate-payment','match-purchase-payment','suggest-distribution','delete-distribution','save-bank-balance','add-adjustment','delete-adjustment']);
  if(modifying.has(action)&&currentPeriod()?.status==='cerrado'){toast('El periodo está cerrado. Reábrelo para modificar información.','warning');return;}
  if(action==='close-modal') return closeModal();
  if(action==='new-period') return showPeriodModal();
  if(action==='edit-period') return showPeriodModal(currentPeriod());
  if(action==='upload-docs') return $('#hiddenFileInput').click();
  if(action==='manual-document') return showManualTypeChooser();
  if(action==='manual-add') return showManualForm(type);
  if(action==='open-doc') return openDocument(id);
  if(action==='review-doc') return reviewDocument(id);
  if(action==='delete-doc') return deleteDocument(id);
  if(action==='view-purchase') return showPurchaseDetail(id);
  if(action==='edit-purchase') return showPurchaseForm(state.purchases.find(x=>x.id===id));
  if(action==='edit-payment') return showPaymentForm(state.payments.find(x=>x.id===id));
  if(action==='delete-payment') return deleteRecord('payments',id,'Anular pago');
  if(action==='edit-budget') return showBudgetForm(state.budgets.find(x=>x.id===id));
  if(action==='delete-budget') return deleteRecord('budgets',id,'Anular presupuesto recibido');
  if(action==='allocate-payment') return showPaymentAllocation(id);
  if(action==='match-purchase-payment') return showPurchasePaymentMatcher(id);
  if(action==='view-transfer') return showTransferDetail(id);
  if(action==='edit-transfer') return showTransferForm(state.transfers.find(x=>x.id===id));
  if(action==='add-bodega-assignment') return showBodegaAssignmentForm();
  if(action==='edit-bodega-assignment') return showBodegaAssignmentForm(state.bodegaAssignments.find(x=>x.id===id));
  if(action==='delete-bodega-assignment') return deleteRecord('bodegaAssignments',id,'Anular asignación a Bodega');
  if(action==='suggest-distribution') return showDistributionSuggestion();
  if(action==='delete-distribution') return deleteRecord('distributions',id,'Eliminar distribución');
  if(action==='save-bank-balance') return saveActualBank();
  if(action==='add-adjustment') return showAdjustmentForm();
  if(action==='delete-adjustment') return deleteRecord('bankAdjustments',id,'Eliminar ajuste');
  if(action==='backup') return exportBackup();
  if(action==='restore') return $('#restoreInput').click();
  if(action==='export-excel') return exportExcel();
  if(action==='export-executive') return exportExecutiveExcel();
  if(action==='export-evidence') return exportEvidenceIndex();
  if(action==='close-period') return closePeriodFlow();
  if(action==='reopen-period') return reopenPeriod();
  if(action==='create-next-period') return createNextPeriod();
}

document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-nav]'); if(nav){setView(nav.dataset.nav);return;}
  const a=e.target.closest('[data-action]'); if(a){e.preventDefault();handleAction(a.dataset.action,a);}
});
$('#periodSelector').addEventListener('change',async e=>{state.currentPeriodId=e.target.value||null;await saveState();render()});
$('#hiddenFileInput').addEventListener('change',e=>{processFiles([...e.target.files]);e.target.value=''});
$('#restoreInput').addEventListener('change',e=>{if(e.target.files[0])restoreBackup(e.target.files[0]);e.target.value=''});

function showPeriodModal(existing=null, carry=null){
  const now=new Date(), p=existing||carry||{};
  const balances=p.branchBalances||Object.fromEntries(BRANCHES.map(b=>[b.code,0]));
  modal(existing?'Editar periodo':'Nuevo periodo',`<form id="periodForm"><div class="form-grid three">
    <div class="field"><label>Mes</label><select class="control" name="month">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(p.month||now.getMonth()+1)===i+1?'selected':''}>${monthName(i+1)}</option>`).join('')}</select></div>
    <div class="field"><label>Año</label><input class="control" name="year" type="number" min="2020" max="2100" value="${p.year||now.getFullYear()}" required></div>
    <div class="field"><label>Saldo inicial en banco</label><input id="openingBankInput" class="control" name="openingBank" type="number" step="0.01" value="${n(p.openingBank)}" required></div>
    <div class="field"><label>Pendiente general inicial</label><input id="openingGeneralInput" class="control" name="openingGeneralPending" type="number" step="0.01" value="${n(p.openingGeneralPending)}" required></div>
    <div class="field full"><label>Observación</label><input class="control" name="notes" value="${esc(p.notes||'')}"></div>
  </div><div class="notice section-gap"><strong>Evita duplicar saldos:</strong> el pendiente general inicial debe contener únicamente el presupuesto todavía no asignado. Los saldos de cada sucursal se registran abajo por separado. <button type="button" id="suggestOpeningPending" class="btn btn-secondary btn-sm">Calcular desde banco</button><div id="openingBalanceSummary" class="small section-gap"></div></div><div class="divider"></div><h3>Saldos anteriores por sucursal</h3><div class="form-grid three">${BRANCHES.map(b=>`<div class="field"><label>${esc(b.name)}</label><input class="control branch-opening-input" name="branch_${b.code}" type="number" step="0.01" value="${n(balances[b.code])}"></div>`).join('')}</div></form>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="savePeriod" class="btn btn-primary">Guardar periodo</button>`});
  const updateOpeningSummary=()=>{const bank=parseMoney($('#openingBankInput').value),general=parseMoney($('#openingGeneralInput').value),branches=round2($$('.branch-opening-input').reduce((sum,el)=>sum+parseMoney(el.value),0)),difference=round2(bank-general-branches);$('#openingBalanceSummary').innerHTML=`Banco: <strong>${money(bank)}</strong> · Saldos de sucursales: <strong>${money(branches)}</strong> · Pendiente general: <strong>${money(general)}</strong> · Diferencia inicial: <strong class="${Math.abs(difference)>.01?'negative':'positive'}">${money(difference)}</strong>`;};
  $('#suggestOpeningPending').onclick=()=>{const bank=parseMoney($('#openingBankInput').value),branches=round2($$('.branch-opening-input').reduce((sum,el)=>sum+parseMoney(el.value),0));$('#openingGeneralInput').value=round2(bank-branches);updateOpeningSummary();};
  $$('#periodForm input').forEach(el=>el.addEventListener('input',updateOpeningSummary));updateOpeningSummary();
  $('#savePeriod').onclick=async()=>{
    const f=new FormData($('#periodForm')); const year=Number(f.get('year')),month=Number(f.get('month'));
    if(state.periods.some(x=>x.id!==existing?.id&&x.year===year&&Number(x.month)===month)){toast('Ya existe un periodo para ese mes.','warning');return;}
    const obj=existing||{id:uid('per'),createdAt:new Date().toISOString(),status:'abierto',actualBank:''};
    Object.assign(obj,{year,month,openingBank:parseMoney(f.get('openingBank')),openingGeneralPending:parseMoney(f.get('openingGeneralPending')),notes:String(f.get('notes')||''),branchBalances:Object.fromEntries(BRANCHES.map(b=>[b.code,parseMoney(f.get(`branch_${b.code}`))]))});
    if(!existing)state.periods.push(obj);state.currentPeriodId=obj.id;await saveState();closeModal();currentView='dashboard';render();toast('Periodo guardado.','success');
  };
}
function showManualTypeChooser(){
  modal('Registrar documento manualmente',`<div class="grid two"><button class="btn btn-secondary" data-manual="budget">Presupuesto recibido</button><button class="btn btn-secondary" data-manual="payment">Pago a proveedor</button><button class="btn btn-secondary" data-manual="purchase">Compra BlueLake</button><button class="btn btn-secondary" data-manual="transfer">Transferencia BlueLake</button></div>`,{size:'small'});
  $$('[data-manual]').forEach(b=>b.onclick=()=>{const t=b.dataset.manual;closeModal();showManualForm(t)});
}
function showManualForm(type){
  if(type==='budget')return showBudgetForm();
  if(type==='payment')return showPaymentForm();
  if(type==='purchase')return showPurchaseForm();
  if(type==='transfer')return showTransferForm();
}

function showBudgetForm(item=null,doc=null,parsed=null){
  const x=item||parsed||{};
  modal(item?'Editar presupuesto recibido':'Presupuesto recibido',`<form id="budgetForm"><div class="form-grid">
    <div class="field"><label>Fecha</label><input class="control" name="date" type="date" value="${x.date||isoToday()}" required></div>
    <div class="field"><label>Monto</label><input class="control" name="amount" type="number" step="0.01" value="${n(x.amount)}" required></div>
    <div class="field"><label>Código de autorización / referencia</label><input class="control" name="authorization" value="${esc(x.authorization||'')}"></div>
    <div class="field"><label>Generado por</label><input class="control" name="generatedBy" value="${esc(x.generatedBy||'')}"></div>
    <div class="field"><label>Cuenta origen</label><input class="control" name="fromAccount" value="${esc(x.fromAccount||'')}"></div>
    <div class="field"><label>Cuenta destino</label><input class="control" name="toAccount" value="${esc(x.toAccount||'')}"></div>
    <div class="field full"><label>Comentario</label><input class="control" name="comment" value="${esc(x.comment||'PROVEEDORES')}"></div>
  </div></form>`,{size:'small',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="saveBudget" class="btn btn-primary">Guardar</button>`});
  $('#saveBudget').onclick=async()=>{const f=new FormData($('#budgetForm'));const obj=item||{id:uid('bud'),periodId:state.currentPeriodId,status:'validado',createdAt:new Date().toISOString(),sourceDocId:doc?.id||null};Object.assign(obj,{date:f.get('date'),amount:parseMoney(f.get('amount')),authorization:String(f.get('authorization')||''),generatedBy:String(f.get('generatedBy')||''),fromAccount:String(f.get('fromAccount')||''),toAccount:String(f.get('toAccount')||''),comment:String(f.get('comment')||'')});if(!item)state.budgets.push(obj);if(doc){doc.type='budget';doc.status='validado';doc.relatedLabel=`Presupuesto ${money(obj.amount)}`;}await saveState();closeModal();render();toast('Presupuesto registrado.','success')};
}

function showPaymentForm(item=null,doc=null,parsed=null){
  const x=item||parsed||{};
  modal(item?'Editar pago':'Pago a proveedor',`<form id="paymentForm"><div class="form-grid">
    <div class="field"><label>Fecha</label><input class="control" name="date" type="date" value="${x.date||isoToday()}" required></div>
    <div class="field"><label>Monto pagado</label><input class="control" name="amount" type="number" step="0.01" value="${n(x.amount)}" required></div>
    <div class="field"><label>Referencia</label><input class="control" name="reference" value="${esc(x.reference||'')}"></div>
    <div class="field"><label>Proveedor / beneficiario</label><input class="control" name="provider" value="${esc(x.provider||'')}"></div>
    <div class="field full"><label>Descripción</label><input class="control" name="description" value="${esc(x.description||'')}"></div>
    <div class="field full"><label><input name="isAdvance" type="checkbox" ${x.isAdvance?'checked':''}> Registrar como anticipo mientras se asocia</label></div>
  </div></form>`,{size:'small',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="savePayment" class="btn btn-primary">Guardar</button>`});
  $('#savePayment').onclick=async()=>{const f=new FormData($('#paymentForm'));const obj=item||{id:uid('pay'),periodId:state.currentPeriodId,status:'validado',createdAt:new Date().toISOString(),allocations:[],sourceDocId:doc?.id||null};Object.assign(obj,{date:f.get('date'),amount:parseMoney(f.get('amount')),reference:String(f.get('reference')||''),provider:String(f.get('provider')||''),description:String(f.get('description')||''),isAdvance:f.get('isAdvance')==='on'});if(!item)state.payments.push(obj);if(doc){doc.type='payment';doc.status='validado';doc.relatedLabel=`Pago ${obj.reference||money(obj.amount)}`;}await saveState();closeModal();render();toast('Pago guardado.','success')};
}

function purchaseLinesEditor(lines=[]){
  return `<div class="toolbar"><div class="strong">Detalle de productos</div><button type="button" id="addPurchaseLine" class="btn btn-secondary btn-sm">Agregar línea</button></div><div class="table-wrap"><table class="table" id="purchaseLines"><thead><tr><th>SKU</th><th>Producto</th><th>Solicitada</th><th>Recibida PDF</th><th>Cantidad contable</th><th>Costo</th><th>Total</th><th></th></tr></thead><tbody>${lines.map(purchaseLineRow).join('')}</tbody></table></div>`;
}
function purchaseLineRow(l={}){return `<tr><td><input class="control" data-f="sku" value="${esc(l.sku||'')}"></td><td><input class="control" data-f="product" value="${esc(l.product||'')}"></td><td><input class="control" data-f="qtyRequested" type="number" step="1" value="${n(l.qtyRequested)}"></td><td><input class="control" data-f="qtyReceivedShown" type="number" step="1" value="${n(l.qtyReceivedShown)}"></td><td><input class="control" data-f="qtyAccounting" type="number" step="1" value="${n(l.qtyAccounting??l.qtyRequested)}"></td><td><input class="control" data-f="cost" type="number" step="0.0001" value="${n(l.cost)}"></td><td class="money line-total">${money(n(l.qtyAccounting??l.qtyRequested)*n(l.cost))}</td><td><button type="button" class="btn btn-danger btn-sm remove-line">×</button></td></tr>`}
function collectPurchaseLines(){return $$('#purchaseLines tbody tr').map(tr=>{const v=f=>tr.querySelector(`[data-f="${f}"]`).value;return {sku:v('sku').trim(),product:v('product').trim(),qtyRequested:n(v('qtyRequested')),qtyReceivedShown:n(v('qtyReceivedShown')),qtyAccounting:n(v('qtyAccounting')),cost:round4(parseFloat(v('cost'))||0),lineTotal:round2(n(v('qtyAccounting'))*n(v('cost')))}}).filter(l=>l.sku||l.product)}
function wirePurchaseLines(){
  $('#addPurchaseLine').onclick=()=>{$('#purchaseLines tbody').insertAdjacentHTML('beforeend',purchaseLineRow());wireLineRow($('#purchaseLines tbody tr:last-child'))};
  $$('#purchaseLines tbody tr').forEach(wireLineRow);
}
function wireLineRow(tr){
  tr.querySelector('.remove-line').onclick=()=>tr.remove();
  tr.querySelectorAll('input').forEach(i=>i.addEventListener('input',()=>{const q=n(tr.querySelector('[data-f="qtyAccounting"]').value),c=n(tr.querySelector('[data-f="cost"]').value);tr.querySelector('.line-total').textContent=money(q*c)}));
}
function showPurchaseForm(item=null,doc=null,parsed=null){
  const x=item||parsed||{lines:[]},originMode=x.budgetOriginMode||'auto',originPeriod=x.manualBudgetOriginPeriodId||x.periodId||state.currentPeriodId;
  const periodOptions=state.periods.slice().sort((a,b)=>comparePeriodIds(a.id,b.id)).map(p=>`<option value="${p.id}" ${p.id===originPeriod?'selected':''}>${esc(periodName(p))}</option>`).join('');
  modal(item?'Editar compra BlueLake':'Compra BlueLake',`<form id="purchaseForm"><div class="form-grid three">
    <div class="field"><label>No. compra</label><input class="control" name="number" value="${esc(x.number||'')}"></div><div class="field"><label>Fecha de compra</label><input class="control" name="date" type="date" value="${x.date||isoToday()}"></div><div class="field"><label>Proveedor</label><input class="control" name="provider" value="${esc(x.provider||'')}"></div>
    <div class="field"><label>No. factura</label><input class="control" name="invoice" value="${esc(x.invoice||'')}"></div><div class="field"><label>Serie</label><input class="control" name="series" value="${esc(x.series||'')}"></div><div class="field"><label>Total mostrado en PDF</label><input class="control" name="pdfTotal" type="number" step="0.01" value="${n(x.pdfTotal)}"></div>
    <div class="field"><label>Origen presupuestario</label><select id="budgetOriginMode" class="control" name="budgetOriginMode"><option value="auto" ${originMode==='auto'?'selected':''}>Automático según pagos</option><option value="manual" ${originMode==='manual'?'selected':''}>Definir manualmente</option></select></div>
    <div class="field"><label>Periodo de origen manual</label><select id="manualBudgetOriginPeriodId" class="control" name="manualBudgetOriginPeriodId">${periodOptions}</select></div>
    <div class="field"><label>Periodo de registro</label><input class="control" value="${esc(periodLabelById(x.periodId||state.currentPeriodId))}" disabled></div>
    <div class="field full"><label>Descripción</label><input class="control" name="description" value="${esc(x.description||'')}"></div></div>
    <div id="purchaseOriginHelp" class="notice section-gap"></div><div class="divider"></div>${purchaseLinesEditor(x.lines||[])}</form>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="savePurchase" class="btn btn-primary">Guardar compra</button>`});
  const refreshOrigin=()=>{const manual=$('#budgetOriginMode').value==='manual';$('#manualBudgetOriginPeriodId').disabled=!manual;$('#purchaseOriginHelp').innerHTML=manual?`Toda la compra se considerará financiada con <strong>${esc(periodLabelById($('#manualBudgetOriginPeriodId').value))}</strong>.`:`La herramienta determinará el origen según los pagos asociados. Lo no pagado todavía se atribuirá provisionalmente al periodo de registro.`};
  $('#budgetOriginMode').onchange=refreshOrigin;$('#manualBudgetOriginPeriodId').onchange=refreshOrigin;refreshOrigin();wirePurchaseLines();
  $('#savePurchase').onclick=async()=>{const f=new FormData($('#purchaseForm')),lines=collectPurchaseLines();if(!lines.length){toast('Agrega al menos una línea.','warning');return}const number=String(f.get('number')||'').trim();if(state.purchases.some(y=>y.id!==item?.id&&number&&String(y.number)===number)){toast('Ya existe una compra con ese número.','warning');return}const obj=item||{id:uid('pur'),periodId:state.currentPeriodId,status:'validado',createdAt:new Date().toISOString(),sourceDocId:doc?.id||null};Object.assign(obj,{number,date:f.get('date'),provider:String(f.get('provider')||''),invoice:String(f.get('invoice')||''),series:String(f.get('series')||''),description:String(f.get('description')||''),destination:'Inventario BOX León (Bodega)',pdfTotal:parseMoney(f.get('pdfTotal')),lines,recalcTotal:round2(lines.reduce((s,l)=>s+n(l.lineTotal),0)),budgetOriginMode:String(f.get('budgetOriginMode')||'auto'),manualBudgetOriginPeriodId:f.get('budgetOriginMode')==='manual'?String(f.get('manualBudgetOriginPeriodId')||''):''});if(!item)state.purchases.push(obj);if(doc){doc.type='purchase';doc.status='validado';doc.relatedLabel=`Compra ${obj.number||money(obj.recalcTotal)}`;}recomputeTransfers(state.currentPeriodId);const suggestions=findPaymentCandidatesForPurchase(obj).filter(r=>r.suggestedAmount>.01&&r.providerMatch>0);await saveState();closeModal();render();toast('Compra guardada.','success');if(!item&&suggestions.length)setTimeout(()=>showPurchasePaymentMatcher(obj.id,true),50)};
}

function editorSuggestion(l,date){const s=suggestedCostForSku(l.sku,date||isoToday());return {cost:s.cost,label:s.label};}
function parseProviderAllocations(raw){try{const x=JSON.parse(raw||'[]');return Array.isArray(x)?x:[]}catch{return[]}}
function providerManualSummary(manual,date,sku){
  if(!manual?.length)return 'Automático (FIFO por compras disponibles)';const candidates=providerCandidatesForSku(sku,date);const grouped={};
  for(const a of manual){const c=candidates.find(x=>x.purchaseId===a.purchaseId),provider=c?.provider||purchaseProvider(a.purchaseId);grouped[provider]=round2(n(grouped[provider])+n(a.qty));}
  return Object.entries(grouped).map(([p,q])=>`${p}: ${num(q)} u.`).join(' · ')||'Automático (FIFO por compras disponibles)';
}
function providerEditorSummary(l,date){if(l.providerAllocationMode==='manual'&&l.manualProviderAllocations?.length)return providerManualSummary(l.manualProviderAllocations,date,l.sku);const summary=l.providerSourceLabel||providerAllocationSummary(l);return summary&&summary!=='—'?summary:'Automático (FIFO por compras disponibles)'}
function transferLinesEditor(lines=[],date=isoToday()){
  return `<div class="toolbar"><div class="toolbar-left"><div class="strong">Detalle enviado</div><button type="button" id="addTransferLine" class="btn btn-secondary btn-sm">Agregar línea</button></div><div class="toolbar-right"><button type="button" class="btn btn-secondary btn-sm" data-bulk-type="auto">Automático</button><button type="button" class="btn btn-secondary btn-sm" data-bulk-type="current">Compra controlada</button><button type="button" class="btn btn-secondary btn-sm" data-bulk-type="prior">Stock anterior</button><button type="button" id="clearManualCosts" class="btn btn-secondary btn-sm">Aplicar costos sugeridos</button></div></div><div class="table-wrap"><table class="table transfer-editor" id="transferLines"><thead><tr><th>Sel.</th><th>SKU</th><th>Producto</th><th>Enviada</th><th>Recibida</th><th>Clasificación</th><th>Mercadería controlada</th><th>Costo sugerido</th><th>Fuente costo</th><th>Costo manual</th><th>Origen proveedor</th><th></th></tr></thead><tbody>${lines.map(l=>transferLineRow(l,date)).join('')}</tbody></table></div><p class="small muted">La sugerencia de costo usa el último costo registrado hasta la fecha. El origen de proveedor se sugiere con las compras disponibles en orden FIFO y puede dividirse manualmente entre varias compras o proveedores.</p>`;
}
function transferLineRow(l={},date=isoToday()){
  const sg=editorSuggestion(l,date),type=l.allocationType||'auto',manual=Array.isArray(l.manualProviderAllocations)?l.manualProviderAllocations:[],mode=l.providerAllocationMode||'auto';
  return `<tr><td class="center"><input type="checkbox" data-select-line></td><td><input class="control" data-f="sku" value="${esc(l.sku||'')}"></td><td><input class="control product-input" data-f="product" value="${esc(l.product||'')}"></td><td><input class="control" data-f="qtySent" type="number" step="1" value="${n(l.qtySent)}"></td><td><input class="control" data-f="qtyReceived" type="number" step="1" value="${n(l.qtyReceived)}"></td><td><select class="control" data-f="allocationType"><option value="auto" ${type==='auto'?'selected':''}>Automático</option><option value="current" ${type==='current'?'selected':''}>Compra controlada</option><option value="prior" ${type==='prior'?'selected':''}>Stock anterior</option><option value="split" ${type==='split'?'selected':''}>Mixto</option></select></td><td><input class="control" data-f="overrideCurrentQty" type="number" step="1" min="0" value="${l.overrideCurrentQty??''}" placeholder="Auto"></td><td class="money suggested-cost">${sg.cost==null?'':costFmt(sg.cost)}</td><td class="small source-label">${esc(sg.label)}</td><td><input class="control" data-f="manualCost" type="number" step="0.0001" value="${l.manualCost??''}" placeholder="Usar sugerido"></td><td class="provider-source-cell"><input type="hidden" class="provider-mode-input" data-f="providerAllocationMode" value="${esc(mode)}"><input type="hidden" class="provider-json-input" data-f="manualProviderAllocations" value="${esc(JSON.stringify(manual))}"><button type="button" class="btn btn-secondary btn-sm provider-source-btn">Definir origen</button><div class="provider-source-summary">${esc(providerEditorSummary(l,date))}</div></td><td><button type="button" class="btn btn-danger btn-sm remove-line">×</button></td></tr>`;
}
function collectTransferLines(){return $$('#transferLines tbody tr:not(.provider-editor-row)').map(tr=>{const v=f=>tr.querySelector(`[data-f="${f}"]`).value;return {sku:v('sku').trim(),product:v('product').trim(),qtySent:n(v('qtySent')),qtyReceived:n(v('qtyReceived')),allocationType:v('allocationType')||'auto',manualCost:v('manualCost')===''?null:round4(n(v('manualCost'))),overrideCurrentQty:v('overrideCurrentQty')===''?null:n(v('overrideCurrentQty')),providerAllocationMode:v('providerAllocationMode')||'auto',manualProviderAllocations:parseProviderAllocations(v('manualProviderAllocations'))}}).filter(l=>l.sku||l.product)}
function toggleProviderSourceEditor(tr,date,colspan=12){
  const next=tr.nextElementSibling;if(next?.classList.contains('provider-editor-row')){next.remove();return}$$('.provider-editor-row').forEach(x=>x.remove());
  const skuEl=tr.querySelector('[data-f="sku"], [data-bodega-sku]'),qtyEl=tr.querySelector('[data-f="qtySent"], [data-bodega-qty]'),modeEl=tr.querySelector('.provider-mode-input'),jsonEl=tr.querySelector('.provider-json-input'),summaryEl=tr.querySelector('.provider-source-summary');
  const sku=skuEl?.value||skuEl?.dataset?.bodegaSku||tr.dataset.bodegaSku||'',limit=Math.max(0,n(qtyEl?.value)),candidates=providerCandidatesForSku(sku,date),existing=parseProviderAllocations(jsonEl?.value);
  const detail=document.createElement('tr');detail.className='provider-editor-row';
  detail.innerHTML=`<td colspan="${colspan}"><div class="provider-source-panel"><div class="card-head"><div><h3>Origen de proveedor · SKU ${esc(sku||'sin SKU')}</h3><div class="muted small">Distribuye hasta ${num(limit)} unidad(es). Si dejas una parte sin definir, se completará automáticamente con compras disponibles.</div></div><button type="button" class="btn btn-secondary btn-sm close-provider-editor">Cerrar</button></div>${candidates.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Compra</th><th>Fecha</th><th>Proveedor</th><th>Unidades compradas</th><th>Costo origen</th><th>Unidades de esta salida</th></tr></thead><tbody>${candidates.map(c=>{const ex=existing.find(a=>a.purchaseId===c.purchaseId);return `<tr><td>${esc(c.purchaseNumber||'s/n')}</td><td>${dateTime(c.date)}</td><td class="strong">${esc(c.provider)}</td><td>${num(c.qty)}</td><td class="money">${c.cost?costFmt(c.cost):'—'}</td><td><input class="control provider-allocation-qty" data-purchase-id="${esc(c.purchaseId)}" type="number" min="0" max="${c.qty}" step="1" value="${n(ex?.qty)||''}"></td></tr>`}).join('')}</tbody></table></div>`:`<div class="notice warning">No hay compras controladas disponibles para este SKU antes de la fecha del movimiento. Puedes mantener el origen automático; la línea quedará como proveedor no determinado si no existe una compra identificable.</div>`}<div class="toolbar section-gap"><div id="providerAllocationTotal" class="notice">Asignado manualmente: <strong>${money(0)}</strong></div><div><button type="button" class="btn btn-secondary use-auto-provider">Usar automático</button> <button type="button" class="btn btn-primary save-provider-source">Guardar origen manual</button></div></div></div></td>`;
  tr.after(detail);const refresh=()=>{const total=round2($$('.provider-allocation-qty',detail).reduce((q,i)=>q+n(i.value),0));$('#providerAllocationTotal',detail).innerHTML=`Asignado manualmente: <strong>${num(total)} unidad(es)</strong> · Resto automático: <strong>${num(Math.max(0,limit-total))}</strong>`};$$('.provider-allocation-qty',detail).forEach(i=>i.oninput=refresh);refresh();
  $('.close-provider-editor',detail).onclick=()=>detail.remove();
  $('.use-auto-provider',detail).onclick=()=>{modeEl.value='auto';jsonEl.value='[]';summaryEl.textContent='Automático (FIFO por compras disponibles)';detail.remove()};
  $('.save-provider-source',detail).onclick=()=>{const allocations=$$('.provider-allocation-qty',detail).map(i=>({purchaseId:i.dataset.purchaseId,qty:round2(n(i.value))})).filter(a=>a.qty>0),total=round2(allocations.reduce((q,a)=>q+a.qty,0));if(total>limit+.001){toast('La distribución por proveedor supera la cantidad enviada.','danger');return}modeEl.value=allocations.length?'manual':'auto';jsonEl.value=JSON.stringify(allocations);summaryEl.textContent=allocations.length?providerManualSummary(allocations,date,sku):'Automático (FIFO por compras disponibles)';detail.remove()};
}
function wireTransferLines(date=isoToday()){
  const wireRow=tr=>{tr.querySelector('.remove-line').onclick=e=>{const next=tr.nextElementSibling;if(next?.classList.contains('provider-editor-row'))next.remove();e.target.closest('tr').remove()};const sku=tr.querySelector('[data-f="sku"]');sku.onchange=()=>{const sg=suggestedCostForSku(sku.value,date);tr.querySelector('.suggested-cost').textContent=sg.cost==null?'':costFmt(sg.cost);tr.querySelector('.source-label').textContent=sg.label;};tr.querySelector('.provider-source-btn').onclick=()=>toggleProviderSourceEditor(tr,$('#transferForm [name="date"]')?.value||date,12);};
  $('#addTransferLine').onclick=()=>{$('#transferLines tbody').insertAdjacentHTML('beforeend',transferLineRow({},date));wireRow($('#transferLines tbody tr:last-child'))};$$('#transferLines tbody tr:not(.provider-editor-row)').forEach(wireRow);
  $$('[data-bulk-type]').forEach(b=>b.onclick=()=>{$$('#transferLines tbody tr:not(.provider-editor-row)').filter(tr=>tr.querySelector('[data-select-line]').checked).forEach(tr=>{tr.querySelector('[data-f="allocationType"]').value=b.dataset.bulkType;if(b.dataset.bulkType==='prior')tr.querySelector('[data-f="overrideCurrentQty"]').value='0';else if(b.dataset.bulkType!=='split')tr.querySelector('[data-f="overrideCurrentQty"]').value='';})});
  $('#clearManualCosts').onclick=()=>{$$('#transferLines tbody tr:not(.provider-editor-row)').filter(tr=>tr.querySelector('[data-select-line]').checked||!$$('[data-select-line]:checked').length).forEach(tr=>tr.querySelector('[data-f="manualCost"]').value='')};
}
function showTransferForm(item=null,doc=null,parsed=null){
  recomputeTransfers(state.currentPeriodId);const x=item||parsed||{lines:[]};const formDate=x.date||isoToday();
  modal(item?'Editar transferencia':'Transferencia BlueLake',`<form id="transferForm"><div class="form-grid three">
    <div class="field"><label>No. transferencia</label><input class="control" name="number" value="${esc(x.number||'')}"></div><div class="field"><label>Fecha</label><input class="control" name="date" type="date" value="${formDate}"></div><div class="field"><label>Estado</label><input class="control" name="transferStatus" value="${esc(x.transferStatus||'RUTA')}"></div>
    <div class="field"><label>Origen</label><input class="control" name="originRaw" value="${esc(x.originRaw||'Inventario BOX León (Bodega)')}"></div><div class="field"><label>Destino</label><select class="control" name="destinationCode"><option value="">Selecciona</option>${BRANCHES.filter(b=>b.code!=='BL').map(b=>`<option value="${b.code}" ${x.destinationCode===b.code?'selected':''}>${esc(b.name)}</option>`).join('')}<option value="INACTIVA" ${x.inactiveDestination?'selected':''}>Cute Case Barrios / Puerto Barrios (inactiva)</option></select></div><div class="field"><label>Creado por</label><input class="control" name="createdBy" value="${esc(x.createdBy||'')}"></div>
    <div class="field full"><label>Descripción</label><input class="control" name="description" value="${esc(x.description||'')}"></div></div><div class="divider"></div>${transferLinesEditor(x.lines||[],formDate)}</form>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="saveTransfer" class="btn btn-primary">Guardar transferencia</button>`});
  wireTransferLines(formDate);
  $('#transferForm [name="date"]').addEventListener('change',e=>{$$('#transferLines tbody tr').forEach(tr=>{const sku=tr.querySelector('[data-f="sku"]').value,sg=suggestedCostForSku(sku,e.target.value||isoToday());tr.querySelector('.suggested-cost').textContent=sg.cost==null?'':costFmt(sg.cost);tr.querySelector('.source-label').textContent=sg.label;});});
  $('#saveTransfer').onclick=async()=>{const f=new FormData($('#transferForm')),lines=collectTransferLines();if(!lines.length){toast('Agrega al menos una línea.','warning');return}const number=String(f.get('number')||'').trim();if(state.transfers.some(y=>y.id!==item?.id&&y.periodId===state.currentPeriodId&&number&&String(y.number)===number)){toast('Ya existe una transferencia con ese número.','warning');return}const destinationCode=String(f.get('destinationCode')||''),branch=BRANCHES.find(b=>b.code===destinationCode);const originRaw=String(f.get('originRaw')||'');const obj=item||{id:uid('tra'),periodId:state.currentPeriodId,status:'validado',createdAt:new Date().toISOString(),sourceDocId:doc?.id||null};Object.assign(obj,{number,date:f.get('date'),transferStatus:String(f.get('transferStatus')||''),originRaw,originValid:!!branchFromText(originRaw)?.bodega,destinationCode:branch?.code||'',destinationName:branch?.name||'',inactiveDestination:destinationCode==='INACTIVA',createdBy:String(f.get('createdBy')||''),description:String(f.get('description')||''),lines});if(!item)state.transfers.push(obj);if(doc){doc.type='transfer';doc.status='validado';doc.relatedLabel=`Transferencia ${obj.number||''}`;}recomputeTransfers(state.currentPeriodId);await saveState();closeModal();render();toast('Transferencia guardada.','success')};
}
function showBodegaAssignmentForm(item=null){
  recomputeTransfers(state.currentPeriodId);const available=currentPeriodPendingInventory(state.currentPeriodId,item?.id);const existing=Object.fromEntries((item?.lines||[]).map(l=>[norm(l.sku),l]));const rows=[...available];for(const l of (item?.lines||[]))if(!rows.some(r=>norm(r.sku)===norm(l.sku)))rows.push({sku:l.sku,product:l.product,availableQty:n(l.qty),lastCost:n(l.suggestedCost||l.costUsed),value:n(l.currentValue)});
  modal(item?'Editar asignación a BOX León (Bodega)':'Asignar mercadería a BOX León (Bodega)',`<form id="bodegaForm"><div class="form-grid three"><div class="field"><label>Fecha</label><input class="control" name="date" type="date" value="${item?.date||isoToday()}"></div><div class="field"><label>Referencia</label><input class="control" name="reference" value="${esc(item?.reference||'Asignación interna a Bodega')}"></div><div class="field"><label>Observación</label><input class="control" name="notes" value="${esc(item?.notes||'')}"></div></div><div class="notice section-gap">Selecciona únicamente lo que realmente se quedará en Bodega. Lo demás continuará como mercadería pendiente de asignar.</div><div class="table-wrap section-gap"><table class="table" id="bodegaLines"><thead><tr><th>Usar</th><th>SKU</th><th>Producto</th><th>Disponible</th><th>Último costo</th><th>Cantidad para Bodega</th><th>Costo manual</th><th>Origen proveedor</th></tr></thead><tbody>${rows.map(r=>{const ex=existing[norm(r.sku)]||{};const max=round2(Math.max(n(r.availableQty),n(ex.qty)));const sg=suggestedCostForSku(r.sku,item?.date||isoToday());return `<tr data-bodega-sku="${esc(r.sku)}"><td><input type="checkbox" data-bodega-check="${esc(r.sku)}" ${n(ex.qty)>0?'checked':''}></td><td class="strong">${esc(r.sku)}</td><td>${esc(r.product)}</td><td>${num(max)}</td><td class="money">${sg.cost==null?'':costFmt(sg.cost)}</td><td><input class="control" data-bodega-qty="${esc(r.sku)}" type="number" step="1" min="0" max="${max}" value="${n(ex.qty)||''}"></td><td><input class="control" data-bodega-cost="${esc(r.sku)}" type="number" step="0.0001" value="${ex.manualCost??''}" placeholder="Usar sugerido"></td><td class="provider-source-cell"><input type="hidden" class="provider-mode-input" data-bodega-provider-mode="${esc(r.sku)}" value="${esc(ex.providerAllocationMode||'auto')}"><input type="hidden" class="provider-json-input" data-bodega-provider-json="${esc(r.sku)}" value="${esc(JSON.stringify(ex.manualProviderAllocations||[]))}"><button type="button" class="btn btn-secondary btn-sm bodega-provider-source-btn">Definir origen</button><div class="provider-source-summary">${esc(providerEditorSummary(ex,item?.date||isoToday()))}</div></td></tr>`}).join('')}</tbody></table></div></form>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="saveBodegaAssignment" class="btn btn-primary">Guardar asignación</button>`});
  $$('[data-bodega-check]').forEach(ch=>ch.onchange=()=>{const q=$(`[data-bodega-qty="${CSS.escape(ch.dataset.bodegaCheck)}"]`);if(ch.checked&&!n(q.value))q.value=q.max;else if(!ch.checked)q.value=''});
  $$('.bodega-provider-source-btn').forEach(btn=>btn.onclick=()=>{const tr=btn.closest('tr'),date=$('#bodegaForm [name="date"]').value||isoToday();toggleProviderSourceEditor(tr,date,8)});
  $('#saveBodegaAssignment').onclick=async()=>{const f=new FormData($('#bodegaForm'));const lines=[];for(const ch of $$('[data-bodega-check]'))if(ch.checked){const sku=ch.dataset.bodegaCheck;const qty=n($(`[data-bodega-qty="${CSS.escape(sku)}"]`).value);const max=n($(`[data-bodega-qty="${CSS.escape(sku)}"]`).max);if(qty>max+.001){toast(`${sku}: la cantidad supera lo disponible.`,'danger');return}if(qty>0){const r=rows.find(x=>norm(x.sku)===norm(sku));const costEl=$(`[data-bodega-cost="${CSS.escape(sku)}"]`),modeEl=$(`[data-bodega-provider-mode="${CSS.escape(sku)}"]`),jsonEl=$(`[data-bodega-provider-json="${CSS.escape(sku)}"]`);lines.push({sku,product:r?.product||'',qty,manualCost:costEl.value===''?null:round4(n(costEl.value)),allocationType:'current',providerAllocationMode:modeEl?.value||'auto',manualProviderAllocations:parseProviderAllocations(jsonEl?.value)})}}if(!lines.length){toast('Selecciona al menos un producto.','warning');return}const obj=item||{id:uid('bod'),periodId:state.currentPeriodId,status:'validado',createdAt:new Date().toISOString()};Object.assign(obj,{date:f.get('date'),reference:String(f.get('reference')||''),notes:String(f.get('notes')||''),lines});if(!item)state.bodegaAssignments.push(obj);recomputeTransfers(state.currentPeriodId);await saveState();closeModal();render();toast('Asignación a Bodega guardada.','success')};
}

function showPurchaseDetail(id){
  const x=state.purchases.find(y=>y.id===id);if(!x)return;
  const paid=paidForPurchase(id);
  modal(`Compra ${x.number||''}`,`<div class="grid three"><div class="notice"><strong>Proveedor</strong><br>${esc(x.provider||'—')}</div><div class="notice"><strong>Total correcto</strong><br>${money(x.recalcTotal)}</div><div class="notice ${Math.abs(n(x.pdfTotal)-n(x.recalcTotal))>.01?'warning':''}"><strong>Total PDF</strong><br>${money(x.pdfTotal)}</div></div><div class="notice section-gap"><strong>Periodo de registro:</strong> ${esc(periodLabelById(x.periodId))}<br><strong>Origen presupuestario:</strong> ${esc(purchaseOriginSummary(x))}</div>
  <div class="section-gap"><div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Producto</th><th>Solicitada</th><th>Recibida PDF</th><th>Contable</th><th>Costo</th><th>Total</th></tr></thead><tbody>${(x.lines||[]).map(l=>`<tr><td>${esc(l.sku)}</td><td>${esc(l.product)}</td><td>${num(l.qtyRequested)}</td><td>${num(l.qtyReceivedShown)}</td><td>${num(l.qtyAccounting)}</td><td class="money">${costFmt(l.cost)}</td><td class="money">${money(l.lineTotal)}</td></tr>`).join('')}</tbody></table></div></div><div class="section-gap notice"><strong>Pago aplicado:</strong> ${money(paid)} · <strong>Pendiente:</strong> ${money(Math.max(0,n(x.recalcTotal)-paid))}</div>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cerrar</button><button id="detailEditPurchase" class="btn btn-primary">Editar</button><button id="detailDeletePurchase" class="btn btn-danger">Anular</button>`});
  $('#detailEditPurchase').onclick=()=>{closeModal();showPurchaseForm(x)};
  $('#detailDeletePurchase').onclick=()=>{closeModal();deleteRecord('purchases',id,'Anular compra')};
}
function showTransferDetail(id){
  recomputeTransfers(state.currentPeriodId);const x=state.transfers.find(y=>y.id===id);if(!x)return;
  modal(`Transferencia ${x.number||''}`,`<div class="grid cards"><div class="notice"><strong>Destino</strong><br>${esc(x.destinationName||x.destinationRaw||'—')}</div><div class="notice"><strong>Mercadería controlada</strong><br>${money((x.lines||[]).reduce((s,l)=>s+n(l.currentValue),0))}</div><div class="notice warning"><strong>Presupuesto arrastrado</strong><br>${money((x.lines||[]).reduce((s,l)=>s+n(l.carriedValue),0))}</div><div class="notice"><strong>Stock anterior sin compra</strong><br>${money((x.lines||[]).reduce((s,l)=>s+n(l.priorValue),0))}</div></div>
  <div class="section-gap"><div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Producto</th><th>Enviada</th><th>Clasificación</th><th>Costo usado</th><th>Fuente costo</th><th>Proveedor de origen</th><th>Origen presupuestario</th><th>Mercadería controlada</th><th>Stock anterior</th></tr></thead><tbody>${(x.lines||[]).map(l=>`<tr><td>${esc(l.sku)}</td><td>${esc(l.product)}</td><td>${num(l.qtySent)}</td><td>${esc(({auto:'Automático',current:'Compra controlada',prior:'Stock anterior',split:'Mixto'})[l.allocationType]||'Automático')}</td><td class="money ${n(l.currentQty)>0&&!n(l.costUsed)?'negative':''}">${n(l.costUsed)?costFmt(l.costUsed):(n(l.currentQty)>0?'Sin costo':'—')}</td><td class="small">${esc(l.costSourceLabel||'Sin registro')}</td><td class="small ${l.providerAllocationIssue?'negative':''}">${esc(l.providerSourceLabel||providerAllocationSummary(l))}${l.providerAllocationIssue?`<br>${esc(l.providerAllocationIssue)}`:''}</td><td class="small">${esc(l.budgetOriginLabel||'—')}</td><td>${num(l.currentQty)} · ${money(l.currentValue)}${n(l.carriedQty)>0?`<br><span class="muted">Arrastrado: ${num(l.carriedQty)} · ${money(l.carriedValue)}</span>`:''}</td><td>${num(l.priorQty)} · ${n(l.priorValue)?money(l.priorValue):'Informativo'}</td></tr>`).join('')}</tbody></table></div></div>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cerrar</button><button id="detailEditTransfer" class="btn btn-primary">Editar</button><button id="detailDeleteTransfer" class="btn btn-danger">Anular</button>`});
  $('#detailEditTransfer').onclick=()=>{closeModal();showTransferForm(x)};
  $('#detailDeleteTransfer').onclick=()=>{closeModal();deleteRecord('transfers',id,'Anular transferencia')};
}
function paidForPurchase(purchaseId){return round2(state.payments.filter(p=>p.status!=='anulado').reduce((s,p)=>s+(p.allocations||[]).filter(a=>a.purchaseId===purchaseId).reduce((q,a)=>q+n(a.amount),0),0))}

function findPaymentCandidatesForPurchase(pu){
  if(!pu)return[];const key=providerKey(pu.provider),existingByPay={};
  for(const pay of state.payments.filter(x=>x.status!=='anulado')){const ex=(pay.allocations||[]).find(a=>a.purchaseId===pu.id);if(ex)existingByPay[pay.id]=n(ex.amount);}
  const rows=state.payments.filter(x=>x.status!=='anulado').map(pay=>{const existing=n(existingByPay[pay.id]),available=round2(paymentRemaining(pay)+existing),pk=providerKey(pay.provider),providerMatch=!key||!pk?0:(pk.includes(key)||key.includes(pk)?2:0),dateDistance=Math.abs(new Date(pay.date||0)-new Date(pu.date||0));return {pay,existing,available,providerMatch,dateDistance,suggestedAmount:existing};}).filter(r=>r.available>.01||r.existing>.01).sort((a,b)=>b.providerMatch-a.providerMatch||comparePeriodIds(a.pay.periodId,b.pay.periodId)||a.dateDistance-b.dateDistance);
  let need=round2(Math.max(0,n(pu.recalcTotal)-paidForPurchase(pu.id)+Object.values(existingByPay).reduce((s,v)=>s+n(v),0)));
  const exact=rows.find(r=>r.providerMatch&&Math.abs(r.available-need)<=.01);if(exact&&need>.01)exact.suggestedAmount=need;else for(const r of rows){if(need<=.01)break;if(!r.providerMatch&&rows.some(x=>x.providerMatch))continue;const take=round2(Math.min(need,r.available));if(take>.01){r.suggestedAmount=Math.max(r.suggestedAmount,take);need=round2(need-take);}}
  return rows;
}
function showPurchasePaymentMatcher(purchaseId,autoSuggested=false){
  const pu=state.purchases.find(x=>x.id===purchaseId);if(!pu)return;const candidates=findPaymentCandidatesForPurchase(pu),existingTotal=paidForPurchase(pu.id);
  modal('Asociar compra con pagos',`${autoSuggested?`<div class="notice success"><strong>Coincidencia sugerida.</strong><br>Se encontraron pagos que podrían corresponder a esta compra. Revisa y aprueba.</div>`:''}<div class="notice"><strong>Compra ${esc(pu.number||'sin número')}:</strong> ${esc(pu.provider||'—')} · ${money(pu.recalcTotal)} · registrada en ${esc(periodLabelById(pu.periodId))}<br><span class="small">Los pagos conservan su efecto bancario en su periodo original. La mercadería heredará ese origen presupuestario.</span></div>
  ${candidates.length?`<div class="table-wrap section-gap"><table class="table" id="purchasePaymentTable"><thead><tr><th>Usar</th><th>Periodo del pago</th><th>Fecha</th><th>Referencia</th><th>Proveedor</th><th>Pago</th><th>Aplicado a otras compras</th><th>Disponible</th><th>Monto para esta compra</th></tr></thead><tbody>${candidates.map(r=>{const other=round2(paymentAppliedAmount(r.pay)-r.existing),val=r.suggestedAmount||r.existing;return `<tr><td><input type="checkbox" data-pay-check="${r.pay.id}" ${val>.01?'checked':''}></td><td>${esc(periodLabelById(r.pay.periodId))}</td><td>${dateTime(r.pay.date)}</td><td class="strong">${esc(r.pay.reference||'—')}</td><td>${esc(r.pay.provider||'—')}</td><td class="money">${money(r.pay.amount)}</td><td class="money">${money(other)}</td><td class="money">${money(r.available)}</td><td><input class="control" data-pay-amount="${r.pay.id}" type="number" step="0.01" min="0" max="${r.available}" value="${val>.01?val:''}"></td></tr>`}).join('')}</tbody></table></div><div id="purchasePaymentSummary" class="notice section-gap"></div>`:`<div class="empty section-gap"><strong>No hay pagos disponibles</strong>Registra un pago o conserva la compra como pendiente.</div>`}`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button>${candidates.length?'<button id="savePurchasePayments" class="btn btn-primary">Aprobar asociaciones</button>':''}`});
  if(!candidates.length)return;
  const refresh=()=>{let sum=0;$$('[data-pay-amount]').forEach(i=>{if($(`[data-pay-check="${i.dataset.payAmount}"]`).checked)sum+=n(i.value)});const total=round2(sum),pending=round2(n(pu.recalcTotal)-total);$('#purchasePaymentSummary').innerHTML=`Aplicado a la compra: <strong>${money(total)}</strong> · Pendiente: <strong class="${pending>.01?'negative':'positive'}">${money(Math.max(0,pending))}</strong>${pending<-.01?` · <span class="negative">Exceso ${money(-pending)}</span>`:''}`};
  $$('[data-pay-check]').forEach(ch=>ch.onchange=()=>{const i=$(`[data-pay-amount="${ch.dataset.payCheck}"]`),row=candidates.find(r=>r.pay.id===ch.dataset.payCheck);if(ch.checked&&!n(i.value))i.value=Math.min(row.available,Math.max(0,n(pu.recalcTotal)-paidForPurchase(pu.id))).toFixed(2);if(!ch.checked)i.value='';refresh()});$$('[data-pay-amount]').forEach(i=>i.oninput=refresh);refresh();
  $('#savePurchasePayments').onclick=async()=>{const selected={};for(const ch of $$('[data-pay-check]'))if(ch.checked){const amount=round2(n($(`[data-pay-amount="${ch.dataset.payCheck}"]`).value));if(amount>0)selected[ch.dataset.payCheck]=amount;}const total=round2(Object.values(selected).reduce((s,v)=>s+n(v),0));if(total>n(pu.recalcTotal)+.01){toast('La suma aplicada supera el total de la compra.','danger');return}for(const r of candidates){const pay=r.pay,other=(pay.allocations||[]).filter(a=>a.purchaseId!==pu.id),amount=n(selected[pay.id]);if(round2(other.reduce((s,a)=>s+n(a.amount),0)+amount)>n(pay.amount)+.01){toast(`El pago ${pay.reference||''} quedaría sobreaplicado.`,'danger');return}pay.allocations=amount>0?[...other,{purchaseId:pu.id,amount,createdAt:new Date().toISOString()}]:other;if(paymentRemaining(pay)>.01&&amount>0)pay.isAdvance=true;}recomputeTransfers(state.currentPeriodId);await saveState();closeModal();render();toast('Asociaciones de la compra guardadas.','success')};
}

function showPaymentAllocation(paymentId){
  const pay=state.payments.find(x=>x.id===paymentId);if(!pay)return;
  const purchases=state.purchases.filter(p=>p.status!=='anulado' && Math.max(0,n(p.recalcTotal)-paidForPurchase(p.id)+(pay.allocations||[]).filter(a=>a.purchaseId===p.id).reduce((s,a)=>s+n(a.amount),0))>.01).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const exact=suggestPurchaseCombination(pay,purchases);
  const existing=Object.fromEntries((pay.allocations||[]).map(a=>[a.purchaseId,n(a.amount)]));
  if(exact)for(const a of exact)if(existing[a.purchaseId]==null)existing[a.purchaseId]=a.amount;
  modal('Asociar pago con compras',`<div class="notice"><strong>Pago:</strong> ${esc(pay.provider||'—')} · ${money(pay.amount)} · ${dateTime(pay.date)} · <strong>${esc(periodLabelById(pay.periodId))}</strong><br><span class="small">Puedes asociarlo con compras del periodo actual o de otros periodos. El pago conservará su efecto bancario en ${esc(periodLabelById(pay.periodId))}.</span></div>
  <div class="table-wrap section-gap"><table class="table" id="allocationTable"><thead><tr><th>Usar</th><th>Periodo registro</th><th>Compra</th><th>Fecha</th><th>Proveedor</th><th>Origen presupuestario</th><th>Total</th><th>Ya pagado</th><th>Monto a aplicar</th></tr></thead><tbody>${purchases.map(p=>{const due=Math.max(0,round2(n(p.recalcTotal)-paidForPurchase(p.id)+(existing[p.id]||0)));const val=existing[p.id]||0;return `<tr><td><input type="checkbox" data-check="${p.id}" ${val?'checked':''}></td><td>${esc(periodLabelById(p.periodId))}</td><td class="strong">${esc(p.number||'—')}</td><td>${dateTime(p.date)}</td><td>${esc(p.provider||'')}</td><td class="small">${esc(purchaseOriginSummary(p))}</td><td class="money">${money(p.recalcTotal)}</td><td class="money">${money(Math.max(0,paidForPurchase(p.id)-(existing[p.id]||0)))}</td><td><input class="control" data-amount="${p.id}" type="number" step="0.01" min="0" max="${due}" value="${val||''}"></td></tr>`}).join('')}</tbody></table></div><div id="allocationSummary" class="notice section-gap"></div><label class="section-gap" style="display:block"><input id="markAdvance" type="checkbox" ${pay.isAdvance?'checked':''}> Mantener remanente como anticipo</label>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="saveAllocation" class="btn btn-primary">Aprobar asociación</button>`});
  const refresh=()=>{let sum=0;$$('[data-amount]').forEach(i=>{if($(`[data-check="${i.dataset.amount}"]`).checked)sum+=n(i.value)});$('#allocationSummary').innerHTML=`Aplicado: <strong>${money(sum)}</strong> · Restante del pago: <strong>${money(n(pay.amount)-sum)}</strong>`};
  $$('[data-check]').forEach(ch=>ch.onchange=()=>{const i=$(`[data-amount="${ch.dataset.check}"]`);if(ch.checked&&!n(i.value)){const p=purchases.find(x=>x.id===ch.dataset.check);i.value=Math.min(Math.max(0,n(p.recalcTotal)-paidForPurchase(p.id)),n(pay.amount)).toFixed(2)}if(!ch.checked)i.value='';refresh()});
  $$('[data-amount]').forEach(i=>i.oninput=refresh);refresh();
  $('#saveAllocation').onclick=async()=>{const allocations=[];let sum=0;$$('[data-check]').forEach(ch=>{if(ch.checked){const amount=round2(n($(`[data-amount="${ch.dataset.check}"]`).value));if(amount>0){allocations.push({purchaseId:ch.dataset.check,amount,createdAt:new Date().toISOString()});sum+=amount}}});if(sum>n(pay.amount)+.01){toast('La suma aplicada supera el pago.','danger');return}pay.allocations=allocations;pay.isAdvance=$('#markAdvance').checked;recomputeTransfers(state.currentPeriodId);await saveState();closeModal();render();toast('Asociación guardada.','success')};
}
function suggestPurchaseCombination(pay,purchases){
  const key=providerKey(pay.provider);const target=n(pay.amount);
  const candidates=purchases.filter(p=>{const due=Math.max(0,n(p.recalcTotal)-paidForPurchase(p.id));return due>.01&&(!key||providerKey(p.provider).includes(key)||key.includes(providerKey(p.provider)))}).map(p=>({purchaseId:p.id,amount:round2(Math.min(n(p.recalcTotal)-paidForPurchase(p.id),target)),date:p.date})).sort((a,b)=>Math.abs(new Date(a.date||0)-new Date(pay.date||0))-Math.abs(new Date(b.date||0)-new Date(pay.date||0))).slice(0,12);
  let best=null;function rec(i,chosen,sum){if(Math.abs(sum-target)<=.01){best=chosen.slice();return true}if(sum>target+.01||i>=candidates.length||chosen.length>=5)return false;if(rec(i+1,[...chosen,candidates[i]],round2(sum+candidates[i].amount)))return true;return rec(i+1,chosen,sum)}rec(0,[],0);if(best)return best;
  const single=candidates.find(c=>c.amount>=target-.01);if(single)return [{purchaseId:single.purchaseId,amount:target}];
  return null;
}

function showDistributionSuggestion(){
  const c=calc();const available=Math.max(0,c.generalPending),totalNeed=round2(c.branchRows.reduce((s,r)=>s+r.need,0));const amount=Math.min(available,totalNeed);
  const allocations=c.branchRows.map(r=>({branchCode:r.code,amount:totalNeed?round2(amount*r.need/totalNeed):0,need:r.need}));
  let diff=round2(amount-allocations.reduce((s,a)=>s+a.amount,0));if(Math.abs(diff)>.001){const first=allocations.find(a=>a.need>0);if(first)first.amount=round2(first.amount+diff)}
  modal('Distribución sugerida',`<div class="grid three"><div class="notice"><strong>Pendiente general</strong><br>${money(available)}</div><div class="notice"><strong>Necesidad total</strong><br>${money(totalNeed)}</div><div class="notice"><strong>Monto sugerido</strong><br>${money(amount)}</div></div>
  <div class="notice section-gap">Se cubre primero la necesidad neta, considerando el saldo anterior de cada tienda. Si el presupuesto no alcanza, se reparte proporcionalmente.</div>
  <div class="table-wrap section-gap"><table class="table" id="distributionTable"><thead><tr><th>Sucursal</th><th>Saldo actual</th><th>Necesidad</th><th>Asignación propuesta</th></tr></thead><tbody>${c.branchRows.map(r=>`<tr><td>${esc(r.name)}</td><td class="money ${valueClass(r.final)}">${money(r.final)}</td><td class="money">${money(r.need)}</td><td><input class="control" data-branch="${r.code}" type="number" step="0.01" min="0" value="${allocations.find(a=>a.branchCode===r.code).amount}"></td></tr>`).join('')}</tbody></table></div><div id="distributionSummary" class="notice section-gap"></div>`,{size:'large',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="approveDistribution" class="btn btn-primary">Aprobar distribución</button>`});
  const refresh=()=>{const sum=round2($$('[data-branch]').reduce((s,i)=>s+n(i.value),0));$('#distributionSummary').innerHTML=`Total a distribuir: <strong>${money(sum)}</strong> · Quedará pendiente general: <strong>${money(available-sum)}</strong>`};$$('[data-branch]').forEach(i=>i.oninput=refresh);refresh();
  $('#approveDistribution').onclick=async()=>{const allocations=$$('[data-branch]').map(i=>({branchCode:i.dataset.branch,amount:round2(n(i.value))})).filter(a=>a.amount);const total=round2(allocations.reduce((s,a)=>s+a.amount,0));if(total>available+.01){toast('La distribución supera el pendiente general.','danger');return}state.distributions.push({id:uid('dist'),periodId:state.currentPeriodId,date:isoToday(),method:totalNeed>available?'Proporcional por necesidad':'Cobertura de necesidad',allocations,status:'validado',createdAt:new Date().toISOString()});await saveState();closeModal();render();toast('Distribución aprobada.','success')};
}

function saveActualBank(){const p=currentPeriod();if(!p)return;p.actualBank=parseMoney($('#actualBankInput').value);saveState().then(()=>{render();toast('Saldo bancario guardado.','success')})}
function showAdjustmentForm(){modal('Ajuste bancario excepcional',`<form id="adjForm"><div class="form-grid"><div class="field"><label>Fecha</label><input class="control" name="date" type="date" value="${isoToday()}"></div><div class="field"><label>Tipo</label><select class="control" name="direction"><option value="suma">Suma</option><option value="resta">Resta</option></select></div><div class="field"><label>Monto</label><input class="control" name="amount" type="number" step="0.01"></div><div class="field"><label>Motivo obligatorio</label><input class="control" name="reason" required></div><div class="field full"><label>Observación</label><textarea class="control" name="notes"></textarea></div></div></form>`,{size:'small',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="saveAdj" class="btn btn-primary">Guardar ajuste</button>`});$('#saveAdj').onclick=async()=>{const f=new FormData($('#adjForm'));if(!f.get('reason')||!n(f.get('amount'))){toast('Completa monto y motivo.','warning');return}state.bankAdjustments.push({id:uid('adj'),periodId:state.currentPeriodId,date:f.get('date'),direction:f.get('direction'),amount:parseMoney(f.get('amount')),reason:String(f.get('reason')),notes:String(f.get('notes')||''),status:'validado'});await saveState();closeModal();render();toast('Ajuste guardado.','success')};}

function deleteRecord(collection,id,title){confirmBox(title,'El registro se marcará como anulado para conservar trazabilidad.',async()=>{const x=state[collection].find(y=>y.id===id);if(x)x.status='anulado';if(collection==='purchases'){for(const pay of state.payments)pay.allocations=(pay.allocations||[]).filter(a=>a.purchaseId!==id)}recomputeTransfers(state.currentPeriodId);await saveState();render();toast('Registro anulado.','success')})}
function deleteDocument(id){confirmBox('Eliminar documento','Se eliminará el archivo adjunto. El registro relacionado no se eliminará automáticamente.',async()=>{state.documents=state.documents.filter(x=>x.id!==id);await deleteStoredFile(id);await saveState();render();toast('Documento eliminado.','success')})}
async function openDocument(id){const d=state.documents.find(x=>x.id===id),w=window.open('about:blank','_blank'),dataUrl=await getStoredFile(id);if(!d||!dataUrl){if(w)w.close();toast('El archivo no está disponible.','warning');return}if(!w){toast('El navegador bloqueó la ventana emergente. Permite ventanas para esta herramienta.','warning');return}w.document.write(`<title>${esc(d.name)}</title><iframe src="${dataUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>`)}

function closePeriodFlow(){
  const c=calc(),alerts=buildAlerts();
  modal('Cerrar periodo',`${alerts.length?`<div class="notice warning"><strong>Se encontraron ${alerts.length} advertencia(s).</strong><br>Puedes cerrar dejando pendientes, pero debes escribir una observación.</div>`:`<div class="notice"><strong>El periodo está listo para cierre.</strong></div>`}<div class="field section-gap"><label>Observación de cierre ${alerts.length?'(obligatoria)':''}</label><textarea id="closeNotes" class="control" rows="4"></textarea></div>`,{size:'small',footer:`<button class="btn btn-secondary" data-action="close-modal">Cancelar</button><button id="confirmClosePeriod" class="btn btn-primary">Cerrar periodo</button>`});
  $('#confirmClosePeriod').onclick=async()=>{const notes=$('#closeNotes').value.trim();if(alerts.length&&!notes){toast('Escribe una observación para cerrar con pendientes.','warning');return}const p=currentPeriod();p.status='cerrado';p.closedAt=new Date().toISOString();p.closeNotes=notes;p.closingSnapshot={expectedBank:c.expectedBank,actualBank:c.actualBank,generalPending:c.generalPending,branchBalances:Object.fromEntries(c.branchRows.map(r=>[r.code,r.final])),alertCount:alerts.length};await saveState();closeModal();render();toast('Periodo cerrado.','success')};
}
async function reopenPeriod(){const p=currentPeriod();p.status='abierto';delete p.closedAt;await saveState();render();toast('Periodo reabierto.','warning')}
function createNextPeriod(){const c=calc(),p=c.p;let month=Number(p.month)+1,year=Number(p.year);if(month===13){month=1;year++}showPeriodModal(null,{year,month,openingBank:c.actualBank??c.expectedBank,openingGeneralPending:c.generalPending,branchBalances:Object.fromEntries(c.branchRows.map(r=>[r.code,r.final])),notes:`Arrastre automático desde ${periodName(p)}`})}

// ---------- Lectura y clasificación de documentos ----------
if(window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdfjs/pdf.worker.min.js';

async function processFiles(files){
  if(processing||!files.length)return;
  if(currentPeriod()?.status==='cerrado'){toast('Reabre el periodo antes de cargar documentos.','warning');return;}
  processing=true;setProcessStatus('Preparando archivos…',0);
  const added=[];
  try{
    for(let i=0;i<files.length;i++){
      const file=files[i];setProcessStatus(`Leyendo ${file.name}`,Math.round(i/files.length*100));
      if(!/pdf|image/i.test(file.type) && !/\.(pdf|png|jpe?g|webp)$/i.test(file.name)){toast(`${file.name}: formato no compatible.`,'warning');continue}
      const hash=await fileHash(file);
      if(state.documents.some(d=>d.hash===hash)){const dup={id:uid('doc'),periodId:state.currentPeriodId,name:file.name,mime:file.type,size:file.size,hash,type:'unknown',status:'duplicado',createdAt:new Date().toISOString(),relatedLabel:'Archivo ya cargado'};state.documents.push(dup);continue}
      const dataUrl=await readAsDataURL(file);let extraction;
      try{extraction=file.type==='application/pdf'||/\.pdf$/i.test(file.name)?await extractPdf(file):await extractImageText(file,(m,p)=>setProcessStatus(`${file.name}: ${m}`,Math.round((i+(p/100))/files.length*100)));}
      catch(err){console.error(err);extraction={text:'',pages:[],error:String(err.message||err)}}
      const type=classifyText(extraction.text,file.name);const parsed=parseByType(type,extraction);
      const doc={id:uid('doc'),periodId:state.currentPeriodId,name:file.name,mime:file.type||guessMime(file.name),size:file.size,hash,type,status:'requiere_revision',createdAt:new Date().toISOString(),rawText:extraction.text||'',parsed,extractionError:extraction.error||''};
      await putStoredFile(doc.id,dataUrl); state.documents.push(doc);added.push(doc);
    }
    await saveState();setProcessStatus('Lectura terminada',100);render();
    if(added.length){toast(`${added.length} documento(s) listos para revisión.`,'success');setTimeout(()=>reviewDocument(added[0].id),250)}
  } finally {processing=false;setTimeout(()=>setProcessStatus('',0),2500)}
}
function setProcessStatus(msg,pct){const el=$('#processStatus');if(!el)return;el.innerHTML=msg?`<div class="status-line"><div class="spinner"></div><div style="flex:1"><div class="small strong">${esc(msg)}</div><div class="progress" style="margin-top:6px"><span style="width:${Math.max(2,pct)}%"></span></div></div></div>`:''}
function fileHash(file){return file.arrayBuffer().then(b=>crypto.subtle.digest('SHA-256',b)).then(h=>[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join(''))}
function readAsDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
function guessMime(name){return /\.pdf$/i.test(name)?'application/pdf':/\.png$/i.test(name)?'image/png':'image/jpeg'}

async function extractPdf(file){
  const data=new Uint8Array(await file.arrayBuffer());
  const pdf=await pdfjsLib.getDocument({data}).promise;const pages=[];let text='';
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p),tc=await page.getTextContent();
    const items=tc.items.filter(i=>String(i.str).trim()).map(i=>({str:String(i.str).trim(),x:i.transform[4],y:i.transform[5],w:i.width||0}));
    const groups=[];
    for(const it of items.sort((a,b)=>b.y-a.y||a.x-b.x)){let g=groups.find(z=>Math.abs(z.y-it.y)<2.4);if(!g){g={y:it.y,items:[]};groups.push(g)}g.items.push(it)}
    groups.sort((a,b)=>b.y-a.y);groups.forEach(g=>g.items.sort((a,b)=>a.x-b.x));
    const lines=groups.map(g=>({...g,text:g.items.map(i=>i.str).join(' ')}));pages.push({page:p,lines});text+=lines.map(l=>l.text).join('\n')+'\n';
  }
  return {text,pages};
}
async function getOcrWorker(logger){
  if(ocrWorker)return ocrWorker;
  ocrWorker=await Tesseract.createWorker('spa+eng',1,{workerPath:'vendor/tesseract/worker.min.js',langPath:'vendor/tessdata',corePath:'vendor/tesseract-core',logger:m=>{if(logger&&m.status)logger(m.status,Math.round((m.progress||0)*100))}});
  return ocrWorker;
}
async function extractImageText(file,logger){
  const worker=await getOcrWorker(logger);const result=await worker.recognize(file);return {text:result.data.text||'',pages:[],ocr:true,confidence:result.data.confidence};
}
function classifyText(text,name=''){
  const t=norm(`${text} ${name}`);
  if(t.includes('COMPROBANTE DE TRANSFERENCIA')||t.includes('TRANSFERENCIA N')&&t.includes('CANT ENVIADA'))return'transfer';
  if(t.includes('COMPROBANTE DE COMPRA')||t.includes('COMPRA N')&&t.includes('PROVEEDOR'))return'purchase';
  if(t.includes('MONTO A ACREDITAR')||t.includes('TRANSFERENCIA INDIVIDUAL')||t.includes('CODIGO DE AUTORIZACION')&&t.includes('CUENTA A ACREDITAR'))return'budget';
  if(t.includes('TU TRANSFERENCIA DE Q')||t.includes('PEDIDO ALVSOL')||t.includes('CUENTA CEL GUATEMALA')||t.includes('TRANSFERENCIA')&&t.includes('REFERENCIA')&&t.includes('CUENTA'))return'payment';
  return'unknown';
}
function parseByType(type,ex){
  if(type==='budget')return parseBudgetText(ex.text);
  if(type==='payment')return parsePaymentText(ex.text);
  if(type==='purchase')return parsePurchase(ex);
  if(type==='transfer')return parseTransfer(ex);
  return{};
}
function match1(text,re){const m=String(text||'').match(re);return m?String(m[1]||'').trim():''}
function parseBudgetText(text){
  const amount=match1(text,/(?:Monto\s+a\s+acreditar|Monto)[\s:\n]*(?:GTQ|Q)?\s*([\d.,]+)/i);
  const date=match1(text,/(?:Fecha\s+de\s+transacci[oó]n|Fecha)[\s:\n]*([^\n]+)/i);
  return {date:parseDate(date),amount:parseMoney(amount),authorization:match1(text,/(?:C[oó]digo\s+de\s+autorizaci[oó]n|Autorizaci[oó]n)[\s:\n]*(\d+)/i),generatedBy:match1(text,/Generado\s+por[\s:\n]*([^\n]+)/i),fromAccount:match1(text,/Cuenta\s+a\s+debitar[\s:\n]*([^\n]+(?:\n[^\n]+)?)/i).replace(/\n/g,' '),toAccount:match1(text,/Cuenta\s+a\s+acreditar[\s:\n]*([^\n]+(?:\n[^\n]+)?)/i).replace(/\n/g,' '),comment:match1(text,/Comentario[\s:\n]*([^\n]+)/i)||'PROVEEDORES'};
}
function parsePaymentText(text){
  let amount=match1(text,/transferencia\s+de\s+Q\s*([\d.,]+)/i)||match1(text,/(?:Monto|Total)[\s:Q]*([\d.,]+)/i);
  let provider=match1(text,/cuenta\s+([^\n]+?)(?:\s*-\s*GT\d|\s+GT\d|\n)/i);
  if(provider && /\d{8,}/.test(provider))provider='';
  return {date:parseDate(match1(text,/(?:Fecha\s+y\s+hora\s+de\s+transacci[oó]n|Fecha)[\s:\n]*([^\n]+)/i)),amount:parseMoney(amount),reference:match1(text,/Referencia[\s:\n]*(\d+)/i),provider:provider||match1(text,/a\s+la\s+cuenta\s+([A-ZÁÉÍÓÚÑ0-9 .&-]+)/i),description:match1(text,/(?:Descripci[oó]n|Comentario)[\s:\n]*([^\n]+)/i)};
}
function parsePurchase(ex){
  const text=ex.text||'',lines=[];
  let previousGlobal=null;
  for(const page of ex.pages||[]){
    const rows=[];const products=[];
    for(const ln of page.lines){
      const its=ln.items;const skuItem=its.find(i=>i.x<80&&/^[A-Z0-9-]{2,20}$/i.test(i.str)&&!/^SKU$/i.test(i.str));
      const q1=its.find(i=>i.x>=70&&i.x<125&&/^\d+(?:\.\d+)?$/.test(i.str));
      const q2=its.find(i=>i.x>=120&&i.x<165&&/^\d+(?:\.\d+)?$/.test(i.str));
      const costItem=its.find(i=>i.x>=160&&i.x<225&&/[\d]/.test(i.str));
      const totalItem=its.find(i=>i.x>=220&&i.x<270&&/[\d]/.test(i.str));
      if(skuItem&&q1&&q2&&costItem){rows.push({page:page.page,y:ln.y,sku:skuItem.str,qtyRequested:n(q1.str),qtyReceivedShown:n(q2.str),qtyAccounting:n(q1.str),cost:parseCost(costItem.str),pdfLineTotal:parseMoney(totalItem?.str),productParts:[]})}
      for(const it of its.filter(i=>i.x>=260)){if(!/^(Producto|Total:|Firma)/i.test(it.str))products.push({y:ln.y,text:it.str})}
    }
    rows.sort((a,b)=>b.y-a.y);
    for(const pr of products.sort((a,b)=>b.y-a.y)){
      if(pr.text.startsWith('(')&&rows.length&&pr.y>rows[0].y+10&&previousGlobal){previousGlobal.product=`${previousGlobal.product||''} ${pr.text}`.replace(/\s+/g,' ').trim();continue}
      const nearest=rows.slice().sort((a,b)=>Math.abs(a.y-pr.y)-Math.abs(b.y-pr.y))[0];if(nearest&&Math.abs(nearest.y-pr.y)<28)nearest.productParts.push(pr.text);
    }
    for(const r of rows){r.product=r.productParts.join(' ').replace(/\s+/g,' ').trim();r.lineTotal=round2(r.qtyAccounting*r.cost);delete r.productParts;lines.push(r);previousGlobal=r}
  }
  if(!lines.length){
    const rx=/^\s*([A-Z0-9-]{2,20})\s+(\d+)\s+(\d+)\s+Q?\s*([\d.,]+)\s+Q?\s*([\d.,]+)\s+(.+)$/gim;let m;while((m=rx.exec(text)))lines.push({sku:m[1],qtyRequested:n(m[2]),qtyReceivedShown:n(m[3]),qtyAccounting:n(m[2]),cost:parseCost(m[4]),pdfLineTotal:parseMoney(m[5]),product:m[6],lineTotal:round2(n(m[2])*parseCost(m[4]))});
  }
  return {number:match1(text,/Compra\s*N[°ºo]?[\s:]*([A-Z0-9-]+)/i),description:match1(text,/Descripci[oó]n[\s:]*([^\n]+)/i),provider:match1(text,/Proveedor[\s:]*([^\n]+)/i).replace(/No\.\s*comprobante.*$/i,'').trim(),date:parseDate(match1(text,/(?:Fecha\s+pedido|Fecha\s+factura)[\s:]*([^\n]+)/i)),invoice:match1(text,/No\.\s*Factura[\s:]*([^\n]+)/i),series:match1(text,/No\.\s*Serie[\s:]*([^\n]+)/i),pdfTotal:parseMoney(match1(text,/Total[\s:]*Q\s*([\d.,]+)/i)),lines,recalcTotal:round2(lines.reduce((s,l)=>s+n(l.lineTotal),0))};
}
function parseTransfer(ex){
  const text=ex.text||'',lines=[];let previousGlobal=null;
  for(const page of ex.pages||[]){
    const rows=[];const products=[];
    for(const ln of page.lines){
      const its=ln.items;const skuItem=its.find(i=>i.x<100&&/^[A-Z0-9-]{2,20}$/i.test(i.str)&&!/^SKU$/i.test(i.str));
      const q1=its.find(i=>i.x>=95&&i.x<165&&/^\d+(?:\.\d+)?$/.test(i.str));
      const q2=its.find(i=>i.x>=160&&i.x<215&&/^\d+(?:\.\d+)?$/.test(i.str));
      if(skuItem&&q1&&q2)rows.push({page:page.page,y:ln.y,sku:skuItem.str,qtySent:n(q1.str),qtyReceived:n(q2.str),productParts:[],allocationType:'auto',manualCost:null,overrideCurrentQty:null});
      for(const it of its.filter(i=>i.x>=210)){if(!/^(Producto|Firma|Nombre piloto|Nombre responsable)/i.test(it.str))products.push({y:ln.y,text:it.str})}
    }
    rows.sort((a,b)=>b.y-a.y);
    for(const pr of products.sort((a,b)=>b.y-a.y)){
      if(pr.text.startsWith('(')&&rows.length&&pr.y>rows[0].y+10&&previousGlobal){previousGlobal.product=`${previousGlobal.product||''} ${pr.text}`.replace(/\s+/g,' ').trim();continue}
      const nearest=rows.slice().sort((a,b)=>Math.abs(a.y-pr.y)-Math.abs(b.y-pr.y))[0];if(nearest&&Math.abs(nearest.y-pr.y)<30)nearest.productParts.push(pr.text);
    }
    for(const r of rows){r.product=r.productParts.join(' ').replace(/\s+/g,' ').trim();delete r.productParts;lines.push(r);previousGlobal=r}
  }
  if(!lines.length){const rx=/^\s*([A-Z0-9-]{2,20})\s+(\d+)\s+(\d+)\s+(.+)$/gim;let m;while((m=rx.exec(text)))lines.push({sku:m[1],qtySent:n(m[2]),qtyReceived:n(m[3]),product:m[4],allocationType:'auto',manualCost:null,overrideCurrentQty:null})}
  const originRaw=match1(text,/Origen[\s:]*([^\n]+)/i),destinationRaw=match1(text,/Destino[\s:]*([^\n]+)/i),dest=branchFromText(destinationRaw),origin=branchFromText(originRaw);
  const desc=match1(text,/Descripci[oó]n[\s:]*([^\n]+)/i);
  return {number:match1(text,/Transferencia\s*N[°ºo]?[\s:]*([A-Z0-9-]+)/i),description:desc,createdBy:match1(text,/Creado\s+por[\s:]*([^\n]+)/i),originRaw,destinationRaw,destinationCode:dest&&!dest.inactive&&!dest.bodega?dest.code:'',destinationName:dest?.name||destinationRaw,inactiveDestination:!!dest?.inactive,originValid:!!origin?.bodega,transferStatus:match1(text,/Estado[\s:]*([^\n]+)/i),date:parseDate(match1(desc,/([0-3]?\d[-\/.][01]?\d[-\/.]\d{2,4})/)||match1(text,/Fecha[\s:]*([^\n]+)/i)),lines};
}

function reviewDocument(id){
  const doc=state.documents.find(x=>x.id===id);if(!doc)return;
  if(doc.type==='budget')return showBudgetForm(null,doc,{...doc.parsed});
  if(doc.type==='payment')return showPaymentForm(null,doc,{...doc.parsed});
  if(doc.type==='purchase')return showPurchaseForm(null,doc,doc.parsed||{});
  if(doc.type==='transfer')return showTransferForm(null,doc,doc.parsed||{});
  modal('Documento sin clasificar',`<div class="notice warning">No fue posible identificar el tipo automáticamente. Selecciona el tipo y revisa los datos.</div><div class="grid two section-gap"><button class="btn btn-secondary" data-review-type="budget">Presupuesto recibido</button><button class="btn btn-secondary" data-review-type="payment">Pago a proveedor</button><button class="btn btn-secondary" data-review-type="purchase">Compra BlueLake</button><button class="btn btn-secondary" data-review-type="transfer">Transferencia BlueLake</button></div><div class="divider"></div><details><summary>Texto detectado</summary><pre style="white-space:pre-wrap;max-height:260px;overflow:auto">${esc(doc.rawText||'Sin texto')}</pre></details>`,{size:'small'});$$('[data-review-type]').forEach(b=>b.onclick=()=>{doc.type=b.dataset.reviewType;doc.parsed=parseByType(doc.type,{text:doc.rawText||'',pages:[]});closeModal();reviewDocument(id)})
}

// ---------- Exportación, respaldo y restauración ----------
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1200)}
async function exportBackup(){
  state.settings.lastBackupAt=new Date().toISOString();await saveState();
  const attachments=await getAllStoredFiles();
  const payload={...JSON.parse(JSON.stringify(state)),attachments};
  const p=currentPeriod();const name=`Respaldo_Presupuesto_ALVSOL_${p?`${p.year}-${String(p.month).padStart(2,'0')}`:'completo'}_${isoToday()}.json`;
  downloadBlob(new Blob([JSON.stringify(payload)],{type:'application/json'}),name);toast('Respaldo completo creado.','success');render();
}
async function restoreBackup(file){
  try{const text=await file.text(),data=JSON.parse(text);if(!data||![1,2].includes(Number(data.schema))||!Array.isArray(data.periods))throw new Error('Formato no reconocido');
    confirmBox('Restaurar respaldo','Se reemplazarán los datos actuales por el contenido del respaldo.',async()=>{
      const attachments=data.attachments||{};delete data.attachments;
      await clearStoredFiles();
      for(const d of data.documents||[]){if(d.dataUrl&&!attachments[d.id])attachments[d.id]=d.dataUrl;delete d.dataUrl;}
      for(const [id,url] of Object.entries(attachments))await putStoredFile(id,url);
      state=data;normalizeState();await saveState();currentView='dashboard';render();toast('Respaldo restaurado.','success')
    });
  }catch(e){toast(`No se pudo restaurar: ${e.message}`,'danger')}
}
function setCellStyle(ws,addr,style){if(ws[addr])ws[addr].s=style}
function styleRange(ws,range,style){const r=XLSX.utils.decode_range(range);for(let R=r.s.r;R<=r.e.r;R++)for(let C=r.s.c;C<=r.e.c;C++)setCellStyle(ws,XLSX.utils.encode_cell({r:R,c:C}),style)}
const XLS_STYLES={
  title:{font:{bold:true,sz:21,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0B3558'}},alignment:{horizontal:'center',vertical:'center'}},
  meta:{font:{bold:true,sz:11,color:{rgb:'DCEAF2'}},fill:{fgColor:{rgb:'0B3558'}},alignment:{horizontal:'center',vertical:'center'}},
  section:{font:{bold:true,sz:12,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0D5F85'}},alignment:{horizontal:'left',vertical:'center'}},
  header:{font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'167D9A'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:{top:{style:'thin',color:{rgb:'0B3558'}},bottom:{style:'thin',color:{rgb:'0B3558'}},left:{style:'thin',color:{rgb:'D9E2EA'}},right:{style:'thin',color:{rgb:'D9E2EA'}}}},
  label:{font:{bold:true,color:{rgb:'14314A'}},fill:{fgColor:{rgb:'EAF2F7'}},alignment:{vertical:'center'}},
  total:{font:{bold:true,color:{rgb:'0B3558'}},fill:{fgColor:{rgb:'DCEAF2'}},border:{top:{style:'medium',color:{rgb:'0B3558'}},bottom:{style:'thin',color:{rgb:'0B3558'}}}},
  positive:{font:{color:{rgb:'1C8C5A'},bold:true}},negative:{font:{color:{rgb:'C43D3D'},bold:true}},
  cardLabelBlue:{font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0D5F85'}},alignment:{horizontal:'center',vertical:'center'}},
  cardValueBlue:{font:{bold:true,sz:18,color:{rgb:'0B3558'}},fill:{fgColor:{rgb:'EAF2F7'}},alignment:{horizontal:'center',vertical:'center'}},
  cardLabelTeal:{font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'168F95'}},alignment:{horizontal:'center',vertical:'center'}},
  cardValueTeal:{font:{bold:true,sz:18,color:{rgb:'0E5B60'}},fill:{fgColor:{rgb:'E5F5F5'}},alignment:{horizontal:'center',vertical:'center'}},
  cardLabelAmber:{font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'C98500'}},alignment:{horizontal:'center',vertical:'center'}},
  cardValueAmber:{font:{bold:true,sz:18,color:{rgb:'7A5200'}},fill:{fgColor:{rgb:'FFF4D6'}},alignment:{horizontal:'center',vertical:'center'}},
  cardLabelGreen:{font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'1C8C5A'}},alignment:{horizontal:'center',vertical:'center'}},
  cardValueGreen:{font:{bold:true,sz:18,color:{rgb:'14633F'}},fill:{fgColor:{rgb:'E4F5EC'}},alignment:{horizontal:'center',vertical:'center'}},
  boxLabel:{font:{bold:true,color:{rgb:'496073'}},fill:{fgColor:{rgb:'EEF3F7'}},alignment:{vertical:'center',wrapText:true}},
  boxValue:{font:{bold:true,color:{rgb:'14314A'}},fill:{fgColor:{rgb:'FFFFFF'}},alignment:{horizontal:'right',vertical:'center'}},
  dataRow:{fill:{fgColor:{rgb:'FFFFFF'}},font:{color:{rgb:'14314A'}},alignment:{vertical:'center',wrapText:true}},
  rowEven:{fill:{fgColor:{rgb:'F6F9FB'}},font:{color:{rgb:'14314A'}},alignment:{vertical:'center',wrapText:true}},
  chartLabel:{fill:{fgColor:{rgb:'FFFFFF'}},font:{color:{rgb:'14314A'},bold:true},alignment:{vertical:'center'}},
  barExpense:{fill:{fgColor:{rgb:'EF7A32'}}},barIncrease:{fill:{fgColor:{rgb:'176C8C'}}},barEmpty:{fill:{fgColor:{rgb:'E8EEF2'}}}
};
function applyThinBorder(ws,range){
  const r=XLSX.utils.decode_range(range);for(let R=r.s.r;R<=r.e.r;R++)for(let C=r.s.c;C<=r.e.c;C++){
    const addr=XLSX.utils.encode_cell({r:R,c:C});if(!ws[addr])ws[addr]={t:'s',v:''};
    ws[addr].s={...(ws[addr].s||{}),border:{top:{style:'thin',color:{rgb:'D9E2EA'}},bottom:{style:'thin',color:{rgb:'D9E2EA'}},left:{style:'thin',color:{rgb:'D9E2EA'}},right:{style:'thin',color:{rgb:'D9E2EA'}}}};
  }
}
function mergeAndStyle(ws,merges,range,style){merges.push(XLSX.utils.decode_range(range));styleRange(ws,range,style)}
function buildSummarySheet(c,executiveOnly=false){
  const totalExpenses=round2(c.branchRows.reduce((s,r)=>s+n(r.current),0));
  const totalIncreases=round2(c.branchRows.reduce((s,r)=>s+n(r.allocated),0));
  const rows=58,cols=22,aoa=Array.from({length:rows},()=>Array(cols).fill(''));
  const put=(r,col,val)=>{aoa[r-1][col-1]=val};
  put(1,1,'CONTROL DE PRESUPUESTO DE COMPRAS ALVSOL');
  put(3,1,`Periodo: ${periodName(c.p)}     |     Fecha de corte: ${new Date().toLocaleDateString('es-GT')}     |     Estado: ${c.p.status==='cerrado'?'Cerrado':'Abierto'}`);
  put(5,1,'PRESUPUESTO RECIBIDO');put(6,1,c.budgetsTotal);
  put(5,6,'PAGOS A PROVEEDORES');put(6,6,c.paymentsTotal);
  put(5,11,'SALDO ESPERADO EN BANCO');put(6,11,c.expectedBank);
  put(5,16,'TOTAL PRESUPUESTARIO PENDIENTE');put(6,16,c.totalBudgetPending);
  put(9,1,'RESUMEN EJECUTIVO POR SUCURSAL');
  ['Sucursal','Saldo anterior','Gastos','% gastos','Aumentos','% aumentos','Saldo pendiente'].forEach((v,i)=>put(10,i+1,v));
  let rr=11;
  for(const r of c.branchRows){put(rr,1,r.name);put(rr,2,r.opening);put(rr,3,-r.current);put(rr,4,totalExpenses?n(r.current)/totalExpenses:0);put(rr,5,r.allocated);put(rr,6,totalIncreases?n(r.allocated)/totalIncreases:0);put(rr,7,r.final);rr++;}
  const noAssignedRow=rr;put(rr,1,'No asignado');put(rr,7,c.generalPending);rr++;
  const totalRow=rr;put(rr,1,'Total');put(rr,2,c.branchOpeningTotal);put(rr,3,-totalExpenses);put(rr,4,totalExpenses?1:0);put(rr,5,totalIncreases);put(rr,6,totalIncreases?1:0);put(rr,7,c.totalBudgetPending);
  put(10,9,'CONCILIACIÓN BANCARIA');
  const bankRows=[['Saldo inicial',c.p.openingBank],['Presupuestos recibidos',c.budgetsTotal],['Pagos realizados',-c.paymentsTotal],['Ajustes',c.adjustmentsTotal],['Saldo esperado',c.expectedBank],['Saldo real',c.actualBank??''],['Diferencia bancaria',c.bankDiff??'']];
  bankRows.forEach((x,i)=>{put(11+i,9,x[0]);put(11+i,14,x[1]);});
  put(19,9,'COMPOSICIÓN DEL SALDO');
  const composition=[['Presupuesto no asignado',c.generalPending],['Saldo pendiente sucursales',c.branchPendingTotal],['Total presupuestario pendiente',c.totalBudgetPending],['Pendiente de asignar en mercadería',c.pendingMerchandiseValue],['Diferencia presupuesto vs banco',c.budgetVsBankGap]];
  composition.forEach((x,i)=>{put(20+i,9,x[0]);put(20+i,14,x[1]);});
  put(25,1,'COMPARACIÓN PORCENTUAL DE GASTOS Y AUMENTOS');
  put(26,1,'Cada barra representa la participación de la sucursal dentro del total del periodo.');
  rr=28;
  for(const r of c.branchRows){
    const expensePct=totalExpenses?n(r.current)/totalExpenses:0,increasePct=totalIncreases?n(r.allocated)/totalIncreases:0;
    put(rr,1,r.name);put(rr,3,'Gastos');put(rr,22,expensePct);put(rr+1,3,'Aumentos');put(rr+1,22,increasePct);rr+=2;
  }
  const ws=XLSX.utils.aoa_to_sheet(aoa),merges=[];
  mergeAndStyle(ws,merges,'A1:V2',XLS_STYLES.title);mergeAndStyle(ws,merges,'A3:V3',XLS_STYLES.meta);
  mergeAndStyle(ws,merges,'A5:E5',XLS_STYLES.cardLabelBlue);mergeAndStyle(ws,merges,'A6:E7',XLS_STYLES.cardValueBlue);
  mergeAndStyle(ws,merges,'F5:J5',XLS_STYLES.cardLabelTeal);mergeAndStyle(ws,merges,'F6:J7',XLS_STYLES.cardValueTeal);
  mergeAndStyle(ws,merges,'K5:O5',XLS_STYLES.cardLabelAmber);mergeAndStyle(ws,merges,'K6:O7',XLS_STYLES.cardValueAmber);
  mergeAndStyle(ws,merges,'P5:V5',XLS_STYLES.cardLabelGreen);mergeAndStyle(ws,merges,'P6:V7',XLS_STYLES.cardValueGreen);
  mergeAndStyle(ws,merges,'A9:V9',XLS_STYLES.section);styleRange(ws,'A10:G10',XLS_STYLES.header);
  mergeAndStyle(ws,merges,'I10:V10',XLS_STYLES.section);mergeAndStyle(ws,merges,'I19:V19',XLS_STYLES.section);
  for(let i=0;i<bankRows.length;i++){mergeAndStyle(ws,merges,`I${11+i}:M${11+i}`,XLS_STYLES.boxLabel);mergeAndStyle(ws,merges,`N${11+i}:V${11+i}`,XLS_STYLES.boxValue);}
  for(let i=0;i<composition.length;i++){mergeAndStyle(ws,merges,`I${20+i}:M${20+i}`,XLS_STYLES.boxLabel);mergeAndStyle(ws,merges,`N${20+i}:V${20+i}`,XLS_STYLES.boxValue);}
  styleRange(ws,`A${totalRow}:G${totalRow}`,XLS_STYLES.total);styleRange(ws,`A${noAssignedRow}:G${noAssignedRow}`,XLS_STYLES.label);
  applyThinBorder(ws,`A10:G${totalRow}`);applyThinBorder(ws,'I10:V17');applyThinBorder(ws,'I19:V24');
  for(let r=11;r<noAssignedRow;r++){styleRange(ws,`A${r}:G${r}`,XLS_STYLES.dataRow);if((r-11)%2===1)styleRange(ws,`A${r}:G${r}`,XLS_STYLES.rowEven);}
  for(let r=11;r<=totalRow;r++){
    for(const cc of ['B','C','E','G'])if(ws[`${cc}${r}`])ws[`${cc}${r}`].z='Q #,##0.00;[Red](Q #,##0.00)';
    for(const cc of ['D','F'])if(ws[`${cc}${r}`])ws[`${cc}${r}`].z='0.0%';
    if(ws[`G${r}`])ws[`G${r}`].s={...(ws[`G${r}`].s||{}),font:{bold:true,color:{rgb:n(ws[`G${r}`].v)<0?'C43D3D':'1C8C5A'}}};
  }
  for(const addr of ['A6','F6','K6','P6'])if(ws[addr])ws[addr].z='Q #,##0.00;[Red](Q #,##0.00)';
  for(let r=11;r<=17;r++)if(ws[`N${r}`])ws[`N${r}`].z='Q #,##0.00;[Red](Q #,##0.00)';
  for(let r=20;r<=24;r++)if(ws[`N${r}`])ws[`N${r}`].z='Q #,##0.00;[Red](Q #,##0.00)';
  mergeAndStyle(ws,merges,'A25:V25',XLS_STYLES.section);mergeAndStyle(ws,merges,'A26:V26',{font:{italic:true,color:{rgb:'607483'}},fill:{fgColor:{rgb:'F6F9FB'}},alignment:{horizontal:'left'}});
  rr=28;
  const barStart=4,barEnd=21,barBlocks=barEnd-barStart+1;
  for(const r of c.branchRows){
    mergeAndStyle(ws,merges,`A${rr}:B${rr+1}`,{font:{bold:true,color:{rgb:'14314A'}},fill:{fgColor:{rgb:'F6F9FB'}},alignment:{vertical:'center',wrapText:true}});
    styleRange(ws,`C${rr}:C${rr+1}`,XLS_STYLES.chartLabel);styleRange(ws,`V${rr}:V${rr+1}`,XLS_STYLES.chartLabel);
    const expensePct=totalExpenses?n(r.current)/totalExpenses:0,increasePct=totalIncreases?n(r.allocated)/totalIncreases:0;
    const expBlocks=Math.round(Math.max(0,Math.min(1,expensePct))*barBlocks),incBlocks=Math.round(Math.max(0,Math.min(1,increasePct))*barBlocks);
    for(let C=barStart;C<=barEnd;C++){
      const eAddr=XLSX.utils.encode_cell({r:rr-1,c:C-1}),iAddr=XLSX.utils.encode_cell({r:rr,c:C-1});
      if(!ws[eAddr])ws[eAddr]={t:'s',v:''};if(!ws[iAddr])ws[iAddr]={t:'s',v:''};
      ws[eAddr].s=C-barStart<expBlocks?XLS_STYLES.barExpense:XLS_STYLES.barEmpty;
      ws[iAddr].s=C-barStart<incBlocks?XLS_STYLES.barIncrease:XLS_STYLES.barEmpty;
    }
    if(ws[`V${rr}`])ws[`V${rr}`].z='0.0%';if(ws[`V${rr+1}`])ws[`V${rr+1}`].z='0.0%';
    applyThinBorder(ws,`A${rr}:V${rr+1}`);rr+=2;
  }
  ws['!merges']=merges;
  ws['!cols']=[{wch:29},{wch:17},{wch:17},{wch:13},{wch:17},{wch:13},{wch:19},{wch:3},...Array.from({length:5},()=>({wch:9})),...Array.from({length:8},()=>({wch:8})),{wch:12}];
  ws['!rows']=Array.from({length:rows},()=>({hpt:20}));
  Object.assign(ws['!rows'][0],{hpt:28});Object.assign(ws['!rows'][1],{hpt:28});Object.assign(ws['!rows'][2],{hpt:24});Object.assign(ws['!rows'][4],{hpt:25});Object.assign(ws['!rows'][5],{hpt:30});Object.assign(ws['!rows'][6],{hpt:30});Object.assign(ws['!rows'][8],{hpt:24});Object.assign(ws['!rows'][9],{hpt:34});for(let i=10;i<=23;i++)ws['!rows'][i]={hpt:26};
  ws['!pageSetup']={orientation:'landscape',fitToWidth:1,fitToHeight:0,paperSize:9};
  ws['!margins']={left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.2,footer:0.2};
  ws['!autofilter']={ref:`A10:G${totalRow}`};
  return ws;
}
function providerBranchExportRows(c){
  const map=new Map();
  for(const r of c.providerConsumptionRows){const key=`${r.providerKey}|${r.branchCode}`;let x=map.get(key);if(!x){x={Proveedor:r.provider,Sucursal:r.branchName,'Unidades consumidas':0,'Consumo presupuestario':0,'Costo de origen':0,'Compra del periodo':0,'Presupuesto arrastrado':0,'Stock anterior':0};map.set(key,x)}x['Unidades consumidas']+=n(r.qty);x['Consumo presupuestario']+=n(r.budgetValue);x['Costo de origen']+=n(r.sourceValue);if(r.classification==='Stock anterior')x['Stock anterior']+=n(r.qty);else if(r.classification==='Presupuesto arrastrado')x['Presupuesto arrastrado']+=n(r.qty);else x['Compra del periodo']+=n(r.qty);}
  return [...map.values()].map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='number'?round2(v):v]))).sort((a,b)=>String(a.Proveedor).localeCompare(String(b.Proveedor))||String(a.Sucursal).localeCompare(String(b.Sucursal)));
}
function providerSummaryExportRows(c){return c.providerRows.map(r=>({'Proveedor':r.provider,'Cantidad de compras':r.purchaseCount,'Unidades compradas':r.purchasedUnits,'Monto comprado':r.purchasedAmount,'% de compras':r.share,'Pagado aplicado':r.paid,'Pendiente de pago':r.pending,'Unidades consumidas':r.consumedUnits,'Consumo presupuestario':r.consumedValue,'Costo de origen consumido':r.sourceConsumedValue,'Sucursales atendidas':r.branchCount}))}
function providerDetailExportRows(c){return c.providerConsumptionRows.map(r=>({'Fecha':r.date,'Proveedor':r.provider,'Sucursal':r.branchName,'Tipo de movimiento':r.movementType,'Documento':r.reference,'Compra fuente':r.purchaseNumber,'Periodo presupuestario de origen':r.budgetOriginLabel||'','SKU':r.sku,'Producto':r.product,'Clasificación':r.classification,'Unidades':r.qty,'Costo aplicado':r.budgetCost,'Consumo presupuestario':r.budgetValue,'Costo de origen':r.sourceCost,'Valor de origen':r.sourceValue}))}

function exportExecutiveExcel(){const c=calc();if(!c||!window.XLSX){toast('No se pudo cargar el exportador de Excel.','danger');return}const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,buildSummarySheet(c,true),'Resumen ejecutivo');appendSheet(wb,'Proveedores',providerSummaryExportRows(c));appendSheet(wb,'Proveedor-sucursal',providerBranchExportRows(c));appendSheet(wb,'Compromisos arrastrados',[...c.priorPendingPayments.map(x=>({'Tipo':'Pago o anticipo','Periodo de origen':periodLabelById(x.periodId),'Documento':x.reference||'','Proveedor':x.provider||'','Monto original':x.amount,'Monto aplicado':paymentAppliedAmount(x),'Monto pendiente':paymentRemaining(x)})),...c.priorPendingPurchases.map(x=>({'Tipo':'Compra pendiente','Periodo de origen':periodLabelById(x.periodId),'Documento':x.number||'','Proveedor':x.provider||'','Monto original':x.recalcTotal,'Monto aplicado':paidForPurchase(x.id),'Monto pendiente':purchaseUnpaid(x)}))]);appendSheet(wb,'Origen mercadería',providerDetailExportRows(c).filter(x=>x['Periodo presupuestario de origen']));XLSX.writeFile(wb,`Resumen_Ejecutivo_ALVSOL_${c.p.year}-${String(c.p.month).padStart(2,'0')}.xlsx`,{cellStyles:true});toast('Resumen ejecutivo generado.','success')}
function exportExcel(){
  const c=calc();if(!c||!window.XLSX){toast('No se pudo cargar el exportador de Excel.','danger');return}
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,buildSummarySheet(c,false),'Resumen');
  appendSheet(wb,'Presupuesto sucursales',c.branchRows.map(r=>({'Sucursal':r.name,'Saldo anterior':r.opening,'Asignado periodo':r.allocated,'Gastos de mercadería controlada':r.current,'Stock anterior':r.prior,'Saldo final':r.final,'Necesidad':r.need})));
  appendSheet(wb,'Presupuestos recibidos',c.budgets.map(x=>({'Fecha':x.date,'Autorización':x.authorization,'Monto':x.amount,'Cuenta origen':x.fromAccount,'Cuenta destino':x.toAccount,'Comentario':x.comment})));
  appendSheet(wb,'Pagos',c.payments.map(x=>({'Periodo del pago':periodLabelById(x.periodId),'Fecha':x.date,'Referencia':x.reference,'Proveedor':x.provider,'Descripción':x.description,'Monto':x.amount,'Aplicado':paymentAppliedAmount(x),'Pendiente':paymentRemaining(x),'Anticipo':x.isAdvance?'Sí':'No'})));
  appendSheet(wb,'Compromisos arrastrados',[...c.priorPendingPayments.map(x=>({'Tipo':'Pago o anticipo','Periodo de origen':periodLabelById(x.periodId),'Documento':x.reference||'','Proveedor':x.provider||'','Monto original':x.amount,'Monto aplicado':paymentAppliedAmount(x),'Monto pendiente':paymentRemaining(x)})),...c.priorPendingPurchases.map(x=>({'Tipo':'Compra pendiente','Periodo de origen':periodLabelById(x.periodId),'Documento':x.number||'','Proveedor':x.provider||'','Monto original':x.recalcTotal,'Monto aplicado':paidForPurchase(x.id),'Monto pendiente':purchaseUnpaid(x)}))]);
  appendSheet(wb,'Compras',c.purchases.map(x=>({'Periodo de registro':periodLabelById(x.periodId),'No. compra':x.number,'Fecha':x.date,'Proveedor':x.provider,'Descripción':x.description,'Factura':x.invoice,'Serie':x.series,'Origen presupuestario':purchaseOriginSummary(x),'Total PDF':x.pdfTotal,'Total correcto':x.recalcTotal,'Pagado aplicado':paidForPurchase(x.id),'Pendiente de pago':purchaseUnpaid(x)})));
  appendSheet(wb,'Detalle compras',c.purchases.flatMap(x=>(x.lines||[]).map(l=>({'No. compra':x.number,'Fecha':x.date,'Proveedor':x.provider,'SKU':l.sku,'Producto':l.product,'Cantidad solicitada':l.qtyRequested,'Cantidad recibida PDF':l.qtyReceivedShown,'Cantidad contable':l.qtyAccounting,'Costo':l.cost,'Total':l.lineTotal}))));
  appendSheet(wb,'Compras por proveedor',providerSummaryExportRows(c));
  appendSheet(wb,'Consumo proveedor-sucursal',providerBranchExportRows(c));
  appendSheet(wb,'Detalle consumo proveedor',providerDetailExportRows(c));
  appendSheet(wb,'Transferencias',c.transfers.map(t=>({'No. transferencia':t.number,'Fecha':t.date,'Origen':t.originRaw,'Destino':t.destinationName||t.destinationRaw,'Estado':t.transferStatus,'Unidades enviadas':(t.lines||[]).reduce((s,l)=>s+n(l.qtySent),0),'Valor mercadería controlada':(t.lines||[]).reduce((s,l)=>s+n(l.currentValue),0),'Valor stock anterior':(t.lines||[]).reduce((s,l)=>s+n(l.priorValue),0)})));
  appendSheet(wb,'Detalle transferencias',c.transfers.flatMap(t=>(t.lines||[]).map(l=>({'No. transferencia':t.number,'Fecha':t.date,'Destino':t.destinationName||t.destinationRaw,'SKU':l.sku,'Producto':l.product,'Cantidad enviada':l.qtySent,'Cantidad recibida':l.qtyReceived,'Clasificación':({auto:'Automático',current:'Compra controlada',prior:'Stock anterior',split:'Mixto'})[l.allocationType]||'Automático','Periodo(s) presupuestario(s) de origen':l.budgetOriginLabel||'','Costo sugerido':l.suggestedCost??'','Fuente costo':l.costSourceLabel||'','Costo usado':l.costUsed||'','Proveedor de origen':l.providerSourceLabel||providerAllocationSummary(l),'Detalle origen':(l.providerAllocations||[]).map(a=>`${a.provider} · Compra ${a.purchaseNumber||'s/n'} · ${a.budgetOriginLabel||periodLabelById(a.budgetOriginPeriodId)} · ${num(a.qty)} u.`).join(' | '),'Observación origen':l.providerAllocationIssue||'','Cantidad mercadería controlada':l.currentQty,'Valor mercadería controlada':l.currentValue,'Cantidad de presupuesto arrastrado':l.carriedQty||0,'Valor de presupuesto arrastrado':l.carriedValue||0,'Cantidad de presupuesto del periodo':l.currentBudgetQty||0,'Valor de presupuesto del periodo':l.currentBudgetValue||0,'Cantidad stock anterior sin compra':l.priorQty,'Valor stock anterior sin compra':l.priorValue}))));
  appendSheet(wb,'Asignaciones Bodega',c.bodegaAssignments.flatMap(a=>(a.lines||[]).map(l=>({'Fecha':a.date,'Referencia':a.reference,'SKU':l.sku,'Producto':l.product,'Cantidad':l.currentQty,'Costo usado':l.costUsed,'Valor':l.currentValue,'Proveedor de origen':l.providerSourceLabel||providerAllocationSummary(l),'Detalle origen':(l.providerAllocations||[]).map(x=>`${x.provider} · Compra ${x.purchaseNumber||'s/n'} · ${num(x.qty)} u.`).join(' | '),'Observación':a.notes}))));
  appendSheet(wb,'Pendiente de asignar',c.pendingInventory.map(r=>({'SKU':r.sku,'Producto':r.product,'Periodo(s) de origen':r.originSummary,'Compra(s) de origen':r.purchaseSummary,'Comprado':r.purchasedQty,'Asignado':r.usedQty,'Disponible':r.availableQty,'Último costo':r.lastCost,'Valor pendiente':r.value})));
  appendSheet(wb,'Asociaciones pago-compra',state.payments.filter(p=>p.status!=='anulado').flatMap(p=>(p.allocations||[]).map(a=>{const pu=state.purchases.find(x=>x.id===a.purchaseId);return {'Periodo del pago':periodLabelById(p.periodId),'Referencia pago':p.reference,'Fecha pago':p.date,'Proveedor pago':p.provider,'Periodo de registro compra':periodLabelById(pu?.periodId),'No. compra':pu?.number||'','Proveedor compra':pu?.provider||'','Monto aplicado':a.amount,'Origen presupuestario resultante':pu?purchaseOriginSummary(pu):''}})));
  appendSheet(wb,'Distribuciones',c.distributions.flatMap(d=>(d.allocations||[]).map(a=>({'Fecha':d.date,'Método':d.method,'Sucursal':BRANCHES.find(b=>b.code===a.branchCode)?.name||a.branchCode,'Monto':a.amount}))));
  appendSheet(wb,'Conciliación bancaria',[{'Concepto':'Saldo inicial','Monto':c.p.openingBank},{'Concepto':'Presupuestos recibidos','Monto':c.budgetsTotal},{'Concepto':'Pagos a proveedores','Monto':-c.paymentsTotal},{'Concepto':'Ajustes','Monto':c.adjustmentsTotal},{'Concepto':'Saldo esperado','Monto':c.expectedBank},{'Concepto':'Saldo real','Monto':c.actualBank??''},{'Concepto':'Diferencia','Monto':c.bankDiff??''}]);
  appendSheet(wb,'Advertencias',buildAlerts().map(a=>({'Tipo':a.title,'Detalle':a.message,'Guía':a.guide,'Severidad':a.severity})));
  appendSheet(wb,'Documentos',inPeriod(state.documents).map(d=>({'Archivo':d.name,'Tipo':typeLabel(d.type),'Estado':d.status,'Fecha de carga':d.createdAt,'Registro':d.relatedLabel||'','Hash':d.hash})));
  const fn=`Presupuesto_ALVSOL_${c.p.year}-${String(c.p.month).padStart(2,'0')}.xlsx`;XLSX.writeFile(wb,fn,{cellStyles:true});toast('Excel completo generado.','success');
}
function appendSheet(wb,name,data){
  const isAoa=Array.isArray(data)&&data.length&&Array.isArray(data[0]),safe=Array.isArray(data)&&data.length?data:(isAoa?[[]]:[{}]);const ws=isAoa?XLSX.utils.aoa_to_sheet(safe):XLSX.utils.json_to_sheet(safe);
  const range=XLSX.utils.decode_range(ws['!ref']||'A1:A1'),headers=[];for(let C=range.s.c;C<=range.e.c;C++)headers.push(String(ws[XLSX.utils.encode_cell({r:range.s.r,c:C})]?.v||''));
  const widths=[];for(let C=range.s.c;C<=range.e.c;C++){let max=String(headers[C-range.s.c]||'').length;for(let R=range.s.r+1;R<=range.e.r;R++){const v=ws[XLSX.utils.encode_cell({r:R,c:C})]?.v;if(v!==undefined&&v!==null)max=Math.max(max,String(v).length)}const h=norm(headers[C-range.s.c]);let min=12,cap=32;if(/PROVEEDOR|SUCURSAL/.test(h)){min=24;cap=34}else if(/PRODUCTO|DESCRIPCION|DETALLE|OBSERVACION|GUIA|ORIGEN/.test(h)){min=28;cap=46}else if(/FECHA|SKU|ESTADO|REFERENCIA|COMPRA/.test(h)){min=14;cap=26}else if(/MONTO|TOTAL|VALOR|COSTO|SALDO|GASTO|AUMENTO|PAGADO|PENDIENTE|CONSUMO/.test(h)){min=16;cap=22}widths.push({wch:Math.min(cap,Math.max(min,max+2))});}
  ws['!cols']=widths;ws['!rows']=Array.from({length:range.e.r-range.s.r+1},(_,i)=>({hpt:i===0?34:24}));
  for(let R=range.s.r+1;R<=range.e.r;R++){let lines=1;for(let C=range.s.c;C<=range.e.c;C++){const v=ws[XLSX.utils.encode_cell({r:R,c:C})]?.v;if(v===undefined||v===null)continue;const width=widths[C-range.s.c]?.wch||18;lines=Math.max(lines,Math.ceil(String(v).length/Math.max(8,width-2)));}ws['!rows'][R-range.s.r]={hpt:Math.min(90,Math.max(24,lines*15))};}
  styleRange(ws,`${XLSX.utils.encode_col(range.s.c)}1:${XLSX.utils.encode_col(range.e.c)}1`,XLS_STYLES.header);applyThinBorder(ws,ws['!ref']||'A1:A1');
  for(let R=range.s.r+1;R<=range.e.r;R++)for(let C=range.s.c;C<=range.e.c;C++){const addr=XLSX.utils.encode_cell({r:R,c:C}),cell=ws[addr];if(!cell)continue;cell.s={...(cell.s||{}),alignment:{vertical:'top',wrapText:true}};const h=norm(headers[C-range.s.c]);if(typeof cell.v==='number'&&/%/.test(headers[C-range.s.c]))cell.z='0.0%';else if(typeof cell.v==='number'&&/MONTO|TOTAL|VALOR|COSTO|SALDO|GASTO|AUMENTO|PAGADO|PENDIENTE|CONSUMO/.test(h)&&!/UNIDADES|CANTIDAD/.test(h))cell.z='Q #,##0.00;[Red](Q #,##0.00)';}
  ws['!autofilter']={ref:ws['!ref']||'A1:A1'};ws['!freeze']={xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft',state:'frozen'};XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
}
function exportEvidenceIndex(){const rows=[['Archivo','Tipo','Estado','Fecha de carga','Registro relacionado'],...inPeriod(state.documents).map(d=>[d.name,typeLabel(d.type),d.status,d.createdAt,d.relatedLabel||''])];const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');downloadBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`Evidencias_${periodName(currentPeriod()).replace(/ /g,'_')}.csv`);toast('Listado de evidencias exportado.','success')}

// ---------- Inicio ----------
async function init(){
  try{await loadState()}catch(e){console.error(e);toast('No se pudo abrir la base local.','danger')}
  render();
  window.addEventListener('beforeunload',()=>{if(ocrWorker)ocrWorker.terminate().catch(()=>{})});
}
init();

})();
