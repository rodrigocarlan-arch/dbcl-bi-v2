/* ════════════════════════════════════════════════════════════
   dbcl Legal Ops BI · app.js
   Estado global, helpers, todas as telas e drill-downs
   ════════════════════════════════════════════════════════════ */

/* ───────── ESTADO ───────── */
const S = {
  screen: 'painel',
  meses: [D.meses[D.meses.length-1]], // abre no mês mais recente
  periodKind: 'month',
  carteira: 'ativos',              // inativos só aparecem sob escolha explícita
  rate: 'mensal',                  // custo | mensal | pontual
  tmMode: 'sem',                   // times: sem/com sócios
  hmTime: 'todos', hmAtivo: 'ativo',
  mFilter: 'todos', mSortK: 'margem', mSortAsc: true,
  prFilter: 'todos', prSortK: 'm', prSortAsc: false,
  jFilter: 'horas', jSortK: 'ca', jSortAsc: false,
  charts: {},
};

/* Fatores de tabela de hora — derivados da planilha TIME E VALORES.
   O pipeline calcula custo com a tabela MENSAL. Custo e Pontual são
   estimativas proporcionais (média ponderada dos cargos) até o
   pipeline entregar o cálculo exato por lançamento. */
const RATE_FACTOR = { custo: 0.55, mensal: 1.0, pontual: 1.60 };
const RATE_LABEL = {
  custo: 'Custo interno estimado (≈55% da tabela mensal)',
  mensal: 'Tabela Mensal (base do pipeline)',
  pontual: 'Tabela Pontual estimada (≈160% da mensal)'
};

const monthDate = m => new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1);
const mLbl = m => monthDate(m).toLocaleDateString('pt-BR',{month:'short'}).replace('.','').replace(/^./,c=>c.toUpperCase());
const mFullLbl = m => monthDate(m).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());

/* ───────── HELPERS ───────── */
const F = RATE_FACTOR; 
const rf = () => F[S.rate];
const fmt = v => v==null ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const fmtK = v => v==null ? '—' : (Math.abs(v)>=1000 ? 'R$ '+(v/1000).toFixed(0)+'k' : fmt(v));
const fmtH = v => v==null ? '—' : v.toLocaleString('pt-BR',{maximumFractionDigits:1});
const fmtP = v => v==null ? '—' : v.toFixed(1).replace('.',',')+'%';
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const cm = (v,inv) => v==null ? '' : (inv ? (v<0?'g':v>0?'r':'') : (v>0?'g':v<0?'r':''));

// custo ajustado pela tabela ativa
const C = v => (v||0) * rf();
// margem ajustada: receita - custo*fator
const M = (rec, custo) => (rec||0) - C(custo);

function isActive(item){
  if(typeof item.ativo==='boolean') return item.ativo;
  if(typeof item.ok==='boolean') return item.ok;
  const detail = item.cod ? D.servicos_det[item.cod] : null;
  return detail ? detail.ativo!==false : true;
}
function carteiraRows(rows){
  if(S.carteira==='todos') return rows;
  return rows.filter(item=>S.carteira==='ativos' ? isActive(item) : !isActive(item));
}
function clientIsActive(name){
  const services = D.cli_det[name]?.svcs || [];
  return services.some(service=>service.ativo!==false);
}
function carteiraDescription(){
  return S.carteira==='ativos' ? 'carteira ativa' : S.carteira==='inativos' ? 'histórico inativo' : 'ativos e inativos';
}

// soma pm de um objeto {mes:{h,c}} apenas nos meses ativos
function sumPM(pm, key){ let s=0; for(const m of S.meses){ if(pm && pm[m]) s += pm[m][key]||0; } return s; }
function pmVals(pm, key){ return S.meses.map(m => (pm && pm[m]) ? (pm[m][key]||0) : 0); }

// trend: compara último mês ativo vs anterior
function trendHTML(vals, fmtFn, invert){
  if(vals.length<2) return '';
  const a=vals[vals.length-2], b=vals[vals.length-1];
  if(a===0 && b===0) return '<span class="trend flat">—</span>';
  const d = a===0 ? 100 : ((b-a)/Math.abs(a))*100;
  const up = d>2, down = d<-2;
  const cls = invert ? (up?'down':down?'up':'flat') : (up?'up':down?'down':'flat');
  const arrow = up?'▲':down?'▼':'■';
  return `<span class="trend ${cls}">${arrow} ${Math.abs(d).toFixed(0)}%</span>`;
}
function sparkHTML(vals, neg){
  const mx = Math.max(...vals.map(Math.abs), 1);
  return '<span class="spark">' + vals.map(v=>`<i style="height:${Math.max(2,Math.abs(v)/mx*20)}px" class="${(neg&&v<0)?'neg':''}"></i>`).join('') + '</span>';
}

function destroyChart(id){ if(S.charts[id]){ S.charts[id].destroy(); delete S.charts[id]; } }
function mkChart(id, cfg){ destroyChart(id); const el=document.getElementById(id); if(!el) return; S.charts[id]=new Chart(el, cfg); }

Chart.defaults.font.family = "'Inter',system-ui,sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#6B6A62';
Chart.defaults.plugins.legend.labels.boxWidth = 10;

/* ───────── DADOS DERIVADOS (recalculados por período/tabela) ───────── */
function mensalCalc(){
  return D.mensal.map(m => {
    const h = sumPM(m.pm,'h'), hp = sumPM(m.pm,'hp'), hi = sumPM(m.pm,'hi');
    const cRaw = sumPM(m.pm,'c'), rec = sumPM(m.pm,'r');
    const custo = C(cRaw), margem = rec - custo;
    const mpct = rec>0 ? margem/rec*100 : null;
    return {...m, _h:h,_hp:hp,_hi:hi,_cRaw:cRaw,_custo:custo,_rec:rec,_margem:margem,_mpct:mpct,_recM:rec/Math.max(1,S.meses.length)};
  });
}
function lcCalc(){
  return D.lc.map(p => {
    const h = sumPM(p.pm,'h'), cRaw = sumPM(p.pm,'c');
    const custo = C(cRaw), margem = (p.rec||0) - custo;
    return {...p, ativo:isActive(p), _h:h,_cRaw:cRaw,_custo:custo,_margem:margem,_mp:p.rec>0?margem/p.rec*100:null,_rph:h>0?(p.rec||0)/h:null};
  });
}
function judCalc(){
  return D.jud.map(j => {
    const h = sumPM(j.pm,'h'), cRaw = sumPM(j.pm,'c');
    const ca = C(cRaw);
    const mse = (j.e||0) - ca;
    const be = Math.max(0, ca - (j.e||0));
    const mt = (j.e||0) + (j.x||0) - ca;
    const status = mse>=0 ? 'ok' : (mt>=0 ? 'ganhar' : 'inviavel');
    return {...j, ativo:isActive(j), _h:h,_ca:ca,_mse:mse,_be:be,_mt:mt,_status:status};
  });
}
function hmCalc(){
  return D.hm.map(p => {
    let tot=0,v=0,a=0,g=0,adm=0;
    for(const m of S.meses){ const pm=p.pm[m]; if(pm){tot+=pm.tot;v+=pm.v;a+=pm.a;g+=pm.g;adm+=pm.adm;} }
    const pct = tot>0 ? {v:v/tot*100,a:a/tot*100,g:g/tot*100,adm:adm/tot*100} : {v:0,a:0,g:0,adm:0};
    return {...p, _tot:tot,_h:{v,a,g,adm},_pct:pct};
  });
}

