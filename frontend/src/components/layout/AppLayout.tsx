import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useSidebar } from '@/hooks/use-sidebar'

export function AppLayout() {
  const sidebar = useSidebar()
  const location = useLocation()

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--background)]">
      <div className="app-grid-bg pointer-events-none absolute inset-0" />

      <Sidebar
        collapsed={sidebar.collapsed}
        isMobile={sidebar.isMobile}
        mobileOpen={sidebar.mobileOpen}
        onCloseMobile={sidebar.closeMobile}
      />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <Header onToggleSidebar={sidebar.toggle} showHamburger={sidebar.isMobile || sidebar.collapsed} />
        <main className="noise-overlay relative flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-7">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
