import { FormEvent, useMemo, useState } from 'react';
import {
  completePasswordReset,
  login,
  requestEmailVerification,
  requestPasswordReset,
  signup,
  type CurrentUser,
} from '../api.ts';

type Mode = 'login' | 'signup' | 'reset';

interface Props {
  onAuthenticated: (user: CurrentUser) => void;
}

export function AuthGate({ onAuthenticated }: Props) {
  const resetToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return window.location.pathname === '/auth/password/reset' ? params.get('token') ?? '' : '';
  }, []);
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [token, setToken] = useState(resetToken);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(resetToken ? 'Choose a new password.' : null);
  const [error, setError] = useState<string | null>(null);

  const submitLogin = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const res = await login(email, password);
    setBusy(false);
    if ('error' in res) {
      if (res.error === 'email_not_verified') {
        await requestEmailVerification(email);
        setMessage('Email verification required. Check the server log for the link.');
      } else {
        setError(labelError(res.error));
      }
      return;
    }
    onAuthenticated(res.user);
  };

  const submitSignup = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signup(email, password);
    setBusy(false);
    if ('error' in res) {
      setError(labelError(res.error));
      return;
    }
    setMode('login');
    setMessage('Account created. Check the server log for the verification link, then sign in.');
    setPassword('');
  };

  const submitResetRequest = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    await requestPasswordReset(resetEmail || email);
    setBusy(false);
    setMessage('If that account exists, a reset link was sent.');
  };

  const submitResetComplete = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const res = await completePasswordReset(token, password);
    setBusy(false);
    if ('error' in res) {
      setError(labelError(res.error));
      return;
    }
    window.history.replaceState({}, '', '/');
    setMode('login');
    setMessage('Password updated. Sign in with the new password.');
    setPassword('');
    setToken('');
  };

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <h1>EVE Fleet Dashboard</h1>
          <p>Sign in to manage your linked pilots.</p>
        </div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(null); }}>Sign in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(null); }}>Create account</button>
          <button className={mode === 'reset' ? 'active' : ''} onClick={() => { setMode('reset'); setError(null); }}>Reset password</button>
        </div>

        {message && <div className="auth-note">{message}</div>}
        {error && <div className="auth-error">{error}</div>}

        {mode === 'login' && (
          <form className="auth-form" onSubmit={submitLogin}>
            <label>Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required /></label>
            <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required minLength={8} /></label>
            <button className="primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
          </form>
        )}

        {mode === 'signup' && (
          <form className="auth-form" onSubmit={submitSignup}>
            <label>Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required /></label>
            <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" required minLength={8} /></label>
            <button className="primary" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
          </form>
        )}

        {mode === 'reset' && !token && (
          <form className="auth-form" onSubmit={submitResetRequest}>
            <label>Email<input value={resetEmail} onChange={e => setResetEmail(e.target.value)} type="email" autoComplete="email" required /></label>
            <button className="primary" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
          </form>
        )}

        {mode === 'reset' && token && (
          <form className="auth-form" onSubmit={submitResetComplete}>
            <label>Reset token<input value={token} onChange={e => setToken(e.target.value)} required /></label>
            <label>New password<input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" required minLength={8} /></label>
            <button className="primary" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button>
          </form>
        )}
      </section>
    </main>
  );
}

function labelError(error: string): string {
  switch (error) {
    case 'invalid_credentials': return 'Email or password is incorrect.';
    case 'email_already_registered': return 'That email is already registered.';
    case 'invalid_or_expired_token': return 'That link is invalid or expired.';
    case 'account_not_active': return 'That account is not active.';
    default: return error.replaceAll('_', ' ');
  }
}
