import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import InvoiceListPage from './pages/InvoiceListPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import { MainLayout } from './components/layout';
import ReimbursementListPage from './pages/ReimbursementListPage';
import DashboardPage from './pages/DashboardPage';
import UserManagementPage from './pages/UserManagementPage';
import ReimbursementDetailPage from './pages/ReimbursementDetailPage';
import ProjectManagementPage from './pages/ProjectManagementPage';
import BankCardPage from './pages/BankCardPage';
import ApplicationPage from './pages/ApplicationPage';
import RuleEnginePage from './pages/RuleEnginePage';
import ProfilePage from './pages/ProfilePage';
import BorrowingPage from './pages/BorrowingPage';
import CarbonFootprintPage from './pages/CarbonFootprintPage';
import AuditTrailPage from './pages/AuditTrailPage';
import AIObservatoryPage from './pages/AIObservatoryPage';
import AuthPage from './pages/AuthPage';

function AppContent() {
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        localStorage.removeItem('currentUser');
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'X-Session-Token': token },
        });
        if (!res.ok) throw new Error('session expired');
        const data = await res.json();
        setCurrentUser(data.user);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
      } catch {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('currentUser');
      }
    };

    initAuth();
  }, []);

  const handleLoginSuccess = (user: any) => {
    localStorage.setItem('currentUser', JSON.stringify(user));
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('currentUser');
    setCurrentUser(null);
  };

  const handleUserUpdate = (user: any) => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', JSON.stringify(user));
  };

  if (!currentUser) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <MainLayout
      currentUser={currentUser}
      onLogout={handleLogout}
    >
      <Routes>
        <Route path="/" element={currentUser.role === 'admin' ? <Navigate to="/dashboard" replace /> : <InvoiceListPage />} />
        <Route path="/invoices" element={<InvoiceListPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/profile" element={<ProfilePage currentUser={currentUser} onUserUpdate={handleUserUpdate} />} />
        <Route path="/borrowings" element={<BorrowingPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/reimbursements" element={<ReimbursementListPage />} />
        <Route path="/reimbursements/:id" element={<ReimbursementDetailPage />} />
        <Route path="/carbon-footprint" element={<CarbonFootprintPage />} />
        {currentUser.role !== 'admin' ? (
          <Route path="/bank-cards" element={<BankCardPage />} />
        ) : (
          <Route path="/bank-cards" element={<Navigate to="/" replace />} />
        )}
        <Route path="/applications" element={<ApplicationPage />} />

        {currentUser.role === 'admin' ? (
          <Route path="/dashboard" element={<DashboardPage />} />
        ) : (
           <Route path="/dashboard" element={<Navigate to="/" replace />} />
        )}
        {currentUser.role === 'admin' ? (
          <Route path="/users" element={<UserManagementPage />} />
        ) : (
           <Route path="/users" element={<Navigate to="/" replace />} />
        )}
        {currentUser.role === 'admin' ? (
          <Route path="/projects" element={<ProjectManagementPage />} />
        ) : (
           <Route path="/projects" element={<Navigate to="/" replace />} />
        )}
        {currentUser.role === 'admin' ? (
          <Route path="/approval-rules" element={<RuleEnginePage />} />
        ) : (
           <Route path="/approval-rules" element={<Navigate to="/" replace />} />
        )}
        {currentUser.role === 'admin' ? (
          <Route path="/audit-trail" element={<AuditTrailPage />} />
        ) : (
           <Route path="/audit-trail" element={<Navigate to="/" replace />} />
        )}
        {currentUser.role === 'admin' ? (
          <Route path="/ai-observatory" element={<AIObservatoryPage />} />
        ) : (
           <Route path="/ai-observatory" element={<Navigate to="/" replace />} />
        )}
      </Routes>
    </MainLayout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;