'use client';
// view-log/page.tsx — מסך לוג הצפיות המלא (שלב 3.6). דורש logs.view. קריאה בלבד.
// שתי לשוניות: "צפיות" (הפעלות פנימיות + קישורים מאוחדות) ו"קישורים" (סיכום לכל קישור).
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getToken, hasPermission, listViewLog, listViewLogLinks, type AuthUser, type ViewLogEntry, type ViewLinkSummary } from '@/lib/api';

function dt(s: string | null): string { if (!s) return '—'; try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } }
function humanDuration(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} שע׳`);
  if (m) parts.push(`${m} דק׳`);
  if (!h && s) parts.push(`${s} שנ׳`);
  return parts.join(' ') || `${sec} שנ׳`;
}
function shortUA(ua: string | null): string { if (!ua) return '—'; return ua.length > 40 ? ua.slice(0, 40) + '…' : ua; }
const STATUS_COLOR: Record<string, string> = { active: '#15803d', expired: '#b45309', revoked: '#b91c1c', pending: '#7c3aed' };

export default function ViewLogPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'sessions' | 'links'>('sessions');
  const [kind, setKind] = useState<'all' | 'internal' | 'share'>('all');
  const [fileFilter, setFileFilter] = useState<string | undefined>(undefined);
  const [linkFilter, setLinkFilter] = useState<string | undefined>(undefined);

  const [sessions, setSessions] = useState<ViewLogEntry[]>([]);
  const [links, setLinks] = useState<ViewLinkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    // קריאת סינון מכתובת ה-URL (קפיצה מקובץ/קישור/לוח-בקרה).
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get('fileId') || undefined; const l = sp.get('linkId') || undefined;
    if (f) setFileFilter(f);
    if (l) { setLinkFilter(l); setKind('share'); }
    getMe().then((u: AuthUser) => { if (!hasPermission(u, 'logs.view')) { router.replace('/'); return; } setReady(true); })
      .catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setPage(1); }, [tab, kind, fileFilter, linkFilter]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setLoading(true); setErr('');
    const run = tab === 'sessions'
      ? listViewLog({ fileId: fileFilter, linkId: linkFilter, kind: kind === 'all' ? undefined : kind, page, pageSize: 50 })
          .then((r) => { if (alive) { setSessions(r.items); setTotal(r.total); setPages(r.pages); } })
      : listViewLogLinks({ fileId: fileFilter, page, pageSize: 50 })
          .then((r) => { if (alive) { setLinks(r.items); setTotal(r.total); setPages(r.pages); } });
    run.catch((e: any) => { if (alive) setErr(e.message || 'שגיאה'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ready, tab, kind, fileFilter, linkFilter, page]);

  if (!ready) return <main style={{ maxWidth: 1040, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;

  return (
    <main style={{ maxWidth: 1040, margin: '24px auto', padding: 24 }} dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>לוג צפיות</h1>
        <button onClick={() => router.push('/')} style={btn}>← חזרה</button>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>תיעוד מלא של כל צפייה ושיתוף — מי צפה, מתי, מאיזה IP ומכשיר, כמה זמן, והאם פג/בוטל/נחסם. לקריאה בלבד; אי אפשר לשנות או למחוק רשומות.</p>

      {(fileFilter || linkFilter) && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', marginTop: 8, fontSize: 14, display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <span>מסונן {fileFilter ? 'לפי קובץ' : 'לפי קישור'}</span>
          <button onClick={() => { setFileFilter(undefined); setLinkFilter(undefined); }} style={{ ...btn, padding: '4px 10px' }}>נקה סינון</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setTab('sessions')} style={tabBtn(tab === 'sessions')}>צפיות</button>
        <button onClick={() => setTab('links')} style={tabBtn(tab === 'links')}>קישורים</button>
        <span style={{ flex: 1 }} />
        {tab === 'sessions' && !linkFilter && (
          <select value={kind} onChange={(e) => setKind(e.target.value as any)} style={sel}>
            <option value="all">הכול</option>
            <option value="internal">צפייה פנימית</option>
            <option value="share">קישור חיצוני</option>
          </select>
        )}
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{total} רשומות</span>
      </div>

      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
      {loading ? <p style={{ color: 'var(--muted)', marginTop: 16 }}>טוען…</p> : (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          {tab === 'sessions' ? (
            sessions.length === 0 ? <p style={{ color: 'var(--muted)' }}>אין צפיות מתועדות.</p> : (
              <table style={tbl}>
                <thead><tr style={trh}>
                  <th style={th}>מתי נפתח</th><th style={th}>סוג</th><th style={th}>קובץ</th><th style={th}>מי צפה</th><th style={th}>משך</th><th style={th}>IP</th><th style={th}>מכשיר</th><th style={th}>מצב</th>
                </tr></thead>
                <tbody>
                  {sessions.map((e) => (
                    <tr key={e.id} style={tr}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{dt(e.openedAt)}</td>
                      <td style={td}><span style={{ fontSize: 12, padding: '2px 7px', borderRadius: 999, background: e.kind === 'share' ? '#ede9fe' : '#e0f2fe', color: e.kind === 'share' ? '#6d28d9' : '#0369a1' }}>{e.kindLabel}</span></td>
                      <td style={{ ...td, maxWidth: 170, wordBreak: 'break-word' }}>{e.fileName}</td>
                      <td style={td}>{e.viewerLabel}{e.kind === 'share' && (e.createdBy || e.sentTo) && (<div style={{ color: 'var(--muted)', fontSize: 12 }}>{e.createdBy ? `יצר: ${e.createdBy}` : ''}{e.createdBy && e.sentTo ? ' · ' : ''}{e.sentTo ? `אל: ${e.sentTo}` : ''}</div>)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{humanDuration(e.durationSeconds)}{e.viewCount ? <span style={{ color: 'var(--muted)' }}> ({e.viewCount})</span> : null}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{e.ip ?? '—'}{e.country ? ` · ${e.country}` : ''}</td>
                      <td style={{ ...td, color: 'var(--muted)' }} title={e.userAgent ?? ''}>{shortUA(e.userAgent)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: STATUS_COLOR[e.status] ?? '#334155', fontWeight: 600 }}>{e.statusLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            links.length === 0 ? <p style={{ color: 'var(--muted)' }}>לא נוצרו קישורי צפייה.</p> : (
              <table style={tbl}>
                <thead><tr style={trh}>
                  <th style={th}>נוצר</th><th style={th}>קובץ</th><th style={th}>מי יצר</th><th style={th}>למי נשלח</th><th style={th}>תנאים</th><th style={th}>פתיחות</th><th style={th}>מצב</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.id} style={tr}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{dt(l.createdAt)}</td>
                      <td style={{ ...td, maxWidth: 170, wordBreak: 'break-word' }}>{l.fileName}{l.label ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{l.label}</div> : null}</td>
                      <td style={td}>{l.createdBy ?? '—'}</td>
                      <td style={td}>{l.sentTo ?? <span style={{ color: 'var(--muted)' }}>כל מי שיש לו הקישור</span>}</td>
                      <td style={{ ...td, maxWidth: 220, color: 'var(--muted)', fontSize: 12.5 }}>{l.conditions.length ? l.conditions.join(' · ') : 'ללא תנאים'}{l.watermark ? ' · סימן מים' : ''}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.opensCount}{l.maxViews != null ? <span style={{ color: 'var(--muted)' }}> / {l.maxViews}</span> : null}{l.lastOpenedAt ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>אחרון: {dt(l.lastOpenedAt)}</div> : null}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: STATUS_COLOR[l.status] ?? '#334155', fontWeight: 600 }}>{l.statusLabel}</td>
                      <td style={td}><button onClick={() => { setLinkFilter(l.id); setFileFilter(undefined); setKind('share'); setTab('sessions'); }} style={{ ...btn, padding: '4px 10px', fontSize: 13 }}>צפיות</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', marginTop: 14 }}>
          <button onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1} style={pageBtn(page <= 1)}>הקודם</button>
          <span style={{ fontSize: 14, color: '#475569' }}>עמוד {page} מתוך {pages}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages} style={pageBtn(page >= pages)}>הבא</button>
        </div>
      )}
    </main>
  );
}

const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const sel: CSSProperties = { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' };
const tbl: CSSProperties = { width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 13.5 };
const trh: CSSProperties = { color: 'var(--muted)', fontSize: 12.5 };
const tr: CSSProperties = { borderTop: '1px solid #eef2f7' };
const th: CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const td: CSSProperties = { padding: '8px 6px', verticalAlign: 'top' };
const tabBtn = (active: boolean): CSSProperties => ({ padding: '8px 18px', background: active ? '#0369a1' : '#fff', color: active ? '#fff' : '#334155', border: '1px solid ' + (active ? '#0369a1' : '#cbd5e1'), borderRadius: 8, cursor: 'pointer', fontWeight: 600 });
const pageBtn = (disabled: boolean): CSSProperties => ({ padding: '6px 14px', background: disabled ? '#f1f5f9' : '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', color: disabled ? '#94a3b8' : '#334155' });
