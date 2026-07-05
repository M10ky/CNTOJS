'use strict';

// ═══ CHARGEMENT DONNÉES ═══
async function loadAllData() {
  await Promise.all([
    loadProduits(), loadMouvements(), loadDemandes(), loadParams(),
    loadMouvementsEntrees(),  // ← Étape D+ : valeur cumulée par produit
    loadActifs(),
    loadPrets(),
    (isAdmin() || isSupportIT() || isResFin()) ? loadAllProfiles() : Promise.resolve(),
  ]);
}

// FIX : la fonction loadActifs() était définie EN DOUBLE (ici et dans actifs.js),
// avec la même requête fautive `.order('created_at', ...)` sur une colonne qui
// n'existe pas sur actifs_individuels. La définition de actifs.js (chargée après
// ce fichier) écrasait silencieusement celle-ci au runtime — la duplication ne
// changeait donc rien fonctionnellement, mais entretenait la confusion et le bug.
// Elle est retirée d'ici ; loadActifs() vit désormais uniquement dans actifs.js,
// avec un tri corrigé sur 'date_entree'.

async function loadProduits() {
  const { data, error } = await db.from('produits').select('*, is_amortissable').order('nom');
  if (error) { console.error(error); return; }
  ST.produits = data||[];
}

async function loadMouvements() {
  let q = db.from('mouvements').select('*').order('created_at',{ascending:false}).limit(500);
  if (ST.dateFrom) q=q.gte('created_at', ST.dateFrom);
  if (ST.dateTo)   q=q.lte('created_at', ST.dateTo);
  const { data, error } = await q;
  if (error) { console.error(error); return; }
  ST.mouvements = data||[];
}

async function loadDemandes() {
  let q = db.from('demandes').select('*').order('created_at',{ascending:false}).limit(300);
  if (ST.dateFrom) q=q.gte('created_at', ST.dateFrom);
  if (ST.dateTo)   q=q.lte('created_at', ST.dateTo);
  const { data, error } = await q;
  if (error) { console.error(error); return; }
  ST.demandes = data||[];
}

async function loadParams() {
  const { data, error } = await db.from('parametres').select('*').order('valeur');
  if (error) { console.error(error); return; }
  const rows=data||[];
  ST.params = {
    destinations:  rows.filter(r=>r.cle==='destinations').map(r=>r.valeur),
    categoriesIT:  rows.filter(r=>r.cle==='categoriesIT').map(r=>r.valeur),
    categoriesFin: rows.filter(r=>r.cle==='categoriesFin').map(r=>r.valeur),
    emplacements:  rows.filter(r=>r.cle==='emplacements').map(r=>r.valeur),
    fournisseurs:  rows.filter(r=>r.cle==='fournisseurs').map(r=>r.valeur),  // ← Étape D+
  };
}

async function loadAllProfiles() {
  const { data, error } = await db.from('profiles').select('*').order('name');
  if (error) { console.error(error); return; }
  ST.allProfiles = data||[];
}
// ─── Étape D+ : entrées sans filtre de période ────────────────
// Sélection minimale (produit_id + valeur) pour calculer la valeur cumulée dans prodTable.
async function loadMouvementsEntrees() {
  const { data, error } = await db
    .from('mouvements')
    .select('produit_id, qty, valeur')
    .eq('type', 'Entrée');
  if (error) { console.error('[loadMouvementsEntrees]', error); return; }
  ST.mouvementsEntrees = data || [];
}

// ═══ ÉTAPE B : TOGGLE ACTIF/INACTIF ═══
window.toggleProductActif = async (id, currentlyActif) => {
  const p = ST.produits.find(x => x.id === id);
  if (!p) return;
  if (p.dept==='IT'&&!canManIT() || p.dept==='Finance'&&!canManFin()) {
    showToast('Action non autorisée','err'); return;
  }
  const newState = !currentlyActif;
  showConfirm(
    newState ? `Réactiver "${p.nom}" ?` : `Désactiver "${p.nom}" ?`,
    newState
      ? 'Le produit redeviendra disponible pour les mouvements, demandes et alertes.'
      : 'Les mouvements et demandes seront bloqués. Le produit restera visible (grisé) dans l\'inventaire.',
    async () => {
      try {
        const { error } = await db.from('produits').update({ actif: newState, updated_at: nowISO() }).eq('id', id);
        if (error) throw error;
        showToast(newState ? `"${p.nom}" réactivé` : `"${p.nom}" désactivé`);
        await loadProduits(); render();
      } catch(err) { showToast('Erreur: ' + err.message, 'err'); }
    },
    newState ? '#10b981' : '#f59e0b'
  );
};