/* ───────── ALERTAS DO PAINEL ───────── */
function buildAlerts(){
  const alerts = [];
  const men = carteiraRows(mensalCalc());
  const recTot = men.reduce((s,m)=>s+m._rec,0);

  // 1. Concentração
  const sorted = men.filter(m=>m._rec>0).sort((a,b)=>b._rec-a._rec);
  if(sorted.length && recTot>0){
    const top = sorted[0], share = top._rec/recTot*100;
    if(share>=25) alerts.push({sev:'r',ico:'⚠️',tit:`${top.cli} concentra ${share.toFixed(0)}% da receita de mensalistas`,act:`<b>Ação:</b> diversificar carteira ou proteger o contrato — risco de dependência crítica`,go:()=>go('portfolio')});
  }
  // 2. Mensalistas negativos
  const neg = men.filter(m=>m._rec>0 && m._margem<0).sort((a,b)=>a._margem-b._margem);
  if(neg.length){
    const pior = neg[0];
    alerts.push({sev:'r',ico:'🔻',tit:`${neg.length} mensalista${neg.length>1?'s':''} com margem negativa · pior: ${pior.cli} (${fmt(pior._margem)})`,act:`<b>Ação:</b> renegociar valor, reduzir escopo ou rever alocação do time nesses clientes`,go:()=>{S.mFilter='neg';go('mensalistas');}});
  }
  // 3. Judiciais inviáveis
  const jud = carteiraRows(judCalc()).filter(j=>j._h>0);
  const inv = jud.filter(j=>j._status==='inviavel');
  if(inv.length){
    const custoInv = inv.reduce((s,j)=>s+j._ca,0);
    alerts.push({sev:'a',ico:'⚖️',tit:`${inv.length} processos inviáveis — mesmo ganhando, o êxito não cobre o custo (${fmt(custoInv)} acumulado)`,act:`<b>Ação:</b> avaliar acordo, redução de dedicação ou repactuação de honorários caso a caso`,go:()=>{S.jFilter='inviavel';go('judicial');}});
  }
  // 4. Sem receita cadastrada
  const semRec = men.filter(m=>m._rec===0 && m._h>2);
  if(semRec.length){
    const custoSR = semRec.reduce((s,m)=>s+m._custo,0);
    alerts.push({sev:'a',ico:'📋',tit:`${semRec.length} clientes com horas lançadas e sem receita na planilha de fixos (${fmt(custoSR)} de custo invisível)`,act:`<b>Ação:</b> financeiro preenche valores na planilha de mensalistas — a margem real está distorcida`,go:()=>{S.mFilter='sem_rec';go('mensalistas');}});
  }
  // 5. Projetos vendidos sem execução
  const lc = carteiraRows(lcCalc());
  const parados = lc.filter(p=>(p.rec||0)>=10000 && p._h===0);
  if(parados.length){
    const recPar = parados.reduce((s,p)=>s+p.rec,0);
    alerts.push({sev:'g',ico:'💤',tit:`${parados.length} projetos vendidos (${fmtK(recPar)}) ainda sem nenhuma hora lançada`,act:`<b>Ação:</b> confirmar se já iniciaram — receita boa, mas execução parada pode virar problema de prazo`,go:()=>{S.prFilter='sem_h';go('projetos');}});
  }
  // 6. Mensalista saudável destaque (positivo)
  const top3 = men.filter(m=>m._rec>0&&m._mpct!=null&&m._mpct>40&&m._h>5).sort((a,b)=>b._margem-a._margem);
  if(top3.length){
    alerts.push({sev:'g',ico:'✅',tit:`${top3.length} mensalistas com margem acima de 40% — carteira saudável a preservar`,act:`<b>Ação:</b> nenhuma — manter nível de serviço; são os contratos que financiam o resto`,go:()=>go('mensalistas')});
  }
  return alerts;
}

