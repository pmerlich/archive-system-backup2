'use client';
// ShareManager.tsx — חלון "קישור צפייה חיצוני" לקובץ (שלב 3.5). דורש links.manage.
// יצירת קישור עם כל התנאים, רשימת קישורים קיימים (העתקה/ביטול), ואישור ידני של ממתינים.
import { useEffect, useState, type CSSProperties } from 'react';
import {
  listFileShareLinks, listSharePending, createShareLink, revokeShareLink, approveShareSession, shareUrl,
  type ShareLink, type SharePending, type ArchiveFile,
} from '@/lib/api';

function dt(s: string | null): string { if (!s) return '—'; try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } }
const STATE_BADGE: Record<string, { t: string; c: string; bg: string }> = {
  active: { t: 'פעיל', c: '#166534', bg: '#dcfce7' }, revoked: { t: 'בוטל', c: '#b91c1c', bg: '#fee2e2' },
  expired: { t: 'פג', c: '#475569', bg: '#e2e8f0' }, exhausted: { t: 'מוצה', c: '#92400e', bg: '#fef3c7' },
};

export default function ShareManager({ file, onClose }: { file: ArchiveFile; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [pending, setPending] = useState<SharePending[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');

  // שדות הטופס
  const [label, setLabel] = useState('');
  const [expiresLocal, setExpiresLocal] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [email, setEmail] = useState('');
  const [requireOtp, setRequireOtp] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);
  const [singleDevice, setSingleDevice] = useState(false);
  const [israelOnly, setIsraelOnly] = useState(false);
  const [ipBlock, setIpBlock] = useState('');
  const [watermark, setWatermark] = useState(true);
  const [watermarkText, setWatermarkText] = useState('');

  async function reload() {
    try {
      const [l, p] = await Promise.all([listFileShareLinks(file.id), listSharePending()]);
      setLinks(l); setPending(p.filter((x) => x.fileId === file.id));
    } catch (e: any) { setErr(e.message || 'שגיאה'); }
  }
  useEffect(() => { setLoading(true); reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);

  async function copy(token: string) {
    try { await navigator.clipboard.writeText(shareUrl(token)); setCopied(token); setTimeout(() => setCopied(''), 1500); }
    catch { setErr('לא ניתן להעתיק — העתק ידנית: ' + shareUrl(token)); }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      const created = await createShareLink({
        fileId: file.id, label: label || undefined,
        expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : null,
        maxViews: maxViews ? Number(maxViews) : null,
        email: email || null, requireOtp, requireApproval, singleDevice, israelOnly,
        ipBlock: ipBlock || null, watermark, watermarkText: watermarkText || null,
      });
      setLabel(''); setExpiresLocal(''); setMaxViews(''); setEmail(''); setRequireOtp(false);
      setRequireApproval(false); setSingleDevice(false); setIsraelOnly(false); setIpBlock(''); setWatermark(true); setWatermarkText('');
      await reload();
      copy(created.token); // העתקה אוטומטית של הקישור החדש
    } catch (e: any) { setErr(e.message || 'שגיאה ביצירת הקישור'); }
    finally { setSaving(false); }
  }
  async function onRevoke(id: string) {
    if (!window.confirm('לבטל את הקישור? כל מי שמחזיק בו ייחסם מיד.')) return;
    try { await revokeShareLink(id); await reload(); } catch (e: any) { setErr(e.message); }
  }
  async function onApprove(sid: string) {
    try { await approveShareSession(sid); await reload(); } catch (e: any) { setErr(e.message); }
  }

  function cond(l: ShareLink): string {
    const c: string[] = [];
    if (l.email) c.push(`מייל: ${l.email}`); else if (l.requireOtp) c.push('קוד למייל');
    if (l.requireApproval) c.push('אישור ידני');
    if (l.maxViews !== null) c.push(`${l.viewsUsed}/${l.maxViews} צפיות`);
    if (l.expiresAt) c.push(`עד ${dt(l.expiresAt)}`);
    if (l.singleDevice) c.push('מכשיר אחד');
    if (l.israelOnly) c.push('ישראל בלבד');
    if (l.ipBlock) c.push('חסימת IP');
    c.push(l.watermark ? 'סימן מים' : 'ללא סימן מים');
    return c.join(' · ');
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>קישור צפייה חיצוני — {file.name}</h2>
          <button onClick={onClose} style={btn}>✕ סגור</button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          שיתוף צפייה (ללא הורדת המקור, עם סימן מים) עם אדם מחוץ למערכת — דרך קישור עם תנאים מדויקים, הניתן לביטול מיידי.
        </p>
        {err && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: '8px 10px', borderRadius: 8 }}>{err}</p>}

        {/* ממתינים לאישור */}
        {pending.length > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>ממתינים לאישור ({pending.length})</div>
            {pending.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, padding: '4px 0' }}>
                <span>{p.email || 'אורח'} {p.country ? `· ${p.country}` : ''} · {dt(p.createdAt)}</span>
                <button onClick={() => onApprove(p.id)} style={primary}>אשר צפייה</button>
              </div>
            ))}
          </div>
        )}

        {/* קישורים קיימים */}
        {loading ? <p style={{ color: 'var(--muted)' }}>טוען…</p> : links.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>עדיין לא נוצרו קישורים לקובץ הזה.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {links.map((l) => { const b = STATE_BADGE[l.state ?? 'active']; return (
              <div key={l.id} style={{ ...card, borderColor: l.state === 'active' ? '#bbf7d0' : '#e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, minWidth: 0 }}>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ background: b.bg, color: b.c, borderRadius: 6, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>{b.t}</span>
                      {l.label && <strong style={{ marginInlineStart: 8 }}>{l.label}</strong>}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>{cond(l)}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#334155', wordBreak: 'break-all', marginTop: 4 }}>{shareUrl(l.token)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => copy(l.token)} style={btn}>{copied === l.token ? '✓ הועתק' : 'העתק קישור'}</button>
                    {l.state === 'active' && <button onClick={() => onRevoke(l.id)} style={danger}>ביטול</button>}
                  </div>
                </div>
              </div>
            ); })}
          </div>
        )}

        {/* יצירת קישור */}
        <form onSubmit={onCreate} style={{ borderTop: '1px solid #eef2f7', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>יצירת קישור חדש</h3>
          <div style={grid}>
            <label style={lbl}>שם לזיהוי (לא חובה)<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} style={inp} placeholder="למשל: שיתוף עם עו״ד" /></label>
            <label style={lbl}>הגבל למייל (לא חובה)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} placeholder="name@example.com" /></label>
            <label style={lbl}>תפוגה (לא חובה)<input type="datetime-local" value={expiresLocal} onChange={(e) => setExpiresLocal(e.target.value)} style={inp} /></label>
            <label style={lbl}>מספר צפיות מרבי (לא חובה)<input type="number" min={1} value={maxViews} onChange={(e) => setMaxViews(e.target.value)} style={inp} placeholder="ללא הגבלה" /></label>
            <label style={lbl}>חסימת כתובות IP (לא חובה)<input value={ipBlock} onChange={(e) => setIpBlock(e.target.value)} style={inp} placeholder="1.2.3.4, 5.6.7." title="מופרד בפסיק; ערך שמסתיים בנקודה חוסם קידומת" /></label>
            <label style={lbl}>טקסט סימן מים מותאם (לא חובה)<input value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} maxLength={120} style={inp} placeholder="למשל שם הנמען" title="יוטבע על מה שהנמען רואה, בנוסף לסימני המים הרגילים" /></label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <label style={chk}><input type="checkbox" checked={requireOtp || !!email} disabled={!!email} onChange={(e) => setRequireOtp(e.target.checked)} /> קוד חד-פעמי למייל{email ? ' (אוטומטי)' : ''}</label>
            <label style={chk}><input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} /> אישור ידני לפני צפייה</label>
            <label style={chk}><input type="checkbox" checked={singleDevice} onChange={(e) => setSingleDevice(e.target.checked)} /> מכשיר אחד בלבד</label>
            <label style={chk}><input type="checkbox" checked={israelOnly} onChange={(e) => setIsraelOnly(e.target.checked)} /> מישראל בלבד</label>
            <label style={chk}><input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /> סימן מים</label>
          </div>
          <div><button type="submit" disabled={saving} style={{ ...primary, opacity: saving ? 0.6 : 1 }}>{saving ? 'יוצר…' : 'צור קישור והעתק'}</button></div>
        </form>
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 60, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(760px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 24, marginBottom: 24 };
const card: CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 };
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155' };
const chk: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#334155' };
const inp: CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primary: CSSProperties = { padding: '9px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const danger: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, cursor: 'pointer' };
