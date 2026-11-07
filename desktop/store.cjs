const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {parentPort, workerData} = require('node:worker_threads');
const {validateEvent, paperEvent} = require('../core.cjs');
const root = workerData.root;
fs.mkdirSync(root, {recursive:true}); fs.mkdirSync(path.join(root,'Attachments'),{recursive:true}); fs.mkdirSync(path.join(root,'Backups'),{recursive:true});
const db = new DatabaseSync(path.join(root,'reminiscence.sqlite'));
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000; CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY, body TEXT NOT NULL);");
const defaults = {categories:[{id:'observation',name:'Observation',color:'#5d7965'},{id:'climate',name:'Climate',color:'#b77c54'},{id:'conservation',name:'Conservation',color:'#5b8596'},{id:'papers',name:'Literature',color:'#8b7597'}],pins:[],sync:true,sourcePath:workerData.sourcePath};
let settings = {...defaults,...JSON.parse(db.prepare('SELECT body FROM settings WHERE id=1').get()?.body || '{}')};
let syncStatus = {state:'waiting',message:'Looking for Literature Box…'};
const saveSettings = () => db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify(settings));
const put = event => db.prepare('INSERT OR REPLACE INTO events VALUES(?,?)').run(event.id,JSON.stringify(event));
let backupTimer;
function backup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    try {
      const destination = path.join(root,'Backups','reminiscence-latest.sqlite');
      const temporary = destination + '.tmp';
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      db.exec(`VACUUM INTO '${temporary.replace(/'/g,"''")}'`);
      fs.renameSync(temporary,destination);
    } catch(error) { parentPort.postMessage({notice:'Backup: '+error.message}); }
  },3000);
}
let sourceRevision = null;
function sync() {
  if (!settings.sync) {syncStatus={state:'paused',message:'Literature Box sync paused'}; return;}
  const file = settings.sourcePath;
  if (!file || !fs.existsSync(file)) {syncStatus={state:'missing',message:'Choose your Literature Box database to connect papers'};return;}
  let source;
  try {
    source = new DatabaseSync(file,{readOnly:true}); source.exec('PRAGMA busy_timeout=1000');
    const row = source.prepare('SELECT revision, cards_json FROM app_state WHERE id=1').get();
    if (!row) throw Error('The library is empty.');
    const key = file+':'+row.revision;
    if (sourceRevision === key) {syncStatus.checkedAt=Date.now();return;}
    const state = JSON.parse(row.cards_json);
    if (!Array.isArray(state.cards)) throw Error('Unrecognized Literature Box library.');
    const papers = state.cards.filter(c=> !c.kind || c.kind==='paper');
    const existing = new Map(db.prepare('SELECT id, body FROM events').all().map(r=>[r.id,JSON.parse(r.body)]));
    db.exec('BEGIN');
    try {
      for (const card of papers) {
        const fresh = paperEvent(card,file), old = existing.get(fresh.id);
        // Extract source figures once into managed files; never pass base64 images to the timeline index.
        fresh.paperAttachments=(card.images||[]).flatMap(image=>{
          const match=/^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp);base64,([\s\S]+)$/.exec(image.data||'');
          if(!match)return [];
          const hash=require('node:crypto').createHash('sha256').update(image.data).digest('hex');
          const id='source-'+hash+'.'+match[1];const target=path.join(root,'Attachments',id);
          if(!fs.existsSync(target))fs.writeFileSync(target,Buffer.from(match[2],'base64'));
          return [{id,name:image.name||'Paper figure',image:true,caption:image.caption||'',source:true}];
        });
        delete fresh.sourceImages;
        put(old ? {...fresh,notes:old.notes || '',attachments:old.attachments || [],extraFields:old.extraFields || {},category:old.category,color:old.color,hidden:old.hidden || false} : fresh);
      }
      const ids = new Set(papers.map(c=>`paper:${c.id}`));
      for (const old of existing.values()) if (old.source && !ids.has(old.id)) put({...old,sourceMissing:true});
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
    sourceRevision=key;
    syncStatus={state:'connected',message:`${papers.length} papers connected`,count:papers.length,checkedAt:Date.now()};
    backup(); parentPort.postMessage({changed:true});
  } catch(error) {syncStatus={state:'error',message:'Sync: '+error.message};}
  finally {source?.close();}
}
const methods = {
  load() {return {events:db.prepare('SELECT body FROM events').all().map(r=>JSON.parse(r.body)),settings,syncStatus,root};},
  save(event) {
    validateEvent(event);
    const row=db.prepare('SELECT body FROM events WHERE id=?').get(event.id);
    const current=row?JSON.parse(row.body):null;
    // A paper can change in LitBox while its annotation editor is open.
    // Only apply the locally editable fields from that editor's snapshot.
    if(current?.source)event={...current,notes:event.notes,extraFields:event.extraFields,attachments:event.attachments,category:event.category,color:event.color,hidden:event.hidden||false};
    put(event);backup();return event;
  },
  remove(id) {const row=db.prepare('SELECT body FROM events WHERE id=?').get(id);if(row && JSON.parse(row.body).source) {put({...JSON.parse(row.body),hidden:true});} else db.prepare('DELETE FROM events WHERE id=?').run(id);backup();return true;},
  settings(value) {settings={...settings,...value};saveSettings();backup();return settings;},
  sync() {sourceRevision=null;sync();return methods.load();},
  import(data) {
    if (data?.format !== 'reminiscence' || data.version !== 1 || !Array.isArray(data.events)) throw Error('This is not a Reminiscence backup.');
    data.events.forEach(validateEvent);
    db.exec('BEGIN');try {for(const event of data.events) put(event); db.exec('COMMIT');} catch(e){db.exec('ROLLBACK');throw e;}
    if(data.settings) {settings={...settings,categories:data.settings.categories || settings.categories,pins:data.settings.pins || settings.pins};saveSettings();}
    sourceRevision=null;backup();return methods.load();
  },
  export() {return {format:'reminiscence',version:1,exportedAt:new Date().toISOString(),events:methods.load().events,settings};},
};
parentPort.on('message',({id,method,payload})=>{try {if(!methods[method])throw Error('Unknown operation');parentPort.postMessage({id,result:methods[method](payload)});}catch(error){parentPort.postMessage({id,error:error.message});}});
sync();setInterval(sync,20000);
