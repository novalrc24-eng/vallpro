console.log("VECTOR METADATA PRO V3 APP.JS LOADED");
const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
const apiUrl = path => `${API_BASE}${path}`;
const state = { selectedFile:null, batchFiles:[], batchResults:[], recentTitles:[], recentDescriptions:[], lastMetadata:null, mediaType:"image", batchMediaType:"image" };
const $ = id => document.getElementById(id);
const escapeHtml = v => String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");

function formatFileSize(b){if(b<1024)return `${b} B`;if(b<1048576)return `${(b/1024).toFixed(1)} KB`;return `${(b/1048576).toFixed(1)} MB`;}

function showStatus(m,t=""){
  const e=$("generateStatus");
  if(e){
    e.textContent=m;
    e.className=`generate-status ${t}`.trim();
  }
}

function displayErrorCard(title, details){
  const card = $("errorCardDisplay");
  if(!card) return;
  card.hidden = false;
  
  let itemsHtml = "";
  if(typeof details === "object" && details !== null){
    for(const [key, val] of Object.entries(details)){
      const providerLabel = key === "gemini" ? "🔹 Gemini AI" : key === "openai" ? "🟢 OpenAI" : key.toUpperCase();
      itemsHtml += `<div class="error-card-item"><strong>${providerLabel}:</strong> ${escapeHtml(val)}</div>`;
    }
  } else {
    itemsHtml = `<div class="error-card-item">${escapeHtml(details || title)}</div>`;
  }

  card.innerHTML = `<div class="error-card-header">⚠️ ${escapeHtml(title)}</div><div class="error-card-list">${itemsHtml}</div>`;
}

function clearErrorCard(){
  const card = $("errorCardDisplay");
  if(card){
    card.hidden = true;
    card.innerHTML = "";
  }
}

function getGeminiApiKey(){
  const val = String($("apiKeyInput")?.value||"").trim();
  if(val){
    localStorage.setItem("vmp_gemini_key", val);
    return val;
  }
  return localStorage.getItem("vmp_gemini_key") || "";
}

function getOpenAiApiKey(){
  const val = String($("openaiKeyInput")?.value||"").trim();
  if(val){
    localStorage.setItem("vmp_openai_key", val);
    return val;
  }
  return localStorage.getItem("vmp_openai_key") || "";
}

function getProvider(){
  return $("providerSelect")?.value || localStorage.getItem("vmp_provider") || "auto";
}

function loadSavedApiKeys(){
  const savedGemini = localStorage.getItem("vmp_gemini_key");
  if(savedGemini && $("apiKeyInput")) $("apiKeyInput").value = savedGemini;
  
  const savedOpenAi = localStorage.getItem("vmp_openai_key");
  if(savedOpenAi && $("openaiKeyInput")) $("openaiKeyInput").value = savedOpenAi;

  const savedProvider = localStorage.getItem("vmp_provider");
  if(savedProvider && $("providerSelect")) $("providerSelect").value = savedProvider;
}

function ext(file){return String(file?.name||"").toLowerCase().split(".").pop();}
function typeOf(file){return ext(file).toUpperCase();}
function isSupportedFile(f){return ["png","jpg","jpeg","webp","mp4","mov","webm","m4v","eps","ai","cdr"].includes(ext(f));}
function isVideo(f){return ["mp4","mov","webm","m4v"].includes(ext(f));}
function isVector(f){return ["eps","ai","cdr"].includes(ext(f));}
function isImage(f){return ["png","jpg","jpeg","webp"].includes(ext(f));}

function rememberMetadata(m){
  [m?.adobe?.title,m?.shutterstock?.title].filter(Boolean).forEach(v=>{if(!state.recentTitles.includes(v))state.recentTitles.unshift(v);});
  [m?.adobe?.description,m?.shutterstock?.description].filter(Boolean).forEach(v=>{if(!state.recentDescriptions.includes(v))state.recentDescriptions.unshift(v);});
  state.recentTitles=state.recentTitles.slice(0,30);
  state.recentDescriptions=state.recentDescriptions.slice(0,30);
}

