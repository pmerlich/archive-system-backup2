'use client';
// RestrictionsManager.tsx — חלון "הגבלת גישה" לקובץ (שלב 3.4). דורש security.manage.
// מאפשר לנעול קובץ למשתמש / מכשיר / חלון זמן / מספר צפיות, ולבטל מיידית. הכול נאכף בשרת.
import { useEffect, useState, type CSSProperties } from 'react';
import {
  listFileRestrictions, getRestrictionMeta, createRestriction, revokeRestriction,
  type ViewRestriction, type RestrictionMeta, type ArchiveFile,
} from '@/lib/api';

function dt(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; }
}

const STATE_BADGE: Record<string, { t: string; c: string; bg: string }> = {
  active: { t: 'פעיל', c: '#166534', bg: '#dcfce7' },
  revoked: { t: 'בוטל', c: '#b91c1c', bg: '#fee2e2' },
  expired: { t: 'פג', c: '#475569', bg: '#e2e8f0' },
  exhausted: { t: 'מוצה', c: '#92400e', bg: '#fef3c7' },
};

export default function RestrictionsManager({ file, onClose }: { file: ArchiveFile; onClose: () => void }) {
  const [rows, setRows] = useState<ViewRestriction[]>([]);
  const [meta, setMeta] = useState<RestrictionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // שדות הטופס
  const [userId, setUserId] = useState('');   // '' = כל המשתמשים
  const [deviceId, setDeviceId] = useState(''); // '' = כל מכשיר
  const [expiresLocal, setExpiresLocal] = useState(''); // datetime-local
  const [maxViews, setMaxViews] = useState('');
  const [note, setNote] = useState('');

  async function reload() {
    try { setRows(await listFileRestrictions(file.id)); }
    catch (e: any) { setErr(e.message || 'שגיאה'); }
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([listFileRestrictions(file.id), getRestrictionMeta()])
      .then(([r, m]) => { if (alive) { setRows(r); setMeta(m); } })
      .catch((e: any) => { if (alive) setErr(e.message || 'שגיאה בטעינה'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    // לפחות תנאי אחד
    if (!userId && !deviceId && !expiresLocal && !maxViews) {
      setErr('יש לבחור לפחות תנאי אחד: משתמש, מכשיר, תפוגה או מספר צפיות.');
      return;
    }
    setSaving(true);
    try {
      await createRestriction({
        fileId: file.id,
        userId: userId || null,
        deviceId: deviceId || null,
        // datetime-local הוא זמן מקומי — ממירים ל-ISO עם אזור-זמן כדי שהשרת יבין נכון
        expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : null,
        maxViews: maxViews ? Number(maxViews) : null,
        note: note || null,
      });
      setUserId(''); setDeviceId(''); setExpiresLocal(''); setMaxViews(''); setNote('');
      await reload();
    } catch (e: any) { setErr(e.message || 'שגיאה ביצירת ההגבלה'); }
    finally { setSaving(false); }
  }

  async function onRevoke(id: string) {
    if (!window.confirm('לבטל את ההגבלה? אם זו ההגבלה היחידה — הגישה לקובץ דרך הגבלות תיחסם, והביטול נכנס לתוקף מיד.')) return;
    setErr('');
    try { await revokeRestriction(id); await reload(); } catch (e: any) { setErr(e.message || 'שגיאה בביטול'); }
  }

  const activeCount = rows.filter((r) => r.state === 'active').length;

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>הגבלת גישה — {file.name}</h2>
          <button onClick={onClose} style={btn}>✕ סגור</button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          נעילת הקובץ למשתמש / מכשיר / חלון זמן / מספר צפיות. ההגבלה נאכפת בשרת וניתנת לביטול מיידי.
          {activeCount > 0
            ? <> כרגע יש <strong>{activeCount}</strong> הגבלות פעילות — צפייה מתאפשרת רק למי שעומד בתנאי אחת מהן.</>
            : <> אין כרגע הגבלות פעילות — הקובץ נגיש לפי ההרשאות הרגילות.</>}
        </p>
        {err && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: '8px 10px', borderRadius: 8 }}>{err}</p>}

        {/* רשימת ההגבלות הקיימות */}
        {loading ? <p style={{ color: 'var(--muted)' }}>טוען…</p> : rows.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>עדיין אין הגבלות על הקובץ הזה.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {rows.map((r) => { const b = STATE_BADGE[r.state] ?? STATE_BADGE.active; return (
              <div key={r.id} style={{ ...card, borderColor: r.state === 'active' ? '#bbf7d0' : '#e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14 }}>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ background: b.bg, color: b.c, borderRadius: 6, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>{b.t}</span>
                    </div>
                    <div>👤 {r.scope ? <>‏{r.scope.userName} <span style={{ color: 'var(--muted)' }}>({r.scope.userEmail})</span></> : 'כל המשתמשים'}</div>
                    <div>💻 {r.device ? <>נעול למכשיר: {r.device.deviceName} <span style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>{r.device.deviceId.slice(0, 12)}…</span></> : 'כל מכשיר (כולל דפדפן)'}</div>
                    <div>⏳ תפוגה: {r.expiresAt ? dt(r.expiresAt) : 'ללא'}</div>
                    <div>🔢 צפיות: {r.maxViews === null ? 'ללא הגבלה' : <>{r.viewsUsed} / {r.maxViews} <span style={{ color: 'var(--muted)' }}>(נותרו {r.viewsLeft})</span></>}</div>
                    {r.note && <div style={{ color: 'var(--muted)' }}>📝 {r.note}</div>}
                  </div>
                  {r.state === 'active' && <button onClick={() => onRevoke(r.id)} style={danger}>ביטול מיידי</button>}
                </div>
              </div>
            ); })}
          </div>
        )}

        {/* טופס הוספת הגבלה */}
        <form onSubmit={onAdd} style={{ borderTop: '1px solid #eef2f7', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>הוספת הגבלה</h3>
          <div style={grid}>
            <label style={lbl}>על מי חלה ההגבלה?
              <select value={userId} onChange={(e) => setUserId(e.target.value)} style={inp}>
                <option value="">כל המשתמשים</option>
                {meta?.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </label>
            <label style={lbl}>נעילה למכשיר
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} style={inp}>
                <option value="">כל מכשיר (כולל דפדפן)</option>
                {meta?.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.name}{d.user ? ` · ${d.user.email}` : ''}</option>)}
              </select>
              {meta && meta.devices.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>אין מכשירים מאושרים עדיין (אשר מכשיר במסך "מכשירים").</span>}
            </label>
            <label style={lbl}>תפוגה (לא חובה)
              <input type="datetime-local" value={expiresLocal} onChange={(e) => setExpiresLocal(e.target.value)} style={inp} />
            </label>
            <label style={lbl}>מספר צפיות מרבי (לא חובה)
              <input type="number" min={1} value={maxViews} onChange={(e) => setMaxViews(e.target.value)} placeholder="ללא הגבלה" style={inp} />
            </label>
          </div>
          <label style={lbl}>הערה (לא חובה)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="למשל: שיתוף זמני עם רואה החשבון" style={inp} />
          </label>
          <div>
            <button type="submit" disabled={saving} style={{ ...primary, opacity: saving ? 0.6 : 1 }}>{saving ? 'מוסיף…' : 'הוסף הגבלה'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 60, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(720px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 24, marginBottom: 24 };
const card: CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 };
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155' };
const inp: CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primary: CSSProperties = { padding: '9px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const danger: CSSProperties = { padding: '7px 14px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', height: 'fit-content' };
