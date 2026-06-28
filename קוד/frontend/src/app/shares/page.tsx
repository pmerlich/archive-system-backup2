'use client';
// shares/page.tsx — ריכוז כל קישורי הצפייה החיצוניים (שלב 3.5). דורש links.manage.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getToken, hasPermission, listShareLinks, listSharePending, revokeShareLink, approveShareSession, shareUrl, type AuthUser, type ShareLink, type SharePending } from '@/lib/api';

function dt(s: string | null): string { if (!s) return '—'; try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } }
const STATE_BADGE: Record<string, { t: string; c: string; bg: string }> = {
  active: { t: 'פעיל', c: '#166534', bg: '#dcfce7' }, revoked: { t: 'בוטל', c: '#b91c1c', bg: '#fee2e2' },
  expired: { t: 'פג', c: '#475569', bg: '#e2e8f0' }, exhausted: { t: 'מוצה', c: '#92400e', bg: '#fef3c7' },
};

export default function SharesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [pending, setPending] = useState<SharePending[]>([]);
  const [onlyActive, setOnlyActive] = useState(true);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe().then((u: AuthUser) => { if (!hasPermission(u, 'links.manage')) { router.replace('/'); return; } setReady(true); reload(); })
      .catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() {
    try { const [l, p] = await Promise.all([listShareLinks(), listSharePending()]); setLinks(l); setPending(p); }
    catch (e: any) { setErr(e.message || 'שגיאה'); }
  }
  async function copy(token: string) { try { await navigator.clipboard.writeText(shareUrl(token)); setCopied(token); setTimeout(() => setCopied(''), 1500); } catch { setErr('העתק ידנית: ' + shareUrl(token)); } }
  async function revoke(id: string) { if (!window.confirm('לבטל את הקישור? הביטול מיידי.')) return; try { await revokeShareLink(id); await reload(); } catch (e: any) { setErr(e.message); } }
  async function approve(sid: string) { try { await approveShareSession(sid); await reload(); } catch (e: any) { setErr(e.message); } }

  if (!ready) return <main style={{ maxWidth: 960, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;
  const visible = onlyActive ? links.filter((l) => l.state === 'active') : links;

  function cond(l: ShareLink): string {
    const c: string[] = [];
    if (l.email) c.push(`מייל: ${l.email}`); else if (l.requireOtp) c.push('קוד למייל');
    if (l.requireApproval) c.push('אישור ידני');
    if (l.maxViews !== null) c.push(`${l.viewsUsed}/${l.maxViews} צפיות`);
    if (l.expiresAt) c.push(`עד ${dt(l.expiresAt)}`);
    if (l.singleDevice) c.push('מכשיר אחד'); if (l.israelOnly) c.push('ישראל בלבד'); if (l.ipBlock) c.push('חסימת IP');
    c.push(l.watermark ? 'סימן מים' : 'ללא סימן מים');
    return c.join(' · ');
  }

  return (
    <main style={{ maxWidth: 960, margin: '24px auto', padding: 24 }} dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>קישורי צפייה חיצוניים</h1>
        <button onClick={() => router.push('/')} style={btn}>← חזרה</button>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>כל קישורי השיתוף. ליצירת קישור חדש — היכנס למסך הקבצים ולחץ "קישור צפייה" ליד הקובץ. ביטול נכנס לתוקף מיד.</p>

      {pending.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 14, marginTop: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>ממתינים לאישור ({pending.length})</div>
          {pending.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, padding: '4px 0', flexWrap: 'wrap' }}>
              <span>{p.label ? `${p.label} · ` : ''}{p.email || 'אורח'} {p.country ? `· ${p.country}` : ''} · {dt(p.createdAt)}</span>
              <button onClick={() => approve(p.id)} style={primary}>אשר צפייה</button>
            </div>
          ))}
        </div>
      )}

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#334155', marginTop: 12 }}>
        <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> הצג רק פעילים
      </label>
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {visible.length === 0 ? <p style={{ color: 'var(--muted)', marginTop: 16 }}>{onlyActive ? 'אין קישורים פעילים.' : 'לא נוצרו קישורים.'}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {visible.map((l) => { const b = STATE_BADGE[l.state ?? 'active']; return (
            <div key={l.id} style={{ ...card, borderColor: l.state === 'active' ? '#bbf7d0' : '#e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: 'break-word' }}>📄 {l.fileName}{l.label ? ` — ${l.label}` : ''} <span style={{ background: b.bg, color: b.c, borderRadius: 6, padding: '1px 8px', fontSize: 12, marginInlineStart: 6 }}>{b.t}</span>{l.requireApproval && (l.pendingApprovals ?? 0) > 0 ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '1px 8px', fontSize: 12, marginInlineStart: 6 }}>{l.pendingApprovals} ממתינים</span> : null}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>{cond(l)}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#334155', wordBreak: 'break-all', marginTop: 4 }}>{shareUrl(l.token)}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>נוצר: {dt(l.createdAt)}{l.revokedAt ? ` · בוטל: ${dt(l.revokedAt)}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => router.push(`/view-log?linkId=${l.id}`)} style={btn}>צפיות</button>
                  <button onClick={() => copy(l.token)} style={btn}>{copied === l.token ? '✓ הועתק' : 'העתק קישור'}</button>
                  {l.state === 'active' && <button onClick={() => revoke(l.id)} style={danger}>ביטול</button>}
                </div>
              </div>
            </div>
          ); })}
        </div>
      )}
    </main>
  );
}

const card: CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primary: CSSProperties = { padding: '7px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const danger: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, cursor: 'pointer', height: 'fit-content' };