/* ───────── NAVEGAÇÃO ───────── */
function go(screen){
  S.screen = screen;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+screen).classList.add('active');
  document.querySelectorAll('.sb-btn[data-s]').forEach(b=>b.classList.toggle('active', b.dataset.s===screen));
  render();
  window.scrollTo(0,0);
}
function toggleList(id){ document.getElementById(id).classList.toggle('open'); }
function filterList(id, q){
  q = q.toLowerCase();
  document.querySelectorAll('#'+id+'-items .sb-list-item').forEach(el=>{
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function closeOv(t){ document.getElementById('ov-'+t).classList.remove('open'); }

/* ───────── PERÍODO ───────── */
let PERIOD_GROUPS = {};

function periodRangeLabel(months){
  if(months.length===1) return mFullLbl(months[0]);
  const first=months[0], last=months[months.length-1];
  const fy=first.slice(0,4), ly=last.slice(0,4);
  return fy===ly ? `${mLbl(first)}–${mLbl(last)} ${fy}` : `${mLbl(first)} ${fy}–${mLbl(last)} ${ly}`;
}
function periodGroups(kind){
  const grouped = new Map();
  D.meses.forEach(month=>{
    const year=month.slice(0,4), number=Number(month.slice(5,7));
    let key, label;
    if(kind==='month'){key=month;label=mFullLbl(month);}
    if(kind==='quarter'){
      const quarter=Math.ceil(number/3);key=`${year}-Q${quarter}`;label=`${quarter}º trimestre de ${year}`;
    }
    if(kind==='semester'){
      const semester=number<=6?1:2;key=`${year}-S${semester}`;label=`${semester}º semestre de ${year}`;
    }
    if(kind==='year'){key=year;label=year;}
    if(!grouped.has(key)) grouped.set(key,{key,label,months:[]});
    grouped.get(key).months.push(month);
  });
  return [...grouped.values()].reverse();
}
function applyPeriod(months,label){
  S.meses=months.slice();
  document.getElementById('period-note').textContent=label || periodRangeLabel(S.meses);
  render();
}
function buildPeriodBar(){
  const options=D.meses.map(m=>`<option value="${m}">${mFullLbl(m)}</option>`).join('');
  document.getElementById('period-start').innerHTML=options;
  document.getElementById('period-end').innerHTML=options;
  setPeriodKind('month');
}
function setPeriodKind(kind){
  S.periodKind=kind;
  document.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('active',b.dataset.kind===kind));
  const selector=document.getElementById('period-select');
  const custom=document.getElementById('custom-period');
  custom.classList.toggle('open',kind==='custom');
  selector.style.display=kind==='custom'?'none':'';

  if(kind==='custom'){
    document.getElementById('period-start').value=S.meses[0]||D.meses[D.meses.length-1];
    document.getElementById('period-end').value=S.meses[S.meses.length-1]||D.meses[D.meses.length-1];
    applyCustomPeriod();
    return;
  }
  if(kind==='all'){
    selector.innerHTML='<option>Todo o histórico disponível</option>';
    applyPeriod(D.meses,periodRangeLabel(D.meses));
    return;
  }
  const groups=periodGroups(kind);
  PERIOD_GROUPS=Object.fromEntries(groups.map(group=>[group.key,group]));
  selector.innerHTML=groups.map(group=>`<option value="${group.key}">${group.label}</option>`).join('');
  selector.value=groups[0].key;
  applyPeriodChoice();
}
function applyPeriodChoice(){
  const group=PERIOD_GROUPS[document.getElementById('period-select').value];
  if(group) applyPeriod(group.months,S.periodKind==='month' ? group.label : `${group.label} · ${periodRangeLabel(group.months)}`);
}
function applyCustomPeriod(){
  const start=document.getElementById('period-start').value;
  const end=document.getElementById('period-end').value;
  const low=Math.min(D.meses.indexOf(start),D.meses.indexOf(end));
  const high=Math.max(D.meses.indexOf(start),D.meses.indexOf(end));
  if(low<0||high<0) return;
  const months=D.meses.slice(low,high+1);
  applyPeriod(months,periodRangeLabel(months));
}
function setCarteira(value){
  S.carteira=value;
  document.querySelectorAll('[data-carteira]').forEach(b=>b.classList.toggle('active',b.dataset.carteira===value));
  buildSidebarLists();
  render();
}
function setRate(r){
  S.rate = r;
  document.querySelectorAll('.rt-btn').forEach(b=>b.classList.toggle('active', b.dataset.rt===r));
  document.getElementById('rt-note').textContent = 'Tabela de hora ativa: ' + RATE_LABEL[r];
  render();
}

/* ───────── PAINEL GERAL ───────── */
function renderPainel(){
  const men = carteiraRows(mensalCalc()), lc = carteiraRows(lcCalc()), jud = carteiraRows(judCalc());
  // KPIs
  const hVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].h:0);
  const hcVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].hc:0);
  const hTot = hVals.reduce((a,b)=>a+b,0);
  const recM = men.reduce((s,m)=>s+m._rec,0);
  const cusM = men.reduce((s,m)=>s+m._custo,0);
  const margM = recM-cusM;
  const margVals = S.meses.map(mo=>{
    let r=0,c=0; men.forEach(m=>{ if(m.pm[mo]){r+=m.pm[mo].r||0;c+=C(m.pm[mo].c||0);} }); return r-c;
  });
  const negN = men.filter(m=>m._rec>0&&m._margem<0).length;
  const projM = lc.reduce((s,p)=>s+p._margem,0);
  const invN = jud.filter(j=>j._h>0&&j._status==='inviavel').length;

  document.getElementById('pg-sub').textContent = `${carteiraDescription()} · ${D.kpis.pessoas} pessoas ativas · ${men.length} mensalistas · ${lc.length} projetos · ${jud.filter(j=>j._h>0).length} processos com horas no período`;

  document.getElementById('pg-kpis').innerHTML = `
    <div class="kc click" onclick="go('pessoas')"><div class="kc-l">Horas totais</div><div class="kc-v">${fmtH(hTot)}</div><div class="kc-s">${trendHTML(hVals)} vs. mês anterior</div></div>
    <div class="kc click" onclick="go('mensalistas')"><div class="kc-l">Receita mensalistas</div><div class="kc-v">${fmtK(recM)}</div><div class="kc-s">${trendHTML(S.meses.map(mo=>{let r=0;men.forEach(m=>{if(m.pm[mo])r+=m.pm[mo].r||0});return r;}))} no período</div></div>
    <div class="kc click" onclick="go('mensalistas')"><div class="kc-l">Margem mensalistas</div><div class="kc-v ${margM>=0?'g':'r'}">${fmtK(margM)}</div><div class="kc-s">${trendHTML(margVals)} ${negN>0?`· <span style="color:var(--red);font-weight:600">${negN} negativos</span>`:''}</div></div>
    <div class="kc click" onclick="go('judicial')"><div class="kc-l">Judicial · inviáveis</div><div class="kc-v ${invN>0?'r':'g'}">${invN}</div><div class="kc-s">processos onde êxito não cobre custo</div></div>`;

  // Alertas
  const alerts = buildAlerts();
  const badge = document.getElementById('sb-alert-n');
  const crit = alerts.filter(a=>a.sev==='r').length;
  badge.style.display = crit>0 ? '' : 'none';
  badge.textContent = crit;
  window._alerts = alerts;
  document.getElementById('pg-alerts').innerHTML = alerts.map((a,i)=>
    `<div class="al sev-${a.sev}" onclick="window._alerts[${i}].go()"><span class="al-ico">${a.ico}</span><div><div class="al-tit">${a.tit}</div><div class="al-act">${a.act}</div></div><span class="al-go">abrir →</span></div>`).join('') || '<div class="note">Nenhum alerta no período. Carteira sob controle.</div>';

  // Chart horas
  mkChart('c-pg-horas', {type:'line',data:{labels:S.meses.map(mLbl),datasets:[
    {label:'Total',data:hVals,borderColor:'#0F6E56',backgroundColor:'rgba(15,110,86,.08)',fill:true,tension:.3},
    {label:'Em clientes',data:hcVals,borderColor:'#C47A00',tension:.3}
  ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});

  // Chart margem mensalistas
  const recVals = S.meses.map(mo=>{let r=0;men.forEach(m=>{if(m.pm[mo])r+=m.pm[mo].r||0});return r;});
  const cusVals = S.meses.map(mo=>{let c=0;men.forEach(m=>{if(m.pm[mo])c+=C(m.pm[mo].c||0)});return c;});
  mkChart('c-pg-marg', {type:'bar',data:{labels:S.meses.map(mLbl),datasets:[
    {label:'Receita',data:recVals,backgroundColor:'#0F6E56'},
    {label:'Custo ('+S.rate+')',data:cusVals,backgroundColor:'#C0392B'}
  ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}}}});

  // Concentração top 10
  const sorted = men.filter(m=>m._rec>0).sort((a,b)=>b._rec-a._rec).slice(0,10);
  const recTot = men.reduce((s,m)=>s+m._rec,0);
  document.getElementById('pg-conc').innerHTML = sorted.map(m=>{
    const pct = m._rec/recTot*100;
    return `<div class="conc-row" onclick="openCliente('${esc(m.cli)}')"><div class="conc-nm">${esc(m.cli)}</div><div class="conc-bar"><div class="conc-fill" style="width:${pct}%;${pct>=25?'background:var(--red)':''}"></div></div><div class="conc-val">${fmtK(m._rec)} · ${pct.toFixed(0)}%</div></div>`;
  }).join('');

  // Worst margins
  const worst = men.filter(m=>m._rec>0).sort((a,b)=>a._margem-b._margem).slice(0,6);
  document.getElementById('pg-worst').innerHTML = `<thead><tr><th>Cliente</th><th class="r">Receita</th><th class="r">Custo</th><th class="r">Margem</th><th class="r">%</th></tr></thead><tbody>` +
    worst.map(m=>`<tr onclick="openCliente('${esc(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td class="tr">${fmtK(m._rec)}</td><td class="tr">${fmtK(m._custo)}</td><td class="tr" style="color:${m._margem<0?'var(--red)':'var(--g2)'};font-weight:600">${fmtK(m._margem)}</td><td class="tr">${fmtP(m._mpct)}</td></tr>`).join('') + '</tbody>';
}

/* ───────── TIMES ───────── */
function tmTgl(mode, btn){
  S.tmMode = mode;
  btn.parentElement.querySelectorAll('.tgl').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderTimes();
}
function renderTimes(){
  const td = D.times[S.tmMode==='sem'?'sem_socios':'com_socios'];
  const names = Object.keys(td);
  // KPIs from filtered months
  let hTot=0, hCli=0, pessoas = new Set();
  names.forEach(n=>{ for(const m of S.meses){ const pm=td[n].pm[m]; if(pm){ hTot+=pm.tot; hCli+=pm.v+pm.a+pm.g; } } });
  const hmAll = hmCalc();
  const ct = hmAll.reduce((s,p)=>s+0,0);
  document.getElementById('t-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Horas no período</div><div class="kc-v">${fmtH(hTot)}</div></div>
    <div class="kc"><div class="kc-l">% em clientes</div><div class="kc-v g">${hTot>0?fmtP(hCli/hTot*100):'—'}</div></div>
    <div class="kc"><div class="kc-l">Times técnicos</div><div class="kc-v">${names.filter(n=>n!=='Administrativo').length}</div></div>
    <div class="kc"><div class="kc-l">Pessoas no período</div><div class="kc-v">${D.kpis.pessoas}</div></div>`;

  // Stacked bar by month
  const colors = {'Trabalhista':'#64B5F6','Contencioso':'#EF9A9A','Consultivo':'#80CBC4','Cons. Tributária':'#CE93D8','Administrativo':'#B0BEC5'};
  mkChart('c-tm',{type:'bar',data:{labels:S.meses.map(mLbl),datasets:names.map(n=>({label:n,data:S.meses.map(m=>td[n].pm[m]?td[n].pm[m].tot:0),backgroundColor:colors[n]||'#999'}))},
    options:{maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});

  // Composition bars
  document.getElementById('t-bars').innerHTML = names.map(n=>{
    let v=0,a=0,g=0,adm=0,t=0;
    for(const m of S.meses){ const pm=td[n].pm[m]; if(pm){v+=pm.v;a+=pm.a;g+=pm.g;adm+=pm.adm;t+=pm.tot;} }
    if(t===0) return '';
    return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><b>${n}</b><span class="tm">${fmtH(t)}h</span></div>
      <div class="sbar"><div class="sv" style="width:${v/t*100}%"></div><div class="sa" style="width:${a/t*100}%"></div><div class="sg" style="width:${g/t*100}%"></div><div class="sd" style="width:${adm/t*100}%"></div></div></div>`;
  }).join('');

  // Table
  let html = `<thead><tr><th>Time</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Total</th><th class="r">🔴%</th><th class="r">🟡%</th><th class="r">🟢%</th><th class="r">⬜%</th></tr></thead><tbody>`;
  names.forEach(n=>{
    let v=0,a=0,g=0,adm=0,t=0; const cells = S.meses.map(m=>{const pm=td[n].pm[m];const tt=pm?pm.tot:0;if(pm){v+=pm.v;a+=pm.a;g+=pm.g;adm+=pm.adm;t+=pm.tot;}return `<td class="tr">${fmtH(tt)}</td>`;}).join('');
    html += `<tr><td><b>${n}</b></td>${cells}<td class="tr"><b>${fmtH(t)}</b></td><td class="tr">${t>0?fmtP(v/t*100):'—'}</td><td class="tr">${t>0?fmtP(a/t*100):'—'}</td><td class="tr">${t>0?fmtP(g/t*100):'—'}</td><td class="tr">${t>0?fmtP(adm/t*100):'—'}</td></tr>`;
  });
  document.getElementById('t-table').innerHTML = html + '</tbody>';
}

