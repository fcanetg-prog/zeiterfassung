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
  invoicePush: (jobs, absender, ziel, erzwingen) => ipcRenderer.invoke('invoice:push', jobs, absender, ziel, erzwingen),
  invoicePdf: (modell, absender) => ipcRenderer.invoke('invoice:pdf', modell, absender),
  openText: (titel, endungen) => ipcRenderer.invoke('file:openText', titel, endungen),
  savePdf: (html, opts) => ipcRenderer.invoke('pdf:save', html, opts),
  onChanged: (fn) => ipcRenderer.on('data:changed', () => fn()),
});
