'use strict';

// ═══════════════════════════════════════════════════════════════
//   PRÊTS — MODULE COMPLET (schéma v3 — FK corrigée)
//
//   Colonnes prets après migration fix_fk_prets.sql :
//     id, actif_numero(text), produit_id(text, sans FK),
//     produit_nom, dept, emprunteur, emprunteur_id,
//     date_debut, date_retour_prevue, date_retour_reelle,
//     statut, motif, valideur, valideur_id, notes,
//     created_at, updated_at
//
//   actif_numero = numéro CNTO de l'actif individuel (ex: CNTO-IT-PC-26-0001)
//   produit_id   = ID du produit catalogue (ex: IT-MQMETGM4), sans FK
// ═══════════════════════════════════════════════════════════════

// ─── Chargement depuis Supabase ───────────────────────────────
async function loadPrets() {
  const { data, error } = await db
    .from('prets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('[loadPrets]', error); return; }
  const now = new Date();
  ST.prets = (data || []).map(p => {
    // Enrichissement mémoire : "En cours" + date dépassée → "En retard"
    if (
      p.statut === STATUS_PRET.EN_COURS &&
      p.date_retour_prevue &&
      new Date(p.date_retour_prevue) < now
    ) {
      return { ...p, statut: STATUS_PRET.EN_RETARD };
    }
    return p;
  });
}

// ─── Helpers ──────────────────────────────────────────────────

/** Retourne le numéro CNTO de l'actif associé au prêt (compat. ancienne colonne). */
function getActifNumero(pret) {
  return pret.actif_numero || pret.produit_id || null;
}

function joursRestants(pret) {
  if (!pret.date_retour_prevue) return null;
  if (pret.statut === STATUS_PRET.RETOURNE || pret.statut === STATUS_PRET.PERDU) return null;
  const diff = new Date(pret.date_retour_prevue) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function pretStatutBadge(statut) {
  if (statut === STATUS_PRET.EN_COURS)   return `<span class="tag pret-encours">⇄ En cours</span>`;
  if (statut === STATUS_PRET.EN_RETARD)  return `<span class="tag pret-retard">⚠ En retard</span>`;
  if (statut === STATUS_PRET.RETOURNE)   return `<span class="tag pret-retourne">✓ Retourné</span>`;
  if (statut === STATUS_PRET.PERDU)      return `<span class="tag pret-perdu">✕ Perdu</span>`;
  return `<span class="tag">${statut || '—'}</span>`;
}

// ─── Vue principale ────────────────────────────────────────────
function renderPrets(dept) {
  if (dept === 'IT'      && !canManIT())  return accessDenied();
  if (dept === 'Finance' && !canManFin()) return accessDenied();

  const color   = dept === 'IT' ? '#4f46e5' : '#10b981';
  const il      = ST.search.inline;
  const q       = (il.query || '').trim();

  const all      = (ST.prets || []).filter(p => p.dept === dept);
  const enCours  = all.filter(p => p.statut === STATUS_PRET.EN_COURS);
  const enRetard = all.filter(p => p.statut === STATUS_PRET.EN_RETARD);
  const retournes= all.filter(p => p.statut === STATUS_PRET.RETOURNE);
  const perdus   = all.filter(p => p.statut === STATUS_PRET.PERDU);

  const filtered = all.filter(p => {
    if (!q) return true;
    return matchesQuery(
      [getActifNumero(p), p.emprunteur, p.produit_nom, p.motif, p.notes, p.statut, p.id],
      q
    );
  });

  const kpis = [
    { lbl: 'En cours',  val: enCours.length,   s: 'prêts actifs',              c: '#3b82f6' },
    { lbl: 'En retard', val: enRetard.length,   s: 'dépassement échéance',      c: '#ef4444' },
    { lbl: 'Retournés', val: retournes.length,  s: 'sur la période',            c: '#10b981' },
    { lbl: 'Perdus',    val: perdus.length,      s: 'actifs définitivement perdus', c: '#7c3aed' },
    { lbl: 'Total',     val: all.length,          s: 'enregistrements',           c: '#64748b' },
  ];

  const alertBanner = enRetard.length > 0
    ? `<div class="info-banner" style="background:#fef2f2;border-color:#fecaca;color:#dc2626">
        <i class="ti ti-alert-triangle" style="color:#dc2626"></i>
        <div><strong>${enRetard.length} actif(s) en retard de restitution.</strong> Contactez les emprunteurs concernés.</div>
      </div>`
    : '';

  const perduBanner = perdus.length > 0
    ? `<div class="info-banner" style="background:#f5f3ff;border-color:#c4b5fd;color:#6d28d9">
        <i class="ti ti-alert-octagon" style="color:#7c3aed"></i>
        <div><strong>${perdus.length} actif(s) déclaré(s) perdu(s).</strong> Ces actifs ont été réformés automatiquement.</div>
      </div>`
    : '';

  const searchBar = buildContentSearchBar({
    placeholder: `Rechercher dans les prêts ${dept} (n° actif, emprunteur, produit, motif…)`,
    count:         all.length,
    filteredCount: filtered.length,
  });

  const hdrs = [
    'ID Prêt', 'Produit', 'Emprunteur',
    'Date début', 'Retour prévu', 'Délai',
    'Notes / Destination', 'Motif', 'Statut', 'Retour effectif', 'Action',
  ];

  const rows = filtered.map(p => {
    const actifNum = getActifNumero(p);
    const jours = joursRestants(p);
    let delaiCell = '<span style="color:var(--text3)">—</span>';
    if (jours !== null) {
      const c2  = jours < 0 ? '#dc2626' : jours <= 2 ? '#d97706' : '#16a34a';
      const lbl = jours < 0
        ? `${Math.abs(jours)}j de retard`
        : jours === 0 ? "Aujourd'hui" : `J−${jours}`;
      delaiCell = `<span style="color:${c2};font-weight:700;font-size:11px">${lbl}</span>`;
    }

    let actionCell = '<span style="font-size:11px;color:var(--text3)">—</span>';
    if (p.statut === STATUS_PRET.PERDU) {
      // ← réversibilité v4 : un prêt Perdu peut redevenir Retourné (matériel retrouvé)
      actionCell = btn('🔎 Retrouvé', '#10b981', true, `retrouverActifPret('${p.id}')`);
    } else if (isValidTransition(TRANSITIONS_PRET, p.statut, STATUS_PRET.RETOURNE)) {
      actionCell = `<div style="display:flex;gap:4px;flex-wrap:wrap">
        ${btn('↩ Retour', '#10b981', true, `retournerPret('${p.id}')`)}
        ${btn('✕ Perdu',  '#7c3aed', true, `perdreActif('${p.id}')`)}
      </div>`;
    }

    const rowStyle = p.statut === STATUS_PRET.EN_RETARD
      ? ' style="background:#fff5f5"'
      : p.statut === STATUS_PRET.PERDU
        ? ' style="background:#f5f3ff"'
        : (p.statut === STATUS_PRET.RETOURNE ? ' class="row-inactif"' : '');

    return `<tr${rowStyle}>
      <td><code style="font-size:9px">${highlight(p.id, q)}</code></td>
      <td style="font-weight:600;font-size:12.5px">${highlight(p.produit_nom || '—', q)}<br><code class="actif-id" style="margin-top:2px;display:inline-block">${highlight(actifNum || '—', q)}</code></td>
      <td style="font-weight:500">${highlight(p.emprunteur || '—', q)}</td>
      <td>${fmtDate(p.date_debut || p.created_at)}</td>
      <td style="font-weight:600">${p.date_retour_prevue ? fmtDate(p.date_retour_prevue) : '—'}</td>
      <td>${delaiCell}</td>
      <td style="font-size:11px;color:var(--text2)">${highlight(p.notes || '—', q)}</td>
      <td style="font-size:11px;color:var(--text3);max-width:120px">${highlight((p.motif || '').slice(0, 55), q)}</td>
      <td>${pretStatutBadge(p.statut)}</td>
      <td style="font-size:11px;color:var(--text3)">${p.date_retour_reelle ? fmtDate(p.date_retour_reelle) : '—'}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');

  const emptyRow = !filtered.length
    ? `<tr class="no-result-row"><td colspan="${hdrs.length}">
        <div class="nri">${q ? '🔍' : '📋'}</div>
        <div class="nrt">${q
          ? `Aucun prêt ne correspond à « ${q} »`
          : `Aucun prêt enregistré pour le département ${dept}`
        }</div>
        ${q ? `<div style="font-size:11px;margin-top:4px">
          <a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a>
        </div>` : ''}
      </td></tr>`
    : '';

  return `<p class="page-title">Gestion des Prêts — ${dept}</p>
    <p class="page-sub">${enCours.length} prêt(s) en cours${enRetard.length
      ? ` · <span style="color:#dc2626;font-weight:700">${enRetard.length} en retard</span>`
      : ''}${perdus.length
      ? ` · <span style="color:#7c3aed;font-weight:700">${perdus.length} perdu(s)</span>`
      : ''} · ${all.length} total</p>
    ${alertBanner}${perduBanner}
    <div class="kpi-grid">${kpis.map(k =>
      `<div class="kpi" style="border-left-color:${k.c}">
        <div class="kpi-lbl">${k.lbl}</div>
        <div class="kpi-val">${k.val}</div>
        <div class="kpi-s">${k.s}</div>
      </div>`
    ).join('')}</div>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV', '#10b981', true, `exportPretsCSV('${dept}')`, 'ti-download')}
      ${btn('+ Nouveau prêt', color, false, `openPret('${dept}')`, 'ti-plus')}
    </div>
    ${searchBar}
    <div class="card">
      <div class="card-hd">
        <span class="card-ttl">
          <i class="ti ti-transfer" style="color:${color}"></i>
          Registre des prêts ${dept}
        </span>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows || emptyRow}</tbody>
      </table></div>
    </div>`;
}

// ─── Modal — Nouveau Prêt ──────────────────────────────────────
window.openPret = (dept) => {
  ST.modal = { type: 'pret', dept };
  renderModalPret();
};

function renderModalPret() {
  document.getElementById('modal-el')?.remove();
  if (!ST.modal || ST.modal.type !== 'pret') return;

  const { dept } = ST.modal;
  const color    = dept === 'IT' ? '#4f46e5' : '#10b981';
  const destOpts = ST.params.destinations.map(d => `<option value="${d}">${d}</option>`).join('');

  const actifsDispos = (ST.actifs || []).filter(a => {
    if (a.dept !== dept) return false;
    if (a.statut !== STATUS_ACTIF.EN_SERVICE) return false;
    // Exclure les actifs dont le produit parent est désactivé (actif = false)
    const prodParent = ST.produits.find(p => p.id === a.produit_id);
    return !prodParent || isActif(prodParent);
  });
  const actifOpts = actifsDispos.map(a =>
    `<option value="${a.id}" data-nom="${escQ(a.produit_nom || '')}" data-produit-id="${escQ(a.produit_id || '')}">
      ${a.id} — ${a.produit_nom || '—'} (${a.emplacement || '—'})
    </option>`
  ).join('');

  const tomorrow    = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const emprunteurField = ST.allProfiles.length > 0
    ? `<select id="f-pret-emprunteur">
        ${ST.allProfiles
          .filter(u => u.dept === dept || u.dept === 'both' || u.role === 'Administrateur')
          .map(u => `<option value="${u.name}">${u.name} (${u.role})</option>`)
          .join('')}
      </select>`
    : `<input id="f-pret-emprunteur" type="text" placeholder="Nom de l'emprunteur…">`;

  const noActifBanner = !actifsDispos.length
    ? `<div class="info-banner" style="margin-top:8px;font-size:11.5px">
        <i class="ti ti-info-circle"></i>
        Aucun actif « En service » disponible pour le département ${dept}.
      </div>`
    : '';

  const body = `
    <div class="form-2col">
      <div class="form-row">
        <label class="form-lbl">Département</label>
        <input value="${dept}" disabled class="field-readonly" style="font-weight:700;color:${color}">
      </div>
      <div class="form-row">
        <label class="form-lbl">Valideur</label>
        <input value="${ST.profile?.name || ''}" readonly class="field-readonly">
      </div>
    </div>
    <div class="form-row">
      <label class="form-lbl">Actif à prêter <span class="req">*</span></label>
      ${actifsDispos.length
        ? `<select id="f-pret-actif" onchange="onActifPretChange(this)">
            <option value="">— Sélectionner un actif en service —</option>
            ${actifOpts}
          </select>`
        : `<input value="Aucun actif disponible" disabled class="field-readonly">`
      }
      ${noActifBanner}
    </div>
    <div class="form-row">
      <label class="form-lbl">Produit</label>
      <input id="f-pret-produit" readonly class="field-readonly" placeholder="Auto-rempli à la sélection">
    </div>
    <div class="form-2col">
      <div class="form-row">
        <label class="form-lbl">Emprunteur <span class="req">*</span></label>
        ${emprunteurField}
      </div>
      <div class="form-row">
        <label class="form-lbl">Date de retour prévue <span class="req">*</span></label>
        <input id="f-pret-retour" type="date" min="${tomorrowStr}" value="${tomorrowStr}">
      </div>
    </div>
    <div class="form-row">
      <label class="form-lbl">Destination / Affectation</label>
      <select id="f-pret-dest">
        <option value="">— Optionnel —</option>
        ${destOpts}
      </select>
    </div>
    <div class="form-row">
      <label class="form-lbl">Motif <span class="req">*</span></label>
      <textarea id="f-pret-motif" rows="2" placeholder="Contexte et raison du prêt…" style="resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
      ${btn('Annuler', '#94a3b8', true, 'closeModal()')}
      ${actifsDispos.length ? btn('✓ Enregistrer le prêt', color, false, 'submitPret()') : ''}
    </div>`;

  const ov = document.createElement('div');
  ov.id = 'modal-el';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" onclick="event.stopPropagation()">
    <div class="modal-h">
      <span class="modal-ttl">📋 Nouveau prêt — ${dept}</span>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    ${body}
  </div>`;
  ov.addEventListener('click', closeModal);
  document.body.appendChild(ov);
}

window.onActifPretChange = (sel) => {
  const opt     = sel.options[sel.selectedIndex];
  const prodNom = opt?.getAttribute('data-nom') || '';
  const inp     = document.getElementById('f-pret-produit');
  if (inp) inp.value = prodNom;
};

// ─── Création d'un prêt ────────────────────────────────────────
window.submitPret = async () => {
  const dept = ST.modal?.dept;
  if (!dept) return;
  if (dept === 'IT' && !canManIT() || dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }

  const actifId        = document.getElementById('f-pret-actif')?.value?.trim();
  const emprunteur     = document.getElementById('f-pret-emprunteur')?.value?.trim();
  const dateRetourPrev = document.getElementById('f-pret-retour')?.value;
  const dest           = document.getElementById('f-pret-dest')?.value || '';
  const motif          = document.getElementById('f-pret-motif')?.value?.trim() || '';

  if (!actifId)        { showToast('Sélectionnez un actif', 'err');         return; }
  if (!emprunteur)     { showToast("L'emprunteur est requis", 'err');       return; }
  if (!dateRetourPrev) { showToast('Date de retour prévue requise', 'err'); return; }
  if (!motif)          { showToast('Le motif est requis', 'err');           return; }

  const actif = (ST.actifs || []).find(a => a.id === actifId);
  if (!actif) { showToast('Actif introuvable', 'err'); return; }

  if (!isValidTransition(TRANSITIONS_ACTIF, actif.statut, STATUS_ACTIF.EN_PRET)) {
    showToast(`"${actifId}" ne peut pas être prêté (statut : ${actif.statut})`, 'err'); return;
  }

  const emprunteurProfile = ST.allProfiles.find(u => u.name === emprunteur);
  const id = genId(dept === 'IT' ? 'PRT-IT' : 'PRT-FIN');

  // FIX (v4) : insert prêt + update actif désormais dans rpc_creer_pret — une
  // seule transaction SQL. Avant, un échec du second update laissait un prêt
  // "En cours" existant alors que l'actif restait "En service" (visible dans
  // deux sélecteurs à la fois).
  try {
    const { error } = await db.rpc('rpc_creer_pret', {
      p_pret_id:            id,
      p_actif_id:           actifId,
      p_dept:               dept,
      p_emprunteur:         emprunteur,
      p_emprunteur_id:      emprunteurProfile?.id || null,
      p_date_retour_prevue: dateRetourPrev,
      p_motif:              motif,
      p_notes:              dest || '',
      p_valideur:           ST.profile?.name || '',
      p_valideur_id:        ST.user?.id || null,
    });
    if (error) throw error;

    closeModal();
    showToast(`Prêt enregistré — "${actifId}" confié à ${emprunteur} jusqu'au ${fmtDate(dateRetourPrev)}`);
    await Promise.all([loadPrets(), loadActifs()]);
    render();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'err');
  }
};

// ─── Retour d'un actif prêté ───────────────────────────────────
window.retournerPret = async (id) => {
  const pret = (ST.prets || []).find(p => p.id === id);
  if (!pret) return;

  const { dept } = pret;
  if (dept === 'IT' && !canManIT() || dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }

  if (!isValidTransition(TRANSITIONS_PRET, pret.statut, STATUS_PRET.RETOURNE)) {
    showToast(`Ce prêt ne peut pas être clôturé (statut : ${pret.statut})`, 'err'); return;
  }

  const actifNum = getActifNumero(pret);

  showConfirm(
    `Confirmer le retour de "${actifNum}" ?`,
    `L'actif <strong>${pret.produit_nom || actifNum}</strong> confié à
     <strong>${pret.emprunteur}</strong> repassera en statut <strong>En service</strong>.`,
    async () => {
      try {
        const { error } = await db.rpc('rpc_retourner_pret', {
          p_pret_id:   id,
          p_user_name: ST.profile?.name || 'Système',
          p_user_id:   ST.user?.id || null,
        });
        if (error) throw error;

        showToast(`"${actifNum}" retourné — remis en service`);
        await Promise.all([loadPrets(), loadActifs()]);
        render();
      } catch (err) {
        showToast('Erreur : ' + err.message, 'err');
      }
    },
    '#10b981'
  );
};

// ─── Perte d'un actif prêté ────────────────────────────────────
window.perdreActif = async (id) => {
  const pret = (ST.prets || []).find(p => p.id === id);
  if (!pret) return;

  const { dept } = pret;
  if (dept === 'IT' && !canManIT() || dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }

  if (!isValidTransition(TRANSITIONS_PRET, pret.statut, STATUS_PRET.PERDU)) {
    showToast(`Ce prêt ne peut pas être déclaré perdu (statut : ${pret.statut})`, 'err'); return;
  }

  const actifNum = getActifNumero(pret);

  showConfirm(
    `Déclarer "${actifNum}" comme perdu ?`,
    `L'actif <strong>${pret.produit_nom || actifNum}</strong> confié à
     <strong>${pret.emprunteur}</strong> sera définitivement <strong>Réformé</strong>.
     Cette action est irréversible.`,
    async () => {
      try {
        const { error } = await db.rpc('rpc_perdre_pret', {
          p_pret_id:   id,
          p_user_name: ST.profile?.name || 'Système',
          p_user_id:   ST.user?.id || null,
        });
        if (error) throw error;

        showToast(`"${actifNum}" déclaré perdu — réformé`);
        await Promise.all([loadPrets(), loadActifs()]);
        render();
      } catch (err) {
        showToast('Erreur : ' + err.message, 'err');
      }
    },
    '#7c3aed'
  );
};

// ─── Retrouvaille d'un actif déclaré perdu (réversibilité — v4) ─
// Symétrique de reintegrerActif (v3) mais pour les pertes déclarées via un
// prêt : exige un prêt "Perdu" lié (vérifié côté SQL), pour ne jamais pouvoir
// annuler une réforme "fin de vie" normale par erreur.
window.retrouverActifPret = async (id) => {
  const pret = (ST.prets || []).find(p => p.id === id);
  if (!pret) return;

  const { dept } = pret;
  if (dept === 'IT' && !canManIT() || dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }

  const actifNum = getActifNumero(pret);

  showConfirm(
    `Confirmer que "${actifNum}" a été retrouvé ?`,
    `L'actif <strong>${pret.produit_nom || actifNum}</strong> repassera en statut
     <strong>En service</strong>. L'auteur et la date de cette réintégration
     seront conservés dans l'historique de l'actif.`,
    async () => {
      try {
        const { data, error } = await db.rpc('rpc_retrouver_actif', {
          p_pret_id:   id,
          p_user_name: ST.profile?.name || 'Système',
          p_user_id:   ST.user?.id || null,
          p_obs:       '',
        });
        if (error) throw error;

        showToast(`"${actifNum}" retrouvé et réintégré par ${data?.par || ST.profile?.name}`);
        await Promise.all([loadPrets(), loadActifs()]);
        render();
      } catch (err) {
        showToast('Erreur : ' + err.message, 'err');
      }
    },
    '#10b981'
  );
};

// ─── Export CSV ────────────────────────────────────────────────
window.exportPretsCSV = (dept) => {
  const all = (ST.prets || []).filter(p => p.dept === dept);

  const headers = [
    'ID Prêt', 'N° Actif (CNTO)', 'ID Produit catalogue', 'Produit',
    'Département', 'Emprunteur', 'Valideur',
    'Date début', 'Retour prévu', 'Retour effectif',
    'Notes / Destination', 'Motif', 'Statut',
  ];

  const rows = all.map(p => [
    p.id,
    getActifNumero(p) || '',
    p.produit_id      || '',
    p.produit_nom     || '',
    p.dept,
    p.emprunteur      || '',
    p.valideur        || '',
    fmtDate(p.date_debut || p.created_at),
    p.date_retour_prevue || '',
    p.date_retour_reelle ? fmtDate(p.date_retour_reelle) : '',
    p.notes           || '',
    p.motif           || '',
    p.statut,
  ]);

  exportToCSV(rows, headers, `prets_${dept.toLowerCase()}_${todayFileDate()}.csv`);
};