async function checkServer(){
  try{
    const r=await fetch(apiUrl("/api/status"),{cache:"no-store"});
    if(!r.ok)throw new Error();
    const d=await r.json();
    $("statusButton").textContent="● ONLINE";
    $("statusButton").classList.add("online");
    $("statusMessage").textContent=d.message||"Server online";
  }catch{
    $("statusButton").textContent="● OFFLINE";
    $("statusMessage").textContent="Jalankan backend dengan npm start";
  }
}

function mediaChoiceForFile(f){if(isVideo(f))return "video";if(isVector(f))return "vector";return state.mediaType;}

function setPreview(file){
  const p=$("preview"),m=$("previewMedia");
  p.hidden=false;
  m.innerHTML="";
  if(isImage(file)){
    const img=document.createElement("img");
    img.src=URL.createObjectURL(file);
    img.onload=()=>URL.revokeObjectURL(img.src);
    m.appendChild(img);
  }else if(isVideo(file)){
    const v=document.createElement("video");
    v.src=URL.createObjectURL(file);
    v.muted=true;
    v.playsInline=true;
    v.controls=true;
    m.appendChild(v);
  }else{
    m.innerHTML=`<div class="vector-preview">${typeOf(file)}</div>`;
  }
  $("fileName").textContent=file.name;
  $("fileSize").textContent=`${formatFileSize(file.size)} · ${typeOf(file)}`;
  $("dropZone").classList.add("has-file");
}

function clearPreview(){
  state.selectedFile=null;
  $("preview").hidden=true;
  $("previewMedia").innerHTML="";
  $("fileInput").value="";
  $("dropZone").classList.remove("has-file");
  clearErrorCard();
}

function selectSingleFile(file){
  if(!isSupportedFile(file)){
    showStatus("Format file tidak didukung.","error");
    return;
  }
  state.selectedFile=file;
  state.mediaType=mediaChoiceForFile(file);
  syncMediaButtons();
  setPreview(file);
  clearErrorCard();
  showStatus("File siap dianalisis.");
}

function syncMediaButtons(){
  document.querySelectorAll("#mediaChoice .media-option").forEach(b=>b.classList.toggle("active",b.dataset.media===state.mediaType));
  const h={
    image:"Metadata akan disusun untuk gambar, foto, atau illustration.",
    video:"Metadata akan disusun untuk footage/video, dengan fokus pada subject dan motion.",
    vector:"Metadata akan disusun untuk vector/illustration, bukan fotografi."
  };
  if($("mediaHelp")) $("mediaHelp").textContent=h[state.mediaType];
  document.querySelectorAll("#batchMediaChoice .media-option").forEach(b=>b.classList.toggle("active",b.dataset.batchMedia===state.batchMediaType));
  if($("batchMediaHelp")) $("batchMediaHelp").textContent=h[state.batchMediaType];
}