/* ───────── HEATMAP ───────── */
function hmF(t,b){S.hmTime=t;b.parentElement.querySelectorAll('[data-g="t"]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderHeatmap();}
function hmA(a,b){S.hmAtivo=a;b.parentElement.querySelectorAll('[data-g="a"]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderHeatmap();}
function buildHmFilters(){
  const times = ['todos',...new Set(D.hm.map(p=>p.time))];
  document.getElementById('hm-filters').innerHTML =
    `<span class="fb-lbl">Time:</span>` + times.map(t=>`<button class="fb-btn ${t===S.hmTime?'active':''}" data-g="t" onclick="hmF('${t}',this)">${t==='todos'?'Todos':t}</button>`).join('') +
    `<span class="fb-lbl" style="margin-left:8px">Status:</span>
     <button class="fb-btn ${S.hmAtivo==='ativo'?'active':''}" data-g="a" onclick="hmA('ativo',this)">Ativos</button>
     <button class="fb-btn ${S.hmAtivo==='todos'?'active':''}" data-g="a" onclick="hmA('todos',this)">Todos</button>`;
}
const HM_COLORS = {v:'192,57,43',a:'196,122,0',g:'46,125,50',adm:'84,110,122'};
function hcell(pct, dev, key){
  const op = Math.min(.85, .08 + pct/100*.9);
  const arrow = dev==='low'?'<sup>⬇</sup>':dev==='high'?'<sup>⬆</sup>':'';
  return `<td style="text-align:center"><span class="hcell" style="background:rgba(${HM_COLORS[key]},${op});color:${pct>35?'#fff':'#333'}">${pct.toFixed(0)}%${arrow}</span></td>`;
}
function renderHeatmap(){
  buildHmFilters();
  let rows = hmCalc().filter(p=>p._tot>0.5);
  if(S.hmTime!=='todos') rows = rows.filter(p=>p.time===S.hmTime);
  if(S.hmAtivo==='ativo') rows = rows.filter(p=>p.ativo);
  // group by time
  const byTime = {};
  rows.forEach(p=>{ (byTime[p.time]=byTime[p.time]||[]).push(p); });
  let html = '';
  Object.keys(byTime).forEach(t=>{
    html += `<tr class="grow"><td colspan="8">${t}</td></tr>`;
    byTime[t].sort((a,b)=>b._tot-a._tot).forEach(p=>{
      const t2=p._tot;
      html += `<tr onclick="openPessoa('${esc(p.adv)}')">
        <td class="lk">${esc(p.adv)}${p.ativo?'':' <span class="badge bc">saiu</span>'}</td>
        <td class="tm">${p.fn} · ${p.cargo}</td>
        <td style="text-align:center"><b>${fmtH(t2)}</b></td>
        ${hcell(p._pct.v,p.dev.v,'v')}${hcell(p._pct.a,p.dev.a,'a')}${hcell(p._pct.g,p.dev.g,'g')}${hcell(p._pct.adm,p.dev.adm,'adm')}
        <td><div class="sbar"><div class="sv" style="width:${p._pct.v}%"></div><div class="sa" style="width:${p._pct.a}%"></div><div class="sg" style="width:${p._pct.g}%"></div><div class="sd" style="width:${p._pct.adm}%"></div></div></td>
      </tr>`;
    });
  });
  document.getElementById('hm-body').innerHTML = html;
}

/* ───────── PESSOAS ───────── */
function renderPessoas(){
  const rows = hmCalc().filter(p=>p._tot>0.5 && p.ativo).sort((a,b)=>b._tot-a._tot);
  mkChart('c-p-rank',{type:'bar',data:{labels:rows.map(p=>p.adv.split(' ')[0]+' '+(p.adv.split(' ')[1]||'').slice(0,1)+'.'),datasets:[
    {label:'Vermelho',data:rows.map(p=>p._h.v),backgroundColor:'#C0392B'},
    {label:'Amarelo',data:rows.map(p=>p._h.a),backgroundColor:'#C47A00'},
    {label:'Verde',data:rows.map(p=>p._h.g),backgroundColor:'#2E7D32'},
    {label:'Admin',data:rows.map(p=>p._h.adm),backgroundColor:'#546E7A'}
  ]},options:{indexAxis:'y',maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}},onClick:(e,el)=>{if(el.length)openPessoa(rows[el[0].index].adv);}}});

  const hVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].h:0);
  const hcVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].hc:0);
  const nVals = S.meses.map(m=>D.kpm[m]?D.kpm[m].n:0);
  mkChart('c-p-evo',{data:{labels:S.meses.map(mLbl),datasets:[
    {type:'bar',label:'Horas totais',data:hVals,backgroundColor:'rgba(15,110,86,.25)',yAxisID:'y'},
    {type:'bar',label:'Em clientes',data:hcVals,backgroundColor:'#0F6E56',yAxisID:'y'},
    {type:'line',label:'Pessoas lançando',data:nVals,borderColor:'#C47A00',yAxisID:'y2',tension:.3}
  ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{position:'left'},y2:{position:'right',grid:{display:false}}}}});

  let html = `<thead><tr><th>Colaborador</th><th>Time</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Total</th><th class="r">Média/mês</th></tr></thead><tbody>`;
  hmCalc().filter(p=>p._tot>0.5).sort((a,b)=>b._tot-a._tot).forEach(p=>{
    const cells = S.meses.map(m=>`<td class="tr">${fmtH(p.pm[m]?p.pm[m].tot:0)}</td>`).join('');
    const nm = S.meses.filter(m=>p.pm[m]&&p.pm[m].tot>0).length||1;
    html += `<tr onclick="openPessoa('${esc(p.adv)}')"><td class="lk">${esc(p.adv)}${p.ativo?'':' <span class="badge bc">saiu</span>'}</td><td class="tm">${p.time}</td>${cells}<td class="tr"><b>${fmtH(p._tot)}</b></td><td class="tr">${fmtH(p._tot/nm)}</td></tr>`;
  });
  document.getElementById('p-table').innerHTML = html + '</tbody>';
}

