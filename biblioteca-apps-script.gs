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
  Logger.log('Carpeta de la biblioteca: ' + c.getUrl());
}

function doGet(e) {
  const p = e.parameter || {};
  if (!CODI || p.codi !== CODI) return resposta({ ok: false, error: 'codi' });
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
  if (!CODI || dades.codi !== CODI) return resposta({ ok: false, error: 'codi' });
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
