import { useState } from 'react';
import { doLogin } from '../services/auth';

export default function LoginScreen({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    setShowOverlay(true);

    try {
      const name = await doLogin(email, password);
      setShowOverlay(false);
      onLoginSuccess(name);
    } catch (err) {
      setShowOverlay(false);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="login-screen">
      <div className="login-topbar">
        <img src="/images/Rsystems_Logo_Purple.png" alt="R Systems" className="rsi-logo" />
        <span className="login-topbar-badge">For Care Coordinators &amp; Providers</span>
      </div>
      <div className="login-body">
        <div className="login-left">
          <div className="login-content">
            <h1 className="login-heading">Instant <span className="teal">Patient Insights</span><br />for Care Teams</h1>
            <p className="login-desc">Give care coordination team instant, secure access to a complete patient view, labs, medications, patient history, and care gaps, <b>Powered by AI</b> and <b>fully integrated with your existing EHR</b>, to act faster, reduce risk, and keep patients on track.</p>
            <form onSubmit={handleSubmit} autoComplete="off">
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input type="email" id="email" placeholder="Enter your email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="pw-wrap">
                  <input type={showPassword ? 'text' : 'password'} id="password" placeholder="Enter your password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="pw-toggle" onClick={() => setShowPassword(!showPassword)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
              </div>
              {error && (
                <div className="error-banner">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}
              <button type="submit" className="launch-btn" disabled={isLoading}>
                <img src="/images/ChatBigIcon.png" alt="" className="btn-icon" />
                <span>{isLoading ? 'Signing in...' : 'Launch Provider Assistant'}</span>
                {isLoading && <span className="spinner"></span>}
              </button>
            </form>
            <p className="login-footer">Secure access for healthcare professionals</p>
          </div>
        </div>
        <div className="login-right">
          <img src="/images/ChatBigIcon.png" alt="CareBridge" className="hero-icon" />
        </div>
      </div>
      {showOverlay && (
        <div className="signin-overlay">
          <div className="signin-box">
            <div className="spinner-dark"></div>
            <p>Signing you in...</p>
          </div>
        </div>
      )}
    </div>
  );
}
