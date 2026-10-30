export default function HomeScreen({ displayName, onLogout }) {
  return (
    <div id="home-screen">
      <nav className="navbar">
        <img src="/images/Rsystems_Logo_Purple.png" alt="R Systems" className="nav-logo" />
        <span className="nav-tagline">For Care Coordinators &amp; Providers</span>
      </nav>
      <main className="home-main">
        <section className="hero">
          <div className="hero-badge">AI-Powered FHIR Assistant</div>
          <h1 className="hero-heading">Streamline Your<br /><span className="teal">Care Coordination</span></h1>
          <p className="hero-sub">Access patient records, lab results, medications, and clinical history instantly — powered by AI and FHIR R4 integration.</p>
        </section>
        <section className="features">
          <div className="feat-card">
            <div className="feat-icon teal-bg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3>Instant Record Retrieval</h3>
            <p>Search patient records, diagnoses, and procedures in seconds using natural language.</p>
          </div>
          <div className="feat-card">
            <div className="feat-icon blue-bg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3>HIPAA Compliant &amp; Secure</h3>
            <p>Bearer token authentication with secure FHIR R4 APIs. No patient data stored on servers.</p>
          </div>
          <div className="feat-card">
            <div className="feat-icon purple-bg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <h3>AI-Powered Insights</h3>
            <p>GPT-powered analysis of lab results and vitals with normal range flags and clinical context.</p>
          </div>
          <div className="feat-card">
            <div className="feat-icon green-bg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3>Comprehensive Reports</h3>
            <p>Generate discharge summaries, medication lists, and encounter histories on demand.</p>
          </div>
        </section>
      </main>
      <button className="logout-btn-fixed" onClick={onLogout}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Log Out
      </button>
    </div>
  );
}
