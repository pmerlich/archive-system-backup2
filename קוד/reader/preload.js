// preload.js — גשר מצומצם ובטוח בין ה-Main לבין הממשק (ללא חשיפת Node לעמוד).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reader', {
  init: () => ipcRenderer.invoke('reader:init'),
});
