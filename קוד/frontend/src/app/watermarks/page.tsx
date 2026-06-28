'use client';
// watermarks/page.tsx — ניהול סימני מים גמישים (שלב 3.8). דורש watermark.create.
// כמה תבניות פעילות יחד (שכבות), טקסט או לוגו, עיצוב מלא, וטווח-החלה לפי תיקיות/תגיות/סוג/רגישות.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe, getToken, hasPermission, listWatermarks, createWatermark, updateWatermark,
  enableWatermark, disableWatermark, uploadWatermarkLogo, deleteWatermark,
  listFolders, listTags, listFileTypes,
  type AuthUser, type WatermarkTemplate, type FolderNode, type Tag,
} from '@/lib/api';

type Flat = { id: string; name: string; depth: number };
function flattenFolders(nodes: FolderNode[], depth = 0): Flat[] {
  const out: Flat[] = [];
  for (const n of nodes) { out.push({ id: n.id, name: n.name, depth }); if (n.children?.length) out.push(...flattenFolders(n.children, depth + 1)); }
  return out;
}
const POS: { v: string; t: string }[] = [
  { v: 'tiled', t: 'פרוס על המסך' }, { v: 'center', t: 'מרכז' },
  { v: 'top-left', t: 'שמאל עליון' }, { v: 'top-right', t: 'ימין עליון' },
  { v: 'bottom-left', t: 'שמאל תחתון' }, { v: 'bottom-right', t: 'ימין תחתון' },
];
const SENS: { v: string; t: string }[] = [{ v: 'NONE', t: 'ללא' }, { v: 'LOW', t: 'נמוכה' }, { v: 'MEDIUM', t: 'בינונית' }, { v: 'HIGH', t: 'גבוהה' }];
function mimeLabel(m: string): string { const map: Record<string, string> = { 'application/pdf': 'PDF', 'text/plain': 'טקסט' }; if (map[m]) return map[m]; if (m.startsWith('image/')) return 'תמונה ' + m.split('/')[1]; if (m.startsWith('video/')) return 'וידאו ' + m.split('/')[1]; if (m.startsWith('audio/')) return 'שמע ' + m.split('/')[1]; return m; }

type Form = Partial<WatermarkTemplate> & { folderIds: string[]; tagIds: string[]; mimeTypes: string[]; sensitivities: string[] };
const blank = (): Form => ({ name: '', kind: 'text', text: '{email} · {datetime}', fontSize: 28, color: '#ffffff', opacity: 0.3, position: 'tiled', angle: 30, outline: false, motion: false, priority: 0, imageScale: 0.25, tileGap: 28, motionAxis: 'x', motionDir: 1, motionSpeed: 120, blink: false, blinkInterval: 5, blinkOn: 1.5, enabled: true, folderIds: [], tagIds: [], mimeTypes: [], sensitivities: [], includeSubfolders: true, includeSubtags: true });

