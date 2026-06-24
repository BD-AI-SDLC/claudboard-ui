import { useState, useLayoutEffect, useEffect } from 'react'

type Theme = 'dark' | 'light'

function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme)
  const [userOverride, setUserOverride] = useState<Theme | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'light' : 'dark')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const theme = userOverride ?? systemTheme

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return { theme, setTheme: setUserOverride }
}
