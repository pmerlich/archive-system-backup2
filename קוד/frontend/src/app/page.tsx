'use client';
// page.tsx — לוח הבקרה החי (מוגן). תמונת מצב אמיתית של הארכיון; לחיצה על מספר קופצת לסינון המתאים (שלב 2.7).
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getHealth, getMe, logout, getToken, hasPermission, getDashboard, listAuditLog,
  type Health, type AuthUser, type DashboardStats, type AuditEntry,
} from '@/lib/api';
import ActivityLog from '@/components/ActivityLog';

function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${u[i]}`;
}
function mimeLabel(m: string | null): string {
  if (!m) return 'לא מזוהה';
  if (m.startsWith('image/')) return `תמונה (${m.replace('image/', '')})`;
  if (m.startsWith('video/')) return `וידאו (${m.replace('video/', '')})`;
  if (m.startsWith('audio/')) return `שמע (${m.replace('audio/', '')})`;
  if (m === 'application/pdf') return 'PDF';
  if (m === 'application/zip') return 'ZIP / Office';
  if (m.startsWith('text/')) return 'טקסט';
  if (m === 'application/octet-stream') return 'כללי';
  return m;
}
function dt(s: string): string {
  try { return new Date(s).toLocaleString('he-IL', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; }
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<AuditEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe()
      .then(async (u) => {
        setUser(u);
        setHealth(await getHealth().catch(() => null));
        if (hasPermission(u, 'files.view')) { try { setStats(await getDashboard()); } catch { /* */ } }
        if (hasPermission(u, 'logs.view')) { try { setRecent((await listAuditLog({ pageSize: 6 })).items); } catch { /* */ } }
      })
      .catch(() => { logout(); router.replace('/login'); })
      .finally(() => setLoading(false));
  }, [router]);

  function doLogout(): void { logout(); router.replace('/login'); }

  if (loading) return <main style={{ maxWidth: 980, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;

  const canViewLogs = hasPermission(user, 'logs.view');
  const diskUsed = stats ? Math.max(stats.storage.diskTotalBytes - stats.storage.diskFreeBytes, 0) : 0;
  const diskPct = stats && stats.storage.diskTotalBytes > 0 ? Math.min(Math.round((diskUsed / stats.storage.diskTotalBytes) * 100), 100) : 0;

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ color: 'var(--accent)', marginBottom: 4 }}>מערכת ארכיון</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>לוח בקרה</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {hasPermission(user, 'files.view') && <button onClick={() => router.push('/folders')} style={navBtn}>תיקיות</button>}
          {hasPermission(user, 'files.view') && <button onClick={() => router.push('/tags')} style={navBtn}>תגיות</button>}
          {hasPermission(user, 'files.view') && <button onClick={() => router.push('/files')} style={navBtn}>קבצים</button>}
          {hasPermission(user, 'files.view') && <button onClick={() => router.push('/duplicates')} style={navBtn}>כפילויות</button>}
          {hasPermission(user, 'files.import') && <button onClick={() => router.push('/import')} style={navBtn}>ייבוא</button>}
          {hasPermission(user, 'watermark.create') && <button onClick={() => router.push('/watermarks')} style={navBtn}>סימני מים</button>}
          {hasPermission(user, 'files.view') && <button onClick={() => router.push('/jobs')} style={navBtn}>תור עיבוד</button>}
          {hasPermission(user, 'security.manage') && <button onClick={() => router.push('/devices')} style={navBtn}>מכשירים</button>}
          {hasPermission(user, 'security.manage') && <button onClick={() => router.push('/restrictions')} style={navBtn}>הגבלות גישה</button>}
          {hasPermission(user, 'security.manage') && <button onClick={() => router.push('/access')} style={navBtn}>הרשאות לפי תיקיות/תגיות</button>}
          {hasPermission(user, 'links.manage') && <button onClick={() => router.push('/shares')} style={navBtn}>קישורי שיתוף</button>}
          {hasPermission(user, 'users.manage') && <button onClick={() => router.push('/users')} style={navBtn}>ניהול משתמשים</button>}
          {canViewLogs && <button onClick={() => setShowLog(true)} style={navBtn}>פעילות</button>}
          {canViewLogs && <button onClick={() => router.push('/view-log')} style={navBtn}>לוג צפיות</button>}
          <button onClick={() => router.push('/account')} style={navBtn}>שינוי סיסמה</button>
          <button onClick={doLogout} style={navBtn}>יציאה</button>
        </div>
      </div>

      {user && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>שלום, {user.name ?? user.email}</h2>
          <ul style={{ lineHeight: 2, margin: 0, paddingInlineStart: 20 }}>
            <li>מייל: {user.email}</li>
            <li>תפקיד: {user.role}</li>
            <li>אימות דו־שלבי: {user.twoFactorEnabled ? 'פעיל' : 'לא פעיל'}</li>
          </ul>
        </section>
      )}

      {hasPermission(user, 'files.view') && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>תמונת מצב</h2>
          {!stats ? <p style={{ color: 'var(--muted)' }}>טוען נתונים…</p> : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#475569', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                  <span>אחסון בארכיון: <strong>{humanSize(stats.storage.usedBytes)}</strong></span>
                  {stats.storage.diskTotalBytes > 0 && <span>דיסק: {humanSize(stats.storage.diskFreeBytes)} פנוי מתוך {humanSize(stats.storage.diskTotalBytes)}</span>}
                </div>
                {stats.storage.diskTotalBytes > 0 && (
                  <div style={{ height: 10, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${diskPct}%`, height: '100%', background: diskPct > 90 ? '#dc2626' : 'var(--accent)' }} />
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <button onClick={() => router.push('/files')} style={statCard}><div style={statNum}>{stats.totals.files}</div><div style={statLbl}>קבצים</div></button>
                <button onClick={() => router.push('/files?backedUp=false')} style={statCard}><div style={{ ...statNum, color: stats.totals.notBackedUp ? '#b45309' : '#15803d' }}>{stats.totals.notBackedUp}</div><div style={statLbl}>ללא גיבוי</div></button>
                <button onClick={() => router.push('/duplicates')} style={statCard}><div style={statNum}>{stats.totals.duplicateGroups}</div><div style={statLbl}>קבוצות כפילות</div></button>
                {hasPermission(user, 'files.import') && <button onClick={() => router.push('/import')} style={statCard}><div style={statNum}>{stats.totals.pendingImports}</div><div style={statLbl}>ייבוא בתהליך</div></button>}
              </div>

              {stats.byType.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, color: '#475569', fontWeight: 600, marginBottom: 6 }}>קבצים לפי סוג</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {stats.byType.map((t) => (
                      <button key={t.mimeType ?? 'none'} onClick={() => t.mimeType && router.push(`/files?mime=${encodeURIComponent(t.mimeType)}`)} style={typeChip} title={humanSize(t.bytes)}>
                        {mimeLabel(t.mimeType)} <strong>{t.count}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {['דיסקים מנותקים', 'קישורי שיתוף', 'התראות אבטחה'].map((t) => (
                  <span key={t} style={soonChip} title="בקרוב — בשלבים הבאים">{t} (בקרוב)</span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {canViewLogs && recent.length > 0 && (
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>פעילות אחרונה</h2>
            <button onClick={() => setShowLog(true)} style={navBtn}>כל הפעילות</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 14 }}>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid #eef2f7' }}>
                  <td style={{ padding: '7px 6px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{dt(e.createdAt)}</td>
                  <td style={{ padding: '7px 6px' }}>{e.actionLabel}{e.targetTypeLabel ? <span style={{ color: 'var(--muted)' }}> ({e.targetTypeLabel})</span> : null}</td>
                  <td style={{ padding: '7px 6px', color: 'var(--muted)' }}>{e.actorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>מצב המערכת</h2>
        {health ? (
          <ul style={{ lineHeight: 2, margin: 0, paddingInlineStart: 20 }}>
            <li>שרת: {health.status === 'ok' ? 'פעיל' : 'לא פעיל'}</li>
            <li>מסד נתונים: {health.database === 'up' ? 'מחובר' : 'לא מחובר'}</li>
            <li>נבדק: {new Date(health.time).toLocaleString('he-IL')}</li>
          </ul>
        ) : <p style={{ color: 'var(--muted)' }}>אין נתונים.</p>}
      </section>

      {showLog && <ActivityLog title="כל המערכת" filter={{}} onClose={() => setShowLog(false)} />}
    </main>
  );
}

const card: CSSProperties = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 16 };
const navBtn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const statCard: CSSProperties = { padding: '14px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer', textAlign: 'center' };
const statNum: CSSProperties = { fontSize: 26, fontWeight: 700, color: 'var(--accent)' };
const statLbl: CSSProperties = { fontSize: 13, color: '#475569', marginTop: 2 };
const typeChip: CSSProperties = { padding: '6px 12px', borderRadius: 999, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#334155' };
const soonChip: CSSProperties = { padding: '6px 12px', borderRadius: 999, border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#94a3b8', fontSize: 13 };
