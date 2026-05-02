import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import analytics from '@/locales/en/analytics.json'
import apiKeys from '@/locales/en/apiKeys.json'
import budget from '@/locales/en/budget.json'
import common from '@/locales/en/common.json'
import dashboard from '@/locales/en/dashboard.json'
import login from '@/locales/en/login.json'
import logs from '@/locales/en/logs.json'
import nodes from '@/locales/en/nodes.json'
import routing from '@/locales/en/routing.json'
import zhAnalytics from '@/locales/zh/analytics.json'
import zhApiKeys from '@/locales/zh/apiKeys.json'
import zhBudget from '@/locales/zh/budget.json'
import zhCommon from '@/locales/zh/common.json'
import zhDashboard from '@/locales/zh/dashboard.json'
import zhLogin from '@/locales/zh/login.json'
import zhLogs from '@/locales/zh/logs.json'
import zhNodes from '@/locales/zh/nodes.json'
import zhRouting from '@/locales/zh/routing.json'
import zhTWAnalytics from '@/locales/zh-TW/analytics.json'
import zhTWApiKeys from '@/locales/zh-TW/apiKeys.json'
import zhTWBudget from '@/locales/zh-TW/budget.json'
import zhTWCommon from '@/locales/zh-TW/common.json'
import zhTWDashboard from '@/locales/zh-TW/dashboard.json'
import zhTWLogin from '@/locales/zh-TW/login.json'
import zhTWLogs from '@/locales/zh-TW/logs.json'
import zhTWNodes from '@/locales/zh-TW/nodes.json'
import zhTWRouting from '@/locales/zh-TW/routing.json'
import jaAnalytics from '@/locales/ja/analytics.json'
import jaApiKeys from '@/locales/ja/apiKeys.json'
import jaBudget from '@/locales/ja/budget.json'
import jaCommon from '@/locales/ja/common.json'
import jaDashboard from '@/locales/ja/dashboard.json'
import jaLogin from '@/locales/ja/login.json'
import jaLogs from '@/locales/ja/logs.json'
import jaNodes from '@/locales/ja/nodes.json'
import jaRouting from '@/locales/ja/routing.json'
import koAnalytics from '@/locales/ko/analytics.json'
import koApiKeys from '@/locales/ko/apiKeys.json'
import koBudget from '@/locales/ko/budget.json'
import koCommon from '@/locales/ko/common.json'
import koDashboard from '@/locales/ko/dashboard.json'
import koLogin from '@/locales/ko/login.json'
import koLogs from '@/locales/ko/logs.json'
import koNodes from '@/locales/ko/nodes.json'
import koRouting from '@/locales/ko/routing.json'
import thAnalytics from '@/locales/th/analytics.json'
import thApiKeys from '@/locales/th/apiKeys.json'
import thBudget from '@/locales/th/budget.json'
import thCommon from '@/locales/th/common.json'
import thDashboard from '@/locales/th/dashboard.json'
import thLogin from '@/locales/th/login.json'
import thLogs from '@/locales/th/logs.json'
import thNodes from '@/locales/th/nodes.json'
import thRouting from '@/locales/th/routing.json'
import esAnalytics from '@/locales/es/analytics.json'
import esApiKeys from '@/locales/es/apiKeys.json'
import esBudget from '@/locales/es/budget.json'
import esCommon from '@/locales/es/common.json'
import esDashboard from '@/locales/es/dashboard.json'
import esLogin from '@/locales/es/login.json'
import esLogs from '@/locales/es/logs.json'
import esNodes from '@/locales/es/nodes.json'
import esRouting from '@/locales/es/routing.json'

export const defaultLocale = 'en'
export const localeStorageKey = 'siftgate-dashboard-locale'

