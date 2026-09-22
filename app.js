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

const defaultPage = {preset:"A6",fontSize:10.5,charsPerLine:40,linesPerPage:16,realPageMode:false};
const defaultDisplay = {fontSize:16};
const defaultDeadlineLabels = {early:"早割り",standard:"標準",express:"特急"};
const defaultRules = [
  {from:"出来る",to:"できる"},{from:"下さい",to:"ください"},{from:"致します",to:"いたします"},
  {from:"と言う",to:"という"},{from:"事",to:"こと"},{from:"様な",to:"ような"}
];

function showView(id){["authView","dashboardView","editorView"].forEach(v=>$(v).classList.toggle("hidden",v!==id));}
function toast(msg){$("toast").textContent=msg;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),2400);}
function loginEmail(id){const clean=id.trim().toLowerCase().replace(/[^a-z0-9._-]/g,"-");if(!clean)throw new Error("ログインIDを入力してください。");return `${clean}@novel.local`;}
function basePath(){let b=APP_BASE_PATH||"/";if(!b.startsWith("/"))b="/"+b;if(!b.endsWith("/"))b+="/";return b;}
function pathForSlug(slug){return `${basePath()}write/${encodeURIComponent(slug)}`;}
function routeSlug(){let p=decodeURIComponent(location.pathname),b=basePath();if(p.startsWith(b))p=p.slice(b.length);const m=p.match(/^write\/([^/]+)/);return m?m[1]:null;}

// 404.html から戻された作品URLを、モジュール読込後に復元する。
const redirectParam = new URLSearchParams(location.search).get("redirect");
if(redirectParam) history.replaceState({}, "", redirectParam);

