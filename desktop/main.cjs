const {app,BrowserWindow,ipcMain,dialog,shell,protocol,net} = require('electron');
const {Worker} = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');
app.setName('Reminiscence');
protocol.registerSchemesAsPrivileged([{scheme:'field-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const testMode = process.argv.includes('--smoke');
const dataArg = process.argv.find(a=>a.startsWith('--data-dir='));
let root,worker,win,sequence=0,closing=false,finishedClose=false;
const pending=new Map();
function request(method,payload) {return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,method,payload});});}
function assetPath(id) {
  if(typeof id!=='string' || !/^[a-zA-Z0-9_.-]+$/.test(id)) throw Error('Invalid attachment');
  return path.join(root,'Attachments',id);
}
function safeLink(url) {try{return ['https:','http:','mailto:'].includes(new URL(url).protocol);}catch{return false;}}
app.whenReady().then(async()=>{
  root=dataArg ? path.resolve(dataArg.slice(11)) : path.join(app.getPath('documents'),'Reminiscence');
  const sourcePath=testMode?null:path.join(app.getPath('documents'),'Literature Box Library','literature-box.sqlite');
  worker=new Worker(path.join(__dirname,'store.cjs'),{workerData:{root,sourcePath}});
  worker.on('message',message=>{
    if(message.changed) {win?.webContents.send('field:update',{changed:true});return;}
    if(message.notice) {win?.webContents.send('field:update',{notice:message.notice});return;}
    const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);
    message.error ? entry.reject(Error(message.error)) : entry.resolve(message.result);
  });
  worker.on('error',error=>{for(const p of pending.values())p.reject(error);pending.clear();dialog.showErrorBox('Reminiscence',error.message);});
  protocol.handle('field-asset',request=>{try{return net.fetch(pathToFileURL(assetPath(decodeURIComponent(new URL(request.url).pathname.slice(1)))).href);}catch{return new Response('Not found',{status:404});}});
  ipcMain.handle('field:call',async(event,method,payload)=>{
    if(event.sender!==win.webContents)throw Error('Unknown window');
    if(['load','save','remove','settings','sync'].includes(method))return request(method,payload);
    if(method==='attach') {
      const result=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections']});if(result.canceled)return [];
      return Promise.all(result.filePaths.map(async file=>{
        const stat=await fs.stat(file);if(stat.size>100*1024*1024)throw Error('Choose files smaller than 100 MB each.');
        const name=path.basename(file),ext=path.extname(file).replace(/[^.\w]/g,'').slice(0,12),id=randomUUID()+ext;
        await fs.copyFile(file,assetPath(id));
        return {id,name,size:stat.size,image:/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name),caption:''};
      }));
    }
    if(method==='openAttachment') {const error=await shell.openPath(assetPath(payload));if(error)throw Error(error);return true;}
    if(method==='openLink') {if(!safeLink(payload))throw Error('Use an http, https, or mailto link.');await shell.openExternal(payload);return true;}
    if(method==='openFolder') {await shell.openPath(root);return true;}
    if(method==='chooseLibrary') {
      const result=await dialog.showOpenDialog(win,{title:'Connect Literature Box',properties:['openFile'],filters:[{name:'Literature Box database',extensions:['sqlite','db']}]});
      if(result.canceled)return null;
      await request('settings',{sourcePath:result.filePaths[0],sync:true});return request('sync');
    }
    if(method==='export') {
      const result=await dialog.showSaveDialog(win,{defaultPath:'Reminiscence.backup.json',filters:[{name:'Portable backup',extensions:['json']}]});if(result.canceled)return false;
      const data=await request('export');data.files={};
      for(const event of data.events)for(const a of [...(event.attachments||[]),...(event.paperAttachments||[])]) if(!data.files[a.id]) data.files[a.id]=(await fs.readFile(assetPath(a.id))).toString('base64');
      await fs.writeFile(result.filePath,JSON.stringify(data));return true;
    }
    if(method==='import') {
      const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Reminiscence backup',extensions:['json']}]});if(result.canceled)return null;
      const data=JSON.parse(await fs.readFile(result.filePaths[0],'utf8'));
      if(data.format!=='reminiscence'||data.version!==1||!Array.isArray(data.events))throw Error('This is not a Reminiscence backup.');
      const {validateEvent}=require('../core.cjs');data.events.forEach(validateEvent);
      // Never overwrite existing attachment files during a merge. Remap identifiers instead.
      const remap=new Map();
      for(const [id,body] of Object.entries(data.files||{})) {
        assetPath(id);if(typeof body!=='string')throw Error('Invalid backup attachment');
        const fresh=randomUUID()+path.extname(id);await fs.writeFile(assetPath(fresh),Buffer.from(body,'base64'));remap.set(id,fresh);
      }
      for(const e of data.events)for(const a of [...(e.attachments||[]),...(e.paperAttachments||[])])if(remap.has(a.id))a.id=remap.get(a.id);
      return request('import',data);
    }
    throw Error('Unsupported action');
  });
  win=new BrowserWindow({width:1500,height:960,minWidth:960,minHeight:640,title:'Reminiscence',backgroundColor:'#f7f5ef',show:!testMode,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!testMode,offscreen:testMode}});
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({url})=>{if(safeLink(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(url!==win.webContents.getURL()){event.preventDefault();if(safeLink(url))shell.openExternal(url);}});
  await win.loadFile(path.join(__dirname,'../ui/index.html'));
  win.on('close',event=>{if(finishedClose)return;event.preventDefault();if(closing)return;closing=true;win.webContents.send('field:close');});
  ipcMain.on('field:closed',(_,ok)=>{closing=false;if(ok){finishedClose=true;win.close();}else dialog.showErrorBox('Changes are still open','Saving failed. Retry saving before closing.');});
  if(testMode) {
    try {await require('../tests/electron-smoke.cjs')({win,request,root});finishedClose=true;app.exit(0);}
    catch(error){console.error(error);finishedClose=true;app.exit(1);}
  }
});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>worker?.terminate());
