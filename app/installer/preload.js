const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zincInstaller', {
  getLocale: () => ipcRenderer.invoke('app:get-locale'),
  getState: () => ipcRenderer.invoke('installer:get-state'),
  run: (operation, options) => ipcRenderer.invoke('installer:run', operation, options),
  launch: () => ipcRenderer.invoke('zinc:launch'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
})