function slugifyLatin(s){return s.toLowerCase().trim().replace(/[’'"]/g,"").replace(/&/g,"-and-").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/-+/g,"-");}
const kana={"きゃ":"kya","きゅ":"kyu","きょ":"kyo","しゃ":"sha","しゅ":"shu","しょ":"sho","ちゃ":"cha","ちゅ":"chu","ちょ":"cho","にゃ":"nya","にゅ":"nyu","にょ":"nyo","ひゃ":"hya","ひゅ":"hyu","ひょ":"hyo","みゃ":"mya","みゅ":"myu","みょ":"myo","りゃ":"rya","りゅ":"ryu","りょ":"ryo","ぎゃ":"gya","ぎゅ":"gyu","ぎょ":"gyo","じゃ":"ja","じゅ":"ju","じょ":"jo","びゃ":"bya","びゅ":"byu","びょ":"byo","ぴゃ":"pya","ぴゅ":"pyu","ぴょ":"pyo","あ":"a","い":"i","う":"u","え":"e","お":"o","か":"ka","き":"ki","く":"ku","け":"ke","こ":"ko","さ":"sa","し":"shi","す":"su","せ":"se","そ":"so","た":"ta","ち":"chi","つ":"tsu","て":"te","と":"to","な":"na","に":"ni","ぬ":"nu","ね":"ne","の":"no","は":"ha","ひ":"hi","ふ":"fu","へ":"he","ほ":"ho","ま":"ma","み":"mi","む":"mu","め":"me","も":"mo","や":"ya","ゆ":"yu","よ":"yo","ら":"ra","り":"ri","る":"ru","れ":"re","ろ":"ro","わ":"wa","を":"o","ん":"n","が":"ga","ぎ":"gi","ぐ":"gu","げ":"ge","ご":"go","ざ":"za","じ":"ji","ず":"zu","ぜ":"ze","ぞ":"zo","だ":"da","ぢ":"ji","づ":"zu","で":"de","ど":"do","ば":"ba","び":"bi","ぶ":"bu","べ":"be","ぼ":"bo","ぱ":"pa","ぴ":"pi","ぷ":"pu","ぺ":"pe","ぽ":"po","ー":"-"};
function katakanaToHiragana(s){return s.replace(/[\u30a1-\u30f6]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0x60));}
function kanaToRomaji(s){s=katakanaToHiragana(s.trim());let out="",gem=false;for(let i=0;i<s.length;i++){if(s[i]==="っ"){gem=true;continue;}const pair=s.slice(i,i+2);let r=kana[pair];if(r)i++;else r=kana[s[i]]||(/\s/.test(s[i])?"-":"");if(gem&&r){r=r[0]+r;gem=false;}out+=r;}return slugifyLatin(out);}
function suggestSlug(){const src=$("newReading").value.trim()||$("newTitle").value.trim();$("newSlug").value=kanaToRomaji(src)||slugifyLatin(src)||`work-${Date.now()}`;}

async function signup(){try{const id=$("loginId").value.trim(),pw=$("loginPassword").value;if(pw.length<6)throw new Error("パスワードは6文字以上にしてください。");const cred=await createUserWithEmailAndPassword(auth,loginEmail(id),pw);await setDoc(doc(db,"users",cred.user.uid),{loginId:id,createdAt:serverTimestamp()});toast("ユーザーを作成しました。");}catch(e){toast(e.message);}}
async function login(){try{await signInWithEmailAndPassword(auth,loginEmail($("loginId").value),$("loginPassword").value);}catch{toast("ログインできませんでした。IDまたはパスワードを確認してください。");}}
async function loadUserLabel(user){const s=await getDoc(doc(db,"users",user.uid));$("currentUserLabel").textContent=s.exists()?` / ${s.data().loginId||""}`:"";}

async function loadNovelList(){
  const q=query(collection(db,"novels"),where("ownerId","==",auth.currentUser.uid));
  const snaps=await getDocs(q);
  const items=snaps.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const at=a.updatedAt?.toMillis?.()||0,bt=b.updatedAt?.toMillis?.()||0;return bt-at;
  });
  const box=$("novelList");box.innerHTML="";
  if(!items.length){box.innerHTML='<p class="muted">まだ作品がありません。</p>';return;}
  items.forEach(n=>{
    const card=document.createElement("div");card.className="novel-card";
    const main=document.createElement("div");main.className="novel-card-main";
    const h=document.createElement("h3");h.textContent=n.title;
    const slug=document.createElement("div");slug.className="slug";slug.textContent=`/write/${n.slug}`;
    const meta=document.createElement("p");meta.className="muted small";meta.textContent=`${(n.targetWords||80000).toLocaleString()}字`;
    main.append(h,slug,meta);main.onclick=()=>openNovelById(n.id,n.slug);
    const actions=document.createElement("div");actions.className="novel-card-actions";
    const del=document.createElement("button");del.className="danger";del.textContent="作品を削除";del.onclick=e=>{e.stopPropagation();deleteNovel(n);};
    actions.appendChild(del);card.append(main,actions);box.appendChild(card);
  });
}

