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
  actifs: [],
  params: { destinations: [], categoriesIT: [], categoriesFin: [], emplacements: [], fournisseurs: [] },
  mouvementsEntrees: [],   // ← Étape D+ : toutes les entrées (sans filtre date) pour valeur cumulée
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
      actif: '',        // ← ÉTAPE B
      userRole: '',     // ← filtre rôle dans l'onglet Utilisateurs
      amortDept: '',    // ← Vue Lecteur : filtre département page Amortissement
      amortAnnee: '',   // ← Vue Lecteur : filtre année d'acquisition
    }
  },
  searchDebounce: null,
  searchSelectedIdx: -1,
  searchResults: [],
  searchResults: [],
  isSubmitting: false,   // ← Anti-double-clic global (soumissions Mouvements/Prêts/etc.)
};

// ═══ HELPERS & FORMATTERS ═══
const todayStr  = () => new Date().toISOString().split('T')[0];
const nowISO    = () => new Date().toISOString();
const fmt       = n => new Intl.NumberFormat('fr-FR').format(Math.round(n||0));
// FIX (duplicate key "mouvements_pkey") : Date.now() seul ne suffit pas à
// garantir l'unicité lorsque plusieurs ID sont générés en boucle synchrone
// dans la même milliseconde (ex: sortie multi-actifs, attribution de demande
// multi-actifs — chaque itération de .map() appelle genId()). Ajout d'un
// compteur incrémental interne + un suffixe aléatoire : la signature de la
// fonction est inchangée (même paramètre, même type de retour), donc aucun
// appelant existant n'a besoin d'être modifié.
let _genIdSeq = 0;
const genId = pfx => {
  _genIdSeq = (_genIdSeq + 1) % 1296; // wrap sur 2 caractères base36
  const seq  = _genIdSeq.toString(36).toUpperCase().padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${pfx}-${Date.now().toString(36).toUpperCase()}${seq}${rand}`;
};

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
const isLecteur   = () => curRole() === 'Lecteur'; // lecture seule : Dashboard, Stock, Historique, Rapports

const canSeeIT    = () => isAdmin() || isSupportIT() || isUserIT() || isLecteur();
const canSeeFin   = () => isAdmin() || isResFin()    || isUserFin() || isLecteur();
// FIX (Vue Lecteur enrichie) : le Lecteur (PDG / Direction Finance en consultation)
// est un rôle de pilotage stratégique — il doit voir toutes les valeurs monétaires.
// canSeePrix() reste un gate d'AFFICHAGE uniquement : l'édition reste strictement
// gérée par canManIT()/canManFin(), donc cet ajout n'ouvre aucune capacité d'écriture.
const canSeePrix  = () => isAdmin() || isSupportIT() || isResFin() || isLecteur();
const canManIT    = () => isAdmin() || isSupportIT();
const canManFin   = () => isAdmin() || isResFin();
const canValidIT  = () => canManIT();
const canValidFin = () => canManFin();
const canSeeHist  = () => isAdmin() || isLecteur(); // Lecteur accède à Historique + Rapports + Amortissement
const canDemIT    = () => !isLecteur() && canSeeIT();  // Lecteur ne peut pas créer de demandes
const canDemFin   = () => !isLecteur() && canSeeFin();

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

// ─── CUMP (Coût Unitaire Moyen Pondéré) — Point 1 ─────────────
// APRÈS
// ─── CUMP (Coût Unitaire Moyen Pondéré) — Point 1 ─────────────
// CUMP = valeur cumulée des entrées / quantité cumulée des entrées.
// Sert de base de valorisation pour les sorties de produits NON
// amortissables (remplace l'ancien repli sur produits.prix, un champ
// manuel déconnecté des prix d'entrée réels).
function getCUMPProduit(produitId) {
  const entrees  = (ST.mouvementsEntrees || []).filter(m => m.produit_id === produitId);
  const totalQty = entrees.reduce((s, m) => s + (m.qty || 0), 0);
  const totalVal = entrees.reduce((s, m) => s + (m.valeur || 0), 0);
  if (totalQty <= 0) return 0;
  return totalVal / totalQty;
}

// ─── Valeur du STOCK ACTUEL (Point 1) ─────────────────────────
// stock présent × CUMP — uniquement pour les produits NON amortissables.
// Les produits amortissables renvoient 0 ici : leur valorisation (VNC) est
// gérée exclusivement dans le module Actifs (calcVNC), jamais mélangée à la
// valeur du stock catalogue — conformément à la règle métier du point 1.
function getValeurStockActuel(produitId) {
  const prod = ST.produits.find(p => p.id === produitId);
  if (!prod || prod.is_amortissable) return 0;
  return (prod.stock || 0) * getCUMPProduit(produitId);
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
// ═══ ANTI-DOUBLE-CLIC (soumissions réseau) ═══
// withSubmitLock : verrouille ST.isSubmitting, désactive le(s) bouton(s) passé(s)
// avec un spinner, exécute fn(), puis déverrouille systématiquement (finally).
async function withSubmitLock(btnSelector, fn) {
  if (ST.isSubmitting) { showToast('Une opération est déjà en cours…', 'err'); return; }
  ST.isSubmitting = true;
  const btns = btnSelector ? Array.from(document.querySelectorAll(btnSelector)) : [];
  const originalHtml = btns.map(b => b.innerHTML);
  btns.forEach(b => {
    b.disabled = true;
    b.style.opacity = '.65';
    b.style.cursor = 'not-allowed';
    b.innerHTML = `<span class="btn-spinner" style="width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .7s linear infinite"></span> En cours…`;
  });
  try {
    await fn();
  } finally {
    ST.isSubmitting = false;
    btns.forEach((b, i) => {
      // Le modal peut avoir été fermé/redessiné entre-temps ; on protège l'accès.
      if (document.body.contains(b)) {
        b.disabled = false;
        b.style.opacity = '';
        b.style.cursor = '';
        b.innerHTML = originalHtml[i];
      }
    });
  }
}
window.withSubmitLock = withSubmitLock;
const accessDenied = () => `<div class="access-denied"><div class="icon"><i class="ti ti-lock"></i></div><div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">Accès restreint</div><div style="font-size:12px">Vous n'avez pas les droits nécessaires pour cette section.</div></div>`;

// ═══ AMORTISSEMENT ═══
function calcVNC(p) {
  if (!p.date_achat || !p.valeur_achat || !p.duree_amortissement || p.valeur_achat<=0) return null;
  // FIX (v4) : prise en compte de la valeur résiduelle (plancher d'amortissement).
  // Les `produits` (catalogue) n'ont pas cette colonne → residuelle=0 → comportement
  // strictement identique à avant pour tout ce qui n'est pas un actif individuel.
  const residuelle = Math.min(p.valeur_residuelle || 0, p.valeur_achat);
  const achat = new Date(p.date_achat), now = new Date();
  const moisEcoules = Math.max(0,(now.getFullYear()-achat.getFullYear())*12 + (now.getMonth()-achat.getMonth()));
  const duree = p.duree_amortissement;
  const montantAmortissable = p.valeur_achat - residuelle;
  if (moisEcoules >= duree) return residuelle;
  return Math.round(residuelle + montantAmortissable * (1 - moisEcoules / duree));
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
  ST.search.inline = { query:'', dept:'', cat:'', statut:'', type:'', urgence:'', statDem:'', actif:'', userRole:'', amortDept:'', amortAnnee:'' };
  renderActiveFiltersBar(); render();
};
window.toggleInlineFilter = (key, val) => {
  if (ST.search.inline[key] === val) ST.search.inline[key] = '';
  else ST.search.inline[key] = val;
  renderActiveFiltersBar(); render();
};
window.setInlineFilterQuery = (q) => {
  ST.search.inline.query = q;
  renderActiveFiltersBar();
  // FIX : le render() détruit puis recrée le DOM → l'input perd le focus à chaque frappe.
  // Débounce 80ms + restauration du focus/curseur après rebuild du DOM.
  clearTimeout(ST._csbTimer);
  ST._csbTimer = setTimeout(() => {
    const activeEl = document.activeElement;
    const isCsb    = activeEl?.classList?.contains('csb-input');
    const selStart = isCsb ? activeEl.selectionStart : null;
    const selEnd   = isCsb ? activeEl.selectionEnd   : null;
    render();
    if (isCsb) {
      const inp = document.querySelector('.csb-input');
      if (inp) {
        inp.focus();
        try { inp.setSelectionRange(selStart ?? q.length, selEnd ?? q.length); } catch(e) {}
      }
    }
  }, 80);
};

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

// ─── Setter dédié pour la catégorie (select onChange) ─────────
window.setInlineCat = (val) => {
  ST.search.inline.cat = (val === '__all__') ? '' : val;
  renderActiveFiltersBar();
  render();
};

/** Filtre par rôle dans l'onglet Utilisateurs */
window.setUserRoleFilter = (val) => { ST.search.inline.userRole = val; render(); };

function buildContentSearchBar(opts = {}) {
  const il = ST.search.inline;
  const {
    showDept    = false,
    showCat     = false, cats = [],
    showStatut  = false,
    showType    = false,
    showUrgence = false,
    showStatDem = false,
    showActif   = false,
    placeholder = 'Rechercher…',
    count       = 0,
    filteredCount = 0,
  } = opts;

  const pill = (label, key, val, cls = '') => {
    const active = il[key] === val;
    return `<span class="csb-pill${active ? ' on' + cls : ''}" onclick="toggleInlineFilter('${key}','${val}')">${label}</span>`;
  };

  // ── Ligne 1 : recherche texte ────────────────────────────────
  const searchRow = `
    <div class="csb-row csb-row-search">
      <div class="csb-input-wrap">
        <i class="ti ti-search"></i>
        <input class="csb-input" type="text" placeholder="${placeholder}"
          value="${(il.query || '').replace(/"/g, '&quot;')}"
          oninput="setInlineFilterQuery(this.value)"
          onkeydown="if(event.key==='Escape'){setInlineFilterQuery('');this.value='';}">
        ${il.query
          ? `<button class="csb-clear-input" onclick="setInlineFilterQuery('');document.querySelector('.csb-input').value=''" title="Effacer">
               <i class="ti ti-x"></i>
             </button>`
          : ''}
      </div>
      <span class="csb-count">${filteredCount} / ${count} résultat${filteredCount !== 1 ? 's' : ''}</span>
      ${hasActiveFilters()
        ? `<button class="csb-reset" onclick="resetInlineFilters()">
             <i class="ti ti-refresh" style="font-size:11px"></i> Réinitialiser
           </button>`
        : ''}
    </div>`;

  // ── Ligne 2 : filtres (dropdown catégorie + pills) ───────────
  let filterChips = '';

  if (showDept) {
    filterChips += `
      <div class="csb-chip-group">
        <span class="csb-filter-label">Dépt</span>
        ${pill('IT', 'dept', 'IT', '-it')}
        ${pill('Finance', 'dept', 'Finance', '-fin')}
      </div>`;
  }

  if (showCat && cats.length) {
    filterChips += `
      <div class="csb-chip-group">
        <label class="csb-filter-label" for="csb-cat-sel">Catégorie</label>
        <select id="csb-cat-sel" class="csb-cat-select" onchange="setInlineCat(this.value)" title="Filtrer par catégorie">
          <option value="__all__" ${!il.cat ? 'selected' : ''}>Toutes catégories</option>
          ${cats.map(c => `<option value="${escQ(c)}" ${il.cat === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>`;
  }

  if (showStatut) {
    filterChips += `
      <div class="csb-chip-group">
        <span class="csb-filter-label">Stock</span>
        ${pill('Dispo',    'statut', 'Disponible', '-ok')}
        ${pill('Critique', 'statut', 'Critique',   '-amber')}
        ${pill('Rupture',  'statut', 'Rupture',    '-red')}
      </div>`;
  }

  if (showType) {
    filterChips += `
      <div class="csb-chip-group">
        <span class="csb-filter-label">Type</span>
        ${pill('↓ Entrée', 'type', 'Entrée', '-ok')}
        ${pill('↑ Sortie', 'type', 'Sortie', '-red')}
      </div>`;
  }

  if (showUrgence) {
    filterChips += `
      <div class="csb-chip-group">
        <span class="csb-filter-label">Urgence</span>
        ${pill('Normale',  'urgence', 'Normale',  '-ok')}
        ${pill('Urgente',  'urgence', 'Urgente',  '-amber')}
        ${pill('Critique', 'urgence', 'Critique', '-red')}
      </div>`;
  }

  if (showStatDem) {
    filterChips += `
      <div class="csb-chip-group">
        <span class="csb-filter-label">Statut</span>
        ${pill('En attente', 'statDem', 'En attente', '-amber')}
        ${pill('Validé',     'statDem', 'Validé',     '-ok')}
        ${pill('Refusé',     'statDem', 'Refusé',     '-red')}
      </div>`;
  }

  if (showActif) {
    filterChips += `
      <div class="csb-chip-group">
        <span class="csb-filter-label">État</span>
        ${pill('Actifs',   'actif', 'true',  '-ok')}
        ${pill('Inactifs', 'actif', 'false', '-red')}
      </div>`;
  }

  const filtersRow = filterChips
    ? `<div class="csb-row csb-row-filters">${filterChips}</div>`
    : '';

  return `
    <div class="content-search-bar">
      ${searchRow}
      ${filtersRow}
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
      if (q && !matchesQuery([item.produit_nom, item.user_name, item.destination, item.fournisseur, item.ref_document, item.id, item.emplacement, item.actif_id], q)) return false;
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
