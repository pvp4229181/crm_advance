import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/Auth';
import { api } from '../lib/api';

/** Admin signup only exists until the first user is created; after that the link would lead to a dead end. */
export function useSignupOpen() {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ open: boolean }>('/auth/signup-status')
      .then((x) => setOpen(x.open))
      .catch(() => setOpen(false));
  }, []);
  return open;
}

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signupOpen = useSignupOpen();
  if (user) return <Navigate to="/" />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f9ff] p-4">
      <form
        className="w-full max-w-sm rounded border bg-white p-7 shadow"
        onSubmit={submit}
      >
        <Brand />
        <label className="label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="field mb-4"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label className="label" htmlFor="login-password">
          Password
        </label>
        <div className="relative">
          <input
            id="login-password"
            className="field pr-10"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="absolute right-0 top-0 flex h-9 w-10 items-center justify-center text-slate-500 hover:text-[#0284c7]"
            onClick={() => setShow((x) => !x)}
            aria-label={show ? 'Hide password' : 'Show password'}
            title={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {error && (
          <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">
            {error}
          </p>
        )}
        <button className="btn btn-primary mt-5 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {signupOpen && (
          <div className="mt-5 border-t pt-4 text-center text-xs text-slate-500">
            Setting up a new workspace?{' '}
            <Link
              className="font-semibold text-[#0284c7] hover:underline"
              to="/signup"
            >
              Create administrator
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}

export function Brand() {
  return (
    <div className="mb-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded bg-[#0284c7] font-bold text-white">
        L
      </div>
      <h1 className="text-xl font-semibold">Lead CRM</h1>
      <p className="mt-1 text-xs text-slate-500">Your sales workspace</p>
    </div>
  );
}
