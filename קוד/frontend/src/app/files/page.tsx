'use client';
// files/page.tsx — מסך קבצים (מוגן): העלאה, חיפוש, מיון, סינון מתקדם, אוספים, תצוגות וטעינה במנות (שלבים 2.1–2.4).
// צפייה=files.view, העלאה=files.upload, הורדה=files.download_source, מחיקה=files.delete.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe, getToken, logout, hasPermission,
  listFiles, uploadFile, downloadFile, deleteFile,
  listFolders, listTags, listTagsTree, listFileTypes, listUploaders,
  listCollections, createCollection, deleteCollection,
  getFileDetails, fetchPreview, isPreviewable, isProtectedViewable, isImageEditable,
  type AuthUser, type ArchiveFile, type FileDetails, type FileListResult, type FileSort, type FileQuery,
  type FolderNode, type Tag, type TagNode, type SmartCollection,
} from '@/lib/api';
import ActivityLog from '@/components/ActivityLog';
import ViewLog from '@/components/ViewLog';
import ProtectedViewer from '@/components/ProtectedViewer';
import RestrictionsManager from '@/components/RestrictionsManager';
import ShareManager from '@/components/ShareManager';
import FileWatermark from '@/components/FileWatermark';
import ImageEditor from '@/components/ImageEditor';

type Flat = { id: string; name: string; depth: number };
function flatten(nodes: FolderNode[], depth = 0): Flat[] {
  const out: Flat[] = [];
  for (const n of nodes) { out.push({ id: n.id, name: n.name, depth }); if (n.children?.length) out.push(...flatten(n.children, depth + 1)); }
  return out;
}
function flattenTags(nodes: TagNode[], depth = 0): Flat[] {
  const out: Flat[] = [];
  for (const n of nodes) { out.push({ id: n.id, name: n.name, depth }); if (n.children?.length) out.push(...flattenTags(n.children, depth + 1)); }
  return out;
}
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}
function humanDate(s: string): string {
  try { return new Date(s).toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { return s; }
}
function humanDateTime(s: string): string {
  try { return new Date(s).toLocaleString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; }
}
function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '';
  const tot = Math.round(sec); const h = Math.floor(tot / 3600); const m = Math.floor((tot % 3600) / 60); const ss = tot % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}
const PREVIEW_AUTOLOAD_MAX = 100 * 1024 * 1024; // 100MB — מעל זה לא טוענים וידאו/שמע אוטומטית
// שורה בטבלת פרטי-העל.
function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <tr style={{ borderTop: '1px solid #eef2f7' }}>
      <td style={metaK}>{k}</td>
      <td style={metaV}>{v}</td>
    </tr>
  );
}
// תווית ידידותית לסוג קובץ (mime).
function mimeLabel(m: string): string {
  if (m.startsWith('image/')) return `תמונה (${m.replace('image/', '')})`;
  if (m.startsWith('video/')) return `וידאו (${m.replace('video/', '')})`;
  if (m.startsWith('audio/')) return `שמע (${m.replace('audio/', '')})`;
  if (m === 'application/pdf') return 'PDF';
  if (m === 'application/zip') return 'ZIP / Office';
  if (m === 'application/gzip') return 'GZIP';
  if (m.startsWith('text/')) return `טקסט (${m.replace('text/', '')})`;
  if (m === 'application/octet-stream') return 'כללי (לא מזוהה)';
  return m;
}
// קיבוץ לפי חודש (לתצוגת ציר הזמן). שומר על סדר ההופעה (לפי המיון הנוכחי).
function groupByMonth(items: ArchiveFile[]): { key: string; label: string; items: ArchiveFile[] }[] {
  const map = new Map<string, { key: string; label: string; items: ArchiveFile[] }>();
  for (const f of items) {
    const d = new Date(f.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let g = map.get(key);
    if (!g) { g = { key, label: d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }), items: [] }; map.set(key, g); }
    g.items.push(f);
  }
  return Array.from(map.values());
}
function backupBadge(b?: boolean) {
  return b
    ? <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>✓ מגובה</span>
    : <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>○ לא מגובה</span>;
}
const SIZE_UNITS: { label: string; mult: number }[] = [
  { label: 'בייט', mult: 1 }, { label: 'KB', mult: 1024 }, { label: 'MB', mult: 1024 * 1024 }, { label: 'GB', mult: 1024 * 1024 * 1024 },
];
const EMPTY: FileListResult = { items: [], total: 0, page: 1, pageSize: 50, pages: 1 };