async function createNovel(){
  try{
    const title=$("newTitle").value.trim(),slug=slugifyLatin($("newSlug").value);
    if(!title)throw new Error("作品名を入力してください。");if(!slug)throw new Error("URL名を入力してください。");
    const uid=auth.currentUser.uid,slugRef=doc(db,"slugs",`${uid}_${slug}`);
    if((await getDoc(slugRef)).exists())throw new Error("同じURL名の作品があります。");
    const deadlines={early:$("newEarly").value,standard:$("newStandard").value,express:$("newExpress").value};
    const active=["early","standard","express"].find(k=>deadlines[k])||"early";
    const novelRef=doc(collection(db,"novels")),chapterRef=doc(collection(db,"novels",novelRef.id,"chapters")),batch=writeBatch(db);
    batch.set(novelRef,{ownerId:uid,title,slug,targetWords:Number($("newTarget").value)||80000,deadlines,deadlineLabels:{...defaultDeadlineLabels},activeDeadline:active,outlineText:"",charactersText:"",page:{...defaultPage},editorDisplay:{...defaultDisplay},customRules:[],createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(chapterRef,{title:"第1章",order:0,text:"",updatedAt:serverTimestamp()});
    batch.set(slugRef,{ownerId:uid,novelId:novelRef.id,slug,createdAt:serverTimestamp()});
    await batch.commit();$("newNovelDialog").close();await openNovelById(novelRef.id,slug);
  }catch(e){toast(e.message);}
}

async function deleteNovel(novel){
  if(!confirm(`「${novel.title}」を削除します。\n本文・アウトライン・キャラ設定を含め、元に戻せません。`))return;
  if(!confirm("本当に削除しますか？"))return;
  try{
    const ch=await getDocs(collection(db,"novels",novel.id,"chapters"));
    // 先に章を削除する。親作品を同じbatchで消すとRules判定が不安定になるため分ける。
    for(let i=0;i<ch.docs.length;i+=400){const b=writeBatch(db);ch.docs.slice(i,i+400).forEach(d=>b.delete(d.ref));await b.commit();}
    const b=writeBatch(db);b.delete(doc(db,"slugs",`${auth.currentUser.uid}_${novel.slug}`));b.delete(doc(db,"novels",novel.id));await b.commit();
    localStorage.removeItem(`novelShadow_${auth.currentUser.uid}_${novel.id}`);toast("作品を削除しました。");await loadNovelList();
  }catch(e){console.error(e);toast("作品を削除できませんでした。Firestore Rulesも確認してください。");}
}

async function dashboard(){currentNovel=null;chapters=[];activeChapterId=null;dirtyNovel=false;dirtyChapterIds.clear();showView("dashboardView");if(location.pathname!==basePath())history.replaceState({},"",basePath());await loadNovelList();}
async function openNovelBySlug(slug){const s=await getDoc(doc(db,"slugs",`${auth.currentUser.uid}_${slug}`));if(!s.exists()){toast("この作品を開けません。");return dashboard();}return openNovelById(s.data().novelId,slug,false);}
async function openNovelById(id,slug,push=true){
  const s=await getDoc(doc(db,"novels",id));if(!s.exists()){toast("作品が見つかりません。");return;}
  currentNovel={id,...s.data()};
  currentNovel.page={...defaultPage,...(currentNovel.page||{})};currentNovel.editorDisplay={...defaultDisplay,...(currentNovel.editorDisplay||{})};
  currentNovel.deadlines={early:"",standard:"",express:"",...(currentNovel.deadlines||{})};currentNovel.deadlineLabels={...defaultDeadlineLabels,...(currentNovel.deadlineLabels||{})};
  currentNovel.customRules=currentNovel.customRules||[];currentNovel.outlineText=currentNovel.outlineText||"";currentNovel.charactersText=currentNovel.charactersText||"";
  const configured=["early","standard","express"].filter(k=>currentNovel.deadlines[k]);if(configured.length&&!configured.includes(currentNovel.activeDeadline))currentNovel.activeDeadline=configured[0];
  const cs=await getDocs(collection(db,"novels",id,"chapters"));chapters=cs.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));activeChapterId=chapters[0]?.id||null;
  dirtyNovel=false;dirtyChapterIds.clear();if(push)history.pushState({},"",pathForSlug(slug));renderEditorView();
}

function activeChapter(){return chapters.find(c=>c.id===activeChapterId);}
function flushEditor(){if(!currentNovel||!activeChapter())return;activeChapter().text=$("editor").innerText.replace(/\u00a0/g," ");localShadowSave();}
function flushAux(){if(!currentNovel)return;currentNovel.outlineText=$("outlineEditor").innerText.replace(/\u00a0/g," ");currentNovel.charactersText=$("charactersEditor").innerText.replace(/\u00a0/g," ");localShadowSave();}
function localShadowSave(){if(!currentNovel)return;localStorage.setItem(`novelShadow_${auth.currentUser.uid}_${currentNovel.id}`,JSON.stringify({savedAt:Date.now(),chapters,outlineText:currentNovel.outlineText,charactersText:currentNovel.charactersText}));}

