// ═══ SUPABASE CONFIG ═══
const SUPABASE_URL      = 'https://jpwfifxdtezrxituzvpz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_B0jB6AR899HIRGLBbUS3LQ_XkJ8kx0k';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } }
});

// ═══ GLOBAL STATE ═══
const ST = {
  user: null,
  profile: null,
  allProfiles: [],
  tab: 'dashboard',
  modal: null,
  toastTimer: null,
  dateFrom: null,
  dateTo: null,
  produits: [],
  mouvements: [],
  demandes: [],
<<<<<<< HEAD
  actifs: [],
  prets:  [],          // ← Étape D
  params: { destinations: [], categoriesIT: [], categoriesFin: [], emplacements: [] },
=======
  actifs: [], 
  params: { destinations: [], categoriesIT: [], categoriesFin: [], emplacements: [], fournisseurs: [] },
  mouvementsEntrees: [],   // ← Étape D+ : toutes les entrées (sans filtre date) pour valeur cumulée
>>>>>>> 21d0be0 (D+)
  rtChannels: [],
  search: {
    query: '',
    filter: 'all',
    inline: {
      query: '',
      dept: '',
      cat: '',
      statut: '',
      type: '',
      urgence: '',
      statDem: '',
      actif: '',        // ← ÉTAPE B : '' = tous | 'true' = actifs seul. | 'false' = inactifs seul.
    }
  },
  searchDebounce: null,
  searchSelectedIdx: -1,
  searchResults: [],
};

// ═══ HELPERS & FORMATTERS ═══
const todayStr  = () => new Date().toISOString().split('T')[0];
const nowISO    = () => new Date().toISOString();
const fmt       = n => new Intl.NumberFormat('fr-FR').format(Math.round(n||0));
const genId     = pfx => `${pfx}-${Date.now().toString(36).toUpperCase()}`;

function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso), pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso), pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
}

function fmtDTSplit(iso) {
  if (!iso) return '<span style="color:var(--text3)">—</span>';
  const d = new Date(iso), pad = n => String(n).padStart(2,'0');
  const datePart = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
  const timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `<div style="font-size:11.5px;font-weight:600;color:var(--text2)">${datePart}</div><div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${timePart}</div>`;
}

function inRange(isoStr) {
  if (!ST.dateFrom && !ST.dateTo) return true;
  if (!isoStr) return true;
  const d = new Date(isoStr);
  if (ST.dateFrom && d < new Date(ST.dateFrom)) return false;
  if (ST.dateTo   && d > new Date(ST.dateTo))   return false;
  return true;
}

const fMvtIT  = () => ST.mouvements.filter(m => m.dept==='IT'      && inRange(m.created_at||m.date));
const fMvtFin = () => ST.mouvements.filter(m => m.dept==='Finance' && inRange(m.created_at||m.date));
const fDemIT  = () => ST.demandes.filter(d   => d.dept==='IT'      && inRange(d.created_at||d.date));
const fDemFin = () => ST.demandes.filter(d   => d.dept==='Finance' && inRange(d.created_at||d.date));

// ─── RÔLES ───
const curRole     = () => ST.profile?.role  || '';
const curDept     = () => ST.profile?.dept  || '';
const isAdmin     = () => curRole() === 'Administrateur';
const isSupportIT = () => curRole() === 'Support IT';
const isResFin    = () => curRole() === 'Responsable Finance';
const isUserIT    = () => curRole() === 'Utilisateur IT';
const isUserFin   = () => curRole() === 'Utilisateur Finance';
const canSeeIT    = () => isAdmin() || isSupportIT() || isUserIT();
const canSeeFin   = () => isAdmin() || isResFin()    || isUserFin();
const canSeePrix  = () => isAdmin() || isSupportIT() || isResFin();
const canManIT    = () => isAdmin() || isSupportIT();
const canManFin   = () => isAdmin() || isResFin();
const canValidIT  = () => canManIT();
const canValidFin = () => canManFin();
const canSeeHist  = () => isAdmin();
const canDemIT    = () => canSeeIT();
const canDemFin   = () => canSeeFin();

const alertsIT   = () => ST.produits.filter(p => p.dept==='IT'      && p.actif!==false && (p.stock<=p.seuil||p.stock===0));
const alertsFin  = () => ST.produits.filter(p => p.dept==='Finance' && p.actif!==false && (p.stock<=p.seuil||p.stock===0));
const attenteIT  = () => ST.demandes.filter(d => d.dept==='IT'      && d.statut==='En attente').length;
const attenteFin = () => ST.demandes.filter(d => d.dept==='Finance' && d.statut==='En attente').length;

