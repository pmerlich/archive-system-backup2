'use client';
// jobs/page.tsx — תור עיבוד ברקע (שלב 4.5). מציג משימות עיבוד עם סטטוס והתקדמות, מתרענן אוטומטית, ומאפשר ביטול משימה ממתינה.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getToken, hasPermission, listRenderJobs, cancelRenderJob, type AuthUser, type RenderJob } from '@/lib/api';

const BADGE: Record<string, { t: string; c: string; bg: string }> = {
  pending: { t: 'ממתין', c: '#92400e', bg: '#fef3c7' },
  processing: { t: 'מעבד…', c: '#1e40af', bg: '#dbeafe' },
  done: { t: 'הושלם', c: '#166534', bg: '#dcfce7' },
  failed: { t: 'נכשל', c: '#b91c1c', bg: '#fee2e2' },
  canceled: { t: 'בוטל', c: '#475569', bg: '#e2e8f0' },
};
const TYPE_LABEL: Record<string, string> = { edit: 'עריכת תמונה', video: 'וידאו', ai: 'AI' };
function dt(s: string | null): string { if (!s) return '—'; try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } }

export default function JobsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState('');
  const timer = useRef<any>(null);

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe().then((u: AuthUser) => {
      if (!hasPermission(u, 'files.view')) { router.replace('/'); return; }
      setReady(true); reload();
      timer.current = setInterval(reload, 2000); // ריענון אוטומטי
    }).catch(() => router.replace('/login'));
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() {
    try { const r = await listRenderJobs({ pageSize: 100 }); setJobs(r.items); setActive(r.active); setErr(''); }
    catch (e: any) { setErr(e.message || 'שגיאה'); }
  }
  async function cancel(id: string) {
    try { await cancelRenderJob(id); await reload(); } catch (e: any) { setErr(e.message || 'הביטול נכשל'); }
  }

  if (!ready) return <main style={wrap}><span style={{ color: 'var(--muted)' }}>טוען…</span></main>;

  return (
    <main style={wrap} dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>תור עיבוד ברקע</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>פעילות כעת: <b>{active}</b></span>
          <button onClick={() => router.push('/')} style={btn}>← לוח בקרה</button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>עבודות כבדות רצות כאן ברקע בלי לתקוע את האתר. הרשימה מתעדכנת אוטומטית.</p>
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {jobs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--muted)' }}>אין משימות עיבוד כרגע.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {jobs.map((j) => {
            const b = BADGE[j.status] || BADGE.pending;
            return (
              <div key={j.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...badge, color: b.c, background: b.bg }}>{b.t}</span>
                    <b>{TYPE_LABEL[j.type] || j.type}</b>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>נוצר {dt(j.createdAt)}</span>
                  </span>
                  {j.status === 'pending' && <button onClick={() => cancel(j.id)} style={smallBtn}>ביטול</button>}
                </div>
                <div style={{ marginTop: 8, height: 8, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${j.status === 'done' ? 100 : j.status === 'failed' || j.status === 'canceled' ? 0 : j.progress}%`, background: j.status === 'failed' ? '#ef4444' : '#2563eb', transition: 'width .4s' }} />
                </div>
                {j.error && <p style={{ color: '#b91c1c', fontSize: 12, margin: '6px 0 0' }}>שגיאה: {j.error}</p>}
                {j.status === 'done' && <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0 0' }}>התוצאה זמינה ברשימת הקבצים (מקור: עריכה).</p>}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

const wrap: CSSProperties = { maxWidth: 900, margin: '40px auto', padding: 24 };
const card: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 };
const badge: CSSProperties = { fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999 };
const btn: CSSProperties = { padding: '7px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const smallBtn: CSSProperties = { padding: '4px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
