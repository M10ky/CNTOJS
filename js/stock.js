'use strict';

// ═══ CHARGEMENT DONNÉES ═══
async function loadAllData() {
  await Promise.all([
    loadProduits(), loadMouvements(), loadDemandes(), loadParams(),
    isAdmin() ? loadAllProfiles() : Promise.resolve(),
  ]);
}

async function loadProduits() {
  const { data, error } = await db.from('produits').select('*').order('nom');
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
  };
}

async function loadAllProfiles() {
  const { data, error } = await db.from('profiles').select('*').order('name');
  if (error) { console.error(error); return; }
  ST.allProfiles = data||[];
}

// ═══ CRUD MOUVEMENTS ═══
window.submitMvt = async (typeStr) => {
  const dept=ST.modal.dept;
  if (dept==='IT'&&!canManIT()||dept==='Finance'&&!canManFin()) { showToast('Action non autorisée','err'); return; }
  const prodId = document.getElementById('f-prod')?.value;
  const qty    = parseInt(document.getElementById('f-qty')?.value)||0;
  const user   = document.getElementById('f-user')?.value || ST.profile?.name || 'Système';
  const dest   = document.getElementById('f-dest')?.value || '';
  const empl   = document.getElementById('f-empl')?.value || '';
  const obs    = document.getElementById('f-obs')?.value  || '';
  const refDoc = document.getElementById('f-ref-doc')?.value || '';
  const fournisseur = document.getElementById('f-fournisseur')?.value || '';
  if (!prodId) { showToast('Sélectionnez un produit','err'); return; }
  if (qty<=0)  { showToast('Quantité invalide','err'); return; }
  const prod = ST.produits.find(p=>p.id===prodId);
  if (!prod) { showToast('Produit introuvable','err'); return; }
  if (typeStr==='Sortie'&&prod.stock<qty) { showToast(`Stock insuffisant (${prod.stock} disponible)`,'err'); return; }
  if (typeStr==='Sortie'&&!dest) { showToast('Veuillez indiquer la destination','err'); return; }
  const newStock = typeStr==='Entrée' ? prod.stock+qty : prod.stock-qty;
  const mvtId   = genId(dept==='IT'?'MVT-IT':'MVT-FIN');
  const tsNow   = nowISO();
  try {
    const updateData = { stock:newStock, updated_at:tsNow };
    if (typeStr==='Entrée' && empl) updateData.emplacement = empl;
    const { error:sErr } = await db.from('produits').update(updateData).eq('id',prodId);
    if (sErr) throw sErr;
    const { error:mErr } = await db.from('mouvements').insert({
      id:mvtId, date:todayStr(), created_at:tsNow, type:typeStr,
      produit_id:prodId, produit_nom:prod.nom, qty, valeur:qty*prod.prix, dept,
      user_name:user, user_id:ST.user?.id, destination:dest, emplacement:empl,
      ref_document:refDoc, fournisseur,
    });
    if (mErr) throw mErr;
    closeModal();
    showToast(`${typeStr} enregistrée — ${qty}× ${prod.nom}`);
    await loadProduits(); await loadMouvements(); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

// ═══ CRUD PRODUITS ═══
window.submitAdd = async () => {
  const dept=ST.modal.dept;
  if (dept==='IT'&&!canManIT()||dept==='Finance'&&!canManFin()) { showToast('Action non autorisée','err'); return; }
  const nom   = document.getElementById('f-nom')?.value?.trim();
  const cat   = document.getElementById('f-cat')?.value;
  const stock = parseInt(document.getElementById('f-stock')?.value)||0;
  const seuil = parseInt(document.getElementById('f-seuil')?.value)||5;
  const prix  = parseInt(document.getElementById('f-prix')?.value)||0;
  const empl  = document.getElementById('f-add-empl')?.value || (ST.params.emplacements[0]||'Stock Principal');
  const valAch= parseInt(document.getElementById('f-val-achat')?.value)||0;
  const dtAch = document.getElementById('f-date-achat')?.value || null;
  const duree = parseInt(document.getElementById('f-duree-amort')?.value)||36;
  if (!nom||!cat) { showToast('Nom et catégorie requis','err'); return; }
  const id=genId(dept==='IT'?'IT':'FIN');
  try {
    const { error } = await db.from('produits').insert({ id, nom, categorie:cat, dept, stock, seuil, prix, emplacement:empl, valeur_achat:valAch, date_achat:dtAch, duree_amortissement:duree });
    if (error) throw error;
    closeModal(); showToast(`"${nom}" ajouté avec succès`);
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
    if (prod.stock < dem.qty) { showToast(`Stock insuffisant : ${prod.stock} disponible, ${dem.qty} demandé`,'err'); return; }
    try {
      const tsNow=nowISO();
      const { error:sErr } = await db.from('produits').update({stock:prod.stock-dem.qty,updated_at:tsNow}).eq('id',prod.id);
      if (sErr) throw sErr;
      const mvtId=genId(dept==='IT'?'MVT-IT':'MVT-FIN');
      const { error:mErr } = await db.from('mouvements').insert({ id:mvtId, date:todayStr(), created_at:tsNow, type:'Sortie', produit_id:prod.id, produit_nom:prod.nom, qty:dem.qty, valeur:dem.qty*prod.prix, dept, user_name:ST.profile?.name||'Système', user_id:ST.user?.id, destination:dem.dest||'', observation:`Validation demande ${id} — ${dem.demandeur}` });
      if (mErr) throw mErr;
    } catch(err) { showToast('Erreur: '+err.message,'err'); return; }
  }
  try {
    const { error } = await db.from('demandes').update({ statut:action, valideur:ST.profile?.name||'', valideur_id:ST.user?.id, updated_at:nowISO() }).eq('id',id);
    if (error) throw error;
    showToast(action==='Validé'?'Demande validée — stock mis à jour':'Demande refusée');
    await Promise.all([loadDemandes(),loadProduits(),loadMouvements()]); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

// ═══ MODALES ═══
function renderModal() {
  document.getElementById('modal-el')?.remove();
  if (!ST.modal) return;
  const { type, dept } = ST.modal;
  const color    = dept==='IT'?'#4f46e5':'#10b981';
  const prods    = ST.produits.filter(p=>p.dept===dept);
  const cats     = dept==='IT'?ST.params.categoriesIT:ST.params.categoriesFin;
  const destOpts = ST.params.destinations.map(d=>`<option value="${d}">${d}</option>`).join('');
  const emplOpts = (ST.params.emplacements.length>0?ST.params.emplacements:['Stock Principal']).map(e=>`<option value="${e}">${e}</option>`).join('');
  let body='', title='';
  if (type==='mvt') {
    const iE=ST.modal.mvtType==='entree';
    title=iE?'↓ Enregistrer une Entrée':'↑ Enregistrer une Sortie';
    const prodOpts=prods.map(p=>`<option value="${p.id}" ${p.id===ST.modal.prodId?'selected':''}>${p.nom} (stock: ${p.stock}${p.emplacement?' — '+p.emplacement:''})</option>`).join('');
    const myDeptUsers=ST.allProfiles.length>0
      ? ST.allProfiles.filter(u=>u.dept===dept||u.dept==='both'||u.role==='Administrateur').map(u=>`<option value="${u.name}" ${u.name===ST.profile?.name?'selected':''}>${u.name} (${u.role})</option>`).join('')
      : `<option value="${ST.profile?.name||''}" selected>${ST.profile?.name||''} (${curRole()})</option>`;
    body=`
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Département</label><input value="${dept}" disabled class="field-readonly" style="font-weight:700;color:${color}"></div>
        <div class="form-row"><label class="form-lbl">Type d'opération</label><input value="${iE?'Entrée':'Sortie'}" disabled class="field-readonly" style="font-weight:700;color:${iE?'#16a34a':'#dc2626'}"></div>
      </div>
      <div class="form-row"><label class="form-lbl">Produit <span class="req">*</span></label>
        <select id="f-prod"><option value="">— Sélectionner un produit ${dept} —</option>${prodOpts}</select></div>
      <div class="form-3col">
        <div class="form-row"><label class="form-lbl">Quantité <span class="req">*</span></label><input id="f-qty" type="number" min="1" value="1"></div>
        <div class="form-row"><label class="form-lbl">Prix unit. (MGA)</label><input id="f-prix-unit" type="number" min="0" placeholder="Auto" readonly class="field-readonly"></div>
        <div class="form-row"><label class="form-lbl">Agent <span class="req">*</span></label><select id="f-user">${myDeptUsers}</select></div>
      </div>
      ${iE
        ? `<div class="form-2col">
            <div class="form-row"><label class="form-lbl">Fournisseur</label><input id="f-fournisseur" placeholder="Nom du fournisseur…"></div>
            <div class="form-row"><label class="form-lbl">Réf. document</label><input id="f-ref-doc" placeholder="BL-2026-XXXX…"></div>
          </div>
          <div class="form-row"><label class="form-lbl">Emplacement</label><select id="f-empl">${emplOpts}</select></div>`
        : `<div class="form-row"><label class="form-lbl">Destination <span class="req">*</span></label><select id="f-dest"><option value="">— Sélectionner —</option>${destOpts}</select></div>`}
      <input type="hidden" id="f-dest" value="">
      <div class="form-row"><label class="form-lbl">Observation</label><input id="f-obs" placeholder="Précisions…"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        ${btn('Annuler','#94a3b8',true,'closeModal()')}
        ${btn(iE?'✓ Valider Entrée':'✓ Valider Sortie',iE?'#10b981':'#ef4444',false,`submitMvt('${iE?'Entrée':'Sortie'}')`)}</div>`;
  } else if (type==='add') {
    title='+ Nouveau Produit';
    body=`
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Département</label><input value="${dept}" disabled class="field-readonly" style="font-weight:700;color:${color}"></div>
        <div class="form-row"><label class="form-lbl">Catégorie <span class="req">*</span></label><select id="f-cat">${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
      </div>
      <div class="form-row"><label class="form-lbl">Nom du produit <span class="req">*</span></label><input id="f-nom" placeholder="Ex: Laptop Dell XPS 15…"></div>
      <div class="form-row"><label class="form-lbl">Emplacement</label><select id="f-add-empl">${emplOpts}</select></div>
      <div class="form-3col">
        <div class="form-row"><label class="form-lbl">Stock initial</label><input id="f-stock" type="number" min="0" value="0"></div>
        <div class="form-row"><label class="form-lbl">Seuil critique</label><input id="f-seuil" type="number" min="0" value="5"></div>
        <div class="form-row"><label class="form-lbl">Prix unitaire (MGA)</label><input id="f-prix" type="number" min="0" placeholder="0"></div>
      </div>
      <div class="form-section-title">💰 Amortissement linéaire (optionnel)</div>
      <div class="form-2col">
        <div class="form-row"><label class="form-lbl">Valeur d'achat (MGA)</label><input id="f-val-achat" type="number" min="0" placeholder="0"></div>
        <div class="form-row"><label class="form-lbl">Date d'achat</label><input id="f-date-achat" type="date"></div>
      </div>
      <div class="form-row"><label class="form-lbl">Durée d'amortissement</label>
        <select id="f-duree-amort">
          <option value="12">12 mois — 1 an</option><option value="24">24 mois — 2 ans</option>
          <option value="36" selected>36 mois — 3 ans</option><option value="48">48 mois — 4 ans</option>
          <option value="60">60 mois — 5 ans</option><option value="84">84 mois — 7 ans</option>
        </select></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        ${btn('Annuler','#94a3b8',true,'closeModal()')}
        ${btn('✓ Créer',color,false,'submitAdd()')}</div>`;
  } else if (type==='dem') {
    title=`📋 Nouvelle Demande — ${dept}`;
    const deptProds=ST.produits.filter(p=>p.dept===dept);
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
    const sel=document.getElementById('f-prod');
    const prixInp=document.getElementById('f-prix-unit');
    if (sel&&prixInp) {
      sel.addEventListener('change',()=>{ const p=ST.produits.find(x=>x.id===sel.value); if(p) prixInp.value=p.prix; else prixInp.value=''; });
      if (ST.modal.prodId) { const p=ST.produits.find(x=>x.id===ST.modal.prodId); if(p) prixInp.value=p.prix; }
    }
  }
}

window.openMvt     = (t,d,p) => { ST.modal={type:'mvt',mvtType:t,dept:d,prodId:p}; renderModal(); };
window.openAdd     = d       => { ST.modal={type:'add',dept:d}; renderModal(); };
window.openDemande = d       => { ST.modal={type:'dem',dept:d}; renderModal(); };
window.closeModal  = ()      => { ST.modal=null; document.getElementById('modal-el')?.remove(); };

// ═══ TABLE PRODUITS ═══
function prodTable(prods, dept, color) {
  const il = ST.search.inline;
  const cats = [...new Set(prods.map(p=>p.categorie))].sort();
  const allFiltered = applyInlineFilters(prods, 'produit');
  const canM = dept==='IT'?canManIT():canManFin();
  const showP = canSeePrix();
  const q = (il.query||'').trim();

  const searchBar = buildContentSearchBar({
    showCat: true, cats, showStatut: true,
    placeholder: `Rechercher dans l'inventaire ${dept}…`,
    count: prods.length, filteredCount: allFiltered.length,
  });

  const hdrs=['ID','Produit','Catégorie','Emplacement','Stock','Seuil'];
  if (showP) hdrs.push('Prix Unit.','Valeur Stock','VNC');
  hdrs.push('Statut');
  if (canM) hdrs.push('Actions');

  const rows=allFiltered.map(p=>{
    const st=getStatus(p);
    const sc=st==='Rupture'?'#dc2626':st==='Critique'?'#d97706':'var(--text)';
    const vnc=calcVNC(p);
    const pct=amortPct(p);
    const vncCell=vnc!==null
      ? `<div style="font-weight:700;font-size:12px">${fmt(vnc)} MGA</div><div class="amort-bar"><div class="amort-fill" style="width:${pct}%;background:${amortColor(pct)}"></div></div><div style="font-size:9px;color:${amortColor(pct)};margin-top:1px">${pct}% amorti</div>`
      : '<span style="color:var(--text3);font-size:11px">Non configuré</span>';
    let html=`<tr>
      <td><code style="font-size:9px">${highlight(p.id,q)}</code></td>
      <td style="font-weight:600;font-size:12.5px">${highlight(p.nom,q)}</td>
      <td><span class="tag" style="color:#475569;background:#f1f5f9">${highlight(p.categorie,q)}</span></td>
      <td>${p.emplacement?`<span class="tag" style="color:#1e40af;background:#dbeafe;font-size:9.5px">${highlight(p.emplacement,q)}</span>`:'<span style="color:var(--text3)">—</span>'}</td>
      <td><span class="stock-num" style="color:${sc}">${p.stock}</span></td>
      <td style="color:var(--text3)">${p.seuil}</td>`;
    if (showP) html+=`<td style="color:var(--text2)">${fmt(p.prix)} MGA</td><td style="font-weight:700">${fmt(p.stock*p.prix)} MGA</td><td>${vncCell}</td>`;
    html+=`<td>${statusTag(st)}</td>`;
    if (canM) {
      html+=`<td><div style="display:flex;gap:3px;flex-wrap:wrap">
        ${btn('+','var(--teal)',true,`openMvt('entree','${dept}','${p.id}')`,'ti-plus')}
        ${btn('−','#ef4444',true,`openMvt('sortie','${dept}','${p.id}')`,'ti-minus')}
        ${btn('✏','#64748b',true,`openEditProduct('${p.id}')`)}
        ${isAdmin()?btn('🗑','#dc2626',true,`deleteProduct('${p.id}','${dept}','${p.nom.replace(/'/g,"\\'")}')`):''}
      </div></td>`;
    }
    html+=`</tr>`;
    return html;
  }).join('');

  const emptyRow = !allFiltered.length ? `<tr class="no-result-row"><td colspan="${hdrs.length}">
    <div class="nri">🔍</div>
    <div class="nrt">Aucun produit ne correspond à votre recherche</div>
    <div style="font-size:11px;margin-top:4px">Essayez un autre terme ou <a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">réinitialisez les filtres</a></div>
  </td></tr>` : '';

  const headerInfo = showP
    ? `${allFiltered.length} référence(s) · Valeur: ${fmt(allFiltered.reduce((s,p)=>s+p.stock*p.prix,0))} MGA`
    : `${allFiltered.length} référence(s)`;

  return `${searchBar}<div class="card">
    <div class="card-hd">
      <span class="card-ttl">${headerInfo}</span>
      ${canM ? `<div class="btn-row">${btn('+ Produit',color,false,`openAdd('${dept}')`,'ti-plus')}</div>` : ''}
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr>${hdrs.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows||emptyRow}</tbody>
    </table></div></div>`;
}

// ═══ RENDER PAGES STOCK ═══
function renderStockIT() {
  const v=ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+p.stock*p.prix,0);
  return `<p class="page-title">Inventaire IT</p>
    <p class="page-sub">${canSeePrix()?`Valeur totale: ${fmt(v)} MGA · `:''}${ST.produits.filter(p=>p.dept==='IT').length} références</p>
    ${prodTable(ST.produits.filter(p=>p.dept==='IT'),'IT','#4f46e5')}`;
}

function renderStockFin() {
  const v=ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+p.stock*p.prix,0);
  return `<p class="page-title">Inventaire Finance</p>
    <p class="page-sub">${canSeePrix()?`Valeur totale: ${fmt(v)} MGA · `:''}${ST.produits.filter(p=>p.dept==='Finance').length} références</p>
    ${prodTable(ST.produits.filter(p=>p.dept==='Finance'),'Finance','#10b981')}`;
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
    <td style="font-weight:500">${highlight(m.produit_nom,q)}</td>
    <td style="font-weight:700">${m.qty}</td>
    <td>${fmt(m.valeur)} MGA</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(m.emplacement||'—',q)}</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(m.destination||'—',q)}</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(m.fournisseur||'—',q)}</td>
    <td style="font-size:11px;color:var(--text3)">${highlight(m.ref_document||'—',q)}</td>
    <td style="font-size:11px;color:var(--text3)">${highlight(m.user_name,q)}</td>
    <td style="font-size:11px;color:var(--text3);max-width:100px">${m.observation||''}</td>
  </tr>`).join('');
  const emptyRow = !mvt.length ? `<tr class="no-result-row"><td colspan="12"><div class="nri">🔍</div><div class="nrt">Aucun mouvement ne correspond</div><div style="font-size:11px;margin-top:4px"><a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a></div></td></tr>` : '';
  return `<p class="page-title">Mouvements ${dept}</p>
    <p class="page-sub">${mvt.length} / ${allMvt.length} mouvement(s) · ↓ ${totE} entrée · ↑ ${totS} sortie</p>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn(`↓ Entrée`,color,false,`openMvt('entree','${dept}',null)`,'ti-arrow-down-circle')}
      ${btn(`↑ Sortie`,'#ef4444',false,`openMvt('sortie','${dept}',null)`,'ti-arrow-up-circle')}
    </div>
    ${searchBar}
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['ID','Date & Heure','Type','Produit','Qté','Valeur','Emplacement','Destination','Fournisseur','Réf. Doc.','Agent','Observation'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
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
    const acts=d.statut==='En attente'&&canM
      ? `<div style="display:flex;gap:4px">
          ${btn('✓ Valider','#10b981',false,`validDem('${dept}','${d.id}','Validé')`)}
          ${btn('✕','#ef4444',true,`validDem('${dept}','${d.id}','Refusé')`)}
        </div>`
      : (d.statut==='En attente'?`<span class="readonly-badge"><i class="ti ti-clock"></i> En cours</span>`:'');
    return `<tr>
      <td><code style="font-size:9px">${highlight(d.id,q)}</code></td>
      <td>${fmtDTSplit(d.created_at||d.date)}</td>
      <td style="font-weight:500;font-size:12.5px">${highlight(d.demandeur,q)}</td>
      <td style="font-weight:500">${highlight(d.produit,q)}</td>
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
    <div class="btn-row" style="margin-bottom:12px">${btn('+ Nouvelle demande',color,false,`openDemande('${dept}')`,'ti-plus')}</div>
    ${searchBar}
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['ID','Date & Heure','Demandeur','Produit','Qté','Urgence','Destination','Motif','Statut','Mis à jour','Validé par','Actions'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows||emptyRow}</tbody>
    </table></div></div>`;
}

function renderAlertes(dept) {
  const al=(dept==='IT'?alertsIT():alertsFin()).sort((a,b)=>a.stock-b.stock);
  const color=dept==='IT'?'#4f46e5':'#10b981';
  if (!al.length) return `<p class="page-title">Alertes ${dept}</p>
    <div class="card"><div class="empty-state"><div class="empty-ico">✅</div><div style="font-size:14px;font-weight:700;color:var(--text)">Aucune alerte active</div><div style="margin-top:4px;font-size:12px">Tous les stocks sont au-dessus de leurs seuils critiques</div></div></div>`;
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
    <p class="page-sub">${al.length} produit(s) nécessitant un réapprovisionnement urgent</p>
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['Priorité','Produit','Catégorie','Emplacement','Stock actuel','Seuil','Statut','Dernière MAJ','Action'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
}

function renderHistorique() {
  const il = ST.search.inline;
  const q = (il.query||'').trim();
  const allItems=[
    ...fMvtIT().map(m=>({...m,src:'Mouvement',label:m.type,actor:m.user_name,detail:m.observation,produit:m.produit_nom,dest:m.destination,dept:'IT'})),
    ...fMvtFin().map(m=>({...m,src:'Mouvement',label:m.type,actor:m.user_name,detail:m.observation,produit:m.produit_nom,dest:m.destination,dept:'Finance'})),
    ...fDemIT().map(d=>({...d,src:'Demande',label:d.statut,actor:d.demandeur,detail:d.motif,dest:d.dest,dept:'IT'})),
    ...fDemFin().map(d=>({...d,src:'Demande',label:d.statut,actor:d.demandeur,detail:d.motif,dest:d.dest,dept:'Finance'})),
  ].filter(h=>canSeeIT()||h.dept!=='IT').filter(h=>canSeeFin()||h.dept!=='Finance')
   .sort((a,b)=>new Date(b.created_at||b.date)-new Date(a.created_at||a.date));
  const filtered = allItems.filter(h => {
    if (!q) return true;
    return matchesQuery([h.produit, h.produit_nom, h.actor, h.detail, h.dest, h.id], q);
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
    <td style="font-weight:500">${highlight(h.produit||h.produit_nom||'',q)}</td>
    <td style="font-weight:700">${h.qty}</td>
    <td style="font-size:11px;color:var(--text2)">${highlight(h.emplacement||h.dest||'—',q)}</td>
    <td style="font-size:11px;color:var(--text3)">${highlight(h.actor,q)}</td>
    <td style="font-size:11px;color:var(--text3);max-width:120px">${highlight(h.detail||'',q).slice(0,60)}</td>
  </tr>`).join('');
  const emptyRow = !filtered.length ? `<tr class="no-result-row"><td colspan="9"><div class="nri">🔍</div><div class="nrt">Aucun résultat pour "${q}"</div><div style="font-size:11px;margin-top:4px"><a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser</a></div></td></tr>` : '';
  return `<p class="page-title">Historique Complet</p>
    <p class="page-sub">${filtered.length} / ${allItems.length} opération(s)</p>
    ${searchBar}
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr>${['Date & Heure','Dépt','Catégorie','Type/Statut','Produit','Qté','Empl./Dest.','Acteur','Détail'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows||emptyRow}</tbody>
    </table></div></div>`;
}