// ═══ CRUD MOUVEMENTS ═══
window.submitMvt = async (typeStr) => {
  if (ST.isSubmitting) { showToast('Une opération est déjà en cours…', 'err'); return; }

  const dept = ST.modal.dept;
  if (dept==='IT' && !canManIT() || dept==='Finance' && !canManFin()) {
    showToast('Action non autorisée','err'); return;
  }

  const prodId   = document.getElementById('f-prod')?.value;
  const qty      = parseInt(document.getElementById('f-qty')?.value) || 0;
  const prixUnit = parseFloat(document.getElementById('f-prix-unit')?.value) || 0;
  const user     = ST.profile?.name || 'Système';
  const userId   = ST.user?.id || null;
  const dest     = document.getElementById('f-dest')?.value || '';
  const empl     = document.getElementById('f-empl')?.value || '';
  const obs      = document.getElementById('f-obs')?.value || '';
  const refDoc   = document.getElementById('f-ref-doc')?.value || '';
  const fournisseur = document.getElementById('f-fournisseur')?.value || '';

  if (!prodId) { showToast('Sélectionnez un produit','err'); return; }

  const prod = ST.produits.find(p => p.id === prodId);
  if (!prod) { showToast('Produit introuvable','err'); return; }

  if (!isActif(prod)) {
    showToast(`"${prod.nom}" est désactivé — réactivez-le d'abord`, 'err'); return;
  }

  // ─── Gestion des sorties amortissables ───
  let selectedActifIds = [];
  if (typeStr === 'Sortie' && prod.is_amortissable === true) {
    selectedActifIds = Array.from(document.querySelectorAll('.f-actif-sortie-chk:checked'))
                           .map(el => el.value);

    if (!selectedActifIds.length) {
      showToast('Vous devez sélectionner au moins un matériel à sortir', 'err');
      return;
    }

    // Vérification de disponibilité en temps réel (bloque les actifs déjà sortis/en prêt/etc.)
    await loadActifs();
    for (const id of selectedActifIds) {
      const a = (ST.actifs || []).find(x => x.id === id);
      if (!a || a.statut !== STATUS_ACTIF.EN_SERVICE) {
        showToast(`Le matériel ${id} n'est plus disponible (statut : ${a?.statut || 'inconnu'})`, 'err');
        return;
      }
    }
  } else if (typeStr === 'Sortie' && prod.is_amortissable !== true) {
    if (qty <= 0) { showToast('Quantité invalide','err'); return; }
    if (prod.stock < qty) { showToast(`Stock insuffisant (${prod.stock} disponible)`, 'err'); return; }
  } else if (typeStr === 'Entrée') {
    if (qty <= 0) { showToast('Quantité invalide','err'); return; }
  }

  const effectiveQty = selectedActifIds.length > 0 ? selectedActifIds.length : qty;

  await withSubmitLock('#btn-submit-mvt', async () => {
    try {
      const tsNow = nowISO();
      const mvtId = genId(dept === 'IT' ? 'MVT-IT' : 'MVT-FIN');

      // 1. Mise à jour du stock du produit
      const { error: sErr } = await db.from('produits')
        .update({
          stock: typeStr === 'Entrée' ? prod.stock + qty : prod.stock - effectiveQty,
          updated_at: tsNow
        })
        .eq('id', prodId);
      if (sErr) throw sErr;

      // 2. Insertion du mouvement principal (global — pas d'actif_id ici,
      //    sauf cas particulier d'une sortie amortissable d'un seul actif)
      if (!(typeStr === 'Sortie' && selectedActifIds.length > 0)) {
        const { error: mErr } = await db.from('mouvements').insert({
          id: mvtId,
          date: todayStr(),
          created_at: tsNow,
          type: typeStr,
          produit_id: prodId,
          produit_nom: prod.nom,
          qty: effectiveQty,
          valeur: effectiveQty * (typeStr === 'Entrée' ? prixUnit : (prod.prix || 0)),
          dept,
          user_name: user,
          user_id: userId,
          destination: dest,
          emplacement: empl,
          ref_document: refDoc,
          fournisseur,
          observation: obs
        });
        if (mErr) throw mErr;
      }

      // 3. Traitement spécifique Sortie Amortissable — UN mouvement PAR actif,
      //    avec actif_id rempli, + passage du statut à 'Sorti'.
      // FIX intégrité : on met à jour le statut des actifs AVANT d'insérer les
      // mouvements. Ainsi, si la contrainte CHECK côté base (statut invalide,
      // colonne manquante, etc.) rejette la mise à jour, AUCUN mouvement n'est
      // créé — on évite les mouvements orphelins (actif_id renseigné mais actif
      // resté "En service"). Logique métier et données envoyées strictement
      // identiques, seul l'ordre des deux opérations est inversé.
      if (typeStr === 'Sortie' && selectedActifIds.length > 0) {
        const { error: aErr } = await db
          .from('actifs_individuels')
          .update({ statut: STATUS_ACTIF.SORTI })
          .in('id', selectedActifIds);
        if (aErr) throw aErr;

        const mvtRows = selectedActifIds.map(actifId => {
          const actif = ST.actifs.find(a => a.id === actifId);
          return {
            id: genId(dept==='IT'?'MVT-IT':'MVT-FIN'),
            date: todayStr(),
            created_at: nowISO(),
            type: 'Sortie',
            produit_id: prodId,
            produit_nom: prod.nom,
            actif_id: actifId,                       // ← clé de traçabilité individuelle
            qty: 1,
            valeur: actif?.valeur_achat || 0,
            dept,
            user_name: user,
            user_id: userId,
            destination: dest,
            emplacement: empl,
            ref_document: refDoc,
            fournisseur,
            observation: obs || `Sortie individuelle — ${actifId}`
          };
        });
        const { error: mBatchErr } = await db.from('mouvements').insert(mvtRows);
        if (mBatchErr) throw mBatchErr;
      }

      // 4. Entrée Amortissable → Création des actifs individuels
      if (typeStr === 'Entrée' && prod.is_amortissable === true) {
        const ta = document.getElementById('f-serials');
        let manualSerials = [];

        if (ta && ta.value.trim()) {
          manualSerials = ta.value.split('\n').map(s => s.trim()).filter(Boolean);

          if (manualSerials.length > 0 && manualSerials.length !== qty) {
            showToast(`${qty} numéro(s) de série requis — ${manualSerials.length} saisi(s)`, 'err');
            return;
          }
          if (new Set(manualSerials).size !== manualSerials.length) {
            showToast('Numéros de série en double détectés', 'err');
            return;
          }
        }

        const res = await createActifUnits(prod, qty, mvtId, empl, manualSerials, prixUnit);

        if (res.ok) {
          showToast(`Entrée enregistrée + ${qty} actif(s) créé(s) ${res.first ? `— ${res.first}${qty > 1 ? ' → ' + res.last : ''}` : ''}`);
        } else {
          showToast(`Entrée enregistrée, mais échec création des actifs : ${res.message || 'Erreur inconnue'}`, 'err');
        }
      }
      // Toast Sortie amortissable — clair et listant les actifs concernés
      else if (typeStr === 'Sortie' && selectedActifIds.length > 0) {
        const list = selectedActifIds.length <= 3
          ? selectedActifIds.join(', ')
          : `${selectedActifIds.slice(0,3).join(', ')} +${selectedActifIds.length - 3}`;
        showToast(`Sortie de ${selectedActifIds.length} actif(s) enregistrée : ${list}`);
      }
      // Toast par défaut
      else {
        showToast(`${typeStr} enregistrée — ${effectiveQty}× ${prod.nom}`);
      }

      closeModal();
      await Promise.all([loadProduits(), loadMouvements(), loadMouvementsEntrees(), loadActifs()]);
      render();

    } catch (err) {
      console.error(err);
      showToast('Erreur lors de l\u2019enregistrement : ' + err.message, 'err');
    }
  });
};

