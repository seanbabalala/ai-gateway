import { useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

/**
 * Returns resolved CSS variable hex values for use in Recharts, SVG, and inline styles.
 * Reads computed values from the DOM so they always match the active theme.
 */
export function useThemeColors() {
  const { resolved } = useTheme()

  return useMemo(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()

    return {
      background: get('--background'),
      backgroundSecondary: get('--background-secondary'),
      backgroundTertiary: get('--background-tertiary'),
      foreground: get('--foreground'),
      foregroundMuted: get('--foreground-muted'),
      foregroundDim: get('--foreground-dim'),
      border: get('--border'),
      borderHover: get('--border-hover'),
      accent: get('--accent'),
      accentHover: get('--accent-hover'),
      // Gauge-specific
      gaugeBg: get('--gauge-bg'),
      gaugeText: get('--gauge-text'),
      gaugeSubtext: get('--gauge-subtext'),
      // Chart-specific
      chartTooltipBg: get('--chart-tooltip-bg'),
      chartTooltipBorder: get('--chart-tooltip-border'),
      chartAxisTick: get('--chart-axis-tick'),
      chartAxisLine: get('--chart-axis-line'),
      chartTooltipText: get('--chart-tooltip-text'),
    }
    // Re-compute when theme changes
  }, [resolved])
}

/**
 * Returns a hex color with appended alpha suffix (e.g. '#10b981' + '20' → '#10b98120').
 * Works for inline styles with hex+alpha colors.
 */
export function colorWithOpacity(hex: string, alphaSuffix: string): string {
  return hex + alphaSuffix
}