// ← ÉTAPE B : isActif() — null/undefined traité comme actif (rétrocompatibilité)
const isActif = p => p.actif !== false;

const getStatus = p => p.stock===0 ? 'Rupture' : p.stock<=p.seuil ? 'Critique' : 'Disponible';
// ─── VALEUR TOTALE CUMULÉE (Étape D+) ────────────────────────
// Somme de la valeur de toutes les entrées historiques pour un produit.
// Source : ST.mouvementsEntrees (chargé sans filtre de période).
function getValeurTotaleProduit(produitId) {
  return (ST.mouvementsEntrees || [])
    .filter(m => m.produit_id === produitId)
    .reduce((s, m) => s + (m.valeur || 0), 0);
}

const statusTag = s => s==='Rupture'
  ? `<span class="tag" style="color:#dc2626;background:#fef2f2">● Rupture</span>`
  : s==='Critique'
  ? `<span class="tag" style="color:#d97706;background:#fffbeb">▲ Critique</span>`
  : `<span class="tag" style="color:#16a34a;background:#f0fdf4">✓ Dispo</span>`;

// ← ÉTAPE B : badge actif/inactif
const actifBadge = p => isActif(p)
  ? `<span class="tag" style="color:#16a34a;background:#dcfce7;font-size:9.5px">✓ Actif</span>`
  : `<span class="tag" style="color:#94a3b8;background:#f1f5f9;font-size:9.5px">✕ Inactif</span>`;

const typeBadge = t => t==='Entrée'
  ? `<span class="tag" style="color:#166534;background:#dcfce7">↓ Entrée</span>`
  : `<span class="tag" style="color:#991b1b;background:#fee2e2">↑ Sortie</span>`;

const statBadge = s => s==='Validé'
  ? `<span class="tag" style="color:#166534;background:#dcfce7">✓ Validé</span>`
  : s==='Refusé'
  ? `<span class="tag" style="color:#991b1b;background:#fee2e2">✕ Refusé</span>`
  : `<span class="tag" style="color:#92400e;background:#fef3c7">⏳ En attente</span>`;

const deptTag   = d => d==='IT'
  ? `<span class="tag" style="color:#3730a3;background:#e0e7ff">IT</span>`
  : `<span class="tag" style="color:#065f46;background:#d1fae5">Finance</span>`;

const urgBadge  = u => {
  const map={'Normale':'urg-normale','Urgente':'urg-urgente','Critique':'urg-critique'};
  return `<span class="tag ${map[u]||'urg-normale'}">${u||'Normale'}</span>`;
};

const btn = (lbl,color,outline,onclick,icon='') =>
  `<button class="btn ${outline?'btn-outline':'btn-solid'}" style="border-color:${color};${outline?`color:${color}`:`background:${color}`}" onclick="${onclick}">${icon?`<i class="ti ${icon}"></i>`:''} ${lbl}</button>`;

const accessDenied = () => `<div class="access-denied"><div class="icon"><i class="ti ti-lock"></i></div><div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">Accès restreint</div><div style="font-size:12px">Vous n'avez pas les droits nécessaires pour cette section.</div></div>`;

// ═══ AMORTISSEMENT ═══
function calcVNC(p) {
  if (!p.date_achat || !p.valeur_achat || !p.duree_amortissement || p.valeur_achat<=0) return null;
  const achat = new Date(p.date_achat), now = new Date();
  const moisEcoules = Math.max(0,(now.getFullYear()-achat.getFullYear())*12 + (now.getMonth()-achat.getMonth()));
  const duree = p.duree_amortissement;
  if (moisEcoules >= duree) return 0;
  return Math.round(p.valeur_achat * (1 - moisEcoules / duree));
}

function amortPct(p) {
  const vnc = calcVNC(p);
  if (vnc===null || !p.valeur_achat) return null;
  return Math.round((1 - vnc/p.valeur_achat)*100);
}

function amortColor(pct) {
  if (pct===null) return '#94a3b8';
  if (pct>=80)    return '#ef4444';
  if (pct>=50)    return '#f59e0b';
  return '#10b981';
}

function tauxLineaire(duree) { return duree ? Math.round(100/(duree/12)*100)/100 : null; }
function annuiteLineaire(p) {
  if (!p.valeur_achat || !p.duree_amortissement) return null;
  return Math.round(p.valeur_achat / (p.duree_amortissement/12));
}

// ═══ SEARCH ENGINE ═══
function highlight(text, query) {
  if (!query || !text) return text||'';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="hl">$1</mark>');
}

function matchesQuery(fields, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  return fields.some(f => f && String(f).toLowerCase().includes(q));
}

