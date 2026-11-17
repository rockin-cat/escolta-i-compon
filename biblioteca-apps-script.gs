/**
 * Biblioteca de propostes de l'Entrenament auditiu (ROCKIN)
 * ---------------------------------------------------------
 * Desa i llegeix les activitats que comparteix el professorat en una carpeta de Google Drive.
 *
 * 1. Tria el codi del professorat. Només qui el sàpiga podrà compartir i veure propostes.
 *    No l'escriguis aquí (aquest fitxer és públic): posa'l a Configuració del projecte →
 *    Propietats de l'script, amb el nom CODI.
 * 2. Executa una vegada la funció «configurar» (crea la carpeta a Drive i demana permís).
 *    Si ja tens una carpeta, pots enganxar-ne l'identificador a CARPETA_ID.
 * 3. Implementa → Nova implementació → Aplicació web
 *      · Executa com a: jo
 *      · Qui hi té accés: qualsevol usuari
 *    i copia l'adreça que acaba en /exec a URL_BIBLIOTECA (app.js).
 */
const CARPETA_ID = '';   // buit: es fa servir la carpeta que crea «configurar»
const CODI = PropertiesService.getScriptProperties().getProperty('CODI') || '';   // el codi és a les propietats de l'script, no aquí

function carpetaBiblioteca() {
  if (CARPETA_ID) return DriveApp.getFolderById(CARPETA_ID);
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('CARPETA_ID');
  if (!id) {
    id = DriveApp.createFolder('Biblioteca Entrenament auditiu · Rockin').getId();
    props.setProperty('CARPETA_ID', id);
  }
  return DriveApp.getFolderById(id);
}

// Executa-la una vegada des de l'editor: crea la carpeta i demana els permisos.
function configurar() {
  const c = carpetaBiblioteca();
  const full = fullResultats();
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'netejaResultats'))
    ScriptApp.newTrigger('netejaResultats').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Carpeta de la biblioteca: ' + c.getUrl());
  Logger.log('Full de resultats: ' + full.getParent().getUrl());
}

function doGet(e) {
  const p = e.parameter || {};
  if (!CODI || p.codi !== CODI) return resposta({ ok: false, error: 'codi' });
  if (p.accio === 'resultats') return resposta(llegirResultats(p.classe));
  const carpeta = carpetaBiblioteca();

  // Obrir una activitat concreta
  if (p.id) {
    const f = DriveApp.getFileById(p.id);
    if (!esDeLaCarpeta(f, carpeta)) return resposta({ ok: false, error: 'no-trobada' });
    return resposta({ ok: true, activitat: JSON.parse(f.getBlob().getDataAsString('UTF-8')) });
  }

  // Llista de totes les activitats
  const llista = [];
  const fitxers = carpeta.getFiles();
  while (fitxers.hasNext()) {
    const f = fitxers.next();
    if (!/\.json$/i.test(f.getName())) continue;
    let info = {};
    try { info = JSON.parse(f.getDescription() || '{}'); } catch (err) { }
    if (!info.titol) info = infoDelFitxer(f);   // fitxers pujats a mà a la carpeta
    llista.push(Object.assign({ id: f.getId(), nom: f.getName().replace(/\.json$/i, ''), data: f.getLastUpdated().toISOString() }, info));
  }
  llista.sort((a, b) => b.data.localeCompare(a.data));
  return resposta({ ok: true, llista: llista });
}

