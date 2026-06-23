import React from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { MessageWithTriage } from "../api/client.js";
import { useSearchParams } from "../hooks/useSearchParams.js";
import { 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  CheckSquare, 
  Square, 
  Eye, 
  Inbox,
  AlertCircle
} from "lucide-react";

interface MessageTableProps {
  messages: MessageWithTriage[];
  isLoading: boolean;
  totalPages: number;
  currentPage: number;
  onViewMessage: (message: MessageWithTriage) => void;
}

// Relative time formatter helper
function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Tooltip component helper
function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <div className="tooltip-trigger">
      {children}
      <div className="tooltip-popup">{content}</div>
    </div>
  );
}

export function MessageTable({
  messages,
  isLoading,
  totalPages,
  currentPage,
  onViewMessage,
}: MessageTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get("sort") || "";

  // Column helper definition
  const columnHelper = createColumnHelper<MessageWithTriage>();

  // Determine current sort direction for UI
  const getSortIcon = () => {
    if (sortParam === "received_at:asc") {
      return <ArrowUp style={{ width: "14px", height: "14px", marginLeft: "0.25rem" }} />;
    } else if (sortParam === "received_at:desc") {
      return <ArrowDown style={{ width: "14px", height: "14px", marginLeft: "0.25rem" }} />;
    }
    return <ArrowUpDown style={{ width: "14px", height: "14px", marginLeft: "0.25rem", opacity: 0.5 }} />;
  };

  const handleSortToggle = () => {
    const newParams = new URLSearchParams(searchParams);
    if (sortParam === "received_at:desc") {
      newParams.set("sort", "received_at:asc");
    } else if (sortParam === "received_at:asc") {
      newParams.delete("sort"); // reset/default behavior
    } else {
      newParams.set("sort", "received_at:desc");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", newPage.toString());
    setSearchParams(newParams);
  };

  const columns = [
    // 1. Received (relative time, e.g. "3m ago") — sortable
    columnHelper.accessor("received_at", {
      header: () => (
        <span 
          style={{ display: "inline-flex", alignItems: "center" }}
          onClick={handleSortToggle}
        >
          Received {getSortIcon()}
        </span>
      ),
      cell: (info) => (
        <span style={{ fontSize: "0.85rem", color: "var(--muted-foreground)" }}>
          {formatRelativeTime(info.getValue())}
        </span>
      ),
    }),

    // 2. Category (colored chip per category type)
    columnHelper.accessor((row) => row.triage_results?.[0]?.category || "unclear", {
      id: "category",
      header: "Category",
      cell: (info) => {
        const cat = info.getValue();
        return (
          <span className="ui-badge ui-badge-secondary" style={{ textTransform: "capitalize" }}>
            {cat.replace("_", " ")}
          </span>
        );
      },
    }),

    // 3. Priority (P0/P1/P2/P3 badge, color-coded)
    columnHelper.accessor((row) => row.triage_results?.[0]?.priority || "P3", {
      id: "priority",
      header: "Priority",
      cell: (info) => {
        const priority = info.getValue();
        const badgeClass = `ui-badge ui-badge-${priority.toLowerCase()}`;
        return <span className={badgeClass}>{priority}</span>;
      },
    }),

    // 4. Summary (truncated to 80 chars, full on hover via Tooltip)
    columnHelper.accessor((row) => row.triage_results?.[0]?.summary || "", {
      id: "summary",
      header: "Summary",
      cell: (info) => {
        const summary = info.getValue();
        if (!summary) return <span style={{ color: "var(--muted-foreground)", fontStyle: "italic" }}>Pending triage...</span>;
        
        const truncated = summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
        return (
          <Tooltip content={summary}>
            <span style={{ cursor: "help" }}>{truncated}</span>
          </Tooltip>
        );
      },
    }),

    // 5. Confidence (numeric % + color: red <50%, yellow 50-72%, green >72%)
    columnHelper.accessor((row) => row.triage_results?.[0]?.confidence ?? 0, {
      id: "confidence",
      header: "Confidence",
      cell: (info) => {
        const conf = info.getValue();
        const confPct = Math.round(conf * 100);
        let color = "var(--conf-high)";
        if (confPct < 50) {
          color = "var(--conf-low)";
        } else if (confPct < 72) {
          color = "var(--conf-mid)";
        }

        return (
          <span style={{ color, fontWeight: 600 }}>
            {confPct}%
          </span>
        );
      },
    }),

    // 6. Needs Human (checkbox icon, red if true)
    columnHelper.accessor((row) => row.triage_results?.[0]?.needs_human ?? true, {
      id: "needs_human",
      header: "Needs Human",
      cell: (info) => {
        const needsHuman = info.getValue();
        return needsHuman ? (
          <span title="Requires attention" style={{ display: "inline-flex" }}>
            <AlertCircle style={{ width: "16px", height: "16px", color: "var(--destructive)" }} />
          </span>
        ) : (
          <span title="Auto-resolved" style={{ display: "inline-flex" }}>
            <CheckSquare style={{ width: "16px", height: "16px", color: "var(--muted-foreground)", opacity: 0.5 }} />
          </span>
        );
      },
    }),

    // 7. Actions (View button)
    columnHelper.display({
      id: "actions",
      header: () => <span style={{ textAlign: "right", display: "block" }}>Actions</span>,
      cell: (info) => (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="ui-button ui-button-outline"
            style={{ height: "1.75rem", padding: "0 0.50rem", fontSize: "0.75rem", gap: "0.25rem" }}
            onClick={(e) => {
              e.stopPropagation(); // prevent triggering row click
              onViewMessage(info.row.original);
            }}
            aria-label="View message details"
          >
            <Eye style={{ width: "12px", height: "12px" }} />
            <span>View</span>
          </button>
        </div>
      ),
    }),
  ];

  const table = useReactTable({
    data: messages,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });

  return (
    <div aria-label="Messages navigation feed">
      <div className="table-container">
        <table className="ui-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSortable = header.id === "received_at";
                  return (
                    <th 
                      key={header.id} 
                      className={isSortable ? "sortable" : ""}
                      scope="col"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              // Loading skeleton rows while fetching
              [...Array(6)].map((_, rIdx) => (
                <tr key={rIdx} className="skeleton-row">
                  {[...Array(7)].map((_, cIdx) => (
                    <td key={cIdx}>
                      <div className="skeleton-cell" />
                    </td>
                  ))}
                </tr>
              ))
            ) : messages.length === 0 ? (
              // Empty state
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <Inbox className="empty-state-icon" />
                    <h3 style={{ margin: "0 0 0.25rem 0", fontWeight: 600, color: "var(--card-foreground)" }}>No messages yet</h3>
                    <p style={{ margin: 0, fontSize: "0.875rem" }}>Adjust your filters or submit a new message ingestion test.</p>
                  </div>
                </td>
              </tr>
            ) : (
              // Messages lists rows
              table.getRowModel().rows.map((row) => {
                const isReviewed = row.original.reviewed;
                return (
                  <tr 
                    key={row.id} 
                    onClick={() => onViewMessage(row.original)}
                    style={{ opacity: isReviewed ? 0.6 : 1 }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controller */}
      {totalPages > 1 && (
        <div className="pagination-container" aria-label="Pagination Navigation">
          <span style={{ fontSize: "0.875rem", color: "var(--muted-foreground)" }}>
            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="ui-button ui-button-outline"
              disabled={currentPage <= 1 || isLoading}
              onClick={() => handlePageChange(currentPage - 1)}
              aria-label="Go to previous page"
            >
              Previous
            </button>
            <button
              type="button"
              className="ui-button ui-button-outline"
              disabled={currentPage >= totalPages || isLoading}
              onClick={() => handlePageChange(currentPage + 1)}
              aria-label="Go to next page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MessageTable;
