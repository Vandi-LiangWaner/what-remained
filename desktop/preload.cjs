const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('field', {
  call: (method, payload) => ipcRenderer.invoke('field:call', method, payload),
  onUpdate: callback => {ipcRenderer.on('field:update', (_, data) => callback(data));},
  onClose: callback => {ipcRenderer.on('field:close', async () => {try {await callback(); ipcRenderer.send('field:closed', true);} catch {ipcRenderer.send('field:closed', false);}});},
});
