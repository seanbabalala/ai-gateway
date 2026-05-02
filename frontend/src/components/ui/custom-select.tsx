import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

interface CustomSelectProps {
  options: SelectOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function CustomSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
}: CustomSelectProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const selectedOption = options.find((o) => o.value === value)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const dropdownHeight = Math.min(options.length * 36 + 16, 280)
    const showAbove = spaceBelow < dropdownHeight && rect.top > dropdownHeight

    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(showAbove
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      zIndex: 9999,
    })
  }, [options.length])

  const openDropdown = useCallback(() => {
    if (disabled) return
    updatePosition()
    setOpen(true)
    const idx = options.findIndex((o) => o.value === value)
    setFocusedIndex(idx >= 0 ? idx : 0)
  }, [disabled, updatePosition, options, value])

  const closeDropdown = useCallback(() => {
    setOpen(false)
    setFocusedIndex(-1)
    triggerRef.current?.focus()
  }, [])

  const selectOption = useCallback(
    (opt: SelectOption) => {
      onChange?.(opt.value)
      closeDropdown()
    },
    [onChange, closeDropdown],
  )

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        listRef.current?.contains(e.target as Node)
      ) {
        return
      }
      closeDropdown()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open, closeDropdown])

  // Scroll/resize repositioning
  useEffect(() => {
    if (!open) return
    const reposition = () => updatePosition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, updatePosition])

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openDropdown()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => (prev + 1) % options.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => (prev - 1 + options.length) % options.length)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < options.length) {
          selectOption(options[focusedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        closeDropdown()
        break
      case 'Home':
        e.preventDefault()
        setFocusedIndex(0)
        break
      case 'End':
        e.preventDefault()
        setFocusedIndex(options.length - 1)
        break
      default:
        // First-letter jump
        if (e.key.length === 1) {
          const char = e.key.toLowerCase()
          const startIndex = focusedIndex + 1
          const idx = options.findIndex(
            (o, i) => i >= startIndex && o.label.toLowerCase().startsWith(char),
          )
          if (idx >= 0) setFocusedIndex(idx)
          else {
            const wrapIdx = options.findIndex((o) =>
              o.label.toLowerCase().startsWith(char),
            )
            if (wrapIdx >= 0) setFocusedIndex(wrapIdx)
          }
        }
    }
  }

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusedIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll('[data-option]')
    items[focusedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex, open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-lg bg-[var(--background-secondary)] px-3.5 py-1 text-[13px] text-[var(--foreground)] shadow-[0_1px_2px_rgba(5,46,36,0.05)] transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]',
          'hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(5,46,36,0.09)]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          open && 'ring-2 ring-[var(--accent-muted)] shadow-[0_14px_32px_rgba(5,46,36,0.09)]',
          className,
        )}
      >
        <span className={cn(!selectedOption && 'text-[var(--foreground-dim)]')}>
          {selectedOption?.label ?? placeholder ?? t('form.selectPlaceholder')}
        </span>
        <ChevronDown
          className={cn(
            'ml-2 h-3.5 w-3.5 shrink-0 text-[var(--foreground-dim)] transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={listRef}
              role="listbox"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              onKeyDown={handleKeyDown}
              style={dropdownStyle}
              className="overflow-hidden rounded-lg bg-[var(--background-secondary)] shadow-[0_22px_58px_rgba(5,46,36,0.16)]"
            >
              <div className="max-h-[264px] overflow-y-auto p-1">
                {options.map((opt, i) => {
                  const isSelected = opt.value === value
                  const isFocused = i === focusedIndex
                  return (
                    <div
                      key={opt.value}
                      data-option
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => selectOption(opt)}
                      onMouseEnter={() => setFocusedIndex(i)}
                      className={cn(
                        'flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors duration-100',
                        isFocused && 'bg-[var(--accent-muted)]',
                        isSelected
                          ? 'font-medium text-[var(--accent)]'
                          : 'text-[var(--foreground-muted)]',
                      )}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && (
                        <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                      )}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
