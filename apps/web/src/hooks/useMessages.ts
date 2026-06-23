import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client, TriageParams, MessagesResponse } from "../api/client.js";

export function useMessages(params: TriageParams) {
  const queryClient = useQueryClient();

  const query = useQuery<MessagesResponse, Error>({
    queryKey: ["messages", params],
    queryFn: () => client.getMessages(params),
    refetchInterval: 3000 // Automatically poll and refetch every 3 seconds to update queued/triaged messages
  });

  const reviewMutation = useMutation({
    mutationFn: (id: string) => client.markAsReviewed(id),
    onMutate: async (id: string) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["messages", params] });

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<MessagesResponse>(["messages", params]);

      // Optimistically update the message in the cache
      if (previousMessages) {
        queryClient.setQueryData<MessagesResponse>(["messages", params], {
          ...previousMessages,
          data: previousMessages.data.map((msg) =>
            msg.id === id ? { ...msg, reviewed: true } : msg
          )
        });
      }

      return { previousMessages };
    },
    onError: (err, id, context) => {
      // Rollback to previous state on error
      if (context?.previousMessages) {
        queryClient.setQueryData(["messages", params], context.previousMessages);
      }
    },
    onSettled: () => {
      // Invalidate stats and messages query lists to sync up state
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  return {
    ...query,
    markAsReviewed: reviewMutation.mutate,
    isReviewing: reviewMutation.isPending
  };
}
export default useMessages;
