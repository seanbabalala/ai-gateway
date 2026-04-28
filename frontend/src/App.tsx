import { Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/shared/ProtectedRoute'
import { DashboardPage } from '@/pages/DashboardPage'
import { LogsPage } from '@/pages/LogsPage'
import { NodesPage } from '@/pages/NodesPage'
import { RoutingPage } from '@/pages/RoutingPage'
import { BudgetPage } from '@/pages/BudgetPage'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { ExperimentPage } from '@/pages/ExperimentPage'
import { LoginPage } from '@/pages/LoginPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/routing" element={<RoutingPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/experiments" element={<ExperimentPage />} />
      </Route>
    </Routes>
  )
}
