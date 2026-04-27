import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function AppLayout() {
  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--background)]">
      {/* Ambient background mesh */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-1/4 -right-1/4 h-[600px] w-[600px] rounded-full opacity-[0.03]"
          style={{
            background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute -bottom-1/4 -left-1/4 h-[500px] w-[500px] rounded-full opacity-[0.02]"
          style={{
            background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)',
          }}
        />
      </div>

      {/* App shell */}
      <Sidebar />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="noise-overlay relative flex-1 overflow-y-auto px-8 py-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