function doPost(e) {
  let dades;
  try { dades = JSON.parse(e.postData.contents); } catch (err) { return resposta({ ok: false, error: 'format' }); }
  // L'alumnat envia el resultat sense el codi del professorat: només amb el codi de classe.
  if (dades.accio === 'resultat') return resposta(desaResultat(dades));
  if (!CODI || dades.codi !== CODI) return resposta({ ok: false, error: 'codi' });
  if (dades.accio === 'esborra-resultats') return resposta(esborraResultats(dades.classe));
  const a = dades.activitat;
  if (!a || !a.title || !Array.isArray(a.items) || !dades.nom) return resposta({ ok: false, error: 'format' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const carpeta = carpetaBiblioteca();
    const nom = String(dades.nom).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.json';
    const contingut = JSON.stringify(a);
    const existents = carpeta.getFilesByName(nom);
    let f;
    if (existents.hasNext()) {
      if (!dades.sobreescriure) return resposta({ ok: false, error: 'existeix' });
      f = existents.next();
      f.setContent(contingut);
    } else {
      f = carpeta.createFile(nom, contingut, 'application/json');
    }
    f.setDescription(JSON.stringify(dades.info || {}));
    return resposta({ ok: true, id: f.getId() });
  } finally {
    lock.releaseLock();
  }
}

// Si algú arrossega un .json directament a la carpeta, en llegim les dades per a la llista.
function infoDelFitxer(f) {
  try {
    const a = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
    const info = { titol: a.title || '', autor: a.autor || '', curs: a.curs || '', centre: '', cancons: (a.items || []).length, conceptes: (a.vocab || []).length };
    f.setDescription(JSON.stringify(info));
    return info;
  } catch (err) { return {}; }
}

function esDeLaCarpeta(fitxer, carpeta) {
  const pares = fitxer.getParents();
  while (pares.hasNext()) if (pares.next().getId() === carpeta.getId()) return true;
  return false;
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------
 * Resultats per codi de classe
 * L'alumnat envia (sense codi del professorat) el nom i els encerts;
 * el professorat els consulta amb el seu codi. Tot va a parar a un
 * full de càlcul del Drive, i s'esborra sol passats DIES_RESULTATS.
 * --------------------------------------------------------------- */
const DIES_RESULTATS = 90;
const MAX_FILES_CLASSE = 1000;

function fullResultats() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('FULL_RESULTATS'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Resultats · Escolta i compon (Rockin)');
    try { carpetaBiblioteca().addFile(DriveApp.getFileById(ss.getId())); } catch (err) { }
    props.setProperty('FULL_RESULTATS', ss.getId());
  }
  const full = ss.getSheets()[0];
  if (full.getLastRow() === 0) full.appendRow(['data', 'classe', 'alumne', 'activitat', 'part', 'encerts', 'total', 'acabat', 'detall']);
  return full;
}

// Activador diari: esborra els resultats antics.
function netejaResultats() {
  const full = fullResultats(), n = full.getLastRow();
  if (n < 2) return 0;
  const limit = new Date(Date.now() - DIES_RESULTATS * 24 * 3600 * 1000);
  const dates = full.getRange(2, 1, n - 1, 1).getValues();
  let fora = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = new Date(dates[i][0]);
    if (!isNaN(d.getTime()) && d < limit) { full.deleteRow(i + 2); fora++; }
  }
  return fora;
}

function desaResultat(dades) {
  const classe = String(dades.classe || '').trim().toUpperCase();
  const alumne = String(dades.alumne || '').trim().slice(0, 80);
  if (!/^[A-Z0-9ÀÈÉÍÒÓÚÜÏÇ.\- ]{3,24}$/.test(classe) || alumne.length < 3) return { ok: false, error: 'format' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'ocupat' };
  try {
    const full = fullResultats();
    if (filesDeClasse(full, classe) >= MAX_FILES_CLASSE) return { ok: false, error: 'ple' };
    full.appendRow([new Date(), classe, alumne, String(dades.activitat || '').slice(0, 120),
      Number(dades.part) || 0, Number(dades.encerts) || 0, Number(dades.total) || 0,
      dades.acabat ? 'sí' : '', String(dades.detall || '').slice(0, 500)]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function filesDeClasse(full, classe) {
  const n = full.getLastRow();
  if (n < 2) return 0;
  return full.getRange(2, 2, n - 1, 1).getValues().filter(function (r) { return String(r[0]).toUpperCase() === classe; }).length;
}

function llegirResultats(classe) {
  classe = String(classe || '').trim().toUpperCase();
  if (!classe) return { ok: false, error: 'format' };
  const full = fullResultats(), n = full.getLastRow();
  if (n < 2) return { ok: true, files: [], full: full.getParent().getUrl() };
  const v = full.getRange(2, 1, n - 1, 9).getValues(), files = [];
  v.forEach(function (r) {
    if (String(r[1]).toUpperCase() !== classe) return;
    files.push({
      data: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      alumne: String(r[2]), activitat: String(r[3]), part: Number(r[4]),
      encerts: Number(r[5]), total: Number(r[6]), acabat: !!String(r[7]), detall: String(r[8])
    });
  });
  files.sort(function (a, b) { return b.data.localeCompare(a.data); });
  return { ok: true, files: files, full: full.getParent().getUrl() };
}

function esborraResultats(classe) {
  classe = String(classe || '').trim().toUpperCase();
  if (!classe) return { ok: false, error: 'format' };
  const full = fullResultats(), n = full.getLastRow();
  if (n < 2) return { ok: true, esborrades: 0 };
  const v = full.getRange(2, 2, n - 1, 1).getValues();
  let fora = 0;
  for (let i = v.length - 1; i >= 0; i--) if (String(v[i][0]).toUpperCase() === classe) { full.deleteRow(i + 2); fora++; }
  return { ok: true, esborrades: fora };
}
