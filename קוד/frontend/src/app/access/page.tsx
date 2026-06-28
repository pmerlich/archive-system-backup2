'use client';
// access/page.tsx — הרשאות גישה גמישות לפי תיקיות/תגיות (שלב 3.9). דורש security.manage.
// כלל "הענקה" נותן למשתמשים מסוימים גישת צפייה לטווח; כלל "הגבלה" נועל טווח (לכולם או למשתמשים מסוימים) עם תנאי.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe, getToken, hasPermission, listAccessRules, getAccessMeta, createAccessRule, revokeAccessRule, setUserScopedView,
  listFolders, listTags, listFileTypes,
  type AuthUser, type AccessRule, type AccessMeta, type FolderNode, type Tag,
} from '@/lib/api';

type Flat = { id: string; name: string; depth: number };
function flattenFolders(nodes: FolderNode[], depth = 0): Flat[] { const out: Flat[] = []; for (const n of nodes) { out.push({ id: n.id, name: n.name, depth }); if (n.children?.length) out.push(...flattenFolders(n.children, depth + 1)); } return out; }
function dt(s: string | null): string { if (!s) return '—'; try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } }
const SENS: { v: string; t: string }[] = [{ v: 'NONE', t: 'ללא' }, { v: 'LOW', t: 'נמוכה' }, { v: 'MEDIUM', t: 'בינונית' }, { v: 'HIGH', t: 'גבוהה' }];
function mimeLabel(m: string): string { if (m === 'application/pdf') return 'PDF'; if (m === 'text/plain') return 'טקסט'; if (m.startsWith('image/')) return 'תמונה ' + m.split('/')[1]; if (m.startsWith('video/')) return 'וידאו ' + m.split('/')[1]; if (m.startsWith('audio/')) return 'שמע ' + m.split('/')[1]; return m; }
const STATE_BADGE: Record<string, { t: string; c: string; bg: string }> = { active: { t: 'פעיל', c: '#166534', bg: '#dcfce7' }, revoked: { t: 'בוטל', c: '#b91c1c', bg: '#fee2e2' }, expired: { t: 'פג', c: '#475569', bg: '#e2e8f0' } };