function setupSingleUpload(){
  $("chooseButton")?.addEventListener("click",e=>{e.preventDefault();$("fileInput").click();});
  $("fileInput")?.addEventListener("change",()=>{if($("fileInput").files?.[0])selectSingleFile($("fileInput").files[0]);});
  $("dropZone")?.addEventListener("dragover",e=>{e.preventDefault();$("dropZone").classList.add("dragging");});
  $("dropZone")?.addEventListener("dragleave",()=>$("dropZone").classList.remove("dragging"));
  $("dropZone")?.addEventListener("drop",e=>{e.preventDefault();$("dropZone").classList.remove("dragging");if(e.dataTransfer.files?.[0])selectSingleFile(e.dataTransfer.files[0]);});
  $("removeButton")?.addEventListener("click",clearPreview);
  $("generateButton")?.addEventListener("click",generateSingle);
  
  $("apiKeyInput")?.addEventListener("input",()=>{
    localStorage.setItem("vmp_gemini_key", $("apiKeyInput").value.trim());
  });
  $("openaiKeyInput")?.addEventListener("input",()=>{
    localStorage.setItem("vmp_openai_key", $("openaiKeyInput").value.trim());
  });
  $("providerSelect")?.addEventListener("change",()=>{
    localStorage.setItem("vmp_provider", $("providerSelect").value);
  });

  document.querySelectorAll("#mediaChoice .media-option").forEach(b=>b.addEventListener("click",()=>{state.mediaType=b.dataset.media;syncMediaButtons();}));
  document.querySelectorAll("#batchMediaChoice .media-option").forEach(b=>b.addEventListener("click",()=>{state.batchMediaType=b.dataset.batchMedia;syncMediaButtons();}));
}

function uniqueKeywords(a){return [...new Map((Array.isArray(a)?a:[]).map(v=>String(v||"").trim()).filter(Boolean).map(v=>[v.toLowerCase(),v])).values()];}

function scoreQuality(m,p){
 const d=m?.[p]||{};
 const fp=Array.isArray(m?.visual_analysis?.visual_fingerprint)?uniqueKeywords(m.visual_analysis.visual_fingerprint):[];
 const trends=m?.trend_analysis||{};
 const title=String(d.title||'').trim();
 const desc=String(d.description||'').trim();
 const keywords=uniqueKeywords(d.keywords);
 const category=String(d.category||'').trim();
 const titleMax=20, descMax=20, keywordMax=20, diversityMax=10, visualMax=25, trendMax=5;
 let visual=0;
 if(String(m?.visual_analysis?.summary||'').trim()) visual+=8;
 if(fp.length>=3) visual+=7; else if(fp.length) visual+=4;
 if(String(m?.visual_analysis?.subject||'').trim()) visual+=4;
 if(String(m?.visual_analysis?.composition||'').trim()) visual+=3;
 if(String(m?.visual_analysis?.style||'').trim()) visual+=3;
 visual=Math.min(visualMax,visual);
 let titleScore=0;
 if(title) titleScore+=8;
 if(p==='adobe' ? title.length<=70 : title.length<=200) titleScore+=4;
 if(title.split(/\s+/).filter(Boolean).length>=4) titleScore+=4;
 if(!/^(beautiful|amazing|cool|nice|stock image|illustration|photo|vector)\b/i.test(title)) titleScore+=4;
 titleScore=Math.min(titleMax,titleScore);
 let descScore=0;
 if(desc) descScore+=7;
 if(desc.length>=80) descScore+=5;
 if(desc.length>=120) descScore+=3;
 if(desc.split(/[.!?]+/).filter(x=>x.trim()).length>=2) descScore+=3;
 if(desc.toLowerCase()!==title.toLowerCase()) descScore+=2;
 descScore=Math.min(descMax,descScore);
 let keywordScore=0;
 if(keywords.length>=7) keywordScore+=5; else if(keywords.length) keywordScore+=2;
 if(keywords.length>=15) keywordScore+=4;
 if(keywords.length>=25) keywordScore+=4;
 if(keywords.length>=35) keywordScore+=3;
 if(category) keywordScore+=2;
 if(keywords.slice(0,10).length>=5) keywordScore+=2;
 keywordScore=Math.min(keywordMax,keywordScore);
 const diversity=keywords.length?Math.round(new Set(keywords.map(x=>x.toLowerCase())).size/keywords.length*diversityMax):0;
 let trend=Number(trends.match_percent); if(!Number.isFinite(trend)) trend=0; trend=Math.min(trendMax,Math.round(trend/20));
 const total=Math.max(0,Math.min(100,visual+titleScore+descScore+keywordScore+diversity+trend));
 return {total,visual,title:titleScore,description:descScore,keywords:keywordScore,diversity,trend};
}

