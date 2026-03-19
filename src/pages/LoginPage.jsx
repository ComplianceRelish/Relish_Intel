import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName);
        setSignupSuccess(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/android-icon-192x192.png"
            alt="Relish"
            className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-lg shadow-indigo-500/30"
          />
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Relish Market Intelligence
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            CalciWorks · ClamFlow · Trade Intelligence
          </p>
        </div>

        {/* Signup success */}
        {signupSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-6 text-center">
            <p className="text-emerald-400 text-sm font-medium">Account created!</p>
            <p className="text-slate-400 text-xs mt-1">
              Check your email for a confirmation link, then sign in.
            </p>
            <button
              onClick={() => { setMode('login'); setSignupSuccess(false); }}
              className="text-indigo-400 text-xs mt-2 hover:text-indigo-300"
            >
              ← Back to Sign In
            </button>
          </div>
        )}

        {/* Form */}
        {!signupSuccess && (
          <form onSubmit={handleSubmit} className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-5">
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </h2>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            {mode === 'signup' && (
              <div className="mb-4">
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-surface-bg border border-slate-700 text-white text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                />
              </div>
            )}

            <div className="mb-4">
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@relishgroup.in"
                required
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-bg border border-slate-700 text-white text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
              />
            </div>

            <div className="mb-6">
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-bg border border-slate-700 text-white text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:shadow-lg hover:shadow-indigo-500/30 transition-all disabled:opacity-50 disabled:cursor-wait"
            >
              {loading
                ? '⏳ Please wait...'
                : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
            </button>

            <div className="text-center mt-4">
              {mode === 'login' ? (
                <p className="text-xs text-slate-500">
                  No account?{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('signup'); setError(null); }}
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    Create one
                  </button>
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(null); }}
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </form>
        )}

        <p className="text-center text-[10px] text-slate-600 mt-6">
          Relish Group · Market Intelligence Platform v2.0
        </p>
      </div>
    </div>
  );
}