function renderEditorView(){showView("editorView");$("novelTitleLabel").textContent=currentNovel.title;["editor","outlineEditor","charactersEditor"].forEach(id=>$(id).style.fontSize=`${currentNovel.editorDisplay.fontSize}px`);$("outlineEditor").textContent=currentNovel.outlineText;$("charactersEditor").textContent=currentNovel.charactersText;renderChapterTabs();renderActiveChapter();showWorkspace("manuscript");refreshStats();updateCountdown();}
function showWorkspace(page){const pages={manuscript:$("manuscriptPage"),outline:$("outlinePage"),characters:$("charactersPage")};Object.entries(pages).forEach(([k,e])=>e.classList.toggle("hidden",k!==page));$("chapterBar").classList.toggle("hidden",page!=="manuscript");[["manuscriptPageBtn","manuscript"],["outlinePageBtn","outline"],["charactersPageBtn","characters"]].forEach(([id,k])=>$(id).classList.toggle("active",k===page));}
function renderChapterTabs(){const box=$("chapterTabs");box.innerHTML="";chapters.forEach(ch=>{const wrap=document.createElement("div");wrap.className="chapter-tab-wrap"+(ch.id===activeChapterId?" active":"");const b=document.createElement("button");b.className="chapter-tab";b.textContent=ch.title;b.title="クリックで移動 / ダブルクリックで名称変更";b.onclick=()=>{flushEditor();activeChapterId=ch.id;renderChapterTabs();renderActiveChapter();};b.ondblclick=()=>renameChapter(ch);const del=document.createElement("button");del.className="chapter-delete";del.textContent="×";del.title="この章を削除";del.onclick=e=>{e.stopPropagation();deleteChapter(ch);};wrap.append(b,del);box.appendChild(wrap);});}
function renderActiveChapter(){proofMode=false;$("proofSummary").classList.add("hidden");$("editor").textContent=activeChapter()?.text||"";}
function renameChapter(ch){const x=prompt("章見出し",ch.title);if(x&&x.trim()){ch.title=x.trim();dirtyChapterIds.add(ch.id);renderChapterTabs();scheduleSave();}}
async function addChapter(){flushEditor();const ref=doc(collection(db,"novels",currentNovel.id,"chapters"));const ch={id:ref.id,title:`第${chapters.length+1}章`,order:chapters.length,text:""};chapters.push(ch);activeChapterId=ch.id;dirtyChapterIds.add(ch.id);dirtyNovel=true;renderChapterTabs();renderActiveChapter();scheduleSave();$("editor").focus();}
async function deleteChapter(ch){if(chapters.length<=1){toast("最後の1章は削除できません。");return;}if(!confirm(`「${ch.title}」を削除します。本文も削除され、元に戻せません。`))return;try{const b=writeBatch(db);b.delete(doc(db,"novels",currentNovel.id,"chapters",ch.id));await b.commit();const idx=chapters.findIndex(c=>c.id===ch.id);chapters=chapters.filter(c=>c.id!==ch.id);chapters.forEach((c,i)=>{if(c.order!==i){c.order=i;dirtyChapterIds.add(c.id);}});if(activeChapterId===ch.id)activeChapterId=chapters[Math.min(idx,chapters.length-1)].id;dirtyNovel=true;renderChapterTabs();renderActiveChapter();refreshStats();scheduleSave();toast("章を削除しました。");}catch(e){console.error(e);toast("章を削除できませんでした。");}}

