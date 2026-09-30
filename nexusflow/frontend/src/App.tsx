import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { useWebSocket } from './hooks/useWebSocket';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PipelinesPage } from './pages/PipelinesPage';
import { PipelineDetailPage } from './pages/PipelineDetailPage';
import { TasksPage } from './pages/TasksPage';
import { QueuePage } from './pages/QueuePage';
import { WorkersPage } from './pages/WorkersPage';

/** Inner app — requires auth context */
function AppRoutes() {
  const { isAuthenticated } = useAuth();
  const { connected, feed } = useWebSocket();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Layout wsConnected={connected}>
      <Routes>
        <Route path="/" element={<DashboardPage wsConnected={connected} feed={feed} />} />
        <Route path="/pipelines" element={<PipelinesPage />} />
        <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/workers" element={<WorkersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