function calculateQualityScore(m,adobe=false){const p=adobe?"adobe":"shutterstock";if(m?.quality_signals?.[p]?.total!=null)return Number(m.quality_signals[p].total);return scoreQuality(m,p).total;}

function displayPlatform(m,p){
  const d=m[p],x=p==="shutterstock"?"shutterstock":"adobe";
  $(x+"Title").value=d.title||"";
  $(x+"Description").value=d.description||"";
  $(x+"Keywords").value=uniqueKeywords(d.keywords).join(", ");
  $(x+"Category").value=d.category||"";
  $(x+"Score").textContent=`${calculateQualityScore(m,p==="adobe")}/100`;
  const kwLen = uniqueKeywords(d.keywords).length;
  $(x+"KeywordCount").textContent = `${kwLen} keywords ${p==="adobe"?"(Top 10 diprioritaskan oleh Adobe SEO)":""}`;
}

function renderScoreCard(m){
  let c=$("v2Intelligence");
  if(!c){
    c=document.createElement("div");
    c.id="v2Intelligence";
    c.className="intelligence-grid";
    $("metadataResult").prepend(c);
  }
  const t=m.trend_analysis||{};
  const a=scoreQuality(m,"adobe"),s=scoreQuality(m,"shutterstock");
  const rows=[ ["Visual",a.visual,25], ["Title",Math.round((a.title+s.title)/2),20], ["Description",Math.round((a.description+s.description)/2),20], ["Keywords",Math.round((a.keywords+s.keywords)/2),20], ["Diversity",Math.round((a.diversity+s.diversity)/2),10], ["Trend",Math.round((a.trend+s.trend)/2),5] ];
  const overall=Math.round((a.total+s.total)/2);
  c.innerHTML=`<div class="score-panel"><div class="panel-kicker">VECTOR QUALITY SCORE 2.0</div><div class="score-main">${overall}<span>/100</span></div><div class="score-label">Internal estimate · kelengkapan & kualitas metadata</div><div class="score-bars">${rows.map(r=>`<div class="score-row"><span>${r[0]}</span><div class="bar"><i style="width:${Math.min(100,Math.round(r[1]/r[2]*100))}%"></i></div><b>${r[1]}/${r[2]}</b></div>`).join("")}</div></div><div class="trend-panel"><div class="panel-kicker">TREND OPPORTUNITY</div><div class="trend-head"><strong>${escapeHtml(t.opportunity||"Low")}</strong><span>${Number(t.match_percent||0)}% match</span></div><div class="trend-tags">${(t.matched_trends||[]).slice(0,5).map(v=>`<span>${escapeHtml(v)}</span>`).join("")||"<span>Tidak ada match trend kuat</span>"}</div><p>${escapeHtml(t.reason||"")}</p></div>`;
}

function displayMetadata(m){
  $("metadataResult").hidden=false;
  if($("engineBadge")) $("engineBadge").textContent = `Engine Used: ${m.engine_used || 'AI Engine'}`;
  displayPlatform(m,"shutterstock");
  displayPlatform(m,"adobe");
  renderScoreCard(m);
}

function copyText(text,b){
  navigator.clipboard.writeText(String(text||"")).then(()=>{
    const o=b.textContent;
    b.textContent="COPIED";
    b.classList.add("copied");
    setTimeout(()=>{b.textContent=o;b.classList.remove("copied")},1100);
  }).catch(()=>showStatus("Clipboard tidak tersedia.","error"));
}

function setupCopyButtons(){
  document.addEventListener("click",e=>{
    const b=e.target.closest(".copy-button");
    if(!b)return;
    const t=document.querySelector(b.dataset.copy);
    if(t)copyText(t.value??t.textContent,b);
  });
}

function setupResultActions(){
  $("exportShutterstockCsvButton")?.addEventListener("click",()=>exportSinglePlatformCsv("shutterstock"));
  $("exportAdobeCsvButton")?.addEventListener("click",()=>exportSinglePlatformCsv("adobe"));
}