// ═══ CRUD PRODUITS ═══
window.submitAdd = async () => {
  const dept = ST.modal.dept;
  if (dept==='IT' && !canManIT() || dept==='Finance' && !canManFin()) {
    showToast('Action non autorisée','err'); return;
  }
  const nom     = document.getElementById('f-nom')?.value?.trim();
  const cat     = document.getElementById('f-cat')?.value;
  const empl    = document.getElementById('f-add-empl')?.value || (ST.params.emplacements[0] || 'Stock Principal');
  const seuil   = parseInt(document.getElementById('f-seuil')?.value) || 5;
  const isAmort = document.getElementById('f-amort-chk')?.checked || false;

  if (!nom || !cat) { showToast('Nom et catégorie requis','err'); return; }

  const id = genId(dept === 'IT' ? 'IT' : 'FIN');
  try {
    const { error } = await db.from('produits').insert({
      id, nom, categorie: cat, dept,
      stock: 0,            // Initialisé à 0 — alimenté via les entrées en stock
      seuil,
      prix: 0,             // Pas de prix fixe : valeur dérivée des mouvements
      emplacement: empl,
      valeur_achat: 0, date_achat: null, duree_amortissement: 36,
      is_amortissable: isAmort,
      actif: true,
    });
    if (error) throw error;
    closeModal();
    showToast(`"${nom}" créé${isAmort ? ' (suivi individuel activé)' : ''}`);
    await loadProduits(); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

window.submitEdit = async () => {
  const p=ST.modal.prod;
  const seuil  = parseInt(document.getElementById('f-edit-seuil')?.value)||p.seuil;
  const prix   = parseInt(document.getElementById('f-edit-prix')?.value)||p.prix;
  const empl   = document.getElementById('f-edit-empl')?.value || p.emplacement;
  const valAch = parseInt(document.getElementById('f-edit-valach')?.value)||p.valeur_achat||0;
  const dtAch  = document.getElementById('f-edit-dtach')?.value || p.date_achat || null;
  const duree  = parseInt(document.getElementById('f-edit-duree')?.value)||p.duree_amortissement||36;
  try {
    const { error } = await db.from('produits').update({ seuil, prix, emplacement:empl, valeur_achat:valAch, date_achat:dtAch, duree_amortissement:duree, updated_at:nowISO() }).eq('id',p.id);
    if (error) throw error;
    closeModal(); showToast('Produit mis à jour');
    await loadProduits(); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

window.deleteProduct = async (id, dept, nom) => {
  if (dept==='IT'&&!canManIT()||dept==='Finance'&&!canManFin()) { showToast('Action non autorisée','err'); return; }
  showConfirm(`Supprimer "${nom}" ?`, "Cette action est irréversible. Les mouvements existants seront conservés.", async () => {
    try {
      const { error } = await db.from('produits').delete().eq('id',id);
      if (error) throw error;
      showToast(`"${nom}" supprimé`);
      await loadProduits(); render();
    } catch(err) { showToast('Erreur: '+err.message,'err'); }
  }, '#ef4444');
};

window.openEditProduct = (id) => {
  const p=ST.produits.find(x=>x.id===id);
  if (!p) return;
  if (p.dept==='IT'&&!canManIT()||p.dept==='Finance'&&!canManFin()) return;
  ST.modal={type:'edit',prod:p,dept:p.dept}; renderModal();
};

// ═══ CRUD DEMANDES ═══
window.submitDem = async (dept) => {
  if (dept==='IT'&&!canDemIT()||dept==='Finance'&&!canDemFin()) { showToast('Action non autorisée','err'); return; }
  const user  = ST.profile?.name||'';
  const prod  = document.getElementById('f-dem-prod')?.value?.trim();
  const qty   = parseInt(document.getElementById('f-dem-qty')?.value)||1;
  const dest  = document.getElementById('f-dem-dest')?.value?.trim();
  const motif = document.getElementById('f-dem-motif')?.value?.trim();
  const urg   = document.getElementById('f-dem-urgence')?.value || 'Normale';
  if (!prod)  { showToast('Produit requis','err'); return; }
  if (!dest)  { showToast('Veuillez sélectionner une destination','err'); return; }
  if (!motif) { showToast('Le motif est requis','err'); return; }
  const id=genId(dept==='IT'?'DEM-IT':'DEM-FIN');
  const tsNow=nowISO();
  try {
    const { error } = await db.from('demandes').insert({ id, date:todayStr(), created_at:tsNow, demandeur:user, demandeur_id:ST.user?.id, produit:prod, qty, dest, motif, dept, statut:'En attente', urgence:urg });
    if (error) throw error;
    closeModal(); showToast('Demande soumise avec succès');
    await loadDemandes(); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

window.validDem = async (dept, id, action) => {
  if (dept==='IT'&&!canValidIT()||dept==='Finance'&&!canValidFin()) { showToast('Action non autorisée','err'); return; }
  const dem=ST.demandes.find(d=>d.id===id);
  if (!dem) return;

  if (action==='Validé') {
    await loadProduits();
    const prod = ST.produits.find(p => p.nom.trim().toLowerCase()===dem.produit.trim().toLowerCase() && p.dept===dept);
    if (!prod) { showToast(`Produit "${dem.produit}" introuvable dans l'inventaire ${dept}`,'err'); return; }
    // ← ÉTAPE B : blocage validation si produit inactif
    if (!isActif(prod)) {
      showToast(`"${prod.nom}" est désactivé — réactivez-le avant de valider cette demande`,'err'); return;
    }

    // ← Produit amortissable : la déduction directe est remplacée par la
    // sélection d'actifs individuels. Le statut de la demande n'est mis à
    // jour qu'après attribution (cf. submitDemAttribution ci-dessous).
    if (prod.is_amortissable === true) {
      await loadActifs();
      openDemAttribution(dept, id);
      return;
    }

    if (prod.stock < dem.qty) { showToast(`Stock insuffisant : ${prod.stock} disponible, ${dem.qty} demandé`,'err'); return; }

    await withSubmitLock(`[data-dem-id="${id}"] button`, async () => {
      try {
        const tsNow=nowISO();
        const { error:sErr } = await db.from('produits').update({stock:prod.stock-dem.qty,updated_at:tsNow}).eq('id',prod.id);
        if (sErr) throw sErr;
        const mvtId=genId(dept==='IT'?'MVT-IT':'MVT-FIN');
        const { error:mErr } = await db.from('mouvements').insert({ id:mvtId, date:todayStr(), created_at:tsNow, type:'Sortie', produit_id:prod.id, produit_nom:prod.nom, qty:dem.qty, valeur:dem.qty*prod.prix, dept, user_name:ST.profile?.name||'Système', user_id:ST.user?.id, destination:dem.dest||'', demande_id:id, observation:`Validation demande ${id} — ${dem.demandeur}` });
        if (mErr) throw mErr;
        const { error:dErr } = await db.from('demandes').update({ statut:'Validé', valideur:ST.profile?.name||'', valideur_id:ST.user?.id, updated_at:nowISO() }).eq('id',id);
        if (dErr) throw dErr;
        showToast('Demande validée — stock mis à jour');
        await Promise.all([loadDemandes(),loadProduits(),loadMouvements()]); render();
      } catch(err) { showToast('Erreur: '+err.message,'err'); }
    });
    return;
  }

  // ─ Refus (verrouillé de la même façon que la validation) ─
  await withSubmitLock(`[data-dem-id="${id}"] button`, async () => {
    try {
      const { error } = await db.from('demandes').update({ statut:action, valideur:ST.profile?.name||'', valideur_id:ST.user?.id, updated_at:nowISO() }).eq('id',id);
      if (error) throw error;
      showToast('Demande refusée');
      await Promise.all([loadDemandes(),loadProduits(),loadMouvements()]); render();
    } catch(err) { showToast('Erreur: '+err.message,'err'); }
  });
};

// ═══════════════════════════════════════════════════════════════
//   VALIDATION DE DEMANDE — PRODUIT AMORTISSABLE
//   Sélecteur d'actifs individuels dédié (même filtre EN_SERVICE que la
//   sortie directe) : le validateur choisit précisément quel matériel est
//   attribué avant que la demande ne soit réellement validée.
// ═══════════════════════════════════════════════════════════════
window.openDemAttribution = (dept, demId) => {
  ST.modal = { type: 'demAttrib', dept, demId };
  renderModalDemAttribution();
};

function renderModalDemAttribution() {
  document.getElementById('modal-el')?.remove();
  if (!ST.modal || ST.modal.type !== 'demAttrib') return;

  const { dept, demId } = ST.modal;
  const dem = ST.demandes.find(d => d.id === demId);
  if (!dem) { closeModal(); return; }

  const prod = ST.produits.find(p => p.nom.trim().toLowerCase()===dem.produit.trim().toLowerCase() && p.dept===dept);
  if (!prod) { closeModal(); showToast(`Produit "${dem.produit}" introuvable`, 'err'); return; }

  const color = dept === 'IT' ? '#4f46e5' : '#10b981';
  const dispo = (ST.actifs || []).filter(a => a.produit_id === prod.id && a.statut === STATUS_ACTIF.EN_SERVICE);

  if (dispo.length < dem.qty) {
    const ov = document.createElement('div');
    ov.id = 'modal-el'; ov.className = 'overlay';
    ov.innerHTML = `<div class="modal" onclick="event.stopPropagation()">
      <div class="modal-h"><span class="modal-ttl">Attribution — ${dem.produit}</span>
        <button class="close-btn" onclick="closeModal()">✕</button></div>
      <div class="info-banner" style="background:#fef2f2;border-color:#fecaca;color:#dc2626">
        <i class="ti ti-alert-triangle"></i>
        <div><strong>${dispo.length}</strong> matériel(s) « En service » disponible(s), mais
        <strong>${dem.qty}</strong> demandé(s). Complétez le stock (entrée) ou ajustez la demande
        avant de valider.</div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">${btn('Fermer','#94a3b8',true,'closeModal()')}</div>
    </div>`;
    ov.addEventListener('click', closeModal);
    document.body.appendChild(ov);
    return;
  }

  const rows = dispo.map(a => `
    <tr>
      <td><input type="checkbox" class="f-dem-attrib-chk" value="${a.id}" onchange="updateDemAttribCount()"></td>
      <td><code class="actif-id">${a.id}</code></td>
      <td style="font-size:11px">${a.emplacement || '—'}</td>
      <td style="font-size:11px;font-family:var(--mono)">${fmt(a.valeur_achat)} MGA</td>
      <td style="font-size:11px">${fmtDate(a.date_entree)}</td>
      <td>${actifStatutBadge(a.statut)}</td>
    </tr>`).join('');

  const body = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">
      Demande de <strong>${dem.demandeur}</strong> · ${dem.produit} · quantité demandée : <strong>${dem.qty}</strong>
    </div>
    <div class="form-row">
      <label class="form-lbl">Matériels à attribuer <span class="req">*</span></label>
      <div style="max-height:260px;overflow-y:auto;overflow-x:auto;border:1.5px solid var(--border);border-radius:8px">
        <table style="width:100%">
          <thead><tr><th style="width:30px"></th><th>N° CNTO / Série</th><th>Emplacement</th><th>Valeur achat</th><th>Date entrée</th><th>État</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:6px;font-size:11.5px;color:var(--text2)">
        <strong id="f-dem-attrib-count">0</strong> / ${dem.qty} matériel(s) sélectionné(s)
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
      ${btn('Annuler','#94a3b8',true,'closeModal()')}
      <button id="btn-submit-dem-attrib" class="btn btn-solid" style="background:${color};border-color:${color}" onclick="submitDemAttribution()">✓ Attribuer et valider</button>
    </div>`;

  const ov = document.createElement('div');
  ov.id = 'modal-el'; ov.className = 'overlay';
  ov.innerHTML = `<div class="modal modal-wide" onclick="event.stopPropagation()">
    <div class="modal-h"><span class="modal-ttl">📋 Attribution de matériel — ${dem.produit}</span>
      <button class="close-btn" onclick="closeModal()">✕</button></div>
    ${body}
  </div>`;
  ov.addEventListener('click', closeModal);
  document.body.appendChild(ov);
}

window.updateDemAttribCount = () => {
  const n = document.querySelectorAll('.f-dem-attrib-chk:checked').length;
  const el = document.getElementById('f-dem-attrib-count');
  if (el) el.textContent = n;
};

window.submitDemAttribution = async () => {
  const { dept, demId } = ST.modal || {};
  if (!demId) return;
  if (dept==='IT'&&!canValidIT()||dept==='Finance'&&!canValidFin()) { showToast('Action non autorisée','err'); return; }

  const dem = ST.demandes.find(d => d.id === demId);
  if (!dem) return;
  const prod = ST.produits.find(p => p.nom.trim().toLowerCase()===dem.produit.trim().toLowerCase() && p.dept===dept);
  if (!prod) { showToast('Produit introuvable', 'err'); return; }

  const selectedIds = Array.from(document.querySelectorAll('.f-dem-attrib-chk:checked')).map(el => el.value);
  if (selectedIds.length !== dem.qty) {
    showToast(`Sélectionnez exactement ${dem.qty} matériel(s) (${selectedIds.length} sélectionné(s))`, 'err');
    return;
  }

  await withSubmitLock('#btn-submit-dem-attrib', async () => {
    try {
      // Re-vérification anti-conflit (un autre agent a pu sortir/prêter l'actif
      // entre l'ouverture du modal et la validation)
      await loadActifs();
      for (const aid of selectedIds) {
        const a = (ST.actifs || []).find(x => x.id === aid);
        if (!a || a.statut !== STATUS_ACTIF.EN_SERVICE) {
          showToast(`Le matériel ${aid} n'est plus disponible (statut : ${a?.statut || 'inconnu'})`, 'err');
          return;
        }
      }

      const tsNow = nowISO();
      const mvtRows = selectedIds.map(actifId => {
        const actif = ST.actifs.find(a => a.id === actifId);
        return {
          id: genId(dept === 'IT' ? 'MVT-IT' : 'MVT-FIN'),
          date: todayStr(),
          created_at: nowISO(),
          type: 'Sortie',
          produit_id: prod.id,
          produit_nom: prod.nom,
          actif_id: actifId,
          qty: 1,
          valeur: actif?.valeur_achat || 0,
          dept,
          user_name: ST.profile?.name || 'Système',
          user_id: ST.user?.id || null,
          destination: dem.dest || '',
          demande_id: dem.id,
          observation: `Attribution demande ${dem.id} — ${dem.demandeur}`,
        };
      });

      const { error: mErr } = await db.from('mouvements').insert(mvtRows);
      if (mErr) throw mErr;

      const { error: aErr } = await db.from('actifs_individuels').update({ statut: STATUS_ACTIF.SORTI }).in('id', selectedIds);
      if (aErr) throw aErr;

      const { error: sErr } = await db.from('produits').update({ stock: prod.stock - selectedIds.length, updated_at: tsNow }).eq('id', prod.id);
      if (sErr) throw sErr;

      const { error: dErr } = await db.from('demandes').update({ statut: 'Validé', valideur: ST.profile?.name || '', valideur_id: ST.user?.id, updated_at: nowISO() }).eq('id', demId);
      if (dErr) throw dErr;

      closeModal();
      showToast(`Demande validée — ${selectedIds.length} matériel(s) attribué(s)`);
      await Promise.all([loadDemandes(), loadProduits(), loadMouvements(), loadActifs()]);
      render();
    } catch (err) {
      showToast('Erreur : ' + err.message, 'err');
    }
  });
};
// ─── Sortie amortissable : rendu du sélecteur multi-actifs ────
// Seuls les actifs au statut STATUS_ACTIF.EN_SERVICE apparaissent (déjà sortis,
// en prêt, réformés ou hors service sont exclus explicitement — pas seulement
// filtrés, mais documentés ici pour que la règle soit visible dans le code).
function renderActifSortieSelector(prod, q='') {
  const tousLesActifsProduit = (ST.actifs || []).filter(a => a.produit_id === prod.id);
  const dispo = tousLesActifsProduit.filter(a => a.statut === STATUS_ACTIF.EN_SERVICE);
  const indispo = tousLesActifsProduit.filter(a => a.statut !== STATUS_ACTIF.EN_SERVICE);

  if (!dispo.length) {
    return `<div class="info-banner" style="background:#fef2f2;border-color:#fecaca;color:#dc2626">
      <i class="ti ti-alert-triangle"></i>
      <div>Aucun matériel « En service » disponible pour ce produit${indispo.length ? ` (${indispo.length} déjà sorti / en prêt / hors service)` : ''}.</div>
    </div>`;
  }

  const rows = dispo.map(a => `
    <tr>
      <td><input type="checkbox" class="f-actif-sortie-chk" value="${a.id}" onchange="updateActifSortieCount()"></td>
      <td><code class="actif-id">${a.id}</code></td>
      <td style="font-size:11px">${a.emplacement || '—'}</td>
      <td style="font-size:11px;font-family:var(--mono)">${fmt(a.valeur_achat)} MGA</td>
      <td style="font-size:11px">${fmtDate(a.date_entree)}</td>
      <td>${actifStatutBadge(a.statut)}</td>
    </tr>`).join('');

  return `
    <div class="form-row">
      <label class="form-lbl">Matériels à sortir <span class="req">*</span></label>
      <div style="max-height:220px;overflow-y:auto;overflow-x:auto;border:1.5px solid var(--border);border-radius:8px">
        <table style="width:100%">
          <thead><tr><th style="width:30px"></th><th>N° CNTO / Série</th><th>Emplacement</th><th>Valeur achat</th><th>Date entrée</th><th>État</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:6px;font-size:11.5px;color:var(--text2)">
        <strong id="f-actif-sortie-count">0</strong> matériel(s) sélectionné(s)
        ${indispo.length ? `<span style="color:var(--text3)"> · ${indispo.length} non disponible(s) (déjà sorti/en prêt/hors service)</span>` : ''}
      </div>
    </div>`;
}

window.updateActifSortieCount = () => {
  const n = document.querySelectorAll('.f-actif-sortie-chk:checked').length;
  const el = document.getElementById('f-actif-sortie-count');
  if (el) el.textContent = n;
};
// ═══ MODALES ═══
function renderModal() {
  document.getElementById('modal-el')?.remove();
  if (!ST.modal) return;
  const { type, dept } = ST.modal;
  const color    = dept==='IT'?'#4f46e5':'#10b981';
  // ← ÉTAPE B : exclure les produits inactifs des sélecteurs dans les modales
  const prods    = ST.produits.filter(p=>p.dept===dept && isActif(p));
  const cats     = dept==='IT'?ST.params.categoriesIT:ST.params.categoriesFin;
  const destOpts = ST.params.destinations.map(d=>`<option value="${d}">${d}</option>`).join('');
  const emplOpts = (ST.params.emplacements.length>0?ST.params.emplacements:['Stock Principal']).map(e=>`<option value="${e}">${e}</option>`).join('');
  let body='', title='';
  if (type==='mvt') {
    const iE=ST.modal.mvtType==='entree';
    title=iE?'↓ Enregistrer une Entrée':'↑ Enregistrer une Sortie';
    const prodOpts=prods.map(p=>`<option value="${p.id}" ${p.id===ST.modal.prodId?'selected':''}>${p.nom} (stock: ${p.stock}${p.emplacement?' — '+p.emplacement:''})</option>`).join('');
    body=`
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Département</label><input value="${dept}" disabled class="field-readonly" style="font-weight:700;color:${color}"></div>
        <div class="form-row"><label class="form-lbl">Type d'opération</label><input value="${iE?'Entrée':'Sortie'}" disabled class="field-readonly" style="font-weight:700;color:${iE?'#16a34a':'#dc2626'}"></div>
      </div>
      <div class="form-row"><label class="form-lbl">Produit <span class="req">*</span></label>
        <select id="f-prod" onchange="onMvtFieldChange()">
          <option value="">— Sélectionner un produit ${dept} actif —</option>${prodOpts}
        </select></div>
      <div id="f-qty-wrap" class="form-2col">
        <div class="form-row"><label class="form-lbl">Quantité <span class="req">*</span></label>
          <input id="f-qty" type="number" min="1" value="1" oninput="onMvtFieldChange()"></div>
        <div class="form-row">
          <label class="form-lbl">Prix unit. (MGA)${iE?'&nbsp;<span class="req">*</span>':''}</label>
          <input id="f-prix-unit" type="number" min="0" placeholder="0"
            ${!iE?'readonly class="field-readonly"':'oninput="this.dataset.userEdited=\'1\'"'}></div>
      </div>
      ${!iE ? `<div id="f-actif-sortie-wrap"></div>` : ''}
      <div class="form-row">
        <label class="form-lbl">Opération réalisée par</label>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 11px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:8px">
          <div style="width:28px;height:28px;border-radius:50%;background:${ST.profile?.color||'var(--teal)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">
            ${(ST.profile?.name||'?').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-size:12.5px;font-weight:700;color:var(--teal-d)">${ST.profile?.name||'—'}</div>
            <div style="font-size:10px;color:var(--text3)">${curRole()} · Session active</div>
          </div>
          <i class="ti ti-lock" style="margin-left:auto;color:var(--text3);font-size:14px" title="Auteur verrouillé sur le compte connecté"></i>
        </div>
      </div>
      ${iE
        ? `<div class="form-2col">
            <div class="form-row"><label class="form-lbl">Fournisseur</label>
              <select id="f-fournisseur">
                <option value="">— Sélectionner ou laisser vide —</option>
                ${(ST.params.fournisseurs||[]).map(f=>`<option value="${escQ(f)}">${f}</option>`).join('')}
              </select></div>
            <div class="form-row"><label class="form-lbl">Réf. / N° facture</label>
              <input id="f-ref-doc" placeholder="BL-2026-XXXX…"></div>
          </div>
          <div class="form-row"><label class="form-lbl">Emplacement</label>
            <select id="f-empl">${emplOpts}</select></div>
          <div id="f-serials-section" style="display:none">
            <div class="form-section-title">🔢 Numéros de série
              <span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:6px">(produit amortissable)</span>
            </div>
            <div class="info-banner" style="margin-bottom:8px;font-size:11.5px">
              <i class="ti ti-info-circle"></i>
              <div>Saisissez <strong id="f-serials-count">1</strong> numéro(s), un par ligne.
                Les suggestions peuvent être modifiées librement.</div>
            </div>
            <div class="form-row">
              <textarea id="f-serials" rows="3"
                placeholder="Un numéro par ligne…"
                oninput="this.dataset.userEdited='1'"
                style="font-family:var(--mono);font-size:11.5px;resize:vertical"></textarea>
            </div>
          </div>`
        : `<div class="form-row"><label class="form-lbl">Destination <span class="req">*</span></label><select id="f-dest"><option value="">— Sélectionner —</option>${destOpts}</select></div>`}
      <input type="hidden" id="f-dest" value="">
      <div class="form-row"><label class="form-lbl">Observation</label><input id="f-obs" placeholder="Précisions…"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        ${btn('Annuler','#94a3b8',true,'closeModal()')}
        <button id="btn-submit-mvt" class="btn btn-solid" style="background:${iE?'#10b981':'#ef4444'};border-color:${iE?'#10b981':'#ef4444'}" onclick="submitMvt('${iE?'Entrée':'Sortie'}')">${iE?'✓ Valider Entrée':'✓ Valider Sortie'}</button></div>`;
} else if (type==='add') {
    title='+ Nouveau Produit';
    body=`
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Département</label>
          <input value="${dept}" disabled class="field-readonly" style="font-weight:700;color:${color}"></div>
        <div class="form-row"><label class="form-lbl">Catégorie <span class="req">*</span></label>
          <select id="f-cat">${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
      </div>
      <div class="form-row"><label class="form-lbl">Nom du produit <span class="req">*</span></label>
        <input id="f-nom" placeholder="Ex: Laptop Dell XPS 15…"></div>
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Emplacement par défaut</label>
          <select id="f-add-empl">${emplOpts}</select></div>
        <div class="form-row"><label class="form-lbl">Seuil d'alerte critique</label>
          <input id="f-seuil" type="number" min="0" value="5"></div>
      </div>
      <div class="amort-toggle-row">
        <label class="form-lbl" style="cursor:pointer;display:flex;align-items:center;gap:8px;margin:0">
          <input type="checkbox" id="f-amort-chk" style="width:auto;accent-color:var(--teal);cursor:pointer">
          <span style="font-size:12px;color:#065f46;font-weight:600">Suivi individuel amortissable</span>
          <span style="font-size:10px;color:var(--text3);margin-left:2px">— génère une fiche CNTO-… à chaque entrée</span>
        </label>
      </div>
      <div class="info-banner" style="margin-top:12px;font-size:11.5px;background:#f0fdf4;border-color:#bbf7d0;color:#065f46">
        <i class="ti ti-info-circle" style="color:#10b981"></i>
        <div><strong>Stock initialisé à 0.</strong> Les prix et valeurs sont définis lors des <strong>entrées de stock</strong>. Les paramètres financiers (valeur d'achat, durée d'amortissement) se configurent via ✏ dans l'inventaire.</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        ${btn('Annuler','#94a3b8',true,'closeModal()')}
        ${btn('✓ Créer',color,false,'submitAdd()')}</div>`;
  } else if (type==='dem') {
    title=`📋 Nouvelle Demande — ${dept}`;
    // ← ÉTAPE B : seulement les produits actifs dans le datalist
    const deptProds=ST.produits.filter(p=>p.dept===dept && isActif(p));
    body=`
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Département</label><input value="${dept}" disabled class="field-readonly" style="font-weight:700;color:${color}"></div>
        <div class="form-row"><label class="form-lbl">Demandeur</label><input value="${ST.profile?.name||''}" readonly class="field-readonly"></div>
      </div>
      <div class="form-row"><label class="form-lbl">Produit demandé <span class="req">*</span></label>
        <input id="f-dem-prod" placeholder="Nom du produit ${dept}" list="prod-datalist-${dept}">
        <datalist id="prod-datalist-${dept}">${deptProds.map(p=>`<option value="${p.nom}">${p.nom} (stock: ${p.stock})</option>`).join('')}</datalist></div>
      <div class="form-3col">
        <div class="form-row"><label class="form-lbl">Quantité</label><input id="f-dem-qty" type="number" min="1" value="1"></div>
        <div class="form-row"><label class="form-lbl">Urgence</label><select id="f-dem-urgence"><option>Normale</option><option>Urgente</option><option>Critique</option></select></div>
        <div class="form-row"><label class="form-lbl">Destination <span class="req">*</span></label><select id="f-dem-dest"><option value="">— Sélectionner —</option>${destOpts}</select></div>
      </div>
      <div class="form-row"><label class="form-lbl">Motif <span class="req">*</span></label>
        <textarea id="f-dem-motif" rows="2" placeholder="Raison précise…" style="resize:vertical"></textarea></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        ${btn('Annuler','#94a3b8',true,'closeModal()')}
        ${btn('✓ Soumettre',color,false,`submitDem('${dept}')`)}</div>`;
  } else if (type==='edit') {
    const p=ST.modal.prod;
    title=`✏️ Modifier — ${p.nom}`;
    const selEmpl=e=>`<option value="${e}" ${e===(p.emplacement||'')?'selected':''}>${e}</option>`;
    const taux=tauxLineaire(p.duree_amortissement);
    body=`
      <div class="form-row"><label class="form-lbl">Produit</label><input value="${p.nom}" disabled class="field-readonly" style="font-weight:700"></div>
      <div class="form-3col">
        <div class="form-row"><label class="form-lbl">Seuil critique</label><input id="f-edit-seuil" type="number" min="0" value="${p.seuil||5}"></div>
        <div class="form-row"><label class="form-lbl">Prix unitaire (MGA)</label><input id="f-edit-prix" type="number" min="0" value="${p.prix||0}"></div>
        <div class="form-row"><label class="form-lbl">Emplacement</label><select id="f-edit-empl">${(ST.params.emplacements.length?ST.params.emplacements:['Stock Principal']).map(selEmpl).join('')}</select></div>
      </div>
      <div class="form-section-title">💰 Amortissement linéaire${taux?` — Taux : ${taux}%/an`:''}</div>
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Valeur d'achat (MGA)</label><input id="f-edit-valach" type="number" min="0" value="${p.valeur_achat||0}"></div>
        <div class="form-row"><label class="form-lbl">Date d'achat</label><input id="f-edit-dtach" type="date" value="${p.date_achat||''}"></div>
      </div>
      <div class="form-row"><label class="form-lbl">Durée d'amortissement</label>
        <select id="f-edit-duree">${[12,24,36,48,60,84].map(m=>`<option value="${m}" ${(p.duree_amortissement||36)===m?'selected':''}>${m} mois — taux: ${tauxLineaire(m)}%/an</option>`).join('')}</select></div>
      <div class="amort-toggle-row">
        <label class="form-lbl" style="cursor:pointer;display:flex;align-items:center;gap:8px;margin:0">
          <input type="checkbox" id="f-edit-amort-chk"
                 ${p.is_amortissable ? 'checked' : ''}
                 onchange="updateAmortissable('${p.id}', this.checked)"
                 style="width:auto;accent-color:var(--teal);cursor:pointer">
          <span style="font-size:12px;color:#065f46;font-weight:600">Suivi individuel amortissable</span>
          <span style="font-size:10px;color:var(--text3);margin-left:2px">— génère une fiche numérotée CNTO-… par unité à chaque entrée</span>
        </label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        ${btn('Annuler','#94a3b8',true,'closeModal()')}
        ${btn('✓ Enregistrer',color,false,'submitEdit()')}</div>`;
  }
  const ov=document.createElement('div');
  ov.id='modal-el'; ov.className='overlay';
  ov.innerHTML=`<div class="modal" onclick="event.stopPropagation()">
    <div class="modal-h"><span class="modal-ttl">${title}</span>
      <button class="close-btn" onclick="closeModal()">✕</button></div>
    ${body}</div>`;
  ov.addEventListener('click', closeModal);
  document.body.appendChild(ov);
  if (type==='mvt') {
    // Initialisation asynchrone si un produit est pré-sélectionné (ex: depuis alertes)
    if (ST.modal.prodId) setTimeout(() => onMvtFieldChange(), 120);
  }
}

window.openMvt     = (t,d,p) => { ST.modal={type:'mvt',mvtType:t,dept:d,prodId:p}; renderModal(); };
window.openAdd     = d       => { ST.modal={type:'add',dept:d}; renderModal(); };
window.openDemande = d       => { ST.modal={type:'dem',dept:d}; renderModal(); };
window.closeModal  = ()      => { ST.modal=null; document.getElementById('modal-el')?.remove(); };
// ─── Étape D+ : mise à jour dynamique du formulaire d'entrée ─
// Appelé sur onchange du produit et oninput de la quantité.
window.onMvtFieldChange = async () => {
  const sel     = document.getElementById('f-prod');
  const qtyInp  = document.getElementById('f-qty');
  const prodId  = sel?.value;
  const qty     = parseInt(qtyInp?.value) || 1;
  const prod    = ST.produits.find(x => x.id === prodId);
  const iE      = ST.modal?.mvtType === 'entree';
  const prixInp = document.getElementById('f-prix-unit');

  // Prix unitaire pré-rempli (modifiable pour entrée, readonly pour sortie)
  if (prixInp && prod && !prixInp.dataset.userEdited) {
    prixInp.value = prod.prix || 0;
  }

  // Section numéros de série : uniquement pour les entrées amortissables
  // FIX : l'ancien `if (!serlSec || !iE) return;` sortait de la fonction AVANT
  // d'atteindre le bloc "if (!iE) { ... f-actif-sortie-wrap ... }" plus bas.
  // Or f-serials-section n'existe jamais en Sortie (rendu uniquement si iE),
  // donc serlSec valait toujours null pour une Sortie → return systématique →
  // le sélecteur d'actifs n'était donc jamais rendu.
  const serlSec = document.getElementById('f-serials-section');
  if (serlSec && iE) {
    if (prod?.is_amortissable) {
      serlSec.style.display = '';
      const countEl = document.getElementById('f-serials-count');
      if (countEl) countEl.textContent = qty;

      const taEl = document.getElementById('f-serials');
      if (taEl && !taEl.dataset.userEdited) {
        // Cache du lastSeq pour éviter des requêtes répétées sur changement de qty
        if (window._mvtCachedProdId !== prodId) {
          try {
            const { data: sr } = await db.from('serial_sequences')
              .select('current_seq').eq('produit_id', prodId).maybeSingle();
            window._mvtLastSeq     = sr?.current_seq || 0;
            window._mvtCachedProdId = prodId;
          } catch(e) { window._mvtLastSeq = 0; }
        }
        const year = new Date().getFullYear();
        const suggestions = [];
        for (let i = 0; i < qty; i++) {
          // generateNomenclature est défini dans actifs.js (chargé après stock.js)
          suggestions.push(generateNomenclature(prodId, year, window._mvtLastSeq + i + 1));
        }
        taEl.value = suggestions.join('\n');
      } else if (document.getElementById('f-serials-count')) {
        document.getElementById('f-serials-count').textContent = qty;
      }
    } else {
      serlSec.style.display = 'none';
    }
  }
  if (!iE) {
    const wrap  = document.getElementById('f-actif-sortie-wrap');
    const qWrap = document.getElementById('f-qty-wrap');
    if (wrap && qWrap) {
      if (prod?.is_amortissable) {
        qWrap.style.display = 'none';
        document.getElementById('f-qty').value = 1; // valeur neutre, recalculée à la validation
        wrap.innerHTML = renderActifSortieSelector(prod);
      } else {
        qWrap.style.display = '';
        wrap.innerHTML = '';
      }
    }
  }
};
// ═══ TABLE PRODUITS ═══
function prodTable(prods, dept, color) {
  const il = ST.search.inline;
  const cats = [...new Set(prods.map(p=>p.categorie))].sort();
  const allFiltered = applyInlineFilters(prods, 'produit');
  const canM = dept==='IT'?canManIT():canManFin();
  const showP = canSeePrix();
  const q = (il.query||'').trim();

  const deptCats = dept === 'IT' ? ST.params.categoriesIT : ST.params.categoriesFin;
  const searchBar = buildContentSearchBar({
    showCat:   true, cats: deptCats,
    showStatut: true,
    showActif:  true,
    placeholder: `Rechercher dans l'inventaire ${dept}…`,
    count: prods.length, filteredCount: allFiltered.length,
  });

  // FIX (corrections finales — pt.1) : colonne VNC supprimée de l'Inventaire — un
  // même produit catalogue peut avoir été acheté à des prix différents au fil des
  // entrées successives, donc une VNC unique basée sur un seul valeur_achat/date_achat
  // "produit" n'a plus de sens ici. La VNC par actif individuel reste disponible et
  // pertinente dans l'onglet Actifs (actifs.js → renderActifs).
  const hdrs=['ID','Produit','Catégorie','Emplacement','Stock','Seuil'];
  if (showP) hdrs.push('Valeur Cumulée Entrées');
  hdrs.push('Statut');
  if (canM) hdrs.push('Actions');

const rows = allFiltered.map(p => {
  const pActif = isActif(p);
  const st = getStatus(p);
  const sc = st === 'Rupture' ? '#dc2626' : st === 'Critique' ? '#d97706' : 'var(--text)';

  let html = `<tr${pActif ? '' : ' class="row-inactif"'}>
    <td><code style="font-size:9px">${highlight(p.id, q)}</code></td>
    <td style="font-weight:600;font-size:12.5px">${highlight(p.nom, q)}${!pActif ? '<br><span style="font-size:9.5px;color:#94a3b8">Produit inactif</span>' : ''}</td>
    <td><span class="tag" style="color:#475569;background:#f1f5f9">${highlight(p.categorie, q)}</span></td>
    <td>${p.emplacement ? `<span class="tag" style="color:#1e40af;background:#dbeafe;font-size:9.5px">${highlight(p.emplacement, q)}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
    <td><span class="stock-num" style="color:${sc}">${p.stock}</span></td>
    <td style="color:var(--text3)">${p.seuil}</td>`;

  if (showP) {
    const vCumul = getValeurTotaleProduit(p.id);  // ← Étape D+
    html += `<td style="font-weight:700">${fmt(vCumul)} MGA</td>`;
  }

  // === COLONNE STATUT + ACTIF (corrigée) ===
  html += `<td style="min-width:120px">
    ${pActif ? statusTag(st) : '<span style="color:#94a3b8;font-size:11px">—</span>'}
    <br>${actifBadge(p)}
  </td>`;

  if (canM) {
    html += `<td><div style="display:flex;gap:4px;flex-wrap:wrap">
      ${pActif ? btn('+','var(--teal)',true,`openMvt('entree','${dept}','${p.id}')`,'ti-plus') : ''}
      ${pActif ? btn('−','#ef4444',true,`openMvt('sortie','${dept}','${p.id}')`,'ti-minus') : ''}
      ${btn('✏','#64748b',true,`openEditProduct('${p.id}')`)}
      <button class="actif-toggle ${pActif ? 'on' : 'off'}" onclick="toggleProductActif('${p.id}',${pActif})" title="${pActif ? 'Désactiver' : 'Réactiver'} ce produit">
        ${pActif ? '● Actif' : '○ Inactif'}
      </button>
      ${isAdmin() ? btn('🗑','#dc2626',true,`deleteProduct('${p.id}','${dept}','${p.nom.replace(/'/g,"\\'")}')`) : ''}
    </div></td>`;
  }

  html += `</tr>`;
  return html;
}).join('');

  const emptyRow = !allFiltered.length ? `<tr class="no-result-row"><td colspan="${hdrs.length}">
    <div class="nri">🔍</div>
    <div class="nrt">Aucun produit ne correspond à votre recherche</div>
    <div style="font-size:11px;margin-top:4px">Essayez un autre terme ou <a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">réinitialisez les filtres</a></div>
  </td></tr>` : '';

  // ← ÉTAPE B : compteurs actifs/inactifs dans le résumé
  const nbActif   = prods.filter(p=>isActif(p)).length;
  const nbInactif = prods.length - nbActif;
  const headerInfo = showP
    ? `${allFiltered.length} référence(s) · Valeur cumulée: ${fmt(allFiltered.filter(p=>isActif(p)).reduce((s,p)=>s+getValeurTotaleProduit(p.id),0))} MGA${nbInactif>0?` · <span style="color:#94a3b8;font-weight:400">${nbInactif} inactif${nbInactif>1?'s':''}</span>`:''}`
    : `${allFiltered.length} référence(s)${nbInactif>0?` · <span style="color:#94a3b8;font-weight:400">${nbInactif} inactif${nbInactif>1?'s':''}</span>`:''}`;

  return `${searchBar}<div class="card">
    <div class="card-hd">
      <span class="card-ttl">${headerInfo}</span>
      <div class="btn-row">
        ${btn('↓ CSV','#10b981',true,`exportProduitsCSV('${dept}')`,'ti-download')}
        ${canM ? btn('+ Produit',color,false,`openAdd('${dept}')`,'ti-plus') : ''}
      </div>
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr>${hdrs.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows||emptyRow}</tbody>
    </table></div></div>`;
}

// ═══ RENDER PAGES STOCK ═══
function renderStockIT() {
  const allIT = ST.produits.filter(p => p.dept === 'IT');
  const v = allIT.filter(p => isActif(p)).reduce((s, p) => s + getValeurTotaleProduit(p.id), 0);
  const totalRefs = allIT.length;
  const inactifs = allIT.filter(p => !isActif(p)).length;

  return `<p class="page-title">Inventaire IT</p>
    <p class="page-sub">${canSeePrix() ? `Valeur totale (actifs) : ${fmt(v)} MGA · ` : ''}${totalRefs} référence${totalRefs>1?'s':''}${inactifs ? ` <span style="color:#94a3b8">(${inactifs} inactif${inactifs>1?'s':''})</span>` : ''}</p>
    ${prodTable(allIT, 'IT', '#4f46e5')}`;
}

function renderStockFin() {
  const allFin = ST.produits.filter(p => p.dept === 'Finance');
  const v = allFin.filter(p => isActif(p)).reduce((s, p) => s + getValeurTotaleProduit(p.id), 0);
  const totalRefs = allFin.length;
  const inactifs = allFin.filter(p => !isActif(p)).length;

  return `<p class="page-title">Inventaire Finance</p>
    <p class="page-sub">${canSeePrix() ? `Valeur totale (actifs) : ${fmt(v)} MGA · ` : ''}${totalRefs} référence${totalRefs>1?'s':''}${inactifs ? ` <span style="color:#94a3b8">(${inactifs} inactif${inactifs>1?'s':''})</span>` : ''}</p>
    ${prodTable(allFin, 'Finance', '#10b981')}`;
}

function renderMvt(dept) {
  const il = ST.search.inline;
  const q = (il.query||'').trim();
  const allMvt=dept==='IT'?fMvtIT():fMvtFin();
  const mvt = applyInlineFilters(allMvt, 'mouvement');
  const color=dept==='IT'?'#4f46e5':'#10b981';
  const totE=mvt.filter(m=>m.type==='Entrée').reduce((s,m)=>s+m.qty,0);
  const totS=mvt.filter(m=>m.type==='Sortie').reduce((s,m)=>s+m.qty,0);
  const searchBar = buildContentSearchBar({
    showType: true,
    placeholder: `Rechercher dans les mouvements ${dept} (produit, agent, destination, fournisseur, réf.)…`,
    count: allMvt.length, filteredCount: mvt.length,
  });
  const rows=mvt.map(m=>`<tr>
    <td><code style="font-size:9px">${highlight(m.id,q)}</code></td>
    <td>${fmtDTSplit(m.created_at||m.date)}</td>
    <td>${typeBadge(m.type)}</td>
    <td style="font-weight:500">
      ${highlight(m.produit_nom,q)}
      ${m.actif_id ? `<br><code class="actif-id" style="margin-top:2px;display:inline-block">${highlight(m.actif_id,q)}</code>` : ''}
    </td>
    <td style="font-weight:700">${m.qty}</td>
    <td style="font-size:11px;color:var(--text2)">${m.qty>0?fmt(Math.round((m.valeur||0)/m.qty)):0} MGA</td>
    <td style="font-weight:700">${fmt(m.valeur)} MGA</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(m.emplacement||'—',q)}</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(m.destination||'—',q)}</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(m.fournisseur||'—',q)}</td>
    <td style="font-size:11px;color:var(--text3)">${highlight(m.ref_document||'—',q)}</td>
    <td style="font-size:11px;color:var(--text3)">${highlight(m.user_name,q)}</td>
    <td style="font-size:11px;color:var(--text3);max-width:100px">${m.observation||''}</td>
  </tr>`).join('');
  const emptyRow = !mvt.length ? `<tr class="no-result-row"><td colspan="13"><div class="nri">🔍</div><div class="nrt">Aucun mouvement ne correspond</div><div style="font-size:11px;margin-top:4px"><a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a></div></td></tr>` : '';
  return `<p class="page-title">Mouvements ${dept}</p>
    <p class="page-sub">${mvt.length} / ${allMvt.length} mouvement(s) · ↓ ${totE} entrée · ↑ ${totS} sortie</p>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV','#10b981',true,`exportMouvementsCSV('${dept}')`,'ti-download')}
      ${btn(`↓ Entrée`,color,false,`openMvt('entree','${dept}',null)`,'ti-arrow-down-circle')}
      ${btn(`↑ Sortie`,'#ef4444',false,`openMvt('sortie','${dept}',null)`,'ti-arrow-up-circle')}
    </div>
    ${searchBar}
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['ID','Date & Heure','Type','Produit','Qté','Prix Unit.','Valeur Totale','Emplacement','Destination','Fournisseur','Réf. Doc.','Agent','Observation'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows||emptyRow}</tbody>
    </table></div></div>`;
}

function renderDem(dept) {
  const il = ST.search.inline;
  const q = (il.query||'').trim();
  const allDem=dept==='IT'?fDemIT():fDemFin();
  const dem = applyInlineFilters(allDem, 'demande');
  const color=dept==='IT'?'#4f46e5':'#10b981';
  const canM=dept==='IT'?canValidIT():canValidFin();
  const searchBar = buildContentSearchBar({
    showUrgence: true, showStatDem: true,
    placeholder: `Rechercher dans les demandes ${dept} (produit, demandeur, motif, destination…)…`,
    count: allDem.length, filteredCount: dem.length,
  });
  const rows=dem.map(d=>{
    // ← ÉTAPE B : vérifier si le produit est inactif pour alerter le manager
    const prodRef = ST.produits.find(p=>p.nom.trim().toLowerCase()===d.produit.trim().toLowerCase()&&p.dept===dept);
    const prodInactif = prodRef && !isActif(prodRef);
    // Actifs individuels attribués à cette demande (produit amortissable, déjà validée)
    // Réutilise les mouvements existants (demande_id + actif_id déjà écrits par
    // submitDemAttribution) — aucune nouvelle donnée, aucun nouveau calcul métier.
    const actifsAttribues = (ST.mouvements||[]).filter(m=>m.demande_id===d.id && m.actif_id).map(m=>m.actif_id);
    const acts=d.statut==='En attente'&&canM
      ? prodInactif
        ? `<span class="readonly-badge" style="color:#f59e0b;border-color:#fcd34d" title="Produit désactivé — réactivez-le d'abord"><i class="ti ti-alert-triangle"></i> Produit inactif</span>`
        : `<div data-dem-id="${d.id}" style="display:flex;gap:4px">
            ${btn('✓ Valider','#10b981',false,`validDem('${dept}','${d.id}','Validé')`)}
            ${btn('✕','#ef4444',true,`validDem('${dept}','${d.id}','Refusé')`)}
          </div>`
      : (d.statut==='En attente'?`<span class="readonly-badge"><i class="ti ti-clock"></i> En cours</span>`:'');
    return `<tr${prodInactif&&d.statut==='En attente'?' style="background:#fffbeb"':''}>
      <td><code style="font-size:9px">${highlight(d.id,q)}</code></td>
      <td>${fmtDTSplit(d.created_at||d.date)}</td>
      <td style="font-weight:500;font-size:12.5px">${highlight(d.demandeur,q)}</td>
      <td style="font-weight:500">${highlight(d.produit,q)}${prodInactif?'<br><span style="font-size:9px;color:#f59e0b">produit inactif</span>':''}${actifsAttribues.length?`<br>${actifsAttribues.map(aid=>`<code class="actif-id" style="margin-top:2px;display:inline-block">${highlight(aid,q)}</code>`).join(' ')}`:''}</td>
      <td style="font-weight:700">${d.qty}</td>
      <td>${urgBadge(d.urgence)}</td>
      <td style="font-size:11px;color:var(--text2)">${highlight(d.dest||'—',q)}</td>
      <td style="font-size:11px;color:var(--text3);max-width:120px">${highlight(d.motif||'',q).slice(0,60)}</td>
      <td>${statBadge(d.statut)}</td>
      <td>${fmtDTSplit(d.updated_at)}</td>
      <td style="font-size:10.5px;color:var(--text3)">${d.valideur||'—'}</td>
      <td>${acts}</td>
    </tr>`;
  }).join('');
  const emptyRow = !dem.length ? `<tr class="no-result-row"><td colspan="12"><div class="nri">🔍</div><div class="nrt">Aucune demande ne correspond</div><div style="font-size:11px;margin-top:4px"><a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a></div></td></tr>` : '';
  return `<p class="page-title">Demandes ${dept}</p>
    <p class="page-sub">${dem.filter(d=>d.statut==='En attente').length} en attente · ${dem.length} / ${allDem.length} total</p>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV','#10b981',true,`exportDemandesCSV('${dept}')`,'ti-download')}
      ${btn('+ Nouvelle demande',color,false,`openDemande('${dept}')`,'ti-plus')}
    </div>
    ${searchBar}
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['ID','Date & Heure','Demandeur','Produit','Qté','Urgence','Destination','Motif','Statut','Mis à jour','Validé par','Actions'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows||emptyRow}</tbody>
    </table></div></div>`;
}

function renderAlertes(dept) {
  // ← ÉTAPE B : alertsIT/alertsFin filtrent déjà les inactifs (cf. utils.js)
  const al=(dept==='IT'?alertsIT():alertsFin()).sort((a,b)=>a.stock-b.stock);
  const color=dept==='IT'?'#4f46e5':'#10b981';
  if (!al.length) return `<p class="page-title">Alertes ${dept}</p>
    <div class="card"><div class="empty-state"><div class="empty-ico">✅</div><div style="font-size:14px;font-weight:700;color:var(--text)">Aucune alerte active</div><div style="margin-top:4px;font-size:12px">Tous les stocks actifs sont au-dessus de leurs seuils critiques</div></div></div>`;
  const rows=al.map(p=>`<tr>
    <td><span style="font-size:18px">${p.stock===0?'🔴':'🟠'}</span></td>
    <td><div style="font-weight:600">${p.nom}</div></td>
    <td><span class="tag" style="color:#475569;background:#f1f5f9">${p.categorie}</span></td>
    <td><span class="tag" style="color:#1e40af;background:#dbeafe">${p.emplacement||'—'}</span></td>
    <td><span class="stock-num" style="color:${p.stock===0?'#dc2626':'#d97706'}">${p.stock}</span></td>
    <td style="color:var(--text3)">${p.seuil}</td>
    <td>${statusTag(getStatus(p))}</td>
    <td>${fmtDate(p.updated_at)}</td>
    <td>${btn('Réapprovisionner',color,false,`openMvt('entree','${dept}','${p.id}')`,'ti-package')}</td>
  </tr>`).join('');
  return `<p class="page-title">Alertes ${dept}</p>
    <p class="page-sub">${al.length} produit(s) actif(s) nécessitant un réapprovisionnement urgent</p>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV','#10b981',true,`exportAlertesCSV('${dept}')`,'ti-download')}
    </div>
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['Priorité','Produit','Catégorie','Emplacement','Stock actuel','Seuil','Statut','Dernière MAJ','Action'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
}

function renderHistorique() {
  const il = ST.search.inline;
  const q = (il.query||'').trim();
  const allItems=[
    ...fMvtIT().map(m=>({...m,src:'Mouvement',label:m.type,actor:m.user_name,detail:m.observation,produit:m.produit_nom,dest:m.destination,dept:'IT',actifId:m.actif_id||null})),
    ...fMvtFin().map(m=>({...m,src:'Mouvement',label:m.type,actor:m.user_name,detail:m.observation,produit:m.produit_nom,dest:m.destination,dept:'Finance',actifId:m.actif_id||null})),
    ...fDemIT().map(d=>({...d,src:'Demande',label:d.statut,actor:d.demandeur,detail:d.motif,dest:d.dest,dept:'IT'})),
    ...fDemFin().map(d=>({...d,src:'Demande',label:d.statut,actor:d.demandeur,detail:d.motif,dest:d.dest,dept:'Finance'})),
  ].filter(h=>canSeeIT()||h.dept!=='IT').filter(h=>canSeeFin()||h.dept!=='Finance')
   .sort((a,b)=>new Date(b.created_at||b.date)-new Date(a.created_at||a.date));
  const filtered = allItems.filter(h => {
    if (!q) return true;
    return matchesQuery([h.produit, h.produit_nom, h.actor, h.detail, h.dest, h.id, h.actifId], q);
  });
  const searchBar = buildContentSearchBar({
    placeholder: "Rechercher dans l'historique (produit, acteur, détail…)…",
    count: allItems.length, filteredCount: filtered.length,
  });
  const rows=filtered.map(h=>`<tr>
    <td>${fmtDTSplit(h.created_at||h.date)}</td>
    <td>${deptTag(h.dept)}</td>
    <td><span class="tag" style="color:${h.src==='Mouvement'?'#1d4ed8':'#7c3aed'};background:${h.src==='Mouvement'?'#dbeafe':'#ede9fe'}">${h.src}</span></td>
    <td>${h.src==='Mouvement'?typeBadge(h.label):statBadge(h.label)}</td>
    <td style="font-weight:500">
      ${highlight(h.produit||h.produit_nom||'',q)}
      ${h.actifId ? `<br><code class="actif-id" style="margin-top:2px;display:inline-block">${highlight(h.actifId,q)}</code>` : ''}
    </td>
    <td style="font-weight:700">${h.qty}</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(h.emplacement||h.dest||'—',q)}</td>
    <td style="font-size:11px;color:var(--text3)">${highlight(h.actor,q)}</td>
    <td style="font-size:11px;color:var(--text3);max-width:120px">${highlight(h.detail||'',q).slice(0,60)}</td>
  </tr>`).join('');
  const emptyRow = !filtered.length ? `<tr class="no-result-row"><td colspan="9"><div class="nri">🔍</div><div class="nrt">Aucun résultat pour "${q}"</div><div style="font-size:11px;margin-top:4px"><a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser</a></div></td></tr>` : '';
  return `<p class="page-title">Historique Complet</p>
    <p class="page-sub">${filtered.length} / ${allItems.length} opération(s)</p>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV','#10b981',true,'exportHistoriqueCSV()','ti-download')}
    </div>
    ${searchBar}
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['Date & Heure','Dépt','Catégorie','Type/Statut','Produit','Qté','Empl./Dest.','Acteur','Détail'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows||emptyRow}</tbody>
    </table></div></div>`;
}