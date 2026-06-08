import { QueryClient } from '@tanstack/react-query'

const TEN_MINUTES  = 10 * 60 * 1000
const THIRTY_SECS  =       30 * 1000
const FIVE_MINUTES =  5 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

// Stale-time helpers — pass to individual useQuery calls
export const stale = {
  reference:    { staleTime: TEN_MINUTES,  gcTime: TEN_MINUTES  * 2 },
  transactional:{ staleTime: THIRTY_SECS,  gcTime: FIVE_MINUTES,     refetchOnWindowFocus: true },
  auth:         { staleTime: FIVE_MINUTES, gcTime: FIVE_MINUTES * 2 },
} as const
