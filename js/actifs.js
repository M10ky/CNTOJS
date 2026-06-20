'use strict';

// ═══════════════════════════════════════════════════════════════
//   ACTIFS INDIVIDUELS — MODULE COMPLET
//   Dépendances : utils.js, stock.js, export.js
// ═══════════════════════════════════════════════════════════════

// ─── Chargement depuis Supabase ───────────────────────────────
async function loadActifs() {
  const { data, error } = await db
    .from('actifs_individuels')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('[loadActifs]', error); return; }
  ST.actifs = data || [];
}

// ─── Nomenclature CNTO-{DEPT}-{CAT3}-{YEAR}-{SEQ4} ──────────
function getCatAbbr(categorie) {
  if (!categorie) return 'GEN';
  const norm = categorie
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // supprime les diacritiques
    .replace(/[^a-zA-Z\s]/g, '')
    .trim()
    .toUpperCase();
  const first = (norm.split(/\s+/)[0] || 'GEN');
  return first.padEnd(3, 'X').slice(0, 3);
}

function generateNomenclature(dept, categorie, year, seq) {
  const deptCode = dept === 'IT' ? 'IT' : 'FIN';
  const catAbbr  = getCatAbbr(categorie);
  return `CNTO-${deptCode}-${catAbbr}-${year}-${String(seq).padStart(4, '0')}`;
}

// ─── Création automatique d'actifs à l'entrée de stock ────────
window.createActifUnits = async (prod, qty, mvtId, emplacement) => {
  try {
    // Lire le dernier numéro de séquence pour ce produit
    let lastSeq = 0;
    const { data: seqRow, error: seqRErr } = await db
      .from('serial_sequences')
      .select('last_seq')
      .eq('produit_id', prod.id)
      .maybeSingle();
    if (seqRErr) throw seqRErr;
    if (seqRow) lastSeq = seqRow.last_seq || 0;

    const year = new Date().getFullYear();
    const now  = nowISO();
    const actifs = [];

    for (let i = 0; i < qty; i++) {
      const seq = lastSeq + i + 1;
      actifs.push({
        id:                  generateNomenclature(prod.dept, prod.categorie, year, seq),
        produit_id:          prod.id,
        produit_nom:         prod.nom,
        categorie:           prod.categorie            || '',
        dept:                prod.dept,
        emplacement:         emplacement || prod.emplacement || '',
        date_entree:         now,
        valeur_achat:        prod.valeur_achat         || 0,
        date_achat:          prod.date_achat           || null,
        duree_amortissement: prod.duree_amortissement  || 36,
        statut:              'En service',
        mouvement_entree_id: mvtId,
        observation:         '',
        created_at:          now,
        updated_at:          now,
      });
    }

    const { error: insErr } = await db.from('actifs_individuels').insert(actifs);
    if (insErr) throw insErr;

    // Mettre à jour (ou créer) le compteur de séquence
    const { error: seqWErr } = await db.from('serial_sequences').upsert(
      { produit_id: prod.id, last_seq: lastSeq + qty, updated_at: now },
      { onConflict: 'produit_id' }
    );
    if (seqWErr) throw seqWErr;

    const first = actifs[0].id;
    const last  = actifs[actifs.length - 1].id;
    showToast(
      `${qty} actif${qty > 1 ? 's' : ''} créé${qty > 1 ? 's' : ''} — ${first}${qty > 1 ? ' → ' + last : ''}`
    );
  } catch (err) {
    console.error('[createActifUnits]', err);
    showToast('Erreur création actifs : ' + err.message, 'err');
  }
};

// ─── Mise à jour du flag is_amortissable ─────────────────────
window.updateAmortissable = async (prodId, val) => {
  try {
    const { error } = await db
      .from('produits')
      .update({ is_amortissable: val, updated_at: nowISO() })
      .eq('id', prodId);
    if (error) throw error;
    await loadProduits();
    showToast(val ? 'Suivi individuel activé pour ce produit' : 'Suivi individuel désactivé');
  } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
};

// ─── Actions sur les actifs ────────────────────────────────────
window.horsServiceActif = async (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;
  try {
    const { error } = await db
      .from('actifs_individuels')
      .update({ statut: 'Hors service', updated_at: nowISO() })
      .eq('id', id);
    if (error) throw error;
    showToast(`"${id}" mis hors service`);
    await loadActifs(); render();
  } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
};

window.reactiverActif = async (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;
  try {
    const { error } = await db
      .from('actifs_individuels')
      .update({ statut: 'En service', updated_at: nowISO() })
      .eq('id', id);
    if (error) throw error;
    showToast(`"${id}" réactivé en service`);
    await loadActifs(); render();
  } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
};

