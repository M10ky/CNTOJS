'use strict';

// ═══ DASHBOARD ═══
function renderDashboard() {
  const vIT=ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+p.stock*p.prix,0);
  const vFin=ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+p.stock*p.prix,0);
  const alIT=alertsIT().length, alFin=alertsFin().length;
  const showP=canSeePrix();
  const kpis=[];
  if (canSeeIT())  kpis.push(showP?{lbl:'Valeur Stock IT',val:fmt(vIT)+' MGA',s:`${ST.produits.filter(p=>p.dept==='IT').length} réf.`,c:'#4f46e5'}:{lbl:'Produits IT',val:ST.produits.filter(p=>p.dept==='IT').length,s:'références',c:'#4f46e5'});
  if (canSeeFin()) kpis.push(showP?{lbl:'Valeur Stock Finance',val:fmt(vFin)+' MGA',s:`${ST.produits.filter(p=>p.dept==='Finance').length} réf.`,c:'#10b981'}:{lbl:'Produits Finance',val:ST.produits.filter(p=>p.dept==='Finance').length,s:'références',c:'#10b981'});
  if (canManIT())  kpis.push({lbl:'Alertes IT',val:alIT,s:alIT>0?'⚠ à traiter':'✓ Niveaux OK',c:alIT>0?'#ef4444':'#22c55e'});
  if (canManFin()) kpis.push({lbl:'Alertes Finance',val:alFin,s:alFin>0?'⚠ à traiter':'✓ Niveaux OK',c:alFin>0?'#ef4444':'#22c55e'});
  if (canManIT())  kpis.push({lbl:'Demandes IT en attente',val:attenteIT(),s:'à traiter',c:'#f59e0b'});
  if (canManFin()) kpis.push({lbl:'Demandes Finance en attente',val:attenteFin(),s:'à traiter',c:'#f59e0b'});
  const allMvt=[...fMvtIT(),...fMvtFin()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10);
  const mvtRows=allMvt.map(m=>`<tr>
    <td>${fmtDTSplit(m.created_at||m.date)}</td>
    <td>${deptTag(m.dept)}</td>
    <td>${typeBadge(m.type)}</td>
    <td style="font-weight:500;font-size:12.5px">${m.produit_nom}</td>
    <td style="font-weight:700">${m.qty}</td>
    <td style="font-size:11px;color:var(--text2)">${m.emplacement||'—'}</td>
    <td style="font-size:11px;color:var(--text2)">${m.destination||'—'}</td>
    <td style="font-size:11px;color:var(--text3)">${m.user_name}</td>
  </tr>`).join('');
  const infoBanner=(!showP||!canSeeHist())?`<div class="info-banner"><i class="ti ti-info-circle"></i><div>Vous consultez en <strong>mode lecture</strong>. Pour demander du matériel, utilisez la section <strong>Demandes</strong>.</div></div>`:'';
  return `<p class="page-title">Tableau de Bord</p>
    <p class="page-sub">${new Date().toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
    ${infoBanner}
    <div class="kpi-grid">${kpis.map(k=>`<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-s">${k.s||''}</div></div>`).join('')}</div>
    ${canSeeHist()?`
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">Mouvements par jour (période)</div><div class="bar-chart-wrap"><canvas id="chart-mvt"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Répartition valeur stock (M MGA)</div><div class="bar-chart-wrap"><canvas id="chart-pie"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-activity" style="color:var(--teal)"></i>Activités récentes (10 derniers mouvements)</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${['Date & Heure','Dépt','Type','Produit','Qté','Emplacement','Destination','Agent'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${mvtRows||'<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">Aucun mouvement sur la période</td></tr>'}</tbody>
      </table></div></div>`:''}`;
}

// ── RAPPORTS ──
function renderRapports() {
  const vIT=ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+p.stock*p.prix,0);
  const vFin=ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+p.stock*p.prix,0);
  const demIT=ST.demandes.filter(d=>d.dept==='IT');
  const demFin=ST.demandes.filter(d=>d.dept==='Finance');
  const tIT=demIT.length?Math.round(demIT.filter(d=>d.statut==='Validé').length/demIT.length*100):0;
  const tFin=demFin.length?Math.round(demFin.filter(d=>d.statut==='Validé').length/demFin.length*100):0;
  const kpis=[
    {lbl:'Valeur Stock IT',val:fmt(vIT)+' MGA',c:'#4f46e5'},{lbl:'Valeur Stock Finance',val:fmt(vFin)+' MGA',c:'#10b981'},
    {lbl:'Taux validation IT',val:tIT+'%',c:'#f59e0b'},{lbl:'Taux validation Finance',val:tFin+'%',c:'#f59e0b'},
    {lbl:'Mouvements IT',val:fMvtIT().length,s:`${fMvtIT().reduce((s,m)=>s+m.qty,0)} unités`,c:'#4f46e5'},
    {lbl:'Mouvements Finance',val:fMvtFin().length,s:`${fMvtFin().reduce((s,m)=>s+m.qty,0)} unités`,c:'#10b981'},
    {lbl:'Produits critiques IT',val:alertsIT().length,c:'#ef4444'},{lbl:'Produits critiques Finance',val:alertsFin().length,c:'#ef4444'},
  ];
  return `<p class="page-title">Rapports & Statistiques</p>
    <p class="page-sub">Synthèse globale — période sélectionnée</p>
    <div class="kpi-grid">${kpis.map(k=>`<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div>${k.s?`<div class="kpi-s">${k.s}</div>`:''}</div>`).join('')}</div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">Stock IT par catégorie</div><div class="bar-chart-wrap"><canvas id="chart-cat-it"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Stock Finance par catégorie</div><div class="bar-chart-wrap"><canvas id="chart-cat-fin"></canvas></div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">Top emplacements — Valeur (M MGA)</div><div class="bar-chart-wrap"><canvas id="chart-empl"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Évolution mouvements — 30 jours</div><div class="bar-chart-wrap"><canvas id="chart-mvt-30"></canvas></div></div>
    </div>`;
}

// ── AMORTISSEMENT ──
function renderAmortissement() {
  const allProd=ST.produits.filter(p=>(canSeeIT()&&p.dept==='IT')||(canSeeFin()&&p.dept==='Finance'));
  const avecAmort=allProd.filter(p=>p.valeur_achat>0&&p.date_achat&&p.duree_amortissement);
  const sansAmort=allProd.filter(p=>!p.valeur_achat||!p.date_achat||!p.duree_amortissement);
  const totalAchat=avecAmort.reduce((s,p)=>s+(p.valeur_achat||0),0);
  const totalVNC  =avecAmort.reduce((s,p)=>s+(calcVNC(p)||0),0);
  const totalAmort=totalAchat-totalVNC;
  const nbExpires =avecAmort.filter(p=>calcVNC(p)===0).length;
  const kpis=[
    {lbl:'Valeur Achat Totale',val:fmt(totalAchat)+' MGA',s:`${avecAmort.length} actifs`,c:'#4f46e5'},
    {lbl:'VNC Actuelle Totale',val:fmt(totalVNC)+' MGA',s:'Valeur nette comptable',c:'#10b981'},
    {lbl:'Amortissement Cumulé',val:fmt(totalAmort)+' MGA',s:avecAmort.length?`${Math.round(totalAmort/totalAchat*100)}% de la valeur initiale`:'—',c:'#f59e0b'},
    {lbl:'Actifs Totalement Amortis',val:nbExpires,s:'VNC nulle',c:'#ef4444'},
  ];
  const rows=avecAmort.sort((a,b)=>(b.valeur_achat||0)-(a.valeur_achat||0)).map(p=>{
    const vnc=calcVNC(p);const pct=amortPct(p)||0;const c=amortColor(pct);
    const taux=tauxLineaire(p.duree_amortissement);const annuite=annuiteLineaire(p);
    return `<tr>
      <td>${deptTag(p.dept)}</td>
      <td><div style="font-weight:600">${p.nom}</div></td>
      <td><span class="tag" style="color:#475569;background:#f1f5f9">${p.categorie}</span></td>
      <td><span class="tag" style="color:#1e40af;background:#dbeafe">${p.emplacement||'—'}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(p.valeur_achat)} MGA</td>
      <td style="font-size:11px;color:var(--text3)">${fmtDate(p.date_achat)}</td>
      <td style="font-size:11px;color:var(--text3)">${(p.duree_amortissement/12).toFixed(1)}a · <strong>${taux}%/an</strong></td>
      <td style="font-size:11px;color:var(--text3)">${annuite?fmt(annuite)+' MGA/an':'—'}</td>
      <td>
        <div style="font-weight:700;color:${c}">${vnc===0?'<span class="tag" style="color:#dc2626;background:#fef2f2">Totalement amorti</span>':fmt(vnc)+' MGA'}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
          <div class="amort-bar" style="width:90px"><div class="amort-fill" style="width:${pct}%;background:${c}"></div></div>
          <span style="font-size:10px;color:${c};font-weight:700">${pct}%</span>
        </div>
      </td>
      <td>${btn('✏','#64748b',true,`openEditProduct('${p.id}')`)}</td>
    </tr>`;
  }).join('');
  const noAmortRows=sansAmort.slice(0,5).map(p=>`<tr><td>${deptTag(p.dept)}</td><td style="font-weight:500">${p.nom}</td><td><span class="tag" style="color:#475569;background:#f1f5f9">${p.categorie}</span></td><td>${btn('Configurer','#4f46e5',true,`openEditProduct('${p.id}')`)}</td></tr>`).join('');
  return `<p class="page-title">Amortissement Linéaire des Actifs</p>
    <p class="page-sub">Valeur nette comptable (VNC) — Méthode linéaire</p>
    <div class="info-banner" style="background:#fffbeb;border-color:#fcd34d;color:#92400e">
      <i class="ti ti-info-circle" style="color:#f59e0b"></i>
      <div><strong>Méthode linéaire :</strong> L'actif perd une valeur égale chaque année. Taux annuel = 100% / Durée en années.</div>
    </div>
    <div class="kpi-grid">${kpis.map(k=>`<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-s">${k.s}</div></div>`).join('')}</div>
        <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV Amortissement', '#10b981', true, 'exportAmortissementCSV()', 'ti-download')}
    </div>
    ${avecAmort.length?`
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">VNC vs Valeur initiale — Top 8 actifs</div><div class="bar-chart-wrap"><canvas id="chart-amort"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Répartition par statut d'amortissement</div><div class="bar-chart-wrap"><canvas id="chart-amort-pie"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-chart-line" style="color:var(--teal)"></i>Tableau de bord des amortissements</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${['Dépt','Actif','Catégorie','Emplacement','Valeur Achat','Date Achat','Durée · Taux','Dotation/an','VNC · Avanc.','Action'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`:''}
    ${sansAmort.length?`
    <div class="card" style="border-left:3px solid #f59e0b">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-alert-triangle" style="color:#f59e0b"></i>${sansAmort.length} actif(s) sans données d'amortissement</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Dépt</th><th>Produit</th><th>Catégorie</th><th>Action</th></tr></thead>
        <tbody>${noAmortRows}${sansAmort.length>5?`<tr><td colspan="4" style="text-align:center;color:var(--text3);font-size:11px">… et ${sansAmort.length-5} autres</td></tr>`:''}</tbody>
      </table></div>
    </div>`:''}`;
}

// ═══ GRAPHIQUES ═══
function drawCharts() {
  Object.values(Chart.instances||{}).forEach(c=>c.destroy());
  const gc='#e2e8f0', tc='#94a3b8';
  const baseOpts={ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} };
  if (document.getElementById('chart-mvt')) {
    const mvtAll=[...fMvtIT(),...fMvtFin()];
    const dates=[...new Set(mvtAll.map(m=>(m.created_at||m.date).slice(0,10)))].sort().slice(-8);
    new Chart(document.getElementById('chart-mvt'),{type:'bar',data:{labels:dates.map(d=>new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})),datasets:[{label:'Entrées',data:dates.map(d=>mvtAll.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Entrée').reduce((s,m)=>s+m.qty,0)),backgroundColor:'#10b981',borderRadius:4},{label:'Sorties',data:dates.map(d=>mvtAll.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Sortie').reduce((s,m)=>s+m.qty,0)),backgroundColor:'#ef4444',borderRadius:4}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-pie')) {
    const vIT=ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+p.stock*p.prix,0);
    const vFin=ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+p.stock*p.prix,0);
    const data=[],labels=[],colors=[];
    if (canSeeIT())  { data.push(Math.round(vIT/1e6));  labels.push('IT');      colors.push('#4f46e5'); }
    if (canSeeFin()) { data.push(Math.round(vFin/1e6)); labels.push('Finance'); colors.push('#10b981'); }
    new Chart(document.getElementById('chart-pie'),{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:9}},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.raw}M MGA`}}}}});
  }
  if (document.getElementById('chart-cat-it')) {
    const cats={};ST.produits.filter(p=>p.dept==='IT').forEach(p=>{cats[p.categorie]=(cats[p.categorie]||0)+p.stock;});
    const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,8);
    new Chart(document.getElementById('chart-cat-it'),{type:'bar',data:{labels:sorted.map(([k])=>k),datasets:[{data:sorted.map(([,v])=>v),backgroundColor:'#4f46e5',borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-cat-fin')) {
    const cats={};ST.produits.filter(p=>p.dept==='Finance').forEach(p=>{cats[p.categorie]=(cats[p.categorie]||0)+p.stock;});
    const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,8);
    new Chart(document.getElementById('chart-cat-fin'),{type:'bar',data:{labels:sorted.map(([k])=>k),datasets:[{data:sorted.map(([,v])=>v),backgroundColor:'#10b981',borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-empl')) {
    const byEmpl={};ST.produits.forEach(p=>{const e=p.emplacement||'Non défini';byEmpl[e]=(byEmpl[e]||0)+p.stock*p.prix;});
    const sorted=Object.entries(byEmpl).sort((a,b)=>b[1]-a[1]).slice(0,5);
    new Chart(document.getElementById('chart-empl'),{type:'bar',data:{labels:sorted.map(([k])=>k),datasets:[{data:sorted.map(([,v])=>Math.round(v/1e6*100)/100),backgroundColor:'#6366f1',borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9},callback:v=>v+'M'},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-mvt-30')) {
    const today=new Date();const days=[];
    for(let i=29;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);days.push(d.toISOString().split('T')[0]);}
    const all=[...ST.mouvements];
    new Chart(document.getElementById('chart-mvt-30'),{type:'line',data:{labels:days.map(d=>{const x=new Date(d);return `${x.getDate()}/${x.getMonth()+1}`;}),datasets:[{label:'Entrées',data:days.map(d=>all.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Entrée').reduce((s,m)=>s+m.qty,0)),borderColor:'#10b981',tension:.35,fill:false,pointRadius:2},{label:'Sorties',data:days.map(d=>all.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Sortie').reduce((s,m)=>s+m.qty,0)),borderColor:'#ef4444',tension:.35,fill:false,pointRadius:2}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:8},maxTicksLimit:10},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-amort')) {
    const prods=ST.produits.filter(p=>p.valeur_achat>0&&p.date_achat).sort((a,b)=>(b.valeur_achat||0)-(a.valeur_achat||0)).slice(0,8);
    new Chart(document.getElementById('chart-amort'),{type:'bar',data:{labels:prods.map(p=>p.nom.slice(0,14)),datasets:[{label:'Valeur achat',data:prods.map(p=>Math.round((p.valeur_achat||0)/1e6*100)/100),backgroundColor:'#e0e7ff',borderRadius:3},{label:'VNC',data:prods.map(p=>Math.round((calcVNC(p)||0)/1e6*100)/100),backgroundColor:'#4f46e5',borderRadius:3}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:8}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9},callback:v=>v+'M'},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-amort-pie')) {
    const w=ST.produits.filter(p=>p.valeur_achat>0&&p.date_achat);
    const fully=w.filter(p=>calcVNC(p)===0).length;
    const partial=w.filter(p=>{const pct=amortPct(p);return pct!==null&&pct>50&&pct<100;}).length;
    const low=w.filter(p=>{const pct=amortPct(p);return pct!==null&&pct<=50;}).length;
    new Chart(document.getElementById('chart-amort-pie'),{type:'doughnut',data:{labels:['Faible <50%','Partiel 50–99%','Totalement amorti'],datasets:[{data:[low,partial,fully],backgroundColor:['#10b981','#f59e0b','#ef4444'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:9}}}}});
  }
}