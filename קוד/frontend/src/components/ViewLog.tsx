'use client';
// ViewLog.tsx — חלון לוג צפיות (קריאה בלבד, שלב 3.6). מציג את הפעלות הצפייה (פנימיות + קישורים)
// לפי סינון (קובץ / קישור / משתמש): מי צפה, מתי נפתח, IP ומכשיר, משך, ומצב (פעיל/פג/בוטל/חסום).
import { useEffect, useState, type CSSProperties } from 'react';
import { listViewLog, type ViewLogEntry } from '@/lib/api';

function dt(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; }
}
// משך בשניות → טקסט קריא בעברית.
export function humanDuration(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} שע׳`);
  if (m) parts.push(`${m} דק׳`);
  if (!h && s) parts.push(`${s} שנ׳`);
  return parts.join(' ') || `${sec} שנ׳`;
}
// קיצור מחרוזת דפדפן/מכשיר ארוכה.
function shortUA(ua: string | null): string {
  if (!ua) return '—';
  return ua.length > 42 ? ua.slice(0, 42) + '…' : ua;
}
const STATUS_COLOR: Record<string, string> = { active: '#15803d', expired: '#b45309', revoked: '#b91c1c', pending: '#7c3aed' };

export default function ViewLog({ title, filter, onClose }: {
  title: string;
  filter: { fileId?: string; linkId?: string; userId?: string };
  onClose: () => void;
}) {
  const [items, setItems] = useState<ViewLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listViewLog({ ...filter, page, pageSize: 50 })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); setPages(r.pages); } })
      .catch((e: any) => { if (alive) setErr(e.message || 'שגיאה בטעינת לוג הצפיות'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.fileId, filter.linkId, filter.userId, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showFile = !filter.fileId; // אם לא סוננו לפי קובץ — מציגים עמודת קובץ

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>לוג צפיות — {title}</h2>
          <button onClick={onClose} style={btn}>✕ סגור</button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>לקריאה בלבד · {total} צפיות</p>
        {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
        {loading ? <p style={{ color: 'var(--muted)' }}>טוען…</p> : items.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>אין צפיות מתועדות.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                  <th style={th}>מתי נפתח</th>
                  <th style={th}>סוג</th>
                  {showFile && <th style={th}>קובץ</th>}
                  <th style={th}>מי צפה</th>
                  <th style={th}>משך</th>
                  <th style={th}>IP</th>
                  <th style={th}>מכשיר</th>
                  <th style={th}>מצב</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid #eef2f7' }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{dt(e.openedAt)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 12, padding: '2px 7px', borderRadius: 999, background: e.kind === 'share' ? '#ede9fe' : '#e0f2fe', color: e.kind === 'share' ? '#6d28d9' : '#0369a1' }}>{e.kindLabel}</span>
                    </td>
                    {showFile && <td style={{ ...td, maxWidth: 160, wordBreak: 'break-word' }}>{e.fileName}</td>}
                    <td style={td}>
                      {e.viewerLabel}
                      {e.kind === 'share' && (e.createdBy || e.sentTo) && (
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {e.createdBy ? `יצר: ${e.createdBy}` : ''}{e.createdBy && e.sentTo ? ' · ' : ''}{e.sentTo ? `אל: ${e.sentTo}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{humanDuration(e.durationSeconds)}{e.viewCount ? <span style={{ color: 'var(--muted)' }}> ({e.viewCount})</span> : null}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{e.ip ?? '—'}{e.country ? <span> · {e.country}</span> : null}</td>
                    <td style={{ ...td, color: 'var(--muted)' }} title={e.userAgent ?? ''}>{shortUA(e.userAgent)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: STATUS_COLOR[e.status] ?? '#334155', fontWeight: 600 }}>{e.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1} style={pageBtn(page <= 1)}>הקודם</button>
            <span style={{ fontSize: 14, color: '#475569' }}>עמוד {page} מתוך {pages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages} style={pageBtn(page >= pages)}>הבא</button>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 60, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(960px, 97vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 24, marginBottom: 24 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const th: CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const td: CSSProperties = { padding: '8px 6px', verticalAlign: 'top' };
const pageBtn = (disabled: boolean): CSSProperties => ({ padding: '6px 14px', background: disabled ? '#f1f5f9' : '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', color: disabled ? '#94a3b8' : '#334155' });
