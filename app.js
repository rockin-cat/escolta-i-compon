(function(){
"use strict";
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 9);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let DATA = {activitats: []};
const TEACHER = new URLSearchParams(location.search).has("professorat");
// Adreça de l'aplicació web de Google Apps Script de la biblioteca (Implementa → Aplicació web).
const URL_BIBLIOTECA = "https://script.google.com/macros/s/AKfycbwZJIcfAZKnd643SiQGJ8QGiqKCiZmtLBSLhsy7a1rJAxxDKQpygDnU73naST_d7LMM/exec";
const K_DRAFT = "ea-meves-activitats", K_CODI = "ea-codi-biblioteca", K_AUTOR = "ea-autor";
let SHARED = false;   // true quan la pàgina s'obre amb un enllaç d'activitat (#a=...)
function llegirLocal(k){ try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
function escriureLocal(k, v){ try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }

const app = $("#app");
const state = {
  mode: "alumne",
  actId: null,
  game: null,
  voc: null,          // part 2 (vocabulari), same shape as game
  part: 1,        // {order:[itemIds shuffled], placed:{descId:itemId}, ok:{descId:true}, bad:{}, done:false, selected:null}
  draft: null,
  dirty: false,
  readOnly: false,
  saving: false,
  msg: ""
};

/* ---------- helpers ---------- */
function ytId(url){
  url = String(url || "").trim();
  if (/^[\w-]{11}$/.test(url)) return url;
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function secs(t){
  t = String(t || "").trim(); if (!t) return 0;
  const p = t.split(":").map(Number); if (p.some(isNaN)) return 0;
  return p.reduce((a, b) => a * 60 + b, 0);
}
function embedSrc(url, start, end){
  const id = ytId(url); if (!id) return null;
  const q = new URLSearchParams({enablejsapi: "1", rel: "0", playsinline: "1", modestbranding: "1"});
  const s = secs(start), e = secs(end);
  if (s) q.set("start", String(s));
  if (e && e > s) q.set("end", String(e));
  return "https://www.youtube-nocookie.com/embed/" + id + "?" + q.toString();
}
function watchUrl(url, start){
  const id = ytId(url); if (!id) return "#";
  const s = secs(start);
  return "https://www.youtube.com/watch?v=" + id + (s ? "&t=" + s + "s" : "");
}
function shuffle(a){ a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function SRC(){ return (TEACHER && !SHARED && state.draft) ? state.draft : DATA; }
function act(){ const L = SRC().activitats; return L.find(a => a.id === state.actId) || L[0]; }
function toast(t){
  let el = $(".toast"); if (!el){ el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2800);
}

/* ---------- YouTube control via postMessage ---------- */
function ytCmd(iframe, func, args){
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(JSON.stringify({event: "command", func, args: args || []}), "*");
}
function stopAll(except){
  document.querySelectorAll(".player.playing").forEach(p => {
    if (p === except) return;
    ytCmd($("iframe", p), "pauseVideo"); p.classList.remove("playing"); const b = $(".play", p); if (b) b.textContent = "▶ Escolta";
  });
}
function playerHTML(url, start, end, label, hide){
  const src = embedSrc(url, start, end);
  if (!src) return `<div class="player"><div class="cover"><span>Enllaç de vídeo no vàlid</span></div></div>`;
  return `<div class="player" data-start="${secs(start)}">
    <iframe src="${esc(src)}" title="Fragment ${esc(label)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
    ${hide ? `<div class="cover"><span class="big">${esc(label)}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="ctrls"><button type="button" class="play">▶ Escolta</button><button type="button" class="restart" aria-label="Torna a començar">↺</button><button type="button" class="peek" aria-label="Mostra la imatge del vídeo">Veure</button></span></div>` : ``}
  </div>`;
}
document.addEventListener("load", e => {
  const f = e.target; if (f.tagName === "IFRAME" && f.contentWindow) f.contentWindow.postMessage(JSON.stringify({event: "listening", id: 1}), "*");
}, true);
document.addEventListener("click", e => {
  const b = e.target.closest(".cover button"); if (!b) return;
  const p = b.closest(".player"), f = $("iframe", p);
  if (b.classList.contains("play")){
    if (p.classList.contains("playing")){ ytCmd(f, "pauseVideo"); p.classList.remove("playing"); b.textContent = "▶ Escolta"; }
    else { stopAll(p); ytCmd(f, "playVideo"); p.classList.add("playing"); b.textContent = "❚❚ Pausa"; }
  } else if (b.classList.contains("restart")){
    stopAll(p); ytCmd(f, "seekTo", [Number(p.dataset.start) || 0, true]); ytCmd(f, "playVideo"); p.classList.add("playing"); $(".play", p).textContent = "❚❚ Pausa";
  } else if (b.classList.contains("peek")){
    $(".cover", p).remove();
  }
});

/* ---------- game ---------- */
function G(){ return state.part === 2 ? state.voc : state.game; }
function vocabOf(a){ return (a && Array.isArray(a.vocab) ? a.vocab : []).filter(v => v.term && v.def); }
function listOf(a){ return state.part === 2 ? vocabOf(a) : a.items; }
function newVoc(a){ state.voc = {order: shuffle(vocabOf(a).map(v => v.id)), placed: {}, ok: {}, bad: {}, done: false, selected: null}; }
function newGame(a){
  state.game = {order: shuffle(a.items.map(i => i.id)), placed: {}, ok: {}, bad: {}, done: false, selected: null};
}
function labelOf(itemId){
  if (state.part === 2){ const v = vocabOf(act()).find(x => x.id === itemId); return v ? v.term : "?"; }
  return LETTERS[state.game.order.indexOf(itemId)] || "?";
}
function placedWhere(itemId){ const g = G(); return Object.keys(g.placed).find(k => g.placed[k] === itemId); }

function grabHTML(id){
  const g = G(), where = placedWhere(id), locked = !!(where && g.ok[where]);
  if (state.part === 2) return `<button type="button" class="grab term-btn" data-grab="${id}" aria-pressed="${g.selected === id}" ${locked ? "disabled" : ""}>${esc(labelOf(id))}</button>`;
  return locked ? `<span class="hint">Correcte</span>` : `<button type="button" class="grab" data-grab="${id}" aria-pressed="${g.selected === id}">${g.selected === id ? "Ara toca una descripció" : "Arrossega"}</button>`;
}
function fragClass(id){
  const g = G(), where = placedWhere(id), locked = !!(where && g.ok[where]);
  return (state.part === 2 ? "frag term" : "frag") + (where ? " placed" : "") + (locked ? " locked" : "") + (g.selected === id ? " selected" : "");
}
function descsHTML(a){
  const g = state.game;
  return a.items.map(it => {
    const pid = g.placed[it.id], cls = g.ok[it.id] ? " ok" : g.bad[it.id] ? " bad" : "";
    const rev = g.ok[it.id] && g.done && (it.title || it.extra || (it.extraVideos || []).some(Boolean));
    return `<article class="desc${cls}${g.selected && !g.ok[it.id] ? " target" : ""}" data-desc="${it.id}">
      <div class="slot" data-slot="${it.id}">${pid ? `<button type="button" class="chip" data-unplace="${it.id}" aria-label="Treu el fragment ${labelOf(pid)}">${labelOf(pid)}</button>` : "?"}</div>
      <p>${esc(it.desc)}</p>
      ${rev ? `<div class="reveal">
        ${it.title ? `<div class="song">${esc(it.title)}</div>` : ""}
        ${it.extra ? `<div class="extra">${esc(it.extra)}</div>` : ""}
        ${(it.extraVideos || []).filter(ytId).map((v, k) => `<details><summary>Vídeo extra ${k + 1}</summary>${playerHTML(v, "", "", "+", false)}</details>`).join("")}
      </div>` : ""}
    </article>`;
  }).join("");
}
function stepsHTML(a){
  const hasV = vocabOf(a).length > 0, hasI = ideesOf(a).length > 0;
  if (!hasV && !hasI) return "";
  const unlocked = state.game && state.game.done, lock = unlocked ? "" : "disabled title=\"Primer acaba la part 1\"";
  let n = 1;
  return `<nav class="steps" aria-label="Parts de l'activitat">
    <button type="button" data-part="1" aria-current="${state.part === 1}"><span>${n++}</span> Escolta i relaciona</button>
    ${hasV ? `<button type="button" data-part="2" aria-current="${state.part === 2}" ${lock}><span>${n++}</span> Vocabulari musical</button>` : ""}
    ${hasI ? `<button type="button" data-part="3" aria-current="${state.part === 3}" ${lock}><span>${n++}</span> Idees per compondre</button>` : ""}
  </nav>`;
}
function statusHTML(a){
  const g = G(), total = listOf(a).length, okN = Object.keys(g.ok).length, placedN = Object.keys(g.placed).length;
  return `<span class="meter"><b>${placedN}</b>/${total} col·locats · <b>${okN}</b> correctes</span>
    <button type="button" class="btn primary" id="check" ${placedN === 0 || g.done ? "disabled" : ""}>Comprova</button>
    <button type="button" class="btn ghost" id="restart">Torna a començar</button>`;
}
function bannerHTML(a){
  const go3 = ideesOf(a).length ? `<button type="button" class="btn next" id="go3">Continua: idees per compondre →</button>` : "";
  if (state.part === 2) return state.voc.done ? `<div class="banner" role="status"><b>Vocabulari complet!</b><span>Ja domines els conceptes musicals d'aquesta activitat.</span>${go3}</div>` : "";
  const next = vocabOf(a).length ? `<button type="button" class="btn next" id="go2">Continua: vocabulari musical →</button>` : go3;
  return state.game.done ? `<div class="banner" role="status"><b>${esc(a.feedback || "Molt bé!")}</b><span>Ara pots veure el títol de cada cançó i el material extra.</span>${next}</div>` : "";
}
function vocabDescsHTML(a){
  const g = state.voc;
  return vocabOf(a).map(v => {
    const pid = g.placed[v.id], cls = g.ok[v.id] ? " ok" : g.bad[v.id] ? " bad" : "";
    return `<article class="desc def${cls}${g.selected && !g.ok[v.id] ? " target" : ""}" data-desc="${v.id}">
      <div class="slot wide" data-slot="${v.id}">${pid ? `<button type="button" class="chip" data-unplace="${v.id}" aria-label="Treu ${esc(labelOf(pid))}">${esc(labelOf(pid))}</button>` : "?"}</div>
      <p>${esc(v.def)}</p>
    </article>`;
  }).join("");
}
function renderVocab(a){
  if (!state.voc) newVoc(a);
  const g = state.voc;
  const pool = g.order.map(id => `<div class="${fragClass(id)}" data-item="${id}"><span class="grab-wrap">${grabHTML(id)}</span></div>`).join("");
  app.innerHTML = `
    <div class="head">
      ${stepsHTML(a)}
      <h1>Vocabulari musical</h1>
      <p>${esc(a.vocabInstructions || "Relaciona cada concepte que ha sortit a les descripcions amb la seva definició. Arrossega'l o toca'l i després toca la definició.")}</p>
      <div class="status" id="status">${statusHTML(a)}</div>
    </div>
    <div id="banner">${bannerHTML(a)}</div>
    <div class="game vocab">
      <section aria-label="Conceptes"><h2 class="col-title">Conceptes</h2><div class="pool terms">${pool}</div></section>
      <section aria-label="Definicions"><h2 class="col-title">Definicions</h2><div class="descs" id="descs">${vocabDescsHTML(a)}</div></section>
    </div>`;
}
function renderGame(){
  const a = act();
  if (!a){ app.innerHTML = `<div class="head"><h1>Encara no hi ha activitats</h1><p>Passa a mode professorat per crear-ne una.</p></div>`; return; }
  if (!state.game) newGame(a);
  if (state.part === 2 && state.game.done && vocabOf(a).length) return renderVocab(a);
  if (state.part === 3 && state.game.done && ideesOf(a).length) return renderIdeas(a);
  state.part = 1;
  const g = state.game;
  const pool = g.order.map(id => {
    const it = a.items.find(i => i.id === id); if (!it) return "";
    const L = labelOf(id);
    return `<article class="${fragClass(id)}" data-item="${id}">
      <div class="frag-top"><span class="tag">${L}</span><span class="grab-wrap">${grabHTML(id)}</span></div>
      ${playerHTML(it.video, it.start, it.end, L, a.hideVideo)}
      <div class="yt-link"><a href="${esc(watchUrl(it.video, it.start))}" target="_blank" rel="noopener">Obre a YouTube</a> si el vídeo no es carrega</div>
    </article>`;
  }).join("");
  app.innerHTML = `
    <div class="head">
      ${stepsHTML(a)}
      <h1>${esc(a.title)}</h1>
      <p>${esc(a.instructions || "Escolta els fragments musicals, llegeix bé les descripcions i arrossega cada fragment a la descripció que li correspon.")}</p>
      <div class="status" id="status">${statusHTML(a)}</div>
    </div>
    <div id="banner">${bannerHTML(a)}</div>
    <div class="game">
      <section aria-label="Fragments musicals"><h2 class="col-title">Fragments</h2><div class="pool">${pool}</div></section>
      <section aria-label="Descripcions"><h2 class="col-title">Descripcions</h2><div class="descs" id="descs">${descsHTML(a)}</div></section>
    </div>`;
}
/* update in place so the players keep playing */
function updateGame(){
  const a = act();
  $("#status").innerHTML = statusHTML(a);
  $("#banner").innerHTML = bannerHTML(a);
  $("#descs").innerHTML = state.part === 2 ? vocabDescsHTML(a) : descsHTML(a);
  document.querySelectorAll(".frag[data-item]").forEach(f => {
    const id = f.dataset.item; f.className = fragClass(id); $(".grab-wrap", f).innerHTML = grabHTML(id);
  });
}

function place(itemId, descId){
  const g = G(); if (!g || g.ok[descId]) return;
  const prev = placedWhere(itemId); if (prev){ if (g.ok[prev]) return; delete g.placed[prev]; delete g.bad[prev]; }
  g.placed[descId] = itemId; delete g.bad[descId]; g.selected = null;
  updateGame();
}
function refreshSteps(a){ const st = $(".steps"); if (st) st.outerHTML = stepsHTML(a); }
function goPart(p){ stopAll(); state.part = p; if (p === 2 && !state.voc) newVoc(act()); render(); window.scrollTo(0, 0); }
function renderKeepPlayers(){
  // Re-rendering reloads iframes; keep scroll position.
  const y = window.scrollY; render(); window.scrollTo(0, y);
}
function check(){
  const g = G(), a = act();
  g.bad = {};
  for (const [d, i] of Object.entries(g.placed)){ if (d === i) g.ok[d] = true; else g.bad[d] = true; }
  const badN = Object.keys(g.bad).length;
  g.done = listOf(a).every(it => g.ok[it.id]);
  if (g.done && state.part === 1) refreshSteps(a);
  updateGame();
  if (g.done) $("#banner").scrollIntoView({behavior: "smooth", block: "nearest"});
  if (g.done) return;
  toast(badN ? `${badN} ${badN === 1 ? "no encaixa" : "no encaixen"}. ${state.part === 2 ? "Torna-ho a provar!" : "Torna-ho a escoltar!"}` : "Tot el que has col·locat és correcte. Continua!");
  if (badN) setTimeout(() => { if (G() !== g || state.mode !== "alumne") return; for (const d of Object.keys(g.bad)) delete g.placed[d]; g.bad = {}; updateGame(); }, 1600);
}

app.addEventListener("click", e => {
  if (state.mode !== "alumne") return;
  const t = e.target;
  if (t.id === "check") return check();
  if (t.id === "restart"){ if (state.part === 2) newVoc(act()); else { newGame(act()); state.voc = null; } return renderKeepPlayers(); }
  if (t.closest("#go2")) return goPart(2);
  if (t.closest("#go3")) return goPart(3);
  const pb = t.closest("[data-part]"); if (pb){ if (!pb.disabled) goPart(Number(pb.dataset.part)); return; }
  const un = t.closest("[data-unplace]");
  if (un){ const d = un.dataset.unplace, g = G(); if (!g.ok[d]){ delete g.placed[d]; delete g.bad[d]; updateGame(); } return; }
  const gb = t.closest("[data-grab]");
  if (gb){ if (drag.moved) return; const id = gb.dataset.grab; const g = G(); g.selected = g.selected === id ? null : id; return updateGame(); }
  const d = t.closest("[data-desc]");
  if (d && G() && G().selected) place(G().selected, d.dataset.desc);
});

/* pointer drag (mouse + touch) */
const drag = {id: null, ghost: null, moved: false, sx: 0, sy: 0, over: null};
app.addEventListener("pointerdown", e => {
  const gb = e.target.closest("[data-grab]"); if (!gb || state.mode !== "alumne") return;
  drag.id = gb.dataset.grab; drag.moved = false; drag.sx = e.clientX; drag.sy = e.clientY;
  gb.setPointerCapture?.(e.pointerId);
});
app.addEventListener("pointermove", e => {
  if (!drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
  if (!drag.moved){ drag.moved = true; drag.ghost = document.createElement("div"); drag.ghost.className = "ghost-drag"; drag.ghost.textContent = labelOf(drag.id); document.body.appendChild(drag.ghost); }
  drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px";
  if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
  const el = document.elementFromPoint(e.clientX, e.clientY), d = el && el.closest("[data-desc]");
  const slot = d ? $(".slot", d) : null;
  if (drag.over && drag.over !== slot) drag.over.classList.remove("over");
  if (slot){ slot.classList.add("over"); drag.over = slot; } else drag.over = null;
});
function endDrag(e){
  if (!drag.id) return;
  const id = drag.id, moved = drag.moved;
  if (drag.ghost) drag.ghost.remove();
  let target = null;
  if (moved && e && e.type === "pointerup"){ const el = document.elementFromPoint(e.clientX, e.clientY); const d = el && el.closest("[data-desc]"); if (d) target = d.dataset.desc; }
  drag.id = null; drag.ghost = null; drag.over = null;
  if (target) place(id, target);
  setTimeout(() => { drag.moved = false; }, 0);
}
app.addEventListener("pointerup", endDrag);
app.addEventListener("pointercancel", endDrag);

/* ---------- editor ---------- */
function blankItem(){ return {id: "c" + uid(), video: "", start: "", end: "", desc: "", title: "", extra: "", extraVideos: []}; }
function blankVoc(){ return {id: "v" + uid(), term: "", def: ""}; }
function blankAct(){ return {vocab: [blankVoc(), blankVoc()], id: "a" + uid(), title: "", instructions: "", feedback: "", hideVideo: true, items: [blankItem(), blankItem(), blankItem(), blankItem()]}; }
function draftAct(){ return state.draft.activitats.find(a => a.id === state.actId) || state.draft.activitats[0]; }

function renderEditor(){
  if (!state.draft) state.draft = clone(DATA);
  const a = draftAct();
  if (!a){ app.innerHTML = `<div class="editor"><div class="panel"><h2>No hi ha cap activitat</h2><button class="btn primary" data-ed="newact">Crea una activitat</button></div></div>${saveBar()}`; return; }
  const items = a.items.map((it, n) => {
    const bad = it.video && !ytId(it.video);
    return `<div class="item" data-i="${n}">
      <div class="item-head"><span class="n">Cançó ${n + 1}</span>
        <button class="btn small" data-ed="up" ${n === 0 ? "disabled" : ""} aria-label="Puja">↑</button>
        <button class="btn small" data-ed="down" ${n === a.items.length - 1 ? "disabled" : ""} aria-label="Baixa">↓</button>
        <button class="btn small danger" data-ed="delitem">Elimina</button></div>
      <div class="row">
        <label class="f">Vídeo de YouTube (enllaç)<input id="v-${it.id}" data-k="video" value="${esc(it.video)}" placeholder="https://www.youtube.com/watch?v=…"></label>
        <label class="f">Inici del fragment (m:ss)<input id="s-${it.id}" data-k="start" value="${esc(it.start)}" placeholder="0:00" inputmode="numeric"></label>
        <label class="f">Final del fragment (m:ss)<input id="e-${it.id}" data-k="end" value="${esc(it.end)}" placeholder="opcional" inputmode="numeric"></label>
      </div>
      ${bad ? `<p class="warn">No reconec aquest enllaç de YouTube.</p>` : ""}
      <label class="f">Descripció que llegeix l'alumnat<textarea id="d-${it.id}" data-k="desc" placeholder="Descriu què s'escolta: instruments, veu, velocitat, estructura…">${esc(it.desc)}</textarea></label>
      <div class="row">
        <label class="f">Títol i artista (es mostra en resoldre)<input id="t-${it.id}" data-k="title" value="${esc(it.title)}" placeholder="p. ex. Diamonds — Rihanna"></label>
      </div>
      <label class="f">Text extra (context, preguntes, curiositats…)<textarea id="x-${it.id}" data-k="extra">${esc(it.extra)}</textarea></label>
      <div class="extras"><span class="hint">Vídeos extra (apareixen quan l'alumnat ho resol)</span>
        ${(it.extraVideos || []).map((v, k) => `<div class="x"><input id="xv-${it.id}-${k}" data-xv="${k}" value="${esc(v)}" placeholder="Enllaç de YouTube" aria-label="Vídeo extra ${k + 1}"><button class="btn small" data-ed="delxv" data-k2="${k}">Treu</button></div>`).join("")}
        <div><button class="btn small" data-ed="addxv">+ Afegeix vídeo extra</button></div>
      </div>
    </div>`;
  }).join("");
  app.innerHTML = `<div class="editor">
    <div class="panel share">
      <div class="item-head"><h2 style="margin-right:auto">Comparteix aquesta activitat</h2><button class="btn small" data-ed="newact">➕ Crea una activitat des de zero</button></div>
      <div class="share-row">
        <button class="btn primary" data-ed="link">🔗 Enllaç per a l'alumnat</button>
        <button class="btn" data-ed="publish">📤 Comparteix a la biblioteca</button>
        <button class="btn" data-ed="biblio">📚 Biblioteca de propostes</button>
        <button class="btn" data-ed="print">🖨️ Versió imprimible</button>
      </div>
      <div id="share-out"></div>
      <p class="hint">L'enllaç porta l'activitat a dins: l'alumnat l'obre directament, sense cap altra activitat ni el mode professorat. Els canvis que facis es guarden en aquest navegador.</p>
    </div>
    <div class="panel">
      <h2>Estàs editant: ${esc(a.title || "una activitat nova, encara sense títol")}</h2>
      <label class="f">Títol<input id="a-title" data-a="title" value="${esc(a.title)}" placeholder="p. ex. Timbres i instruments"></label>
      <label class="f">Instruccions<textarea id="a-ins" data-a="instructions" placeholder="Si ho deixes buit: «Escolta els fragments musicals, llegeix bé les descripcions i arrossega cada fragment a la descripció que li correspon.»">${esc(a.instructions)}</textarea></label>
      <label class="f">Missatge quan ho encerten tot<input id="a-fb" data-a="feedback" value="${esc(a.feedback)}" placeholder="Si ho deixes buit: «Molt bé!»"></label>
      <label class="check"><input type="checkbox" id="a-hide" data-a="hideVideo" ${a.hideVideo ? "checked" : ""}> Amaga la imatge dels vídeos (només s'escolta; l'alumnat pot destapar-la)</label>
      <div class="item-head"><span class="n"></span>
        <button class="btn small" data-ed="dupact">Duplica l'activitat</button>
        <button class="btn small danger" data-ed="delact">Elimina l'activitat</button></div>
    </div>
    <div class="panel"><h2>Cançons (${a.items.length})</h2>${items}<div><button class="btn" data-ed="additem">+ Afegeix una cançó</button></div></div>
    <div class="panel"><h2>Part 2 · Vocabulari (${(a.vocab || []).length})</h2>
      <p class="hint">Apareix quan l'alumnat ha resolt la part 1. Deixa-ho buit si no vols segona part.</p>
      <label class="f">Instruccions de la part 2<input id="a-vins" data-a="vocabInstructions" value="${esc(a.vocabInstructions || "")}" placeholder="Relaciona cada concepte amb la seva definició."></label>
      ${(a.vocab || []).map((v, n) => `<div class="item voc" data-v="${n}">
        <div class="item-head"><span class="n">Concepte ${n + 1}</span><button class="btn small danger" data-ed="delvoc">Elimina</button></div>
        <div class="row"><label class="f">Concepte<input id="vt-${v.id}" data-vk="term" value="${esc(v.term)}"></label></div>
        <label class="f">Definició<textarea id="vd-${v.id}" data-vk="def">${esc(v.def)}</textarea></label>
      </div>`).join("")}
      <div><button class="btn" data-ed="addvoc">+ Afegeix un concepte</button></div>
    </div>
    <div class="panel"><h2>Part 3 · Idees per compondre (${(a.idees || []).length})</h2>
      <p class="hint">Recursos que surten a les cançons perquè l'alumnat els triï i els apliqui a la seva cançó. Deixa-ho buit si no vols aquesta part.</p>
      <label class="f">Instruccions de la part 3<input id="a-iins" data-a="ideesInstructions" value="${esc(a.ideesInstructions || "")}" placeholder="Si ho deixes buit: «Totes aquestes idees han sortit a les cançons que heu escoltat…»"></label>
      ${(a.idees || []).map((x, n) => `<div class="item idea-ed" data-id="${n}">
        <div class="item-head"><span class="n">Idea ${n + 1}</span><button class="btn small danger" data-ed="delidea">Elimina</button></div>
        <div class="row"><label class="f">Idea<input id="it-${x.id}" data-ik="titol" value="${esc(x.titol)}" placeholder="p. ex. Cors que responen al cantant"></label>
          <label class="f">Cançó d'exemple<select id="ie-${x.id}" data-ik="exemple"><option value="">—</option>${a.items.map((it, k) => `<option value="${it.id}" ${it.id === x.exemple ? "selected" : ""}>${esc(it.title || "Cançó " + (k + 1))}</option>`).join("")}</select></label></div>
        <label class="f">Què és<textarea id="id-${x.id}" data-ik="desc" placeholder="Explica breument el recurs">${esc(x.desc)}</textarea></label>
        <label class="f">Com provar-ho<textarea id="ic-${x.id}" data-ik="com" placeholder="Una pista pràctica per a la banda">${esc(x.com)}</textarea></label>
      </div>`).join("")}
      <div><button class="btn" data-ed="addidea">+ Afegeix una idea</button></div>
    </div>
  </div>${saveBar()}`;
}
function saveBar(){
  const m = state.msg || "Els canvis es guarden automàticament en aquest navegador.";
  return `<div class="savebar"><span class="msg" role="status">${esc(m)}</span>
    <button class="btn" data-ed="newact">➕ Activitat des de zero</button>
    <button class="btn ghost" data-ed="discard" title="Esborra els canvis d'aquest navegador i torna a les activitats oficials">Restaura les oficials</button>
    <button class="btn ghost" data-ed="save" title="Per a qui gestiona el repositori de Rockin">Descarrega activitats.json</button></div>`;
}
function markDirty(){ state.dirty = true; state.msg = ""; const m = $(".savebar .msg"); if (m) m.textContent = "Desat en aquest navegador."; stash(); }
function stash(){ escriureLocal(K_DRAFT, JSON.stringify({d: state.draft, act: state.actId})); }

app.addEventListener("input", e => {
  if (state.mode !== "prof") return;
  const t = e.target, a = draftAct(); if (!a) return;
  if (t.dataset.a){ a[t.dataset.a] = t.type === "checkbox" ? t.checked : t.value; if (t.dataset.a === "title") renderTabs(); return markDirty(); }
  const ib = t.closest("[data-id]");
  if (ib && t.dataset.ik){ a.idees[Number(ib.dataset.id)][t.dataset.ik] = t.value; return markDirty(); }
  const vb = t.closest("[data-v]");
  if (vb && t.dataset.vk){ a.vocab[Number(vb.dataset.v)][t.dataset.vk] = t.value; return markDirty(); }
  const box = t.closest("[data-i]"); if (!box) return;
  const it = a.items[Number(box.dataset.i)];
  if (t.dataset.k) it[t.dataset.k] = t.value;
  else if (t.dataset.xv !== undefined) it.extraVideos[Number(t.dataset.xv)] = t.value;
  markDirty();
});
app.addEventListener("change", e => { if (state.mode === "prof" && e.target.dataset.k === "video") renderEditorKeep(); });
function renderEditorKeep(){ const y = window.scrollY, f = document.activeElement && document.activeElement.id; renderEditor(); renderTabs(); window.scrollTo(0, y); if (f && document.getElementById(f)) document.getElementById(f).focus(); }

app.addEventListener("click", async e => {
  if (state.mode !== "prof") return;
  const b = e.target.closest("[data-ed]"); if (!b) return;
  const op = b.dataset.ed, a = draftAct(), box = b.closest("[data-i]"), n = box ? Number(box.dataset.i) : -1;
  const L = state.draft.activitats;
  switch (op){
    case "additem": a.items.push(blankItem()); break;
    case "addvoc": (a.vocab ||= []).push(blankVoc()); break;
    case "addidea": (a.idees ||= []).push({id: "i" + uid(), titol: "", desc: "", com: "", exemple: ""}); break;
    case "delidea": a.idees.splice(Number(b.closest("[data-id]").dataset.id), 1); break;
    case "delvoc": a.vocab.splice(Number(b.closest("[data-v]").dataset.v), 1); break;
    case "delitem": if (a.items.length <= 2){ toast("Una activitat necessita com a mínim dues cançons."); return; } a.items.splice(n, 1); break;
    case "up": [a.items[n - 1], a.items[n]] = [a.items[n], a.items[n - 1]]; break;
    case "down": [a.items[n + 1], a.items[n]] = [a.items[n], a.items[n + 1]]; break;
    case "addxv": (a.items[n].extraVideos ||= []).push(""); break;
    case "delxv": a.items[n].extraVideos.splice(Number(b.dataset.k2), 1); break;
    case "newact": { const x = blankAct(); L.push(x); state.actId = x.id; break; }
    case "dupact": { const x = reId(clone(a)); x.title = a.title + " (còpia)"; L.push(x); state.actId = x.id; break; }
    case "delact": {
      if (b.dataset.confirm !== "1"){ b.dataset.confirm = "1"; b.textContent = "Segur? Toca per eliminar"; return; }
      L.splice(L.indexOf(a), 1); state.actId = L[0] ? L[0].id : null; break;
    }
    case "discard":
      if (b.dataset.confirm !== "1"){ b.dataset.confirm = "1"; b.textContent = "Segur? Es perdran els teus canvis"; return; }
      state.draft = clone(DATA); state.dirty = false; state.msg = "S'han restaurat les activitats oficials."; escriureLocal(K_DRAFT, ""); if (!DATA.activitats.some(x => x.id === state.actId)) state.actId = DATA.activitats[0]?.id || null; renderEditorKeep(); return;
    case "save": return save();
    case "link": return shareLink(a);
    case "publish": return publishAct(a);
    case "biblio": return openLibrary();
    case "print": return printForm(a);
  }
  markDirty(); renderEditorKeep();
});

/* ---------- saving: download activitats.json to upload to GitHub ---------- */
function validate(d){
  for (const a of d.activitats){
    if (!a.title.trim()) return "Cada activitat necessita un títol.";
    for (const [n, it] of a.items.entries()){
      if (!ytId(it.video)) return `«${a.title}», cançó ${n + 1}: falta un enllaç de YouTube vàlid.`;
      if (!it.desc.trim()) return `«${a.title}», cançó ${n + 1}: falta la descripció.`;
    }
  }
  return null;
}
function githubEditUrl(){
  // https://usuari.github.io/repo/ -> https://github.com/usuari/repo/edit/main/activitats.json
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
  if (!m) return null;
  const repo = location.pathname.split("/").filter(Boolean)[0] || (m[1] + ".github.io");
  return `https://github.com/${m[1]}/${repo}/upload/main`;
}
async function save(){
  const err = validate(state.draft); if (err){ toast(err); return; }
  const cleaned = clone(state.draft); cleaned.activitats.forEach(a => { a.items.forEach(i => i.extraVideos = (i.extraVideos || []).filter(v => v.trim())); a.vocab = (a.vocab || []).filter(v => v.term.trim() && v.def.trim()); });
  const text = JSON.stringify(cleaned, null, 2) + "\n";
  const blob = new Blob([text], {type: "application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "activitats.json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  try { await navigator.clipboard.writeText(text); } catch (e) {}
    state.msg = "S'ha descarregat activitats.json. Puja'l al repositori de GitHub per publicar els canvis.";
  const gh = githubEditUrl(); if (gh) window.open(gh, "_blank", "noopener");
  renderEditorKeep();
}

/* ---------- compartir: enllaç per a l'alumnat ---------- */
function b64url(buf){ let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64url(t){ t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; return Uint8Array.from(atob(t), c => c.charCodeAt(0)); }
async function packAct(a){
  const json = JSON.stringify(cleanAct(a));
  if (typeof CompressionStream === "undefined") return "j" + b64url(new TextEncoder().encode(json));
  const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
  return "z" + b64url(buf);
}
async function unpackAct(t){
  const kind = t[0], bytes = unb64url(t.slice(1));
  const json = kind === "z" ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text() : new TextDecoder().decode(bytes);
  return JSON.parse(json);
}
function cleanAct(a){
  const x = clone(a);
  x.items.forEach(i => i.extraVideos = (i.extraVideos || []).filter(v => String(v).trim()));
  x.vocab = (x.vocab || []).filter(v => String(v.term).trim() && String(v.def).trim());
  x.idees = (x.idees || []).filter(i => String(i.titol).trim());
  return x;
}
function actError(a){
  if (!a.title.trim()) return "L'activitat necessita un títol.";
  if (a.items.length < 2) return "L'activitat necessita com a mínim dues cançons.";
  for (const [n, it] of a.items.entries()){
    if (!ytId(it.video)) return `Cançó ${n + 1}: falta un enllaç de YouTube vàlid.`;
    if (!it.desc.trim()) return `Cançó ${n + 1}: falta la descripció.`;
  }
  return null;
}
function studentUrl(packed){ return location.origin + location.pathname + "#a=" + packed; }
async function shareLink(a){
  const err = actError(a); if (err){ toast(err); return; }
  const url = studentUrl(await packAct(a));
  let copied = false; try { await navigator.clipboard.writeText(url); copied = true; } catch (e) {}
  $("#share-out").innerHTML = `<div class="share-link">
    <label class="f">${copied ? "Enllaç copiat! Enganxa'l al Classroom, al correu o on vulguis." : "Copia aquest enllaç:"}<input id="share-url" readonly value="${esc(url)}"></label>
    <a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Prova-ho com l'alumnat ↗</a>
  </div>`;
  const inp = $("#share-url"); inp.addEventListener("focus", () => inp.select()); if (!copied) inp.focus();
}

/* ---------- part 3: idees per compondre ---------- */
function ideesOf(a){ return (a && Array.isArray(a.idees) ? a.idees : []).filter(x => x.titol); }
function reId(a){
  const map = {};
  a.id = "a" + uid();
  a.items.forEach(i => { const n = "c" + uid(); map[i.id] = n; i.id = n; });
  (a.vocab || []).forEach(v => v.id = "v" + uid());
  (a.idees || []).forEach(x => { x.id = "i" + uid(); if (x.exemple) x.exemple = map[x.exemple] || ""; });
  return a;
}
function ideaState(){ return state.ideas || (state.ideas = {sel: [], desti: "actual", canco: "", banda: ""}); }
function renderIdeas(a){
  const s = ideaState(), L = ideesOf(a);
  const card = x => {
    const on = s.sel.includes(x.id), ex = a.items.find(i => i.id === x.exemple);
    return `<label class="idea${on ? " on" : ""}">
      <input type="checkbox" data-idea="${x.id}" ${on ? "checked" : ""}>
      <span class="idea-body"><b>${esc(x.titol)}</b>
        ${x.desc ? `<span>${esc(x.desc)}</span>` : ""}
        ${ex && ex.title ? `<small>🎧 Com a ${esc(ex.title)}</small>` : ""}</span>
    </label>`;
  };
  app.innerHTML = `
    <div class="head">
      ${stepsHTML(a)}
      <h1>Idees per a la nostra cançó</h1>
      <p>${esc(a.ideesInstructions || "Totes aquestes idees han sortit a les cançons que heu escoltat. Trieu-ne les que us agradin i apliqueu-les a la cançó que esteu tocant o a una de nova.")}</p>
      <div class="status"><span class="meter"><b id="idea-n">${s.sel.length}</b> idees triades</span>
        <button type="button" class="btn ghost" id="idea-rand">🎲 Sorprèn-me amb 3 idees</button></div>
    </div>
    <div class="game ideas">
      <section aria-label="Banc d'idees"><h2 class="col-title">Banc d'idees</h2><div class="idea-list">${L.map(card).join("")}</div></section>
      <section aria-label="El nostre repte"><h2 class="col-title">El nostre repte</h2>
        <div class="panel repte">
          <fieldset class="desti"><legend>On les aplicarem?</legend>
            <label class="check"><input type="radio" name="desti" value="actual" ${s.desti === "actual" ? "checked" : ""}> A la cançó que estem tocant</label>
            <label class="check"><input type="radio" name="desti" value="nova" ${s.desti === "nova" ? "checked" : ""}> En una cançó nova</label>
          </fieldset>
          <div class="row">
            <label class="f">${s.desti === "nova" ? "Títol provisional (opcional)" : "Quina cançó?"}<input id="idea-canco" value="${esc(s.canco)}" placeholder="${s.desti === "nova" ? "p. ex. La nostra primera cançó" : "p. ex. Sense tu"}"></label>
            <label class="f">Grup o banda<input id="idea-banda" value="${esc(s.banda)}" placeholder="p. ex. Las croquetas de la yaya"></label>
          </div>
          <div id="repte-llista">${repteHTML(a)}</div>
          <div class="share-row"><button type="button" class="btn primary" id="idea-print" ${s.sel.length ? "" : "disabled"}>🖨️ Imprimeix el repte</button><button type="button" class="btn" id="idea-copy" ${s.sel.length ? "" : "disabled"}>📋 Copia el text</button></div>
        </div>
      </section>
    </div>`;
}
function repteHTML(a){
  const s = ideaState(), L = ideesOf(a).filter(x => s.sel.includes(x.id));
  if (!L.length) return `<p class="hint">Marqueu les idees que voleu provar. Us recomanem començar amb 2 o 3.</p>`;
  return `<ol class="repte-ol">${L.map(x => `<li><b>${esc(x.titol)}</b>${x.com ? `<span>${esc(x.com)}</span>` : ""}</li>`).join("")}</ol>`;
}
function repteText(a){
  const s = ideaState(), L = ideesOf(a).filter(x => s.sel.includes(x.id));
  const on = s.desti === "nova" ? `una cançó nova${s.canco ? ` («${s.canco}»)` : ""}` : `la cançó que estem tocant${s.canco ? `: «${s.canco}»` : ""}`;
  return [`El nostre repte de composició${s.banda ? " — " + s.banda : ""}`, `Aplicarem aquestes idees a ${on}:`, ...L.map((x, n) => `${n + 1}. ${x.titol}${x.com ? " — " + x.com : ""}`), "", `Idees sortides de l'activitat «${a.title}» (Rockin)`].join("\n");
}
function refreshIdeas(a){
  const s = ideaState();
  document.querySelectorAll("[data-idea]").forEach(c => { c.checked = s.sel.includes(c.dataset.idea); c.closest(".idea").classList.toggle("on", c.checked); });
  $("#idea-n").textContent = s.sel.length;
  $("#repte-llista").innerHTML = repteHTML(a);
  $("#idea-print").disabled = $("#idea-copy").disabled = !s.sel.length;
}
app.addEventListener("change", e => {
  if (state.mode !== "alumne" || state.part !== 3) return;
  const a = act(), s = ideaState(), t = e.target;
  if (t.dataset.idea){ s.sel = t.checked ? [...s.sel, t.dataset.idea] : s.sel.filter(x => x !== t.dataset.idea); refreshIdeas(a); }
  else if (t.name === "desti"){ s.desti = t.value; renderIdeas(a); }
});
app.addEventListener("input", e => {
  if (state.mode !== "alumne" || state.part !== 3) return;
  if (e.target.id === "idea-canco") ideaState().canco = e.target.value;
  if (e.target.id === "idea-banda") ideaState().banda = e.target.value;
});
app.addEventListener("click", async e => {
  if (state.mode !== "alumne" || state.part !== 3) return;
  const a = act(), s = ideaState(), t = e.target;
  if (t.id === "idea-rand"){ s.sel = shuffle(ideesOf(a).map(x => x.id)).slice(0, 3); refreshIdeas(a); }
  else if (t.id === "idea-copy"){ try { await navigator.clipboard.writeText(repteText(a)); toast("Repte copiat! Ara el podeu enganxar on vulgueu."); } catch (err){ prompt("Copieu aquest text:", repteText(a)); } }
  else if (t.id === "idea-print") printRepte(a);
});
function printRepte(a){
  const s = ideaState(), L = ideesOf(a).filter(x => s.sel.includes(x.id));
  const on = s.desti === "nova" ? `Una cançó nova${s.canco ? `: <b>${esc(s.canco)}</b>` : ""}` : `La cançó que estem tocant${s.canco ? `: <b>${esc(s.canco)}</b>` : ""}`;
  const html = `<!doctype html><html lang="ca"><head><meta charset="utf-8"><title>El nostre repte de composició</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@700&family=Ubuntu:wght@400;500;700&display=swap">
<style>
@page{size:A4;margin:14mm}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Ubuntu,Helvetica,Arial,sans-serif;color:#221F20;font-size:11pt;line-height:1.45;margin:0}
.cap{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #FDBE10;padding-bottom:8px}
.cap img{height:46px;background:#FDBE10;padding:6px 12px;border-radius:2px}
h1{font-family:Lora,Georgia,serif;font-size:21pt;margin:12px 0 2px}
.sub{color:#555;margin:0 0 12px}
ol{padding:0;margin:0;list-style:none;display:grid;gap:10px;counter-reset:n}
li{border:1.5px solid #221F20;border-radius:3px;padding:10px 12px;break-inside:avoid;counter-increment:n}
li h2{font-family:Lora,Georgia,serif;font-size:13pt;margin:0 0 3px}
li h2::before{content:counter(n);display:inline-block;background:#FDBE10;min-width:1.5em;text-align:center;margin-right:8px;border-radius:2px}
li p{margin:0 0 6px}
.marques{display:flex;gap:18px;font-size:10pt;color:#333}
.marques span::before{content:"";display:inline-block;width:11px;height:11px;border:1.5px solid #221F20;margin-right:5px;vertical-align:-1px}
.notes{margin-top:14px;border:1px dashed #999;height:48mm;padding:8px;color:#777;font-size:10pt}
footer{margin-top:12px;font-size:8pt;color:#777}
@media screen{body{max-width:190mm;margin:16px auto;padding:0 12px}}
</style></head><body>
<header class="cap"><img src="https://rockin.cat/wp-content/uploads/2022/07/rockin-logo.svg" alt="Rockin"><div>${s.banda ? `Grup: <b>${esc(s.banda)}</b>` : ""}</div></header>
<h1>El nostre repte de composició</h1>
<p class="sub">${on} · Idees sortides de l'activitat «${esc(a.title)}»</p>
<ol>${L.map(x => { const ex = a.items.find(i => i.id === x.exemple); return `<li><h2>${esc(x.titol)}</h2>${x.desc ? `<p>${esc(x.desc)}</p>` : ""}${x.com ? `<p><b>Com provar-ho:</b> ${esc(x.com)}</p>` : ""}${ex && ex.title ? `<p><small>🎧 Exemple: ${esc(ex.title)}</small></p>` : ""}<div class="marques"><span>Ho hem provat</span><span>Ens agrada</span><span>Ho deixem</span></div></li>`; }).join("")}</ol>
<div class="notes">Notes del grup: qui fa què, en quina part de la cançó, què hem canviat…</div>
<footer>© Rockin SCCL · CC BY-NC-SA 4.0 · rockin-cat.github.io/escolta-i-compon</footer>
<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),400));<\/script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w){ toast("El navegador ha bloquejat la finestra. Permet les finestres emergents per imprimir."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* ---------- versió imprimible (fitxa de l'alumnat i full del docent) ---------- */
function printForm(a){
  const err = actError(a); if (err){ toast(err); return; }
  $("#share-out").innerHTML = `<div class="share-form">
    <div class="row">
      <label class="f">Docent<input id="pr-docent" value="${esc(llegirLocal(K_AUTOR))}" placeholder="Nom i cognom"></label>
      <label class="f">Grup<input id="pr-grup" value="${esc(llegirLocal("ea-grup"))}" placeholder="p. ex. 2n ESO B"></label>
    </div>
    <div class="share-row">
      <button class="btn primary" data-print="alumne">🖨️ Fitxa de l'alumnat</button>
      <button class="btn" data-print="docent">🖨️ Full del docent (solucions)</button>
      <button class="btn ghost" id="pr-cancel">Tanca</button>
    </div>
    <p class="hint">Les lletres dels fragments es barregen cada vegada que imprimeixes. Imprimeix els dos fulls alhora perquè el del docent tingui les mateixes lletres.</p>
  </div>`;
  let ordre = null;
  $("#pr-cancel").onclick = () => $("#share-out").innerHTML = "";
  $("#share-out").querySelectorAll("[data-print]").forEach(b => b.onclick = () => {
    const docent = $("#pr-docent").value.trim(), grup = $("#pr-grup").value.trim();
    if (docent) escriureLocal(K_AUTOR, docent);
    escriureLocal("ea-grup", grup);
    if (!ordre) ordre = {cancons: shuffle(a.items.map(i => i.id)), vocab: shuffle((a.vocab || []).filter(v => v.term && v.def).map(v => v.id))};
    printSheet(cleanAct(a), b.dataset.print === "docent", docent, grup, ordre);
  });
}
function printSheet(a, docentView, docent, grup, ordre){
  const lletra = id => LETTERS[ordre.cancons.indexOf(id)] || "?";
  const vocab = (a.vocab || []), numV = id => ordre.vocab.indexOf(id) + 1;
  const sol = t => docentView ? `<span class="sol">${esc(t)}</span>` : "";
  const cap = `<header class="cap">
      <img src="https://rockin.cat/wp-content/uploads/2022/07/rockin-logo.svg" alt="Rockin">
      <div class="dades">
        ${docentView ? `<div><b>Full del docent · solucions</b></div>` : `<div>Nom i cognoms: <span class="linia"></span></div>`}
        <div>Grup: <b>${esc(grup) || '<span class="linia curta"></span>'}</b> &nbsp; Data: <span class="linia curta"></span></div>
        ${docent ? `<div>Docent: <b>${esc(docent)}</b></div>` : ""}
      </div>
    </header>
    <h1>${esc(a.title)}</h1>`;
  const escolta = docentView ? `<h2>Ordre dels fragments</h2>
    <table class="ordre"><thead><tr><th>Fragment</th><th>Cançó</th><th>Enllaç</th></tr></thead><tbody>
    ${ordre.cancons.map(id => { const it = a.items.find(i => i.id === id); return `<tr><td class="ll">${lletra(id)}</td><td>${esc(it.title || "—")}${it.start && it.start !== "0:00" ? ` <small>(des de ${esc(it.start)})</small>` : ""}</td><td class="url">${esc(watchUrl(it.video, it.start))}</td></tr>`; }).join("")}
    </tbody></table>` : "";
  const part1 = `<h2>1. Escolta i relaciona</h2>
    <p class="ins">Escoltaràs ${a.items.length} fragments (${LETTERS[0]}–${LETTERS[a.items.length - 1]}). Escriu a cada casella la lletra del fragment que correspon a la descripció.</p>
    <ol class="descs">${a.items.map(it => `<li><span class="caixa">${sol(lletra(it.id))}</span><p>${esc(it.desc)}</p></li>`).join("")}</ol>`;
  const part2 = vocab.length ? `<h2>2. Vocabulari musical</h2>
    <p class="ins">${esc(a.vocabInstructions || "Relaciona cada concepte amb la seva definició.")} Escriu a cada casella el número del concepte.</p>
    <div class="banc">${ordre.vocab.map(id => { const v = vocab.find(x => x.id === id); return `<span><b>${numV(id)}</b> ${esc(v.term)}</span>`; }).join("")}</div>
    <ol class="descs defs">${vocab.map(v => `<li><span class="caixa">${sol(numV(v.id))}</span><p>${esc(v.def)}</p></li>`).join("")}</ol>` : "";
  const idees = ideesOf(a);
  const part3 = idees.length ? `<section class="p3"><h2>${vocab.length ? 3 : 2}. Idees per a la nostra cançó</h2>
    <p class="ins">${esc(a.ideesInstructions || "Totes aquestes idees han sortit a les cançons que heu escoltat.")} Marqueu les que voleu provar (us recomanem començar amb 2 o 3).</p>
    <ul class="idees">${idees.map(x => { const ex = a.items.find(i => i.id === x.exemple); return `<li><span class="quadre"></span><div><b>${esc(x.titol)}</b>${x.desc ? ` — ${esc(x.desc)}` : ""}${docentView && ex && ex.title ? `<br><small>🎧 ${lletra(ex.id)} · ${esc(ex.title)}</small>` : ""}${docentView && x.com ? `<br><small><b>Com provar-ho:</b> ${esc(x.com)}</small>` : ""}</div></li>`; }).join("")}</ul>
    <div class="repte">
      <div>Grup o banda: <span class="linia llarga"></span></div>
      <div><span class="quadre"></span> A la cançó que estem tocant: <span class="linia"></span></div>
      <div><span class="quadre"></span> En una cançó nova. Títol provisional: <span class="linia"></span></div>
      <div class="notes">Com ho farem? Qui fa què, en quina part de la cançó…</div>
    </div></section>` : "";
  const html = `<!doctype html><html lang="ca"><head><meta charset="utf-8"><title>${esc(a.title)}${docentView ? " · solucions" : ""}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@700&family=Ubuntu:wght@400;500;700&display=swap">
<style>
@page{size:A4;margin:14mm 14mm 16mm}
*{box-sizing:border-box}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Ubuntu,Helvetica,Arial,sans-serif;color:#221F20;font-size:10.5pt;line-height:1.4;margin:0}
.cap{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:3px solid #FDBE10;padding-bottom:8px}
.cap img{height:46px;background:#FDBE10;padding:6px 12px;border-radius:2px}
.dades{display:grid;gap:4px;text-align:right;font-size:10pt}
.linia{display:inline-block;width:62mm;border-bottom:1px solid #221F20;height:1em;vertical-align:bottom}
.linia.curta{width:28mm}
h1{font-family:Lora,Georgia,serif;font-size:20pt;margin:12px 0 4px}
h2{font-family:Lora,Georgia,serif;font-size:13pt;margin:16px 0 4px;padding:2px 8px;background:#FDBE10;display:inline-block}
.ins{margin:4px 0 8px;color:#444}
ol.descs{list-style:none;padding:0;margin:0;display:grid;gap:7px}
ol.descs li{display:grid;grid-template-columns:13mm 1fr;gap:10px;align-items:start;break-inside:avoid}
ol.descs p{margin:0}
.caixa{width:13mm;height:11mm;border:1.5px solid #221F20;border-radius:2px;display:flex;align-items:center;justify-content:center}
.sol{font-weight:700;font-size:15pt;color:#C0392B}
.banc{display:flex;flex-wrap:wrap;gap:6px 14px;border:1px dashed #999;padding:8px 10px;margin-bottom:8px}
.banc b{display:inline-block;min-width:1.4em;text-align:center;background:#221F20;color:#FDBE10;border-radius:2px;margin-right:3px}
table.ordre{border-collapse:collapse;width:100%;font-size:10pt}
table.ordre th,table.ordre td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
td.ll{font-weight:700;font-size:13pt;text-align:center;width:16mm}
td.url{font-size:8pt;word-break:break-all;width:62mm}
.p3{break-before:page}
ul.idees{list-style:none;padding:0;margin:0;display:grid;gap:6px}
ul.idees li{display:grid;grid-template-columns:7mm 1fr;gap:6px;align-items:start;break-inside:avoid}
.quadre{display:inline-block;width:4.5mm;height:4.5mm;border:1.5px solid #221F20;border-radius:1px;vertical-align:-2px;margin-right:4px}
.repte{margin-top:12px;border:1.5px solid #221F20;border-radius:3px;padding:10px 12px;display:grid;gap:10px}
.linia.llarga{width:120mm}
.repte .notes{border:1px dashed #999;height:42mm;padding:6px 8px;color:#777;font-size:9.5pt}
footer{margin-top:14px;font-size:8pt;color:#777;border-top:1px solid #ddd;padding-top:4px}
@media screen{body{max-width:190mm;margin:16px auto;padding:0 12px}}
</style></head><body>
${cap}${escolta}${part1}${part2}${part3}
<footer>© Rockin SCCL · CC BY-NC-SA 4.0 · rockin-cat.github.io/escolta-i-compon</footer>
<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),400));<\/script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w){ toast("El navegador ha bloquejat la finestra. Permet les finestres emergents per imprimir."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* ---------- biblioteca de propostes (Google Apps Script + Drive) ---------- */
let biblioLlista = [];
function codiBiblio(forcar){
  let c = forcar ? "" : llegirLocal(K_CODI);
  if (!c){ c = (prompt("Escriu el codi del professorat per accedir a la biblioteca de propostes:") || "").trim(); if (c) escriureLocal(K_CODI, c); }
  return c;
}
async function peticioBiblio(metode, dades){
  if (!URL_BIBLIOTECA) throw new Error("no-config");
  const codi = codiBiblio(false); if (!codi) throw new Error("sense-codi");
  let r;
  if (metode === "GET") r = await fetch(URL_BIBLIOTECA + "?" + new URLSearchParams({codi, ...(dades || {})}));
  else r = await fetch(URL_BIBLIOTECA, {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body: JSON.stringify({codi, ...dades})});
  const j = await r.json();
  if (!j.ok && j.error === "codi"){ escriureLocal(K_CODI, ""); throw new Error("codi"); }
  return j;
}
function missatgeError(e){
  const m = e && e.message;
  if (m === "no-config") return "La biblioteca encara no està connectada. Cal posar l'adreça de l'script de Google a URL_BIBLIOTECA (app.js).";
  if (m === "codi") return "El codi del professorat no és correcte.";
  if (m === "sense-codi") return "Cal el codi del professorat.";
  if (m === "existeix") return "Ja hi ha una proposta amb aquest títol i autoria.";
  return "No s'ha pogut connectar amb la biblioteca. Torna-ho a provar d'aquí a una estona.";
}
async function publishAct(a){
  const err = actError(a); if (err){ toast(err); return; }
  const out = $("#share-out");
  out.innerHTML = `<div class="share-form">
    <div class="row">
      <label class="f">Autor/a (com vols que surti)<input id="pub-autor" value="${esc(llegirLocal(K_AUTOR))}" placeholder="Nom i cognom"></label>
      <label class="f">Curs o nivell (opcional)<input id="pub-curs" placeholder="p. ex. 2n ESO"></label>
    </div>
    <label class="f">Centre (opcional)<input id="pub-centre" placeholder="p. ex. Institut Margarida Xirgu"></label>
    <div class="share-row"><button class="btn primary" id="pub-go">Publica a la biblioteca</button><button class="btn ghost" id="pub-cancel">Cancel·la</button></div>
  </div>`;
  $("#pub-cancel").onclick = () => out.innerHTML = "";
  $("#pub-go").onclick = async () => {
    const autor = $("#pub-autor").value.trim(); if (!autor){ toast("Escriu el teu nom."); return; }
    escriureLocal(K_AUTOR, autor);
    const act = cleanAct(a);
    const info = {titol: act.title, autor, curs: $("#pub-curs").value.trim(), centre: $("#pub-centre").value.trim(), cancons: act.items.length, conceptes: act.vocab.length};
    const nom = act.title + " - " + autor;
    const envia = async sobreescriure => peticioBiblio("POST", {nom, sobreescriure, activitat: act, info});
    $("#pub-go").disabled = true; $("#pub-go").textContent = "Publicant…";
    try {
      let j = await envia(false);
      if (!j.ok && j.error === "existeix" && confirm("Ja has compartit una proposta amb aquest títol. Vols substituir-la per aquesta versió?")) j = await envia(true);
      if (!j.ok) throw new Error(j.error || "error");
      biblioLlista = [];
      out.innerHTML = `<p class="ok-msg">✅ «${esc(act.title)}» ja és a la biblioteca de propostes.</p>`;
    } catch (e){ out.innerHTML = `<p class="warn">${esc(missatgeError(e))}</p>`; }
  };
}
function modal(html){
  let m = $("#modal"); if (!m){ m = document.createElement("div"); m.id = "modal"; m.className = "modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); document.body.appendChild(m);
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) m.hidden = true; }); }
  m.innerHTML = `<div class="modal-box">${html}</div>`; m.hidden = false; return m;
}
async function openLibrary(refresh){
  const m = modal(`<div class="modal-head"><h2>📚 Biblioteca de propostes</h2><button class="btn small ghost" data-close>Tanca</button></div>
    <p class="hint">Activitats que ha compartit el professorat. Pots afegir-ne una a les teves per adaptar-la, o treure'n directament l'enllaç per a l'alumnat.</p>
    <input id="bib-cerca" class="bib-cerca" placeholder="Cerca per títol, autor/a, curs o centre…" aria-label="Cerca">
    <div id="bib-llista" class="bib-llista"><p class="hint">Carregant…</p></div>
    <div class="modal-foot"><button class="btn small ghost" id="bib-codi">🔑 Canvia el codi</button></div>`);
  $("#bib-codi", m).onclick = () => { if (codiBiblio(true)) openLibrary(true); };
  $("#bib-cerca", m).oninput = pintaBiblio;
  if (biblioLlista.length && !refresh) return pintaBiblio();
  try { const j = await peticioBiblio("GET"); if (!j.ok) throw new Error(j.error); biblioLlista = j.llista || []; pintaBiblio(); }
  catch (e){ $("#bib-llista").innerHTML = `<p class="warn">${esc(missatgeError(e))}</p>`; }
}
function pintaBiblio(){
  const q = ($("#bib-cerca")?.value || "").toLowerCase().trim();
  const L = biblioLlista.filter(x => !q || [x.titol, x.autor, x.curs, x.centre, x.nom].join(" ").toLowerCase().includes(q));
  $("#bib-llista").innerHTML = L.length ? L.map(x => `<div class="bib-fila">
      <div class="bib-info"><b>${esc(x.titol || x.nom)}</b>
        <span>${esc([x.autor, x.centre, x.curs].filter(Boolean).join(" · "))}</span>
        <span class="meta">${x.cancons || "?"} cançons${x.conceptes ? ` · ${x.conceptes} conceptes` : ""} · ${esc((x.data || "").slice(0, 10))}</span></div>
      <div class="bib-acc"><button class="btn small" data-bib-add="${esc(x.id)}">Afegeix a les meves</button><button class="btn small ghost" data-bib-link="${esc(x.id)}">🔗 Enllaç alumnat</button></div>
    </div>`).join("") : `<p class="hint">${biblioLlista.length ? "Cap proposta coincideix amb la cerca." : "Encara no hi ha cap proposta. Sigues la primera persona a compartir-ne una!"}</p>`;
}
document.addEventListener("click", async e => {
  const add = e.target.closest("[data-bib-add]"), lnk = e.target.closest("[data-bib-link]");
  if (!add && !lnk) return;
  const btn = add || lnk, id = btn.dataset.bibAdd || btn.dataset.bibLink, txt = btn.textContent;
  btn.disabled = true; btn.textContent = "…";
  try {
    const j = await peticioBiblio("GET", {id}); if (!j.ok || !j.activitat) throw new Error(j.error || "error");
    const a = j.activitat;
    if (add){
      reId(a);
      if (!state.draft) state.draft = clone(DATA);
      state.draft.activitats.push(a); state.actId = a.id; stash();
      $("#modal").hidden = true; state.msg = `S'ha afegit «${a.title}» a les teves activitats.`; renderEditorKeep(); window.scrollTo(0, 0);
      return;
    }
    const url = studentUrl(await packAct(a));
    try { await navigator.clipboard.writeText(url); toast("Enllaç per a l'alumnat copiat!"); } catch (err){ prompt("Copia aquest enllaç:", url); }
  } catch (err){ toast(missatgeError(err)); }
  btn.disabled = false; btn.textContent = txt;
});

/* ---------- chrome ---------- */
function renderModes(){
  if (!TEACHER || SHARED){ $("#modes").hidden = true; return; }
  $("#modes").innerHTML = `<button type="button" data-mode="alumne" aria-pressed="${state.mode === "alumne"}">Alumnat</button><button type="button" data-mode="prof" aria-pressed="${state.mode === "prof"}">Professorat</button>`;
}
function renderTabs(){
  const list = SRC().activitats, nav = $("#acts");
  nav.hidden = list.length < 2 && state.mode !== "prof";
  const tab = a => `<button type="button" data-act="${a.id}" aria-current="${a.id === state.actId}">${esc(a.title || "Nova activitat")}</button>`;
  if (state.mode !== "prof"){ nav.innerHTML = list.map(tab).join(""); return; }
  const oficials = list.filter(a => DATA.activitats.some(o => o.id === a.id)), meves = list.filter(a => !oficials.includes(a));
  nav.innerHTML = (oficials.length ? `<span class="acts-lab">De Rockin</span>${oficials.map(tab).join("")}` : "")
    + (meves.length ? `<span class="acts-lab">Les meves</span>${meves.map(tab).join("")}` : "");
}
function render(){ renderModes(); renderTabs(); state.mode === "prof" ? renderEditor() : renderGame(); }

$("#modes").addEventListener("click", e => {
  const b = e.target.closest("[data-mode]"); if (!b || b.dataset.mode === state.mode) return;
  stopAll();
  state.mode = b.dataset.mode;
  if (state.mode === "prof" && !state.draft) state.draft = clone(DATA);
  if (state.mode === "alumne"){ if (!SRC().activitats.some(a => a.id === state.actId)) state.actId = SRC().activitats[0]?.id || null; state.game = null; state.voc = null; state.ideas = null; state.part = 1; }
  render(); window.scrollTo(0, 0);
});
$("#acts").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  stopAll(); state.actId = b.dataset.act; state.game = null; state.voc = null; state.ideas = null; state.part = 1; render();
});

/* teacher's own activities, kept in this browser */
try {
  const s = JSON.parse(llegirLocal(K_DRAFT) || "null");
  if (TEACHER && s && s.d && Array.isArray(s.d.activitats)){ state.draft = s.d; state.actId = s.act; }
} catch (e) {}
async function boot(){
  const h = location.hash.match(/^#a=([\w-]+)/);
  if (h){
    try { const a = await unpackAct(h[1]); if (!a || !Array.isArray(a.items)) throw new Error("format"); DATA = {activitats: [a]}; SHARED = true; state.actId = a.id; return; }
    catch (e){ toast("L'enllaç de l'activitat no és correcte o està incomplet."); }
  }
  const r = await fetch("activitats.json", {cache: "no-store"}); if (!r.ok) throw new Error(r.status); return r.json();
}
window.addEventListener("hashchange", () => location.reload());
boot()
  .then(d => { if (d && Array.isArray(d.activitats)) DATA = d; })
  .catch(() => { app.innerHTML = `<div class="head"><h1>No s'han pogut carregar les activitats</h1><p>Comprova que el fitxer activitats.json és a la mateixa carpeta que aquesta pàgina i que el JSON és vàlid.</p></div>`; })
  .finally(() => { if (SHARED) document.title = (DATA.activitats[0].title || "Activitat") + " · Rockin"; if (!state.actId || !SRC().activitats.some(a => a.id === state.actId)) state.actId = SRC().activitats[0]?.id || null; if (SRC().activitats.length) render(); });
})();
