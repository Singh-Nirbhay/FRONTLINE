import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "../hooks/useSearchParams.js";
import { Search, X, ChevronDown, CheckCircle } from "lucide-react";

const CATEGORIES = ["billing", "technical", "complaint", "feature_request", "out_of_scope", "unclear"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];

export function FilterBar() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Selected arrays parsed from URL
  const selectedCategories = searchParams.get("category")
    ? searchParams.get("category")!.split(",").filter(Boolean)
    : [];
  
  const selectedPriorities = searchParams.get("priority")
    ? searchParams.get("priority")!.split(",").filter(Boolean)
    : [];
  
  const needsHuman = searchParams.get("needs_human") === "true";
  const urlSearch = searchParams.get("search") || "";

  // Local state for search debouncing
  const [searchVal, setSearchVal] = useState(urlSearch);

  // Dropdown visibility states
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);

  // Dropdown refs for click-outside detection
  const categoryRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);

  // Debounce search input changes by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      const newParams = new URLSearchParams(searchParams);
      if (searchVal.trim()) {
        newParams.set("search", searchVal.trim());
      } else {
        newParams.delete("search");
      }
      newParams.set("page", "1"); // Reset to page 1 on filter change
      setSearchParams(newParams);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchVal, setSearchParams]);

  // Sync search input if URL changes independently
  useEffect(() => {
    setSearchVal(urlSearch);
  }, [urlSearch]);

  // Detect clicks outside dropdowns to close them
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (categoryRef.current && !categoryRef.current.contains(event.target as Node)) {
        setCategoryOpen(false);
      }
      if (priorityRef.current && !priorityRef.current.contains(event.target as Node)) {
        setPriorityOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCategoryToggle = (cat: string) => {
    const newCategories = selectedCategories.includes(cat)
      ? selectedCategories.filter((c) => c !== cat)
      : [...selectedCategories, cat];

    const newParams = new URLSearchParams(searchParams);
    if (newCategories.length > 0) {
      newParams.set("category", newCategories.join(","));
    } else {
      newParams.delete("category");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handlePriorityToggle = (pri: string) => {
    const newPriorities = selectedPriorities.includes(pri)
      ? selectedPriorities.filter((p) => p !== pri)
      : [...selectedPriorities, pri];

    const newParams = new URLSearchParams(searchParams);
    if (newPriorities.length > 0) {
      newParams.set("priority", newPriorities.join(","));
    } else {
      newParams.delete("priority");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handleNeedsHumanToggle = () => {
    const newParams = new URLSearchParams(searchParams);
    if (!needsHuman) {
      newParams.set("needs_human", "true");
    } else {
      newParams.delete("needs_human");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams();
    // Keep page/per_page if present
    const perPage = searchParams.get("per_page");
    if (perPage) newParams.set("per_page", perPage);
    newParams.set("page", "1");
    setSearchVal("");
    setSearchParams(newParams);
  };

  // Compute active filters count
  const activeCount = 
    selectedCategories.length + 
    selectedPriorities.length + 
    (needsHuman ? 1 : 0) + 
    (urlSearch ? 1 : 0);

  return (
    <div className="filter-bar" aria-label="Filter triage messages">
      <div className="filter-inputs-group">
        {/* Debounced Search */}
        <div className="search-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            className="ui-input search-input-padding"
            placeholder="Search message content..."
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            aria-label="Search messages"
          />
        </div>

        {/* Custom Multi-Select Dropdown: Category */}
        <div className="ui-select-container" ref={categoryRef}>
          <button
            type="button"
            className="ui-select"
            onClick={() => setCategoryOpen(!categoryOpen)}
            aria-haspopup="listbox"
            aria-expanded={categoryOpen}
            aria-label="Filter by categories"
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedCategories.length === 0
                ? "Categories"
                : `${selectedCategories.length} Selected`}
            </span>
            <ChevronDown style={{ width: "16px", height: "16px", color: "var(--muted-foreground)" }} />
          </button>
          {categoryOpen && (
            <div className="custom-popover" role="listbox">
              {CATEGORIES.map((cat) => {
                const checked = selectedCategories.includes(cat);
                return (
                  <div
                    key={cat}
                    className="custom-popover-item"
                    onClick={() => handleCategoryToggle(cat)}
                    role="option"
                    aria-selected={checked}
                  >
                    <div className={`checkbox-custom ${checked ? "checked" : ""}`} />
                    <span style={{ textTransform: "capitalize" }}>{cat.replace("_", " ")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom Multi-Select Dropdown: Priority */}
        <div className="ui-select-container" ref={priorityRef}>
          <button
            type="button"
            className="ui-select"
            onClick={() => setPriorityOpen(!priorityOpen)}
            aria-haspopup="listbox"
            aria-expanded={priorityOpen}
            aria-label="Filter by priority levels"
          >
            <span>
              {selectedPriorities.length === 0
                ? "Priorities"
                : `${selectedPriorities.length} Selected`}
            </span>
            <ChevronDown style={{ width: "16px", height: "16px", color: "var(--muted-foreground)" }} />
          </button>
          {priorityOpen && (
            <div className="custom-popover" role="listbox">
              {PRIORITIES.map((pri) => {
                const checked = selectedPriorities.includes(pri);
                return (
                  <div
                    key={pri}
                    className="custom-popover-item"
                    onClick={() => handlePriorityToggle(pri)}
                    role="option"
                    aria-selected={checked}
                  >
                    <div className={`checkbox-custom ${checked ? "checked" : ""}`} />
                    <span>{pri}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Needs Human Toggle */}
        <div 
          className="filter-toggle-container" 
          onClick={handleNeedsHumanToggle}
          aria-label="Filter messages needing human review"
        >
          <div className={`checkbox-custom ${needsHuman ? "checked" : ""}`} />
          <span>Needs Human</span>
        </div>
      </div>

      {/* Clear Filters & Active Badge */}
      {activeCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span className="ui-badge ui-badge-primary">
            {activeCount} active
          </span>
          <button
            type="button"
            className="ui-button ui-button-ghost"
            style={{ height: "2rem", padding: "0 0.5rem", gap: "0.25rem" }}
            onClick={clearAllFilters}
            aria-label="Clear all active filters"
          >
            <X style={{ width: "14px", height: "14px" }} />
            <span>Clear all</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default FilterBar;
