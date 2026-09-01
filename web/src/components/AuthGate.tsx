import { FormEvent, useMemo, useState } from 'react';
import {
  completePasswordReset,
  login,
  requestEmailVerification,
  requestPasswordReset,
  signup,
  type CurrentUser,
} from '../api.ts';
import './AuthGate.css';

type Mode = 'login' | 'signup' | 'reset';

interface Props {
  onAuthenticated: (user: CurrentUser) => void;
}

export function AuthGate({ onAuthenticated }: Props) {
  const resetToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return window.location.pathname === '/auth/password/reset' ? params.get('token') ?? '' : '';
  }, []);
  const returnTo = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('returnTo');
    return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
  }, []);
  const callbackError = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('auth_error');
    return code ? labelOAuthError(code) : null;
  }, []);
  const destination = useMemo(() => {
    if (window.location.pathname.startsWith('/auth/')) return returnTo;
    const destinationParams = new URLSearchParams(window.location.search);
    destinationParams.delete('auth_error');
    const query = destinationParams.toString();
    return `${window.location.pathname}${query ? `?${query}` : ''}`;
  }, [returnTo]);
  const googleStartUrl = useMemo(() => {
    return `/auth/google/start?${new URLSearchParams({ returnTo: destination }).toString()}`;
  }, [destination]);
  const eveStartUrl = useMemo(() => `/auth/eve/start?${new URLSearchParams({
    intent: 'account',
    returnTo: destination,
  }).toString()}`, [destination]);
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [token, setToken] = useState(resetToken);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(resetToken ? 'Choose a new password.' : null);
  const [error, setError] = useState<string | null>(callbackError);

  const finishAuthenticated = (user: CurrentUser) => {
    onAuthenticated(user);
    window.history.replaceState({}, '', returnTo);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

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
    finishAuthenticated(res.user);
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
        </div>

        {message && <div className="auth-note">{message}</div>}
        {error && <div className="auth-error">{error}</div>}

        <div className="auth-provider-actions" aria-label="Account providers">
          <a className="eve-auth-button" href={eveStartUrl}>Continue with EVE</a>
          <a className="google-auth-button" href={googleStartUrl}>Continue with Google</a>
        </div>

        {mode === 'login' && (
          <form className="auth-form" onSubmit={submitLogin}>
            <label>Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required /></label>
            <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required minLength={8} /></label>
            <button className="auth-link-button" type="button" onClick={() => { setMode('reset'); setError(null); }}>
              Forgot password?
            </button>
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

function labelOAuthError(error: string): string {
  switch (error) {
    case 'eve_owner_mismatch':
      return 'This EVE character no longer matches the account owner. Contact support to recover access.';
    case 'character_linked_elsewhere':
      return 'This EVE character is already linked to another account.';
    case 'account_not_active':
      return 'That account is not active.';
    case 'eve_auth_failed':
      return 'EVE authentication could not be completed. Please try again.';
    default:
      return 'EVE authentication could not be completed. Please try again.';
  }
}
