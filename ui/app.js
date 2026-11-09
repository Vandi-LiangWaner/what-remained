/* Reminiscence — no framework, no network, only the visible landscape is drawn. */
const {DAY,parseDate,eventTimes,plain,indexEvent,matches,validateEvent,visibleGroups,columnWindow,eventPosition}=window.FieldCore;
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
const columnPositions=new Map(),columnModels=new Map(),trackModels=new Map();
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
  rememberColumns();
  const usable=C.events.filter(e=>!e.hidden);
  const definitions=[...(C.showCurrent?[{id:'current',name:'All events',filter:C.filter}]:[]),...C.settings.pins];
  if(!definitions.length){C.showCurrent=true;definitions.push({id:'current',name:'All events',filter:C.filter});}
  C.lanes=definitions.map(lane=>({...lane,events:usable.filter(e=>matches(e,lane.filter,C.index.get(e.id)||'')).sort((a,b)=>(eventTimes(a).a??Infinity)-(eventTimes(b).a??Infinity))}));
  const selected=new Set(C.lanes.flatMap(l=>l.events.map(e=>e.id)));
  const undated=usable.filter(e=>selected.has(e.id)&&parseDate(e.start)===null);
  $('#event-count').textContent=`${selected.size.toLocaleString()} of ${usable.length.toLocaleString()} records`;
  $('#undated-button').hidden=!undated.length;$('#undated-button').textContent=`${undated.length} undated ↗`;
  $('#show-current').hidden=C.showCurrent;
  $('#empty').hidden=usable.length>0;
  $('#timeline-canvas').hidden=usable.length===0;$('#travel').hidden=usable.length===0;
  $('#lanes').style.setProperty('--lane-count',C.lanes.length);
  $('#lanes').innerHTML=C.lanes.map(lane=>`<section class="lane" data-lane="${esc(lane.id)}"><div class="lane-head"><span class="swatch" style="--c:${lane.id==='current'?'#89967d':'#b28c61'}"></span><span class="lane-name">${esc(lane.name)}</span><span class="lane-query">${esc(filterDescription(lane.filter))}</span><span class="lane-count">${lane.events.length.toLocaleString()} records</span>${lane.id==='current'?C.settings.pins.length?'<button data-hide-current title="Hide this lane">Hide</button>':'':`<button data-fit-lane="${esc(lane.id)}">Fit</button><button data-unpin="${esc(lane.id)}" title="Unpin view">×</button>`}</div><div class="track" tabindex="0" role="region" aria-label="${esc(lane.name)} timeline. Arrow keys pan, plus and minus zoom."></div></section>`).join('');
  $('#filter-count').textContent=[C.filter.categories.length,C.filter.source!=='all',!!C.filter.from,!!C.filter.to].reduce((a,b)=>a+Number(b),0)||'';
  for(const node of document.querySelectorAll('.lane')){
    const track=node.querySelector('.track');
    track.addEventListener('pointerdown',panStart);
    track.addEventListener('keydown',navigateKey);
    track.addEventListener('dblclick',event=>{if(event.target.closest('button'))return;const x=event.clientX-track.getBoundingClientRect().left;openEditor(null,C.center+(x-track.clientWidth/2)*C.scale);});
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
  const ease=Math.abs(C.targetCenter-C.center)/C.scale>500?.4:.28;
  C.center+=(C.targetCenter-C.center)*ease;C.scale+=(C.targetScale-C.scale)*.28;
  if(Math.abs(C.center-C.targetCenter)<C.scale*.05&&Math.abs(C.scale-C.targetScale)<C.scale*.0005){C.center=C.targetCenter;C.scale=C.targetScale;frame=0;render();return;}
  render();frame=requestAnimationFrame(animate);
}
function zoom(factor,x){
  const width=$('.track')?.clientWidth||1100;
  const next=Math.max(DAY/800,Math.min(DAY*365.2425*20,C.targetScale*factor));
  moveTo(C.targetCenter+(x===undefined?0:x-width/2)*(C.targetScale-next),next);
}
function wheel(event){
  hideLens();
  let dx=event.deltaX,dy=event.deltaY;
  if(event.deltaMode===1){dx*=24;dy*=24;}if(event.deltaMode===2){dx*=event.currentTarget.clientWidth;dy*=400;}
  const column=event.target.closest('.event-column');
  if(column&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&Math.abs(dy)>=Math.abs(dx)&&column.scrollHeight>column.clientHeight){
    event.preventDefault();column.scrollTop+=dy;return;
  }
  event.preventDefault();
  if(event.ctrlKey||event.metaKey)zoom(Math.exp(dy*.0025),event.clientX-event.currentTarget.getBoundingClientRect().left);
  else {
    const delta=Math.abs(dx)>Math.abs(dy)?dx:dy;
    const speed=Math.max(.5,Math.min(12,Number(C.settings.scrollSpeed)||4));
    const acceleration=Math.max(1,Math.min(2.4,Math.abs(delta)/110));
    moveTo(C.targetCenter+delta*C.targetScale*speed*acceleration*(event.shiftKey?3:1),C.targetScale);
  }
}
function panStart(event){
  if(event.button!==0||event.target.closest('button,.event-column'))return;
  const track=event.currentTarget,startX=event.clientX,center=C.targetCenter;let moved=false;
  track.setPointerCapture(event.pointerId);track.classList.add('dragging');hideLens();
  const move=e=>{if(Math.abs(e.clientX-startX)>3)moved=true;moveTo(center-(e.clientX-startX)*C.targetScale,C.targetScale);};
  const end=()=>{track.classList.remove('dragging');track.removeEventListener('pointermove',move);track.removeEventListener('pointerup',end);track.removeEventListener('pointercancel',end);if(moved)track.dataset.moved='true';};
  track.addEventListener('pointermove',move);track.addEventListener('pointerup',end);track.addEventListener('pointercancel',end);
}
function navigateKey(e){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();moveTo(C.targetCenter+(e.key==='ArrowLeft'?-1:1)*C.scale*(e.shiftKey?900:300),C.targetScale);}if(e.key==='+'||e.key==='=')zoom(.65);if(e.key==='-')zoom(1.5);}
function ticks(left,right,width){
  const span=right-left,target=span/Math.max(2,width/130),result=[];
  if(target<DAY*25){const steps=[1/24,1/4,1,2,7,14,28];const step=(steps.find(d=>d*DAY>=target)||28)*DAY;for(let t=Math.ceil(left/step)*step;t<=right;t+=step)result.push({t,label:fmt(t,target<DAY?{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'})});}
  else if(target<DAY*330){const step=target<DAY*60?1:target<DAY*120?3:6;const d=new Date(left);d.setUTCDate(1);d.setUTCHours(0,0,0,0);d.setUTCMonth(Math.floor(d.getUTCMonth()/step)*step);while(d.getTime()<=right){result.push({t:d.getTime(),label:fmt(d.getTime(),{month:'short',year:'numeric'})});d.setUTCMonth(d.getUTCMonth()+step);}}
  else{const years=target/(DAY*365.2425);const base=10**Math.floor(Math.log10(years));const step=[1,2,5,10].map(x=>x*base).find(x=>x>=years)||base*10;const first=Math.floor(new Date(left).getUTCFullYear()/step)*step;for(let y=Math.max(1,first);y<=Math.min(9999,new Date(right).getUTCFullYear()+step);y+=step){const d=new Date(0);d.setUTCFullYear(y,0,1);d.setUTCHours(0,0,0,0);result.push({t:d.getTime(),label:String(y)});}}
  return result;
}
function rememberColumns(){
  for(const node of document.querySelectorAll('.event-column'))columnPositions.set(node.dataset.columnKey,node.scrollTop);
  if(columnPositions.size>2000){const keep=[...columnPositions.entries()].slice(-1000);columnPositions.clear();keep.forEach(([key,value])=>columnPositions.set(key,value));}
}
function cardMarkup(event,left,top,extra=''){
  const attachment=event.attachments?.find(a=>a.image);
  return `<button class="event-card ${attachment?'has-image':''}" data-event="${esc(event.id)}" title="${esc(event.title)}" style="left:${left}px;top:${top}px;--c:${color(event)}" ${extra}><span class="event-date">${esc(dateLabel(event.start))}${event.end?' — '+esc(dateLabel(event.end)):''}</span><strong>${esc(event.title)}</strong><small>${esc(event.place||event.source?.authors||categoryName(event))}${event.attachments?.length?' · ▧':''}</small>${attachment?`<img src="${asset(attachment)}" alt="">`:''}</button>`;
}
function updateColumn(node){
  const model=columnModels.get(node.dataset.columnKey);if(!model)return;
  const view=columnWindow(model.events.length,node.scrollTop,model.height);
  model.offset=node.scrollTop;model.start=view.start;model.end=view.end;
  if(model.drawnStart===view.start&&model.drawnEnd===view.end)return;
  model.drawnStart=view.start;model.drawnEnd=view.end;
  let rows='';
  for(let i=view.start;i<view.end;i++)rows+=`<div class="event-row" role="listitem" aria-posinset="${i+1}" aria-setsize="${model.events.length}" data-row="${i}" style="top:${i*88}px">${cardMarkup(model.events[i],0,0)}</div>`;
  node.querySelector('.column-spacer').innerHTML=rows;
}
function columnKeydown(event,node){
  const model=columnModels.get(node.dataset.columnKey);if(!model)return;
  const key=event.key;if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(key))return;
  event.preventDefault();event.stopPropagation();
  const current=Number(event.target.closest('[data-row]')?.dataset.row??Math.floor(node.scrollTop/88));
  const page=Math.max(1,Math.floor(node.clientHeight/88));
  const next=key==='Home'?0:key==='End'?model.events.length-1:Math.max(0,Math.min(model.events.length-1,current+(key==='ArrowUp'?-1:key==='ArrowDown'?1:key==='PageUp'?-page:page)));
  if(next*88<node.scrollTop)node.scrollTop=next*88;
  else if(next*88+80>node.scrollTop+node.clientHeight)node.scrollTop=next*88+80-node.clientHeight;
  columnPositions.set(node.dataset.columnKey,node.scrollTop);updateColumn(node);paintConnections(model.track);
  node.querySelector(`[data-row="${next}"] button`)?.focus({preventScroll:true});
}
function paintAnchors(model){
  const canvas=model.track.querySelector('.anchor-layer'),ratio=window.devicePixelRatio||1;
  const pixelWidth=Math.ceil(model.width*ratio),pixelHeight=Math.ceil(model.height*ratio);
  if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;canvas.style.width=model.width+'px';canvas.style.height=model.height+'px';}
  const context=canvas.getContext('2d');context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,model.width,model.height);
  const points=new Map();
  for(const group of model.groups)for(const event of group.events){
    const position=eventPosition(event,C.center,C.scale,model.width);
    if(position.x<0||position.x>model.width)continue;
    const c=color(event);if(!points.has(c))points.set(c,new Set());points.get(c).add(position.x);
  }
  for(const [c,positions] of points){context.fillStyle=c;context.globalAlpha=.65;context.beginPath();for(const x of positions){context.moveTo(x+2.6,model.axis);context.arc(x,model.axis,2.6,0,Math.PI*2);}context.fill();}
}
function paintConnections(track){
  const model=trackModels.get(track);if(!model)return;
  const {width,axis}=model;let svg=`<line class="axis-line" x1="0" x2="${width}" y1="${axis}" y2="${axis}"/>`;
  const connect=(event,path)=>{
    const position=eventPosition(event,C.center,C.scale,width),c=color(event);
    if(event.end&&position.endX>=0&&position.x<=width){
      const x1=Math.max(0,position.x),x2=Math.min(width,position.endX);
      let caps='';for(const x of [position.x,position.endX])if(x>=0&&x<=width)caps+=`M${x},${axis-6}V${axis+6}`;
      svg+=`<g style="--c:${c}"><rect class="period" x="${x1}" y="${axis-6}" width="${Math.max(1,x2-x1)}" height="12" rx="2"/><path class="period-outline" d="${caps}"/></g>`;
    }
    svg+=`<g style="--c:${c}"><path class="connector" d="${path(position.x)}"/><circle class="anchor" data-event-anchor="${esc(event.id)}" cx="${position.x}" cy="${axis}" r="3.5"/></g>`;
  };
  for(const single of model.singles)connect(single.event,x=>`M${x},${axis}V${single.top<axis?single.top+88:single.top}`);
  for(const column of model.columns){
    for(let i=column.start;i<column.end;i++){
      const rowTop=column.top+i*88-column.offset;
      if(rowTop+80<=column.top||rowTop>=column.top+column.height)continue;
      const y=Math.max(column.top+2,Math.min(column.top+column.height-2,rowTop+40));
      const rail=column.left+176+(i%3)*2;
      connect(column.events[i],x=>`M${column.left+162},${y}H${rail}V${axis}H${x}`);
    }
  }
  track.querySelector('.connection-layer').innerHTML=svg;
}
function render(){
  rememberColumns();
  for(const [track,old] of trackModels)if(!track.isConnected){trackModels.delete(track);for(const column of old.columns)columnModels.delete(column.key);}
  const bounds=allBounds();
  C.lanes.forEach(lane=>{
    const track=document.querySelector(`[data-lane="${CSS.escape(lane.id)}"] .track`);if(!track)return;
    const width=track.clientWidth,height=track.clientHeight,axis=height/2;
    const groups=visibleGroups(lane.events,C.center,C.scale,width);
    const previous=trackModels.get(track);
    const reusable=previous&&previous.events===lane.events&&previous.scale===C.scale&&previous.width===width&&previous.height===height&&previous.groups.length===groups.length&&groups.every((g,i)=>{const old=previous.groups[i];return g.events.length===old.events.length&&g.events[0].id===old.events[0].id&&g.events.at(-1).id===old.events.at(-1).id;});
    if(reusable){
      previous.groups=groups;
      previous.layouts.forEach((layout,i)=>{const left=groups[i].x-81;layout.node.style.left=left+'px';if(layout.label)layout.label.style.left=left+'px';if(layout.column)layout.column.left=left;});
      paintAnchors(previous);paintConnections(track);return;
    }
    if(previous)for(const column of previous.columns)columnModels.delete(column.key);
    const model={track,width,height,axis,groups,events:lane.events,scale:C.scale,singles:[],columns:[],layouts:[]};trackModels.set(track,model);
    let content='';
    groups.forEach((g,i)=>{
      // Card columns can reflow on zoom; every date anchor is computed separately.
      const above=Math.abs(g.key)%2===0,left=g.x-81;
      if(g.events.length===1){const top=above?axis-116:axis+30;model.singles.push({event:g.events[0],top});model.layouts.push({id:g.events[0].id});content+=cardMarkup(g.events[0],left,top);return;}
      const top=above?12:axis+28,columnHeight=Math.max(88,above?axis-40:height-top-8);
      const key=lane.id+':'+g.events[0].id;
      const column={key,events:g.events,top,left,height:columnHeight,track,offset:0,start:0,end:0};model.columns.push(column);columnModels.set(key,column);
      model.layouts.push({column});
      content+=`<div class="column-count" style="left:${left}px;top:${Math.max(0,top-13)}px">${g.events.length.toLocaleString()} events</div><div class="event-column" data-column-key="${esc(key)}" role="list" tabindex="0" aria-label="${g.events.length} individual events, in date order. Scroll vertically to browse; Shift-scroll travels through time." style="left:${left}px;top:${top}px;height:${columnHeight}px"><div class="column-spacer" style="height:${g.events.length*88}px"></div></div>`;
    });
    track.innerHTML=`<canvas class="anchor-layer" aria-hidden="true"></canvas><svg class="connection-layer" width="${width}" height="${height}" aria-hidden="true"></svg>${content}${!groups.length?`<div class="lane-empty">${lane.events.some(e=>e.start)?'No events here. Keep travelling, or fit the view.':lane.events.length?'These records have no date yet. Open the undated list.':'No events match this view.'}</div>`:''}`;
    for(const node of track.querySelectorAll('.event-column')){
      const column=columnModels.get(node.dataset.columnKey);
      node.scrollTop=columnPositions.get(column.key)||0;updateColumn(node);
      node.addEventListener('scroll',()=>{if(!node.isConnected)return;columnPositions.set(column.key,node.scrollTop);updateColumn(node);paintConnections(track);},{passive:true});
      node.addEventListener('keydown',event=>columnKeydown(event,node));
    }
    for(const layout of model.layouts){
      if(layout.column){layout.node=track.querySelector(`[data-column-key="${CSS.escape(layout.column.key)}"]`);layout.label=layout.node.previousElementSibling;}
      else layout.node=track.querySelector(`[data-event="${CSS.escape(layout.id)}"]`);
    }
    paintAnchors(model);paintConnections(track);
  });
  const width=$('.track')?.clientWidth||1100;
  const canvasHeight=$('#timeline-canvas').clientHeight;
  const marks=ticks(C.center-width*C.scale/2,C.center+width*C.scale/2,width);
  $('#time-ruler').innerHTML=`<svg width="${width}" height="32">${marks.map(t=>`<text class="tick-text" x="${(t.t-C.center)/C.scale+width/2+5}" y="21">${esc(t.label)}</text>`).join('')}</svg>`;
  $('#canvas-grid').setAttribute('width',width);$('#canvas-grid').setAttribute('height',canvasHeight);
  $('#canvas-grid').innerHTML=marks.map(t=>{const x=(t.t-C.center)/C.scale+width/2;return `<line class="tick-line" x1="${x}" x2="${x}" y1="32" y2="${canvasHeight}"/>`;}).join('');
  const slider=$('#travel-slider');if(bounds&&document.activeElement!==slider)slider.value=bounds[1]===bounds[0]?500:Math.max(0,Math.min(1000,(C.center-bounds[0])/(bounds[1]-bounds[0])*1000));
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
function libraryPanel(){panel('LITERATURE BOX',`<h3>Your reading, in time.</h3><p>${esc(C.syncStatus.message)}</p><div class="settings-row"><p>Read-only sync checks for changes every 20 seconds while What Remained is open. Publication years remain year-level dates. Every field on a paper card is searchable. Your own notes and attachments are kept separately.</p><code>${esc(C.settings.sourcePath||'No library selected')}</code></div><button id="choose-library">Choose library…</button><button id="sync-now">Sync now</button><button id="toggle-sync">${C.settings.sync?'Pause':'Resume'} sync</button><p>Removed source cards are retained with a source-unavailable label. Hidden papers stay hidden. Source images are shown when opening a paper; attachments you add here are saved locally.</p>`);}
function settingsPanel(){panel('YOUR NOTEBOOK',`<h3>Notebook settings</h3><div class="settings-row"><label>Scroll speed <select id="scroll-speed">${[[1,'Gentle'],[2,'Standard'],[4,'Fast'],[8,'Very fast']].map(([value,name])=>`<option value="${value}" ${Number(C.settings.scrollSpeed||4)===value?'selected':''}>${name}</option>`).join('')}</select></label><p>Larger movements accelerate. Hold Shift for a 3× speed boost. Ctrl + scroll zooms.</p></div><div class="settings-row"><button id="export-backup">Export portable backup</button><button id="import-backup">Import & merge backup…</button><p>Portable backups include your events, categories, pinned views, and attached files. Imports merge by event ID; matching IDs are updated. Your automatic database backup is in the Backups folder.</p></div><div class="settings-row"><button id="open-folder">Open notebook folder</button><p><code>${esc(C.root)}</code></p><button id="settings-categories">Categories & colors</button><button id="settings-library">Literature Box connection</button></div><div class="settings-row"><button id="restore-papers">Restore hidden papers</button><p>No accounts, telemetry, or cloud services. Files stay on this computer.</p></div>`);}
function helpPanel(){panel('A SMALL FIELD GUIDE',`<h3>Make room for time.</h3><p><b>Travel.</b> Scroll or drag a timeline. The bottom slider travels across your whole collection. All pinned views move together. Use Ctrl + scroll, the + / − buttons, or the keyboard to zoom.</p><p><b>Record.</b> Add a point in time or give it an end date. Hover a period for its magnified lens. Attach pictures, PDFs, or other files; add captions and any custom fields you need. Double-click empty timeline space to add an event there.</p><p><b>Connect.</b> Search matches words across every field, source metadata, captions, and filenames. Multiple words must all appear. Categories are combined with OR; other filters are combined with AND. Date filters include periods that overlap the chosen range.</p><p><b>Compare.</b> Pin a filter to create a separate timeline; repeat to compare several threads. Each pin remembers the filter. Use the current search view for exploring without changing pins.</p><p><b>Read density.</b> Nearby events stay as individual cards in chronological columns. Scroll a long column vertically to browse every event; hold Shift to travel horizontally. Each event keeps its own exact date point. Year-only events anchor to 1 January.</p><p><b>Keep.</b> Event changes save in the background after a short pause and before you close the app. Export a portable backup to move the notebook, including its files. A database backup is also refreshed after edits.</p><p><b>Shortcuts.</b> / focuses search · N adds an event · arrows pan a focused timeline · + / − zoom · Esc closes dialogs.</p>`);}
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
    case 'delete-event':if(confirm(activeDraft.source?'Hide this paper from What Remained? Its Literature Box card is kept.':'Delete this event?')){clearTimeout(draftTimer);await persistPromise;await call('remove',activeDraft.id);C.events=C.events.filter(e=>e.id!==activeDraft.id);activeDraft=null;draftDirty=false;$('#editor').close();await load();}break;
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
$('#timeline-canvas').addEventListener('wheel',wheel,{passive:false});
$('#time-ruler').addEventListener('pointerdown',panStart);
document.addEventListener('change',event=>{if(event.target.id==='scroll-speed')saveSettings({scrollSpeed:Number(event.target.value)}).then(()=>toast('Scroll speed updated.')).catch(report);});
$('#travel-slider').addEventListener('input',()=>{const bounds=allBounds();if(bounds)moveTo(bounds[0]+Number($('#travel-slider').value)/1000*(bounds[1]-bounds[0]),C.targetScale);});
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
