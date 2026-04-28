// ===================================================================
// Frontend Capability Registry — mirrors backend definitions
// ===================================================================
// 10 capability tags with labels, icons, and colors for UI rendering.
// ===================================================================

import {
  Code2, Layout, Server, Brain, BarChart3,
  Sparkles, FileText, Wrench, Zap, Globe, Eye,
  type LucideIcon,
} from 'lucide-react'

export interface CapabilityDef {
  id: string
  label: { en: string; cn: string }
  icon: LucideIcon
  color: string       // Tailwind-compatible color token
  bgClass: string     // Background class for selected state
  borderClass: string // Border class for selected state
  textClass: string   // Text class
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'coding',
    label: { en: 'Coding', cn: '代码编写' },
    icon: Code2,
    color: '#3b82f6',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
    textClass: 'text-blue-700 dark:text-blue-400',
  },
  {
    id: 'coding_frontend',
    label: { en: 'Frontend Dev', cn: '前端开发' },
    icon: Layout,
    color: '#8b5cf6',
    bgClass: 'bg-violet-500/10',
    borderClass: 'border-violet-500/30',
    textClass: 'text-violet-700 dark:text-violet-400',
  },
  {
    id: 'coding_backend',
    label: { en: 'Backend Dev', cn: '后端开发' },
    icon: Server,
    color: '#06b6d4',
    bgClass: 'bg-cyan-500/10',
    borderClass: 'border-cyan-500/30',
    textClass: 'text-cyan-700 dark:text-cyan-400',
  },
  {
    id: 'reasoning',
    label: { en: 'Reasoning & Math', cn: '推理与数学' },
    icon: Brain,
    color: '#ec4899',
    bgClass: 'bg-pink-500/10',
    borderClass: 'border-pink-500/30',
    textClass: 'text-pink-700 dark:text-pink-400',
  },
  {
    id: 'analysis',
    label: { en: 'Analysis', cn: '分析评估' },
    icon: BarChart3,
    color: '#f59e0b',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    textClass: 'text-amber-700 dark:text-amber-400',
  },
  {
    id: 'creative',
    label: { en: 'Creative Writing', cn: '创意写作' },
    icon: Sparkles,
    color: '#f97316',
    bgClass: 'bg-orange-500/10',
    borderClass: 'border-orange-500/30',
    textClass: 'text-orange-700 dark:text-orange-400',
  },
  {
    id: 'long_context',
    label: { en: 'Long Context', cn: '长文本' },
    icon: FileText,
    color: '#10b981',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    textClass: 'text-emerald-700 dark:text-emerald-400',
  },
  {
    id: 'tool_use',
    label: { en: 'Tool Use', cn: '工具调用' },
    icon: Wrench,
    color: '#6366f1',
    bgClass: 'bg-indigo-500/10',
    borderClass: 'border-indigo-500/30',
    textClass: 'text-indigo-700 dark:text-indigo-400',
  },
  {
    id: 'fast',
    label: { en: 'Fast & Cheap', cn: '快速低成本' },
    icon: Zap,
    color: '#eab308',
    bgClass: 'bg-yellow-500/10',
    borderClass: 'border-yellow-500/30',
    textClass: 'text-yellow-700 dark:text-yellow-400',
  },
  {
    id: 'multilingual',
    label: { en: 'Multilingual', cn: '多语言' },
    icon: Globe,
    color: '#14b8a6',
    bgClass: 'bg-teal-500/10',
    borderClass: 'border-teal-500/30',
    textClass: 'text-teal-700 dark:text-teal-400',
  },
  {
    id: 'vision',
    label: { en: 'Vision', cn: '视觉理解' },
    icon: Eye,
    color: '#a855f7',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    textClass: 'text-purple-700 dark:text-purple-400',
  },
]

export const CAPABILITY_MAP: Record<string, CapabilityDef> =
  Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]))
