'use client';
// ActivityLog.tsx — חלון יומן פעילות (קריאה בלבד, שלב 2.6). מקבל סינון (יעד או מבצע) ומציג את האירועים.
import { useEffect, useState, type CSSProperties } from 'react';
import { listAuditLog, type AuditEntry } from '@/lib/api';

function dt(s: string): string {
  try { return new Date(s).toLocaleString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; }
}
// תקציר קצר מתוך אובייקט הפרטים של האירוע.
function summarize(d: any): string {
  if (!d || typeof d !== 'object') return '';
  const parts: string[] = [];
  if (d.name) parts.push(String(d.name));
  if (d.from && d.to) parts.push(`${d.from} ← ${d.to}`);
  if (d.targetEmail) parts.push(String(d.targetEmail));
  return parts.filter(Boolean).join(' · ');
}

export default function ActivityLog({ title, filter, onClose }: {
  title: string;
  filter: { targetType?: string; targetId?: string; userId?: string };
  onClose: () => void;
}) {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listAuditLog({ ...filter, page, pageSize: 50 })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); setPages(r.pages); } })
      .catch((e: any) => { if (alive) setErr(e.message || 'שגיאה בטעינת הלוג'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.targetType, filter.targetId, filter.userId, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showType = !filter.targetType; // ביומן כללי מציגים גם את סוג היעד

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>יומן פעילות — {title}</h2>
          <button onClick={onClose} style={btn}>✕ סגור</button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>לקריאה בלבד · {total} רשומות</p>
        {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
        {loading ? <p style={{ color: 'var(--muted)' }}>טוען…</p> : items.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>אין פעילות מתועדת.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 13 }}>
                <th style={th}>מתי</th><th style={th}>פעולה</th><th style={th}>מי</th><th style={th}>פרטים</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid #eef2f7' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{dt(e.createdAt)}</td>
                  <td style={td}>{e.actionLabel}{showType && e.targetTypeLabel ? <span style={{ color: 'var(--muted)' }}> ({e.targetTypeLabel})</span> : null}</td>
                  <td style={td}>{e.actorName}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{summarize(e.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(820px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 24, marginBottom: 24 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const th: CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const td: CSSProperties = { padding: '8px 6px', verticalAlign: 'top' };
const pageBtn = (disabled: boolean): CSSProperties => ({ padding: '6px 14px', background: disabled ? '#f1f5f9' : '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', color: disabled ? '#94a3b8' : '#334155' });
