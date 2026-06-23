import React from "react";
import { useStats } from "../hooks/useStats.js";
import { AlertCircle, Coins, MessageSquare, Percent, UserCheck } from "lucide-react";

export function StatsBar() {
  const { data: stats, isLoading, error } = useStats();

  if (isLoading) {
    return (
      <div className="stats-grid" aria-label="Loading stats">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="stat-card">
            <div className="skeleton-cell" style={{ width: "60px", marginBottom: "8px" }} />
            <div className="skeleton-cell" style={{ width: "100px", height: "24px" }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: "rgba(239, 68, 68, 0.1)",
        border: "1px solid rgba(239, 68, 68, 0.2)",
        color: "#f87171",
        padding: "1rem",
        borderRadius: "8px",
        marginBottom: "2rem",
        fontSize: "0.875rem"
      }}>
        Failed to load dashboard statistics: {error.message}
      </div>
    );
  }

  const total = stats?.total ?? 0;
  const p0 = stats?.by_priority?.P0 ?? 0;
  const p1 = stats?.by_priority?.P1 ?? 0;
  const p2 = stats?.by_priority?.P2 ?? 0;
  const p3 = stats?.by_priority?.P3 ?? 0;
  const needsHuman = stats?.needs_human_count ?? 0;
  
  const avgConfidence = stats?.avg_confidence ?? 0;
  const confidencePercent = Math.round(avgConfidence * 100);

  // Cost calculation based on Sonnet pricing: $3/M input, $15/M output
  const inputTokens = stats?.total_tokens?.input ?? 0;
  const outputTokens = stats?.total_tokens?.output ?? 0;
  const estCost = (inputTokens * 3.0 / 1_000_000) + (outputTokens * 15.0 / 1_000_000);

  return (
    <div className="stats-grid" aria-label="Triage metrics dashboard">
      {/* Total Messages */}
      <div className="stat-card">
        <div className="stat-label">Total Processed</div>
        <div style={{ display: "flex", alignItems: "center", justifyItems: "center", gap: "0.5rem" }}>
          <MessageSquare className="empty-state-icon" style={{ width: "18px", height: "18px", margin: 0, color: "var(--muted-foreground)" }} />
          <div className="stat-val">{total}</div>
        </div>
      </div>

      {/* Priority Breakdown */}
      <div className="stat-card">
        <div className="stat-label">Priority Triage</div>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
          <span className="ui-badge ui-badge-p0" title="P0 (Critical)">P0: {p0}</span>
          <span className="ui-badge ui-badge-p1" title="P1 (High)">P1: {p1}</span>
          <span className="ui-badge ui-badge-p2" title="P2 (Medium)">P2: {p2}</span>
          <span className="ui-badge ui-badge-p3" title="P3 (Low)">P3: {p3}</span>
        </div>
      </div>

      {/* Needs Human */}
      <div className="stat-card">
        <div className="stat-label">Needs Human</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <AlertCircle style={{ width: "20px", height: "20px", color: needsHuman > 0 ? "var(--priority-p0)" : "var(--muted-foreground)" }} />
          <div className="stat-val" style={{ color: needsHuman > 0 ? "var(--priority-p0)" : "inherit" }}>
            {needsHuman}
          </div>
        </div>
      </div>

      {/* Avg Confidence */}
      <div className="stat-card">
        <div className="stat-label">Avg Confidence</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Percent style={{ width: "16px", height: "16px", color: "var(--muted-foreground)" }} />
          <div className="stat-val">{confidencePercent}%</div>
        </div>
        <div className="progress-container">
          <div 
            className="progress-bar" 
            style={{ 
              width: `${confidencePercent}%`,
              backgroundColor: confidencePercent < 50 
                ? "var(--conf-low)" 
                : confidencePercent < 72 
                ? "var(--conf-mid)" 
                : "var(--conf-high)"
            }} 
          />
        </div>
      </div>

      {/* Token Cost */}
      <div className="stat-card">
        <div className="stat-label">Estimated Cost</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Coins style={{ width: "18px", height: "18px", color: "var(--muted-foreground)" }} />
          <div className="stat-val">${estCost.toFixed(4)}</div>
        </div>
        <div className="stat-sub">Tokens: {inputTokens + outputTokens}</div>
      </div>
    </div>
  );
}

export default StatsBar;