export default function FilesPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [result, setResult] = useState<FileListResult>(EMPTY);
  const [folders, setFolders] = useState<Flat[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagTreeFlat, setTagTreeFlat] = useState<Flat[]>([]);
  const [fileTypes, setFileTypes] = useState<string[]>([]);
  const [uploaders, setUploaders] = useState<{ id: string; name: string }[]>([]);
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [selectedCol, setSelectedCol] = useState('');

  // חיפוש + מיון + עימוד + תצוגה
  const [q, setQ] = useState(''); const [qDebounced, setQDebounced] = useState('');
  const [sort, setSort] = useState<FileSort>('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [view, setView] = useState<'list' | 'tiles' | 'timeline'>('list');

  // סינון מתקדם
  const [showFilters, setShowFilters] = useState(false);
  const [filterFolder, setFilterFolder] = useState('');
  const [anyTags, setAnyTags] = useState<Set<string>>(new Set());
  const [exTags, setExTags] = useState<Set<string>>(new Set());
  const [untagged, setUntagged] = useState(false);
  const [mimeSel, setMimeSel] = useState<Set<string>>(new Set());
  const [ext, setExt] = useState(''); const [extDebounced, setExtDebounced] = useState('');
  const [sizeMin, setSizeMin] = useState(''); const [sizeMax, setSizeMax] = useState('');
  const [sizeUnit, setSizeUnit] = useState(1024 * 1024); // MB
  const [dateFrom, setDateFrom] = useState(''); const [dateTo, setDateTo] = useState('');
  const [uploader, setUploader] = useState('');
  const [source, setSource] = useState<'' | 'upload' | 'import' | 'edit'>('');
  const [dupState, setDupState] = useState<'' | 'only' | 'unique'>('');
  const [backedUp, setBackedUp] = useState<'' | 'true' | 'false'>('');

  // העלאה
  const [folderId, setFolderId] = useState('');
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());

  // תצוגה מקדימה + פרטי-על (שלב 2.5)
  const [selected, setSelected] = useState<ArchiveFile | null>(null);
  const [protectedFile, setProtectedFile] = useState<ArchiveFile | null>(null); // צפייה מוגנת (שלב 3.1)
  const [restrictFile, setRestrictFile] = useState<ArchiveFile | null>(null); // הגבלת גישה (שלב 3.4)
  const [shareFile, setShareFile] = useState<ArchiveFile | null>(null); // קישור צפייה חיצוני (שלב 3.5)
  const [wmFile, setWmFile] = useState<ArchiveFile | null>(null); // סימן מים לקובץ (שלב 3.8b)
  const [editFile, setEditFile] = useState<ArchiveFile | null>(null); // עריכת תמונה (שלב 4.1)
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unsupported' | 'toobig'>('idle');
  const [previewMsg, setPreviewMsg] = useState('');
  const [resolution, setResolution] = useState('');
  const [duration, setDuration] = useState('');
  const [copied, setCopied] = useState(false);
  const [logFile, setLogFile] = useState<ArchiveFile | null>(null);
  const [viewLogFile, setViewLogFile] = useState<ArchiveFile | null>(null); // לוג צפיות לקובץ (שלב 3.6)

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');

  const canUpload = hasPermission(me, 'files.upload');
  const canDelete = hasPermission(me, 'files.delete');
  const canDownload = hasPermission(me, 'files.download_source');
  const canViewLogs = hasPermission(me, 'logs.view');
  const canManageSecurity = hasPermission(me, 'security.manage');
  const canManageLinks = hasPermission(me, 'links.manage');
  const canManageWatermark = hasPermission(me, 'watermark.create');
  const canEditMedia = hasPermission(me, 'media.edit');

  const anyKey = Array.from(anyTags).sort().join(',');
  const exKey = Array.from(exTags).sort().join(',');
  const mimeKey = Array.from(mimeSel).sort().join(',');
  const bytesOf = (v: string): number | undefined => { const n = parseFloat(v); return v.trim() && !Number.isNaN(n) ? Math.round(n * sizeUnit) : undefined; };

  function buildQuery(): FileQuery {
    return {
      q: qDebounced || undefined,
      folderId: filterFolder || undefined,
      untagged: untagged || undefined,
      tagIds: anyTags.size ? Array.from(anyTags) : undefined,
      excludeTagIds: exTags.size ? Array.from(exTags) : undefined,
      mimeTypes: mimeSel.size ? Array.from(mimeSel) : undefined,
      ext: extDebounced || undefined,
      sizeMin: bytesOf(sizeMin),
      sizeMax: bytesOf(sizeMax),
      createdFrom: dateFrom || undefined,
      createdTo: dateTo || undefined,
      uploadedById: uploader || undefined,
      source: source || undefined,
      duplicate: dupState || undefined,
      backedUp: backedUp === '' ? undefined : backedUp === 'true',
      sort, order, page, pageSize,
    };
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe()
      .then(async (u) => {
        setMe(u);
        if (!hasPermission(u, 'files.view')) { setDenied(true); return; }
        try { setFolders(flatten(await listFolders())); } catch { /* */ }
        try { setTags(await listTags()); } catch { /* */ }
        try { setTagTreeFlat(flattenTags(await listTagsTree())); } catch { /* */ }
        try { setFileTypes(await listFileTypes()); } catch { /* */ }
        try { setUploaders(await listUploaders()); } catch { /* */ }
        try { setCollections(await listCollections()); } catch { /* */ }
        setReady(true);
      })
      .catch(() => { logout(); router.replace('/login'); })
      .finally(() => setLoading(false));
  }, [router]);

  // החלת סינון מתוך כתובת ה-URL (קפיצה מלוח הבקרה). פעם אחת בטעינה.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const bu = sp.get('backedUp'); if (bu === 'true' || bu === 'false') setBackedUp(bu);
    const du = sp.get('duplicate'); if (du === 'only' || du === 'unique') setDupState(du);
    if (sp.get('untagged') === '1' || sp.get('untagged') === 'true') setUntagged(true);
    const mime = sp.get('mime'); if (mime) setMimeSel(new Set([mime]));
    const qq = sp.get('q'); if (qq) setQ(qq);
    if (sp.get('backedUp') || sp.get('duplicate') || sp.get('untagged') || sp.get('mime')) setShowFilters(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const t = setTimeout(() => setExtDebounced(ext.trim()), 350); return () => clearTimeout(t); }, [ext]);

  // כל שינוי סינון/מיון → חזרה לעמוד 1.
  useEffect(() => { setPage(1); }, [qDebounced, extDebounced, sort, order, pageSize, filterFolder, untagged, anyKey, exKey, mimeKey, sizeMin, sizeMax, sizeUnit, dateFrom, dateTo, uploader, source, dupState, backedUp]);

  // טעינת עמוד הקבצים לפי המצב.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setListLoading(true);
    listFiles(buildQuery())
      .then((r) => { if (alive) setResult(r); })
      .catch((e: any) => { if (alive) setMsg(e.message || 'שגיאה בטעינה'); })
      .finally(() => { if (alive) setListLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, qDebounced, extDebounced, sort, order, page, pageSize, filterFolder, untagged, anyKey, exKey, mimeKey, sizeMin, sizeMax, sizeUnit, dateFrom, dateTo, uploader, source, dupState, backedUp]);

  async function reload(): Promise<void> {
    try { setListLoading(true); setResult(await listFiles(buildQuery())); }
    catch (e: any) { setMsg(e.message || 'שגיאה בטעינה'); }
    finally { setListLoading(false); }
  }

  // ── תצוגה מקדימה + פרטי-על (שלב 2.5) ──
  function loadPreview(f: ArchiveFile): void {
    setPreviewState('loading'); setPreviewMsg('');
    fetchPreview(f.id)
      .then(({ url, type }) => { setPreviewUrl(url); setPreviewType(type); setPreviewState('ready'); })
      .catch((e: any) => { setPreviewMsg(e.message || 'שגיאה בתצוגה מקדימה'); setPreviewState('error'); });
  }
  function openDetails(f: ArchiveFile): void {
    setSelected(f);
    setDetails(null); setDetailsLoading(true);
    setResolution(''); setDuration(''); setCopied(false);
    setPreviewUrl(''); setPreviewType(''); setPreviewMsg('');
    getFileDetails(f.id).then(setDetails).catch((e: any) => setPreviewMsg(e.message || 'שגיאה בטעינת הפרטים')).finally(() => setDetailsLoading(false));
    if (!isPreviewable(f.mimeType)) { setPreviewState('unsupported'); return; }
    const heavy = (f.mimeType?.startsWith('video/') || f.mimeType?.startsWith('audio/')) && f.sizeBytes > PREVIEW_AUTOLOAD_MAX;
    if (heavy) { setPreviewState('toobig'); return; }
    loadPreview(f);
  }
  function closeDetails(): void {
    setSelected(null); setDetails(null); setPreviewState('idle');
    setPreviewUrl(''); setPreviewType(''); setResolution(''); setDuration(''); setPreviewMsg('');
  }
  async function copyHash(h: string): Promise<void> {
    try { await navigator.clipboard.writeText(h); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  }

  // שחרור כתובת ה-blob כשמחליפים/סוגרים (מונע דליפת זיכרון).
  useEffect(() => { return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }; }, [previewUrl]);
  // סגירה ב-Esc.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDetails(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) =>
    setter((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAny = toggleIn(setAnyTags);
  const toggleEx = toggleIn(setExTags);
  const toggleMime = toggleIn(setMimeSel);
  const togglePick = toggleIn(setPickedTags);

  function clearFilters(): void {
    setFilterFolder(''); setAnyTags(new Set()); setExTags(new Set()); setMimeSel(new Set()); setUntagged(false);
    setExt(''); setSizeMin(''); setSizeMax(''); setDateFrom(''); setDateTo('');
    setUploader(''); setSource(''); setDupState(''); setBackedUp('');
  }
  const activeFilters = [
    filterFolder, untagged, anyTags.size, exTags.size, mimeSel.size, extDebounced.trim(),
    sizeMin.trim(), sizeMax.trim(), dateFrom, dateTo, uploader, source, dupState, backedUp,
  ].filter(Boolean).length;

  // ── אוספים חכמים ──
  function applyCollection(f: FileQuery): void {
    setQ(f.q ?? '');
    setFilterFolder(f.folderId ?? '');
    setUntagged(!!f.untagged);
    setAnyTags(new Set(f.tagIds ?? []));
    setExTags(new Set(f.excludeTagIds ?? []));
    setMimeSel(new Set(f.mimeTypes ?? []));
    setExt(f.ext ?? '');
    setSizeUnit(1);
    setSizeMin(f.sizeMin != null ? String(f.sizeMin) : '');
    setSizeMax(f.sizeMax != null ? String(f.sizeMax) : '');
    setDateFrom(f.createdFrom ?? '');
    setDateTo(f.createdTo ?? '');
    setUploader(f.uploadedById ?? '');
    setSource((f.source as '' | 'upload' | 'import' | 'edit') ?? '');
    setDupState((f.duplicate as '' | 'only' | 'unique') ?? '');
    setBackedUp(f.backedUp === undefined ? '' : f.backedUp ? 'true' : 'false');
    if (f.sort) setSort(f.sort);
    if (f.order) setOrder(f.order);
    setShowFilters(true);
  }
  function onSelectCollection(id: string): void {
    setSelectedCol(id);
    const c = collections.find((x) => x.id === id);
    if (c) applyCollection(c.filters);
  }
  async function onSaveCollection(): Promise<void> {
    const name = window.prompt('שם לאוסף החדש:');
    if (!name || !name.trim()) return;
    const f: FileQuery = buildQuery();
    delete (f as { page?: number }).page; delete (f as { pageSize?: number }).pageSize;
    try {
      const c = await createCollection(name.trim(), f);
      setCollections(await listCollections());
      setSelectedCol(c.id);
      setMsg('✓ האוסף נשמר');
    } catch (e: any) { setMsg(e.message || 'שגיאה בשמירת האוסף'); }
  }
  async function onDeleteCollection(): Promise<void> {
    const c = collections.find((x) => x.id === selectedCol);
    if (!c) return;
    if (!window.confirm(`למחוק את האוסף "${c.name}"? (הקבצים עצמם לא נמחקים)`)) return;
    try { await deleteCollection(c.id); setSelectedCol(''); setCollections(await listCollections()); }
    catch (e: any) { window.alert(e.message || 'שגיאה'); }
  }

  // ── תצוגות מהירות ── (מאפסות סינון ומחילות צירוף מוכן)
  function quickView(kind: string): void {
    setQ(''); setFilterFolder(''); setAnyTags(new Set()); setExTags(new Set()); setMimeSel(new Set());
    setExt(''); setSizeMin(''); setSizeMax(''); setDateFrom(''); setDateTo('');
    setUploader(''); setSource(''); setDupState(''); setBackedUp(''); setUntagged(false); setSelectedCol('');
    if (kind === 'new') { setSort('createdAt'); setOrder('desc'); setView('tiles'); }
    else if (kind === 'images') { const a = fileTypes.filter((m) => m.startsWith('image/')); setMimeSel(new Set(a.length ? a : ['image/__none__'])); setView('tiles'); }
    else if (kind === 'videos') { const a = fileTypes.filter((m) => m.startsWith('video/')); setMimeSel(new Set(a.length ? a : ['video/__none__'])); setView('tiles'); }
    else if (kind === 'untagged') { setUntagged(true); }
    else if (kind === 'nobackup') { setBackedUp('false'); }
    else if (kind === 'duplicates') { setDupState('only'); }
  }

  function sortBy(field: FileSort): void {
    if (sort === field) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSort(field); setOrder(field === 'name' ? 'asc' : 'desc'); }
  }
  const arrow = (field: FileSort) => (sort !== field ? '' : order === 'asc' ? ' ▲' : ' ▼');

  async function onUpload(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const f = fileInput.current?.files?.[0];
    if (!f) { setMsg('יש לבחור קובץ'); return; }
    setUploading(true); setMsg('');
    try {
      const res = await uploadFile(f, folderId || null, Array.from(pickedTags));
      setMsg(res.duplicate
        ? `✓ הועלה — שים לב: תוכן זהה כבר קיים${res.duplicateOf ? ` (הקובץ "${res.duplicateOf}")` : ''}. אפשר לאחד במסך "כפילויות".`
        : '✓ הקובץ הועלה');
      if (fileInput.current) fileInput.current.value = '';
      setPickedTags(new Set());
      try { setFileTypes(await listFileTypes()); } catch { /* */ }
      try { setUploaders(await listUploaders()); } catch { /* */ }
      if (page === 1) await reload(); else setPage(1);
    } catch (err: any) { setMsg(err.message || 'שגיאה בהעלאה'); }
    finally { setUploading(false); }
  }
  async function onDownload(f: ArchiveFile): Promise<void> { try { await downloadFile(f); } catch (err: any) { window.alert(err.message || 'שגיאה'); } }
  async function onDelete(f: ArchiveFile): Promise<void> {
    if (!window.confirm(`למחוק את "${f.name}"? אפשר לשחזר מסל המחזור.`)) return;
    try { await deleteFile(f.id); await reload(); } catch (err: any) { window.alert(err.message || 'שגיאה'); }
  }

  function rowActions(f: ArchiveFile) {
    return (
      <>
        {isProtectedViewable(f.mimeType) && <button onClick={() => setProtectedFile(f)} style={smallBtn} title="צפייה בלי שהמקור יורד למחשב">צפייה מוגנת</button>}
        <button onClick={() => openDetails(f)} style={smallBtn}>תצוגה</button>
        {canViewLogs && <button onClick={() => setLogFile(f)} style={smallBtn}>פעילות</button>}
        {canManageSecurity && <button onClick={() => setRestrictFile(f)} style={smallBtn} title="נעילת הקובץ למכשיר / זמן / מספר צפיות">הגבלת גישה</button>}
        {canManageLinks && <button onClick={() => setShareFile(f)} style={smallBtn} title="שיתוף צפייה עם אדם מחוץ למערכת">קישור צפייה</button>}
        {canManageWatermark && <button onClick={() => setWmFile(f)} style={smallBtn} title="סימן מים מוצמד לקובץ זה">סימן מים</button>}
        {canEditMedia && isImageEditable(f.mimeType) && <button onClick={() => setEditFile(f)} style={smallBtn} title="עריכת תמונה — נשמרת כגרסה חדשה, המקור לא משתנה">עריכה</button>}
        {canDownload && <button onClick={() => onDownload(f)} style={smallBtn}>הורדה</button>}
        {canDelete && <button onClick={() => onDelete(f)} style={smallDanger}>מחיקה</button>}
      </>
    );
  }

  if (loading) return <main style={{ maxWidth: 1040, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;
  if (denied) {
    return (
      <main style={{ maxWidth: 1040, margin: '40px auto', padding: 24 }}>
        <section style={card}><h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
          <p style={{ color: 'var(--muted)' }}>אין לך הרשאת צפייה בקבצים.</p>
          <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
        </section>
      </main>
    );
  }

  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.page * result.pageSize, result.total);
  const filtering = activeFilters > 0 || !!qDebounced;

  return (
    <main style={{ maxWidth: 1040, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: 'var(--accent)', marginBottom: 4 }}>קבצים</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>{filtering ? `${result.total} תוצאות` : `${result.total} קבצים במאגר`}</p>
        </div>
        <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
      </div>

      {canUpload && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>העלאת קובץ</h2>
          <form onSubmit={onUpload}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <input ref={fileInput} type="file" style={{ flex: 1, minWidth: 220 }} />
              <label style={lbl}>תיקייה:
                <select value={folderId} onChange={(e) => setFolderId(e.target.value)} style={sel}>
                  <option value="">(ללא תיקייה)</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{' '.repeat(f.depth * 2) + f.name}</option>)}
                </select>
              </label>
              <button type="submit" disabled={uploading} style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>
                {uploading ? 'מעלה…' : 'העלה'}
              </button>
            </div>
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>תגיות:</span>
                {tags.map((t) => {
                  const on = pickedTags.has(t.id);
                  return (
                    <button type="button" key={t.id} onClick={() => togglePick(t.id)}
                      style={{ padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 13,
                        border: on ? '1px solid var(--accent)' : '1px solid #cbd5e1', background: on ? 'var(--accent)' : '#fff', color: on ? '#fff' : '#334155' }}>
                      {t.path ?? t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </form>
          {msg && <p style={{ marginBottom: 0, color: msg.startsWith('✓') ? '#15803d' : '#b91c1c', fontSize: 14 }}>{msg}</p>}
        </section>
      )}

      <section style={card}>
        {/* אוספים שמורים */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--muted)', fontSize: 14 }}>אוספים שמורים:</span>
          <select value={selectedCol} onChange={(e) => onSelectCollection(e.target.value)} style={sel}>
            <option value="">{collections.length ? '(בחר אוסף…)' : '(אין אוספים עדיין)'}</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}{c.createdByName ? ` · ${c.createdByName}` : ''}</option>)}
          </select>
          {selectedCol && <button type="button" onClick={onDeleteCollection} style={smallDanger}>מחק אוסף</button>}
          <button type="button" onClick={onSaveCollection} disabled={!filtering} style={pageBtn(!filtering)} title={filtering ? 'שמור את החיפוש/סינון הנוכחי' : 'הגדר חיפוש או סינון תחילה'}>שמור סינון נוכחי כאוסף</button>
        </div>

        {/* תצוגות מהירות */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--muted)', fontSize: 14 }}>תצוגות מהירות:</span>
          <button type="button" onClick={() => quickView('new')} style={qvBtn}>חדשים</button>
          <button type="button" onClick={() => quickView('images')} style={qvBtn}>תמונות</button>
          <button type="button" onClick={() => quickView('videos')} style={qvBtn}>סרטונים</button>
          <button type="button" onClick={() => quickView('untagged')} style={qvBtn}>ללא תגית</button>
          <button type="button" onClick={() => quickView('nobackup')} style={qvBtn}>ללא גיבוי</button>
          <button type="button" onClick={() => quickView('duplicates')} style={qvBtn}>כפולים</button>
          {['שנצפו לאחרונה', 'ששיתפתי', 'עם עריכות', 'אנשים'].map((t) => (
            <button type="button" key={t} disabled style={qvSoon} title="בקרוב — בשלבים הבאים">{t} (בקרוב)</button>
          ))}
        </div>

        {/* חיפוש + מיון + עימוד + תצוגה + סינון מתקדם */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 חיפוש לפי שם הקובץ…"
            style={{ flex: 1, minWidth: 180, padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }} />
          <label style={lbl}>תצוגה:
            <select value={view} onChange={(e) => setView(e.target.value as 'list' | 'tiles' | 'timeline')} style={sel}>
              <option value="list">רשימה</option><option value="tiles">אריחים</option><option value="timeline">ציר זמן</option>
            </select>
          </label>
          <label style={lbl}>מיון:
            <select value={sort} onChange={(e) => setSort(e.target.value as FileSort)} style={sel}>
              <option value="createdAt">תאריך</option><option value="name">שם</option><option value="sizeBytes">גודל</option>
            </select>
          </label>
          <button type="button" onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} style={btn} title="כיוון מיון">
            {order === 'asc' ? 'עולה ▲' : 'יורד ▼'}
          </button>
          <label style={lbl}>במנה:
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={sel}>
              <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </label>
          <button type="button" onClick={() => setShowFilters((v) => !v)}
            style={{ ...btn, background: activeFilters ? 'var(--accent)' : '#fff', color: activeFilters ? '#fff' : '#334155', borderColor: activeFilters ? 'var(--accent)' : '#cbd5e1' }}>
            סינון מתקדם {activeFilters ? `(${activeFilters})` : ''} {showFilters ? '▲' : '▼'}
          </button>
        </div>

        {showFilters && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 14, background: '#fafafa' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              <div>
                <div style={flbl}>תיקייה</div>
                <select value={filterFolder} onChange={(e) => setFilterFolder(e.target.value)} style={fsel}>
                  <option value="">(כל התיקיות)</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{' '.repeat(f.depth * 2) + f.name}</option>)}
                </select>
              </div>
              <div>
                <div style={flbl}>מקור</div>
                <select value={source} onChange={(e) => setSource(e.target.value as '' | 'upload' | 'import' | 'edit')} style={fsel}>
                  <option value="">(הכל)</option><option value="upload">העלאה ידנית</option><option value="import">ייבוא מדיסק</option><option value="edit">עריכה</option>
                </select>
              </div>
              <div>
                <div style={flbl}>מי שהעלה</div>
                <select value={uploader} onChange={(e) => setUploader(e.target.value)} style={fsel}>
                  <option value="">(כולם)</option>
                  {uploaders.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <div style={flbl}>מצב כפילות</div>
                <select value={dupState} onChange={(e) => setDupState(e.target.value as '' | 'only' | 'unique')} style={fsel}>
                  <option value="">(הכל)</option><option value="only">רק כפולים</option><option value="unique">רק ייחודיים</option>
                </select>
              </div>
              <div>
                <div style={flbl}>גיבוי פיזי</div>
                <select value={backedUp} onChange={(e) => setBackedUp(e.target.value as '' | 'true' | 'false')} style={fsel}>
                  <option value="">(הכל)</option><option value="true">מגובה</option><option value="false">לא מגובה</option>
                </select>
              </div>
              <div>
                <div style={flbl}>סיומת</div>
                <input value={ext} onChange={(e) => setExt(e.target.value)} placeholder="למשל: pdf, mp4, jpg" style={fsel} />
              </div>
              <div>
                <div style={flbl}>גודל (טווח)</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={sizeMin} onChange={(e) => setSizeMin(e.target.value)} placeholder="מ-" inputMode="decimal" style={{ ...fsel, width: 70 }} />
                  <input value={sizeMax} onChange={(e) => setSizeMax(e.target.value)} placeholder="עד" inputMode="decimal" style={{ ...fsel, width: 70 }} />
                  <select value={sizeUnit} onChange={(e) => setSizeUnit(Number(e.target.value))} style={{ ...fsel, width: 80 }}>
                    {SIZE_UNITS.map((u) => <option key={u.mult} value={u.mult}>{u.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={flbl}>נוסף בתאריך (טווח)</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ ...fsel, flex: 1 }} />
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ ...fsel, flex: 1 }} />
                </div>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#475569', marginTop: 12 }}>
              <input type="checkbox" checked={untagged} onChange={(e) => setUntagged(e.target.checked)} />
              הצג רק קבצים ללא תגית (מתעלם מבחירת התגיות למטה)
            </label>

            {fileTypes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={flbl}>סוג (אפשר לבחור כמה)</div>
                <div style={chipWrap}>
                  {fileTypes.map((m) => <button type="button" key={m} onClick={() => toggleMime(m)} style={chipBtn(mimeSel.has(m))}>{mimeLabel(m)}</button>)}
                </div>
              </div>
            )}

            {tagTreeFlat.length > 0 && !untagged && (
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <div>
                  <div style={flbl}>תגיות — לפחות אחת מ</div>
                  <div style={chipWrap}>
                    {tagTreeFlat.map((t) => <button type="button" key={t.id} onClick={() => toggleAny(t.id)} style={chipBtn(anyTags.has(t.id))}>{' '.repeat(t.depth) + t.name}</button>)}
                  </div>
                </div>
                <div>
                  <div style={flbl}>תגיות — להחריג</div>
                  <div style={chipWrap}>
                    {tagTreeFlat.map((t) => <button type="button" key={t.id} onClick={() => toggleEx(t.id)} style={chipBtnDanger(exTags.has(t.id))}>{' '.repeat(t.depth) + t.name}</button>)}
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={clearFilters} style={btn} disabled={activeFilters === 0}>נקה סינון</button>
            </div>
          </div>
        )}

        {result.items.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            {listLoading ? 'טוען…' : filtering ? 'אין תוצאות שתואמות את החיפוש/הסינון.' : canUpload ? 'אין עדיין קבצים — העלה את הראשון למעלה.' : 'אין עדיין קבצים.'}
          </p>
        ) : (
          <>
            {view === 'list' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', fontSize: 14 }}>
                    <th style={thSort} onClick={() => sortBy('name')}>שם{arrow('name')}</th>
                    <th style={thSort} onClick={() => sortBy('sizeBytes')}>גודל{arrow('sizeBytes')}</th>
                    <th style={th}>סוג</th>
                    <th style={th}>תיקייה</th>
                    <th style={th}>תגיות</th>
                    <th style={th}>מקור</th>
                    <th style={th}>גיבוי</th>
                    <th style={thSort} onClick={() => sortBy('createdAt')}>נוסף{arrow('createdAt')}</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((f) => (
                    <tr key={f.id} style={{ borderTop: '1px solid #eef2f7' }}>
                      <td style={td}><button onClick={() => openDetails(f)} style={linkBtn} title="תצוגה מקדימה ופרטים">📄 {f.name}</button></td>
                      <td style={td}>{humanSize(f.sizeBytes)}</td>
                      <td style={{ ...td, color: 'var(--muted)', fontSize: 13 }}>{f.mimeType ? mimeLabel(f.mimeType) : '—'}</td>
                      <td style={td}>{f.folderName ?? '—'}</td>
                      <td style={td}>{f.tags.map((t) => <span key={t.id} style={chip} title={t.path}>{t.path}</span>)}</td>
                      <td style={{ ...td, color: 'var(--muted)', fontSize: 13 }}>{f.source === 'import' ? 'ייבוא' : f.source === 'edit' ? 'עריכה' : 'העלאה'}</td>
                      <td style={td}>{backupBadge(f.backedUp)}</td>
                      <td style={{ ...td, color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>{humanDate(f.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{rowActions(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {view === 'tiles' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {result.items.map((f) => (
                  <div key={f.id} style={tileCard}>
                    <div style={{ fontWeight: 600, wordBreak: 'break-word' }}><button onClick={() => openDetails(f)} style={{ ...linkBtn, fontWeight: 600 }} title="תצוגה מקדימה ופרטים">{f.name}</button></div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>{f.mimeType ? mimeLabel(f.mimeType) : '—'} · {humanSize(f.sizeBytes)}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{f.source === 'import' ? 'ייבוא' : f.source === 'edit' ? 'עריכה' : 'העלאה'} · {humanDate(f.createdAt)}</div>
                    <div style={{ marginTop: 6 }}>{backupBadge(f.backedUp)}</div>
                    {f.tags.length > 0 && <div style={{ marginTop: 6 }}>{f.tags.map((t) => <span key={t.id} style={chip} title={t.path}>{t.path}</span>)}</div>}
                    <div style={{ marginTop: 8 }}>{rowActions(f)}</div>
                  </div>
                ))}
              </div>
            )}

            {view === 'timeline' && (
              <div>
                {groupByMonth(result.items).map((g) => (
                  <div key={g.key} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, color: 'var(--accent)', padding: '6px 0', borderBottom: '1px solid #e5e7eb', marginBottom: 4 }}>{g.label} · {g.items.length}</div>
                    {g.items.map((f) => (
                      <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #f3f4f6' }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <button onClick={() => openDetails(f)} style={linkBtn} title="תצוגה מקדימה ופרטים">📄 {f.name}</button> <span style={{ color: 'var(--muted)', fontSize: 12 }}>· {humanSize(f.sizeBytes)} · {f.mimeType ? mimeLabel(f.mimeType) : '—'}</span>
                        </span>
                        <span style={{ whiteSpace: 'nowrap' }}>{rowActions(f)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>מציג {from}–{to} מתוך {result.total}{listLoading ? ' · טוען…' : ''}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={result.page <= 1} style={pageBtn(result.page <= 1)}>הקודם</button>
                <span style={{ fontSize: 14, color: '#475569' }}>עמוד {result.page} מתוך {result.pages}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={result.page >= result.pages} style={pageBtn(result.page >= result.pages)}>הבא</button>
              </div>
            </div>
          </>
        )}
        {!canDownload && result.items.length > 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 0, marginTop: 10 }}>הורדת המקור דורשת הרשאה מפורשת.</p>
        )}
      </section>

      {selected && (
        <div onClick={closeDetails} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>📄 {selected.name}</h2>
              <button onClick={closeDetails} style={btn} aria-label="סגור">✕ סגור</button>
            </div>

            <div style={modalGrid}>
              {/* תצוגה מקדימה */}
              <div style={previewPane}>
                {previewState === 'loading' && <p style={{ color: 'var(--muted)' }}>טוען תצוגה מקדימה…</p>}
                {previewState === 'error' && <p style={{ color: '#b91c1c' }}>{previewMsg || 'שגיאה בתצוגה מקדימה'}</p>}
                {previewState === 'unsupported' && (
                  <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
                    <div style={{ fontSize: 40 }}>🗎</div>
                    <p>אין תצוגה מקדימה לסוג קובץ זה.</p>
                    {canDownload && <button onClick={() => onDownload(selected)} style={btn}>הורדת המקור</button>}
                  </div>
                )}
                {previewState === 'toobig' && (
                  <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
                    <p>הקובץ גדול ({humanSize(selected.sizeBytes)}) — לא נטען אוטומטית.</p>
                    <button onClick={() => loadPreview(selected)} style={btn}>טען תצוגה מקדימה בכל זאת</button>
                  </div>
                )}
                {previewState === 'ready' && previewUrl && (
                  <>
                    {previewType.startsWith('image/') && (
                      <img src={previewUrl} alt="תצוגה מקדימה" onLoad={(e) => setResolution(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} style={mediaStyle} />
                    )}
                    {previewType.startsWith('video/') && (
                      <video src={previewUrl} controls onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setResolution(`${v.videoWidth} × ${v.videoHeight}`); setDuration(fmtDuration(v.duration)); }} style={mediaStyle} />
                    )}
                    {previewType.startsWith('audio/') && (
                      <audio src={previewUrl} controls onLoadedMetadata={(e) => setDuration(fmtDuration(e.currentTarget.duration))} style={{ width: '100%' }} />
                    )}
                    {(previewType === 'application/pdf' || previewType.startsWith('text/')) && (
                      <iframe src={previewUrl} title="תצוגה מקדימה" style={{ width: '100%', height: '60vh', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
                    )}
                  </>
                )}
              </div>

              {/* פרטי-על */}
              <div style={metaPane}>
                <h3 style={{ marginTop: 0, fontSize: 15, color: 'var(--accent)' }}>פרטים טכניים</h3>
                {detailsLoading && <p style={{ color: 'var(--muted)' }}>טוען…</p>}
                {previewMsg && !details && <p style={{ color: '#b91c1c', fontSize: 14 }}>{previewMsg}</p>}
                {details && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, tableLayout: 'fixed' }}>
                    <tbody>
                      <MetaRow k="סוג" v={details.mimeType ? mimeLabel(details.mimeType) : '—'} />
                      <MetaRow k="גודל" v={`${humanSize(details.sizeBytes)} (${details.sizeBytes.toLocaleString('he-IL')} בייט)`} />
                      {resolution && <MetaRow k="רזולוציה" v={`${resolution} פיקסל`} />}
                      {duration && <MetaRow k="משך" v={duration} />}
                      <MetaRow k="תיקייה" v={details.folderName ?? '— (שורש)'} />
                      <MetaRow k="מקור" v={details.source === 'import' ? 'ייבוא מדיסק' : 'העלאה ידנית'} />
                      <MetaRow k="מי העלה" v={details.uploadedBy ? details.uploadedBy.name : '—'} />
                      <MetaRow k="נוסף" v={humanDateTime(details.createdAt)} />
                      <MetaRow k="עודכן" v={humanDateTime(details.updatedAt)} />
                      <MetaRow k="גיבוי פיזי" v={details.backedUp ? 'מגובה' : 'לא מגובה'} />
                      <MetaRow k="עותקים תוכן-זהה" v={String(details.duplicateCount)} />
                      <tr style={{ borderTop: '1px solid #eef2f7' }}>
                        <td style={metaK}>חתימת Hash</td>
                        <td style={metaV}>
                          <code style={{ fontSize: 11, wordBreak: 'break-all', direction: 'ltr', display: 'inline-block' }}>{details.hash}</code>
                          <button onClick={() => copyHash(details.hash)} style={{ ...smallBtn, marginInlineStart: 6 }}>{copied ? '✓ הועתק' : 'העתק'}</button>
                        </td>
                      </tr>
                      {details.tags.length > 0 && (
                        <tr style={{ borderTop: '1px solid #eef2f7' }}>
                          <td style={metaK}>תגיות</td>
                          <td style={metaV}>{details.tags.map((t) => <span key={t.id} style={chip} title={t.path}>{t.path}</span>)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
                <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {isProtectedViewable(selected.mimeType) && <button onClick={() => { setProtectedFile(selected); }} style={btn}>צפייה מוגנת</button>}
                  {canDownload && <button onClick={() => onDownload(selected)} style={btn}>הורדת המקור</button>}
                  {canViewLogs && <button onClick={() => setLogFile(selected)} style={btn}>פעילות</button>}
                  {canViewLogs && <button onClick={() => setViewLogFile(selected)} style={btn}>לוג צפיות</button>}
                  {canManageSecurity && <button onClick={() => setRestrictFile(selected)} style={btn}>הגבלת גישה</button>}
                  {canManageLinks && <button onClick={() => setShareFile(selected)} style={btn}>קישור צפייה</button>}
                  {canManageWatermark && <button onClick={() => setWmFile(selected)} style={btn}>סימן מים</button>}
                  {canEditMedia && isImageEditable(selected.mimeType) && <button onClick={() => setEditFile(selected)} style={btn}>עריכה</button>}
                  {canDelete && <button onClick={() => { onDelete(selected); closeDetails(); }} style={smallDanger}>מחיקה</button>}
                </div>
                {!canDownload && <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 0, marginTop: 8 }}>צפייה בלבד — הורדת המקור דורשת הרשאה.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
      {logFile && <ActivityLog title={`קובץ: ${logFile.name}`} filter={{ targetType: 'file', targetId: logFile.id }} onClose={() => setLogFile(null)} />}
      {viewLogFile && <ViewLog title={`קובץ: ${viewLogFile.name}`} filter={{ fileId: viewLogFile.id }} onClose={() => setViewLogFile(null)} />}
      {protectedFile && <ProtectedViewer file={protectedFile} onClose={() => setProtectedFile(null)} />}
      {restrictFile && <RestrictionsManager file={restrictFile} onClose={() => setRestrictFile(null)} />}
      {shareFile && <ShareManager file={shareFile} onClose={() => setShareFile(null)} />}
      {wmFile && <FileWatermark file={wmFile} onClose={() => setWmFile(null)} />}
      {editFile && <ImageEditor file={editFile} onClose={() => setEditFile(null)} onSaved={() => reload()} />}
    </main>
  );
}

const card: CSSProperties = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 16 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const smallBtn: CSSProperties = { padding: '5px 10px', marginInlineEnd: 6, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const smallDanger: CSSProperties = { padding: '5px 10px', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const sel: CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', marginInlineStart: 6 };
const fsel: CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', width: '100%', boxSizing: 'border-box' };
const flbl: CSSProperties = { fontSize: 13, color: '#475569', marginBottom: 4, fontWeight: 600 };
const lbl: CSSProperties = { fontSize: 14, color: '#475569' };
const th: CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const thSort: CSSProperties = { padding: '8px 6px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' };
const td: CSSProperties = { padding: '10px 6px', verticalAlign: 'middle' };
const chip: CSSProperties = { background: '#f1f5f9', padding: '2px 8px', borderRadius: 999, fontSize: 12, marginInlineEnd: 4 };
const chipWrap: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', maxHeight: 120, overflowY: 'auto' };
const chipBtn = (on: boolean): CSSProperties => ({ padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 13, border: on ? '1px solid var(--accent)' : '1px solid #cbd5e1', background: on ? 'var(--accent)' : '#fff', color: on ? '#fff' : '#334155', whiteSpace: 'pre' });
const chipBtnDanger = (on: boolean): CSSProperties => ({ padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 13, border: on ? '1px solid #b91c1c' : '1px solid #cbd5e1', background: on ? '#b91c1c' : '#fff', color: on ? '#fff' : '#334155', whiteSpace: 'pre' });
const qvBtn: CSSProperties = { padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, border: '1px solid #cbd5e1', background: '#fff', color: '#334155' };
const qvSoon: CSSProperties = { padding: '5px 12px', borderRadius: 999, fontSize: 13, border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' };
const tileCard: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'flex', flexDirection: 'column' };
const pageBtn = (disabled: boolean): CSSProperties => ({ padding: '6px 14px', background: disabled ? '#f1f5f9' : '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', color: disabled ? '#94a3b8' : '#334155' });

const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, margin: 0, color: 'var(--accent)', cursor: 'pointer', font: 'inherit', textAlign: 'right' };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 50, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(960px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 24, marginBottom: 24 };
const modalGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' };
const previewPane: CSSProperties = { minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 10, padding: 12, minWidth: 0 };
const metaPane: CSSProperties = { minWidth: 0 };
const mediaStyle: CSSProperties = { maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8 };
const metaK: CSSProperties = { padding: '7px 6px', color: 'var(--muted)', verticalAlign: 'top', whiteSpace: 'nowrap', width: 120 };
const metaV: CSSProperties = { padding: '7px 6px', wordBreak: 'break-word' };
