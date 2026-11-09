(function(){
const DAY = 86400000;
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}(-\d{2})?(-\d{2})?$/.test(value)) return null;
  const parts = value.split('-').map(Number);
  const y = parts[0], m = parts[1] || 1, d = parts[2] || 1;
  const date = new Date(0); date.setUTCFullYear(y, m - 1, d); date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.getTime() : null;
}
function plain(value) { return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
const dateCache=new WeakMap();
function eventTimes(event){
  let entry=dateCache.get(event);
  if(!entry||entry.start!==event.start||entry.end!==event.end){entry={start:event.start,end:event.end,a:parseDate(event.start),b:parseDate(event.end||event.start)};dateCache.set(event,entry);}
  return entry;
}
function indexEvent(event, categories = []) {
  return plain(JSON.stringify({...event, categoryName: categories.find(c => c.id === event.category)?.name})).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function matches(event, filter, index) {
  if (filter.categories?.length && !filter.categories.includes(event.category)) return false;
  if (filter.source && filter.source !== 'all' && (filter.source === 'papers') !== !!event.source) return false;
  if (filter.from && (parseDate(event.end || event.start) ?? -Infinity) < parseDate(filter.from)) return false;
  if (filter.to && (parseDate(event.start) ?? Infinity) > parseDate(filter.to)) return false;
  return String(filter.query || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/\s+/).filter(Boolean).every(term => index.includes(term));
}
function validateEvent(event) {
  if (!event || typeof event.id !== 'string' || !event.id || !String(event.title || '').trim()) throw Error('Give this event a title.');
  if (!event.source && parseDate(event.start) === null) throw Error('Enter a valid date: YYYY, YYYY-MM or YYYY-MM-DD.');
  if (event.start && parseDate(event.start) === null) throw Error('The start date is invalid.');
  if (event.end && (parseDate(event.end) === null || parseDate(event.end) < parseDate(event.start))) throw Error('The end date must be on or after the start date.');
  if (!/^#[\da-f]{6}$/i.test(event.color || '#587566')) throw Error('Choose a valid color.');
  return event;
}
function paperEvent(card, sourcePath) {
  const year = String(card.year || '').trim();
  const start = parseDate(year) !== null ? year : '';
  const fields = Object.fromEntries(Object.entries(card).filter(([key]) => !['id','images'].includes(key)).map(([key,v]) => [key, typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')]));
  return {id: `paper:${card.id}`, title: card.title || 'Untitled paper', start, end: '', category: 'papers', color: '#8b7597',
    text: plain(card.findings || card.notes || ''), notes: '', place: '', species: '', tags: [...new Set([...(card.topics || []), ...(card.keywords || []), ...(card.projects || [])])].join(', '),
    fields, attachments: [], sourceImages: card.images || [], source: {id: card.id, path: sourcePath, authors: card.authors || '', journal: card.journal || '', doi: card.doi || '', link: card.link || '', year}};
}
// Nearby dates share a column; its members remain individual events.
// Dates stay chronological even when a library/import is not stored in date order.
function visibleGroups(events, center, scale, width) {
  const buckets = new Map();
  for (const event of events) {
    const {a:start,b:finish}=eventTimes(event); if (start === null) continue;
    const end = finish ?? start;
    const x = (start - center) / scale + width / 2;
    const right = (end - center) / scale + width / 2;
    if (right < -220 || x > width + 220) continue;
    // Time-based bins do not change membership just because the viewport pans.
    // Never clamp a real date to a viewport edge.
    const key = Math.floor(start / (scale*180));
    if (!buckets.has(key)) buckets.set(key, {key, x, startX: x, endX: right, events: [], ordered:true, latest:-Infinity});
    const bucket=buckets.get(key);
    if(start<bucket.latest)bucket.ordered=false;
    bucket.latest=start;
    buckets.get(key).events.push(event);
  }
  const groups=[...buckets.values()].sort((a,b) => a.x - b.x);
  for(const group of groups){
    if(!group.ordered)group.events.sort((a,b)=>eventTimes(a).a-eventTimes(b).a);
    const {a,b}=eventTimes(group.events[0]);
    group.x=group.startX=(a-center)/scale+width/2;
    group.endX=((b??a)-center)/scale+width/2;
  }
  groups.sort((a,b)=>a.x-b.x);
  return groups;
}
// Bound the DOM work, not the event list: every row can be reached by scrolling.
function columnWindow(count, scrollTop, height, pitch=88, overscan=2){
  const offset=Math.max(0,Math.min(Math.max(0,count*pitch-height),scrollTop));
  return {offset,start:Math.max(0,Math.floor(offset/pitch)-overscan),end:Math.min(count,Math.ceil((offset+height)/pitch)+overscan),totalHeight:count*pitch};
}
function eventPosition(event,center,scale,width){
  const {a,b}=eventTimes(event);
  if(a===null)return null;
  return {x:(a-center)/scale+width/2,endX:((b??a)-center)/scale+width/2};
}
function createRowLayout(events,heightForEvent){
  const heights=new Float64Array(events.length),offsets=new Float64Array(events.length+1);
  events.forEach((event,i)=>{heights[i]=Math.max(1,heightForEvent(event));offsets[i+1]=offsets[i]+heights[i];});
  return {heights,offsets};
}
function rowAt(layout,position){
  let lo=0,hi=layout.heights.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(layout.offsets[mid+1]<=position)lo=mid+1;else hi=mid;}
  return Math.max(0,Math.min(layout.heights.length-1,lo));
}
function rowWindow(layout,scrollTop,height,overscan=2){
  const count=layout.heights.length,totalHeight=layout.offsets[count];
  const offset=Math.max(0,Math.min(Math.max(0,totalHeight-height),scrollTop));
  return {offset,start:count?Math.max(0,rowAt(layout,offset)-overscan):0,end:count?Math.min(count,rowAt(layout,offset+height)+1+overscan):0,totalHeight};
}
function updateRowHeights(layout,changes){
  let first=layout.heights.length;
  for(const [index,height] of changes)if(layout.heights[index]!==height){layout.heights[index]=height;first=Math.min(first,index);}
  for(let i=first;i<layout.heights.length;i++)layout.offsets[i+1]=layout.offsets[i]+layout.heights[i];
  return first<layout.heights.length;
}
const api = {DAY, parseDate, eventTimes, plain, indexEvent, matches, validateEvent, paperEvent, visibleGroups, columnWindow, eventPosition,createRowLayout,rowAt,rowWindow,updateRowHeights};
if (typeof module !== 'undefined') module.exports = api;
else window.FieldCore = api;
})();