/* ───────── MENSALISTAS ───────── */
function mF(f,b){S.mFilter=f;b.parentElement.querySelectorAll('.fb-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderMensalistas();}
function mSort(k){ if(S.mSortK===k){S.mSortAsc=!S.mSortAsc;}else{S.mSortK=k;S.mSortAsc=(k==='margem'||k==='mpct');} renderMensalistas(); }
function buildMFilters(){
  const opts=[['todos','Todos'],['com_rec','Com receita'],['neg','Negativos'],['sem_rec','Sem receita'],['inc','Com inclusos']];
  document.getElementById('m-filters').innerHTML = `<span class="fb-lbl">Ver:</span>`+opts.map(([k,l])=>`<button class="fb-btn ${k===S.mFilter?'active':''}" onclick="mF('${k}',this)">${l}</button>`).join('');
}
function renderMensalistas(){
  buildMFilters();
  let rows = carteiraRows(mensalCalc());
  const all = rows;
  if(S.mFilter==='com_rec') rows=rows.filter(m=>m._rec>0);
  if(S.mFilter==='neg') rows=rows.filter(m=>m._rec>0&&m._margem<0);
  if(S.mFilter==='sem_rec') rows=rows.filter(m=>m._rec===0&&m._h>0);
  if(S.mFilter==='inc') rows=rows.filter(m=>m.n_inc>0);

  const recT=all.reduce((s,m)=>s+m._rec,0), cusT=all.reduce((s,m)=>s+m._custo,0);
  const negN=all.filter(m=>m._rec>0&&m._margem<0).length;
  const semN=all.filter(m=>m._rec===0&&m._h>2).length;
  document.getElementById('m-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Receita total</div><div class="kc-v">${fmtK(recT)}</div></div>
    <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(cusT)}</div></div>
    <div class="kc"><div class="kc-l">Margem</div><div class="kc-v ${recT-cusT>=0?'g':'r'}">${fmtK(recT-cusT)}</div><div class="kc-s">${recT>0?fmtP((recT-cusT)/recT*100):''}</div></div>
    <div class="kc click" onclick="S.mFilter='neg';renderMensalistas()"><div class="kc-l">Negativos / Sem receita</div><div class="kc-v ${negN>0?'r':'g'}">${negN} <span style="font-size:14px;color:var(--c3)">/ ${semN}</span></div></div>`;

  // Rank chart (worst to best, com receita)
  const wr = all.filter(m=>m._rec>0).sort((a,b)=>a._margem-b._margem);
  mkChart('c-m-rank',{type:'bar',data:{labels:wr.map(m=>m.cli.slice(0,18)),datasets:[
    {label:'Margem',data:wr.map(m=>m._margem),backgroundColor:wr.map(m=>m._margem<0?'#C0392B':'#0F6E56')}
  ]},options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}},onClick:(e,el)=>{if(el.length)openCliente(wr[el[0].index].cli);}}});

  // Scatter
  const sc = all.filter(m=>m._rec>0||m._custo>0);
  mkChart('c-m-scat',{type:'bubble',data:{datasets:[{label:'Clientes',data:sc.map(m=>({x:m._rec,y:m._custo,r:Math.max(4,Math.min(18,Math.sqrt(m._h)*1.6)),cli:m.cli})),
    backgroundColor:sc.map(m=>m._margem>=0?'rgba(15,110,86,.55)':'rgba(192,57,43,.6)')}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.cli}: rec ${fmtK(c.raw.x)} · custo ${fmtK(c.raw.y)}`}}},
    scales:{x:{title:{display:true,text:'Receita'},ticks:{callback:v=>'R$'+(v/1000)+'k'}},y:{title:{display:true,text:'Custo'},ticks:{callback:v=>'R$'+(v/1000)+'k'}}},
    onClick:(e,el)=>{if(el.length)openCliente(sc[el[0].index].cli);}}});

  // Table
  rows.sort((a,b)=>{const va=a['_'+S.mSortK]??a[S.mSortK]??0, vb=b['_'+S.mSortK]??b[S.mSortK]??0; return S.mSortAsc?(va-vb):(vb-va);});
  document.getElementById('m-body').innerHTML = rows.map(m=>{
    const margVals = S.meses.map(mo=>{const pm=m.pm[mo];return pm?(pm.r||0)-C(pm.c||0):0;});
    return `<tr onclick="openCliente('${esc(m.cli)}')">
      <td class="lk">${esc(m.cli)}${m.n_inc>0?` <span class="badge bg">${m.n_inc} inc</span>`:''}</td>
      <td class="tm">${m.resp||''}</td>
      <td class="tr">${fmtK(m._recM)}</td><td class="tr">${fmtK(m._rec)}</td>
      <td class="tr">${fmtH(m._h)}</td><td class="tr tm">${fmtH(m._hp)}</td><td class="tr tm">${fmtH(m._hi)}</td>
      <td class="tr">${fmtK(m._custo)}</td>
      <td class="tr" style="font-weight:600;color:${m._margem<0?'var(--red)':'var(--g2)'}">${fmtK(m._margem)}</td>
      <td class="tr">${fmtP(m._mpct)}</td>
      <td>${sparkHTML(margVals,true)}</td>
    </tr>`;
  }).join('');
}

/* ───────── PROJETOS ───────── */
function prF(f,b){S.prFilter=f;b.parentElement.querySelectorAll('.fb-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderProjetos();}
function prSort(k){ if(S.prSortK===k){S.prSortAsc=!S.prSortAsc;}else{S.prSortK=k;S.prSortAsc=false;} renderProjetos(); }
function buildPrFilters(){
  const opts=[['todos','Todos'],['com_h','Com horas'],['sem_h','Sem horas'],['neg','Negativos']];
  document.getElementById('pr-filters').innerHTML = `<span class="fb-lbl">Ver:</span>`+opts.map(([k,l])=>`<button class="fb-btn ${k===S.prFilter?'active':''}" onclick="prF('${k}',this)">${l}</button>`).join('');
}
function renderProjetos(){
  buildPrFilters();
  const all = carteiraRows(lcCalc());
  let rows = all;
  if(S.prFilter==='com_h') rows=rows.filter(p=>p._h>0);
  if(S.prFilter==='sem_h') rows=rows.filter(p=>p._h===0);
  if(S.prFilter==='neg') rows=rows.filter(p=>p._margem<0);

  const recT=all.reduce((s,p)=>s+(p.rec||0),0), cusT=all.reduce((s,p)=>s+p._custo,0);
  const semH=all.filter(p=>p._h===0).length, negN=all.filter(p=>p._margem<0).length;
  document.getElementById('pr-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Receita contratada</div><div class="kc-v">${fmtK(recT)}</div></div>
    <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(cusT)}</div></div>
    <div class="kc"><div class="kc-l">Margem</div><div class="kc-v g">${fmtK(recT-cusT)}</div></div>
    <div class="kc"><div class="kc-l">Sem horas / Negativos</div><div class="kc-v ${negN>0?'a':''}">${semH} <span style="font-size:14px;color:var(--c3)">/ ${negN}</span></div></div>`;

  const top = all.filter(p=>p._h>0).sort((a,b)=>b._margem-a._margem).slice(0,12);
  mkChart('c-pr-top',{type:'bar',data:{labels:top.map(p=>p.lbl.slice(0,20)),datasets:[{label:'Margem',data:top.map(p=>p._margem),backgroundColor:top.map(p=>p._margem<0?'#C0392B':'#0F6E56')}]},
    options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}},onClick:(e,el)=>{if(el.length)openServico(top[el[0].index].cod);}}});

  const sc = all.filter(p=>p._h>0);
  mkChart('c-pr-scat',{type:'bubble',data:{datasets:[{data:sc.map(p=>({x:p.rec||0,y:p._custo,r:Math.max(4,Math.min(16,Math.sqrt(Math.abs(p._margem))/20)),lbl:p.lbl,cli:p.cli})),
    backgroundColor:sc.map(p=>p._margem>=0?'rgba(15,110,86,.55)':'rgba(192,57,43,.6)')}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.cli} · ${c.raw.lbl}`}}},
    scales:{x:{title:{display:true,text:'Receita'},ticks:{callback:v=>'R$'+(v/1000)+'k'}},y:{title:{display:true,text:'Custo'},ticks:{callback:v=>'R$'+(v/1000)+'k'}}},
    onClick:(e,el)=>{if(el.length)openServico(sc[el[0].index].cod);}}});

  rows = rows.slice().sort((a,b)=>{const va=a['_'+S.prSortK]??a[S.prSortK]??0,vb=b['_'+S.prSortK]??b[S.prSortK]??0;return S.prSortAsc?va-vb:vb-va;});
  document.getElementById('pr-body').innerHTML = rows.map(p=>`<tr onclick="openServico('${p.cod}')">
    <td class="lk">${esc(p.lbl)}</td><td><span class="lk" onclick="event.stopPropagation();openCliente('${esc(p.cli)}')">${esc(p.cli)}</span></td>
    <td class="tm">${p.resp||''}</td><td><span class="badge bc">${p.area||''}</span></td>
    <td class="tr">${fmtK(p.rec)}</td><td class="tr">${fmtK(p._custo)}</td>
    <td class="tr" style="font-weight:600;color:${p._margem<0?'var(--red)':'var(--g2)'}">${fmtK(p._margem)}</td>
    <td class="tr">${fmtP(p._mp)}</td><td class="tr">${fmtH(p._h)}</td><td class="tr tm">${p._rph?fmtK(p._rph):'—'}</td>
  </tr>`).join('');
}

