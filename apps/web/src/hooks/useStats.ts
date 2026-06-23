import { useQuery } from "@tanstack/react-query";
import { client, StatsResponse } from "../api/client.js";

export function useStats() {
  return useQuery<StatsResponse, Error>({
    queryKey: ["stats"],
    queryFn: client.getStats,
    refetchInterval: 30000 // auto-refresh every 30s
  });
}