export default function AccessPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rules, setRules] = useState<AccessRule[]>([]);
  const [meta, setMeta] = useState<AccessMeta | null>(null);
  const [folders, setFolders] = useState<Flat[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [type, setType] = useState<'grant' | 'restrict'>('grant');
  const [label, setLabel] = useState('');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [mimeTypes, setMimeTypes] = useState<string[]>([]);
  const [sensitivities, setSensitivities] = useState<string[]>([]);
  const [includeSub, setIncludeSub] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [expiresLocal, setExpiresLocal] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe().then((u: AuthUser) => {
      if (!hasPermission(u, 'security.manage')) { router.replace('/'); return; }
      setReady(true); reload();
      getAccessMeta().then(setMeta).catch(() => undefined);
      listFolders().then((f) => setFolders(flattenFolders(f))).catch(() => undefined);
      listTags().then(setTags).catch(() => undefined);
      listFileTypes().then(setTypes).catch(() => undefined);
    }).catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() { try { setRules(await listAccessRules()); } catch (e: any) { setErr(e.message || 'שגיאה'); } }
  function tgl(set: React.Dispatch<React.SetStateAction<string[]>>, id: string) { set((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id]); }
  function resetForm() { setType('grant'); setLabel(''); setUserIds([]); setFolderIds([]); setTagIds([]); setMimeTypes([]); setSensitivities([]); setIncludeSub(true); setDeviceId(''); setExpiresLocal(''); setNote(''); }

  async function onCreate() {
    setErr('');
    if (type === 'grant' && userIds.length === 0) { setErr('כלל הענקה חייב לכוון לפחות למשתמש אחד'); return; }
    if (folderIds.length === 0 && tagIds.length === 0 && mimeTypes.length === 0 && sensitivities.length === 0) { setErr('יש לבחור טווח: תיקיות / תגיות / סוג / רגישות'); return; }
    setSaving(true);
    try {
      await createAccessRule({ type, label: label || undefined, userIds, folderIds, tagIds, mimeTypes, sensitivities, includeSubfolders: includeSub, includeSubtags: includeSub, deviceId: deviceId || null, expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : null, note: note || undefined });
      resetForm(); setShowForm(false); await reload();
    } catch (e: any) { setErr(e.message || 'שגיאה ביצירת הכלל'); } finally { setSaving(false); }
  }
  async function onRevoke(id: string) { if (!window.confirm('לבטל את הכלל? הביטול מיידי.')) return; try { await revokeAccessRule(id); await reload(); } catch (e: any) { setErr(e.message); } }
  async function onToggleScoped(uid: string, val: boolean) { try { await setUserScopedView(uid, val); setMeta((m) => m ? { ...m, users: m.users.map((u) => u.id === uid ? { ...u, scopedView: val } : u) } : m); } catch (e: any) { setErr(e.message); } }

  if (!ready) return <main style={{ maxWidth: 980, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;

  function scopeText(r: AccessRule): string {
    const c: string[] = [];
    if (r.folderNames.length) c.push('תיקיות: ' + r.folderNames.join(', '));
    if (r.tagNames.length) c.push('תגיות: ' + r.tagNames.join(', '));
    if (r.fileCount) c.push(`${r.fileCount} קבצים`);
    if (r.mimeTypes.length) c.push('סוגים: ' + r.mimeTypes.map(mimeLabel).join(', '));
    if (r.sensitivities.length) c.push('רגישות: ' + r.sensitivities.map((s) => SENS.find((x) => x.v === s)?.t ?? s).join(', '));
    return c.join(' · ') || 'כל הקבצים';
  }

  return (
    <main style={{ maxWidth: 980, margin: '24px auto', padding: 24 }} dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>הרשאות גישה</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { resetForm(); setShowForm((v) => !v); }} style={primary}>{showForm ? 'סגור טופס' : '+ כלל חדש'}</button>
          <button onClick={() => router.push('/')} style={btn}>← חזרה</button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>
        <strong>הענקה</strong> = לתת לאנשים מסוימים גישת צפייה לתיקיות/תגיות נבחרות. <strong>הגבלה</strong> = לנעול טווח (לכולם או למשתמשים מסוימים) — עם תנאי מכשיר/זמן, או חסימה מלאה. כלל יכול לכלול כמה תיקיות ותגיות יחד. הבעלים תמיד רואה הכול.
      </p>
      {err && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: '8px 10px', borderRadius: 8 }}>{err}</p>}

      {/* טופס יצירה */}
      {showForm && (
        <div style={{ ...card, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <label style={chk}><input type="radio" checked={type === 'grant'} onChange={() => setType('grant')} /> הענקת גישה</label>
            <label style={chk}><input type="radio" checked={type === 'restrict'} onChange={() => setType('restrict')} /> הגבלת גישה</label>
          </div>
          <div style={grid}>
            <label style={lbl}>שם לזיהוי (לא חובה)<input value={label} onChange={(e) => setLabel(e.target.value)} style={inp} /></label>
            <label style={lbl}>נעילה למכשיר (תנאי, לא חובה)
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={inp}><option value="">ללא</option>{meta?.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.name}{d.user ? ` · ${d.user.email}` : ''}</option>)}</select>
            </label>
            <label style={lbl}>תפוגה (תנאי, לא חובה)<input type="datetime-local" value={expiresLocal} onChange={(e) => setExpiresLocal(e.target.value)} style={inp} /></label>
          </div>
          <Picker label={type === 'grant' ? 'למי להעניק? (חובה)' : 'על מי חל? (ריק = כולם)'} items={(meta?.users || []).map((u) => ({ id: u.id, label: `${u.name} (${u.email})` }))} sel={userIds} onToggle={(id) => tgl(setUserIds, id)} />
          <div style={{ borderTop: '1px solid #eef2f7', marginTop: 8, paddingTop: 8, fontWeight: 600 }}>טווח (אילו קבצים)</div>
          <Picker label="תיקיות" items={folders.map((f) => ({ id: f.id, label: '· '.repeat(f.depth) + f.name }))} sel={folderIds} onToggle={(id) => tgl(setFolderIds, id)} />
          <Picker label="תגיות" items={tags.map((t) => ({ id: t.id, label: t.path ?? t.name }))} sel={tagIds} onToggle={(id) => tgl(setTagIds, id)} />
          <Picker label="סוגי קובץ" items={types.map((m) => ({ id: m, label: mimeLabel(m) }))} sel={mimeTypes} onToggle={(id) => tgl(setMimeTypes, id)} />
          <Picker label="רמת רגישות" items={SENS.map((s) => ({ id: s.v, label: s.t }))} sel={sensitivities} onToggle={(id) => tgl(setSensitivities, id)} />
          <label style={chk}><input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} /> כולל תת-תיקיות ותת-תגיות</label>
          <label style={{ ...lbl, marginTop: 8 }}>הערה (לא חובה)<input value={note} onChange={(e) => setNote(e.target.value)} style={inp} /></label>
          <div style={{ marginTop: 10 }}><button onClick={onCreate} disabled={saving} style={{ ...primary, opacity: saving ? 0.6 : 1 }}>{saving ? 'יוצר…' : 'צור כלל'}</button></div>
        </div>
      )}

      {/* רשימת כללים */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {rules.length === 0 && <p style={{ color: 'var(--muted)' }}>עדיין אין כללי הרשאה.</p>}
        {rules.map((r) => { const b = STATE_BADGE[r.state]; const grant = r.type === 'grant'; return (
          <div key={r.id} style={{ ...card, borderColor: grant ? '#bbf7d0' : '#fecaca' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, minWidth: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  <span style={{ background: grant ? '#dcfce7' : '#fee2e2', color: grant ? '#166534' : '#b91c1c', borderRadius: 6, padding: '1px 8px', fontSize: 12 }}>{grant ? 'הענקה' : 'הגבלה'}</span>
                  {r.label && <span style={{ marginInlineStart: 8 }}>{r.label}</span>}
                  <span style={{ background: b.bg, color: b.c, borderRadius: 6, padding: '1px 8px', fontSize: 12, marginInlineStart: 6 }}>{b.t}</span>
                </div>
                <div>👥 {r.users.length ? r.users.map((u) => u.name).join(', ') : (grant ? '—' : 'כל המשתמשים')}</div>
                <div style={{ color: 'var(--muted)' }}>📂 {scopeText(r)}</div>
                {(r.deviceId || r.expiresAt) && <div style={{ color: 'var(--muted)' }}>🔒 {r.deviceId ? 'מכשיר מסוים' : ''}{r.deviceId && r.expiresAt ? ' · ' : ''}{r.expiresAt ? `עד ${dt(r.expiresAt)}` : ''}</div>}
                {!grant && !r.deviceId && !r.expiresAt && <div style={{ color: '#b91c1c' }}>⛔ חסימה מלאה</div>}
                {r.note && <div style={{ color: 'var(--muted)' }}>📝 {r.note}</div>}
              </div>
              {r.state === 'active' && <button onClick={() => onRevoke(r.id)} style={danger}>ביטול</button>}
            </div>
          </div>
        ); })}
      </div>

      {/* משתמשים מוגבלי-טווח */}
      <div style={{ ...card, marginTop: 18 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>משתמשים בצפייה מוגבלת</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>משתמש ב"צפייה מוגבלת" רואה <strong>רק</strong> את מה שהוענק לו במפורש (תיקיות/תגיות). משתמש רגיל רואה הכול (לפי תפקידו).</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(meta?.users || []).map((u) => (
            <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={u.scopedView} onChange={(e) => onToggleScoped(u.id, e.target.checked)} />
              {u.name} <span style={{ color: 'var(--muted)' }}>({u.email})</span>{u.scopedView && <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '1px 8px', fontSize: 12 }}>מוגבל-טווח</span>}
            </label>
          ))}
        </div>
      </div>
    </main>
  );
}

function Picker({ label, items, sel, onToggle }: { label: string; items: { id: string; label: string }[]; sel: string[]; onToggle: (id: string) => void }) {
  if (items.length === 0) return null;
  const set = new Set(sel);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>{label}{sel.length ? ` (${sel.length})` : ''}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflowY: 'auto' }}>
        {items.map((it) => <button type="button" key={it.id} onClick={() => onToggle(it.id)} style={chip(set.has(it.id))}>{it.label}</button>)}
      </div>
    </div>
  );
}

const card: CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 6 };
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155' };
const chk: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#334155' };
const inp: CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primary: CSSProperties = { padding: '9px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const danger: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, cursor: 'pointer', height: 'fit-content' };
const chip = (on: boolean): CSSProperties => ({ padding: '4px 10px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--accent)' : '#cbd5e1'), background: on ? 'var(--accent)' : '#fff', color: on ? '#fff' : '#334155', cursor: 'pointer', fontSize: 13 });
