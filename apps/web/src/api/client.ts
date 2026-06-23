import { InboundMessage, TriageResult } from "@frontline/core";

const BASE_URL = (import.meta as any).env.VITE_API_URL || "/api/v1";

export interface MessageWithTriage {
  id: string;
  content: string;
  received_at: string;
  created_at: string;
  triage_results?: TriageResult[];
  eval_label?: {
    id: string;
    expected_category: string;
    expected_priority: string;
  } | null;
  reviewed?: boolean;
}

export interface MessagesResponse {
  data: MessageWithTriage[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface StatsResponse {
  total: number;
  by_category: Record<string, number>;
  by_priority: Record<string, number>;
  needs_human_count: number;
  avg_confidence: number;
  avg_latency_ms: number;
  total_tokens: {
    input: number;
    output: number;
  };
}

export interface TriageParams {
  page?: number;
  per_page?: number;
  category?: string; // Comma separated for multi-select
  priority?: string; // Comma separated for multi-select
  needs_human?: boolean;
  search?: string;
  sort?: string; // "received_at:desc" or similar
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    }
  });

  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson?.error?.message) {
        errorMsg = errorJson.error.message;
      }
    } catch {
      // Ignored
    }
    throw new Error(errorMsg);
  }

  return response.json() as Promise<T>;
}

export const client = {
  getMessages: async (params: TriageParams = {}): Promise<MessagesResponse> => {
    const searchParams = new URLSearchParams();
    if (params.page !== undefined) searchParams.append("page", params.page.toString());
    if (params.per_page !== undefined) searchParams.append("per_page", params.per_page.toString());
    if (params.category) searchParams.append("category", params.category);
    if (params.priority) searchParams.append("priority", params.priority);
    if (params.needs_human !== undefined) searchParams.append("needs_human", params.needs_human.toString());
    if (params.search) searchParams.append("search", params.search);
    if (params.sort) searchParams.append("sort", params.sort);

    const queryString = searchParams.toString();
    const queryPath = queryString ? `/messages?${queryString}` : "/messages";
    return request<MessagesResponse>(queryPath);
  },

  getMessage: async (id: string): Promise<MessageWithTriage> => {
    return request<MessageWithTriage>(`/messages/${id}`);
  },

  getStats: async (): Promise<StatsResponse> => {
    return request<StatsResponse>("/messages/stats");
  },

  postMessage: async (content: string): Promise<{ message_id: string; status: string }> => {
    return request<{ message_id: string; status: string }>("/messages", {
      method: "POST",
      body: JSON.stringify({ content })
    });
  },

  postBulkMessages: async (content: string): Promise<{ success: boolean; count: number }> => {
    return request<{ success: boolean; count: number }>("/messages/bulk", {
      method: "POST",
      body: JSON.stringify({ content })
    });
  },

  markAsReviewed: async (id: string): Promise<{ success: boolean; message_id: string }> => {
    return request<{ success: boolean; message_id: string }>(`/messages/${id}/review`, {
      method: "POST"
    });
  }
};