window.reformerActif = async (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;
  showConfirm(
    `Réformer "${id}" ?`,
    `L'actif "${a.produit_nom}" sera définitivement réformé. Cette action est irréversible.`,
    async () => {
      try {
        const { error } = await db
          .from('actifs_individuels')
          .update({ statut: 'Réformé', updated_at: nowISO() })
          .eq('id', id);
        if (error) throw error;
        showToast(`"${id}" réformé`);
        await loadActifs(); render();
      } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
    },
    '#ef4444'
  );
};

// ─── Badge statut actif ────────────────────────────────────────
function actifStatutBadge(statut) {
  if (statut === 'En service')   return `<span class="tag actif-sv">● En service</span>`;
  if (statut === 'En prêt')      return `<span class="tag actif-pr">⇄ En prêt</span>`;
  if (statut === 'Hors service') return `<span class="tag actif-hs">⚠ Hors service</span>`;
  if (statut === 'Réformé')      return `<span class="tag actif-rf">✕ Réformé</span>`;
  return `<span class="tag">${statut || '—'}</span>`;
}

// ─── Page Actifs Individuels ───────────────────────────────────
function renderActifs(dept) {
  const color = dept === 'IT' ? '#4f46e5' : '#10b981';
  const il    = ST.search.inline;
  const q     = (il.query || '').trim();
  const canM  = dept === 'IT' ? canManIT() : canManFin();

  const all = ST.actifs.filter(a => a.dept === dept);

  // Filtrage texte libre
  const filtered = all.filter(a => {
    if (!q) return true;
    return matchesQuery(
      [a.id, a.produit_nom, a.categorie, a.emplacement, a.statut, a.mouvement_entree_id],
      q
    );
  });

  // KPIs
  const nbSv = all.filter(a => a.statut === 'En service').length;
  const nbPr = all.filter(a => a.statut === 'En prêt').length;
  const nbHs = all.filter(a => a.statut === 'Hors service').length;
  const nbRf = all.filter(a => a.statut === 'Réformé').length;
  const vncTotale = all
    .filter(a => a.statut === 'En service' || a.statut === 'En prêt')
    .reduce((s, a) => s + (calcVNC(a) || 0), 0);
  const valTotale = all
    .filter(a => a.statut === 'En service' || a.statut === 'En prêt')
    .reduce((s, a) => s + (a.valeur_achat || 0), 0);

  const kpis = [
    { lbl: 'En service',    val: nbSv, s: 'actifs opérationnels', c: '#10b981' },
    { lbl: 'En prêt',       val: nbPr, s: 'actifs sortis',        c: '#3b82f6' },
    { lbl: 'Hors service',  val: nbHs, s: 'à vérifier/réparer',   c: '#f59e0b' },
    { lbl: 'Réformés',      val: nbRf, s: 'fin de vie',           c: '#ef4444' },
  ];
  if (canSeePrix() && all.length) {
    kpis.push({
      lbl: 'VNC Totale (actifs actifs)',
      val: fmt(vncTotale) + ' MGA',
      s: `sur ${fmt(valTotale)} MGA d'achat`,
      c: '#4f46e5',
    });
  }

  // Écran vide
  if (!all.length) {
    return `<p class="page-title">Actifs Individuels ${dept}</p>
      <p class="page-sub">Aucun actif enregistré pour le département ${dept}</p>
      <div class="info-banner">
        <i class="ti ti-info-circle"></i>
        <div>
          Les actifs individuels sont créés <strong>automatiquement</strong> lors d'une entrée de stock
          sur un produit coché <strong>« Suivi individuel amortissable »</strong>.<br>
          Activez ce suivi dans le formulaire de modification du produit, puis enregistrez une entrée.
        </div>
      </div>
      <div class="card"><div class="empty-state">
        <div class="empty-ico">📦</div>
        <div style="font-size:14px;font-weight:700;color:var(--text)">Aucun actif individuel</div>
        <div style="font-size:12px;margin-top:6px;color:var(--text3)">
          Activez le suivi amortissable sur un produit, puis enregistrez une entrée de stock.
        </div>
      </div></div>`;
  }

  // Barre de recherche (texte libre uniquement — filtres par statut à l'Étape E)
  const searchBar = buildContentSearchBar({
    placeholder: `Rechercher dans les actifs ${dept} (nomenclature, produit, emplacement, statut…)`,
    count: all.length,
    filteredCount: filtered.length,
  });

  // En-têtes dynamiques selon droits
  const hdrs = ['Nomenclature', 'Produit', 'Catégorie', 'Emplacement', 'Date entrée'];
  if (canSeePrix()) hdrs.push('Valeur achat');
  hdrs.push('Durée');
  if (canSeePrix()) hdrs.push('VNC · Avanc.');
  hdrs.push('Statut');
  if (canM) hdrs.push('Actions');

  const rows = filtered.map(a => {
    const vnc = calcVNC(a);
    const pct = amortPct(a);
    const vncCell = vnc !== null
      ? `<div style="font-weight:700;font-size:12px">${fmt(vnc)} MGA</div>
         <div class="amort-bar"><div class="amort-fill" style="width:${pct}%;background:${amortColor(pct)}"></div></div>
         <div style="font-size:9px;color:${amortColor(pct)};margin-top:1px">${pct}% amorti</div>`
      : '<span style="color:var(--text3);font-size:11px">—</span>';

    const actions = canM
      ? `<div style="display:flex;gap:4px;flex-wrap:wrap">
          ${a.statut === 'En service'   ? btn('⚠ HS',     '#f59e0b', true, `horsServiceActif('${a.id}')`) : ''}
          ${a.statut === 'Hors service' ? btn('↩ Activer','#10b981', true, `reactiverActif('${a.id}')`)   : ''}
          ${a.statut !== 'Réformé'      ? btn('✕ Réformer','#ef4444',true, `reformerActif('${a.id}')`)    : '<span class="tag actif-rf" style="font-size:9.5px">Réformé</span>'}
        </div>`
      : '';

    return `<tr${a.statut === 'Réformé' ? ' class="row-inactif"' : ''}>
      <td><code class="actif-id">${highlight(a.id, q)}</code></td>
      <td style="font-weight:600;font-size:12.5px">${highlight(a.produit_nom, q)}</td>
      <td><span class="tag" style="color:#475569;background:#f1f5f9">${highlight(a.categorie, q)}</span></td>
      <td>${a.emplacement
        ? `<span class="tag" style="color:#1e40af;background:#dbeafe;font-size:9.5px">${highlight(a.emplacement, q)}</span>`
        : '<span style="color:var(--text3)">—</span>'
      }</td>
      <td>${fmtDate(a.date_entree)}</td>
      ${canSeePrix() ? `<td style="font-family:var(--mono);font-size:12px">${fmt(a.valeur_achat)} MGA</td>` : ''}
      <td style="font-size:11px;color:var(--text3)">${a.duree_amortissement ? (a.duree_amortissement / 12).toFixed(1) + ' a' : '—'}</td>
      ${canSeePrix() ? `<td>${vncCell}</td>` : ''}
      <td>${actifStatutBadge(a.statut)}</td>
      ${canM ? `<td>${actions}</td>` : ''}
    </tr>`;
  }).join('');

  const emptyRow = !filtered.length
    ? `<tr class="no-result-row"><td colspan="${hdrs.length}">
        <div class="nri">🔍</div>
        <div class="nrt">Aucun actif ne correspond à "${q}"</div>
        <div style="font-size:11px;margin-top:4px">
          <a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a>
        </div>
      </td></tr>`
    : '';

  return `<p class="page-title">Actifs Individuels ${dept}</p>
    <p class="page-sub">${all.length} actif${all.length > 1 ? 's' : ''} enregistré${all.length > 1 ? 's' : ''} · ${nbSv} en service · ${nbPr} en prêt · ${nbHs + nbRf} hors service / réformés</p>
    <div class="kpi-grid">${kpis.map(k =>
      `<div class="kpi" style="border-left-color:${k.c}">
        <div class="kpi-lbl">${k.lbl}</div>
        <div class="kpi-val">${k.val}</div>
        <div class="kpi-s">${k.s}</div>
      </div>`
    ).join('')}</div>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV', '#10b981', true, `exportActifsCSV('${dept}')`, 'ti-download')}
    </div>
    ${searchBar}
    <div class="card">
      <div class="card-hd">
        <span class="card-ttl">
          <i class="ti ti-devices" style="color:${color}"></i>
          Registre des actifs ${dept}
        </span>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows || emptyRow}</tbody>
      </table></div>
    </div>`;
}

// ─── Export CSV actifs ─────────────────────────────────────────
window.exportActifsCSV = (dept) => {
  const all   = ST.actifs.filter(a => a.dept === dept);
  const showP = canSeePrix();

  const headers = [
    'Nomenclature', 'Produit', 'Catégorie', 'Emplacement',
    'Statut', 'Date entrée', 'Mouvement entrée',
  ];
  if (showP) headers.push('Valeur achat (MGA)', 'Date achat', 'Durée amort. (mois)', 'VNC (MGA)', '% Amorti');

  const rows = all.map(a => {
    const vnc = calcVNC(a);
    const pct = amortPct(a);
    const row = [
      a.id, a.produit_nom, a.categorie, a.emplacement || '',
      a.statut, fmtDT(a.date_entree), a.mouvement_entree_id || '',
    ];
    if (showP) row.push(
      a.valeur_achat            || 0,
      a.date_achat              || '',
      a.duree_amortissement     || '',
      vnc !== null ? vnc        : '',
      pct !== null ? pct + '%'  : ''
    );
    return row;
  });

  exportToCSV(rows, headers, `actifs_${dept.toLowerCase()}_${todayFileDate()}.csv`);
};