'use client';
// users/page.tsx — מסך ניהול משתמשים והרשאות (מוגן).
// נגיש רק למשתמש עם הרשאת "ניהול משתמשים והרשאות". אפשר לראות את כל המשתמשים ולשנות תפקיד.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe,
  getToken,
  logout,
  listUsers,
  listRoles,
  setUserRole,
  hasPermission,
  type AuthUser,
  type ManagedUser,
  type RoleInfo,
} from '@/lib/api';
import ActivityLog from '@/components/ActivityLog';

export default function UsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [logUser, setLogUser] = useState<ManagedUser | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    getMe()
      .then((u) => {
        setMe(u);
        if (!hasPermission(u, 'users.manage')) {
          setDenied(true);
          return;
        }
        return Promise.all([listUsers(), listRoles()]).then(([us, r]) => {
          setUsers(us);
          setRoles(r.roles);
          setLabels(r.labels);
        });
      })
      .catch(() => {
        logout();
        router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function onRoleChange(userId: string, roleKey: string): Promise<void> {
    setSavingId(userId);
    setRowMsg((m) => ({ ...m, [userId]: '' }));
    try {
      const updated = await setUserRole(userId, roleKey);
      setUsers((list) => list.map((u) => (u.id === userId ? updated : u)));
      setRowMsg((m) => ({ ...m, [userId]: '✓ נשמר' }));
    } catch (e: any) {
      setRowMsg((m) => ({ ...m, [userId]: e.message || 'שגיאה' }));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <main style={{ maxWidth: 980, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;
  }

  const card = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 16 };

  if (denied) {
    return (
      <main style={{ maxWidth: 980, margin: '40px auto', padding: 24 }}>
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
          <p style={{ color: 'var(--muted)' }}>הדף הזה זמין רק למשתמשים עם הרשאת ניהול משתמשים.</p>
          <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
        </section>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: 'var(--accent)', marginBottom: 4 }}>ניהול משתמשים והרשאות</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>{users.length} משתמשים במערכת</p>
        </div>
        <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
      </div>

      <section style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
          <thead>
            <tr style={{ color: 'var(--muted)', fontSize: 14 }}>
              <th style={th}>שם</th>
              <th style={th}>מייל</th>
              <th style={th}>תפקיד</th>
              <th style={th}>2FA</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = me?.id === u.id;
              return (
                <tr key={u.id} style={{ borderTop: '1px solid #eef2f7' }}>
                  <td style={td}>{u.name} {isMe && <span style={{ color: 'var(--muted)', fontSize: 12 }}>(אני)</span>}</td>
                  <td style={td}>{u.email}</td>
                  <td style={td}>
                    <select
                      value={u.roleKey ?? ''}
                      disabled={savingId === u.id}
                      onChange={(e) => onRoleChange(u.id, e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', minWidth: 150 }}
                    >
                      {roles.map((r) => (
                        <option key={r.key ?? r.id} value={r.key ?? ''}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td style={td}>{u.twoFactorEnabled ? 'פעיל' : '—'}</td>
                  <td style={{ ...td, fontSize: 13, whiteSpace: 'nowrap' }}>
                    {hasPermission(me, 'logs.view') && <button onClick={() => setLogUser(u)} style={logBtn}>פעילות</button>}
                    <span style={{ color: rowMsg[u.id]?.startsWith('✓') ? '#15803d' : '#b91c1c', marginInlineStart: 6 }}>{rowMsg[u.id]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>התפקידים וההרשאות שלהם</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: 14 }}>
          ברירת המחדל היא תמיד "אין גישה" — לכל תפקיד ניתנות בדיוק ההרשאות שמופיעות לידו.
        </p>
        <ul style={{ lineHeight: 1.9, margin: 0, paddingInlineStart: 18 }}>
          {roles.map((r) => (
            <li key={r.key ?? r.id}>
              <strong>{r.name}</strong>
              {r.description ? <span style={{ color: 'var(--muted)' }}> — {r.description}</span> : null}
              <div style={{ fontSize: 13, color: '#475569' }}>
                {r.isOwner ? 'כל ההרשאות' : r.permissions.map((p) => labels[p] ?? p).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {logUser && <ActivityLog title={`משתמש: ${logUser.name}`} filter={{ userId: logUser.id }} onClose={() => setLogUser(null)} />}
    </main>
  );
}

const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const th: CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const td: CSSProperties = { padding: '10px 6px', verticalAlign: 'middle' };
const logBtn: CSSProperties = { padding: '4px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
