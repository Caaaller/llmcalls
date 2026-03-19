import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function useRecentCalls(limit = 10) {
  const query = useQuery({
    queryKey: ['calls', 'history', 'wizard', limit],
    queryFn: () => api.calls.history(limit),
  });

  return {
    calls: query.data?.calls ?? [],
    isLoading: query.isLoading,
  };
}
