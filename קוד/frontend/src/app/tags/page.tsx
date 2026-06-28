'use client';
// tags/page.tsx — מסך ניהול תגיות היררכיות (מוגן): עץ תגיות עם תת-תגיות ללא הגבלת עומק.
// צפייה דורשת "צפייה בקבצים"; יצירה/עריכה/העברה/מחיקה דורשות הרשאת "תגיות".
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe, getToken, logout, hasPermission,
  listTagsTree, getTagMeta, createTag, updateTag, deleteTag,
  type AuthUser, type TagNode, type TagOption,
} from '@/lib/api';

const SENS_COLOR: Record<string, string> = {
  NONE: '#f1f5f9', LOW: '#dcfce7', MEDIUM: '#fef9c3', HIGH: '#fee2e2',
};

// שיטוח העץ לרשימה עם עומק (לבחירת אב).
function flatten(nodes: TagNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}
// תגית + כל צאצאיה (יעדים אסורים להעברה).
function descendantSet(node: TagNode): Set<string> {
  const s = new Set<string>([node.id]);
  for (const c of node.children ?? []) for (const id of descendantSet(c)) s.add(id);
  return s;
}

export default function TagsPage() {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [tree, setTree] = useState<TagNode[]>([]);
  const [types, setTypes] = useState<TagOption[]>([]);
  const [sensitivities, setSensitivities] = useState<TagOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [type, setType] = useState('regular');
  const [sensitivity, setSensitivity] = useState('NONE');
  const [msg, setMsg] = useState('');

  const canManage = hasPermission(me, 'files.tag');

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe()
      .then(async (u) => {
        setMe(u);
        if (!hasPermission(u, 'files.view')) { setDenied(true); return; }
        const meta = await getTagMeta();
        setTypes(meta.types); setSensitivities(meta.sensitivities);
        setTree(await listTagsTree());
      })
      .catch(() => { logout(); router.replace('/login'); })
      .finally(() => setLoading(false));
  }, [router]);

  const labelOf = (opts: TagOption[], key: string) => opts.find((o) => o.key === key)?.label ?? key;
  async function reload(): Promise<void> { setTree(await listTagsTree()); }

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createTag({ name: name.trim(), parentId: parent || null, type, sensitivity });
      setName(''); setMsg('✓ התגית נוצרה');
      await reload();
    } catch (err: any) { setMsg(err.message || 'שגיאה'); }
  }
  async function onField(id: string, data: { type?: string; sensitivity?: string }): Promise<void> {
    try { await updateTag(id, data); await reload(); } catch (err: any) { window.alert(err.message || 'שגיאה'); await reload(); }
  }
  async function onMove(id: string, parentId: string | null): Promise<void> {
    try { await updateTag(id, { parentId }); await reload(); } catch (err: any) { window.alert(err.message || 'שגיאה'); await reload(); }
  }
  async function onRename(n: TagNode): Promise<void> {
    const v = window.prompt('שם חדש לתגית:', n.name);
    if (v == null || !v.trim()) return;
    try { await updateTag(n.id, { name: v.trim() }); await reload(); } catch (err: any) { window.alert(err.message || 'שגיאה'); }
  }
  async function onDelete(n: TagNode): Promise<void> {
    if (!window.confirm(`למחוק את התגית "${n.name}"?`)) return;
    try { await deleteTag(n.id); await reload(); } catch (err: any) { window.alert(err.message || 'שגיאה'); }
  }
  function addSubTo(n: TagNode): void {
    setParent(n.id); setMsg(`התגית החדשה תיווצר תחת "${n.name}"`);
    nameRef.current?.focus();
  }

  if (loading) return <main style={{ maxWidth: 980, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;
  if (denied) {
    return (
      <main style={{ maxWidth: 980, margin: '40px auto', padding: 24 }}>
        <section style={card}><h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
          <p style={{ color: 'var(--muted)' }}>אין לך הרשאת צפייה בתגיות.</p>
          <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
        </section>
      </main>
    );
  }

  const flat = flatten(tree);

  function renderRows(nodes: TagNode[], depth: number): ReactNode[] {
    return nodes.flatMap((node) => {
      const invalid = descendantSet(node);
      const moveTargets = flat.filter((f) => !invalid.has(f.id));
      const row = (
        <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 160, paddingInlineStart: depth * 22 }}>
            🏷️ <span style={{ background: SENS_COLOR[node.sensitivity] ?? '#f1f5f9', padding: '2px 10px', borderRadius: 999 }}>{node.name}</span>
            {node.usage > 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {node.usage} קבצים</span>}
          </span>
          {canManage ? (
            <>
              <select value={node.type} onChange={(e) => onField(node.id, { type: e.target.value })} style={sel} title="סוג">
                {types.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <select value={node.sensitivity} onChange={(e) => onField(node.id, { sensitivity: e.target.value })} style={sel} title="רגישות">
                {sensitivities.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <select value={node.parentId ?? ''} onChange={(e) => onMove(node.id, e.target.value || null)} style={sel} title="תגית-אב">
                <option value="">(שורש)</option>
                {moveTargets.map((f) => <option key={f.id} value={f.id}>{' '.repeat(f.depth * 2) + f.name}</option>)}
              </select>
              <button onClick={() => addSubTo(node)} style={smallBtn}>＋ תת-תגית</button>
              <button onClick={() => onRename(node)} style={smallBtn}>שם</button>
              <button onClick={() => onDelete(node)} style={smallDanger}>מחיקה</button>
            </>
          ) : (
            <span style={{ color: '#475569', fontSize: 13 }}>{labelOf(types, node.type)} · {labelOf(sensitivities, node.sensitivity)}</span>
          )}
        </div>
      );
      return [row, ...renderRows(node.children ?? [], depth + 1)];
    });
  }

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: 'var(--accent)', marginBottom: 4 }}>תגיות</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>עץ תגיות היררכי — ללא הגבלת עומק</p>
        </div>
        <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
      </div>

      {canManage && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>תגית חדשה</h2>
          <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="שם התגית"
              style={{ flex: 1, minWidth: 150, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }} />
            <select value={parent} onChange={(e) => setParent(e.target.value)} style={sel} title="תחת תגית-אב">
              <option value="">תחת: (שורש)</option>
              {flat.map((f) => <option key={f.id} value={f.id}>{'תחת: ' + ' '.repeat(f.depth * 2) + f.name}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} style={sel} title="סוג">
              {types.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value)} style={sel} title="רגישות">
              {sensitivities.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <button type="submit" style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>צור</button>
          </form>
          {msg && <p style={{ marginBottom: 0, color: msg.startsWith('✓') ? '#15803d' : '#475569', fontSize: 14 }}>{msg}</p>}
        </section>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>עץ התגיות</h2>
        {tree.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>אין עדיין תגיות{canManage ? ' — צור את הראשונה למעלה.' : '.'}</p>
        ) : (
          <div>{renderRows(tree, 0)}</div>
        )}
      </section>
    </main>
  );
}

const card: CSSProperties = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 16 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const smallBtn: CSSProperties = { padding: '5px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const smallDanger: CSSProperties = { padding: '5px 10px', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const sel: CSSProperties = { padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff' };
