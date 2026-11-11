import * as React from 'react'

// Same as the shadcn use-media-query hook, but undefined until the first
// measurement so consumers can hold off rendering until the breakpoint resolves.
export function useMediaQuery(query: string) {
  const [value, setValue] = React.useState<boolean>()

  React.useEffect(() => {
    function onChange(event: MediaQueryListEvent) {
      setValue(event.matches)
    }

    const result = matchMedia(query)
    result.addEventListener('change', onChange)
    setValue(result.matches)

    return () => result.removeEventListener('change', onChange)
  }, [query])

  return value
}
