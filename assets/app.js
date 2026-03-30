const state={filesByPath:new Map(),catalog:[],filtered:[],currentBlobUrl:null,currentMime:''};
const el={folderInput:document.getElementById('folderInput'),fileInput:document.getElementById('fileInput'),status:document.getElementById('status'),tree:document.getElementById('tree'),list:document.getElementById('list'),countBadge:document.getElementById('countBadge'),pdfFrame:document.getElementById('pdfFrame'),imageViewer:document.getElementById('imageViewer'),videoViewer:document.getElementById('videoViewer'),viewerEmpty:document.getElementById('viewerEmpty'),viewerTitle:document.getElementById('viewerTitle'),meta:document.getElementById('meta'),openNewTabBtn:document.getElementById('openNewTabBtn'),searchInput:document.getElementById('searchInput')};

el.folderInput.addEventListener('change',e=>importFiles([...e.target.files],true));
el.fileInput.addEventListener('change',e=>importFiles([...e.target.files],false));
el.searchInput.addEventListener('input',renderList);
el.openNewTabBtn.addEventListener('click',()=>{if(state.currentBlobUrl) window.open(state.currentBlobUrl,'_blank');});

async function importFiles(files,isFolderImport){
  resetState();
  if(!files.length) return;
  const zipFiles=files.filter(f=>f.name.toLowerCase().endsWith('.zip'));
  try{
    if(zipFiles.length===1 && files.length===1){
      await importZip(zipFiles[0]);
      return;
    }
    if(zipFiles.length>0){
      el.status.textContent='ZIPは1個だけ選択してください。複数ファイル同時選択ではZIP展開しません。';
      return;
    }
    importFlatFiles(files,isFolderImport);
  }catch(err){
    el.status.textContent=`読込失敗: ${err.message}`;
    renderTree();
    renderList();
  }
}

async function importZip(zipFile){
  if(typeof JSZip==='undefined') throw new Error('ZIPライブラリの読込に失敗しました。');
  el.status.textContent=`ZIP展開中: ${zipFile.name}`;
  const zip=await JSZip.loadAsync(zipFile);
  const entries=Object.values(zip.files).filter(entry=>!entry.dir);
  if(!entries.length) throw new Error('ZIP内にファイルがありません。');

  const rootStrip=detectZipRootStrip(entries.map(entry=>entry.name));
  for(const entry of entries){
    const blob=await entry.async('blob');
    const normalized=normalizeZipPath(entry.name,rootStrip);
    if(!normalized) continue;
    state.filesByPath.set(normalized,blob);
  }
  await finalizeCatalog(`ZIP読込成功: ${state.catalog.length}件 / ${state.filesByPath.size}ファイル`);
}

function importFlatFiles(files,isFolderImport){
  for(const file of files){
    const relPath=normalizeRelativePath(file,isFolderImport);
    state.filesByPath.set(relPath,file);
  }
  finalizeCatalog(`読込成功: ${state.catalog.length}件 / ${state.filesByPath.size}ファイル`);
}

async function finalizeCatalog(successMessage){
  const catalogFile=findFile(['catalog.json']);
  if(!catalogFile){
    el.status.textContent='catalog.json が見つかりません。sample_package フォルダまたはZIPを選択してください。';
    renderTree();
    renderList();
    return;
  }
  const parsed=JSON.parse(await catalogFile.text());
  const items=Array.isArray(parsed.items)?parsed.items:[];
  state.catalog=items.map(item=>({...item,_resolvedFile:resolveDocFile(item.file||'')}));
  el.status.textContent=successMessage;
  renderTree();
  renderList();
}

function detectZipRootStrip(paths){
  if(paths.includes('catalog.json')) return '';
  const catalogCandidates=paths.filter(p=>p.endsWith('/catalog.json'));
  if(catalogCandidates.length===1){
    const parts=catalogCandidates[0].split('/');
    if(parts.length>=2) return parts[0];
  }
  const firstSegments=[...new Set(paths.map(p=>p.split('/')[0]).filter(Boolean))];
  if(firstSegments.length===1) return firstSegments[0];
  return '';
}

function normalizeZipPath(path,rootStrip){
  let p=String(path||'').replace(/^\/+/, '').replace(/\\/g,'/');
  if(rootStrip && p.startsWith(rootStrip+'/')) p=p.slice(rootStrip.length+1);
  return p;
}

function normalizeRelativePath(file,isFolderImport){
  let p=file.webkitRelativePath||file.name;
  p=p.replace(/^\/+/, '').replace(/\\/g,'/');
  if(!isFolderImport) return p;
  const parts=p.split('/');
  if(parts.length>1) parts.shift();
  return parts.join('/');
}

function findFile(names){
  for(const [path,file] of state.filesByPath.entries()){
    if(names.includes(path)) return file;
  }
  return null;
}

function resolveDocFile(targetPath){
  const normalized=targetPath.replace(/\\/g,'/').replace(/^\/+/, '');
  return state.filesByPath.get(normalized)||null;
}

