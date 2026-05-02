import { useState, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
  className?: string
  delayMs?: number
}

export function Tooltip({
  content,
  side = 'top',
  children,
  className,
  delayMs = 200,
}: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const gap = 6

      let top = 0
      let left = 0

      switch (side) {
        case 'top':
          top = rect.top - gap
          left = rect.left + rect.width / 2
          break
        case 'bottom':
          top = rect.bottom + gap
          left = rect.left + rect.width / 2
          break
        case 'left':
          top = rect.top + rect.height / 2
          left = rect.left - gap
          break
        case 'right':
          top = rect.top + rect.height / 2
          left = rect.right + gap
          break
      }

      setPosition({ top, left })
      setVisible(true)
    }, delayMs)
  }, [side, delayMs])

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setVisible(false)
  }, [])

  const transformOrigin = {
    top: 'bottom center',
    bottom: 'top center',
    left: 'center right',
    right: 'center left',
  }[side]

  const translate = {
    top: { x: '-50%', y: '-100%' },
    bottom: { x: '-50%', y: '0%' },
    left: { x: '-100%', y: '-50%' },
    right: { x: '0%', y: '-50%' },
  }[side]

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </span>
      {createPortal(
        <AnimatePresence>
          {visible && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                transform: `translate(${translate.x}, ${translate.y})`,
                transformOrigin,
                zIndex: 99999,
                pointerEvents: 'none',
              }}
              className={cn(
                'max-w-xs rounded-lg bg-[var(--foreground)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--background)] shadow-lg',
                className,
              )}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