export default function WatermarksPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<WatermarkTemplate[]>([]);
  const [folders, setFolders] = useState<Flat[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [editing, setEditing] = useState<Form | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe().then((u: AuthUser) => { if (!hasPermission(u, 'watermark.create')) { router.replace('/'); return; } setReady(true); reload();
      listFolders().then((f) => setFolders(flattenFolders(f))).catch(() => undefined);
      listTags().then(setTags).catch(() => undefined);
      listFileTypes().then(setTypes).catch(() => undefined);
    }).catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() { try { setRows(await listWatermarks()); } catch (e: any) { setErr(e.message || 'שגיאה'); } }
  function startNew() { setLogoFile(null); setEditing(blank()); }
  function startEdit(t: WatermarkTemplate) { setLogoFile(null); setEditing({ ...t }); }
  function setF<K extends keyof Form>(k: K, v: Form[K]) { setEditing((e) => e ? { ...e, [k]: v } : e); }
  function toggle(k: 'folderIds' | 'tagIds' | 'mimeTypes' | 'sensitivities', id: string) {
    setEditing((e) => { if (!e) return e; const set = new Set(e[k]); set.has(id) ? set.delete(id) : set.add(id); return { ...e, [k]: [...set] }; });
  }

  async function onToggleEnabled(t: WatermarkTemplate) {
    try { t.enabled ? await disableWatermark(t.id) : await enableWatermark(t.id); await reload(); } catch (e: any) { setErr(e.message); }
  }
  async function onDelete(t: WatermarkTemplate) { if (!window.confirm(`למחוק את "${t.name}"?`)) return; try { await deleteWatermark(t.id); await reload(); } catch (e: any) { setErr(e.message); } }

  async function onSave() {
    if (!editing) return; setErr('');
    if (!editing.name?.trim()) { setErr('יש לתת שם לתבנית'); return; }
    if (editing.kind === 'image' && !logoFile && !editing.imagePath) { setErr('לתבנית לוגו צריך להעלות תמונה'); return; }
    setBusy(true);
    try {
      const payload: any = { ...editing };
      let id = editing.id;
      if (id) { await updateWatermark(id, payload); } else { const c = await createWatermark(payload); id = c.id; }
      if (logoFile && id) await uploadWatermarkLogo(id, logoFile);
      setEditing(null); setLogoFile(null); await reload();
    } catch (e: any) { setErr(e.message || 'שגיאה בשמירה'); } finally { setBusy(false); }
  }

  if (!ready) return <main style={{ maxWidth: 920, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;

  function summary(t: WatermarkTemplate): string {
    const c: string[] = [t.kind === 'image' ? 'לוגו' : 'טקסט'];
    c.push(POS.find((p) => p.v === t.position)?.t ?? t.position);
    if (t.outline) c.push('קו מתאר'); if (t.motion) c.push('נע'); if (t.blink) c.push('מהבהב');
    const scope: string[] = [];
    if (t.folderIds.length) scope.push(`${t.folderIds.length} תיקיות`);
    if (t.tagIds.length) scope.push(`${t.tagIds.length} תגיות`);
    if (t.mimeTypes.length) scope.push(`${t.mimeTypes.length} סוגים`);
    if (t.sensitivities.length) scope.push('רגישות');
    c.push(scope.length ? 'טווח: ' + scope.join(' / ') : 'כל הקבצים');
    return c.join(' · ');
  }

  return (
    <main style={{ maxWidth: 920, margin: '24px auto', padding: 24 }} dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>סימני מים</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={startNew} style={primary}>+ תבנית חדשה</button>
          <button onClick={() => router.push('/')} style={btn}>← חזרה</button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>כמה תבניות יכולות לפעול יחד (שכבות). כל תבנית — טקסט או לוגו, עם עיצוב מלא, וטווח-החלה אוטומטי לפי תיקייה / תגית / סוג קובץ / רגישות. ריק = חל על כל הקבצים.</p>
      {err && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: '8px 10px', borderRadius: 8 }}>{err}</p>}

      {/* רשימת תבניות */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {rows.length === 0 && <p style={{ color: 'var(--muted)' }}>עדיין אין תבניות. צור תבנית חדשה.</p>}
        {rows.map((t) => (
          <div key={t.id} style={{ ...card, borderColor: t.enabled ? '#16a34a' : '#e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                  <input type="checkbox" checked={t.enabled} onChange={() => onToggleEnabled(t)} /> {t.name}
                  <span style={{ background: t.enabled ? '#dcfce7' : '#f1f5f9', color: t.enabled ? '#166534' : '#64748b', borderRadius: 6, padding: '1px 8px', fontSize: 12 }}>{t.enabled ? 'פעיל' : 'כבוי'}</span>
                </label>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{summary(t)}</div>
                {t.kind === 'text' && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>טקסט: {t.text}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => startEdit(t)} style={btn}>ערוך</button>
                <button onClick={() => onDelete(t)} style={danger}>מחק</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* עורך */}
      {editing && (
        <div onClick={() => setEditing(null)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{editing.id ? 'עריכת תבנית' : 'תבנית חדשה'}</h2>
              <button onClick={() => setEditing(null)} style={btn}>✕</button>
            </div>
            <div style={grid}>
              <label style={lbl}>שם<input value={editing.name ?? ''} onChange={(e) => setF('name', e.target.value)} style={inp} /></label>
              <label style={lbl}>סוג
                <select value={editing.kind} onChange={(e) => setF('kind', e.target.value as any)} style={inp}><option value="text">טקסט</option><option value="image">לוגו / תמונה</option></select>
              </label>
              <label style={lbl}>שכבה (סדר)<input type="number" value={editing.priority ?? 0} onChange={(e) => setF('priority', Number(e.target.value))} style={inp} /></label>
              <label style={lbl}>מיקום
                <select value={editing.position} onChange={(e) => setF('position', e.target.value as any)} style={inp}>{POS.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}</select>
              </label>
              <label style={lbl}>שקיפות ({Math.round((editing.opacity ?? 0.3) * 100)}%)<input type="range" min={0} max={1} step={0.05} value={editing.opacity ?? 0.3} onChange={(e) => setF('opacity', Number(e.target.value))} /></label>
              <label style={lbl}>זווית<input type="number" value={editing.angle ?? 0} onChange={(e) => setF('angle', Number(e.target.value))} style={inp} /></label>
            </div>

            {editing.kind === 'text' ? (
              <div style={grid}>
                <label style={{ ...lbl, gridColumn: '1 / -1' }}>טקסט (משתנים: {'{name} {email} {datetime} {date} {time} {viewid} {ip}'})<input value={editing.text ?? ''} onChange={(e) => setF('text', e.target.value)} style={inp} /></label>
                <label style={lbl}>גודל גופן<input type="number" value={editing.fontSize ?? 28} onChange={(e) => setF('fontSize', Number(e.target.value))} style={inp} /></label>
                <label style={lbl}>צבע<input type="color" value={editing.color ?? '#ffffff'} onChange={(e) => setF('color', e.target.value)} style={{ ...inp, padding: 2, height: 38 }} /></label>
                <label style={chk}><input type="checkbox" checked={!!editing.outline} onChange={(e) => setF('outline', e.target.checked)} /> קו מתאר (קריאוּת)</label>
                <label style={chk}><input type="checkbox" checked={!!editing.motion} onChange={(e) => setF('motion', e.target.checked)} /> תנועה בווידאו</label>
              </div>
            ) : (
              <div style={grid}>
                <label style={lbl}>לוגו (תמונה){editing.imagePath && !logoFile ? <span style={{ color: '#16a34a', fontSize: 12 }}> — לוגו קיים</span> : null}
                  <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} style={inp} /></label>
                <label style={lbl}>גודל הלוגו ({Math.round((editing.imageScale ?? 0.25) * 100)}% מהמסך)<input type="range" min={0.05} max={1} step={0.05} value={editing.imageScale ?? 0.25} onChange={(e) => setF('imageScale', Number(e.target.value))} /></label>
              </div>
            )}

            {/* [שינוי 2026-06-25] גמישות: מרחק חזרות, תנועה (ציר/כיוון/מהירות), הבהוב (מחזור/משך) — לטקסט */}
            {editing.kind === 'text' && (
              <div style={grid}>
                {editing.position === 'tiled' && (
                  <label style={lbl}>מרחק בין חזרות ({editing.tileGap ?? 28}px)<input type="range" min={0} max={300} step={2} value={editing.tileGap ?? 28} onChange={(e) => setF('tileGap', Number(e.target.value))} /></label>
                )}
                <label style={chk}><input type="checkbox" checked={!!editing.blink} onChange={(e) => setF('blink', e.target.checked)} /> הבהוב בווידאו</label>
                {editing.blink && (<>
                  <label style={lbl}>כל כמה שניות<input type="number" min={0.5} step={0.5} value={editing.blinkInterval ?? 5} onChange={(e) => setF('blinkInterval', Number(e.target.value))} style={inp} /></label>
                  <label style={lbl}>משך הופעה (שניות)<input type="number" min={0.2} step={0.5} value={editing.blinkOn ?? 1.5} onChange={(e) => setF('blinkOn', Number(e.target.value))} style={inp} /></label>
                </>)}
                {editing.motion && (<>
                  <label style={lbl}>ציר תנועה<select value={editing.motionAxis ?? 'x'} onChange={(e) => setF('motionAxis', e.target.value as any)} style={inp}><option value="x">אופקי (לרוחב)</option><option value="y">אנכי (לגובה)</option></select></label>
                  <label style={lbl}>כיוון<select value={String(editing.motionDir ?? 1)} onChange={(e) => setF('motionDir', Number(e.target.value))} style={inp}><option value="1">קדימה</option><option value="-1">אחורה</option></select></label>
                  <label style={lbl}>מהירות ({editing.motionSpeed ?? 120})<input type="range" min={10} max={600} step={10} value={editing.motionSpeed ?? 120} onChange={(e) => setF('motionSpeed', Number(e.target.value))} /></label>
                </>)}
              </div>
            )}

            {/* טווח-החלה */}
            <div style={{ borderTop: '1px solid #eef2f7', marginTop: 12, paddingTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>על אילו קבצים לצרוב? <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 13 }}>(ריק = כל הקבצים)</span></div>
              <Picker label="תיקיות" items={folders.map((f) => ({ id: f.id, label: '· '.repeat(f.depth) + f.name }))} sel={editing.folderIds} onToggle={(id) => toggle('folderIds', id)} />
              <Picker label="תגיות" items={tags.map((t) => ({ id: t.id, label: t.path ?? t.name }))} sel={editing.tagIds} onToggle={(id) => toggle('tagIds', id)} />
              <Picker label="סוגי קובץ" items={types.map((m) => ({ id: m, label: mimeLabel(m) }))} sel={editing.mimeTypes} onToggle={(id) => toggle('mimeTypes', id)} />
              <Picker label="רמת רגישות" items={SENS.map((s) => ({ id: s.v, label: s.t }))} sel={editing.sensitivities} onToggle={(id) => toggle('sensitivities', id)} />
              <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                <label style={chk}><input type="checkbox" checked={editing.includeSubfolders !== false} onChange={(e) => setF('includeSubfolders', e.target.checked)} /> כולל תת-תיקיות</label>
                <label style={chk}><input type="checkbox" checked={editing.includeSubtags !== false} onChange={(e) => setF('includeSubtags', e.target.checked)} /> כולל תת-תגיות</label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={onSave} disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>{busy ? 'שומר…' : 'שמור'}</button>
              <button onClick={() => setEditing(null)} style={btn}>ביטול</button>
            </div>
          </div>
        </div>
      )}
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

const card: CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 60, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(720px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 24, marginBottom: 24 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 8 };
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155' };
const chk: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#334155' };
const inp: CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primary: CSSProperties = { padding: '9px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const danger: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, cursor: 'pointer' };
const chip = (on: boolean): CSSProperties => ({ padding: '4px 10px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--accent)' : '#cbd5e1'), background: on ? 'var(--accent)' : '#fff', color: on ? '#fff' : '#334155', cursor: 'pointer', fontSize: 13 });
