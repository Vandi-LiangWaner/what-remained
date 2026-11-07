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
// Assign nearby anchors to bins before layout: at most one card per 170px cell.
// Every event remains accessible through its cluster, even at continental time scales.
function visibleGroups(events, center, scale, width) {
  const buckets = new Map();
  for (const event of events) {
    const {a:start,b:finish}=eventTimes(event); if (start === null) continue;
    const end = finish ?? start;
    const x = (start - center) / scale + width / 2;
    const right = (end - center) / scale + width / 2;
    if (right < -220 || x > width + 220) continue;
    const anchor = Math.max(95, Math.min(width - 95, x));
    const key = Math.floor(anchor / 180);
    if (!buckets.has(key)) buckets.set(key, {x: anchor, startX: x, endX: right, events: []});
    buckets.get(key).events.push(event);
  }
  return [...buckets.values()].sort((a,b) => a.x - b.x);
}
const api = {DAY, parseDate, eventTimes, plain, indexEvent, matches, validateEvent, paperEvent, visibleGroups};
if (typeof module !== 'undefined') module.exports = api;
else window.FieldCore = api;
})();
