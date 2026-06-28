'use client';
// folders/page.tsx — מסך ניהול תיקיות (מוגן).
// צפייה: דורש הרשאת "צפייה בקבצים". יצירה/שינוי שם/העברה: "ניהול תיקיות". מחיקה/שחזור: הרשאות מתאימות.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe,
  getToken,
  logout,
  hasPermission,
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  listFolderTrash,
  restoreFolder,
  type AuthUser,
  type FolderNode,
  type DeletedFolder,
} from '@/lib/api';
import ActivityLog from '@/components/ActivityLog';

// שיטוח העץ לרשימה עם עומק (לבחירת תיקיית אב).
function flatten(nodes: FolderNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

// קבוצת המזהים של תיקייה + כל צאצאיה (יעדים אסורים להעברה).
function descendantSet(node: FolderNode): Set<string> {
  const s = new Set<string>([node.id]);
  for (const c of node.children ?? []) for (const id of descendantSet(c)) s.add(id);
  return s;
}

export default function FoldersPage() {
  const router = useRouter();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [trash, setTrash] = useState<DeletedFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [msg, setMsg] = useState('');
  const [logFolder, setLogFolder] = useState<{ id: string; name: string } | null>(null);

  const canManage = hasPermission(me, 'folders.manage');
  const canDelete = hasPermission(me, 'files.delete');
  const canRestore = hasPermission(me, 'files.restore');
  const canViewLogs = hasPermission(me, 'logs.view');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    getMe()
      .then(async (u) => {
        setMe(u);
        if (!hasPermission(u, 'files.view')) {
          setDenied(true);
          return;
        }
        setTree(await listFolders());
        if (hasPermission(u, 'files.restore')) {
          try { setTrash(await listFolderTrash()); } catch { /* אין הרשאה/אין סל */ }
        }
      })
      .catch(() => { logout(); router.replace('/login'); })
      .finally(() => setLoading(false));
  }, [router]);

  async function reload(): Promise<void> {
    setTree(await listFolders());
    if (canRestore) { try { setTrash(await listFolderTrash()); } catch { /* */ } }
  }

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await createFolder(newName.trim(), newParent || null);
      setNewName('');
      setMsg('✓ התיקייה נוצרה');
      await reload();
    } catch (err: any) { setMsg(err.message || 'שגיאה'); }
  }

  async function onRename(id: string, current: string): Promise<void> {
    const name = window.prompt('שם חדש לתיקייה:', current);
    if (name == null || !name.trim()) return;
    try { await updateFolder(id, { name: name.trim() }); await reload(); }
    catch (err: any) { window.alert(err.message || 'שגיאה'); }
  }

  async function onMove(id: string, parentId: string | null): Promise<void> {
    try { await updateFolder(id, { parentId }); await reload(); }
    catch (err: any) { window.alert(err.message || 'שגיאה'); await reload(); }
  }

  async function onDelete(id: string, name: string): Promise<void> {
    if (!window.confirm(`למחוק את התיקייה "${name}"? אפשר לשחזר מסל המחזור.`)) return;
    try { await deleteFolder(id); await reload(); }
    catch (err: any) { window.alert(err.message || 'שגיאה'); }
  }

  async function onRestore(id: string): Promise<void> {
    try { await restoreFolder(id); await reload(); }
    catch (err: any) { window.alert(err.message || 'שגיאה'); }
  }

  if (loading) {
    return <main style={{ maxWidth: 880, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;
  }
  if (denied) {
    return (
      <main style={{ maxWidth: 880, margin: '40px auto', padding: 24 }}>
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
          <p style={{ color: 'var(--muted)' }}>אין לך הרשאת צפייה בתיקיות.</p>
          <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
        </section>
      </main>
    );
  }

  const flat = flatten(tree);

  function renderRows(nodes: FolderNode[], depth: number): ReactNode[] {
    return nodes.flatMap((node) => {
      const invalid = descendantSet(node);
      const moveTargets = flat.filter((f) => !invalid.has(f.id));
      const row = (
        <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #f1f5f9' }}>
          <span style={{ flex: 1, paddingInlineStart: depth * 22 }}>📁 {node.name}</span>
          {canManage && (
            <select value={node.parentId ?? ''} onChange={(e) => onMove(node.id, e.target.value || null)} style={sel} title="העברה לתיקיית אב">
              <option value="">(שורש)</option>
              {moveTargets.map((f) => (
                <option key={f.id} value={f.id}>{' '.repeat(f.depth * 2) + f.name}</option>
              ))}
            </select>
          )}
          {canManage && <button onClick={() => onRename(node.id, node.name)} style={smallBtn}>שם</button>}
          {canDelete && <button onClick={() => onDelete(node.id, node.name)} style={smallDanger}>מחיקה</button>}
          {canViewLogs && <button onClick={() => setLogFolder({ id: node.id, name: node.name })} style={smallBtn}>פעילות</button>}
        </div>
      );
      return [row, ...renderRows(node.children ?? [], depth + 1)];
    });
  }

  return (
    <main style={{ maxWidth: 880, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: 'var(--accent)', marginBottom: 4 }}>תיקיות</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>המבנה הלוגי של הארכיון</p>
        </div>
        <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
      </div>

      {canManage && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>תיקייה חדשה</h2>
          <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם התיקייה"
              style={{ flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }}
            />
            <select value={newParent} onChange={(e) => setNewParent(e.target.value)} style={sel}>
              <option value="">בתוך: (שורש)</option>
              {flat.map((f) => (
                <option key={f.id} value={f.id}>{'בתוך: ' + ' '.repeat(f.depth * 2) + f.name}</option>
              ))}
            </select>
            <button type="submit" style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>צור</button>
          </form>
          {msg && <p style={{ marginBottom: 0, color: msg.startsWith('✓') ? '#15803d' : '#b91c1c', fontSize: 14 }}>{msg}</p>}
        </section>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>עץ התיקיות</h2>
        {tree.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>אין עדיין תיקיות{canManage ? ' — צור את הראשונה למעלה.' : '.'}</p>
        ) : (
          <div>{renderRows(tree, 0)}</div>
        )}
      </section>

      {canRestore && trash.length > 0 && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>סל המחזור</h2>
          {trash.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #f1f5f9' }}>
              <span style={{ flex: 1, color: 'var(--muted)' }}>🗑 {d.name}</span>
              <button onClick={() => onRestore(d.id)} style={smallBtn}>שחזור</button>
            </div>
          ))}
        </section>
      )}
      {logFolder && <ActivityLog title={`תיקייה: ${logFolder.name}`} filter={{ targetType: 'folder', targetId: logFolder.id }} onClose={() => setLogFolder(null)} />}
    </main>
  );
}

const card: CSSProperties = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 16 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const smallBtn: CSSProperties = { padding: '5px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const smallDanger: CSSProperties = { padding: '5px 10px', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const sel: CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', maxWidth: 220 };