function countChars(t){return (t||"").replace(/\r?\n/g,"").length;}
function totalChars(){flushEditor();return chapters.reduce((s,c)=>s+countChars(c.text),0);}
function estimatePages(){const p=currentNovel.page;if(!p.realPageMode)return totalChars()/(p.charsPerLine*p.linesPerPage);let lines=0;chapters.forEach(c=>(c.text||"").split(/\r?\n/).forEach(r=>lines+=Math.max(1,Math.ceil(r.length/p.charsPerLine))));return lines/p.linesPerPage;}
function localDay(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function todayDelta(cur){const k=`daily_${auth.currentUser.uid}_${currentNovel.id}_${localDay()}`;if(localStorage.getItem(k)==null)localStorage.setItem(k,String(cur));return cur-Number(localStorage.getItem(k)||0);}
function remainingDays(){const raw=currentNovel.deadlines[currentNovel.activeDeadline];return raw?Math.max((new Date(raw)-Date.now())/86400000,0):null;}
function refreshStats(){if(!currentNovel)return;const cur=totalChars(),target=Number(currentNovel.targetWords)||1,rem=Math.max(target-cur,0),pct=Math.min(cur/target*100,100),d=remainingDays(),pace=d&&d>0?Math.ceil(rem/Math.max(d,1/24)):0,td=todayDelta(cur);$("wordCount").textContent=cur.toLocaleString();$("targetCount").textContent=target.toLocaleString();$("progressPct").textContent=pct.toFixed(1)+"%";$("progressBar").style.width=pct+"%";$("remainingCount").textContent=`残り${rem.toLocaleString()}字`;$("pageEstimate").textContent=`約${estimatePages().toFixed(1)}p`;$("todayCount").textContent=`今日 ${td>=0?"+":""}${td.toLocaleString()}字`;$("paceCount").textContent=`必要 ${pace.toLocaleString()}字/日`;$("pagePresetLabel").textContent=`${currentNovel.page.preset} ${currentNovel.page.charsPerLine}字×${currentNovel.page.linesPerPage}行`;}
function fmt(raw){if(!raw)return"未設定";const d=new Date(raw);return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
function updateCountdown(){if(!currentNovel)return;const keys=["early","standard","express"],configured=keys.filter(k=>currentNovel.deadlines[k]),box=$("deadlineRow");box.innerHTML="";if(configured.length&&!configured.includes(currentNovel.activeDeadline))currentNovel.activeDeadline=configured[0];configured.forEach(k=>{const s=document.createElement("span");s.className=k===currentNovel.activeDeadline?"active":"";s.textContent=`${currentNovel.deadlineLabels[k]} ${fmt(currentNovel.deadlines[k])}`;s.style.cursor="pointer";s.onclick=()=>{currentNovel.activeDeadline=k;dirtyNovel=true;scheduleSave();updateCountdown();refreshStats();};box.appendChild(s);});if(!configured.length){$("countdown").textContent="締切未設定";return;}const diff=new Date(currentNovel.deadlines[currentNovel.activeDeadline])-Date.now();if(diff<=0){$("countdown").textContent="締切時刻を過ぎました";return;}const d=Math.floor(diff/86400000),h=Math.floor(diff%86400000/3600000),m=Math.floor(diff%3600000/60000),s=Math.floor(diff%60000/1000);$("countdown").textContent=`${d}日 ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;}

function scheduleSave(){if(!currentNovel)return;flushEditor();flushAux();$("saveState").textContent="保存中…";$("cloudState").textContent="ローカル保存済み / クラウド待機";clearTimeout(saveTimer);saveTimer=setTimeout(saveAll,1500);}
async function saveAll(){if(!currentNovel)return;clearTimeout(saveTimer);flushEditor();flushAux();if(!dirtyNovel&&!dirtyChapterIds.size){return;}try{const b=writeBatch(db);if(dirtyNovel){b.set(doc(db,"novels",currentNovel.id),{title:currentNovel.title,targetWords:currentNovel.targetWords,deadlines:currentNovel.deadlines,deadlineLabels:currentNovel.deadlineLabels,activeDeadline:currentNovel.activeDeadline,outlineText:currentNovel.outlineText,charactersText:currentNovel.charactersText,page:currentNovel.page,editorDisplay:currentNovel.editorDisplay,customRules:currentNovel.customRules,updatedAt:serverTimestamp()},{merge:true});}for(const id of dirtyChapterIds){const ch=chapters.find(c=>c.id===id);if(ch)b.set(doc(db,"novels",currentNovel.id,"chapters",id),{title:ch.title,order:ch.order,text:ch.text,updatedAt:serverTimestamp()},{merge:true});}await b.commit();dirtyNovel=false;dirtyChapterIds.clear();const t=new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"});$("saveState").textContent=`保存済み ${t}`;$("cloudState").textContent=`Firebase同期済み ${t}`;}catch(e){console.error(e);$("saveState").textContent="クラウド保存失敗";$("cloudState").textContent="ローカルには保存済み";toast("Firebaseへの保存に失敗しました。");}}

function refreshActiveDeadlineOptions(){const select=$("activeDeadline"),current=select.value||currentNovel.activeDeadline||"early",dates={early:$("earlyDeadline").value,standard:$("standardDeadline").value,express:$("expressDeadline").value},labels={early:$("earlyDeadlineLabel").value.trim()||"締切1",standard:$("standardDeadlineLabel").value.trim()||"締切2",express:$("expressDeadlineLabel").value.trim()||"締切3"},keys=["early","standard","express"],configured=keys.filter(k=>dates[k]),targets=configured.length?configured:keys;select.innerHTML="";targets.forEach(k=>{const o=document.createElement("option");o.value=k;o.textContent=labels[k];select.appendChild(o);});select.value=targets.includes(current)?current:targets[0];}
function openSettings(){const d=currentNovel.deadlines,l=currentNovel.deadlineLabels;$("earlyDeadline").value=d.early||"";$("standardDeadline").value=d.standard||"";$("expressDeadline").value=d.express||"";$("earlyDeadlineLabel").value=l.early;$("standardDeadlineLabel").value=l.standard;$("expressDeadlineLabel").value=l.express;refreshActiveDeadlineOptions();$("activeDeadline").value=currentNovel.activeDeadline||$("activeDeadline").value;$("targetWordsInput").value=currentNovel.targetWords;$("pagePreset").value=currentNovel.page.preset;$("fontSize").value=currentNovel.page.fontSize;$("charsPerLine").value=currentNovel.page.charsPerLine;$("linesPerPage").value=currentNovel.page.linesPerPage;$("realPageMode").checked=currentNovel.page.realPageMode;$("editorFontSize").value=currentNovel.editorDisplay.fontSize;renderRules();$("settingsDialog").showModal();}
function saveSettings(){currentNovel.deadlines={early:$("earlyDeadline").value,standard:$("standardDeadline").value,express:$("expressDeadline").value};currentNovel.deadlineLabels={early:$("earlyDeadlineLabel").value.trim()||"締切1",standard:$("standardDeadlineLabel").value.trim()||"締切2",express:$("expressDeadlineLabel").value.trim()||"締切3"};const configured=["early","standard","express"].filter(k=>currentNovel.deadlines[k]);currentNovel.activeDeadline=configured.includes($("activeDeadline").value)?$("activeDeadline").value:(configured[0]||"early");currentNovel.targetWords=Number($("targetWordsInput").value)||80000;currentNovel.page={preset:$("pagePreset").value,fontSize:Number($("fontSize").value)||10.5,charsPerLine:Number($("charsPerLine").value)||40,linesPerPage:Number($("linesPerPage").value)||16,realPageMode:$("realPageMode").checked};currentNovel.editorDisplay={fontSize:Number($("editorFontSize").value)||16};["editor","outlineEditor","charactersEditor"].forEach(id=>$(id).style.fontSize=`${currentNovel.editorDisplay.fontSize}px`);dirtyNovel=true;$("settingsDialog").close();refreshStats();updateCountdown();scheduleSave();}
function renderRules(){const box=$("customRulesList");box.innerHTML="";currentNovel.customRules.forEach((r,i)=>{const row=document.createElement("div");row.className="rule-item";const s=document.createElement("span");s.textContent=`${r.from} → ${r.to||"要確認"}`;const b=document.createElement("button");b.type="button";b.textContent="削除";b.onclick=()=>{currentNovel.customRules.splice(i,1);dirtyNovel=true;renderRules();};row.append(s,b);box.appendChild(row);});}
function addRule(){const from=$("ruleFrom").value.trim(),to=$("ruleTo").value.trim();if(!from)return;currentNovel.customRules.push({from,to});dirtyNovel=true;$("ruleFrom").value="";$("ruleTo").value="";renderRules();}

function esc(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
function proof(){if(proofMode){flushEditor();proofMode=false;$("proofSummary").classList.add("hidden");$("editor").textContent=activeChapter()?.text||"";return;}flushEditor();let parts=[{text:activeChapter()?.text||"",mark:null}],hits=[];[...defaultRules,...currentNovel.customRules].sort((a,b)=>b.from.length-a.from.length).forEach(r=>{const next=[];parts.forEach(p=>{if(p.mark){next.push(p);return;}p.text.split(new RegExp(`(${esc(r.from)})`,`g`)).forEach(x=>{if(!x)return;if(x===r.from){hits.push(`${r.from}${r.to?" → "+r.to:""}`);next.push({text:x,mark:"proof-style",note:r.to||"要確認"});}else next.push({text:x,mark:null});});});parts=next;});$("editor").innerHTML="";parts.forEach(p=>{if(p.mark){const m=document.createElement("mark");m.className=p.mark;m.textContent=p.text;m.title=p.note;$("editor").appendChild(m);}else $("editor").appendChild(document.createTextNode(p.text));});proofMode=true;$("proofSummary").classList.remove("hidden");$("proofSummary").textContent=hits.length?`校閲候補 ${hits.length}件：${[...new Set(hits)].slice(0,8).join(" / ")}`:"現在のルールでは候補は見つかりませんでした。";}
function buildTxt(){flushEditor();const inc=$("includeHeadings").checked,blank=$("blankBetweenChapters").checked,collapse=$("collapseBlankLines").checked,trim=$("trimLineHeads").checked;return chapters.map(c=>{let t=c.text||"";if(trim)t=t.split(/\r?\n/).map(x=>x.replace(/^[ \t　]+/,"")).join("\n");if(collapse)t=t.replace(/\n{3,}/g,"\n\n");return inc?`${c.title}\n\n${t}`:t;}).join(blank?"\n\n":"\n");}
function downloadTxt(){const b=new Blob([buildTxt()],{type:"text/plain;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`${currentNovel.title}.txt`;a.click();URL.revokeObjectURL(a.href);$("exportDialog").close();}

$("signupBtn").onclick=signup;$("loginBtn").onclick=login;$("logoutBtn").onclick=()=>signOut(auth);
$("newNovelBtn").onclick=()=>{$("newNovelDialog").showModal();$("newTitle").value="";$("newReading").value="";$("newSlug").value="";$("newEarly").value="";$("newStandard").value="";$("newExpress").value="";};
$("newTitle").addEventListener("input",suggestSlug);$("newReading").addEventListener("input",suggestSlug);$("createNovelBtn").onclick=createNovel;
$("backBtn").onclick=async()=>{await saveAll();dashboard();};$("addChapterBtn").onclick=addChapter;
$("manuscriptPageBtn").onclick=()=>{flushAux();showWorkspace("manuscript");};$("outlinePageBtn").onclick=()=>{flushEditor();showWorkspace("outline");};$("charactersPageBtn").onclick=()=>{flushEditor();showWorkspace("characters");};
$("outlineEditor").addEventListener("input",()=>{flushAux();dirtyNovel=true;scheduleSave();});$("charactersEditor").addEventListener("input",()=>{flushAux();dirtyNovel=true;scheduleSave();});
$("settingsBtn").onclick=openSettings;$("saveSettingsBtn").onclick=saveSettings;$("addRuleBtn").onclick=addRule;
["earlyDeadline","standardDeadline","expressDeadline","earlyDeadlineLabel","standardDeadlineLabel","expressDeadlineLabel"].forEach(id=>$(id).addEventListener("input",refreshActiveDeadlineOptions));
$("pagePreset").onchange=e=>{if(e.target.value==="A6"){$("charsPerLine").value=40;$("linesPerPage").value=16;}if(e.target.value==="A5"){$("charsPerLine").value=57;$("linesPerPage").value=23;}};
$("proofBtn").onclick=proof;$("exportBtn").onclick=()=>$("exportDialog").showModal();$("downloadTxtBtn").onclick=downloadTxt;
$("editor").addEventListener("input",()=>{if(proofMode){proofMode=false;$("proofSummary").classList.add("hidden");}flushEditor();dirtyChapterIds.add(activeChapterId);refreshStats();scheduleSave();});
window.addEventListener("popstate",()=>{const s=routeSlug();if(auth.currentUser&&s)openNovelBySlug(s);else if(auth.currentUser)dashboard();});
setInterval(updateCountdown,1000);setInterval(refreshStats,30000);
onAuthStateChanged(auth,async user=>{if(!user){currentNovel=null;showView("authView");return;}await loadUserLabel(user);const slug=routeSlug();if(slug)await openNovelBySlug(slug);else await dashboard();});
