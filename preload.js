const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  openExternal: url => ipcRenderer.invoke('external:open', url),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  pickFiles: kind => ipcRenderer.invoke('files:pick', kind),
  loadFiles: (kind, selections) => ipcRenderer.invoke('files:load', kind, selections),
  runComparison: threshold => ipcRenderer.invoke('comparison:run', threshold),
  getRows: (name, options) => ipcRenderer.invoke('data:rows', name, options),
  resolveReview: payload => ipcRenderer.invoke('review:resolve', payload),
  savePurchaseReplacement: payload => ipcRenderer.invoke('purchase-replacement:save', payload),
  deletePurchaseReplacement: payload => ipcRenderer.invoke('purchase-replacement:delete', payload),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  deleteDatabase: keyword => ipcRenderer.invoke('database:delete', keyword),
  exportExcel: sheets => ipcRenderer.invoke('export:save', sheets)
});