/* ───────── JUDICIAL ───────── */
function jF(f,b){S.jFilter=f;b.parentElement.querySelectorAll('.fb-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderJudicial();}
function jSort(k){ if(S.jSortK===k){S.jSortAsc=!S.jSortAsc;}else{S.jSortK=k;S.jSortAsc=false;} renderJudicial(); }
function buildJFilters(){
  const opts=[['horas','Com horas'],['deficit','Custo > entrada'],['ok','Entrada cobre'],['ganhar','Viável c/ êxito'],['inviavel','Inviável']];
  document.getElementById('j-filters').innerHTML = `<span class="fb-lbl">Ver:</span>`+opts.map(([k,l])=>`<button class="fb-btn ${k===S.jFilter?'active':''}" onclick="jF('${k}',this)">${l}</button>`).join('');
}
const J_STATUS = {ok:['Entrada cobre','bg'],ganhar:['Viável c/ êxito','ba'],inviavel:['Inviável','br']};
function renderJudicial(){
  buildJFilters();
  const all = carteiraRows(judCalc()).filter(j=>j._h>0);
  let rows = all;
  if(S.jFilter==='deficit') rows=rows.filter(j=>j._mse<0);
  if(S.jFilter==='ok') rows=rows.filter(j=>j._status==='ok');
  if(S.jFilter==='ganhar') rows=rows.filter(j=>j._status==='ganhar');
  if(S.jFilter==='inviavel') rows=rows.filter(j=>j._status==='inviavel');

  const eT=all.reduce((s,j)=>s+(j.e||0),0), caT=all.reduce((s,j)=>s+j._ca,0), xT=all.reduce((s,j)=>s+(j.x||0),0);
  const invN=all.filter(j=>j._status==='inviavel').length;
  document.getElementById('j-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Entradas (não contingente)</div><div class="kc-v">${fmtK(eT)}</div></div>
    <div class="kc"><div class="kc-l">Custo acumulado (${S.rate})</div><div class="kc-v">${fmtK(caT)}</div></div>
    <div class="kc"><div class="kc-l">Êxito estimado total</div><div class="kc-v g">${fmtK(xT)}</div></div>
    <div class="kc click" onclick="S.jFilter='inviavel';renderJudicial()"><div class="kc-l">Inviáveis</div><div class="kc-v ${invN>0?'r':'g'}">${invN}</div></div>`;

  const top = all.slice().sort((a,b)=>b._ca-a._ca).slice(0,20);
  mkChart('c-j-top',{type:'bar',data:{labels:top.map(j=>(j.cli+' · '+j.lbl).slice(0,24)),datasets:[
    {label:'Custo acum.',data:top.map(j=>j._ca),backgroundColor:'#C0392B'},
    {label:'Entrada',data:top.map(j=>j.e||0),backgroundColor:'#0F6E56'}
  ]},options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{x:{ticks:{callback:v=>'R$'+(v/1000)+'k'}}},onClick:(e,el)=>{if(el.length)openServico(top[el[0].index].cod);}}});

  const stColor = {ok:'rgba(15,110,86,.6)',ganhar:'rgba(196,122,0,.65)',inviavel:'rgba(192,57,43,.65)'};
  mkChart('c-j-scat',{type:'scatter',data:{datasets:[{data:all.map(j=>({x:j.e||0,y:j._ca,lbl:j.lbl,cli:j.cli})),
    backgroundColor:all.map(j=>stColor[j._status]),pointRadius:5,pointHoverRadius:7}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.cli} · ${c.raw.lbl}`}}},
    scales:{x:{title:{display:true,text:'Entrada'},ticks:{callback:v=>'R$'+(v/1000)+'k'}},y:{title:{display:true,text:'Custo acum.'},ticks:{callback:v=>'R$'+(v/1000)+'k'}}},
    onClick:(e,el)=>{if(el.length)openServico(all[el[0].index].cod);}}});

  rows = rows.slice().sort((a,b)=>{const va=a['_'+S.jSortK]??a[S.jSortK]??0,vb=b['_'+S.jSortK]??b[S.jSortK]??0;return S.jSortAsc?va-vb:vb-va;});
  document.getElementById('j-body').innerHTML = rows.map(j=>{
    const [lbl,cls]=J_STATUS[j._status];
    return `<tr onclick="openServico('${j.cod}')">
      <td class="lk">${esc(j.lbl)}</td><td><span class="lk" onclick="event.stopPropagation();openCliente('${esc(j.cli)}')">${esc(j.cli)}</span></td><td class="tm">${j.resp||''}</td>
      <td class="tr">${fmtK(j.e)}</td><td class="tr">${fmtK(j._ca)}</td>
      <td class="tr" style="color:${j._mse<0?'var(--red)':'var(--g2)'}">${fmtK(j._mse)}</td>
      <td class="tr">${j._be>0?fmtK(j._be):'—'}</td><td class="tr">${fmtK(j.x)}</td>
      <td class="tr" style="font-weight:600;color:${j._mt<0?'var(--red)':'var(--g2)'}">${fmtK(j._mt)}</td>
      <td><span class="badge ${cls}">${lbl}</span></td>
    </tr>`;
  }).join('');
}

/* ───────── PORTFOLIO ───────── */
function renderPortfolio(){
  const men = carteiraRows(mensalCalc());
  const recT = men.reduce((s,m)=>s+m._rec,0);
  const sorted = men.filter(m=>m._rec>0).sort((a,b)=>b._rec-a._rec);
  const top1 = sorted[0], top3 = sorted.slice(0,3).reduce((s,m)=>s+m._rec,0);
  const neg = men.filter(m=>m._rec>0&&m._margem<0).sort((a,b)=>a._margem-b._margem);
  const idle = men.filter(m=>m._rec>0&&m._h<1);
  const norec = men.filter(m=>m._rec===0&&m._h>2).sort((a,b)=>b._custo-a._custo);

  document.getElementById('pf-kpis').innerHTML = `
    <div class="kc"><div class="kc-l">Maior cliente</div><div class="kc-v ${top1&&top1._rec/recT>.25?'r':''}">${top1?fmtP(top1._rec/recT*100):'—'}</div><div class="kc-s">${top1?esc(top1.cli):''}</div></div>
    <div class="kc"><div class="kc-l">Top 3 concentram</div><div class="kc-v ${top3/recT>.5?'a':''}">${fmtP(top3/recT*100)}</div><div class="kc-s">da receita de mensalistas</div></div>
    <div class="kc"><div class="kc-l">Margem negativa</div><div class="kc-v ${neg.length>0?'r':'g'}">${neg.length}</div><div class="kc-s">consumo: ${fmtK(neg.reduce((s,m)=>s+m._margem,0))}</div></div>
    <div class="kc"><div class="kc-l">Pagantes sem atividade</div><div class="kc-v">${idle.length}</div><div class="kc-s">receita sem custo no período</div></div>`;

  document.getElementById('pf-conc').innerHTML = sorted.slice(0,15).map(m=>{
    const pct = m._rec/recT*100;
    return `<div class="conc-row" onclick="openCliente('${esc(m.cli)}')"><div class="conc-nm">${esc(m.cli)}</div><div class="conc-bar"><div class="conc-fill" style="width:${pct}%;${pct>=25?'background:var(--red)':pct>=15?'background:var(--amb)':''}"></div></div><div class="conc-val">${fmtK(m._rec)} · ${pct.toFixed(1)}%</div></div>`;
  }).join('');

  document.getElementById('pf-neg').innerHTML = `<thead><tr><th>Cliente</th><th class="r">Receita</th><th class="r">Custo</th><th class="r">Margem</th><th class="r">H</th></tr></thead><tbody>`+
    neg.map(m=>`<tr onclick="openCliente('${esc(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td class="tr">${fmtK(m._rec)}</td><td class="tr">${fmtK(m._custo)}</td><td class="tr" style="color:var(--red);font-weight:600">${fmtK(m._margem)}</td><td class="tr">${fmtH(m._h)}</td></tr>`).join('')+'</tbody>';

  document.getElementById('pf-idle').innerHTML = `<thead><tr><th>Cliente</th><th class="r">Receita período</th><th class="r">Horas</th></tr></thead><tbody>`+
    (idle.length?idle.map(m=>`<tr onclick="openCliente('${esc(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td class="tr">${fmtK(m._rec)}</td><td class="tr">${fmtH(m._h)}</td></tr>`).join(''):'<tr><td colspan="3" class="tm">Nenhum.</td></tr>')+'</tbody>';

  document.getElementById('pf-norec').innerHTML = `<thead><tr><th>Cliente</th><th class="r">Horas</th><th class="r">Custo invisível</th></tr></thead><tbody>`+
    (norec.length?norec.map(m=>`<tr onclick="openCliente('${esc(m.cli)}')"><td class="lk">${esc(m.cli)}</td><td class="tr">${fmtH(m._h)}</td><td class="tr" style="color:var(--amb);font-weight:600">${fmtK(m._custo)}</td></tr>`).join(''):'<tr><td colspan="3" class="tm">Nenhum.</td></tr>')+'</tbody>';
}

