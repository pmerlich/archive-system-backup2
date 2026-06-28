'use client';
// login/page.tsx — כניסה והרשמה, כולל שלב שני של אימות דו-שלבי (קוד מהמייל).
import { useState, type FormEvent, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { login, register, verifyLoginOtp, PASSWORD_HINT } from '@/lib/api';

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  marginTop: 6,
  marginBottom: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  fontSize: 15,
};
const primaryBtn: CSSProperties = {
  width: '100%',
  padding: 12,
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 16,
  cursor: 'pointer',
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState('');

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') {
        await register(email, name, password);
        router.push('/');
        return;
      }
      const res = await login(email, password);
      if (res.twoFactorRequired) setTwoFactor(true);
      else router.push('/');
    } catch (err) {
      setError((err as Error).message || 'שגיאה');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifyLoginOtp(email, code);
      router.push('/');
    } catch (err) {
      setError((err as Error).message || 'שגיאה');
    } finally {
      setBusy(false);
    }
  }

  if (twoFactor) {
    return (
      <main style={{ maxWidth: 420, margin: '60px auto', padding: 24 }}>
        <h1 style={{ color: 'var(--accent)', textAlign: 'center', marginBottom: 4 }}>מערכת ארכיון</h1>
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 0 }}>אימות דו-שלבי</p>
        <form onSubmit={submitCode} style={{ background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginTop: 16 }}>
          <p style={{ marginTop: 0 }}>שלחנו קוד בן 6 ספרות למייל שלך. הזן אותו כאן:</p>
          <input style={{ ...inputStyle, textAlign: 'center', letterSpacing: 6, fontSize: 20 }} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={6} autoFocus />
          {error && <p style={{ color: '#b91c1c', marginTop: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? 'רגע…' : 'אישור'}</button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 16 }}>
          <button type="button" onClick={() => { setTwoFactor(false); setCode(''); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent2)', cursor: 'pointer', fontSize: 15, textDecoration: 'underline' }}>חזרה</button>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420, margin: '60px auto', padding: 24 }}>
      <h1 style={{ color: 'var(--accent)', textAlign: 'center', marginBottom: 4 }}>מערכת ארכיון</h1>
      <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 0 }}>
        {mode === 'login' ? 'כניסה למערכת' : 'הרשמה'}
      </p>

      <form onSubmit={submit} style={{ background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginTop: 16 }}>
        <label>מייל</label>
        <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />

        {mode === 'register' && (
          <>
            <label>שם</label>
            <input style={inputStyle} type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </>
        )}

        <label>סיסמה</label>
        <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />

        {mode === 'register' && (
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -8, marginBottom: 12 }}>{PASSWORD_HINT}</p>
        )}

        {error && <p style={{ color: '#b91c1c', marginTop: 0 }}>{error}</p>}

        <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'רגע…' : mode === 'login' ? 'כניסה' : 'הרשמה'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 16, color: 'var(--muted)' }}>
        {mode === 'login' ? 'אין לך חשבון? ' : 'כבר יש לך חשבון? '}
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent2)', cursor: 'pointer', fontSize: 15, textDecoration: 'underline' }}>
          {mode === 'login' ? 'להרשמה' : 'לכניסה'}
        </button>
      </p>
    </main>
  );
}
