const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseDate,validateEvent,matches,indexEvent,paperEvent,visibleGroups,DAY}=require('../core.cjs');
test('partial dates and impossible dates preserve calendar meaning',()=>{
  assert.equal(parseDate('2024'),Date.UTC(2024,0,1));assert.equal(parseDate('2024-02-29'),Date.UTC(2024,1,29));
  for(const invalid of ['2023-02-29','2024-13','2024-04-31','yesterday',''])assert.equal(parseDate(invalid),null);
  assert.equal(new Date(parseDate('0042')).getUTCFullYear(),42);
});
test('period validation rejects inverted dates but accepts undated source papers',()=>{
  assert.throws(()=>validateEvent({id:'a',title:'A',start:'2024',end:'2023'}));
  assert.doesNotThrow(()=>validateEvent({id:'a',title:'A',start:'',source:{id:1}}));
});
test('search spans source metadata, custom fields, categories, filenames, and captions',()=>{
  const e={id:'a',title:'A wetland',start:'2023',end:'2025',category:'c',extraFields:{rainfall:'120 mm'},attachments:[{name:'survey.pdf',caption:'shorebirds'}],source:{authors:'García'}};
  const index=indexEvent(e,[{id:'c',name:'Restoration'}]);
  assert.ok(matches(e,{query:'garcia shorebirds restoration rainfall survey'},index));
  assert.ok(matches(e,{from:'2024',to:'2024-12',categories:['c'],source:'papers'},index));
  assert.equal(matches(e,{query:'absent'},index),false);assert.equal(matches(e,{from:'2026'},index),false);
});
test('paper year precision and source fields are retained without inventing dates',()=>{
  const e=paperEvent({id:42,title:'Birds',year:'1998',notes:'<p>Migration</p>',methods:'Transects'},'library.sqlite');assert.equal(e.start,'1998');assert.equal(e.fields.methods,'Transects');assert.equal(e.text,'Migration');
  assert.equal(paperEvent({id:3,year:'in press'},'a').start,'');
});
test('20,000 events render in bounded clusters without losing visible members',()=>{
  const events=Array.from({length:20000},(_,i)=>({id:String(i),start:'2000-01-01',end:i%2?'2025-01-01':''}));
  const start=performance.now(),groups=visibleGroups(events,parseDate('2010'),DAY*30,1200);
  assert.ok(groups.length<=8);assert.equal(groups.flatMap(g=>g.events).length,20000);
  console.log('20,000-event culling:',(performance.now()-start).toFixed(1),'ms');
});
