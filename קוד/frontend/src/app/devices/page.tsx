'use client';
// devices/page.tsx — ניהול מכשירים מאושרים ל-Archive Reader (שלב 3.3). דורש security.manage.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getToken, hasPermission, listDevices, approveDevice, revokeDevice, type AuthUser, type DeviceRow } from '@/lib/api';

function dt(s: string | null): string { if (!s) return '—'; try { return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return s; } }

export default function DevicesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe().then((u: AuthUser) => {
      if (!hasPermission(u, 'security.manage')) { router.replace('/'); return; }
      setReady(true); reload();
    }).catch(() => router.replace('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() { try { setRows(await listDevices()); } catch (e: any) { setErr(e.message || 'שגיאה'); } }
  async function approve(id: string) { try { await approveDevice(id); await reload(); } catch (e: any) { setErr(e.message); } }
  async function revoke(id: string) { if (!window.confirm('לבטל את אישור המכשיר? הגישה תיחסם מיד.')) return; try { await revokeDevice(id); await reload(); } catch (e: any) { setErr(e.message); } }

  if (!ready) return <main style={{ maxWidth: 920, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;

  const status = (d: DeviceRow) => d.revokedAt ? { t: 'חסום', c: '#b91c1c', bg: '#fee2e2' } : d.approved ? { t: 'מאושר', c: '#166534', bg: '#dcfce7' } : { t: 'ממתין לאישור', c: '#92400e', bg: '#fef3c7' };

  return (
    <main style={{ maxWidth: 920, margin: '24px auto', padding: 24 }} dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>מכשירים מאושרים</h1>
        <button onClick={() => router.push('/')} style={btn}>← חזרה</button>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>
        כל מחשב שמתחבר דרך Archive Reader נרשם כאן. רק מכשיר <strong>מאושר</strong> יכול להיכנס מה-Reader ולצפות בתוכן רגיש. ביטול נכנס לתוקף מיד.
      </p>
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {rows.length === 0 ? <p style={{ color: 'var(--muted)' }}>עדיין לא נרשמו מכשירים. התחבר פעם אחת מה-Reader כדי שהמכשיר יופיע כאן לאישור.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {rows.map((d) => { const s = status(d); return (
            <div key={d.id} style={{ ...card, borderColor: d.approved ? '#16a34a' : d.revokedAt ? '#fecaca' : '#fcd34d' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{d.name} <span style={{ background: s.bg, color: s.c, borderRadius: 6, padding: '1px 8px', fontSize: 12, marginInlineStart: 6 }}>{s.t}</span></div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{d.user ? `${d.user.name} · ${d.user.email}` : '—'}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4, fontFamily: 'monospace' }}>{d.deviceId}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>נרשם: {dt(d.createdAt)} · נראה לאחרונה: {dt(d.lastSeenAt)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {!d.approved && <button onClick={() => approve(d.id)} style={primary}>אישור</button>}
                  {d.approved && <button onClick={() => revoke(d.id)} style={danger}>ביטול אישור</button>}
                  {d.revokedAt && <button onClick={() => approve(d.id)} style={btn}>אישור מחדש</button>}
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
const primary: CSSProperties = { padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const danger: CSSProperties = { padding: '8px 16px', background: '#fff', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, cursor: 'pointer' };
