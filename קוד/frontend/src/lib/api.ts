// api.ts — לקוח API מרכזי + ניהול התחברות (טוקן). כל קריאה לשרת עוברת דרך כאן.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'archive_token';

export type Health = { status: string; database: string; time: string };
export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
  roleKey?: string | null;
  isOwner?: boolean;
  permissions?: string[];
  twoFactorEnabled?: boolean;
};

// משתמש כפי שמופיע במסך ניהול המשתמשים.
export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleKey: string | null;
  isOwner: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
};

// תפקיד זמין לבחירה.
export type RoleInfo = {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  permissions: string[];
  isOwner: boolean;
};

// בדיקה אם למשתמש המחובר יש הרשאה מסוימת (בעלים — תמיד כן).
export function hasPermission(user: AuthUser | null, perm: string): boolean {
  if (!user) return false;
  if (user.isOwner) return true;
  return (user.permissions ?? []).includes(perm);
}

// טקסט הנחיה למשתמש — חייב להישאר תואם למדיניות בשרת (password.policy.ts).
export const PASSWORD_HINT = 'לפחות 10 תווים, וכוללת אות גדולה, אות קטנה, ספרה ותו מיוחד (כמו ‎!@#‎).';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}
export function logout(): void {
  clearToken();
}

// עוטף fetch: מוסיף את הטוקן, ומחלץ הודעות שגיאה ברורות מהשרת.
async function api(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = data?.message;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : msg || `שגיאה (${res.status})`);
  }
  return data;
}

export async function getHealth(): Promise<Health> {
  return api('/health');
}

export async function register(email: string, name: string, password: string): Promise<AuthUser> {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, name, password }) });
  setToken(r.accessToken);
  return r.user as AuthUser;
}

export type LoginResult =
  | { twoFactorRequired: true; email: string }
  | { twoFactorRequired: false; user: AuthUser };

export async function login(email: string, password: string): Promise<LoginResult> {
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r?.twoFactorRequired) return { twoFactorRequired: true, email };
  setToken(r.accessToken);
  return { twoFactorRequired: false, user: r.user as AuthUser };
}

