// main.js — תהליך ה-Main של Archive Reader (שלב 3.3).
// אחראי על כל הגנות הדסקטופ: החרגה מצילום-מסך, חסימת הורדה/הדפסה/העתקה/דפדפן, ומחיקת Cache בסיום.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const API_BASE = process.env.ARCHIVE_API || 'http://localhost:4000';
const PARTITION = 'archive-reader-volatile'; // session לא-מתמיד — לא נכתב לדיסק

// מזהה המכשיר נשמר ב-userData (לא ב-Cache שנמחק), כך שהוא יציב בין הפעלות.
function getDeviceId() {
  const dir = app.getPath('userData');
  const file = path.join(dir, 'device.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).deviceId; } catch { /* create below */ }
  const id = 'reader-' + crypto.randomUUID();
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ deviceId: id })); } catch { /* ignore */ }
  return id;
}

let win;
function createWindow() {
  const ses = session.fromPartition(PARTITION, { cache: false });
  ses.on('will-download', (e) => e.preventDefault());           // חסימת כל הורדה
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // אין הרשאות (מצלמה/מיקום/הורדה...)

  win = new BrowserWindow({
    width: 1120, height: 780, backgroundColor: '#0f172a', title: 'Archive Reader',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      session: ses, devTools: false, spellcheck: false,
    },
  });
  win.removeMenu();
  win.setContentProtection(true); // Windows: WDA_EXCLUDEFROMCAPTURE — החלון לא נתפס בצילום-מסך/הקלטה

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // אין חלונות/טאבים חדשים
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); }); // אין ניווט החוצה

  // חסימת קיצורי מקלדת של שמירה/הדפסה/העתקה/גזירה/הצגת-מקור/כלי-מפתח/PrintScreen
  win.webContents.on('before-input-event', (e, input) => {
    const k = (input.key || '').toLowerCase();
    const mod = input.control || input.meta;
    if (mod && ['s', 'p', 'c', 'x', 'u', 'a'].includes(k)) e.preventDefault();
    if (k === 'f12' || (mod && input.shift && k === 'i')) e.preventDefault();
    if (input.key === 'PrintScreen') e.preventDefault();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('reader:init', () => ({ deviceId: getDeviceId(), apiBase: API_BASE, deviceName: os.hostname() || 'Reader' }));
  createWindow();
});

// מחיקת Cache ואחסון מקומי ביציאה (לא נשאר זכר לתוכן)
app.on('before-quit', async () => {
  try {
    const ses = session.fromPartition(PARTITION);
    await ses.clearCache();
    await ses.clearStorageData();
  } catch { /* ignore */ }
});
app.on('window-all-closed', () => app.quit());
