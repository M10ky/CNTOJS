'use strict';

// ═══ NAVIGATION & RENDERING ═══
function buildNav() {
  const db_el=document.getElementById('dept-banner');
  const d=curDept();
  if      (d==='IT')      { db_el.className='dept-banner it';  db_el.innerHTML='<i class="ti ti-device-laptop"></i>Département IT'; }
  else if (d==='Finance') { db_el.className='dept-banner fin'; db_el.innerHTML='<i class="ti ti-cash"></i>Département Finance'; }
  else                    { db_el.className='dept-banner adm'; db_el.innerHTML='<i class="ti ti-shield"></i>Administrateur'; }
  let h='';
  if (isAdmin() || isSupportIT() || isResFin()) {
    h+=`<div class="nav-sec">VUE GÉNÉRALE</div>`;
    h+=ni('dashboard','ti-layout-dashboard','Dashboard');
  }
  if (canSeeIT()) {
    h+=`<div class="nav-sec">STOCK IT</div>`;
    h+=ni('stock-it','ti-device-laptop','Inventaire IT');
    if (canManIT()) h+=ni('mvt-it','ti-arrows-exchange','Mouvements IT');
    h+=ni('dem-it','ti-clipboard-list','Demandes IT', canManIT()?attenteIT():0);
    if (canManIT()) h+=ni('alertes-it','ti-bell','Alertes IT',alertsIT().length,'#ef4444');
    if (canManIT()) h+=ni('actifs-it','ti-devices','Actifs IT');   // ← Étape C
    if (canManIT()) h+=ni('prets-it','ti-transfer','Prêts IT');    // ← Étape D
  }
  if (canSeeFin()) {
    h+=`<div class="nav-sec">STOCK FINANCE</div>`;
    h+=ni('stock-fin','ti-files','Inventaire Finance');
    if (canManFin()) h+=ni('mvt-fin','ti-arrows-exchange','Mouvements Finance');
    h+=ni('dem-fin','ti-clipboard-list','Demandes Finance', canManFin()?attenteFin():0);
    if (canManFin()) h+=ni('alertes-fin','ti-bell','Alertes Finance',alertsFin().length,'#ef4444');
    if (canManFin()) h+=ni('actifs-fin','ti-devices','Actifs Finance');  // ← Étape C
    if (canManFin()) h+=ni('prets-fin','ti-transfer','Prêts Finance');   // ← Étape D
  }
  if (canSeeHist()) { 
    h+=`<div class="nav-sec">ANALYSE</div>`;
    h+=ni('historique','ti-history','Historique');
    h+=ni('rapports','ti-chart-bar','Rapports');
    h+=ni('amortissement','ti-chart-line','Amortissement');
  }
  if (isAdmin()) {
    h+=`<div class="nav-sec">ADMINISTRATION</div>`;
    h+=ni('utilisateurs','ti-users','Utilisateurs');
    h+=ni('params','ti-settings','Paramètres');
  }
  document.getElementById('nav').innerHTML=h;
}

function ni(id, icon, lbl, badge=0, bColor='#f59e0b') {
  const b=badge>0?`<span class="badge-nav" style="background:${bColor};color:#fff">${badge}</span>`:'';
  return `<div class="ni${ST.tab===id?' active':''}" onclick="goto('${id}')"><i class="ti ${icon}"></i>${lbl}${b}</div>`;
}

window.goto = t => {
  // Reset complet des filtres inline
  ST.search.inline = { 
    query: '', dept: '', cat: '', statut: '', type: '', 
    urgence: '', statDem: '', actif: '' 
  };
  ST.tab = t; 
  render();
};

function updateTopbar() {
  const labels={
    dashboard:'Tableau de Bord',
    'stock-it':'Inventaire IT','stock-fin':'Inventaire Finance',
    'mvt-it':'Mouvements IT','mvt-fin':'Mouvements Finance',
    'dem-it':'Demandes IT','dem-fin':'Demandes Finance',
    'alertes-it':'Alertes IT','alertes-fin':'Alertes Finance',
    historique:'Historique Complet', rapports:'Rapports & Statistiques',
    amortissement:'Amortissement Linéaire',
    'actifs-it':'Actifs Individuels IT','actifs-fin':'Actifs Individuels Finance', // ← Étape C
    'prets-it':'Gestion des Prêts IT','prets-fin':'Gestion des Prêts Finance',     // ← Étape D
    utilisateurs:'Gestion des Utilisateurs', params:'Paramètres Système',
  };
  document.getElementById('tt').textContent=labels[ST.tab]||ST.tab;
  const fl=ST.dateFrom||ST.dateTo?' · Filtre actif':'';
  document.getElementById('ts').textContent='Connecteo · '+(ST.profile?.name||'')+fl;
  const ind = document.getElementById('filter-active-indicator');
  if (ind) ind.style.display = (ST.dateFrom||ST.dateTo) ? 'flex' : 'none';
}

