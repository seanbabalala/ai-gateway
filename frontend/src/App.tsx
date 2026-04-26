import { Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { LogsPage } from '@/pages/LogsPage'
import { NodesPage } from '@/pages/NodesPage'
import { RoutingPage } from '@/pages/RoutingPage'
import { BudgetPage } from '@/pages/BudgetPage'

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/routing" element={<RoutingPage />} />
        <Route path="/budget" element={<BudgetPage />} />
      </Route>
    </Routes>
  )
}
