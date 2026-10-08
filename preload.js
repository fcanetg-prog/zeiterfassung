'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data, opts) => ipcRenderer.invoke('data:save', data, opts),
  importFile: () => ipcRenderer.invoke('data:import'),
  exportFile: (data) => ipcRenderer.invoke('data:export', data),
  exportCsv: (name, text) => ipcRenderer.invoke('data:exportCsv', name, text),
  openFolder: () => ipcRenderer.invoke('data:openFolder'),
  chooseFolder: () => ipcRenderer.invoke('data:chooseFolder'),
  info: () => ipcRenderer.invoke('app:info'),
  invoicePdf: (modell, absender, projekt) => ipcRenderer.invoke('invoice:pdf', modell, absender, projekt),
});