export const supportedLocales = [
  { code: 'en', flag: '🇺🇸', name: 'English', shortName: 'EN' },
  { code: 'zh', flag: '🇨🇳', name: '简体中文', shortName: '简' },
  { code: 'zh-TW', flag: '🇹🇼', name: '繁體中文', shortName: '繁' },
  { code: 'ja', flag: '🇯🇵', name: '日本語', shortName: 'JA' },
  { code: 'ko', flag: '🇰🇷', name: '한국어', shortName: 'KO' },
  { code: 'th', flag: '🇹🇭', name: 'ไทย', shortName: 'TH' },
  { code: 'es', flag: '🇪🇸', name: 'Español', shortName: 'ES' },
] as const

export type SupportedLocale = (typeof supportedLocales)[number]['code']

export const supportedLocaleCodes = supportedLocales.map((locale) => locale.code)

export function isSupportedLocale(value: string): value is SupportedLocale {
  return supportedLocaleCodes.includes(value as SupportedLocale)
}

export function normalizeLocale(value: string | undefined | null): SupportedLocale {
  if (!value) {
    return defaultLocale
  }

  const normalized = value.replace('_', '-')
  if (isSupportedLocale(normalized)) {
    return normalized
  }

  const languageOnly = normalized.split('-')[0]
  return isSupportedLocale(languageOnly) ? languageOnly : defaultLocale
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    defaultNS: 'common',
    detection: {
      caches: ['localStorage'],
      lookupLocalStorage: localeStorageKey,
      order: ['localStorage', 'navigator', 'htmlTag'],
    },
    fallbackLng: defaultLocale,
    interpolation: {
      escapeValue: false,
    },
    keySeparator: false,
    load: 'currentOnly',
    lowerCaseLng: false,
    ns: ['common', 'dashboard', 'logs', 'nodes', 'routing', 'budget', 'analytics', 'apiKeys', 'login'],
    resources: {
      en: {
        analytics,
        apiKeys,
        budget,
        common,
        dashboard,
        login,
        logs,
        nodes,
        routing,
      },
      zh: {
        analytics: zhAnalytics,
        apiKeys: zhApiKeys,
        budget: zhBudget,
        common: zhCommon,
        dashboard: zhDashboard,
        login: zhLogin,
        logs: zhLogs,
        nodes: zhNodes,
        routing: zhRouting,
      },
      'zh-TW': {
        analytics: zhTWAnalytics,
        apiKeys: zhTWApiKeys,
        budget: zhTWBudget,
        common: zhTWCommon,
        dashboard: zhTWDashboard,
        login: zhTWLogin,
        logs: zhTWLogs,
        nodes: zhTWNodes,
        routing: zhTWRouting,
      },
      ja: {
        analytics: jaAnalytics,
        apiKeys: jaApiKeys,
        budget: jaBudget,
        common: jaCommon,
        dashboard: jaDashboard,
        login: jaLogin,
        logs: jaLogs,
        nodes: jaNodes,
        routing: jaRouting,
      },
      ko: {
        analytics: koAnalytics,
        apiKeys: koApiKeys,
        budget: koBudget,
        common: koCommon,
        dashboard: koDashboard,
        login: koLogin,
        logs: koLogs,
        nodes: koNodes,
        routing: koRouting,
      },
      th: {
        analytics: thAnalytics,
        apiKeys: thApiKeys,
        budget: thBudget,
        common: thCommon,
        dashboard: thDashboard,
        login: thLogin,
        logs: thLogs,
        nodes: thNodes,
        routing: thRouting,
      },
      es: {
        analytics: esAnalytics,
        apiKeys: esApiKeys,
        budget: esBudget,
        common: esCommon,
        dashboard: esDashboard,
        login: esLogin,
        logs: esLogs,
        nodes: esNodes,
        routing: esRouting,
      },
    },
    returnNull: false,
    supportedLngs: supportedLocaleCodes,
  })

i18n.on('languageChanged', (locale) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalizeLocale(locale)
  }
})

if (typeof document !== 'undefined') {
  document.documentElement.lang = normalizeLocale(i18n.language)
}

export { i18n }