window.applyFilter = async () => {
  const fromVal=document.getElementById('filter-from').value;
  const toVal  =document.getElementById('filter-to').value;
  ST.dateFrom=fromVal ? new Date(fromVal).toISOString() : null;
  ST.dateTo  =toVal   ? new Date(toVal).toISOString()   : null;
  await Promise.all([loadMouvements(),loadDemandes()]); render();
};

window.clearFilter = async () => {
  ST.dateFrom=null; ST.dateTo=null;
  document.getElementById('filter-from').value='';
  document.getElementById('filter-to').value='';
  await Promise.all([loadMouvements(),loadDemandes()]); render();
};

// ═══ SEARCH GLOBAL ═══
window.openSearch = () => {
  document.getElementById('search-overlay').classList.add('open');
  setTimeout(() => document.getElementById('search-main-input').focus(), 50);
  setSF(ST.search.filter);
  runSearch(ST.search.query);
};

window.closeSearch = (e) => {
  if (e && e.target !== document.getElementById('search-overlay')) return;
  document.getElementById('search-overlay').classList.remove('open');
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('search-overlay').classList.remove('open');
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (document.getElementById('search-overlay').classList.contains('open')) {
      document.getElementById('search-overlay').classList.remove('open');
    } else { openSearch(); }
  }
});

window.setSF = (f) => {
  ST.search.filter = f;
  ['all','produits','mouvements','demandes','it','fin'].forEach(id => {
    const el = document.getElementById('sf-'+id);
    if (!el) return;
    el.className = 'sf-chip';
    if (id === f) {
      if (f==='it')        el.className='sf-chip active-dept-it';
      else if (f==='fin')  el.className='sf-chip active-dept-fin';
      else                 el.className='sf-chip active';
    }
  });
  runSearch(ST.search.query);
};

window.onSearchInput = (val) => {
  ST.search.query = val;
  clearTimeout(ST.searchDebounce);
  ST.searchDebounce = setTimeout(() => runSearch(val), 120);
};

