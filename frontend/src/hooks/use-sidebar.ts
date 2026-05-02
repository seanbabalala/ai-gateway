import { useState, useEffect, useCallback } from 'react'

const SIDEBAR_STORAGE_KEY = 'sidebar-collapsed'
const MOBILE_BREAKPOINT = 768

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [isMobile, setIsMobile] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed))
    } catch {}
  }, [collapsed])

  const toggle = useCallback(() => {
    if (isMobile) {
      setMobileOpen((v) => !v)
    } else {
      setCollapsed((v) => !v)
    }
  }, [isMobile])

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  return {
    collapsed: isMobile ? false : collapsed,
    isMobile,
    mobileOpen,
    toggle,
    closeMobile,
  }
}