async function requestMetadata(file, forcedMediaType=null){
  const fd=new FormData();
  fd.append("apiKey", getGeminiApiKey());
  fd.append("openaiApiKey", getOpenAiApiKey());
  fd.append("provider", getProvider());
  fd.append("image", file);
  fd.append("mediaType", forcedMediaType||mediaChoiceForFile(file));
  fd.append("avoidTitles", JSON.stringify(state.recentTitles));
  fd.append("avoidDescriptions", JSON.stringify(state.recentDescriptions));
  
  const r=await fetch(apiUrl("/api/generate"),{method:"POST",body:fd});
  let d={};
  try{d=await r.json();}catch{throw new Error(`Server mengembalikan response tidak valid (${r.status}).`);}
  if(!r.ok){
    const err = new Error(d.error || `Generate gagal (${r.status}).`);
    err.details = d.details;
    err.status = r.status;
    err.code = d.code;
    throw err;
  }
  return d;
}

async function generateSingle(){
  const gKey = getGeminiApiKey();
  const oKey = getOpenAiApiKey();
  if(!gKey && !oKey){
    showStatus("Masukkan Gemini API Key atau OpenAI API Key terlebih dahulu.","error");
    return;
  }
  if(!state.selectedFile){
    showStatus("Pilih file terlebih dahulu.","error");
    return;
  }
  clearErrorCard();
  const b=$("generateButton");
  b.disabled=true;
  b.textContent="ANALYZING...";
  showStatus("AI sedang membaca media dan menyusun metadata...","loading");
  try{
    const d=await requestMetadata(state.selectedFile);
    state.lastMetadata=d;
    rememberMetadata(d);
    displayMetadata(d);
    showStatus(`Metadata berhasil dibuat (${d.engine_used}).`,"success");
  }catch(e){
    showStatus("Proses pembuatan metadata gagal.","error");
    displayErrorCard(e.message || "Terjadi Kesalahan AI Engine", e.details);
  }finally{
    b.disabled=false;
    b.textContent="⚡ GENERATE METADATA";
  }
}

function csvEscape(v){return `"${String(v??"").replace(/"/g,'""')}"`;}

function downloadCsv(content,name){
  const blob=new Blob(["\ufeff"+content],{type:"text/csv;charset=utf-8;"});
  const u=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=u;
  a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),500);
}

function platformCsv(fileName,m,p){
  const d=m[p]||{};
  const keywords=uniqueKeywords(d.keywords).join(", ");
  
  if(p==="adobe"){
    const headers=["Filename","Title","Keywords","Category"];
    const row=[fileName, d.title||"", keywords, d.category||""];
    return [headers, row].map(r=>r.map(csvEscape).join(",")).join("\n");
  } else {
    const headers=["Filename","Description","Keywords","Categories"];
    const row=[fileName, d.description||d.title||"", keywords, d.category||""];
    return [headers, row].map(r=>r.map(csvEscape).join(",")).join("\n");
  }
}

function exportSinglePlatformCsv(p){
  if(!state.lastMetadata){showStatus("Belum ada metadata untuk diekspor.","error");return;}
  const n=(state.selectedFile?.name||"metadata").replace(/\.[^/.]+$ / ,"");
  downloadCsv(platformCsv(state.selectedFile?.name||"metadata",state.lastMetadata,p),`${n}-${p==="shutterstock"?"shutterstock":"adobe-stock"}.csv`);
}

