const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {Worker}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
test('real SQLite sync is read-only, incremental, durable, and preserves annotations',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reminiscence-test-')),sourcePath=path.join(dir,'source.sqlite'),root=path.join(dir,'notebook');
  const source=new DatabaseSync(sourcePath);source.exec('CREATE TABLE app_state(id INTEGER PRIMARY KEY, cards_json TEXT, revision INTEGER)');
  const write=(cards,rev)=>source.prepare('INSERT OR REPLACE INTO app_state VALUES(1,?,?)').run(JSON.stringify({cards}),rev);
  write([{id:1,title:'Original',year:'2001',notes:'First'},{id:2,title:'Undated',year:'in press'},{id:3,kind:'author',title:'Author'}],1);
  const worker=new Worker(path.join(__dirname,'../desktop/store.cjs'),{workerData:{root,sourcePath}});let seq=0;const waiting=new Map();
  worker.on('message',m=>{if(!m.id)return;const p=waiting.get(m.id);if(!p)return;waiting.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
  const request=(method,payload)=>new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});worker.postMessage({id,method,payload});});
  try{
    let state=await request('load');assert.equal(state.events.length,2);assert.equal(state.events.find(e=>e.id==='paper:2').start,'');
    const paper=state.events.find(e=>e.id==='paper:1');paper.notes='My annotation';paper.extraFields={ecology:'wetlands'};await request('save',paper);
    write([{id:1,title:'Changed in LitBox',year:'2002',notes:'New source'}],2);state=await request('sync');
    const updated=state.events.find(e=>e.id==='paper:1');assert.equal(updated.title,'Changed in LitBox');assert.equal(updated.notes,'My annotation');assert.equal(updated.extraFields.ecology,'wetlands');assert.equal(updated.start,'2002');
    paper.notes='Annotation from an older open editor';const staleSave=await request('save',paper);assert.equal(staleSave.title,'Changed in LitBox');assert.equal(staleSave.start,'2002');assert.equal(staleSave.notes,'Annotation from an older open editor');
    assert.ok(state.events.find(e=>e.id==='paper:2').sourceMissing);assert.equal(source.prepare('SELECT revision FROM app_state').get().revision,2);
    await request('remove','paper:1');state=await request('sync');assert.ok(state.events.find(e=>e.id==='paper:1').hidden);
    await assert.rejects(request('import',{format:'invalid',events:[]}));
    const backup=await request('export');assert.equal(backup.format,'reminiscence');
    assert.ok(fs.existsSync(path.join(root,'reminiscence.sqlite')));
  }finally{await worker.terminate();source.close();fs.rmSync(dir,{recursive:true,force:true});}
});