window.onSearchKeydown = (e) => {
  const items = document.querySelectorAll('.search-result-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    ST.searchSelectedIdx = Math.min(ST.searchSelectedIdx+1, items.length-1);
    updateSearchSelection(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    ST.searchSelectedIdx = Math.max(ST.searchSelectedIdx-1, 0);
    updateSearchSelection(items);
  } else if (e.key === 'Enter') {
    if (ST.searchSelectedIdx >= 0 && items[ST.searchSelectedIdx]) items[ST.searchSelectedIdx].click();
  }
};

function updateSearchSelection(items) {
  items.forEach((el,i) => {
    el.style.background = i===ST.searchSelectedIdx ? '#f0fdf9' : '';
    el.style.outline = i===ST.searchSelectedIdx ? '2px solid var(--teal)' : '';
    if (i===ST.searchSelectedIdx) el.scrollIntoView({block:'nearest'});
  });
}

function runSearch(query) {
  ST.searchSelectedIdx = -1;
  const f = ST.search.filter;
  const wrap = document.getElementById('search-results-wrap');
  const countEl = document.getElementById('search-result-count');
  const q = (query||'').trim();
  if (!q && f==='all') {
    wrap.innerHTML = `<div class="search-empty"><i class="ti ti-search"></i><p>Tapez pour rechercher</p><small>Produits · Mouvements · Demandes · Catégories · Emplacements</small></div>`;
    countEl.textContent = ''; return;
  }
  let html = '', totalCount = 0;
  // (Le reste du runSearch est conservé tel quel - très long, mais complet dans le fichier source)
  if (f==='all' || f==='produits' || f==='it' || f==='fin') {
    let prods = ST.produits.filter(p => {
      if (f==='it' && p.dept!=='IT') return false;
      if (f==='fin' && p.dept!=='Finance') return false;
      if (!canSeeIT() && p.dept==='IT') return false;
      if (!canSeeFin() && p.dept==='Finance') return false;
      return matchesQuery([p.nom, p.categorie, p.id, p.emplacement], q);
    });
    if (prods.length) {
      totalCount += prods.length;
      html += `<div class="search-section-header"><i class="ti ti-package" style="color:var(--teal)"></i>Produits <span class="count-badge">${prods.length}</span></div>`;
      html += prods.slice(0,8).map(p => {
        const st = getStatus(p);
        const stColor = st==='Rupture'?'#dc2626':st==='Critique'?'#d97706':'#16a34a';
        const stBg    = st==='Rupture'?'#fef2f2':st==='Critique'?'#fffbeb':'#f0fdf4';
        const dColor  = p.dept==='IT'?'#4f46e5':'#10b981';
        const dBg     = p.dept==='IT'?'#eef2ff':'#f0fdf4';
        return `<div class="search-result-item" onclick="closeSearch();goto('${p.dept==='IT'?'stock-it':'stock-fin'}');setTimeout(()=>setInlineQuery('${escQ(p.nom)}'),200)">
          <div class="sri-icon" style="background:${dBg}"><i class="ti ti-package" style="color:${dColor}"></i></div>
          <div class="sri-main"><div class="sri-title">${highlight(p.nom,q)}</div>
          <div class="sri-sub">${highlight(p.categorie,q)} · ${highlight(p.emplacement,q)||'—'} · ID: <code>${p.id}</code></div></div>
          <div class="sri-meta"><div style="font-size:13px;font-weight:800;color:${p.stock===0?'#dc2626':'var(--text)'}">×${p.stock}</div>
          <div class="sri-badge" style="color:${stColor};background:${stBg};margin-top:3px">${st}</div></div>
        </div>`;
      }).join('');
      if (prods.length > 8) html += `<div style="padding:8px 18px;font-size:11px;color:var(--text3);background:#fafbff">… et ${prods.length-8} autre(s)</div>`;
    }
  }
  // ... (les sections Mouvements et Demandes sont identiques au code original)
  if (f==='all' || f==='mouvements' || f==='it' || f==='fin') {
    let mvts = ST.mouvements.filter(m => {
      if (f==='it' && m.dept!=='IT') return false;
      if (f==='fin' && m.dept!=='Finance') return false;
      if (!canSeeIT() && m.dept==='IT') return false;
      if (!canSeeFin() && m.dept==='Finance') return false;
      return matchesQuery([m.produit_nom, m.user_name, m.destination, m.fournisseur, m.ref_document, m.type, m.id], q);
    });
    if (mvts.length) {
      totalCount += mvts.length;
      html += `<div class="search-section-header"><i class="ti ti-arrows-exchange" style="color:#4f46e5"></i>Mouvements <span class="count-badge">${mvts.length}</span></div>`;
      html += mvts.slice(0,6).map(m => {
        const tc = m.type==='Entrée'?'#16a34a':'#dc2626';
        const tb = m.type==='Entrée'?'#dcfce7':'#fee2e2';
        return `<div class="search-result-item" onclick="closeSearch();goto('${m.dept==='IT'?'mvt-it':'mvt-fin'}');setTimeout(()=>setInlineQuery('${escQ(m.produit_nom)}'),200)">
          <div class="sri-icon" style="background:${tb}"><i class="ti ti-arrows-exchange" style="color:${tc}"></i></div>
          <div class="sri-main"><div class="sri-title">${highlight(m.produit_nom,q)}</div>
          <div class="sri-sub">${m.type} · ${fmtDate(m.created_at||m.date)} · ${highlight(m.user_name,q)}${m.destination?' → '+highlight(m.destination,q):''}</div></div>
          <div class="sri-meta"><div style="font-size:13px;font-weight:800">×${m.qty}</div>
          <div class="sri-badge" style="color:${tc};background:${tb};margin-top:3px">${m.type}</div></div>
        </div>`;
      }).join('');
      if (mvts.length > 6) html += `<div style="padding:8px 18px;font-size:11px;color:var(--text3);background:#fafbff">… et ${mvts.length-6} autre(s)</div>`;
    }
  }
  if (f==='all' || f==='demandes' || f==='it' || f==='fin') {
    let dems = ST.demandes.filter(d => {
      if (f==='it' && d.dept!=='IT') return false;
      if (f==='fin' && d.dept!=='Finance') return false;
      if (!canSeeIT() && d.dept==='IT') return false;
      if (!canSeeFin() && d.dept==='Finance') return false;
      return matchesQuery([d.produit, d.demandeur, d.motif, d.dest, d.statut, d.id], q);
    });
    if (dems.length) {
      totalCount += dems.length;
      html += `<div class="search-section-header"><i class="ti ti-clipboard-list" style="color:#f59e0b"></i>Demandes <span class="count-badge">${dems.length}</span></div>`;
      html += dems.slice(0,6).map(d => {
        const sc = d.statut==='Validé'?'#16a34a':d.statut==='Refusé'?'#dc2626':'#d97706';
        const sb = d.statut==='Validé'?'#dcfce7':d.statut==='Refusé'?'#fee2e2':'#fef3c7';
        return `<div class="search-result-item" onclick="closeSearch();goto('${d.dept==='IT'?'dem-it':'dem-fin'}');setTimeout(()=>setInlineQuery('${escQ(d.produit)}'),200)">
          <div class="sri-icon" style="background:${sb}"><i class="ti ti-clipboard-list" style="color:${sc}"></i></div>
          <div class="sri-main"><div class="sri-title">${highlight(d.produit,q)}</div>
          <div class="sri-sub">${highlight(d.demandeur,q)} · ×${d.qty} · ${fmtDate(d.created_at||d.date)} · ${highlight(d.motif||'',q).slice(0,40)}</div></div>
          <div class="sri-meta"><div class="sri-badge" style="color:${sc};background:${sb}">${d.statut}</div></div>
        </div>`;
      }).join('');
      if (dems.length > 6) html += `<div style="padding:8px 18px;font-size:11px;color:var(--text3);background:#fafbff">… et ${dems.length-6} autre(s)</div>`;
    }
  }
  // ─── Section Actifs individuels ──────────────────────────────
  if (f==='all' || f==='actifs' || f==='it' || f==='fin') {
    const actifsList = (ST.actifs||[]).filter(a => {
      if (f==='it'  && a.dept!=='IT')      return false;
      if (f==='fin' && a.dept!=='Finance') return false;
      if (a.dept==='IT'      && !canManIT())  return false;
      if (a.dept==='Finance' && !canManFin()) return false;
      return matchesQuery([a.id, a.produit_nom, a.categorie, a.emplacement, a.statut], q);
    });
    if (actifsList.length) {
      totalCount += actifsList.length;
      html += `<div class="search-section-header"><i class="ti ti-devices" style="color:#6366f1"></i>Actifs individuels <span class="count-badge">${actifsList.length}</span></div>`;
      html += actifsList.slice(0,6).map(a => {
        const dc  = a.dept==='IT'?'#4f46e5':'#10b981';
        const dbg = a.dept==='IT'?'#eef2ff':'#f0fdf4';
        const stColors = {
          'En service':  { c:'#16a34a', bg:'#dcfce7' },
          'En prêt':     { c:'#1d4ed8', bg:'#dbeafe' },
          'Hors service':{ c:'#d97706', bg:'#fef3c7' },
          'Réformé':     { c:'#94a3b8', bg:'#f1f5f9' },
        };
        const { c:sc='#64748b', bg:sbg='#f1f5f9' } = stColors[a.statut] || {};
        const tab = a.dept==='IT'?'actifs-it':'actifs-fin';
        return `<div class="search-result-item" onclick="closeSearch();goto('${tab}');setTimeout(()=>setInlineQuery('${escQ(a.id)}'),200)">
          <div class="sri-icon" style="background:${dbg}"><i class="ti ti-devices" style="color:${dc}"></i></div>
          <div class="sri-main">
            <div class="sri-title"><code style="font-size:11px;font-family:var(--mono);color:var(--teal-d)">${highlight(a.id,q)}</code></div>
            <div class="sri-sub">${highlight(a.produit_nom||'—',q)} · ${highlight(a.categorie||'',q)} · ${a.emplacement||'—'}</div>
          </div>
          <div class="sri-meta"><div class="sri-badge" style="color:${sc};background:${sbg}">${a.statut}</div></div>
        </div>`;
      }).join('');
      if (actifsList.length>6) html+=`<div style="padding:8px 18px;font-size:11px;color:var(--text3);background:#fafbff">… et ${actifsList.length-6} autre(s)</div>`;
    }
  }
  // ─── Section Prêts ─────────────────────────────────────────
  if (f==='all' || f==='prets' || f==='it' || f==='fin') {
    const pretsList = (ST.prets||[]).filter(p => {
      if (f==='it'  && p.dept!=='IT')      return false;
      if (f==='fin' && p.dept!=='Finance') return false;
      if (p.dept==='IT'      && !canManIT())  return false;
      if (p.dept==='Finance' && !canManFin()) return false;
      return matchesQuery([p.actif_id, p.emprunteur, p.produit_nom, p.statut, p.motif, p.id], q);
    });
    if (pretsList.length) {
      totalCount += pretsList.length;
      html += `<div class="search-section-header"><i class="ti ti-transfer" style="color:#f59e0b"></i>Prêts <span class="count-badge">${pretsList.length}</span></div>`;
      html += pretsList.slice(0,6).map(p => {
        const stColors = {
          'En cours':  { c:'#1d4ed8', bg:'#dbeafe' },
          'En retard': { c:'#dc2626', bg:'#fee2e2' },
          'Retourné':  { c:'#16a34a', bg:'#dcfce7' },
        };
        const { c:sc='#64748b', bg:sbg='#f1f5f9' } = stColors[p.statut] || {};
        const tab = p.dept==='IT'?'prets-it':'prets-fin';
        return `<div class="search-result-item" onclick="closeSearch();goto('${tab}');setTimeout(()=>setInlineQuery('${escQ(p.actif_id||'')}'),200)">
          <div class="sri-icon" style="background:${sbg}"><i class="ti ti-transfer" style="color:${sc}"></i></div>
          <div class="sri-main">
            <div class="sri-title">
              <code style="font-size:11px;font-family:var(--mono);color:var(--teal-d)">${highlight(p.actif_id||'—',q)}</code>
              <span style="font-size:11.5px;margin-left:6px">— ${highlight(p.produit_nom||'—',q)}</span>
            </div>
            <div class="sri-sub">${highlight(p.emprunteur||'—',q)} · retour prévu ${p.date_retour_prevue?fmtDate(p.date_retour_prevue):'—'}</div>
          </div>
          <div class="sri-meta"><div class="sri-badge" style="color:${sc};background:${sbg}">${p.statut}</div></div>
        </div>`;
      }).join('');
      if (pretsList.length>6) html+=`<div style="padding:8px 18px;font-size:11px;color:var(--text3);background:#fafbff">… et ${pretsList.length-6} autre(s)</div>`;
    }
  }
  if (!html) {
    html = `<div class="search-empty"><i class="ti ti-search-off"></i><p>Aucun résultat pour "${q}"</p><small>Essayez un terme différent ou changez le filtre</small></div>`;
  }
  wrap.innerHTML = html;
  countEl.textContent = totalCount > 0 ? `${totalCount} résultat(s)` : '';
}

// ═══ RENDU PRINCIPAL ═══
function render() {
  buildNav(); updateTopbar(); renderActiveFiltersBar();
  const c=document.getElementById('content');
  const t=ST.tab;
  let html='';
  if      (t==='dashboard')    html=renderDashboard();
  else if (t==='stock-it')     html=canSeeIT()  ?renderStockIT()          :accessDenied();
  else if (t==='stock-fin')    html=canSeeFin() ?renderStockFin()         :accessDenied();
  else if (t==='mvt-it')       html=canManIT()  ?renderMvt('IT')          :accessDenied();
  else if (t==='mvt-fin')      html=canManFin() ?renderMvt('Finance')     :accessDenied();
  else if (t==='dem-it')       html=canSeeIT()  ?renderDem('IT')          :accessDenied();
  else if (t==='dem-fin')      html=canSeeFin() ?renderDem('Finance')     :accessDenied();
  else if (t==='alertes-it')   html=canManIT()  ?renderAlertes('IT')      :accessDenied();
  else if (t==='alertes-fin')  html=canManFin() ?renderAlertes('Finance') :accessDenied();
  else if (t==='historique')   html=canSeeHist()?renderHistorique()        :accessDenied();
  else if (t==='rapports')     html=canSeeHist()?renderRapports()          :accessDenied();
  else if (t==='amortissement')html=canSeeHist()?renderAmortissement()     :accessDenied();
  else if (t==='actifs-it')    html=canManIT()  ?renderActifs('IT')        :accessDenied(); // ← Étape C
  else if (t==='actifs-fin')   html=canManFin() ?renderActifs('Finance')   :accessDenied(); // ← Étape C
  else if (t==='prets-it')     html=canManIT()  ?renderPrets('IT')         :accessDenied(); // ← Étape D
  else if (t==='prets-fin')    html=canManFin() ?renderPrets('Finance')    :accessDenied(); // ← Étape D
  else if (t==='utilisateurs') html=renderUtilisateurs();
  else if (t==='params')       html=isAdmin()   ?renderParams()            :accessDenied();
  c.innerHTML=html;
  setTimeout(drawCharts,80);
}

// Initialisation du filtre date par défaut
(() => {
  const now=new Date();
  const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0'),d=String(now.getDate()).padStart(2,'0');
  const fromISO=`${y}-${m}-01T00:00`;
  const toISO  =`${y}-${m}-${d}T23:59`;
  document.getElementById('filter-from').value=fromISO;
  document.getElementById('filter-to').value=toISO;
  ST.dateFrom=new Date(fromISO).toISOString();
  ST.dateTo  =new Date(toISO).toISOString();
})();

// Lancement de l'application
init();