function exportBatchCombinedCsv(p){
  const successfulResults = state.batchResults.filter(r=>r.success);
  if(!successfulResults.length){
    showStatus("Belum ada hasil batch yang berhasil diproses.","error");
    return;
  }
  const headers = p==="adobe"?["Filename","Title","Keywords","Category"]:["Filename","Description","Keywords","Categories"];
  const rows = [headers];

  successfulResults.forEach(item => {
    const d = item.metadata?.[p]||{};
    const keywords = uniqueKeywords(d.keywords).join(", ");
    if(p==="adobe"){
      rows.push([item.fileName, d.title||"", keywords, d.category||""]);
    } else {
      rows.push([item.fileName, d.description||d.title||"", keywords, d.category||""]);
    }
  });

  const csvContent = rows.map(r=>r.map(csvEscape).join(",")).join("\n");
  downloadCsv(csvContent, `batch-${p==="adobe"?"adobe-stock":"shutterstock"}-all.csv`);
}

function renderBatchList(){
  const l=$("batchList");
  if(!state.batchFiles.length){
    l.innerHTML='<div class="empty-state">Belum ada file batch terpilih.</div>';
    return;
  }
  l.innerHTML=state.batchFiles.map((f,i)=>`<div class="batch-file"><span class="batch-index">${String(i+1).padStart(2,"0")}</span><span class="batch-name">${escapeHtml(f.name)}</span><span class="batch-size">${formatFileSize(f.size)} · ${typeOf(f)}</span></div>`).join("");
}

function batchPlatformHtml(item,p,label){
  const d=item.metadata?.[p]||{};
  return `<section class="batch-platform"><div class="batch-platform-head"><strong>${label}</strong><span>${calculateQualityScore(item.metadata,p==="adobe")}/100</span></div><div class="batch-field"><label>TITLE</label><div class="batch-value">${escapeHtml(d.title||"")}</div></div><div class="batch-field"><label>DESCRIPTION</label><div class="batch-value description-value">${escapeHtml(d.description||"")}</div></div><div class="batch-field"><label>KEYWORDS <small>${uniqueKeywords(d.keywords).length}</small></label><div class="batch-value keywords-value">${escapeHtml(uniqueKeywords(d.keywords).join(", "))}</div></div><div class="batch-field"><label>CATEGORY</label><div class="batch-value">${escapeHtml(d.category||"")}</div></div><button class="batch-csv-button" type="button" data-batch-csv="${p}" data-batch-index="${item.index}">DOWNLOAD CSV ${label}</button></section>`;
}

function renderBatchResults(){
  const c=$("batchResults");
  const exportArea=$("batchExportArea");
  
  if(!state.batchResults.length){
    c.innerHTML="";
    if(exportArea) exportArea.hidden=true;
    return;
  }

  const okCount = state.batchResults.filter(x=>x.success).length;
  if(exportArea) exportArea.hidden = okCount === 0;

  c.innerHTML=state.batchResults.map((item,i)=>{
    item.index=i;
    if(!item.success) {
      let errDetail = "";
      if (item.details) {
        errDetail = Object.entries(item.details).map(([k,v]) => `<div style="font-size:10px; margin-top:2px;"><strong>${k==='gemini'?'🔹 Gemini':'🟢 OpenAI'}:</strong> ${escapeHtml(v)}</div>`).join('');
      } else {
        errDetail = escapeHtml(item.error || "Gagal diproses.");
      }
      return `<article class="batch-result error-card"><header><div class="batch-thumb large"><span>ERR</span></div><div class="batch-file-heading"><span class="batch-file-label">FILE</span><strong>${escapeHtml(item.fileName)}</strong></div><em>ERROR</em></header><div style="margin-top:8px; color:#991b1b; font-size:11px;">${errDetail}</div></article>`;
    }
    return `<article class="batch-result"><header class="batch-result-header"><div class="batch-thumb large">${item.previewUrl?`<img src="${item.previewUrl}" alt="${escapeHtml(item.fileName)}">`:isVideoFileType(item.fileType)?`<span>VIDEO/MOTION</span>`:`<span>${escapeHtml(item.fileType||"FILE")}</span>`}</div><div class="batch-file-heading"><span class="batch-file-label">FILE</span><strong>${escapeHtml(item.fileName)}</strong><small>${escapeHtml(item.mediaType.toUpperCase())} · ${escapeHtml(item.metadata?.engine_used||'')}</small></div><em>${Math.round((calculateQualityScore(item.metadata)+calculateQualityScore(item.metadata,true))/2)}/100</em></header><div class="batch-platform-grid">${batchPlatformHtml(item,"adobe","ADOBE STOCK")}${batchPlatformHtml(item,"shutterstock","SHUTTERSTOCK")}</div></article>`;
  }).join("");
}

