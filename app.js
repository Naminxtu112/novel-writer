import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  query, where, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, APP_BASE_PATH } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let currentNovel = null;
let chapters = [];
let activeChapterId = null;
let proofMode = false;
let saveTimer = null;
let dirtyNovel = false;
let dirtyChapterIds = new Set();

const defaultPage = { preset: "A6", fontSize: 10.5, charsPerLine: 40, linesPerPage: 16, realPageMode: false };
const defaultDisplay = { fontSize: 16 };
const defaultDeadlineLabels = { early: "早割り", standard: "標準", express: "特急" };
const defaultRules = [
  { from: "出来る", to: "できる" }, { from: "下さい", to: "ください" }, { from: "致します", to: "いたします" },
  { from: "と言う", to: "という" }, { from: "事", to: "こと" }, { from: "様な", to: "ような" }
];
const defaultCharacterFieldLabels = ["名前", "性格", "容姿", "背景", "役割", "メモ"];

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function showView(id) {
  ["authView", "dashboardView", "editorView"].forEach(v => $(v).classList.toggle("hidden", v !== id));
}
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 2400);
}
function loginEmail(id) {
  const clean = id.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (!clean) throw new Error("ログインIDを入力してください。");
  return `${clean}@novel.local`;
}
function basePath() {
  let b = APP_BASE_PATH || "/";
  if (!b.startsWith("/")) b = "/" + b;
  if (!b.endsWith("/")) b += "/";
  return b;
}
function pathForSlug(slug) { return `${basePath()}write/${encodeURIComponent(slug)}`; }
function routeSlug() {
  let p = decodeURIComponent(location.pathname), b = basePath();
  if (p.startsWith(b)) p = p.slice(b.length);
  const m = p.match(/^write\/([^/]+)/);
  return m ? m[1] : null;
}

const redirectParam = new URLSearchParams(location.search).get("redirect");
if (redirectParam) history.replaceState({}, "", redirectParam);

function slugifyLatin(s) {
  return s.toLowerCase().trim().replace(/[’'"]/g, "").replace(/&/g, "-and-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}
const kana = { "きゃ": "kya", "きゅ": "kyu", "きょ": "kyo", "しゃ": "sha", "しゅ": "shu", "しょ": "sho", "ちゃ": "cha", "ちゅ": "chu", "ちょ": "cho", "にゃ": "nya", "にゅ": "nyu", "にょ": "nyo", "ひゃ": "hya", "ひゅ": "hyu", "ひょ": "hyo", "みゃ": "mya", "みゅ": "myu", "みょ": "myo", "りゃ": "rya", "りゅ": "ryu", "りょ": "ryo", "ぎゃ": "gya", "ぎゅ": "gyu", "ぎょ": "gyo", "じゃ": "ja", "じゅ": "ju", "じょ": "jo", "びゃ": "bya", "びゅ": "byu", "びょ": "byo", "ぴゃ": "pya", "ぴゅ": "pyu", "ぴょ": "pyo", "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o", "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko", "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so", "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to", "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no", "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho", "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo", "や": "ya", "ゆ": "yu", "よ": "yo", "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro", "わ": "wa", "を": "o", "ん": "n", "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go", "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo", "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do", "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo", "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po", "ー": "-" };
function katakanaToHiragana(s) { return s.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)); }
function kanaToRomaji(s) {
  s = katakanaToHiragana(s.trim());
  let out = "", gem = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "っ") { gem = true; continue; }
    const pair = s.slice(i, i + 2);
    let r = kana[pair];
    if (r) i++;
    else r = kana[s[i]] || (/\s/.test(s[i]) ? "-" : "");
    if (gem && r) { r = r[0] + r; gem = false; }
    out += r;
  }
  return slugifyLatin(out);
}
function suggestSlug() {
  const src = $("newReading").value.trim() || $("newTitle").value.trim();
  $("newSlug").value = kanaToRomaji(src) || slugifyLatin(src) || `work-${Date.now()}`;
}

function createDefaultFlow() {
  return {
    lanes: [{ id: uid("lane"), name: "ライン1" }],
    nodes: [],
    links: [],
    timeLabels: []
  };
}
function createCharacterSheet(index = 1) {
  return {
    id: uid("char"),
    title: `キャラ${index}`,
    fields: defaultCharacterFieldLabels.map(label => ({ id: uid("field"), label, value: "" }))
  };
}
function normalizeCharacterRelations(relations, sheets) {
  const ids = new Set(sheets.map(s => s.id));
  const out = Array.isArray(relations) ? structuredClone(relations) : [];
  return out.filter(r => r && r.id && ids.has(r.from) && ids.has(r.to) && r.from !== r.to).map(r => ({
    id: r.id,
    from: r.from,
    to: r.to,
    label: r.label || "関係",
    lineStyle: ["solid","dashed","dashdot"].includes(r.lineStyle) ? r.lineStyle : "solid",
    color: /^#[0-9a-fA-F]{6}$/.test(r.color || "") ? r.color : "#6f6a61",
    arrowStart: r.arrowStart === true,
    arrowEnd: r.arrowEnd === true || Boolean(r.directed)
  }));
}
function normalizeFlow(flow) {
  const safe = flow && typeof flow === "object" ? structuredClone(flow) : createDefaultFlow();
  safe.lanes = Array.isArray(safe.lanes) ? safe.lanes.filter(l => l && l.id) : [];
  if (!safe.lanes.length) safe.lanes = createDefaultFlow().lanes;
  safe.nodes = Array.isArray(safe.nodes) ? safe.nodes.filter(n => n && n.id) : [];
  safe.links = Array.isArray(safe.links) ? safe.links.filter(l => l && l.id) : [];
  safe.timeLabels = Array.isArray(safe.timeLabels) ? safe.timeLabels.filter(x => x && x.id) : [];
  safe.lanes.forEach((lane, i) => { if (!lane.name) lane.name = `ライン${i + 1}`; });
  safe.nodes.forEach((node, i) => {
    if (!safe.lanes.some(l => l.id === node.laneId)) node.laneId = safe.lanes[0].id;
    node.row = Math.max(1, Number(node.row) || (i + 1));
    node.text = node.text || "";
    node.offsetX = Number(node.offsetX) || 0;
    node.offsetY = Number(node.offsetY) || 0;
  });
  safe.timeLabels.forEach((label, i) => {
    label.text = label.text || `時系列${i + 1}`;
    label.y = Number(label.y) || (120 + i * 130);
  });
  safe.links = safe.links.filter(link => safe.nodes.some(n => n.id === link.from) && safe.nodes.some(n => n.id === link.to));
  return safe;
}
function normalizeCharacterSheets(sheets) {
  let out = Array.isArray(sheets) ? structuredClone(sheets) : [];
  out = out.filter(s => s && s.id);
  if (!out.length) out = [createCharacterSheet(1)];
  out.forEach((sheet, index) => {
    if (!sheet.title) sheet.title = `キャラ${index + 1}`;
    sheet.graphX = Number.isFinite(Number(sheet.graphX)) ? Number(sheet.graphX) : null;
    sheet.graphY = Number.isFinite(Number(sheet.graphY)) ? Number(sheet.graphY) : null;
    const fields = Array.isArray(sheet.fields) ? sheet.fields.filter(f => f && f.id) : [];
    if (!fields.length) {
      sheet.fields = defaultCharacterFieldLabels.map(label => ({ id: uid("field"), label, value: "" }));
    } else {
      sheet.fields = fields;
      sheet.fields.forEach((field, idx) => {
        if (!field.label) field.label = defaultCharacterFieldLabels[idx] || `項目${idx + 1}`;
        if (field.value == null) field.value = "";
      });
    }
  });
  return out;
}

async function signup() {
  try {
    const id = $("loginId").value.trim(), pw = $("loginPassword").value;
    if (pw.length < 6) throw new Error("パスワードは6文字以上にしてください。");
    const cred = await createUserWithEmailAndPassword(auth, loginEmail(id), pw);
    await setDoc(doc(db, "users", cred.user.uid), { loginId: id, createdAt: serverTimestamp() });
    toast("ユーザーを作成しました。");
  } catch (e) { toast(e.message); }
}
async function login() {
  try { await signInWithEmailAndPassword(auth, loginEmail($("loginId").value), $("loginPassword").value); }
  catch { toast("ログインできませんでした。IDまたはパスワードを確認してください。"); }
}
async function loadUserLabel(user) {
  const s = await getDoc(doc(db, "users", user.uid));
  $("currentUserLabel").textContent = s.exists() ? ` / ${s.data().loginId || ""}` : "";
}

