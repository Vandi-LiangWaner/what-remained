/* Reminiscence — no framework, no network, only the visible landscape is drawn. */
const {DAY,parseDate,eventTimes,plain,indexEvent,matches,validateEvent,visibleGroups}=window.FieldCore;
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
const call=(method,payload)=>window.field.call(method,payload);
const C={events:[],settings:{categories:[],pins:[]},syncStatus:{},filter:{query:'',categories:[],source:'all',from:'',to:''},index:new Map(),lanes:[],center:Date.now(),scale:DAY*30,targetCenter:Date.now(),targetScale:DAY*30,showCurrent:true,ready:false};
const fmt=(time,options={year:'numeric',month:'short',day:'numeric'})=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',...options}).format(new Date(time));
const dateLabel=value=>!value?'Undated':value.length===4?value:value.length===7?fmt(parseDate(value),{month:'short',year:'numeric'}):fmt(parseDate(value));
const color=e=>/^#[a-f\d]{6}$/i.test(e.color)?e.color:(C.settings.categories.find(c=>c.id===e.category)?.color||'#5d7965');
const categoryName=e=>C.settings.categories.find(c=>c.id===e.category)?.name||'Uncategorized';
const asset=a=>`field-asset://local/${encodeURIComponent(a.id)}`;
let toastTimer,filterTimer,viewTimer,frame=0,lensTimer,activeDraft=null,draftTimer,persistPromise=Promise.resolve(),draftDirty=false;
function toast(text) {$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);}
function report(error){console.error(error);toast(error.message||String(error));}
function accept(data,initial=false){
  C.events=data.events;C.settings=data.settings;C.syncStatus=data.syncStatus;C.root=data.root;
  C.index=new Map(C.events.map(e=>[e.id,indexEvent(e,C.settings.categories)]));
  if(initial && C.settings.view){C.center=C.targetCenter=C.settings.view.center;C.scale=C.targetScale=C.settings.view.scale;C.showCurrent=C.settings.view.showCurrent!==false;}
  updateSync();updateCategoryFilters();rebuild();
}
async function load(initial=false){accept(await call('load'),initial);}
function updateSync(){
  $('#sync-dot').className='dot '+C.syncStatus.state;
  $('#library-button').title=C.syncStatus.message||'Connect Literature Box';
  $('#footer-sync').textContent=C.syncStatus.state==='connected'?` · ${C.syncStatus.count} papers from Literature Box`:'';
}
function filterDescription(f){return [f.query && `“${f.query}”`,f.categories?.map(id=>C.settings.categories.find(c=>c.id===id)?.name).join(', '),f.source!=='all'&&f.source==='papers'?'Literature':f.source==='events'?'My events':'',f.from&&`from ${f.from}`,f.to&&`until ${f.to}`].filter(Boolean).join(' · ')||'All events';}
function rebuild(){
  const usable=C.events.filter(e=>!e.hidden);
  const definitions=[...(C.showCurrent?[{id:'current',name:'The landscape',filter:C.filter}]:[]),...C.settings.pins];
  if(!definitions.length){C.showCurrent=true;definitions.push({id:'current',name:'The landscape',filter:C.filter});}
  C.lanes=definitions.map(lane=>({...lane,events:usable.filter(e=>matches(e,lane.filter,C.index.get(e.id)||''))}));
  const selected=new Set(C.lanes.flatMap(l=>l.events.map(e=>e.id)));
  const undated=usable.filter(e=>selected.has(e.id)&&parseDate(e.start)===null);
  $('#event-count').textContent=`${selected.size.toLocaleString()} of ${usable.length.toLocaleString()} records`;
  $('#undated-button').hidden=!undated.length;$('#undated-button').textContent=`${undated.length} undated ↗`;
  $('#show-current').hidden=C.showCurrent;
  $('#empty').hidden=usable.length>0;
  $('#lanes').hidden=usable.length===0;
  $('#lanes').innerHTML=C.lanes.map(lane=>`<section class="lane" data-lane="${esc(lane.id)}"><div class="lane-head"><span class="swatch" style="--c:${lane.id==='current'?'#89967d':'#b28c61'}"></span><span class="lane-name">${esc(lane.name)}</span><span class="lane-query">${esc(filterDescription(lane.filter))}</span><span class="lane-count">${lane.events.length.toLocaleString()} records</span>${lane.id==='current'?C.settings.pins.length?'<button data-hide-current title="Hide this lane">Hide</button>':'':`<button data-fit-lane="${esc(lane.id)}">Fit</button><button data-unpin="${esc(lane.id)}" title="Unpin view">×</button>`}</div><div class="track" tabindex="0" role="region" aria-label="${esc(lane.name)} timeline. Arrow keys pan, plus and minus zoom."></div><div class="lane-bottom"><span>EARLIER</span><input type="range" min="0" max="1000" value="500" aria-label="Travel through time"><span>LATER</span></div></section>`).join('');
  $('#filter-count').textContent=[C.filter.categories.length,C.filter.source!=='all',!!C.filter.from,!!C.filter.to].reduce((a,b)=>a+Number(b),0)||'';
  for(const node of document.querySelectorAll('.lane')){
    const track=node.querySelector('.track');
    track.addEventListener('wheel',wheel,{passive:false});
    track.addEventListener('pointerdown',panStart);
    track.addEventListener('keydown',navigateKey);
    track.addEventListener('dblclick',event=>{if(event.target.closest('button'))return;const x=event.clientX-track.getBoundingClientRect().left;openEditor(null,C.center+(x-track.clientWidth/2)*C.scale);});
    const slider=node.querySelector('input[type=range]');
    slider.addEventListener('input',()=>{const bounds=allBounds();if(bounds)moveTo(bounds[0]+Number(slider.value)/1000*(bounds[1]-bounds[0]),C.targetScale);});
  }
  render();
}
function allBounds(events=C.lanes.flatMap(l=>l.events)){
  let min=Infinity,max=-Infinity;
  for(const e of events){const {a,b}=eventTimes(e);if(a===null)continue;min=Math.min(min,a);max=Math.max(max,b??a);}
  return min===Infinity?null:[min,max];
}
function fit(events){
  const bounds=allBounds(events);if(!bounds)return;
  const width=$('.track')?.clientWidth||1100;
  moveTo((bounds[0]+bounds[1])/2,Math.max(DAY/12,(bounds[1]-bounds[0]+DAY*60)/Math.max(300,width-320)));
}
function moveTo(center,scale){
  C.targetScale=Math.max(DAY/800,Math.min(DAY*365.2425*20,scale));
  C.targetCenter=Math.max(parseDate('0001'),Math.min(parseDate('9999'),center));
  if(!frame)frame=requestAnimationFrame(animate);
  clearTimeout(viewTimer);viewTimer=setTimeout(()=>{call('settings',{view:{center:C.targetCenter,scale:C.targetScale,showCurrent:C.showCurrent}}).catch(report);},700);
}
function animate(){
  C.center+=(C.targetCenter-C.center)*.24;C.scale+=(C.targetScale-C.scale)*.24;
  if(Math.abs(C.center-C.targetCenter)<C.scale*.05&&Math.abs(C.scale-C.targetScale)<C.scale*.0005){C.center=C.targetCenter;C.scale=C.targetScale;frame=0;render();return;}
  render();frame=requestAnimationFrame(animate);
}
function zoom(factor,x){
  const width=$('.track')?.clientWidth||1100;
  const next=Math.max(DAY/800,Math.min(DAY*365.2425*20,C.targetScale*factor));
  moveTo(C.targetCenter+(x===undefined?0:x-width/2)*(C.targetScale-next),next);
}
function wheel(event){
  event.preventDefault();hideLens();
  let dx=event.deltaX,dy=event.deltaY;
  if(event.deltaMode===1){dx*=24;dy*=24;}if(event.deltaMode===2){dx*=event.currentTarget.clientWidth;dy*=400;}
  if(event.ctrlKey||event.metaKey)zoom(Math.exp(dy*.0025),event.clientX-event.currentTarget.getBoundingClientRect().left);
  else moveTo(C.targetCenter+(Math.abs(dx)>Math.abs(dy)?dx:dy)*C.targetScale,C.targetScale);
}
function panStart(event){
  if(event.button!==0||event.target.closest('button'))return;
  const track=event.currentTarget,startX=event.clientX,center=C.targetCenter;let moved=false;
  track.setPointerCapture(event.pointerId);track.classList.add('dragging');hideLens();
  const move=e=>{if(Math.abs(e.clientX-startX)>3)moved=true;moveTo(center-(e.clientX-startX)*C.targetScale,C.targetScale);};
  const end=()=>{track.classList.remove('dragging');track.removeEventListener('pointermove',move);track.removeEventListener('pointerup',end);track.removeEventListener('pointercancel',end);if(moved)track.dataset.moved='true';};
  track.addEventListener('pointermove',move);track.addEventListener('pointerup',end);track.addEventListener('pointercancel',end);
}
function navigateKey(e){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();moveTo(C.targetCenter+(e.key==='ArrowLeft'?-1:1)*C.scale*180,C.targetScale);}if(e.key==='+'||e.key==='=')zoom(.65);if(e.key==='-')zoom(1.5);}
function ticks(left,right,width){
  const span=right-left,target=span/Math.max(2,width/130),result=[];
  if(target<DAY*25){const steps=[1/24,1/4,1,2,7,14,28];const step=(steps.find(d=>d*DAY>=target)||28)*DAY;for(let t=Math.ceil(left/step)*step;t<=right;t+=step)result.push({t,label:fmt(t,target<DAY?{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'})});}
  else if(target<DAY*330){const step=target<DAY*60?1:target<DAY*120?3:6;const d=new Date(left);d.setUTCDate(1);d.setUTCHours(0,0,0,0);d.setUTCMonth(Math.floor(d.getUTCMonth()/step)*step);while(d.getTime()<=right){result.push({t:d.getTime(),label:fmt(d.getTime(),{month:'short',year:'numeric'})});d.setUTCMonth(d.getUTCMonth()+step);}}
  else{const years=target/(DAY*365.2425);const base=10**Math.floor(Math.log10(years));const step=[1,2,5,10].map(x=>x*base).find(x=>x>=years)||base*10;const first=Math.floor(new Date(left).getUTCFullYear()/step)*step;for(let y=Math.max(1,first);y<=Math.min(9999,new Date(right).getUTCFullYear()+step);y+=step){const d=new Date(0);d.setUTCFullYear(y,0,1);d.setUTCHours(0,0,0,0);result.push({t:d.getTime(),label:String(y)});}}
  return result;
}
function render(){
  const bounds=allBounds();
  C.lanes.forEach(lane=>{
    const track=document.querySelector(`[data-lane="${CSS.escape(lane.id)}"] .track`);if(!track)return;
    const width=track.clientWidth,left=C.center-width*C.scale/2,right=C.center+width*C.scale/2,axis=184;
    const groups=visibleGroups(lane.events,C.center,C.scale,width);
    let svg=`<line class="axis-line" x1="0" x2="${width}" y1="${axis}" y2="${axis}"/>`,cards='';
    for(const tick of ticks(left,right,width)){const x=(tick.t-left)/C.scale;svg+=`<line class="tick-line" x1="${x}" x2="${x}" y1="22" y2="345"/><text class="tick-text" x="${x+5}" y="${axis+24}">${esc(tick.label)}</text>`;}
    groups.forEach((g,i)=>{
      const event=g.events[0],c=color(event),top=i%2===0?48:239,cardX=Math.max(8,Math.min(width-170,g.x-81));
      const yEnd=top<axis?top+98:top;
      if(g.events.length===1 && event.end){const x1=Math.max(0,g.startX),x2=Math.min(width,g.endX);svg+=`<g style="--c:${c}"><rect class="period" x="${x1}" y="${axis-7}" width="${Math.max(3,x2-x1)}" height="14" rx="3"/><path class="period-outline" d="M${x1},${axis-7}V${axis+7}M${x2},${axis-7}V${axis+7}"/></g>`;}
      svg+=`<g style="--c:${c}"><path class="connector" d="M${g.x},${axis}V${yEnd}"/><circle class="anchor" cx="${g.x}" cy="${axis}" r="4"/></g>`;
      const attachment=event.attachments?.find(a=>a.image);
      cards+=g.events.length>1?`<button class="event-card cluster" data-cluster="${i}" data-lane-id="${esc(lane.id)}" style="left:${cardX}px;top:${top}px;--c:${c}"><span class="cluster-count">${g.events.length}</span><strong>events close in time</strong><small>Click to explore this cluster ↗</small></button>`:`<button class="event-card ${attachment?'has-image':''}" data-event="${esc(event.id)}" style="left:${cardX}px;top:${top}px;--c:${c}"><span class="event-date">${esc(dateLabel(event.start))}${event.end?' — '+esc(dateLabel(event.end)):''}</span><strong>${esc(event.title)}</strong><small>${esc(event.place||event.source?.authors||categoryName(event))}${event.attachments?.length?' · ▧':''}</small>${attachment?`<img src="${asset(attachment)}" alt="">`:''}</button>`;
    });
    track.innerHTML=`<svg width="${width}" height="368" aria-hidden="true">${svg}</svg>${cards}${!groups.length?`<div class="lane-empty">${lane.events.some(e=>e.start)?'No events here. Keep travelling, or fit the view.':lane.events.length?'These records have no date yet. Open the undated list.':'No events match this view.'}</div>`:''}`;
    const slider=track.parentElement.querySelector('input[type=range]');if(bounds && document.activeElement!==slider)slider.value=bounds[1]===bounds[0]?500:Math.max(0,Math.min(1000,(C.center-bounds[0])/(bounds[1]-bounds[0])*1000));
  });
  const width=$('.track')?.clientWidth||1100;
  $('#range-label').textContent=`${fmt(Math.max(parseDate('0001'),C.center-width*C.scale/2),{month:'short',year:'numeric'})} — ${fmt(Math.min(parseDate('9999'),C.center+width*C.scale/2),{month:'short',year:'numeric'})}`;
  const span=width*C.scale/DAY;$('#zoom-label').textContent=span<3?'Hours':span<70?'Days':span<750?'Months':span<36525?'Years':'Centuries';
}
function hideLens(){clearTimeout(lensTimer);$('#hover-lens').hidden=true;}
function showLens(event,node){
  hideLens();if(!event.end)return;
  lensTimer=setTimeout(()=>{const lens=$('#hover-lens'),rect=node.getBoundingClientRect(),days=Math.max(0,Math.round((parseDate(event.end)-parseDate(event.start))/DAY));lens.style.cssText=`--c:${color(event)};left:${Math.min(innerWidth-340,Math.max(15,rect.left-55))}px;top:${Math.min(innerHeight-230,Math.max(12,rect.top-210))}px`;
    lens.innerHTML=`<span class="eyebrow">PERIOD LENS · ${days.toLocaleString()} DAYS</span><h4>${esc(event.title)}</h4><div class="lens-bar"></div><div class="lens-dates"><span>${esc(dateLabel(event.start))}</span><span>${esc(dateLabel(event.end))}</span></div><p>${esc(plain(event.text).slice(0,150)||'A closer look at this period.')}<br>Click to open · Use Fit period in the event.</p>`;lens.hidden=false;
  },300);
}
function updateCategoryFilters(){
  $('#category-filters').innerHTML=C.settings.categories.map(c=>`<button class="category-chip ${C.filter.categories.includes(c.id)?'active':''}" data-category-filter="${esc(c.id)}"><span class="swatch" style="--c:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('');
}
function filterChanged(){
  C.filter.query=$('#search').value;C.filter.source=$('#source-filter').value;C.filter.from=$('#from-filter').value.trim();C.filter.to=$('#to-filter').value.trim();
  for(const key of ['from','to'])if(C.filter[key]&&parseDate(C.filter[key])===null){toast('Filter dates use YYYY, YYYY-MM, or YYYY-MM-DD.');return;}
  C.showCurrent=true;updateCategoryFilters();rebuild();
}
async function saveSettings(patch){C.settings=await call('settings',patch);C.index=new Map(C.events.map(e=>[e.id,indexEvent(e,C.settings.categories)]));updateCategoryFilters();rebuild();}
function panel(title,html){$('#panel-title').textContent=title;$('#panel-body').innerHTML=html;if(!$('#panel').open)$('#panel').showModal();}
function listEvents(title,events){
  panel(title,`<h3>${esc(title)}</h3><p>${events.length} records. Choose one to open its full details.</p>${events.map(e=>`<button class="list-event" data-open-listed="${esc(e.id)}"><small>${esc(dateLabel(e.start))} · ${esc(categoryName(e))}</small>${esc(e.title)}</button>`).join('')}`);
}
function pinFilter(){panel('PIN A VIEW',`<h3>A thread through the landscape.</h3><p>${esc(filterDescription(C.filter))}</p><label>Name this timeline<input id="pin-name" placeholder="e.g. Wetland restoration" style="width:100%;margin:10px 0 17px" maxlength="100"></label><button id="confirm-pin" class="primary">Pin timeline</button><p>Pinned timelines retain this filter and follow the same time scale. New matching records appear automatically.</p>`);$('#pin-name').focus();}
function categoriesPanel(){panel('CATEGORIES & COLORS',`<h3>A palette of connections.</h3><p>Choose your own names and colors. Changing a category color updates its connecting lines.</p><div id="category-editor">${C.settings.categories.map(c=>`<div class="category-edit" data-id="${esc(c.id)}"><input type="color" value="${esc(c.color)}" aria-label="Category color"><input type="text" value="${esc(c.name)}" aria-label="Category name"><button data-delete-category="${esc(c.id)}" aria-label="Delete category">×</button></div>`).join('')}</div><button id="add-category">＋ Category</button><button id="save-categories" class="primary">Apply palette</button><p>Deleting a category keeps its events and their individual colors.</p>`);}
function libraryPanel(){panel('LITERATURE BOX',`<h3>Your reading, in time.</h3><p>${esc(C.syncStatus.message)}</p><div class="settings-row"><p>Read-only sync checks for changes every 20 seconds while Reminiscence is open. Publication years remain year-level dates. Every field on a paper card is searchable. Your own notes and attachments are kept separately.</p><code>${esc(C.settings.sourcePath||'No library selected')}</code></div><button id="choose-library">Choose library…</button><button id="sync-now">Sync now</button><button id="toggle-sync">${C.settings.sync?'Pause':'Resume'} sync</button><p>Removed source cards are retained with a source-unavailable label. Hidden papers stay hidden. Source images are shown when opening a paper; attachments you add here are saved locally.</p>`);}
function settingsPanel(){panel('YOUR NOTEBOOK',`<h3>Kept close. Remembered well.</h3><div class="settings-row"><button id="export-backup">Export portable backup</button><button id="import-backup">Import & merge backup…</button><p>Portable backups include your events, categories, pinned views, and attached files. Imports merge by event ID; matching IDs are updated. Your automatic database backup is in the Backups folder.</p></div><div class="settings-row"><button id="open-folder">Open notebook folder</button><p><code>${esc(C.root)}</code></p><button id="settings-categories">Categories & colors</button><button id="settings-library">Literature Box connection</button></div><div class="settings-row"><button id="restore-papers">Restore hidden papers</button><p>No accounts, telemetry, or cloud services. Files stay on this computer.</p></div>`);}
function helpPanel(){panel('A SMALL FIELD GUIDE',`<h3>Make room for time.</h3><p><b>Travel.</b> Scroll or drag a timeline. The bottom slider travels across your whole collection. All pinned views move together. Use Ctrl + scroll, the + / − buttons, or the keyboard to zoom.</p><p><b>Record.</b> Add a point in time or give it an end date. Hover a period for its magnified lens. Attach pictures, PDFs, or other files; add captions and any custom fields you need. Double-click empty timeline space to add an event there.</p><p><b>Connect.</b> Search matches words across every field, source metadata, captions, and filenames. Multiple words must all appear. Categories are combined with OR; other filters are combined with AND. Date filters include periods that overlap the chosen range.</p><p><b>Compare.</b> Pin a filter to create a separate timeline; repeat to compare several threads. Each pin remembers the filter. Use the current search view for exploring without changing pins.</p><p><b>Read density.</b> Nearby events gather into numbered clusters. Open a cluster to browse every event, or zoom closer. Nothing is dropped from a dense view.</p><p><b>Keep.</b> Event changes save in the background after a short pause and before you close the app. Export a portable backup to move the notebook, including its files. A database backup is also refreshed after edits.</p><p><b>Shortcuts.</b> / focuses search · N adds an event · arrows pan a focused timeline · + / − zoom · Esc closes dialogs.</p>`);}
function makeDraft(time){const d=new Date(time??Date.now());return {id:uid(),title:'',start:d.toISOString().slice(0,10),end:'',category:C.settings.categories[0]?.id||'',color:C.settings.categories[0]?.color||'#5d7965',place:'',species:'',tags:'',text:'',notes:'',extraFields:{},attachments:[]};}
function openEditor(event,time){
  hideLens();activeDraft=structuredClone(event||makeDraft(time));draftDirty=false;
  $('#editor-error').textContent='';$('#editor-eyebrow').textContent=event?(event.source?'FROM LITERATURE BOX':'AN EVENT IN TIME'):'A NEW EVENT';
  for(const key of ['title','start','end','color','place','species','tags','text','notes'])$('#event-'+key).value=activeDraft[key]||'';
  $('#event-category').innerHTML=C.settings.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('#event-category').value=activeDraft.category;
  for(const key of ['title','start','end','place','species','tags','text'])$('#event-'+key).readOnly=!!event?.source;
  $('#event-start').required=!event?.source;
  $('#delete-event').hidden=!event;$('#delete-event').textContent=event?.source?'Hide paper':'Delete event';
  $('#source-note').hidden=!event?.source;
  if(event?.source)$('#source-note').innerHTML=`${esc(event.source.authors)}<br>${esc(event.source.journal)} · ${esc(event.source.year||'Undated')} · Read-only source${event.sourceMissing?' · Source no longer available':''}${event.source.doi||event.source.link?`<br><button type="button" class="quiet" id="open-paper-link">Open paper ↗</button>`:''}<button type="button" class="quiet" id="fit-event">Fit ${event.end?'period':'event'} ↗</button>`;
  else $('#source-note').innerHTML='';
  if(!event?.source && event?.end){$('#source-note').hidden=false;$('#source-note').innerHTML='<button type="button" class="quiet" id="fit-event">Fit this period in the timeline ↗</button>';}
  renderExtra();renderAttachments();
  $('#paper-details').innerHTML=event?.source?`${(event.paperAttachments||[]).map(a=>`<figure><img style="max-width:100%;max-height:260px;object-fit:contain" src="${asset(a)}" alt="${esc(a.caption||a.name)}"><figcaption>${esc(a.caption||a.name)}</figcaption></figure>`).join('')}<details><summary>All source fields · searchable</summary><dl>${Object.entries(event.fields||{}).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(plain(v))}</dd>`).join('')}</dl></details>`:'';
  $('#draft-status').textContent=event?'Saved locally':'Saved when you close';
  $('#editor').showModal();$('#event-title').focus();
}
function renderExtra(){
  $('#extra-fields').innerHTML=Object.entries(activeDraft.extraFields||{}).map(([k,v])=>`<div class="extra-row"><input class="extra-key" value="${esc(k)}" placeholder="Field name" aria-label="Field name"><textarea class="extra-value" placeholder="Anything you want to record" aria-label="Field value">${esc(v)}</textarea><button type="button" data-remove-field aria-label="Remove field">×</button></div>`).join('');
}
function renderAttachments(){
  $('#attachments').innerHTML=(activeDraft.attachments||[]).map((a,i)=>`<div class="attachment" data-index="${i}">${a.image?`<img src="${asset(a)}" alt="${esc(a.caption||a.name)}" data-view-image="${i}">`:'<span aria-hidden="true">▧</span>'}<div class="attachment-info"><span>${esc(a.name)}</span><input data-caption="${i}" value="${esc(a.caption)}" placeholder="Add a caption…" aria-label="Attachment caption"></div><button type="button" data-open-attachment="${i}" title="Open file">↗</button><button type="button" data-move-attachment="${i}" title="Move earlier">↑</button><button type="button" data-remove-attachment="${i}" aria-label="Remove attachment">×</button></div>`).join('');
}
function collectDraft(){
  if(!activeDraft)return;
  for(const key of ['title','start','end','color','place','species','tags','text','notes'])activeDraft[key]=$('#event-'+key).value;
  activeDraft.category=$('#event-category').value;activeDraft.extraFields={};
  for(const row of document.querySelectorAll('.extra-row')){const key=row.querySelector('.extra-key').value.trim();if(key)activeDraft.extraFields[key]=row.querySelector('.extra-value').value;}
  for(const input of document.querySelectorAll('[data-caption]'))activeDraft.attachments[Number(input.dataset.caption)].caption=input.value;
  return activeDraft;
}
function draftChanged(){draftDirty=true;$('#draft-status').textContent='Saving after a pause…';clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft(false).catch(()=>{}),1100);}
async function saveDraft(required=true){
  clearTimeout(draftTimer);if(!activeDraft||!draftDirty)return persistPromise;
  const snapshot=structuredClone(collectDraft());
  try{validateEvent(snapshot);}catch(error){$('#editor-error').textContent=required?error.message:'';$('#draft-status').textContent='Add a title and valid date to save';if(required)throw error;return;}
  draftDirty=false;$('#editor-error').textContent='';
  persistPromise=persistPromise.catch(()=>{}).then(async()=>{
    try{const saved=await call('save',snapshot);const i=C.events.findIndex(e=>e.id===saved.id);if(i<0)C.events.push(saved);else C.events[i]=saved;C.index.set(saved.id,indexEvent(saved,C.settings.categories));rebuild();$('#draft-status').textContent='Saved locally';$('#save-status').textContent='SAVED LOCALLY';}
    catch(error){draftDirty=true;$('#editor-error').textContent=error.message;$('#draft-status').textContent='Save failed — retry Done';throw error;}
  });return persistPromise;
}
async function closeEditor(){if(!activeDraft){$('#editor').close();return;}collectDraft();if(!activeDraft.title.trim()&&!C.events.some(e=>e.id===activeDraft.id)){draftDirty=false;activeDraft=null;$('#editor').close();return;}await saveDraft();await persistPromise;activeDraft=null;$('#editor').close();}
let gallery=[],galleryIndex=0;
function viewImage(index){collectDraft();gallery=activeDraft.attachments.filter(a=>a.image);galleryIndex=gallery.findIndex(a=>a===activeDraft.attachments[index]);showImage();$('#image-viewer').showModal();}
function showImage(){const a=gallery[galleryIndex];$('#full-image').src=asset(a);$('#full-image').alt=a.caption||a.name;$('#full-caption').textContent=`${a.caption||a.name} · ${galleryIndex+1} / ${gallery.length}`;}
async function examples(){
  const samples=[{title:'First arrival at the wetland',start:'2024-09-16',place:'Field notebook · example',species:'Migratory shorebirds',text:'An example observation. Replace this with your own field notes.',category:'observation'},{title:'A season of restoration',start:'2024-11',end:'2025-05',category:'conservation',text:'An example period spanning several months. Hover to explore the period lens.'},{title:'The first summer rains',start:'2025-01-12',category:'climate',text:'An example climate event. Add your own rainfall, location, and source fields.'},{title:'Return to the same transect',start:'2025-09-18',species:'Community survey',category:'observation',text:'An example return visit. Pin a species or place filter to compare threads.'},{title:'Habitat monitoring',start:'2025-02',end:'2025-08',category:'conservation',text:'A second example period, with its own category color.'}];
  for(const s of samples){const e={...makeDraft(),...s};e.color=C.settings.categories.find(c=>c.id===e.category)?.color||'#5d7965';e.tags='example';await call('save',e);}
  await load();fit();toast('Example records are tagged “example” and can be edited or deleted.');
}
// Delegation keeps interaction listeners independent of animation and virtualization.
document.addEventListener('click',async event=>{try{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.event){await closePanel();openEditor(C.events.find(e=>e.id===b.dataset.event));return;}
  if(b.dataset.cluster!==undefined){const lane=C.lanes.find(l=>l.id===b.dataset.laneId);const track=b.closest('.track');const groups=visibleGroups(lane.events,C.center,C.scale,track.clientWidth);listEvents('Close in time',groups[Number(b.dataset.cluster)].events);return;}
  if(b.dataset.openListed){$('#panel').close();openEditor(C.events.find(e=>e.id===b.dataset.openListed));return;}
  if(b.dataset.categoryFilter){const id=b.dataset.categoryFilter;C.filter.categories=C.filter.categories.includes(id)?C.filter.categories.filter(c=>c!==id):[...C.filter.categories,id];filterChanged();return;}
  if(b.hasAttribute('data-hide-current')){C.showCurrent=false;rebuild();return;}
  if(b.dataset.unpin){await saveSettings({pins:C.settings.pins.filter(p=>p.id!==b.dataset.unpin)});return;}
  if(b.dataset.fitLane){fit(C.lanes.find(l=>l.id===b.dataset.fitLane).events);return;}
  if(b.hasAttribute('data-remove-field')){b.parentElement.remove();draftChanged();return;}
  if(b.dataset.viewImage!==undefined){viewImage(Number(b.dataset.viewImage));return;}
  if(b.dataset.openAttachment!==undefined){await call('openAttachment',activeDraft.attachments[Number(b.dataset.openAttachment)].id);return;}
  if(b.dataset.removeAttachment!==undefined){collectDraft();activeDraft.attachments.splice(Number(b.dataset.removeAttachment),1);renderAttachments();draftChanged();return;}
  if(b.dataset.moveAttachment!==undefined){collectDraft();const i=Number(b.dataset.moveAttachment);if(i>0)[activeDraft.attachments[i-1],activeDraft.attachments[i]]=[activeDraft.attachments[i],activeDraft.attachments[i-1]];renderAttachments();draftChanged();return;}
  if(b.dataset.deleteCategory){b.closest('.category-edit').remove();return;}
  switch(b.id){
    case 'new-event':case 'empty-add':openEditor();break;
    case 'fit':fit();break;case 'today':moveTo(Date.now(),C.targetScale);break;
    case 'zoom-in':zoom(.65);break;case 'zoom-out':zoom(1.5);break;
    case 'filter-toggle':$('#filters').hidden=!$('#filters').hidden;break;
    case 'clear-filter':C.filter={query:'',categories:[],source:'all',from:'',to:''};$('#search').value='';$('#source-filter').value='all';$('#from-filter').value='';$('#to-filter').value='';filterChanged();break;
    case 'pin-filter':pinFilter();break;
    case 'confirm-pin':{const name=$('#pin-name').value.trim();if(!name){$('#pin-name').focus();return;}await saveSettings({pins:[...C.settings.pins,{id:uid(),name,filter:structuredClone(C.filter)}]});$('#panel').close();toast('Timeline pinned. It will include future matching events.');break;}
    case 'show-current':C.showCurrent=true;rebuild();break;
    case 'undated-button':listEvents('Undated records',C.events.filter(e=>!e.hidden&&parseDate(e.start)===null&&C.lanes.some(l=>l.events.includes(e))));break;
    case 'menu-button':settingsPanel();break;case 'help-button':helpPanel();break;
    case 'library-button':case 'empty-connect':case 'settings-library':libraryPanel();break;
    case 'choose-library':{const data=await call('chooseLibrary');if(data){accept(data);libraryPanel();fit();}break;}
    case 'sync-now':accept(await call('sync'));libraryPanel();break;
    case 'toggle-sync':await saveSettings({sync:!C.settings.sync});accept(await call('sync'));libraryPanel();break;
    case 'manage-categories':case 'settings-categories':categoriesPanel();break;
    case 'add-category':$('#category-editor').insertAdjacentHTML('beforeend',`<div class="category-edit" data-id="${uid()}"><input type="color" value="#7b9270" aria-label="Category color"><input type="text" value="" placeholder="Category name" aria-label="Category name"><button data-delete-category="new" aria-label="Delete category">×</button></div>`);break;
    case 'save-categories':{const categories=[...document.querySelectorAll('.category-edit')].map(row=>({id:row.dataset.id,name:row.querySelector('[type=text]').value.trim(),color:row.querySelector('[type=color]').value})).filter(c=>c.name);if(!categories.length)throw Error('Keep at least one named category.');for(const e of C.events){const old=C.settings.categories.find(c=>c.id===e.category),fresh=categories.find(c=>c.id===e.category);if(old&&fresh&&old.color!==fresh.color){e.color=fresh.color;await call('save',e);}}await saveSettings({categories});$('#panel').close();break;}
    case 'export-backup':await saveDraft();if(await call('export'))toast('Portable backup exported, including attachments.');break;
    case 'import-backup':if(!confirm('Merge this backup into your notebook? Matching event IDs will be updated.'))break;{const data=await call('import');if(data){accept(data);$('#panel').close();fit();toast('Backup merged.');}break;}
    case 'open-folder':await call('openFolder');break;
    case 'restore-papers':for(const e of C.events.filter(e=>e.source&&e.hidden)){e.hidden=false;await call('save',e);}rebuild();toast('Hidden papers restored.');break;
    case 'load-examples':await examples();break;
    case 'close-panel':$('#panel').close();break;
    case 'close-editor':await closeEditor();break;
    case 'delete-event':if(confirm(activeDraft.source?'Hide this paper from Reminiscence? Its Literature Box card is kept.':'Delete this event?')){clearTimeout(draftTimer);await persistPromise;await call('remove',activeDraft.id);C.events=C.events.filter(e=>e.id!==activeDraft.id);activeDraft=null;draftDirty=false;$('#editor').close();await load();}break;
    case 'add-field':collectDraft();$('#extra-fields').insertAdjacentHTML('beforeend','<div class="extra-row"><input class="extra-key" placeholder="Field name" aria-label="Field name"><textarea class="extra-value" placeholder="Anything you want to record" aria-label="Field value"></textarea><button type="button" data-remove-field aria-label="Remove field">×</button></div>');break;
    case 'add-attachment':{const files=await call('attach');if(files.length){collectDraft();activeDraft.attachments.push(...files);renderAttachments();draftChanged();}break;}
    case 'open-paper-link':{const s=activeDraft.source;await call('openLink',s.link||`https://doi.org/${s.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//,'')}`);break;}
    case 'fit-event':{collectDraft();const e=structuredClone(activeDraft);await closeEditor();fit([e]);break;}
    case 'close-image':$('#image-viewer').close();break;
    case 'previous-image':galleryIndex=(galleryIndex-1+gallery.length)%gallery.length;showImage();break;
    case 'next-image':galleryIndex=(galleryIndex+1)%gallery.length;showImage();break;
  }
}catch(error){report(error);}});
async function closePanel(){if($('#panel').open)$('#panel').close();}
$('#search').addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(filterChanged,130);});
for(const id of ['source-filter','from-filter','to-filter'])$('#'+id).addEventListener('change',filterChanged);
$('#event-form').addEventListener('input',draftChanged);
$('#event-category').addEventListener('change',()=>{$('#event-color').value=C.settings.categories.find(c=>c.id===$('#event-category').value)?.color||'#5d7965';draftChanged();});
$('#event-form').addEventListener('submit',async event=>{event.preventDefault();try{collectDraft();draftDirty=true;await closeEditor();}catch(error){$('#editor-error').textContent=error.message;}});
$('#editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor().catch(report);});
document.addEventListener('pointerover',event=>{const node=event.target.closest('[data-event]');if(node)showLens(C.events.find(e=>e.id===node.dataset.event),node);});
document.addEventListener('pointerout',event=>{if(event.target.closest('[data-event]'))hideLens();});
document.addEventListener('keydown',event=>{
  if($('#image-viewer').open){if(event.key==='ArrowRight')$('#next-image').click();if(event.key==='ArrowLeft')$('#previous-image').click();return;}
  if(document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;
  if(event.key==='/'){event.preventDefault();$('#search').focus();}if(event.key.toLowerCase()==='n')openEditor();
});
new ResizeObserver(()=>render()).observe($('#lanes'));
window.field.onUpdate(async message=>{if(message.notice){toast(message.notice);return;}if(message.changed)try{await load();}catch(error){report(error);}});
window.field.onClose(async()=>{if(activeDraft){collectDraft();if(activeDraft.title.trim())await saveDraft();}await persistPromise;});
window.Reminiscence={state:C,load,fit,openEditor,saveDraft,rebuild,render,filterChanged,moveTo,examples};
load(true).then(()=>{C.ready=true;if(!C.settings.view)fit();}).catch(report);
