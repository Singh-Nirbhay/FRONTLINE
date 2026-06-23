import React, { useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { CONFIDENCE_THRESHOLD } from "@frontline/core";
import { client, MessageWithTriage } from "./api/client.js";
import { useSearchParams } from "./hooks/useSearchParams.js";
import { useMessages } from "./hooks/useMessages.js";
import { StatsBar } from "./components/StatsBar.js";
import { FilterBar } from "./components/FilterBar.js";
import { MessageTable } from "./components/MessageTable.js";
import { MessageDetail } from "./components/MessageDetail.js";
import { PlusCircle, Database, HelpCircle } from "lucide-react";

// Initialize TanStack Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Dashboard() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // Parsing search params from URL
  const page = parseInt(searchParams.get("page") || "1", 10);
  const perPage = parseInt(searchParams.get("per_page") || "20", 10);
  const category = searchParams.get("category") || undefined;
  const priority = searchParams.get("priority") || undefined;
  const needsHumanParam = searchParams.get("needs_human");
  const needsHuman = needsHumanParam === "true" ? true : needsHumanParam === "false" ? false : undefined;
  const search = searchParams.get("search") || undefined;
  const sort = searchParams.get("sort") || undefined;

  // Selected message state for side panel detail view
  const [selectedMessage, setSelectedMessage] = useState<MessageWithTriage | null>(null);

  // Ingestion form state
  const [ingestContent, setIngestContent] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestSuccessMsg, setIngestSuccessMsg] = useState<string | null>(null);

  // Fetch messages using custom hook
  const {
    data: messagesResponse,
    isLoading,
    error,
    markAsReviewed,
    isReviewing,
  } = useMessages({
    page,
    per_page: perPage,
    category,
    priority,
    needs_human: needsHuman,
    search,
    sort,
  });

  // Handle message submission (Ingestion Panel)
  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingestContent.trim()) return;

    setIsIngesting(true);
    setIngestError(null);
    setIngestSuccessMsg(null);

    try {
      const res = await client.postBulkMessages(ingestContent.trim());
      if (res.count === 1) {
        setIngestSuccessMsg("Message successfully queued for triage!");
      } else {
        setIngestSuccessMsg(`Successfully queued ${res.count} messages for triage!`);
      }
      setIngestContent("");
      
      // Invalidate queries to refresh list and statistics
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch (err: any) {
      console.error(err);
      setIngestError(err.message || "Failed to submit message to ingestion queue");
    } finally {
      setIsIngesting(false);
    }
  };

  // Handle CSV file upload
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      setIsIngesting(true);
      setIngestError(null);
      setIngestSuccessMsg(null);

      try {
        const res = await client.postBulkMessages(text);
        setIngestSuccessMsg(`Successfully queued ${res.count} messages from CSV!`);
        
        // Invalidate queries to refresh list and statistics
        queryClient.invalidateQueries({ queryKey: ["messages"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
      } catch (err: any) {
        console.error(err);
        setIngestError(err.message || "Failed to upload and process CSV file");
      } finally {
        setIsIngesting(false);
        // Clear input
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  // Sync selected message optimistic updates
  const activeSelectedMessage = selectedMessage
    ? messagesResponse?.data.find((m) => m.id === selectedMessage.id) || selectedMessage
    : null;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div>
          <h1>FRONTLINE AI TRIAGE</h1>
          <p style={{ margin: "4px 0 0 0", color: "var(--muted-foreground)", fontSize: "0.875rem" }}>
            Real-time Incoming Message Routing & Human Review Panel
          </p>
        </div>
        <div className="ui-badge ui-badge-outline" style={{ display: "flex", gap: "0.5rem" }}>
          <HelpCircle style={{ width: "14px", height: "14px", color: "var(--muted-foreground)" }} />
          <span>Confidence Threshold: <strong>{CONFIDENCE_THRESHOLD * 100}%</strong></span>
        </div>
      </header>

      {/* Stats Dashboard */}
      <StatsBar />

      <div className="dashboard-grid">
        {/* Left Column: Manual Ingestion Box */}
        <div>
          <div className="ui-card">
            <div className="ui-card-header">
              <h2 className="ui-card-title" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <PlusCircle style={{ width: "18px", height: "18px", color: "var(--muted-foreground)" }} />
                <span>Simulate Inbound Message</span>
              </h2>
              <p className="ui-card-description">
                Submit raw customer queries to evaluate automated triage and routing logic.
              </p>
            </div>

            <form onSubmit={handleIngestSubmit}>
              <div style={{ marginBottom: "1rem" }}>
                <textarea
                  className="ui-input"
                  style={{ height: "120px", resize: "vertical", fontFamily: "inherit" }}
                  placeholder="Type or paste customer inquiry here..."
                  value={ingestContent}
                  onChange={(e) => setIngestContent(e.target.value)}
                  disabled={isIngesting}
                  aria-label="Simulated customer query content"
                />
              </div>

              {ingestError && (
                <div style={{
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  color: "#f87171",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  marginBottom: "1rem"
                }}>
                  {ingestError}
                </div>
              )}

              {ingestSuccessMsg && (
                <div style={{
                  backgroundColor: "rgba(34, 197, 94, 0.1)",
                  border: "1px solid rgba(34, 197, 94, 0.2)",
                  color: "#4ade80",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  marginBottom: "1rem"
                }}>
                  {ingestSuccessMsg}
                </div>
              )}

              <button
                type="submit"
                className="ui-button"
                style={{ width: "100%" }}
                disabled={isIngesting || !ingestContent.trim()}
              >
                {isIngesting ? "Enqueueing..." : "Submit & Triage"}
              </button>

              <div style={{ marginTop: "1rem", borderTop: "1px dashed var(--border)", paddingTop: "1rem" }}>
                <label className="stat-label" style={{ fontSize: "0.70rem", display: "block", marginBottom: "0.5rem" }}>
                  Or Upload CSV File
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  disabled={isIngesting}
                  className="ui-input"
                  style={{ fontSize: "0.8rem", padding: "0.35rem 0.5rem", height: "auto" }}
                  aria-label="Upload CSV file of customer messages"
                />
              </div>
            </form>
          </div>

          {/* System Diagnostic Information */}
          <div className="ui-card" style={{ padding: "1.25rem" }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Database style={{ width: "14px", height: "14px", color: "var(--muted-foreground)" }} />
              <span>System Status</span>
            </h3>
            <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <div>Model: <strong>claude-sonnet-4-6</strong></div>
              <div>Database: <span style={{ color: "var(--conf-high)" }}>● Online</span></div>
              <div>Queue Worker: <span style={{ color: "var(--conf-high)" }}>● Active</span></div>
            </div>
          </div>
        </div>

        {/* Right Column: Filter & Message Table feed */}
        <div>
          {/* Filters controls */}
          <FilterBar />

          {/* Error panel for Table query */}
          {error && (
            <div style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#f87171",
              padding: "1rem",
              borderRadius: "8px",
              marginBottom: "1.5rem",
              fontSize: "0.875rem"
            }}>
              <strong>Error loading messages feed:</strong> {error.message}
            </div>
          )}

          {/* Triage Messages Table */}
          <MessageTable
            messages={messagesResponse?.data || []}
            isLoading={isLoading}
            totalPages={messagesResponse?.pagination.total_pages || 1}
            currentPage={page}
            onViewMessage={setSelectedMessage}
          />
        </div>
      </div>

      {/* Message detail slide-out side panel */}
      <MessageDetail
        message={activeSelectedMessage}
        onClose={() => setSelectedMessage(null)}
        onMarkAsReviewed={markAsReviewed}
        isReviewing={isReviewing}
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}