async function loadNovelList() {
  const q = query(collection(db, "novels"), where("ownerId", "==", auth.currentUser.uid));
  const snaps = await getDocs(q);
  const items = snaps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const at = a.updatedAt?.toMillis?.() || 0, bt = b.updatedAt?.toMillis?.() || 0;
    return bt - at;
  });
  const box = $("novelList"); box.innerHTML = "";
  if (!items.length) { box.innerHTML = '<p class="muted">まだ作品がありません。</p>'; return; }
  items.forEach(n => {
    const card = document.createElement("div"); card.className = "novel-card";
    const main = document.createElement("div"); main.className = "novel-card-main";
    const h = document.createElement("h3"); h.textContent = n.title;
    const slug = document.createElement("div"); slug.className = "slug"; slug.textContent = `/write/${n.slug}`;
    const meta = document.createElement("p"); meta.className = "muted small"; meta.textContent = `${(n.targetWords || 80000).toLocaleString()}字`;
    main.append(h, slug, meta); main.onclick = () => openNovelById(n.id, n.slug);
    const actions = document.createElement("div"); actions.className = "novel-card-actions";
    const del = document.createElement("button"); del.className = "danger"; del.textContent = "作品を削除";
    del.onclick = e => { e.stopPropagation(); deleteNovel(n); };
    actions.appendChild(del); card.append(main, actions); box.appendChild(card);
  });
}