/* ───────── OVERLAY: PESSOA ───────── */
function openPessoa(nome){
  const p = D.hm.find(x=>x.adv===nome);
  if(!p) return;
  const calc = hmCalc().find(x=>x.adv===nome);
  document.getElementById('ovp-title').textContent = nome;
  document.getElementById('ovp-sub').textContent = `${p.fn} · ${p.cargo} · Time ${p.time}${p.ativo?'':' · desligado'}`;
  const det = D.pessoas_det[nome];
  let html = `<div class="kg kg4">
    <div class="kc"><div class="kc-l">Horas no período</div><div class="kc-v">${fmtH(calc._tot)}</div></div>
    <div class="kc"><div class="kc-l">🔴 Vermelho</div><div class="kc-v">${fmtP(calc._pct.v)}</div><div class="kc-s">${fmtH(calc._h.v)}h ${p.dev.v==='low'?'⬇ abaixo do benchmark':p.dev.v==='high'?'⬆ acima':''}</div></div>
    <div class="kc"><div class="kc-l">🟡 Amarelo</div><div class="kc-v">${fmtP(calc._pct.a)}</div><div class="kc-s">${fmtH(calc._h.a)}h</div></div>
    <div class="kc"><div class="kc-l">⬜ Admin</div><div class="kc-v">${fmtP(calc._pct.adm)}</div><div class="kc-s">${fmtH(calc._h.adm)}h ${p.dev.adm==='high'?'⬆ acima do máximo':''}</div></div>
  </div>
  <div class="panel"><div class="ph2"><span class="t">Evolução mensal por sinaleira</span></div><div class="pb"><div class="cw"><canvas id="c-ovp"></canvas></div></div></div>`;

  if(det && det.casos && det.casos.length){
    const casos = det.casos.filter(c=>c.nm);
    html += `<div class="panel"><div class="ph2"><span class="t">Casos e processos trabalhados</span><span class="s">${casos.length} itens · clique para abrir</span></div><div class="pb ow"><table class="t">
      <thead><tr><th>Caso</th><th>Cliente</th><th>Tipo</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Total h</th></tr></thead><tbody>`+
      casos.sort((a,b)=>b.h-a.h).map(c=>`<tr ${c.cod!=='0'?`onclick="openServico('${c.cod}')"`:''}>
        <td class="${c.cod!=='0'?'lk':''}">${esc(c.nm)||'<i class="tm">interno/admin</i>'}</td>
        <td><span class="lk" onclick="event.stopPropagation();openCliente('${esc(c.cli)}')">${esc(c.cli)}</span></td>
        <td><span class="badge bc">${c.tp||''}</span>${c.ativo===false&&c.tp?' <span class="badge br">baixado</span>':''}</td>
        ${S.meses.map(m=>`<td class="tr tm">${fmtH(c.pm&&c.pm[m]?c.pm[m]:0)}</td>`).join('')}
        <td class="tr"><b>${fmtH(c.h)}</b></td></tr>`).join('')+'</tbody></table></div></div>';
  }
  document.getElementById('ovp-body').innerHTML = html;
  document.getElementById('ov-pessoa').classList.add('open');
  setTimeout(()=>{
    mkChart('c-ovp',{type:'bar',data:{labels:S.meses.map(mLbl),datasets:[
      {label:'Vermelho',data:S.meses.map(m=>p.pm[m]?p.pm[m].v:0),backgroundColor:'#C0392B'},
      {label:'Amarelo',data:S.meses.map(m=>p.pm[m]?p.pm[m].a:0),backgroundColor:'#C47A00'},
      {label:'Verde',data:S.meses.map(m=>p.pm[m]?p.pm[m].g:0),backgroundColor:'#2E7D32'},
      {label:'Admin',data:S.meses.map(m=>p.pm[m]?p.pm[m].adm:0),backgroundColor:'#546E7A'}
    ]},options:{maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true}},plugins:{legend:{position:'bottom'}}}});
  },50);
}

/* ───────── OVERLAY: CLIENTE ───────── */
function openCliente(nome){
  const cd = D.cli_det[nome];
  const men = mensalCalc().find(m=>m.cli===nome);
  document.getElementById('ovc-title').textContent = nome;
  document.getElementById('ovc-sub').textContent = men ? `Mensalista · resp. ${men.resp||'—'}` : 'Cliente';
  let html = '';
  if(men){
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">Receita no período</div><div class="kc-v">${fmtK(men._rec)}</div></div>
      <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(men._custo)}</div></div>
      <div class="kc"><div class="kc-l">Margem</div><div class="kc-v ${men._margem>=0?'g':'r'}">${fmtK(men._margem)}</div><div class="kc-s">${fmtP(men._mpct)}</div></div>
      <div class="kc"><div class="kc-l">Horas</div><div class="kc-v">${fmtH(men._h)}</div><div class="kc-s">${fmtH(men._hi)} em inclusos</div></div>
    </div>
    <div class="panel"><div class="ph2"><span class="t">Evolução mensal</span></div><div class="pb"><div class="cw"><canvas id="c-ovc"></canvas></div></div></div>`;
  } else if(cd){
    const custo = C(cd.c_tot);
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">Receita contratada</div><div class="kc-v">${fmtK(cd.rec_tot)}</div></div>
      <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(custo)}</div></div>
      <div class="kc"><div class="kc-l">Margem estimada</div><div class="kc-v ${cd.rec_tot-custo>=0?'g':'r'}">${fmtK(cd.rec_tot-custo)}</div></div>
      <div class="kc"><div class="kc-l">Horas totais</div><div class="kc-v">${fmtH(cd.h_tot)}</div></div>
    </div>`;
  }
  // serviços
  if(cd && cd.svcs && cd.svcs.length){
    const ativos = cd.svcs.filter(s=>s.ativo), baixados = cd.svcs.filter(s=>!s.ativo);
    html += `<div class="panel"><div class="ph2"><span class="t">Serviços ativos</span><span class="s">${ativos.length}</span></div><div class="pb ow"><table class="t">
      <thead><tr><th>Serviço</th><th>Tipo</th><th class="r">Horas</th><th class="r">Custo</th></tr></thead><tbody>`+
      (ativos.length?ativos.sort((a,b)=>b.h-a.h).map(s=>`<tr onclick="openServico('${s.cod}')"><td class="lk">${esc(s.nm)||'<i>cód. '+s.cod+'</i>'}${s.inc?' <span class="badge bg">incluso mensal</span>':''}</td><td><span class="badge bc">${s.tp||''}</span></td><td class="tr">${fmtH(s.h)}</td><td class="tr">${fmtK(C(s.c))}</td></tr>`).join(''):'<tr><td colspan="4" class="tm">Nenhum.</td></tr>')+'</tbody></table></div></div>';
    if(baixados.length){
      html += `<div class="panel"><div class="ph2"><span class="t">Histórico encerrado</span><span class="s">${baixados.length}</span></div><div class="pb ow"><table class="t"><tbody>`+
        baixados.slice(0,30).map(s=>`<tr onclick="openServico('${s.cod}')"><td class="lk tm">${esc(s.nm)||'cód. '+s.cod}</td><td><span class="badge bc">${s.tp||''}</span></td><td class="tr tm">${fmtH(s.h)}h</td></tr>`).join('')+'</tbody></table></div></div>';
    }
  }
  // inclusos detail for mensalista
  if(men && men.inc && men.inc.length){
    const withH = men.inc.filter(i=>i.h>0);
    if(withH.length) html += `<div class="panel"><div class="ph2"><span class="t">Serviços inclusos no mensal · com horas</span><span class="s">${withH.length} de ${men.inc.length}</span></div><div class="pb ow"><table class="t"><tbody>`+
      withH.sort((a,b)=>b.h-a.h).map(i=>`<tr onclick="openServico('${i.cod}')"><td class="lk">${esc(i.nm)||'cód. '+i.cod}</td><td><span class="badge bg">${i.tp}</span></td><td class="tr">${fmtH(i.h)}h</td><td class="tr">${fmtK(C(i.c))}</td></tr>`).join('')+'</tbody></table></div></div>';
  }
  document.getElementById('ovc-body').innerHTML = html || '<div class="note">Sem dados detalhados para este cliente no período.</div>';
  document.getElementById('ov-cliente').classList.add('open');
  if(men) setTimeout(()=>{
    mkChart('c-ovc',{data:{labels:S.meses.map(mLbl),datasets:[
      {type:'bar',label:'Receita',data:S.meses.map(m=>men.pm[m]?men.pm[m].r||0:0),backgroundColor:'#0F6E56'},
      {type:'bar',label:'Custo',data:S.meses.map(m=>men.pm[m]?C(men.pm[m].c||0):0),backgroundColor:'#C0392B'},
      {type:'line',label:'Horas',data:S.meses.map(m=>men.pm[m]?men.pm[m].h||0:0),borderColor:'#C47A00',yAxisID:'y2',tension:.3}
    ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{ticks:{callback:v=>'R$'+(v/1000)+'k'}},y2:{position:'right',grid:{display:false}}}}});
  },50);
}

