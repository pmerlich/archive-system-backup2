'use client';
// restrictions/page.tsx — ריכוז כל הגבלות הצפייה במערכת (שלב 3.4). דורש security.manage.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getToken, hasPermission, listRestrictions, revokeRestriction, type AuthUser, type ViewRestriction } from '@/lib/api';

function dt(s: string | null): string { if (!s) return '—'; try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } }

const STATE_BADGE: Record<string, { t: string; c: string; bg: string }> = {
  active: { t: 'פעיל', c: '#166534', bg: '#dcfce7' },
  revoked: { t: 'בוטל', c: '#b91c1c', bg: '#fee2e2' },
  expired: { t: 'פג', c: '#475569', bg: '#e2e8f0' },
  exhausted: { t: 'מוצה', c: '#92400e', bg: '#fef3c7' },
};

export default function RestrictionsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<ViewRestriction[]>([]);
  const [onlyActive, setOnlyActive] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe().then((u: AuthUser) => {
      if (!hasPermission(u, 'security.manage')) { router.replace('/'); return; }
      setReady(true); reload();
    }).catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() { try { setRows(await listRestrictions()); } catch (e: any) { setErr(e.message || 'שגיאה'); } }
  async function revoke(id: string) {
    if (!window.confirm('לבטל את ההגבלה? הביטול נכנס לתוקף מיד.')) return;
    try { await revokeRestriction(id); await reload(); } catch (e: any) { setErr(e.message); }
  }

  if (!ready) return <main style={{ maxWidth: 960, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;

  const visible = onlyActive ? rows.filter((r) => r.state === 'active') : rows;

  return (
    <main style={{ maxWidth: 960, margin: '24px auto', padding: 24 }} dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>הגבלות גישה</h1>
        <button onClick={() => router.push('/')} style={btn}>← חזרה</button>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>
        כל ההגבלות שהוגדרו על קבצים — נעילה למשתמש / מכשיר / חלון זמן / מספר צפיות. ההגבלות נאכפות בשרת וניתנות לביטול מיידי.
        כדי להוסיף הגבלה חדשה — היכנס למסך הקבצים, ולחץ "הגבלת גישה" ליד הקובץ.
      </p>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#334155', marginTop: 4 }}>
        <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> הצג רק פעילות
      </label>
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {visible.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 16 }}>{onlyActive ? 'אין כרגע הגבלות פעילות.' : 'לא הוגדרו הגבלות.'}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {visible.map((r) => { const b = STATE_BADGE[r.state] ?? STATE_BADGE.active; return (
            <div key={r.id} style={{ ...card, borderColor: r.state === 'active' ? '#bbf7d0' : '#e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: 'break-word' }}>
                    📄 {r.fileName} <span style={{ background: b.bg, color: b.c, borderRadius: 6, padding: '1px 8px', fontSize: 12, marginInlineStart: 6 }}>{b.t}</span>
                  </div>
                  <div>👤 {r.scope ? `${r.scope.userName} (${r.scope.userEmail})` : 'כל המשתמשים'}</div>
                  <div>💻 {r.device ? `נעול למכשיר: ${r.device.deviceName}` : 'כל מכשיר (כולל דפדפן)'}</div>
                  <div>⏳ תפוגה: {r.expiresAt ? dt(r.expiresAt) : 'ללא'}</div>
                  <div>🔢 צפיות: {r.maxViews === null ? 'ללא הגבלה' : `${r.viewsUsed} / ${r.maxViews} (נותרו ${r.viewsLeft})`}</div>
                  {r.note && <div style={{ color: 'var(--muted)' }}>📝 {r.note}</div>}
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>נוצרה: {dt(r.createdAt)}{r.revokedAt ? ` · בוטלה: ${dt(r.revokedAt)}` : ''}</div>
                </div>
                {r.state === 'active' && <button onClick={() => revoke(r.id)} style={danger}>ביטול מיידי</button>}
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
const danger: CSSProperties = { padding: '8px 16px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, cursor: 'pointer', height: 'fit-content', whiteSpace: 'nowrap' };