function escQ(s) { return String(s||'').replace(/'/g,"\\'").replace(/"/g,''); }

// ═══ INLINE SEARCH HELPERS ═══
window.setInlineQuery = (q) => { ST.search.inline.query = q; render(); };
window.resetInlineFilters = () => {
  ST.search.inline = { query:'', dept:'', cat:'', statut:'', type:'', urgence:'', statDem:'', actif:'' };
  renderActiveFiltersBar(); render();
};
window.toggleInlineFilter = (key, val) => {
  if (ST.search.inline[key] === val) ST.search.inline[key] = '';
  else ST.search.inline[key] = val;
  renderActiveFiltersBar(); render();
};
window.setInlineFilterQuery = (q) => { ST.search.inline.query = q; renderActiveFiltersBar(); render(); };

function hasActiveFilters() {
  const il = ST.search.inline;
  return !!(il.query || il.dept || il.cat || il.statut || il.type || il.urgence || il.statDem || il.actif);
}

function renderActiveFiltersBar() {
  const bar = document.getElementById('active-filters-bar');
  const il = ST.search.inline;
  if (!hasActiveFilters()) { bar.style.display='none'; return; }
  bar.style.display='flex';
  const chips = [];
  if (il.query)   chips.push({label:`"${il.query}"`, key:'query'});
  if (il.dept)    chips.push({label:`Dépt: ${il.dept}`, key:'dept'});
  if (il.cat)     chips.push({label:`Catég.: ${il.cat}`, key:'cat'});
  if (il.statut)  chips.push({label:`Stock: ${il.statut}`, key:'statut'});
  if (il.type)    chips.push({label:`Type: ${il.type}`, key:'type'});
  if (il.urgence) chips.push({label:`Urgence: ${il.urgence}`, key:'urgence'});
  if (il.statDem) chips.push({label:`Statut: ${il.statDem}`, key:'statDem'});
  if (il.actif)   chips.push({label:il.actif==='true'?'Actifs seulement':'Inactifs seulement', key:'actif'});
  bar.innerHTML = `
    <span class="af-label"><i class="ti ti-filter" style="font-size:11px;vertical-align:middle"></i> Filtres actifs :</span>
    ${chips.map(c=>`<span class="af-chip" onclick="clearOneFilter('${c.key}')" title="Supprimer ce filtre">${c.label} <span class="af-x">×</span></span>`).join('')}
    <span class="af-clear-all" onclick="resetInlineFilters()">Tout effacer</span>
  `;
}

window.clearOneFilter = (key) => { ST.search.inline[key] = ''; renderActiveFiltersBar(); render(); };

function buildContentSearchBar(opts = {}) {
  const il = ST.search.inline;
  const {
    showDept = false, showCat = false, cats = [],
    showStatut = false, showType = false,
    showUrgence = false, showStatDem = false,
    showActif = false,   // ← ÉTAPE B
    placeholder = 'Rechercher…', count = 0, filteredCount = 0,
  } = opts;
  const pill = (label, key, val, cls='') => {
    const active = il[key] === val;
    return `<span class="csb-pill${active?' on'+cls:''}" onclick="toggleInlineFilter('${key}','${val}')">${label}</span>`;
  };
  let filtersHtml = '';
  if (showDept)   filtersHtml += `<span class="sf-divider"></span><span class="csb-filter-label">Dépt</span>${pill('IT','dept','IT','-it')}${pill('Finance','dept','Finance','-fin')}`;
  if (showCat && cats.length) filtersHtml += `<span class="sf-divider"></span><span class="csb-filter-label">Catég.</span>${cats.map(c=>pill(c,'cat',c)).join('')}`;
  if (showStatut) filtersHtml += `<span class="sf-divider"></span><span class="csb-filter-label">Stock</span>${pill('Dispo','statut','Disponible','-ok')}${pill('Critique','statut','Critique','-amber')}${pill('Rupture','statut','Rupture','-red')}`;
  if (showType)   filtersHtml += `<span class="sf-divider"></span><span class="csb-filter-label">Type</span>${pill('↓ Entrée','type','Entrée','-ok')}${pill('↑ Sortie','type','Sortie','-red')}`;
  if (showUrgence) filtersHtml += `<span class="sf-divider"></span><span class="csb-filter-label">Urgence</span>${pill('Normale','urgence','Normale','-ok')}${pill('Urgente','urgence','Urgente','-amber')}${pill('Critique','urgence','Critique','-red')}`;
  if (showStatDem) filtersHtml += `<span class="sf-divider"></span><span class="csb-filter-label">Statut</span>${pill('En attente','statDem','En attente','-amber')}${pill('Validé','statDem','Validé','-ok')}${pill('Refusé','statDem','Refusé','-red')}`;
  // ← ÉTAPE B : filtre actif/inactif
  if (showActif)  filtersHtml += `<span class="sf-divider"></span><span class="csb-filter-label">État</span>${pill('Actifs','actif','true','-ok')}${pill('Inactifs','actif','false','-red')}`;
  const showCount = `<span class="csb-count">${filteredCount} / ${count} résultat${filteredCount!==1?'s':''}</span>`;
  const resetBtn = hasActiveFilters() ? `<button class="csb-reset" onclick="resetInlineFilters()"><i class="ti ti-x" style="font-size:11px"></i> Réinitialiser</button>` : '';
  return `<div class="content-search-bar">
    <div class="csb-input-wrap">
      <i class="ti ti-search"></i>
      <input class="csb-input" type="text" placeholder="${placeholder}"
        value="${(il.query||'').replace(/"/g,'&quot;')}"
        oninput="setInlineFilterQuery(this.value)"
        onkeydown="if(event.key==='Escape'){setInlineFilterQuery('');this.value='';}">
    </div>
    <div class="csb-filter-group">${filtersHtml}</div>
    ${showCount}${resetBtn}
  </div>`;
}

