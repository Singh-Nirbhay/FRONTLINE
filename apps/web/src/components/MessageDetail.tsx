import React, { useState, useEffect } from "react";
import { MessageWithTriage } from "../api/client.js";
import { X, Check, Clock, Cpu, HelpCircle, AlertTriangle } from "lucide-react";

interface MessageDetailProps {
  message: MessageWithTriage | null;
  onClose: () => void;
  onMarkAsReviewed: (id: string) => void;
  isReviewing: boolean;
}

export function MessageDetail({
  message,
  onClose,
  onMarkAsReviewed,
  isReviewing,
}: MessageDetailProps) {
  // Retain the last active message during transition out so it doesn't flash empty
  const [activeMsg, setActiveMsg] = useState<MessageWithTriage | null>(null);
  const isOpen = message !== null;

  useEffect(() => {
    if (message) {
      setActiveMsg(message);
    }
  }, [message]);

  // Support ESC key to close
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!activeMsg) return null;

  const triage = activeMsg.triage_results?.[0];
  const confPct = triage ? Math.round(triage.confidence * 100) : 0;
  
  // Custom confidence color mapping
  let confColor = "var(--conf-high)";
  if (confPct < 50) {
    confColor = "var(--conf-low)";
  } else if (confPct < 72) {
    confColor = "var(--conf-mid)";
  }

  const isReviewed = activeMsg.reviewed;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="detail-panel-backdrop" 
          onClick={onClose} 
          aria-hidden="true"
        />
      )}

      {/* Drawer Panel */}
      <div 
        className={`detail-panel ${isOpen ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Triage message detail panel"
      >
        {/* Header */}
        <div className="detail-header">
          <div>
            <h2 className="ui-card-title" style={{ fontSize: "1.1rem" }}>
              Message Review
            </h2>
            <p className="ui-card-description" style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>
              ID: {activeMsg.id}
            </p>
          </div>
          <button
            type="button"
            className="ui-button ui-button-ghost"
            style={{ width: "2.25rem", height: "2.25rem", padding: 0, borderRadius: "50%" }}
            onClick={onClose}
            aria-label="Close message panel"
          >
            <X style={{ width: "18px", height: "18px" }} />
          </button>
        </div>

        {/* Content */}
        <div className="detail-content">
          {/* Labeled Triage Fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <span className="stat-label" style={{ fontSize: "0.70rem" }}>Triage Category</span>
              <div style={{ marginTop: "0.25rem" }}>
                <span className="ui-badge ui-badge-secondary" style={{ textTransform: "capitalize", fontSize: "0.85rem" }}>
                  {triage?.category.replace("_", " ") || "Unclear"}
                </span>
              </div>
            </div>
            
            <div>
              <span className="stat-label" style={{ fontSize: "0.70rem" }}>Priority Level</span>
              <div style={{ marginTop: "0.25rem" }}>
                <span className={`ui-badge ui-badge-${triage?.priority.toLowerCase() || "p3"}`} style={{ fontSize: "0.85rem" }}>
                  {triage?.priority || "P3"}
                </span>
              </div>
            </div>
          </div>

          {/* Confidence Gauge */}
          <div style={{ marginBottom: "1.5rem" }}>
            <span className="stat-label" style={{ fontSize: "0.70rem" }}>Classification Confidence</span>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.25rem" }}>
              <div className="progress-container" style={{ flexGrow: 1, height: "8px", margin: 0 }}>
                <div 
                  className="progress-bar" 
                  style={{ 
                    width: `${confPct}%`,
                    backgroundColor: confColor
                  }} 
                />
              </div>
              <span style={{ fontWeight: 600, fontSize: "0.95rem", color: confColor }}>{confPct}%</span>
            </div>
          </div>

          {/* Original Monospace Content */}
          <div style={{ marginBottom: "1.5rem" }}>
            <span className="stat-label" style={{ fontSize: "0.70rem" }}>Original Inbound Message</span>
            <div style={{ marginTop: "0.5rem" }}>
              <pre className="raw-message">{activeMsg.content}</pre>
            </div>
          </div>

          {/* Summary Box */}
          <div style={{ marginBottom: "1.5rem" }}>
            <span className="stat-label" style={{ fontSize: "0.70rem" }}>Automated Summary</span>
            <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.9rem", color: "var(--foreground)" }}>
              {triage?.summary || "No summary available."}
            </p>
          </div>

          {/* Suggested Action Callout */}
          <div style={{ marginBottom: "1.5rem" }}>
            <span className="stat-label" style={{ fontSize: "0.70rem" }}>Suggested Next Action</span>
            <div className="callout-box" style={{ borderLeftColor: triage?.needs_human ? "var(--priority-p0)" : "var(--conf-high)" }}>
              <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 500, color: "var(--card-foreground)" }}>
                {triage?.suggested_action || "Manual classification required."}
              </p>
            </div>
          </div>

          {/* Performance & Token Metadata */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "1fr 1fr", 
            gap: "0.75rem", 
            padding: "1rem", 
            backgroundColor: "rgba(255, 255, 255, 0.01)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "0.75rem",
            color: "var(--muted-foreground)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <Clock style={{ width: "14px", height: "14px" }} />
              <span>Latency: <strong>{triage?.processing_time_ms ?? 0}ms</strong></span>
            </div>
            
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <Cpu style={{ width: "14px", height: "14px" }} />
              <span>
                Tokens: <strong>{triage?.token_usage?.input ?? 0} in / {triage?.token_usage?.output ?? 0} out</strong>
              </span>
            </div>

            <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.25rem" }}>
              <HelpCircle style={{ width: "14px", height: "14px" }} />
              <span>
                Routing Status: {triage?.needs_human ? (
                  <strong style={{ color: "var(--priority-p0)" }}>Requires Human Override</strong>
                ) : (
                  <strong style={{ color: "var(--conf-high)" }}>Automated Direct Route</strong>
                )}
              </span>
            </div>
          </div>

          {/* Raw LLM JSON Output */}
          <div style={{ marginTop: "1.5rem" }}>
            <span className="stat-label" style={{ fontSize: "0.70rem" }}>Raw LLM JSON Output</span>
            <div style={{ marginTop: "0.5rem" }}>
              <pre className="raw-message" style={{ fontFamily: "monospace", fontSize: "0.8rem", backgroundColor: "rgba(0, 0, 0, 0.2)" }}>
                {JSON.stringify({
                  category: triage?.category || "unclear",
                  priority: triage?.priority || "P3",
                  summary: triage?.summary || "",
                  suggested_action: triage?.suggested_action || "",
                  needs_human: triage?.needs_human ?? true,
                  confidence: triage?.confidence ?? 0
                }, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="detail-footer">
          <button
            type="button"
            className="ui-button ui-button-outline"
            onClick={onClose}
            aria-label="Cancel and close review panel"
          >
            Cancel
          </button>
          
          <button
            type="button"
            className="ui-button"
            style={{ 
              backgroundColor: isReviewed ? "var(--secondary)" : "var(--primary)",
              color: isReviewed ? "var(--secondary-foreground)" : "var(--primary-foreground)",
              gap: "0.35rem"
            }}
            disabled={isReviewed || isReviewing}
            onClick={() => onMarkAsReviewed(activeMsg.id)}
            aria-label="Mark message as reviewed"
          >
            {isReviewed ? (
              <>
                <Check style={{ width: "14px", height: "14px" }} />
                <span>Reviewed</span>
              </>
            ) : isReviewing ? (
              <span>Reviewing...</span>
            ) : (
              <span>Mark as Reviewed</span>
            )}
          </button>
        </div>
      </div>
    </>
  );
}

export default MessageDetail;