// שלב שני: אימות הקוד שנשלח למייל.
export async function verifyLoginOtp(email: string, code: string): Promise<AuthUser> {
  const r = await api('/auth/2fa/login-verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  setToken(r.accessToken);
  return r.user as AuthUser;
}

export async function enable2fa(): Promise<void> {
  await api('/auth/2fa/enable', { method: 'POST' });
}
export async function confirm2fa(code: string): Promise<void> {
  await api('/auth/2fa/confirm', { method: 'POST', body: JSON.stringify({ code }) });
}
export async function disable2fa(password: string): Promise<void> {
  await api('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function getMe(): Promise<AuthUser> {
  return api('/auth/me');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const r = await api('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (r?.accessToken) setToken(r.accessToken);
}

// ───────── ניהול משתמשים והרשאות (דורש הרשאת "ניהול משתמשים") ─────────

export async function listUsers(): Promise<ManagedUser[]> {
  return api('/users');
}

export async function listRoles(): Promise<{ roles: RoleInfo[]; labels: Record<string, string> }> {
  return api('/users/roles');
}

export async function setUserRole(userId: string, roleKey: string): Promise<ManagedUser> {
  return api(`/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ roleKey }) });
}

// ───────── תיקיות ─────────

// תיקייה בעץ (כולל תת-תיקיות מקוננות).
export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  children: FolderNode[];
};

export type DeletedFolder = { id: string; name: string; parentId: string | null; deletedAt: string };

export async function listFolders(): Promise<FolderNode[]> {
  return api('/folders');
}
export async function createFolder(name: string, parentId: string | null): Promise<FolderNode> {
  return api('/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) });
}
// שינוי שם ו/או העברה: שולחים name ו/או parentId (null = העברה לשורש).
export async function updateFolder(id: string, data: { name?: string; parentId?: string | null }): Promise<FolderNode> {
  return api(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}
export async function deleteFolder(id: string): Promise<void> {
  await api(`/folders/${id}`, { method: 'DELETE' });
}
export async function listFolderTrash(): Promise<DeletedFolder[]> {
  return api('/folders/trash');
}
export async function restoreFolder(id: string): Promise<FolderNode> {
  return api(`/folders/${id}/restore`, { method: 'POST' });
}

// ───────── תגיות ─────────

export type Tag = { id: string; name: string; path?: string; parentId: string | null; type: string; sensitivity: string; usage?: number };
// תגית בעץ (כולל תת-תגיות מקוננות).
export type TagNode = {
  id: string; name: string; parentId: string | null; type: string; sensitivity: string; usage: number; children: TagNode[];
};
export type TagOption = { key: string; label: string };
export type TagMeta = { types: TagOption[]; sensitivities: TagOption[] };

export async function listTags(): Promise<Tag[]> {
  return api('/tags');
}
export async function listTagsTree(): Promise<TagNode[]> {
  return api('/tags/tree');
}
export async function getTagMeta(): Promise<TagMeta> {
  return api('/tags/meta');
}
export async function createTag(data: { name: string; type?: string; sensitivity?: string; parentId?: string | null }): Promise<Tag> {
  return api('/tags', { method: 'POST', body: JSON.stringify(data) });
}
// שינוי שם/סוג/רגישות ו/או העברה (parentId; null = לשורש).
export async function updateTag(id: string, data: { name?: string; type?: string; sensitivity?: string; parentId?: string | null }): Promise<Tag> {
  return api(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}
export async function deleteTag(id: string): Promise<void> {
  await api(`/tags/${id}`, { method: 'DELETE' });
}

// ───────── קבצים ─────────

export type ArchiveFile = {
  id: string;
  name: string;
  hash: string;
  sizeBytes: number;
  mimeType: string | null;
  folderId: string | null;
  folderName: string | null;
  tags: { id: string; name: string; path: string; sensitivity: string }[];
  createdAt: string;
  uploadedById?: string | null; // מי העלה/ייבא
  source?: string; // upload | import
  backedUp?: boolean; // האם קיים גיבוי פיזי
  duplicate?: boolean;
  duplicateOf?: string | null; // שם הקובץ הקיים בעל תוכן זהה (אם זוהתה כפילות בהעלאה)
};

// קבוצת כפילות מלאה — קבצים שונים עם תוכן זהה.
export type DuplicateGroup = { hash: string; count: number; sizeBytes: number; files: ArchiveFile[] };

// שדות מיון אפשריים לקבצים (שלב 2.1).
export type FileSort = 'createdAt' | 'name' | 'sizeBytes';

// פרמטרים לחיפוש/סינון/מיון/עימוד.
export type FileQuery = {
  q?: string; // חיפוש בשם (התאמה חלקית, לא תלוי אותיות גדולות/קטנות)
  folderId?: string;
  tagId?: string;
  withSub?: boolean;
  untagged?: boolean; // רק קבצים ללא תגית
  tagIds?: string[]; // לפחות אחת מאלה
  excludeTagIds?: string[]; // להחריג קבצים עם אחת מאלה
  mimeTypes?: string[]; // סוגים (לפחות אחד)
  ext?: string; // סיומת (למשל pdf)
  sizeMin?: number; // בייטים
  sizeMax?: number; // בייטים
  createdFrom?: string; // תאריך (YYYY-MM-DD) או זמן מלא
  createdTo?: string;
  uploadedById?: string;
  source?: 'upload' | 'import';
  duplicate?: 'only' | 'unique';
  backedUp?: boolean;
  sort?: FileSort;
  order?: 'asc' | 'desc';
  page?: number; // מ-1
  pageSize?: number;
};

// תוצאת רשימה ממוענת (טעינה במנות): פריטי העמוד + כמה יש בסך הכול.
export type FileListResult = {
  items: ArchiveFile[];
  total: number; // כמה תוצאות תואמות בסך הכול
  page: number;
  pageSize: number;
  pages: number; // מספר העמודים הכולל
};

// חיפוש/סינון/מיון/עימוד של קבצים. מחזיר עמוד אחד + total.
export async function listFiles(opts: FileQuery = {}): Promise<FileListResult> {
  const p = new URLSearchParams();
  if (opts.q && opts.q.trim()) p.set('q', opts.q.trim());
  if (opts.folderId) p.set('folderId', opts.folderId);
  if (opts.tagId) p.set('tagId', opts.tagId);
  if (opts.withSub) p.set('withSub', 'true');
  if (opts.untagged) p.set('untagged', 'true');
  if (opts.tagIds && opts.tagIds.length) p.set('tagIds', opts.tagIds.join(','));
  if (opts.excludeTagIds && opts.excludeTagIds.length) p.set('excludeTagIds', opts.excludeTagIds.join(','));
  if (opts.mimeTypes && opts.mimeTypes.length) p.set('mimeTypes', opts.mimeTypes.join(','));
  if (opts.ext && opts.ext.trim()) p.set('ext', opts.ext.trim());
  if (opts.sizeMin != null) p.set('sizeMin', String(opts.sizeMin));
  if (opts.sizeMax != null) p.set('sizeMax', String(opts.sizeMax));
  if (opts.createdFrom) p.set('createdFrom', opts.createdFrom);
  if (opts.createdTo) p.set('createdTo', opts.createdTo);
  if (opts.uploadedById) p.set('uploadedById', opts.uploadedById);
  if (opts.source) p.set('source', opts.source);
  if (opts.duplicate) p.set('duplicate', opts.duplicate);
  if (typeof opts.backedUp === 'boolean') p.set('backedUp', opts.backedUp ? 'true' : 'false');
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.order) p.set('order', opts.order);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api('/files' + (qs ? `?${qs}` : ''));
}

// סוגי הקבצים (mime) הקיימים במאגר — לתפריט הסינון "סוג".
export async function listFileTypes(): Promise<string[]> {
  return api('/files/types');
}
// מי שהעלה/ייבא קבצים — לתפריט הסינון "מי שהעלה".
export async function listUploaders(): Promise<{ id: string; name: string }[]> {
  return api('/files/uploaders');
}

// ───────── אוספים חכמים (שלב 2.3) ─────────
// אוסף = שם + תנאי סינון (FileQuery) השמורים בלבד (לא קבצים) — לכן מתעדכן אוטומטית.
export type SmartCollection = {
  id: string;
  name: string;
  filters: FileQuery;
  createdById: string | null;
  createdByName?: string | null;
  createdAt: string;
};
export async function listCollections(): Promise<SmartCollection[]> {
  return api('/collections');
}
export async function createCollection(name: string, filters: FileQuery): Promise<SmartCollection> {
  return api('/collections', { method: 'POST', body: JSON.stringify({ name, filters }) });
}
export async function updateCollection(id: string, data: { name?: string; filters?: FileQuery }): Promise<SmartCollection> {
  return api(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}
export async function deleteCollection(id: string): Promise<void> {
  await api(`/collections/${id}`, { method: 'DELETE' });
}

// כפילויות מלאות: קבוצות קבצים עם אותו תוכן.
export async function listDuplicates(): Promise<DuplicateGroup[]> {
  return api('/files/duplicates');
}
// מיזוג: שומרים קובץ אחד, מאחדים אליו תגיות ומסירים את השאר.
export async function mergeDuplicates(keepId: string, removeIds: string[]): Promise<{ keepId: string; removed: number }> {
  return api('/files/duplicates/merge', { method: 'POST', body: JSON.stringify({ keepId, removeIds }) });
}

// העלאה — multipart (לא JSON), לכן fetch ישיר עם הטוקן.
export async function uploadFile(file: File, folderId: string | null, tagIds: string[]): Promise<ArchiveFile> {
  const fd = new FormData();
  fd.append('file', file);
  if (folderId) fd.append('folderId', folderId);
  if (tagIds.length) fd.append('tagIds', tagIds.join(','));
  const token = getToken();
  const res = await fetch(`${API_URL}/files/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const m = data?.message;
    throw new Error(Array.isArray(m) ? m.join(', ') : m || `שגיאה (${res.status})`);
  }
  return data as ArchiveFile;
}

// הורדה מאובטחת — מביא את הקובץ עם הטוקן ומפעיל הורדה בדפדפן.
export async function downloadFile(f: ArchiveFile): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/files/${f.id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`שגיאה בהורדה (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteFile(id: string): Promise<void> {
  await api(`/files/${id}`, { method: 'DELETE' });
}


// ───────── תצוגה מקדימה ופרטי-על (שלב 2.5) ─────────

// פרטי-על מלאים של קובץ (כולל מי העלה, מתי עודכן, וכמה עותקים בעלי תוכן זהה).
export type FileDetails = ArchiveFile & {
  updatedAt: string;
  uploadedBy: { id: string; name: string; email: string } | null;
  duplicateCount: number;
};
export async function getFileDetails(id: string): Promise<FileDetails> {
  return api(`/files/${id}/details`);
}

// האם לסוג הקובץ יש תצוגה מקדימה (תמונה/וידאו/שמע/PDF).
export function isPreviewable(mime?: string | null): boolean {
  if (!mime) return false;
  if (mime === 'application/pdf' || mime === 'text/plain') return true;
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
}

// תצוגה מקדימה כ-blob (הטוקן נשאר בכותרת — אין חשיפת קישור ישיר). מחזיר כתובת אובייקט; יש לשחרר עם revokeObjectURL.
export async function fetchPreview(id: string): Promise<{ url: string; type: string }> {
  const token = getToken();
  const res = await fetch(`${API_URL}/files/${id}/preview`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 415) throw new Error('אין תצוגה מקדימה לסוג קובץ זה');
  if (!res.ok) throw new Error(`שגיאה בתצוגה מקדימה (${res.status})`);
  const blob = await res.blob();
  const type = res.headers.get('Content-Type') || blob.type || '';
  return { url: URL.createObjectURL(blob), type };
}

// ───────── לוג פעילות / ביקורת (שלב 2.6) ─────────
export type AuditEntry = {
  id: string;
  action: string;
  actionLabel: string;
  targetType: string | null;
  targetTypeLabel: string | null;
  targetId: string | null;
  actorName: string;
  details: any;
  createdAt: string;
};
export type AuditLogResult = { items: AuditEntry[]; total: number; page: number; pageSize: number; pages: number };

// קריאת יומן הפעילות (קריאה בלבד). סינון אופציונלי לפי יעד (targetType+targetId), מבצע (userId) או פעולה.
export async function listAuditLog(
  opts: { targetType?: string; targetId?: string; userId?: string; action?: string; page?: number; pageSize?: number } = {},
): Promise<AuditLogResult> {
  const p = new URLSearchParams();
  if (opts.targetType) p.set('targetType', opts.targetType);
  if (opts.targetId) p.set('targetId', opts.targetId);
  if (opts.userId) p.set('userId', opts.userId);
  if (opts.action) p.set('action', opts.action);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api('/logs' + (qs ? `?${qs}` : ''));
}

// ───────── לוח בקרה חי (שלב 2.7) ─────────
export type DashboardStats = {
  storage: { usedBytes: number; diskFreeBytes: number; diskTotalBytes: number };
  totals: { files: number; duplicateGroups: number; notBackedUp: number; pendingImports: number };
  byType: { mimeType: string | null; count: number; bytes: number }[];
};
export async function getDashboard(): Promise<DashboardStats> {
  return api('/dashboard');
}

// ───────── ייבוא מדיסקים (שלב 1.7) ─────────

export type ImportJob = {
  id: string; label: string; sourcePath: string; status: string;
  targetFolderId: string | null;
  totalFiles: number; totalBytes: number; hashedFiles: number;
  newFiles: number; newBytes: number; duplicateFiles: number;
  importedFiles: number; importedBytes: number; errorFiles: number;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
};
export type ImportItem = {
  id: string; relativePath: string; name: string; sizeBytes: number;
  hash: string | null; status: string; fileId: string | null; error: string | null;
};

// יצירת סריקה (מונה קבצים בדיסק; קריאה בלבד, לא נוגע במקור).
export async function importScan(sourcePath: string, label: string): Promise<ImportJob> {
  return api('/import/scan', { method: 'POST', body: JSON.stringify({ sourcePath, label }) });
}
// אצוות חישוב Hash + השוואה למאגר (שלב "סריקה בלבד"). קוראים שוב עד status='scanned'.
export async function importHashBatch(id: string, limit = 50): Promise<ImportJob> {
  return api(`/import/${id}/hash?limit=${limit}`, { method: 'POST' });
}
// אצוות ייבוא בפועל (העתקת חדשים בלבד). קוראים שוב עד status='completed'.
export async function importRunBatch(id: string, limit = 50): Promise<ImportJob> {
  return api(`/import/${id}/import?limit=${limit}`, { method: 'POST' });
}
export async function listImportJobs(): Promise<ImportJob[]> {
  return api('/import');
}
export async function getImportJob(id: string): Promise<ImportJob> {
  return api(`/import/${id}`);
}
export async function getImportItems(id: string, status?: string, take = 200): Promise<{ total: number; items: ImportItem[] }> {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  p.set('take', String(take));
  return api(`/import/${id}/items?${p.toString()}`);
}

// ───────── צפייה מוגנת (שלב 3.1) ─────────
// פתיחת הפעלת צפייה — השרת מחזיר מזהה הפעלה, סוג, מספר עמודים (ל-PDF), וטוקן קצר-מועד.
export type ProtectedKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'unsupported';
export type ProtectedSession = {
  sid: string; kind: ProtectedKind; pages: number;
  mimeType: string | null; name: string; expiresAt: string;
  token: string; tokenExpiresIn: number;
};

// מטמון טוקנים קצרי-מועד לפי הפעלה — מתחדש אוטומטית לפני שהטוקן פג.
const _viewTok = new Map<string, { token: string; exp: number }>();

export async function createViewSession(fileId: string): Promise<ProtectedSession> {
  const s = (await api('/view/sessions', { method: 'POST', body: JSON.stringify({ fileId }) })) as ProtectedSession;
  _viewTok.set(s.sid, { token: s.token, exp: Date.now() + (s.tokenExpiresIn - 10) * 1000 });
  return s;
}

async function _viewToken(sid: string): Promise<string> {
  const c = _viewTok.get(sid);
  if (c && c.exp > Date.now()) return c.token;
  const r = (await api(`/view/sessions/${sid}/token`, { method: 'POST' })) as { token: string; tokenExpiresIn: number };
  _viewTok.set(sid, { token: r.token, exp: Date.now() + (r.tokenExpiresIn - 10) * 1000 });
  return r.token;
}

// מביא "גרסת צפייה" נגזרת כ-blob (לא המקור). seg: 'image' | `page/${n}` | 'video' | 'audio' | 'text'.
// הטוקן הקצר עובר ב-query, וטוקן ההתחברות בכותרת — גישה ישירה לכתובת בלי שניהם נכשלת.
export async function fetchRendition(sid: string, fileId: string, seg: string): Promise<{ url: string; type: string }> {
  const login = getToken();
  const hit = (tk: string) =>
    fetch(`${API_URL}/view/${fileId}/${seg}?vt=${encodeURIComponent(tk)}`, {
      headers: login ? { Authorization: `Bearer ${login}` } : {},
      cache: 'no-store',
    });
  let res = await hit(await _viewToken(sid));
  if (res.status === 403) { _viewTok.delete(sid); res = await hit(await _viewToken(sid)); } // טוקן פג — חידוש וניסיון חוזר
  if (!res.ok) throw new Error(res.status === 415 ? 'אין צפייה מוגנת לסוג קובץ זה' : `שגיאת צפייה (${res.status})`);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: res.headers.get('Content-Type') || blob.type || '' };
}

// האם לסוג הקובץ יש צפייה מוגנת.
export function isProtectedViewable(mime?: string | null): boolean {
  if (!mime) return false;
  if (mime === 'application/pdf' || mime === 'text/plain') return true;
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
}

// ───────── סימני מים (שלב 3.2) ─────────
export type WatermarkPosition = 'tiled' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type WatermarkTemplate = {
  id: string; name: string; text: string; fontSize: number; color: string;
  opacity: number; position: WatermarkPosition; angle: number; motion: boolean;
  isActive: boolean; enabled: boolean; priority: number; kind: 'text' | 'image';
  imagePath: string | null; imageScale: number; outline: boolean;
  // [שינוי 2026-06-25] גמישות: מרחק חזרות, תנועה, הבהוב
  tileGap: number; motionAxis: 'x' | 'y'; motionDir: number; motionSpeed: number;
  blink: boolean; blinkInterval: number; blinkOn: number;
  folderIds: string[]; tagIds: string[]; mimeTypes: string[]; sensitivities: string[];
  includeSubfolders: boolean; includeSubtags: boolean;
  createdAt: string; updatedAt: string;
};
export async function listWatermarks(): Promise<WatermarkTemplate[]> { return api('/watermarks'); }
export async function createWatermark(t: Partial<WatermarkTemplate>): Promise<WatermarkTemplate> {
  return api('/watermarks', { method: 'POST', body: JSON.stringify(t) });
}
export async function updateWatermark(id: string, t: Partial<WatermarkTemplate>): Promise<WatermarkTemplate> {
  return api(`/watermarks/${id}`, { method: 'PATCH', body: JSON.stringify(t) });
}
export async function enableWatermark(id: string): Promise<WatermarkTemplate> {
  return api(`/watermarks/${id}/enable`, { method: 'POST' });
}
export async function disableWatermark(id: string): Promise<WatermarkTemplate> {
  return api(`/watermarks/${id}/disable`, { method: 'POST' });
}
// העלאת לוגו לתבנית (multipart). מסמן את התבנית כ-kind=image.
// יצירת סימן מים מוצמד לקובץ בודד (טקסט מותאם, מופעל מיד) — שלב 3.8b.
export async function createFileWatermark(fileId: string, name: string, text: string): Promise<WatermarkTemplate> {
  return api('/watermarks', { method: 'POST', body: JSON.stringify({ name, text, kind: 'text', enabled: true, position: 'tiled', outline: true, fileIds: [fileId] }) });
}
export async function uploadWatermarkLogo(id: string, file: File): Promise<WatermarkTemplate> {
  const fd = new FormData(); fd.append('file', file);
  const token = getToken();
  const res = await fetch(`${API_URL}/watermarks/${id}/logo`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd, cache: 'no-store' });
  const t = await res.text(); const data = t ? JSON.parse(t) : null;
  if (!res.ok) { const m = data?.message; throw new Error(Array.isArray(m) ? m.join(', ') : m || `שגיאה (${res.status})`); }
  return data as WatermarkTemplate;
}
export async function deleteWatermark(id: string): Promise<void> {
  await api(`/watermarks/${id}`, { method: 'DELETE' });
}

// ───────── מכשירים מאושרים (שלב 3.3) ─────────
export type DeviceRow = {
  id: string; deviceId: string; name: string; approved: boolean;
  revokedAt: string | null; lastSeenAt: string | null; createdAt: string;
  user: { id: string; name: string; email: string } | null;
};
export async function listDevices(): Promise<DeviceRow[]> { return api('/devices'); }
export async function approveDevice(id: string): Promise<DeviceRow> { return api(`/devices/${id}/approve`, { method: 'POST' }); }
export async function revokeDevice(id: string): Promise<DeviceRow> { return api(`/devices/${id}/revoke`, { method: 'POST' }); }

// ───────── הגבלות צפייה (שלב 3.4) ─────────
// הגבלה = "רשימת היתר" לקובץ: למי / מאיזה מכשיר / עד מתי / כמה צפיות. נאכפת בשרת, ניתנת לביטול מיידי.
export type RestrictionState = 'active' | 'revoked' | 'expired' | 'exhausted';
export type ViewRestriction = {
  id: string;
  fileId: string;
  fileName: string;
  scope: { userId: string; userName: string; userEmail: string } | null; // null = כל המשתמשים
  device: { deviceId: string; deviceName: string } | null; // null = כל מכשיר
  expiresAt: string | null;
  maxViews: number | null;
  viewsUsed: number;
  viewsLeft: number | null;
  active: boolean;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
  state: RestrictionState;
};
export type RestrictionMeta = {
  users: { id: string; name: string; email: string }[];
  devices: { deviceId: string; name: string; user: { id: string; name: string; email: string } | null }[];
};
export type CreateRestrictionInput = {
  fileId: string;
  userId?: string | null;
  deviceId?: string | null;
  expiresAt?: string | null;
  maxViews?: number | null;
  note?: string | null;
};

export async function listRestrictions(): Promise<ViewRestriction[]> { return api('/restrictions'); }
export async function listFileRestrictions(fileId: string): Promise<ViewRestriction[]> { return api(`/restrictions/file/${fileId}`); }
export async function getRestrictionMeta(): Promise<RestrictionMeta> { return api('/restrictions/meta'); }
export async function createRestriction(input: CreateRestrictionInput): Promise<ViewRestriction> {
  return api('/restrictions', { method: 'POST', body: JSON.stringify(input) });
}
export async function updateRestriction(id: string, input: Partial<CreateRestrictionInput>): Promise<ViewRestriction> {
  return api(`/restrictions/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}
export async function revokeRestriction(id: string): Promise<ViewRestriction> {
  return api(`/restrictions/${id}/revoke`, { method: 'POST' });
}

// ───────── קישורי צפייה חיצוניים (שלב 3.5) — צד ניהול (דורש links.manage) ─────────
export type ShareLink = {
  id: string; token: string; fileId: string; fileName: string; label: string | null;
  email: string | null; requireOtp: boolean; requireApproval: boolean;
  maxViews: number | null; viewsUsed: number; expiresAt: string | null;
  singleDevice: boolean; boundDeviceKey: boolean; ipBlock: string | null;
  israelOnly: boolean; watermark: boolean; watermarkText: string | null; active: boolean; revokedAt: string | null;
  createdAt: string; pendingApprovals?: number; state?: 'active' | 'revoked' | 'expired' | 'exhausted';
};
export type SharePending = { id: string; linkId: string; email: string | null; ip: string | null; country: string | null; createdAt: string; label: string | null; fileId: string };
export type CreateShareInput = {
  fileId: string; label?: string; email?: string | null; requireOtp?: boolean; requireApproval?: boolean;
  maxViews?: number | null; expiresAt?: string | null; singleDevice?: boolean; ipBlock?: string | null;
  israelOnly?: boolean; watermark?: boolean; watermarkText?: string | null;
};
export async function listShareLinks(): Promise<ShareLink[]> { return api('/share-links'); }
export async function listFileShareLinks(fileId: string): Promise<ShareLink[]> { return api(`/share-links/file/${fileId}`); }
export async function listSharePending(): Promise<SharePending[]> { return api('/share-links/pending'); }
export async function createShareLink(input: CreateShareInput): Promise<ShareLink> { return api('/share-links', { method: 'POST', body: JSON.stringify(input) }); }
export async function revokeShareLink(id: string): Promise<{ id: string; revoked: boolean }> { return api(`/share-links/${id}/revoke`, { method: 'POST' }); }
export async function approveShareSession(sid: string): Promise<{ id: string; approved: boolean }> { return api(`/share-links/sessions/${sid}/approve`, { method: 'POST' }); }
export function shareUrl(token: string): string { return `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${token}`; }

// ───────── צד ציבורי (אורח, ללא התחברות) ─────────
export type ShareStart = {
  ready: boolean; sid: string; kind?: ProtectedKind; pages?: number; name?: string; mimeType?: string | null;
  watermark?: boolean; token?: string; tokenExpiresIn?: number;
  needVerify?: boolean; needApproval?: boolean; emailLocked?: boolean; emailHint?: string | null; pendingApproval?: boolean;
};
async function sharePost(token: string, path: string, body: any): Promise<any> {
  const res = await fetch(`${API_URL}/share/${encodeURIComponent(token)}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), cache: 'no-store',
  });
  const t = await res.text(); const data = t ? JSON.parse(t) : null;
  if (!res.ok) { const m = data?.message; throw new Error(Array.isArray(m) ? m.join(', ') : m || `שגיאה (${res.status})`); }
  return data;
}
// מזהה מכשיר יציב לדפדפן (לנעילת "מכשיר אחד") — נשמר מקומית.
export function getShareDeviceKey(): string {
  if (typeof window === 'undefined') return 'srv';
  let k = window.localStorage.getItem('archive_share_dk');
  if (!k) { k = ((window.crypto as any)?.randomUUID?.() || String(Math.random()).slice(2)) + '-' + Date.now(); window.localStorage.setItem('archive_share_dk', k); }
  return k;
}
export function shareStart(token: string): Promise<ShareStart> { return sharePost(token, 'start', { deviceKey: getShareDeviceKey() }); }
export function shareRequestOtp(token: string, sid: string, email: string): Promise<{ sent: boolean }> { return sharePost(token, 'otp', { sid, email }); }
export function shareVerify(token: string, sid: string, code: string): Promise<ShareStart> { return sharePost(token, 'verify', { sid, code, deviceKey: getShareDeviceKey() }); }
export function shareStatus(token: string, sid: string): Promise<ShareStart> { return sharePost(token, 'status', { sid, deviceKey: getShareDeviceKey() }); }

// מטמון טוקן רינדור לאורח לפי הפעלה
const _shareTok = new Map<string, { token: string; exp: number }>();
export function rememberShareToken(sid: string, token: string, ttl: number): void { _shareTok.set(sid, { token, exp: Date.now() + (ttl - 10) * 1000 }); }
async function _shareToken(token: string, sid: string): Promise<string> {
  const c = _shareTok.get(sid); if (c && c.exp > Date.now()) return c.token;
  const r = await sharePost(token, 'token', { sid, deviceKey: getShareDeviceKey() });
  _shareTok.set(sid, { token: r.token, exp: Date.now() + (r.tokenExpiresIn - 10) * 1000 }); return r.token;
}
// מביא גרסת-צפייה לאורח כ-blob. seg: 'image' | `page/${n}` | 'video' | 'audio' | 'text'.
export async function fetchShareRendition(token: string, sid: string, seg: string): Promise<{ url: string; type: string }> {
  const dk = getShareDeviceKey();
  const hit = (tk: string) => fetch(`${API_URL}/share/${encodeURIComponent(token)}/view/${seg}?vt=${encodeURIComponent(tk)}&dk=${encodeURIComponent(dk)}`, { cache: 'no-store' });
  let res = await hit(await _shareToken(token, sid));
  if (res.status === 403) { _shareTok.delete(sid); res = await hit(await _shareToken(token, sid)); }
  if (!res.ok) throw new Error(res.status === 415 ? 'אין צפייה לסוג קובץ זה' : `שגיאת צפייה (${res.status})`);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: res.headers.get('Content-Type') || blob.type || '' };
}

// ───────── הרשאות גישה גמישות (שלב 3.9) — דורש security.manage ─────────
export type AccessRuleState = 'active' | 'revoked' | 'expired';
export type AccessRule = {
  id: string; type: 'grant' | 'restrict'; label: string | null;
  folderIds: string[]; tagIds: string[]; fileIds: string[]; mimeTypes: string[]; sensitivities: string[];
  includeSubfolders: boolean; includeSubtags: boolean;
  folderNames: string[]; tagNames: string[]; fileCount: number;
  users: { id: string; name: string; email: string }[];
  deviceId: string | null; expiresAt: string | null; active: boolean; note: string | null;
  createdAt: string; revokedAt: string | null; state: AccessRuleState;
};
export type AccessMeta = {
  users: { id: string; name: string; email: string; scopedView: boolean }[];
  devices: { deviceId: string; name: string; user: { id: string; name: string; email: string } | null }[];
};
export type CreateAccessInput = {
  type: 'grant' | 'restrict'; label?: string; userIds?: string[];
  folderIds?: string[]; tagIds?: string[]; mimeTypes?: string[]; sensitivities?: string[];
  includeSubfolders?: boolean; includeSubtags?: boolean; deviceId?: string | null; expiresAt?: string | null; note?: string;
};
export async function listAccessRules(): Promise<AccessRule[]> { return api('/access'); }
export async function getAccessMeta(): Promise<AccessMeta> { return api('/access/meta'); }
export async function createAccessRule(input: CreateAccessInput): Promise<AccessRule> { return api('/access', { method: 'POST', body: JSON.stringify(input) }); }
export async function revokeAccessRule(id: string): Promise<AccessRule> { return api(`/access/${id}/revoke`, { method: 'POST' }); }
export async function setUserScopedView(userId: string, scopedView: boolean): Promise<{ id: string; scopedView: boolean }> {
  return api(`/access/users/${userId}/scoped-view`, { method: 'POST', body: JSON.stringify({ scopedView }) });
}

// ── לוג צפיות מלא (שלב 3.6) — קריאה בלבד ──
export type ViewLogEntry = {
  id: string;
  kind: 'internal' | 'share';
  kindLabel: string;
  fileId: string;
  fileName: string;
  contentKind: string | null;
  viewerLabel: string;
  viewerType: 'user' | 'guest';
  createdBy: string | null;
  sentTo: string | null;
  linkId: string | null;
  linkLabel: string | null;
  openedAt: string;
  lastActivityAt: string | null;
  durationSeconds: number;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  viewCount: number;
  status: 'active' | 'expired' | 'revoked' | 'pending';
  statusLabel: string;
};
export type ViewLogResult = { items: ViewLogEntry[]; total: number; page: number; pageSize: number; pages: number };

export type ViewLinkSummary = {
  id: string;
  fileId: string;
  fileName: string;
  label: string | null;
  createdBy: string | null;
  sentTo: string | null;
  conditions: string[];
  watermark: boolean;
  allowDownload: boolean;
  maxViews: number | null;
  viewsUsed: number;
  opensCount: number;
  lastOpenedAt: string | null;
  status: 'active' | 'expired' | 'revoked' | 'pending';
  statusLabel: string;
  createdAt: string;
  revokedAt: string | null;
};
export type ViewLinkResult = { items: ViewLinkSummary[]; total: number; page: number; pageSize: number; pages: number };

export async function listViewLog(
  opts: { fileId?: string; userId?: string; linkId?: string; kind?: 'internal' | 'share'; page?: number; pageSize?: number } = {},
): Promise<ViewLogResult> {
  const p = new URLSearchParams();
  if (opts.fileId) p.set('fileId', opts.fileId);
  if (opts.userId) p.set('userId', opts.userId);
  if (opts.linkId) p.set('linkId', opts.linkId);
  if (opts.kind) p.set('kind', opts.kind);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api('/view-log' + (qs ? `?${qs}` : ''));
}

export async function listViewLogLinks(
  opts: { fileId?: string; page?: number; pageSize?: number } = {},
): Promise<ViewLinkResult> {
  const p = new URLSearchParams();
  if (opts.fileId) p.set('fileId', opts.fileId);
  if (opts.page) p.set('page', String(opts.page));
  if (opts.pageSize) p.set('pageSize', String(opts.pageSize));
  const qs = p.toString();
  return api('/view-log/links' + (qs ? `?${qs}` : ''));
}

// ───────── עריכת תמונות (שלב 4.1) ─────────
export type EditOp =
  | { op: 'crop'; x: number; y: number; w: number; h: number }
  | { op: 'rotate'; deg: 90 | 180 | 270 }
  | { op: 'flip'; axis: 'h' | 'v' }
  | { op: 'resize'; scalePct: number }
  | { op: 'brightness'; value: number }
  | { op: 'contrast'; value: number }
  | { op: 'sharpen'; value: number }
  | { op: 'grayscale' }
  | { op: 'redact'; shape: 'rect' | 'ellipse' | 'polygon'; mode: 'blur' | 'pixelate' | 'cover'; strength: number; color: string; feather: number; invert: boolean; x?: number; y?: number; w?: number; h?: number; points?: { x: number; y: number }[] }
  | { op: 'text'; x: number; y: number; value: string; color: string; size: number; font: string }
  | { op: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { op: 'frame'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { op: 'watermark'; text: string }
  | { op: 'strip' };

export type EditResultFile = { id: string; name: string; sizeBytes: number; mimeType: string | null; hash: string; createdAt: string };
export type EditVersion = { id: string; versionNo: number; label: string | null; recipe: EditOp[]; createdAt: string; result: EditResultFile | null };
export type MediaEdit = { id: string; fileId: string; name: string; createdAt: string; versions: EditVersion[] };

// האם הקובץ ניתן לעריכת תמונה (שלב 4.1 — תמונות בלבד, ללא SVG).
export function isImageEditable(mime?: string | null): boolean {
  return !!mime && mime.startsWith('image/') && mime !== 'image/svg+xml';
}

// תמונת בסיס לעורך (גרסת-צפייה ממוזערת ומקודדת מחדש — לא המקור). מחזיר object URL לשחרור.
export async function fetchEditBase(fileId: string): Promise<{ url: string; type: string }> {
  const token = getToken();
  const res = await fetch(`${API_URL}/media/base/${fileId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 403 ? 'אין הרשאת עריכה לקובץ זה' : `שגיאה בטעינת התמונה (${res.status})`);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: res.headers.get('Content-Type') || blob.type || '' };
}

// תצוגה מקדימה של מתכון (מוחל בשרת על עותק ממוזער; לא נשמר). מחזיר object URL לשחרור.
export async function fetchEditPreview(fileId: string, recipe: EditOp[]): Promise<{ url: string; type: string }> {
  const token = getToken();
  const res = await fetch(`${API_URL}/media/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ fileId, recipe }), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`שגיאה בתצוגה מקדימה (${res.status})`);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: res.headers.get('Content-Type') || blob.type || '' };
}

// שמירת גרסה ערוכה — מחיל את המתכון על המקור במלוא הרזולוציה, יוצר קובץ נגזר חדש (source='edit').
export async function saveEditVersion(
  fileId: string, recipe: EditOp[], label?: string, opts?: { share?: boolean; watermarkText?: string },
): Promise<{ editId: string; version: EditVersion; result: { id: string; name: string; hash: string; sizeBytes: number; mimeType: string; duplicate: boolean } }> {
  return api('/media/edits', { method: 'POST', body: JSON.stringify({ fileId, recipe, label, share: opts?.share, watermarkText: opts?.watermarkText }) });
}

// רשימת פרויקטי העריכה והגרסאות של קובץ.
export async function listFileEdits(fileId: string): Promise<MediaEdit[]> {
  return api(`/media/edits/${encodeURIComponent(fileId)}`);
}

// שכפול גרסה (שלב 4.4) — יוצר גרסה חדשה מאותו מתכון.
export async function duplicateVersion(versionId: string): Promise<{ editId: string; version: EditVersion; result: { id: string; name: string } }> {
  return api(`/media/versions/${encodeURIComponent(versionId)}/duplicate`, { method: 'POST' });
}

// הורדת גרסה ערוכה (שלב 4.4) — דורשת הרשאת files.download_edited. מביא עם הטוקן ומפעיל הורדה בדפדפן.
export async function downloadEditedVersion(versionId: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/media/versions/${encodeURIComponent(versionId)}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 403 ? 'אין הרשאת הורדת גרסה ערוכה' : `שגיאה בהורדה (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename || 'edited'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ───────── תור עיבוד ברקע (שלב 4.5) ─────────
export type RenderJob = {
  id: string; type: string; status: 'pending' | 'processing' | 'done' | 'failed' | 'canceled';
  fileId: string | null; progress: number; resultFileId: string | null; error: string | null;
  createdById: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
};
export type RenderJobList = { items: RenderJob[]; total: number; active: number; page: number; pageSize: number; pages: number };

export async function listRenderJobs(opts?: { status?: string; mine?: boolean; pageSize?: number }): Promise<RenderJobList> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.mine) qs.set('mine', '1');
  if (opts?.pageSize) qs.set('pageSize', String(opts.pageSize));
  const q = qs.toString();
  return api('/render/jobs' + (q ? `?${q}` : ''));
}
export async function getRenderJob(id: string): Promise<RenderJob> { return api(`/render/jobs/${encodeURIComponent(id)}`); }
export async function enqueueEditJob(fileId: string, recipe: EditOp[], label?: string): Promise<RenderJob> {
  return api('/render/jobs/edit', { method: 'POST', body: JSON.stringify({ fileId, recipe, label }) });
}
export async function cancelRenderJob(id: string): Promise<RenderJob> { return api(`/render/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); }