/* ───────── OVERLAY: SERVIÇO ───────── */
function openServico(cod){
  const sd = D.servicos_det[cod];
  if(!sd){ return; }
  const jud = judCalc().find(j=>j.cod===String(cod));
  document.getElementById('ovs-title').textContent = sd.lbl || ('Serviço '+cod);
  document.getElementById('ovs-sub').innerHTML = `${sd.tipo||''} · <span class="lk" style="color:#fff;text-decoration:underline;cursor:pointer" onclick="closeOv('servico');openCliente('${esc(sd.cli)}')">${esc(sd.cli)}</span> · cód. ${cod}${sd.ativo?'':' · BAIXADO'}${sd.incluso?' · incluso no mensal':''}`;
  const h = sumPM(sd.pm,'h'), cRaw = sumPM(sd.pm,'c'), custo = C(cRaw);
  let html = '';
  if(jud){
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">Entrada</div><div class="kc-v">${fmtK(jud.e)}</div></div>
      <div class="kc"><div class="kc-l">Custo acumulado</div><div class="kc-v">${fmtK(jud._ca)}</div></div>
      <div class="kc"><div class="kc-l">Break-even de êxito</div><div class="kc-v ${jud._be>0?'a':'g'}">${jud._be>0?fmtK(jud._be):'coberto'}</div></div>
      <div class="kc"><div class="kc-l">Margem total estimada</div><div class="kc-v ${jud._mt>=0?'g':'r'}">${fmtK(jud._mt)}</div><div class="kc-s">êxito est. ${fmtK(jud.x)}</div></div>
    </div>`;
  } else {
    const margem = (sd.rec||0) - custo;
    html += `<div class="kg kg4">
      <div class="kc"><div class="kc-l">Receita</div><div class="kc-v">${fmtK(sd.rec)}</div></div>
      <div class="kc"><div class="kc-l">Custo (${S.rate})</div><div class="kc-v">${fmtK(custo)}</div></div>
      <div class="kc"><div class="kc-l">Margem</div><div class="kc-v ${margem>=0?'g':'r'}">${fmtK(margem)}</div></div>
      <div class="kc"><div class="kc-l">Horas no período</div><div class="kc-v">${fmtH(h)}</div></div>
    </div>`;
  }
  html += `<div class="panel"><div class="ph2"><span class="t">Evolução de horas e custo</span></div><div class="pb"><div class="cw"><canvas id="c-ovs"></canvas></div></div></div>`;
  if(sd.por_pessoa && sd.por_pessoa.length){
    html += `<div class="panel"><div class="ph2"><span class="t">Quem trabalhou</span></div><div class="pb ow"><table class="t">
      <thead><tr><th>Colaborador</th>${S.meses.map(m=>`<th class="r">${mLbl(m)}</th>`).join('')}<th class="r">Horas</th><th class="r">Custo</th></tr></thead><tbody>`+
      sd.por_pessoa.sort((a,b)=>b.h-a.h).map(p=>`<tr onclick="closeOv('servico');openPessoa('${esc(p.adv)}')"><td class="lk">${esc(p.adv)}</td>${S.meses.map(m=>`<td class="tr tm">${fmtH(p.pm&&p.pm[m]?p.pm[m]:0)}</td>`).join('')}<td class="tr"><b>${fmtH(p.h)}</b></td><td class="tr">${fmtK(C(p.c))}</td></tr>`).join('')+'</tbody></table></div></div>';
  }
  document.getElementById('ovs-body').innerHTML = html;
  document.getElementById('ov-servico').classList.add('open');
  setTimeout(()=>{
    mkChart('c-ovs',{data:{labels:S.meses.map(mLbl),datasets:[
      {type:'bar',label:'Custo',data:S.meses.map(m=>sd.pm[m]?C(sd.pm[m].c||0):0),backgroundColor:'#C0392B'},
      {type:'line',label:'Horas',data:S.meses.map(m=>sd.pm[m]?sd.pm[m].h||0:0),borderColor:'#0F6E56',yAxisID:'y2',tension:.3}
    ]},options:{maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{ticks:{callback:v=>'R$'+(v/1000)+'k'}},y2:{position:'right',grid:{display:false}}}}});
  },50);
}

/* ───────── SIDEBAR LISTS ───────── */
function buildSidebarLists(){
  document.getElementById('pl-items').innerHTML = D.hm.slice().sort((a,b)=>a.adv.localeCompare(b.adv)).map(p=>`<button class="sb-list-item" onclick="openPessoa('${esc(p.adv)}')">${esc(p.adv)}</button>`).join('');
  const clientes = Object.keys(D.cli_det).filter(name=>{
    if(S.carteira==='todos') return true;
    return S.carteira==='ativos' ? clientIsActive(name) : !clientIsActive(name);
  }).sort((a,b)=>a.localeCompare(b));
  document.getElementById('cl-items').innerHTML = clientes.map(c=>`<button class="sb-list-item" onclick="openCliente('${esc(c)}')">${esc(c)}</button>`).join('');
  const svcs = carteiraRows(Object.values(D.servicos_det)).filter(s=>s.lbl).sort((a,b)=>(a.lbl||'').localeCompare(b.lbl||''));
  document.getElementById('sl-items').innerHTML = svcs.map(s=>`<button class="sb-list-item" onclick="openServico('${s.cod}')">${esc(s.lbl)} · ${esc(s.cli)}</button>`).join('');
}

/* ───────── RENDER MASTER ───────── */
function render(){
  switch(S.screen){
    case 'painel': renderPainel(); break;
    case 'times': renderTimes(); break;
    case 'heatmap': renderHeatmap(); break;
    case 'pessoas': renderPessoas(); break;
    case 'mensalistas': renderMensalistas(); break;
    case 'projetos': renderProjetos(); break;
    case 'judicial': renderJudicial(); break;
    case 'portfolio': renderPortfolio(); break;
  }
}

/* ───────── INIT ───────── */
buildPeriodBar();
document.getElementById('sb-per').textContent = D.meta.periodo || '';
buildSidebarLists();
