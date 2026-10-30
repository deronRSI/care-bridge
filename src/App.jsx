import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import LoginScreen from './components/LoginScreen';
import HomeScreen from './components/HomeScreen';
import ChatWidget from './components/ChatWidget';
import DashboardPage from './components/DashboardPage';
import { formatDisplayName } from './utils';
import { isSessionExpired, clearSession, getTimeUntilExpiry } from './services/auth';

function SessionGuard({ children, onExpired }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const token = localStorage.getItem('cb_token');
    if (!token) return;

    if (isSessionExpired()) {
      clearSession();
      onExpired();
      if (location.pathname !== '/') navigate('/', { replace: true });
      return;
    }

    const remaining = getTimeUntilExpiry();
    const timer = setTimeout(() => {
      clearSession();
      onExpired();
      alert('Session expired. Please log in again.');
      if (location.pathname !== '/') {
        navigate('/', { replace: true });
      } else {
        window.location.reload();
      }
    }, remaining);

    return () => clearTimeout(timer);
  }, [navigate, location.pathname, onExpired]);

  return children;
}

function MainApp() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const savedToken = localStorage.getItem('cb_token');
    const savedUser = localStorage.getItem('cb_user');
    if (savedToken && savedUser && !isSessionExpired()) {
      setIsLoggedIn(true);
      setUserName(savedUser);
    } else if (savedToken && isSessionExpired()) {
      clearSession();
    }
  }, []);

  const handleLoginSuccess = (name) => {
    setIsLoggedIn(true);
    setUserName(name);
  };

  const handleLogout = () => {
    clearSession();
    setIsLoggedIn(false);
    setUserName('');
  };

  const displayName = userName ? formatDisplayName(userName) : '';

  if (!isLoggedIn) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <>
      <HomeScreen displayName={displayName} onLogout={handleLogout} />
      <ChatWidget displayName={displayName} />
    </>
  );
}

export default function App() {
  const [, forceRender] = useState(0);
  const handleExpired = useCallback(() => forceRender(v => v + 1), []);

  return (
    <BrowserRouter>
      <SessionGuard onExpired={handleExpired}>
        <Routes>
          <Route path="/" element={<MainApp />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </SessionGuard>
    </BrowserRouter>
  );
}