function renderTree(){
  if(!state.catalog.length){
    el.tree.className='tree empty';
    el.tree.textContent='パッケージを読み込むとここに階層が出ます。';
    return;
  }
  const grouped=new Map();
  for(const item of state.catalog){
    if(!grouped.has(item.route)) grouped.set(item.route,new Map());
    const subMap=grouped.get(item.route);
    if(!subMap.has(item.substation)) subMap.set(item.substation,new Map());
    const catMap=subMap.get(item.substation);
    if(!catMap.has(item.category)) catMap.set(item.category,new Map());
    const equipMap=catMap.get(item.category);
    if(!equipMap.has(item.equipment)) equipMap.set(item.equipment,[]);
    equipMap.get(item.equipment).push(item);
  }
  el.tree.className='tree';
  el.tree.innerHTML='';
  for(const [route,substations] of grouped.entries()){
    const routeDetails=makeDetails(route);
    for(const [sub,categories] of substations.entries()){
      const subDetails=makeDetails(sub);
      for(const [cat,equips] of categories.entries()){
        const catDetails=makeDetails(cat);
        for(const [equip,items] of equips.entries()){
          const equipDetails=makeDetails(`${equip} (${items.length})`);
          const btn=document.createElement('button');
          btn.className='leaf-btn';
          btn.textContent='この設備の資料を表示';
          btn.addEventListener('click',()=>{el.searchInput.value=equip;renderList();});
          equipDetails.appendChild(btn);
          catDetails.appendChild(equipDetails);
        }
        subDetails.appendChild(catDetails);
      }
      routeDetails.appendChild(subDetails);
    }
    el.tree.appendChild(routeDetails);
  }
}

function makeDetails(label){
  const details=document.createElement('details');
  const summary=document.createElement('summary');
  summary.textContent=label;
  details.appendChild(summary);
  return details;
}

function renderList(){
  const q=(el.searchInput.value||'').trim().toLowerCase();
  state.filtered=state.catalog.filter(item=>{
    const hay=[item.route,item.substation,item.category,item.equipment,item.title,item.type,...(item.tags||[])].join(' ').toLowerCase();
    return !q||hay.includes(q);
  });
  el.countBadge.textContent=`${state.filtered.length}件`;
  if(!state.filtered.length){
    el.list.className='list empty';
    el.list.textContent='該当資料がありません。';
    return;
  }
  el.list.className='list';
  el.list.innerHTML='';
  for(const item of state.filtered){
    const div=document.createElement('div');
    div.className='item';
    const tags=(item.tags||[]).map(t=>`<span class="tag">#${escapeHtml(t)}</span>`).join('');
    div.innerHTML=`<h3>${escapeHtml(item.title||'(無題)')}</h3><div class="path">${escapeHtml(item.route)} ＞ ${escapeHtml(item.substation)} ＞ ${escapeHtml(item.category)} ＞ ${escapeHtml(item.equipment)}</div><div class="muted">更新日: ${escapeHtml(item.updatedAt||'-')} / 種別: ${escapeHtml(item.type||'-')}</div><div class="tags">${tags}</div><div class="row"><span class="muted">${escapeHtml(item.file||'')}</span><button type="button">開く</button></div>`;
    div.querySelector('button').addEventListener('click',()=>openItem(item));
    el.list.appendChild(div);
  }
}

function openItem(item){
  clearViewer();
  if(!item._resolvedFile){
    el.viewerTitle.textContent=item.title||'資料ビューア';
    el.meta.textContent='対応ファイルが見つかりません。ZIPまたはパッケージ全体を選択したか確認してください。';
    state.currentBlobUrl=null;
    el.openNewTabBtn.disabled=true;
    return;
  }
  const url=URL.createObjectURL(item._resolvedFile);
  state.currentBlobUrl=url;
  const kind=detectKind(item);
  state.currentMime=item._resolvedFile.type||'';
  el.viewerTitle.textContent=item.title||'資料ビューア';
  el.meta.textContent=`${item.route} / ${item.substation} / ${item.category} / ${item.equipment} / ${item.type||kind}`;
  if(kind==='pdf'){
    el.pdfFrame.src=url;
    el.pdfFrame.classList.remove('hidden');
  }else if(kind==='image'){
    el.imageViewer.src=url;
    el.imageViewer.classList.remove('hidden');
  }else if(kind==='video'){
    el.videoViewer.src=url;
    el.videoViewer.classList.remove('hidden');
  }else{
    el.viewerEmpty.textContent='この資料種別は埋め込み表示に未対応です。新規タブで開いて確認してください。';
    el.viewerEmpty.classList.remove('hidden');
  }
  el.openNewTabBtn.disabled=false;
}

function detectKind(item){
  const lower=((item.type||'')+' '+(item.file||'')).toLowerCase();
  if(lower.includes('.pdf')||lower.includes('pdf')) return 'pdf';
  if(/\.(png|jpg|jpeg|webp|gif)$/i.test(lower)||/(image|画像)/i.test(lower)) return 'image';
  if(/\.(mp4|mov|m4v|webm)$/i.test(lower)||/(video|動画)/i.test(lower)) return 'video';
  return 'other';
}

function clearViewer(){
  if(state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);
  state.currentBlobUrl=null;
  el.pdfFrame.removeAttribute('src');
  el.imageViewer.removeAttribute('src');
  el.videoViewer.pause();
  el.videoViewer.removeAttribute('src');
  el.pdfFrame.classList.add('hidden');
  el.imageViewer.classList.add('hidden');
  el.videoViewer.classList.add('hidden');
  el.viewerEmpty.classList.add('hidden');
}

function resetState(){
  clearViewer();
  state.filesByPath.clear();
  state.catalog=[];
  state.filtered=[];
  state.currentMime='';
  el.searchInput.value='';
  el.openNewTabBtn.disabled=true;
  el.viewerTitle.textContent='資料ビューア';
  el.meta.textContent='資料を選択すると詳細が出ます。';
  el.viewerEmpty.textContent='PDF / 画像 / 動画をここに表示します。';
  el.viewerEmpty.classList.remove('hidden');
  renderTree();
  renderList();
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

resetState();
