'use client';
// account/page.tsx — החשבון שלי: אימות דו-שלבי (מייל) ושינוי סיסמה.
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { changePassword, getToken, getMe, enable2fa, confirm2fa, disable2fa, PASSWORD_HINT, type AuthUser } from '@/lib/api';

const inputStyle: CSSProperties = { width: '100%', padding: '10px 12px', marginTop: 6, marginBottom: 14, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 15 };
const card: CSSProperties = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginTop: 16 };
const primaryBtn: CSSProperties = { width: '100%', padding: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, cursor: 'pointer' };
const secondaryBtn: CSSProperties = { ...primaryBtn, background: '#fff', color: 'var(--accent)', border: '1px solid #cbd5e1' };

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  // שינוי סיסמה
  const [current, setCurrent] = useState('');
  const [next1, setNext1] = useState('');
  const [next2, setNext2] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwDone, setPwDone] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  // אימות דו-שלבי
  const [step, setStep] = useState<'idle' | 'confirming' | 'disabling'>('idle');
  const [code, setCode] = useState('');
  const [tfaPassword, setTfaPassword] = useState('');
  const [tfaError, setTfaError] = useState('');
  const [tfaMsg, setTfaMsg] = useState('');
  const [tfaBusy, setTfaBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    getMe().then(setUser).catch(() => router.replace('/login'));
  }, [router]);

  async function submitPassword(e: FormEvent): Promise<void> {
    e.preventDefault();
    setPwError('');
    setPwDone(false);
    if (next1 !== next2) {
      setPwError('הסיסמה החדשה והאישור אינם תואמים');
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(current, next1);
      setPwDone(true);
      setCurrent('');
      setNext1('');
      setNext2('');
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  }

  async function startEnable(): Promise<void> {
    setTfaError('');
    setTfaMsg('');
    setTfaBusy(true);
    try {
      await enable2fa();
      setStep('confirming');
      setTfaMsg('שלחנו קוד למייל שלך. הזן אותו כאן כדי להפעיל.');
    } catch (err) {
      setTfaError((err as Error).message);
    } finally {
      setTfaBusy(false);
    }
  }

  async function confirmEnable(e: FormEvent): Promise<void> {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      await confirm2fa(code);
      setCode('');
      setStep('idle');
      setTfaMsg('אימות דו-שלבי הופעל.');
      setUser(await getMe());
    } catch (err) {
      setTfaError((err as Error).message);
    } finally {
      setTfaBusy(false);
    }
  }

  async function submitDisable(e: FormEvent): Promise<void> {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      await disable2fa(tfaPassword);
      setTfaPassword('');
      setStep('idle');
      setTfaMsg('אימות דו-שלבי כובה.');
      setUser(await getMe());
    } catch (err) {
      setTfaError((err as Error).message);
    } finally {
      setTfaBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 440, margin: '50px auto', padding: 24 }}>
      <h1 style={{ color: 'var(--accent)' }}>החשבון שלי</h1>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>אימות דו-שלבי (קוד במייל)</h2>
        {tfaMsg && <p style={{ color: '#15803d' }}>{tfaMsg}</p>}
        {tfaError && <p style={{ color: '#b91c1c' }}>{tfaError}</p>}

        {user?.twoFactorEnabled ? (
          step === 'disabling' ? (
            <form onSubmit={submitDisable}>
              <label>אישור סיסמה כדי לכבות</label>
              <input style={inputStyle} type="password" value={tfaPassword} onChange={(e) => setTfaPassword(e.target.value)} required autoComplete="current-password" />
              <button type="submit" disabled={tfaBusy} style={primaryBtn}>{tfaBusy ? 'רגע…' : 'כבה אימות דו-שלבי'}</button>
            </form>
          ) : (
            <>
              <p>הסטטוס: <b style={{ color: '#15803d' }}>פעיל</b>. בכל כניסה יישלח קוד למייל שלך.</p>
              <button onClick={() => { setStep('disabling'); setTfaMsg(''); setTfaError(''); }} style={secondaryBtn}>כבה אימות דו-שלבי</button>
            </>
          )
        ) : step === 'confirming' ? (
          <form onSubmit={confirmEnable}>
            <label>הזן את הקוד שנשלח למייל</label>
            <input style={{ ...inputStyle, textAlign: 'center', letterSpacing: 6, fontSize: 20 }} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={6} autoFocus />
            <button type="submit" disabled={tfaBusy} style={primaryBtn}>{tfaBusy ? 'רגע…' : 'אשר והפעל'}</button>
          </form>
        ) : (
          <>
            <p style={{ color: 'var(--muted)' }}>הסטטוס: כבוי. כשמפעילים, בכל כניסה יישלח קוד חד-פעמי למייל שלך.</p>
            <button onClick={startEnable} disabled={tfaBusy} style={primaryBtn}>{tfaBusy ? 'רגע…' : 'הפעל אימות דו-שלבי במייל'}</button>
          </>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>שינוי סיסמה</h2>
        <form onSubmit={submitPassword}>
          <label>סיסמה נוכחית</label>
          <input style={inputStyle} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          <label>סיסמה חדשה</label>
          <input style={inputStyle} type="password" value={next1} onChange={(e) => setNext1(e.target.value)} required autoComplete="new-password" />
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -8, marginBottom: 12 }}>{PASSWORD_HINT}</p>
          <label>אישור סיסמה חדשה</label>
          <input style={inputStyle} type="password" value={next2} onChange={(e) => setNext2(e.target.value)} required autoComplete="new-password" />
          {pwError && <p style={{ color: '#b91c1c', marginTop: 0 }}>{pwError}</p>}
          {pwDone && <p style={{ color: '#15803d', marginTop: 0 }}>הסיסמה עודכנה בהצלחה.</p>}
          <button type="submit" disabled={pwBusy} style={primaryBtn}>{pwBusy ? 'רגע…' : 'עדכן סיסמה'}</button>
        </form>
      </section>

      <p style={{ textAlign: 'center', marginTop: 16 }}>
        <button type="button" onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: 'var(--accent2)', cursor: 'pointer', fontSize: 15, textDecoration: 'underline' }}>
          חזרה ללוח הבקרה
        </button>
      </p>
    </main>
  );
}