function applyInlineFilters(items, type = 'produit') {
  const il = ST.search.inline;
  const q = (il.query||'').toLowerCase().trim();
  return items.filter(item => {
    if (type === 'produit') {
      if (q && !matchesQuery([item.nom, item.categorie, item.id, item.emplacement, item.fournisseur], q)) return false;
      if (il.dept && item.dept !== il.dept) return false;
      if (il.cat && item.categorie !== il.cat) return false;
      if (il.statut && getStatus(item) !== il.statut) return false;
      // ← ÉTAPE B : filtre actif
      if (il.actif === 'true'  && item.actif === false) return false;
      if (il.actif === 'false' && item.actif !== false) return false;
    } else if (type === 'mouvement') {
      if (q && !matchesQuery([item.produit_nom, item.user_name, item.destination, item.fournisseur, item.ref_document, item.id, item.emplacement], q)) return false;
      if (il.dept && item.dept !== il.dept) return false;
      if (il.type && item.type !== il.type) return false;
    } else if (type === 'demande') {
      if (q && !matchesQuery([item.produit, item.demandeur, item.motif, item.dest, item.id], q)) return false;
      if (il.dept && item.dept !== il.dept) return false;
      if (il.urgence && item.urgence !== il.urgence) return false;
      if (il.statDem && item.statut !== il.statDem) return false;
    }
    return true;
  });
}

// ═══ CONFIRM DIALOG ═══
function showConfirm(title, msg, onConfirm, color='#ef4444') {
  document.getElementById('confirm-el')?.remove();
  const ov=document.createElement('div');
  ov.id='confirm-el'; ov.className='overlay';
  ov.innerHTML=`<div class="confirm-dialog">
    <div class="cd-title"><i class="ti ti-alert-triangle" style="color:${color};vertical-align:middle;margin-right:6px"></i>${title}</div>
    <div class="cd-msg">${msg}</div>
    <div class="cd-btns">
      ${btn('Annuler','#94a3b8',true,'closeConfirm()')}
      <button class="btn btn-solid" style="background:${color};border-color:${color}" onclick="confirmAction()">Confirmer</button>
    </div></div>`;
  ov._onConfirm=onConfirm;
  ov.addEventListener('click',e=>{ if(e.target===ov) closeConfirm(); });
  document.body.appendChild(ov);
}
window.closeConfirm  = () => document.getElementById('confirm-el')?.remove();
window.confirmAction = () => { const ov=document.getElementById('confirm-el'); if(ov?._onConfirm) ov._onConfirm(); ov?.remove(); };

// ═══ TOAST ═══
function showToast(msg, type='ok') {
  if (ST.toastTimer) clearTimeout(ST.toastTimer);
  let el=document.getElementById('toast-el');
  if (!el) { el=document.createElement('div'); el.id='toast-el'; el.className='toast'; document.body.appendChild(el); }
  el.style.display='flex';
  el.style.background=type==='err'?'#fef2f2':'#f0fdf4';
  el.style.color=type==='err'?'#dc2626':'#16a34a';
  el.style.border=`1px solid ${type==='err'?'#fecaca':'#bbf7d0'}`;
  el.innerHTML=(type==='err'?'<i class="ti ti-x"></i>':'<i class="ti ti-check"></i>')+' '+msg;
  ST.toastTimer=setTimeout(()=>{ el.style.display='none'; },3500);
}