function isVideoFileType(t){return ["MP4","MOV","WEBM","M4V"].includes(t);}

function downloadBatchItemCsv(i,p){
  const item=state.batchResults[i];
  if(!item?.success){showStatus("Metadata file belum tersedia.","error");return;}
  const n=(item.fileName||"metadata").replace(/\.[^/.]+$ / ,"")||"metadata";
  downloadCsv(platformCsv(item.fileName,item.metadata,p),`${n}-${p==="shutterstock"?"shutterstock":"adobe-stock"}.csv`);
}

function setupBatchResultActions(){
  document.addEventListener("click",e=>{
    const b=e.target.closest("[data-batch-csv]");
    if(b)downloadBatchItemCsv(Number(b.dataset.batchIndex),b.dataset.batchCsv);
  });
  $("exportAllAdobeButton")?.addEventListener("click",()=>exportBatchCombinedCsv("adobe"));
  $("exportAllShutterstockButton")?.addEventListener("click",()=>exportBatchCombinedCsv("shutterstock"));
}

function setupBatch(){
  $("batchButton")?.addEventListener("click",()=>$("batchInput").click());
  $("batchInput")?.addEventListener("change",()=>{
    state.batchFiles=[...($("batchInput").files||[])].filter(isSupportedFile);
    renderBatchList();
  });
  $("generateAllButton")?.addEventListener("click",generateBatch);
}

async function generateBatch(){
  const gKey = getGeminiApiKey();
  const oKey = getOpenAiApiKey();
  if(!gKey && !oKey){
    showStatus("Masukkan Gemini API Key atau OpenAI API Key terlebih dahulu.","error");
    return;
  }
  if(!state.batchFiles.length){
    showStatus("Pilih file batch terlebih dahulu.","error");
    return;
  }
  const b=$("generateAllButton");
  b.disabled=true;
  b.textContent="GENERATING...";
  state.batchResults=[];
  renderBatchResults();
  
  for(let i=0;i<state.batchFiles.length;i++){
    const f=state.batchFiles[i];
    showStatus(`Memproses ${i+1}/${state.batchFiles.length}: ${f.name}`,"loading");
    try{
      const d=await requestMetadata(f,state.batchMediaType);
      rememberMetadata(d);
      state.batchResults.push({
        fileName:f.name,
        fileType:typeOf(f),
        mediaType:state.batchMediaType,
        previewUrl:isImage(f)?URL.createObjectURL(f):"",
        metadata:d,
        success:true
      });
      renderBatchResults();
    }catch(e){
      state.batchResults.push({
        fileName:f.name,
        fileType:typeOf(f),
        mediaType:mediaChoiceForFile(f),
        success:false,
        error:e.message||"Unknown error",
        details:e.details
      });
      renderBatchResults();
    }
  }
  b.disabled=false;
  b.textContent="⚡ GENERATE ALL BATCH";
  const ok=state.batchResults.filter(x=>x.success).length;
  showStatus(`Batch selesai: ${ok} berhasil diproses.`,ok?"success":"error");
}

document.addEventListener("DOMContentLoaded",()=>{
  loadSavedApiKeys();
  checkServer();
  setupSingleUpload();
  setupCopyButtons();
  setupResultActions();
  setupBatch();
  setupBatchResultActions();
  syncMediaButtons();
  renderBatchList();
});