async function createNovel() {
  try {
    const title = $("newTitle").value.trim(), slug = slugifyLatin($("newSlug").value);
    if (!title) throw new Error("作品名を入力してください。");
    if (!slug) throw new Error("URL名を入力してください。");
    const uidValue = auth.currentUser.uid, slugRef = doc(db, "slugs", `${uidValue}_${slug}`);
    if ((await getDoc(slugRef)).exists()) throw new Error("同じURL名の作品があります。");
    const deadlines = { early: $("newEarly").value, standard: $("newStandard").value, express: $("newExpress").value };
    const active = ["early", "standard", "express"].find(k => deadlines[k]) || "early";
    const novelRef = doc(collection(db, "novels"));
    const chapterRef = doc(collection(db, "novels", novelRef.id, "chapters"));
    const batch = writeBatch(db);
    batch.set(novelRef, {
      ownerId: uidValue,
      title,
      slug,
      targetWords: Number($("newTarget").value) || 80000,
      deadlines,
      deadlineLabels: { ...defaultDeadlineLabels },
      activeDeadline: active,
      outlineText: "",
      outlineFlow: createDefaultFlow(),
      charactersText: "",
      characterSheets: [createCharacterSheet(1)],
      characterRelations: [],
      page: { ...defaultPage },
      editorDisplay: { ...defaultDisplay },
      customRules: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(chapterRef, { title: "第1章", order: 0, text: "", updatedAt: serverTimestamp() });
    batch.set(slugRef, { ownerId: uidValue, novelId: novelRef.id, slug, createdAt: serverTimestamp() });
    await batch.commit();
    $("newNovelDialog").close();
    await openNovelById(novelRef.id, slug);
  } catch (e) { toast(e.message); }
}

async function deleteNovel(novel) {
  if (!confirm(`「${novel.title}」を削除します。\n本文・アウトライン・キャラ設定を含め、元に戻せません。`)) return;
  if (!confirm("本当に削除しますか？")) return;
  try {
    const ch = await getDocs(collection(db, "novels", novel.id, "chapters"));
    for (let i = 0; i < ch.docs.length; i += 400) {
      const b = writeBatch(db);
      ch.docs.slice(i, i + 400).forEach(d => b.delete(d.ref));
      await b.commit();
    }
    const b = writeBatch(db);
    b.delete(doc(db, "slugs", `${auth.currentUser.uid}_${novel.slug}`));
    b.delete(doc(db, "novels", novel.id));
    await b.commit();
    localStorage.removeItem(`novelShadow_${auth.currentUser.uid}_${novel.id}`);
    toast("作品を削除しました。");
    await loadNovelList();
  } catch (e) {
    console.error(e);
    toast("作品を削除できませんでした。Firestore Rulesも確認してください。");
  }
}

async function dashboard() {
  currentNovel = null; chapters = []; activeChapterId = null; dirtyNovel = false; dirtyChapterIds.clear();
  showView("dashboardView");
  if (location.pathname !== basePath()) history.replaceState({}, "", basePath());
  await loadNovelList();
}
async function openNovelBySlug(slug) {
  const s = await getDoc(doc(db, "slugs", `${auth.currentUser.uid}_${slug}`));
  if (!s.exists()) { toast("この作品を開けません。"); return dashboard(); }
  return openNovelById(s.data().novelId, slug, false);
}
async function openNovelById(id, slug, push = true) {
  const s = await getDoc(doc(db, "novels", id));
  if (!s.exists()) { toast("作品が見つかりません。"); return; }
  currentNovel = { id, ...s.data() };
  currentNovel.page = { ...defaultPage, ...(currentNovel.page || {}) };
  currentNovel.editorDisplay = { ...defaultDisplay, ...(currentNovel.editorDisplay || {}) };
  currentNovel.deadlines = { early: "", standard: "", express: "", ...(currentNovel.deadlines || {}) };
  currentNovel.deadlineLabels = { ...defaultDeadlineLabels, ...(currentNovel.deadlineLabels || {}) };
  currentNovel.customRules = currentNovel.customRules || [];
  currentNovel.outlineText = currentNovel.outlineText || "";
  currentNovel.outlineFlow = normalizeFlow(currentNovel.outlineFlow);
  currentNovel.charactersText = currentNovel.charactersText || "";
  currentNovel.characterSheets = normalizeCharacterSheets(currentNovel.characterSheets);
  currentNovel.characterRelations = normalizeCharacterRelations(currentNovel.characterRelations, currentNovel.characterSheets);
  const configured = ["early", "standard", "express"].filter(k => currentNovel.deadlines[k]);
  if (configured.length && !configured.includes(currentNovel.activeDeadline)) currentNovel.activeDeadline = configured[0];
  const cs = await getDocs(collection(db, "novels", id, "chapters"));
  chapters = cs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
  activeChapterId = chapters[0]?.id || null;
  dirtyNovel = false; dirtyChapterIds.clear();
  if (push) history.pushState({}, "", pathForSlug(slug));
  renderEditorView();
}

function activeChapter() { return chapters.find(c => c.id === activeChapterId); }
function flushEditor() {
  if (!currentNovel || !activeChapter()) return;
  activeChapter().text = $("editor").innerText.replace(/\u00a0/g, " ");
  localShadowSave();
}
function flushAux() {
  if (!currentNovel) return;
  currentNovel.outlineText = $("outlineEditor").innerText.replace(/\u00a0/g, " ");
  currentNovel.charactersText = $("charactersEditor").innerText.replace(/\u00a0/g, " ");
  localShadowSave();
}
function localShadowSave() {
  if (!currentNovel) return;
  localStorage.setItem(`novelShadow_${auth.currentUser.uid}_${currentNovel.id}`, JSON.stringify({
    savedAt: Date.now(),
    chapters,
    outlineText: currentNovel.outlineText,
    outlineFlow: currentNovel.outlineFlow,
    charactersText: currentNovel.charactersText,
    characterSheets: currentNovel.characterSheets,
    characterRelations: currentNovel.characterRelations
  }));
}

function renderEditorView() {
  showView("editorView");
  $("novelTitleLabel").textContent = currentNovel.title;
  ["editor", "outlineEditor", "charactersEditor"].forEach(id => $(id).style.fontSize = `${currentNovel.editorDisplay.fontSize}px`);
  $("outlineEditor").textContent = currentNovel.outlineText;
  $("charactersEditor").textContent = currentNovel.charactersText;
  renderChapterTabs();
  renderActiveChapter();
  renderFlowEditor();
  renderCharacterSheets();
  renderCharacterRelations();
  showWorkspace("manuscript");
  refreshStats();
  updateCountdown();
}
function showWorkspace(page) {
  const pages = { manuscript: $("manuscriptPage"), outline: $("outlinePage"), characters: $("charactersPage") };
  Object.entries(pages).forEach(([k, e]) => e.classList.toggle("hidden", k !== page));
  $("chapterBar").classList.toggle("hidden", page !== "manuscript");
  [["manuscriptPageBtn", "manuscript"], ["outlinePageBtn", "outline"], ["charactersPageBtn", "characters"]].forEach(([id, k]) => $(id).classList.toggle("active", k === page));
}
function renderChapterTabs() {
  const box = $("chapterTabs");
  box.innerHTML = "";
  chapters.forEach(ch => {
    const wrap = document.createElement("div");
    wrap.className = "chapter-tab-wrap" + (ch.id === activeChapterId ? " active" : "");
    const b = document.createElement("button");
    b.className = "chapter-tab"; b.textContent = ch.title; b.title = "クリックで移動 / ダブルクリックで名称変更";
    b.onclick = () => { flushEditor(); activeChapterId = ch.id; renderChapterTabs(); renderActiveChapter(); };
    b.ondblclick = () => renameChapter(ch);
    const del = document.createElement("button");
    del.className = "chapter-delete"; del.textContent = "×"; del.title = "この章を削除";
    del.onclick = e => { e.stopPropagation(); deleteChapter(ch); };
    wrap.append(b, del); box.appendChild(wrap);
  });
}
function renderActiveChapter() {
  proofMode = false;
  $("proofSummary").classList.add("hidden");
  $("editor").textContent = activeChapter()?.text || "";
}
function renameChapter(ch) {
  const x = prompt("章見出し", ch.title);
  if (x && x.trim()) {
    ch.title = x.trim();
    dirtyChapterIds.add(ch.id);
    renderChapterTabs();
    scheduleSave();
  }
}
async function addChapter() {
  flushEditor();
  const ref = doc(collection(db, "novels", currentNovel.id, "chapters"));
  const ch = { id: ref.id, title: `第${chapters.length + 1}章`, order: chapters.length, text: "" };
  chapters.push(ch);
  activeChapterId = ch.id;
  dirtyChapterIds.add(ch.id);
  dirtyNovel = true;
  renderChapterTabs();
  renderActiveChapter();
  scheduleSave();
  $("editor").focus();
}
async function deleteChapter(ch) {
  if (chapters.length <= 1) { toast("最後の1章は削除できません。"); return; }
  if (!confirm(`「${ch.title}」を削除します。本文も削除され、元に戻せません。`)) return;
  try {
    const b = writeBatch(db);
    b.delete(doc(db, "novels", currentNovel.id, "chapters", ch.id));
    await b.commit();
    const idx = chapters.findIndex(c => c.id === ch.id);
    chapters = chapters.filter(c => c.id !== ch.id);
    chapters.forEach((c, i) => { if (c.order !== i) { c.order = i; dirtyChapterIds.add(c.id); } });
    if (activeChapterId === ch.id) activeChapterId = chapters[Math.min(idx, chapters.length - 1)].id;
    dirtyNovel = true;
    renderChapterTabs();
    renderActiveChapter();
    refreshStats();
    scheduleSave();
    toast("章を削除しました。");
  } catch (e) {
    console.error(e);
    toast("章を削除できませんでした。");
  }
}

function countChars(t) { return (t || "").replace(/\r?\n/g, "").length; }
function totalChars() { flushEditor(); return chapters.reduce((s, c) => s + countChars(c.text), 0); }
function estimatePages() {
  const p = currentNovel.page;
  if (!p.realPageMode) return totalChars() / (p.charsPerLine * p.linesPerPage);
  let lines = 0;
  chapters.forEach(c => (c.text || "").split(/\r?\n/).forEach(r => lines += Math.max(1, Math.ceil(r.length / p.charsPerLine))));
  return lines / p.linesPerPage;
}
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayDelta(cur) {
  const k = `daily_${auth.currentUser.uid}_${currentNovel.id}_${localDay()}`;
  if (localStorage.getItem(k) == null) localStorage.setItem(k, String(cur));
  return cur - Number(localStorage.getItem(k) || 0);
}
function remainingDays() {
  const raw = currentNovel.deadlines[currentNovel.activeDeadline];
  return raw ? Math.max((new Date(raw) - Date.now()) / 86400000, 0) : null;
}
function refreshStats() {
  if (!currentNovel) return;
  const cur = totalChars(), target = Number(currentNovel.targetWords) || 1, rem = Math.max(target - cur, 0), pct = Math.min(cur / target * 100, 100);
  const d = remainingDays(), pace = d && d > 0 ? Math.ceil(rem / Math.max(d, 1 / 24)) : 0, td = todayDelta(cur);
  $("wordCount").textContent = cur.toLocaleString();
  $("targetCount").textContent = target.toLocaleString();
  $("progressPct").textContent = pct.toFixed(1) + "%";
  $("progressBar").style.width = pct + "%";
  $("remainingCount").textContent = `残り${rem.toLocaleString()}字`;
  $("pageEstimate").textContent = `約${estimatePages().toFixed(1)}p`;
  $("todayCount").textContent = `今日 ${td >= 0 ? "+" : ""}${td.toLocaleString()}字`;
  $("paceCount").textContent = `必要 ${pace.toLocaleString()}字/日`;
  $("pagePresetLabel").textContent = `${currentNovel.page.preset} ${currentNovel.page.charsPerLine}字×${currentNovel.page.linesPerPage}行`;
}
function fmt(raw) {
  if (!raw) return "未設定";
  const d = new Date(raw);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function updateCountdown() {
  if (!currentNovel) return;
  const keys = ["early", "standard", "express"], configured = keys.filter(k => currentNovel.deadlines[k]), box = $("deadlineRow");
  box.innerHTML = "";
  if (configured.length && !configured.includes(currentNovel.activeDeadline)) currentNovel.activeDeadline = configured[0];
  configured.forEach(k => {
    const s = document.createElement("span");
    s.className = k === currentNovel.activeDeadline ? "active" : "";
    s.textContent = `${currentNovel.deadlineLabels[k]} ${fmt(currentNovel.deadlines[k])}`;
    s.style.cursor = "pointer";
    s.onclick = () => { currentNovel.activeDeadline = k; dirtyNovel = true; scheduleSave(); updateCountdown(); refreshStats(); };
    box.appendChild(s);
  });
  if (!configured.length) { $("countdown").textContent = "締切未設定"; return; }
  const diff = new Date(currentNovel.deadlines[currentNovel.activeDeadline]) - Date.now();
  if (diff <= 0) { $("countdown").textContent = "締切時刻を過ぎました"; return; }
  const d = Math.floor(diff / 86400000), h = Math.floor(diff % 86400000 / 3600000), m = Math.floor(diff % 3600000 / 60000), s = Math.floor(diff % 60000 / 1000);
  $("countdown").textContent = `${d}日 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function scheduleSave() {
  if (!currentNovel) return;
  flushEditor(); flushAux();
  $("saveState").textContent = "保存中…";
  $("cloudState").textContent = "ローカル保存済み / クラウド待機";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 1500);
}
async function saveAll() {
  if (!currentNovel) return;
  clearTimeout(saveTimer);
  flushEditor(); flushAux();
  if (!dirtyNovel && !dirtyChapterIds.size) return;
  try {
    const b = writeBatch(db);
    if (dirtyNovel) {
      b.set(doc(db, "novels", currentNovel.id), {
        title: currentNovel.title,
        targetWords: currentNovel.targetWords,
        deadlines: currentNovel.deadlines,
        deadlineLabels: currentNovel.deadlineLabels,
        activeDeadline: currentNovel.activeDeadline,
        outlineText: currentNovel.outlineText,
        outlineFlow: currentNovel.outlineFlow,
        charactersText: currentNovel.charactersText,
        characterSheets: currentNovel.characterSheets,
        characterRelations: currentNovel.characterRelations,
        page: currentNovel.page,
        editorDisplay: currentNovel.editorDisplay,
        customRules: currentNovel.customRules,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    for (const id of dirtyChapterIds) {
      const ch = chapters.find(c => c.id === id);
      if (ch) b.set(doc(db, "novels", currentNovel.id, "chapters", id), { title: ch.title, order: ch.order, text: ch.text, updatedAt: serverTimestamp() }, { merge: true });
    }
    await b.commit();
    dirtyNovel = false; dirtyChapterIds.clear();
    const t = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    $("saveState").textContent = `保存済み ${t}`;
    $("cloudState").textContent = `Firebase同期済み ${t}`;
  } catch (e) {
    console.error(e);
    $("saveState").textContent = "クラウド保存失敗";
    $("cloudState").textContent = "ローカルには保存済み";
    toast("Firebaseへの保存に失敗しました。");
  }
}

function refreshActiveDeadlineOptions() {
  const select = $("activeDeadline"), current = select.value || currentNovel.activeDeadline || "early";
  const dates = { early: $("earlyDeadline").value, standard: $("standardDeadline").value, express: $("expressDeadline").value };
  const labels = { early: $("earlyDeadlineLabel").value.trim() || "締切1", standard: $("standardDeadlineLabel").value.trim() || "締切2", express: $("expressDeadlineLabel").value.trim() || "締切3" };
  const keys = ["early", "standard", "express"], configured = keys.filter(k => dates[k]), targets = configured.length ? configured : keys;
  select.innerHTML = "";
  targets.forEach(k => {
    const o = document.createElement("option"); o.value = k; o.textContent = labels[k]; select.appendChild(o);
  });
  select.value = targets.includes(current) ? current : targets[0];
}
function openSettings() {
  const d = currentNovel.deadlines, l = currentNovel.deadlineLabels;
  $("earlyDeadline").value = d.early || ""; $("standardDeadline").value = d.standard || ""; $("expressDeadline").value = d.express || "";
  $("earlyDeadlineLabel").value = l.early; $("standardDeadlineLabel").value = l.standard; $("expressDeadlineLabel").value = l.express;
  refreshActiveDeadlineOptions();
  $("activeDeadline").value = currentNovel.activeDeadline || $("activeDeadline").value;
  $("targetWordsInput").value = currentNovel.targetWords;
  $("pagePreset").value = currentNovel.page.preset;
  $("fontSize").value = currentNovel.page.fontSize;
  $("charsPerLine").value = currentNovel.page.charsPerLine;
  $("linesPerPage").value = currentNovel.page.linesPerPage;
  $("realPageMode").checked = currentNovel.page.realPageMode;
  $("editorFontSize").value = currentNovel.editorDisplay.fontSize;
  renderRules();
  $("settingsDialog").showModal();
}
function saveSettings() {
  currentNovel.deadlines = { early: $("earlyDeadline").value, standard: $("standardDeadline").value, express: $("expressDeadline").value };
  currentNovel.deadlineLabels = { early: $("earlyDeadlineLabel").value.trim() || "締切1", standard: $("standardDeadlineLabel").value.trim() || "締切2", express: $("expressDeadlineLabel").value.trim() || "締切3" };
  const configured = ["early", "standard", "express"].filter(k => currentNovel.deadlines[k]);
  currentNovel.activeDeadline = configured.includes($("activeDeadline").value) ? $("activeDeadline").value : (configured[0] || "early");
  currentNovel.targetWords = Number($("targetWordsInput").value) || 80000;
  currentNovel.page = { preset: $("pagePreset").value, fontSize: Number($("fontSize").value) || 10.5, charsPerLine: Number($("charsPerLine").value) || 40, linesPerPage: Number($("linesPerPage").value) || 16, realPageMode: $("realPageMode").checked };
  currentNovel.editorDisplay = { fontSize: Number($("editorFontSize").value) || 16 };
  ["editor", "outlineEditor", "charactersEditor"].forEach(id => $(id).style.fontSize = `${currentNovel.editorDisplay.fontSize}px`);
  document.querySelectorAll(".character-value,.field-label-input,.sheet-title-input,.flow-node-text,.flow-small-input,.flow-small-select").forEach(el => el.style.fontSize = `${currentNovel.editorDisplay.fontSize}px`);
  dirtyNovel = true;
  $("settingsDialog").close();
  refreshStats();
  updateCountdown();
  scheduleSave();
}
function renderRules() {
  const box = $("customRulesList"); box.innerHTML = "";
  currentNovel.customRules.forEach((r, i) => {
    const row = document.createElement("div"); row.className = "rule-item";
    const s = document.createElement("span"); s.textContent = `${r.from} → ${r.to || "要確認"}`;
    const b = document.createElement("button"); b.type = "button"; b.textContent = "削除";
    b.onclick = () => { currentNovel.customRules.splice(i, 1); dirtyNovel = true; renderRules(); };
    row.append(s, b); box.appendChild(row);
  });
}
function addRule() {
  const from = $("ruleFrom").value.trim(), to = $("ruleTo").value.trim();
  if (!from) return;
  currentNovel.customRules.push({ from, to });
  dirtyNovel = true;
  $("ruleFrom").value = ""; $("ruleTo").value = "";
  renderRules();
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function proof() {
  if (proofMode) {
    flushEditor(); proofMode = false; $("proofSummary").classList.add("hidden"); $("editor").textContent = activeChapter()?.text || ""; return;
  }
  flushEditor();
  let parts = [{ text: activeChapter()?.text || "", mark: null }], hits = [];
  [...defaultRules, ...currentNovel.customRules].sort((a, b) => b.from.length - a.from.length).forEach(r => {
    const next = [];
    parts.forEach(p => {
      if (p.mark) { next.push(p); return; }
      p.text.split(new RegExp(`(${esc(r.from)})`, "g")).forEach(x => {
        if (!x) return;
        if (x === r.from) { hits.push(`${r.from}${r.to ? " → " + r.to : ""}`); next.push({ text: x, mark: "proof-style", note: r.to || "要確認" }); }
        else next.push({ text: x, mark: null });
      });
    });
    parts = next;
  });
  $("editor").innerHTML = "";
  parts.forEach(p => {
    if (p.mark) {
      const m = document.createElement("mark"); m.className = p.mark; m.textContent = p.text; m.title = p.note; $("editor").appendChild(m);
    } else $("editor").appendChild(document.createTextNode(p.text));
  });
  proofMode = true;
  $("proofSummary").classList.remove("hidden");
  $("proofSummary").textContent = hits.length ? `校閲候補 ${hits.length}件：${[...new Set(hits)].slice(0, 8).join(" / ")}` : "現在のルールでは候補は見つかりませんでした。";
}

function buildTxt() {
  flushEditor();
  const inc = $("includeHeadings").checked, blank = $("blankBetweenChapters").checked, collapse = $("collapseBlankLines").checked, trim = $("trimLineHeads").checked;
  return chapters.map(c => {
    let t = c.text || "";
    if (trim) t = t.split(/\r?\n/).map(x => x.replace(/^[ \t　]+/, "")).join("\n");
    if (collapse) t = t.replace(/\n{3,}/g, "\n\n");
    return inc ? `${c.title}\n\n${t}` : t;
  }).join(blank ? "\n\n" : "\n");
}
function buildOutlineTxt() {
  flushAux();
  const lines = [];
  if ((currentNovel.outlineText || "").trim()) {
    lines.push("【アウトラインメモ】", currentNovel.outlineText.trim(), "");
  }
  const flow = currentNovel.outlineFlow;
  if (flow.nodes.length) {
    lines.push("【時系列フローチャート】");
    const laneMap = new Map(flow.lanes.map(l => [l.id, l.name]));
    const nodes = [...flow.nodes].sort((a, b) => (a.row - b.row) || laneIndex(a.laneId) - laneIndex(b.laneId));
    nodes.forEach(node => {
      lines.push(`- [${laneMap.get(node.laneId) || "ライン"} / ${node.row}] ${node.text || "(未入力)"}`);
      const outs = flow.links.filter(link => link.from === node.id);
      outs.forEach(link => {
        const target = flow.nodes.find(n => n.id === link.to);
        if (target) lines.push(`  → [${laneMap.get(target.laneId) || "ライン"} / ${target.row}] ${target.text || "(未入力)"}`);
      });
    });
    lines.push("");
  }
  return lines.join("\n").trim();
}
function buildCharactersTxt() {
  flushAux();
  const out = [];
  currentNovel.characterSheets.forEach((sheet, index) => {
    out.push(`【${sheet.title || `キャラ${index + 1}`}】`);
    sheet.fields.forEach(field => out.push(`${field.label || "項目"}: ${field.value || ""}`));
    out.push("");
  });
  if ((currentNovel.characterRelations || []).length) {
    out.push("【キャラクター関係】");
    currentNovel.characterRelations.forEach(rel => {
      const a = currentNovel.characterSheets.find(s => s.id === rel.from);
      const b = currentNovel.characterSheets.find(s => s.id === rel.to);
      if (a && b) out.push(`${characterDisplayName(a)} ${rel.directed ? "→" : "—"} ${characterDisplayName(b)} : ${rel.label || "関係"}`);
    });
    out.push("");
  }
  if ((currentNovel.charactersText || "").trim()) {
    out.push("【自由メモ】", currentNovel.charactersText.trim(), "");
  }
  return out.join("\n").trim();
}
function safeFileName(s) { return (s || "text").replace(/[\\/:*?"<>|]/g, "_").trim() || "text"; }
function downloadText(text, fileName) {
  const b = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}
function downloadManuscriptTxt() { downloadText(buildTxt(), `${safeFileName(currentNovel.title)}.txt`); $("exportDialog").close(); }
function downloadOutlineTxt() { downloadText(buildOutlineTxt(), `${safeFileName(currentNovel.title)}_アウトライン.txt`); $("exportDialog").close(); }
function downloadCharactersTxt() { downloadText(buildCharactersTxt(), `${safeFileName(currentNovel.title)}_キャラ設定.txt`); $("exportDialog").close(); }

function laneIndex(laneId) {
  return currentNovel.outlineFlow.lanes.findIndex(l => l.id === laneId);
}
function markNovelDirty() {
  dirtyNovel = true;
  scheduleSave();
}

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm.inverse()) : { x: clientX, y: clientY };
}
function showFloatingPanel(x, y, build) {
  let panel = document.getElementById("directEditPanel");
  if (!panel) {
    panel = document.createElement("div"); panel.id = "directEditPanel"; panel.className = "direct-edit-panel hidden";
    document.body.appendChild(panel);
  }
  panel.innerHTML = ""; build(panel);
  panel.style.left = `${Math.min(x, window.innerWidth - 340)}px`;
  panel.style.top = `${Math.min(y, window.innerHeight - 420)}px`;
  panel.classList.remove("hidden");
  const close = ev => {
    if (!panel.contains(ev.target)) { panel.classList.add("hidden"); document.removeEventListener("pointerdown", close, true); }
  };
  setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  return panel;
}
function panelButton(text, cls, fn) {
  const b = document.createElement("button"); b.type = "button"; b.textContent = text; if (cls) b.className = cls; b.onclick = fn; return b;
}

function addFlowLane() {
  currentNovel.outlineFlow.lanes.push({ id: uid("lane"), name: `ライン${currentNovel.outlineFlow.lanes.length + 1}` });
  markNovelDirty(); renderFlowEditor();
}
function deleteFlowLane(laneId) {
  if (currentNovel.outlineFlow.lanes.length <= 1) { toast("最低1本のラインは残してください。"); return; }
  const laneName = currentNovel.outlineFlow.lanes.find(l => l.id === laneId)?.name || "このライン";
  if (!confirm(`「${laneName}」を削除します。ライン上のイベントと接続も削除されます。`)) return;
  currentNovel.outlineFlow.lanes = currentNovel.outlineFlow.lanes.filter(l => l.id !== laneId);
  const removed = currentNovel.outlineFlow.nodes.filter(n => n.laneId === laneId).map(n => n.id);
  currentNovel.outlineFlow.nodes = currentNovel.outlineFlow.nodes.filter(n => n.laneId !== laneId);
  currentNovel.outlineFlow.links = currentNovel.outlineFlow.links.filter(l => !removed.includes(l.from) && !removed.includes(l.to));
  markNovelDirty(); renderFlowEditor();
}
function addTimeLabel() {
  const labels = currentNovel.outlineFlow.timeLabels || (currentNovel.outlineFlow.timeLabels = []);
  labels.push({ id: uid("time"), text: `時系列${labels.length + 1}`, y: 120 + labels.length * 130 });
  markNovelDirty(); renderFlowSvg();
}
function openLaneEditor(lane, x, y) {
  showFloatingPanel(x, y, panel => {
    const h=document.createElement("strong"); h.textContent="ライン編集";
    const input=document.createElement("input"); input.value=lane.name; input.placeholder="ライン名";
    const actions=document.createElement("div"); actions.className="panel-actions";
    actions.append(panelButton("保存","primary",()=>{ lane.name=input.value.trim()||lane.name; dirtyNovel=true; panel.classList.add("hidden"); renderFlowSvg(); scheduleSave(); }), panelButton("ライン削除","danger",()=>{ panel.classList.add("hidden"); deleteFlowLane(lane.id); }));
    panel.append(h,input,actions); input.focus(); input.select();
  });
}
function openEventEditor({node=null,laneId,x,y,svgY=null}) {
  const flow=currentNovel.outlineFlow;
  const isNew=!node;
  const lane=flow.lanes.find(l=>l.id===(node?.laneId||laneId)) || flow.lanes[0];
  showFloatingPanel(x,y,panel=>{
    const h=document.createElement("strong"); h.textContent=isNew?`${lane.name} にイベント追加`:"イベント編集";
    const ta=document.createElement("textarea"); ta.placeholder="出来事・イベント"; ta.value=node?.text||"";
    const actions=document.createElement("div"); actions.className="panel-actions";
    const save=()=>{
      if(isNew){
        const row=Math.max(1,Math.round(((svgY||120)-100)/130)+1);
        const baseY=100+(row-1)*130;
        flow.nodes.push({id:uid("node"),laneId:lane.id,row,text:ta.value,offsetX:0,offsetY:(svgY||baseY)-baseY});
      }else node.text=ta.value;
      dirtyNovel=true; panel.classList.add("hidden"); renderFlowSvg(); scheduleSave();
    };
    actions.append(panelButton(isNew?"追加":"保存","primary",save));
    if(!isNew){
      const target=document.createElement("select");
      const empty=document.createElement("option"); empty.value=""; empty.textContent="接続先を選択…"; target.appendChild(empty);
      flow.nodes.filter(n=>n.id!==node.id).forEach(n=>{const o=document.createElement("option");o.value=n.id;o.textContent=`${flow.lanes.find(l=>l.id===n.laneId)?.name||"ライン"}: ${(n.text||"未入力").slice(0,22)}`;target.appendChild(o);});
      const connect=panelButton("→ 接続追加","",()=>{ if(!target.value)return; flow.links.push({id:uid("link"),from:node.id,to:target.value}); dirtyNovel=true; panel.classList.add("hidden"); renderFlowSvg(); scheduleSave(); });
      const del=panelButton("削除","danger",()=>{ panel.classList.add("hidden"); deleteFlowNode(node.id); });
      panel.append(h,ta,target,actions); actions.append(connect,del);
    } else panel.append(h,ta,actions);
    ta.focus();
  });
}
function deleteFlowNode(nodeId) {
  currentNovel.outlineFlow.nodes=currentNovel.outlineFlow.nodes.filter(n=>n.id!==nodeId);
  currentNovel.outlineFlow.links=currentNovel.outlineFlow.links.filter(l=>l.from!==nodeId&&l.to!==nodeId);
  markNovelDirty(); renderFlowSvg();
}
function editTimeLabel(label,x,y){
  showFloatingPanel(x,y,panel=>{
    const h=document.createElement("strong");h.textContent="時系列ラベル";
    const input=document.createElement("input");input.value=label.text;
    const actions=document.createElement("div");actions.className="panel-actions";
    actions.append(panelButton("保存","primary",()=>{label.text=input.value.trim()||label.text;dirtyNovel=true;panel.classList.add("hidden");renderFlowSvg();scheduleSave();}),panelButton("削除","danger",()=>{currentNovel.outlineFlow.timeLabels=currentNovel.outlineFlow.timeLabels.filter(t=>t.id!==label.id);dirtyNovel=true;panel.classList.add("hidden");renderFlowSvg();scheduleSave();}));
    panel.append(h,input,actions);input.focus();input.select();
  });
}
function renderFlowEditor(){ currentNovel.outlineFlow=normalizeFlow(currentNovel.outlineFlow); renderFlowSvg(); }
function wrapSvgText(text,maxChars=12){
  const raw=(text||"").trim(); if(!raw)return["未入力"]; const src=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),out=[];
  src.forEach(part=>{let rest=part;while(rest.length>maxChars){out.push(rest.slice(0,maxChars));rest=rest.slice(maxChars)}out.push(rest||" ")});return out.slice(0,5);
}
function buildFlowLayout(flow){
  const timeMargin=145,laneWidth=250,laneGap=30,top=100,headerY=43,rowGap=130,nodeWidth=168,positions=new Map();let maxRow=1;
  flow.nodes.forEach(node=>{maxRow=Math.max(maxRow,node.row||1);const lines=wrapSvgText(node.text),height=Math.max(56,24+lines.length*18),laneIdx=flow.lanes.findIndex(l=>l.id===node.laneId);const x=timeMargin+30+laneIdx*(laneWidth+laneGap)+(laneWidth-nodeWidth)/2+(Number(node.offsetX)||0),y=top+((node.row||1)-1)*rowGap+(Number(node.offsetY)||0);positions.set(node.id,{x,y,width:nodeWidth,height,centerX:x+nodeWidth/2,topY:y,bottomY:y+height,lines});});
  const naturalWidth=timeMargin+70+flow.lanes.length*laneWidth+Math.max(0,flow.lanes.length-1)*laneGap;const maxRight=Math.max(naturalWidth,...[...positions.values()].map(p=>p.x+p.width+40));const maxLabel=Math.max(0,...flow.timeLabels.map(t=>Number(t.y)||0));const maxBottom=Math.max(top+maxRow*rowGap+80,maxLabel+100,...[...positions.values()].map(p=>p.y+p.height+60));return{timeMargin,laneWidth,laneGap,headerY,rowGap,nodeWidth,positions,width:Math.max(520,maxRight),height:Math.max(320,maxBottom)};
}
function renderFlowSvg(){
  const svg=$("flowchartSvg"),flow=currentNovel.outlineFlow=normalizeFlow(currentNovel.outlineFlow),L=buildFlowLayout(flow),ns="http://www.w3.org/2000/svg";
  svg.innerHTML="";svg.setAttribute("viewBox",`0 0 ${L.width} ${L.height}`);svg.setAttribute("width",String(L.width));svg.setAttribute("height",String(L.height));
  const defs=document.createElementNS(ns,"defs"),marker=document.createElementNS(ns,"marker");marker.setAttribute("id","arrowhead");marker.setAttribute("markerWidth","10");marker.setAttribute("markerHeight","7");marker.setAttribute("refX","9");marker.setAttribute("refY","3.5");marker.setAttribute("orient","auto");const ap=document.createElementNS(ns,"path");ap.setAttribute("d","M0,0 L10,3.5 L0,7 z");ap.setAttribute("fill","#2f5d62");marker.appendChild(ap);defs.appendChild(marker);svg.appendChild(defs);
  const bg=document.createElementNS(ns,"rect");bg.setAttribute("width",String(L.width));bg.setAttribute("height",String(L.height));bg.setAttribute("fill","#fffdf8");svg.appendChild(bg);
  const axis=document.createElementNS(ns,"line");axis.setAttribute("x1","125");axis.setAttribute("x2","125");axis.setAttribute("y1","75");axis.setAttribute("y2",String(L.height-25));axis.setAttribute("stroke","#cfc6b8");axis.setAttribute("stroke-width","2");svg.appendChild(axis);
  flow.timeLabels.forEach(label=>{const g=document.createElementNS(ns,"g");g.classList.add("time-label-group");g.style.cursor="grab";g.style.touchAction="none";const y=label.y;const tick=document.createElementNS(ns,"line");tick.setAttribute("x1","116");tick.setAttribute("x2","134");tick.setAttribute("y1",String(y));tick.setAttribute("y2",String(y));tick.setAttribute("stroke","#8f867a");tick.setAttribute("stroke-width","2");const r=document.createElementNS(ns,"rect");r.setAttribute("x","8");r.setAttribute("y",String(y-18));r.setAttribute("width","104");r.setAttribute("height","36");r.setAttribute("rx","10");r.setAttribute("fill","#f7f3eb");r.setAttribute("stroke","#d9d2c6");const t=document.createElementNS(ns,"text");t.setAttribute("x","60");t.setAttribute("y",String(y+5));t.setAttribute("text-anchor","middle");t.setAttribute("font-size","13");t.textContent=label.text;g.append(r,t,tick);g.addEventListener("dblclick",e=>{e.stopPropagation();editTimeLabel(label,e.clientX,e.clientY)});g.addEventListener("contextmenu",e=>{e.preventDefault();editTimeLabel(label,e.clientX,e.clientY)});let drag=null;g.addEventListener("pointerdown",e=>{if(e.button!==0)return;g.setPointerCapture(e.pointerId);drag={start:svgPoint(svg,e.clientX,e.clientY).y,y:label.y,dy:0};});g.addEventListener("pointermove",e=>{if(!drag)return;const p=svgPoint(svg,e.clientX,e.clientY);drag.dy=p.y-drag.start;g.setAttribute("transform",`translate(0 ${drag.dy})`);});g.addEventListener("pointerup",()=>{if(drag){label.y=Math.max(85,drag.y+drag.dy);drag=null;g.removeAttribute("transform");dirtyNovel=true;renderFlowSvg();scheduleSave();}});svg.appendChild(g);});
  flow.lanes.forEach((lane,index)=>{const x=L.timeMargin+30+index*(L.laneWidth+L.laneGap);const group=document.createElementNS(ns,"g");group.classList.add("flow-lane-zone");group.dataset.laneId=lane.id;const zone=document.createElementNS(ns,"rect");zone.setAttribute("x",String(x));zone.setAttribute("y","18");zone.setAttribute("width",String(L.laneWidth));zone.setAttribute("height",String(L.height-45));zone.setAttribute("fill","transparent");zone.setAttribute("stroke","none");group.appendChild(zone);const titleBg=document.createElementNS(ns,"rect");titleBg.setAttribute("x",String(x));titleBg.setAttribute("y","20");titleBg.setAttribute("width",String(L.laneWidth));titleBg.setAttribute("height","42");titleBg.setAttribute("rx","12");titleBg.setAttribute("fill","#f1ebe1");titleBg.setAttribute("stroke","#d9d2c6");const title=document.createElementNS(ns,"text");title.setAttribute("x",String(x+L.laneWidth/2));title.setAttribute("y",String(L.headerY+4));title.setAttribute("text-anchor","middle");title.setAttribute("font-size","16");title.setAttribute("font-weight","700");title.textContent=lane.name;group.append(titleBg,title);const guide=document.createElementNS(ns,"line");guide.setAttribute("x1",String(x+L.laneWidth/2));guide.setAttribute("x2",String(x+L.laneWidth/2));guide.setAttribute("y1","72");guide.setAttribute("y2",String(L.height-28));guide.setAttribute("stroke","#ece5d9");guide.setAttribute("stroke-width","2");guide.setAttribute("stroke-dasharray","4 8");group.appendChild(guide);titleBg.addEventListener("dblclick",e=>{e.stopPropagation();openLaneEditor(lane,e.clientX,e.clientY)});title.addEventListener("dblclick",e=>{e.stopPropagation();openLaneEditor(lane,e.clientX,e.clientY)});group.addEventListener("contextmenu",e=>{e.preventDefault();const target=e.target;if(target===title||target===titleBg){openLaneEditor(lane,e.clientX,e.clientY);return;}const pt=svgPoint(svg,e.clientX,e.clientY);openEventEditor({laneId:lane.id,x:e.clientX,y:e.clientY,svgY:pt.y});});svg.appendChild(group);});
  flow.links.forEach(link=>{const a=L.positions.get(link.from),b=L.positions.get(link.to);if(!a||!b)return;const path=document.createElementNS(ns,"path");const midY=Math.min(b.topY-18,a.bottomY+24);const d=Math.abs(a.centerX-b.centerX)<2?`M ${a.centerX} ${a.bottomY} L ${b.centerX} ${b.topY}`:`M ${a.centerX} ${a.bottomY} L ${a.centerX} ${midY} L ${b.centerX} ${midY} L ${b.centerX} ${b.topY}`;path.setAttribute("d",d);path.setAttribute("fill","none");path.setAttribute("stroke","#2f5d62");path.setAttribute("stroke-width","2.5");path.setAttribute("marker-end","url(#arrowhead)");path.classList.add("flow-link-path");path.addEventListener("contextmenu",e=>{e.preventDefault();showFloatingPanel(e.clientX,e.clientY,p=>{const s=document.createElement("span");s.textContent="接続線";p.append(s,panelButton("削除","danger",()=>{currentNovel.outlineFlow.links=currentNovel.outlineFlow.links.filter(l=>l.id!==link.id);dirtyNovel=true;p.classList.add("hidden");renderFlowSvg();scheduleSave();}));});});svg.appendChild(path);});
  flow.nodes.forEach(node=>{const pos=L.positions.get(node.id);if(!pos)return;const g=document.createElementNS(ns,"g");g.classList.add("flow-node-group");g.style.cursor="grab";g.style.touchAction="none";const rect=document.createElementNS(ns,"rect");rect.setAttribute("x",String(pos.x));rect.setAttribute("y",String(pos.y));rect.setAttribute("width",String(pos.width));rect.setAttribute("height",String(pos.height));rect.setAttribute("rx","12");rect.setAttribute("fill","#fff");rect.setAttribute("stroke","#bfb6a8");rect.setAttribute("stroke-width","1.5");g.appendChild(rect);pos.lines.forEach((line,i)=>{const t=document.createElementNS(ns,"text");t.setAttribute("x",String(pos.centerX));t.setAttribute("y",String(pos.y+24+i*18));t.setAttribute("text-anchor","middle");t.setAttribute("font-size","14");t.textContent=line;g.appendChild(t)});g.addEventListener("dblclick",e=>{e.stopPropagation();openEventEditor({node,x:e.clientX,y:e.clientY})});g.addEventListener("contextmenu",e=>{e.preventDefault();e.stopPropagation();openEventEditor({node,x:e.clientX,y:e.clientY})});let drag=null;g.addEventListener("pointerdown",e=>{if(e.button!==0)return;e.stopPropagation();g.setPointerCapture(e.pointerId);const p=svgPoint(svg,e.clientX,e.clientY);drag={x:p.x,y:p.y,ox:node.offsetX,oy:node.offsetY,dx:0,dy:0};g.style.cursor="grabbing"});g.addEventListener("pointermove",e=>{if(!drag)return;const p=svgPoint(svg,e.clientX,e.clientY);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;g.setAttribute("transform",`translate(${drag.dx} ${drag.dy})`)});g.addEventListener("pointerup",()=>{if(drag){node.offsetX=drag.ox+drag.dx;node.offsetY=drag.oy+drag.dy;drag=null;g.removeAttribute("transform");dirtyNovel=true;renderFlowSvg();scheduleSave()}});svg.appendChild(g);});
}
async function exportFlowchartPng(){const svg=$("flowchartSvg");if(!currentNovel.outlineFlow.nodes.length&&!currentNovel.outlineFlow.timeLabels.length){toast("PNG出力する内容がありません。");return;}const source=new XMLSerializer().serializeToString(svg),blob=new Blob([source],{type:"image/svg+xml;charset=utf-8"}),url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{const scale=2,canvas=document.createElement("canvas");canvas.width=img.width*scale;canvas.height=img.height*scale;const ctx=canvas.getContext("2d");ctx.fillStyle="#fffdf8";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(scale,scale);ctx.drawImage(img,0,0);URL.revokeObjectURL(url);const a=document.createElement("a");a.href=canvas.toDataURL("image/png");a.download=`${safeFileName(currentNovel.title)}_時系列フローチャート.png`;document.body.appendChild(a);a.click();a.remove()};img.onerror=()=>{URL.revokeObjectURL(url);toast("PNG出力に失敗しました。")};img.src=url;}

function addCharacterSheet() {
  currentNovel.characterSheets.push(createCharacterSheet(currentNovel.characterSheets.length + 1));
  markNovelDirty();
  renderCharacterSheets();
  renderCharacterRelations();
}
function deleteCharacterSheet(sheetId) {
  if (currentNovel.characterSheets.length <= 1) { toast("最低1つのキャラ枠は残してください。"); return; }
  currentNovel.characterSheets = currentNovel.characterSheets.filter(s => s.id !== sheetId);
  currentNovel.characterRelations = (currentNovel.characterRelations || []).filter(r => r.from !== sheetId && r.to !== sheetId);
  markNovelDirty();
  renderCharacterSheets();
  renderCharacterRelations();
}
function renderCharacterSheets() {
  const box = $("characterSheets"); box.innerHTML = "";
  currentNovel.characterSheets = normalizeCharacterSheets(currentNovel.characterSheets);
  currentNovel.characterSheets.forEach((sheet, index) => {
    const card = document.createElement("section"); card.className = "character-sheet"; card.dataset.characterId = sheet.id;
    const head = document.createElement("div"); head.className = "character-sheet-head";
    const titleInput = document.createElement("input"); titleInput.className = "sheet-title-input"; titleInput.value = sheet.title || `キャラ${index + 1}`; titleInput.placeholder = `キャラ${index + 1}`;
    titleInput.oninput = e => { sheet.title = e.target.value; dirtyNovel = true; renderCharacterRelations(); scheduleSave(); };
    const del = document.createElement("button"); del.type = "button"; del.className = "danger"; del.textContent = "削除"; del.onclick = () => deleteCharacterSheet(sheet.id);
    head.append(titleInput, del);

    const grid = document.createElement("div"); grid.className = "character-field-grid";
    sheet.fields.forEach(field => {
      const fieldWrap = document.createElement("div"); fieldWrap.className = "character-field";
      const labelInput = document.createElement("input"); labelInput.className = "field-label-input"; labelInput.value = field.label || "項目";
      labelInput.oninput = e => { field.label = e.target.value; dirtyNovel = true; scheduleSave(); };
      const value = document.createElement("textarea"); value.className = "character-value"; value.placeholder = `${field.label || "項目"}を入力`; value.value = field.value || "";
      value.oninput = e => { field.value = e.target.value; dirtyNovel = true; if ((field.label || "").trim() === "名前") renderCharacterRelations(); scheduleSave(); };
      fieldWrap.append(labelInput, value); grid.appendChild(fieldWrap);
    });

    card.append(head, grid); box.appendChild(card);
  });
}
function characterDisplayName(sheet) {
  const nameField=sheet.fields?.find(f=>(f.label||"").trim()==="名前");
  return (nameField?.value||"").trim()||(sheet.title||"").trim()||"未設定";
}
let relationConnectStart=null;
function startRelationConnect(sheetId=null){
  relationConnectStart=sheetId;
  const hint=$("relationModeHint");
  if(hint) hint.textContent=sheetId?`${characterDisplayName(currentNovel.characterSheets.find(s=>s.id===sheetId))} から接続先をクリックしてください。`:"関係を作る2人を順にクリックしてください。";
  $("addCharacterRelationBtn").classList.add("active-mode");
}
function finishRelationConnect(sheetId){
  if(!relationConnectStart){relationConnectStart=sheetId;const hint=$("relationModeHint");if(hint)hint.textContent=`${characterDisplayName(currentNovel.characterSheets.find(s=>s.id===sheetId))} から接続先をクリックしてください。`;return;}
  if(relationConnectStart===sheetId){toast("別のキャラを選択してください。");return;}
  currentNovel.characterRelations.push({id:uid("rel"),from:relationConnectStart,to:sheetId,label:"関係",lineStyle:"solid",color:"#6f6a61",arrowStart:false,arrowEnd:false});
  const rel=currentNovel.characterRelations[currentNovel.characterRelations.length-1];relationConnectStart=null;$("addCharacterRelationBtn").classList.remove("active-mode");if($("relationModeHint"))$("relationModeHint").textContent="";dirtyNovel=true;renderCharacterRelationGraph();scheduleSave();setTimeout(()=>openRelationEditor(rel,window.innerWidth/2-160,window.innerHeight/2-180),0);
}
function addCharacterRelation(){if(currentNovel.characterSheets.length<2){toast("関係線を作るにはキャラを2人以上追加してください。");return;}startRelationConnect();}
function deleteCharacterRelation(id){currentNovel.characterRelations=currentNovel.characterRelations.filter(r=>r.id!==id);dirtyNovel=true;renderCharacterRelationGraph();scheduleSave();}
function openRelationEditor(rel,x,y){
  showFloatingPanel(x,y,panel=>{
    const h=document.createElement("strong");h.textContent="関係線を編集";
    const label=document.createElement("input");label.value=rel.label||"関係";label.placeholder="関係名";
    const lineStyle=document.createElement("select");[["solid","実線"],["dashed","点線"],["dashdot","一点鎖線"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;lineStyle.appendChild(o)});lineStyle.value=rel.lineStyle||"solid";
    const colorWrap=document.createElement("label");colorWrap.className="color-row";colorWrap.append(document.createTextNode("色"));const color=document.createElement("input");color.type="color";color.value=rel.color||"#6f6a61";colorWrap.appendChild(color);
    const arrows=document.createElement("div");arrows.className="arrow-options";const a1=document.createElement("label"),s=document.createElement("input");s.type="checkbox";s.checked=Boolean(rel.arrowStart);a1.append(s,document.createTextNode("B → A"));const a2=document.createElement("label"),e=document.createElement("input");e.type="checkbox";e.checked=Boolean(rel.arrowEnd);a2.append(e,document.createTextNode("A → B"));arrows.append(a1,a2);
    const names=document.createElement("div");names.className="small muted";names.textContent=`A: ${characterDisplayName(currentNovel.characterSheets.find(x=>x.id===rel.from))} / B: ${characterDisplayName(currentNovel.characterSheets.find(x=>x.id===rel.to))}`;
    const actions=document.createElement("div");actions.className="panel-actions";actions.append(panelButton("保存","primary",()=>{rel.label=label.value;rel.lineStyle=lineStyle.value;rel.color=color.value;rel.arrowStart=s.checked;rel.arrowEnd=e.checked;dirtyNovel=true;panel.classList.add("hidden");renderCharacterRelationGraph();scheduleSave()}),panelButton("削除","danger",()=>{panel.classList.add("hidden");deleteCharacterRelation(rel.id)}));
    panel.append(h,names,label,lineStyle,colorWrap,arrows,actions);
  });
}
function renderCharacterRelations(){currentNovel.characterRelations=normalizeCharacterRelations(currentNovel.characterRelations,currentNovel.characterSheets);renderCharacterRelationGraph();}
function lineDash(style){if(style==="dashed")return"8 7";if(style==="dashdot")return"12 5 2 5";return"";}
function renderCharacterRelationGraph(){
  const svg=$("characterRelationSvg");if(!svg)return;const ns="http://www.w3.org/2000/svg",sheets=currentNovel.characterSheets,relations=currentNovel.characterRelations=normalizeCharacterRelations(currentNovel.characterRelations,sheets);
  const cols=Math.max(1,Math.ceil(Math.sqrt(sheets.length))),cellW=260,cellH=165,nodeW=158,nodeH=58,width=Math.max(420,cols*cellW+80),rows=Math.max(1,Math.ceil(sheets.length/cols)),height=Math.max(300,rows*cellH+90);
  sheets.forEach((sheet,i)=>{if(sheet.graphX==null||sheet.graphY==null){const col=i%cols,row=Math.floor(i/cols);sheet.graphX=45+col*cellW+cellW/2;sheet.graphY=45+row*cellH+cellH/2;}});
  const maxX=Math.max(width,...sheets.map(s=>s.graphX+nodeW)),maxY=Math.max(height,...sheets.map(s=>s.graphY+nodeH));svg.innerHTML="";svg.setAttribute("viewBox",`0 0 ${maxX+40} ${maxY+40}`);svg.setAttribute("width",String(maxX+40));svg.setAttribute("height",String(maxY+40));
  const defs=document.createElementNS(ns,"defs");relations.forEach(rel=>{["start","end"].forEach(side=>{const m=document.createElementNS(ns,"marker");m.setAttribute("id",`rel_${side}_${rel.id}`);m.setAttribute("markerWidth","10");m.setAttribute("markerHeight","7");m.setAttribute("refX",side==="end"?"9":"1");m.setAttribute("refY","3.5");m.setAttribute("orient","auto-start-reverse");const p=document.createElementNS(ns,"path");p.setAttribute("d","M0,0 L10,3.5 L0,7 z");p.setAttribute("fill",rel.color);m.appendChild(p);defs.appendChild(m);});});svg.appendChild(defs);const bg=document.createElementNS(ns,"rect");bg.setAttribute("width","100%");bg.setAttribute("height","100%");bg.setAttribute("fill","#fffdf8");svg.appendChild(bg);
  const pos=new Map(sheets.map(s=>[s.id,{cx:s.graphX,cy:s.graphY,x:s.graphX-nodeW/2,y:s.graphY-nodeH/2}]));
  relations.forEach(rel=>{const a=pos.get(rel.from),b=pos.get(rel.to);if(!a||!b)return;const dx=b.cx-a.cx,dy=b.cy-a.cy,scale=1/Math.max(Math.abs(dx)/(nodeW/2),Math.abs(dy)/(nodeH/2),.0001),x1=a.cx+dx*scale,y1=a.cy+dy*scale,x2=b.cx-dx*scale,y2=b.cy-dy*scale;const g=document.createElementNS(ns,"g");g.classList.add("relation-edge");g.style.cursor="pointer";const line=document.createElementNS(ns,"line");line.setAttribute("x1",x1);line.setAttribute("y1",y1);line.setAttribute("x2",x2);line.setAttribute("y2",y2);line.setAttribute("stroke",rel.color);line.setAttribute("stroke-width","2.6");const dash=lineDash(rel.lineStyle);if(dash)line.setAttribute("stroke-dasharray",dash);if(rel.arrowStart)line.setAttribute("marker-start",`url(#rel_start_${rel.id})`);if(rel.arrowEnd)line.setAttribute("marker-end",`url(#rel_end_${rel.id})`);const hit=document.createElementNS(ns,"line");hit.setAttribute("x1",x1);hit.setAttribute("y1",y1);hit.setAttribute("x2",x2);hit.setAttribute("y2",y2);hit.setAttribute("stroke","transparent");hit.setAttribute("stroke-width","16");const mx=(a.cx+b.cx)/2,my=(a.cy+b.cy)/2,tw=Math.max(54,(rel.label||"関係").length*15+20),rb=document.createElementNS(ns,"rect");rb.setAttribute("x",mx-tw/2);rb.setAttribute("y",my-15);rb.setAttribute("width",tw);rb.setAttribute("height","26");rb.setAttribute("rx","9");rb.setAttribute("fill","#fffdf8");rb.setAttribute("stroke",rel.color);const text=document.createElementNS(ns,"text");text.setAttribute("x",mx);text.setAttribute("y",my+3);text.setAttribute("text-anchor","middle");text.setAttribute("font-size","13");text.textContent=rel.label||"関係";g.append(line,hit,rb,text);const edit=e=>{e.preventDefault();e.stopPropagation();openRelationEditor(rel,e.clientX,e.clientY)};g.addEventListener("contextmenu",edit);g.addEventListener("dblclick",edit);svg.appendChild(g);});
  sheets.forEach(sheet=>{const p=pos.get(sheet.id),g=document.createElementNS(ns,"g");g.classList.add("character-graph-node");g.style.cursor="grab";g.style.touchAction="none";const rect=document.createElementNS(ns,"rect");rect.setAttribute("x",p.x);rect.setAttribute("y",p.y);rect.setAttribute("width",nodeW);rect.setAttribute("height",nodeH);rect.setAttribute("rx","14");rect.setAttribute("fill","#fff");rect.setAttribute("stroke","#bfb6a8");rect.setAttribute("stroke-width","1.5");const text=document.createElementNS(ns,"text");text.setAttribute("x",p.cx);text.setAttribute("y",p.cy+5);text.setAttribute("text-anchor","middle");text.setAttribute("font-size","15");text.textContent=characterDisplayName(sheet);g.append(rect,text);g.addEventListener("click",e=>{if(relationConnectStart!==null||$("addCharacterRelationBtn").classList.contains("active-mode")){e.stopPropagation();finishRelationConnect(sheet.id)}});g.addEventListener("contextmenu",e=>{e.preventDefault();e.stopPropagation();showFloatingPanel(e.clientX,e.clientY,panel=>{const s=document.createElement("strong");s.textContent=characterDisplayName(sheet);panel.append(s,panelButton("このキャラから関係線","primary",()=>{panel.classList.add("hidden");startRelationConnect(sheet.id)}));});});g.addEventListener("dblclick",()=>{const card=document.querySelector(`[data-character-id="${sheet.id}"]`);if(card){card.scrollIntoView({behavior:"smooth",block:"center"});card.classList.add("flash-card");setTimeout(()=>card.classList.remove("flash-card"),900)}});let drag=null;g.addEventListener("pointerdown",e=>{if(e.button!==0)return;if(relationConnectStart!==null||$("addCharacterRelationBtn").classList.contains("active-mode"))return;g.setPointerCapture(e.pointerId);const pt=svgPoint(svg,e.clientX,e.clientY);drag={x:pt.x,y:pt.y,gx:sheet.graphX,gy:sheet.graphY,dx:0,dy:0};});g.addEventListener("pointermove",e=>{if(!drag)return;const pt=svgPoint(svg,e.clientX,e.clientY);drag.dx=pt.x-drag.x;drag.dy=pt.y-drag.y;g.setAttribute("transform",`translate(${drag.dx} ${drag.dy})`)});g.addEventListener("pointerup",()=>{if(drag){sheet.graphX=Math.max(nodeW/2+10,drag.gx+drag.dx);sheet.graphY=Math.max(nodeH/2+10,drag.gy+drag.dy);drag=null;g.removeAttribute("transform");dirtyNovel=true;renderCharacterRelationGraph();scheduleSave()}});svg.appendChild(g);});
}

$("signupBtn").onclick = signup; $("loginBtn").onclick = login; $("logoutBtn").onclick = () => signOut(auth);
$("newNovelBtn").onclick = () => {
  $("newNovelDialog").showModal();
  $("newTitle").value = ""; $("newReading").value = ""; $("newSlug").value = "";
  $("newEarly").value = ""; $("newStandard").value = ""; $("newExpress").value = "";
};
$("newTitle").addEventListener("input", suggestSlug); $("newReading").addEventListener("input", suggestSlug); $("createNovelBtn").onclick = createNovel;
$("backBtn").onclick = async () => { await saveAll(); dashboard(); }; $("addChapterBtn").onclick = addChapter;
$("manuscriptPageBtn").onclick = () => { flushAux(); showWorkspace("manuscript"); };
$("outlinePageBtn").onclick = () => { flushEditor(); showWorkspace("outline"); };
$("charactersPageBtn").onclick = () => { flushEditor(); showWorkspace("characters"); };
$("outlineEditor").addEventListener("input", () => { flushAux(); dirtyNovel = true; scheduleSave(); });
$("charactersEditor").addEventListener("input", () => { flushAux(); dirtyNovel = true; scheduleSave(); });
$("settingsBtn").onclick = openSettings; $("saveSettingsBtn").onclick = saveSettings; $("addRuleBtn").onclick = addRule;
["earlyDeadline", "standardDeadline", "expressDeadline", "earlyDeadlineLabel", "standardDeadlineLabel", "expressDeadlineLabel"].forEach(id => $(id).addEventListener("input", refreshActiveDeadlineOptions));
$("pagePreset").onchange = e => { if (e.target.value === "A6") { $("charsPerLine").value = 40; $("linesPerPage").value = 16; } if (e.target.value === "A5") { $("charsPerLine").value = 57; $("linesPerPage").value = 23; } };
$("proofBtn").onclick = proof; $("exportBtn").onclick = () => $("exportDialog").showModal();
$("downloadTxtBtn").onclick = downloadManuscriptTxt; $("downloadOutlineTxtBtn").onclick = downloadOutlineTxt; $("downloadCharactersTxtBtn").onclick = downloadCharactersTxt;
$("editor").addEventListener("input", () => { if (proofMode) { proofMode = false; $("proofSummary").classList.add("hidden"); } flushEditor(); dirtyChapterIds.add(activeChapterId); refreshStats(); scheduleSave(); });
$("addFlowLaneBtn").onclick = addFlowLane; $("addTimeLabelBtn").onclick = addTimeLabel; $("exportFlowPngBtn").onclick = exportFlowchartPng;
$("addCharacterBtn").onclick = addCharacterSheet;
$("addCharacterRelationBtn").onclick = addCharacterRelation;
window.addEventListener("popstate", () => { const s = routeSlug(); if (auth.currentUser && s) openNovelBySlug(s); else if (auth.currentUser) dashboard(); });
setInterval(updateCountdown, 1000); setInterval(refreshStats, 30000);
onAuthStateChanged(auth, async user => { if (!user) { currentNovel = null; showView("authView"); return; } await loadUserLabel(user); const slug = routeSlug(); if (slug) await openNovelBySlug(slug); else await dashboard(); });
