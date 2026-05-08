import { lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/shared/ProtectedRoute'

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const LogsPage = lazy(() => import('@/pages/LogsPage').then((m) => ({ default: m.LogsPage })))
const NodesPage = lazy(() => import('@/pages/NodesPage').then((m) => ({ default: m.NodesPage })))
const RoutingPage = lazy(() => import('@/pages/RoutingPage').then((m) => ({ default: m.RoutingPage })))
const BudgetPage = lazy(() => import('@/pages/BudgetPage').then((m) => ({ default: m.BudgetPage })))
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })))
const ExperimentPage = lazy(() => import('@/pages/ExperimentPage').then((m) => ({ default: m.ExperimentPage })))
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeysPage').then((m) => ({ default: m.ApiKeysPage })))
const ShadowPage = lazy(() => import('@/pages/ShadowPage').then((m) => ({ default: m.ShadowPage })))
const RouteExplanationPage = lazy(() => import('@/pages/RouteExplanationPage').then((m) => ({ default: m.RouteExplanationPage })))
const ConfigAuditPage = lazy(() => import('@/pages/ConfigAuditPage').then((m) => ({ default: m.ConfigAuditPage })))
const ManagementAuditPage = lazy(() => import('@/pages/ManagementAuditPage').then((m) => ({ default: m.ManagementAuditPage })))
const BenchmarkPage = lazy(() => import('@/pages/BenchmarkPage').then((m) => ({ default: m.BenchmarkPage })))
const BatchesPage = lazy(() => import('@/pages/BatchesPage').then((m) => ({ default: m.BatchesPage })))
const EvalReportsPage = lazy(() => import('@/pages/EvalReportsPage').then((m) => ({ default: m.EvalReportsPage })))
const ProviderCatalogPage = lazy(() => import('@/pages/ProviderCatalogPage').then((m) => ({ default: m.ProviderCatalogPage })))
const PlaygroundPage = lazy(() => import('@/pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })))
const SessionsPage = lazy(() => import('@/pages/SessionsPage').then((m) => ({ default: m.SessionsPage })))
const McpGatewayPage = lazy(() => import('@/pages/McpGatewayPage').then((m) => ({ default: m.McpGatewayPage })))
const AgentProfilesPage = lazy(() => import('@/pages/AgentProfilesPage').then((m) => ({ default: m.AgentProfilesPage })))
const MembersPage = lazy(() => import('@/pages/MembersPage').then((m) => ({ default: m.MembersPage })))

function RouteFallback() {
  return (
    <div className="space-y-5 p-6">
      <div className="h-4 w-36 animate-shimmer rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-shimmer rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function page(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={page(<LoginPage />)} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={page(<DashboardPage />)} />
        <Route path="/logs" element={page(<LogsPage />)} />
        <Route path="/nodes" element={page(<NodesPage />)} />
        <Route path="/catalog" element={page(<ProviderCatalogPage />)} />
        <Route path="/routing" element={page(<RoutingPage />)} />
        <Route path="/budget" element={page(<BudgetPage />)} />
        <Route path="/api-keys" element={page(<ApiKeysPage />)} />
        <Route path="/analytics" element={page(<AnalyticsPage />)} />
        <Route path="/experiments" element={page(<ExperimentPage />)} />
        <Route path="/shadow" element={page(<ShadowPage />)} />
        <Route path="/sessions" element={page(<SessionsPage />)} />
        <Route path="/sessions/:sessionId" element={page(<SessionsPage />)} />
        <Route path="/route-decisions" element={page(<RouteExplanationPage />)} />
        <Route path="/route-decisions/:requestId" element={page(<RouteExplanationPage />)} />
        <Route path="/playground" element={page(<PlaygroundPage />)} />
        <Route path="/mcp" element={page(<McpGatewayPage />)} />
        <Route path="/agents" element={page(<AgentProfilesPage />)} />
        <Route path="/members" element={page(<MembersPage />)} />
        <Route path="/audit" element={page(<ManagementAuditPage />)} />
        <Route path="/config-audit" element={page(<ConfigAuditPage />)} />
        <Route path="/benchmarks" element={page(<BenchmarkPage />)} />
        <Route path="/batches" element={page(<BatchesPage />)} />
        <Route path="/evals" element={page(<EvalReportsPage />)} />
        <Route path="/evals/:runId" element={page(<EvalReportsPage />)} />
      </Route>
    </Routes>
  )
}
