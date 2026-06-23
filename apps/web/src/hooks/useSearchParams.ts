import { useState, useEffect, useCallback } from "react";

/**
 * A lightweight hook to synchronize React state with URL search parameters.
 * Emulates the react-router-dom useSearchParams interface without adding external dependencies.
 */
export function useSearchParams() {
  const [searchParams, setSearchParams] = useState(() => new URLSearchParams(window.location.search));

  const updateParams = useCallback((newParams: URLSearchParams) => {
    const newSearch = newParams.toString();
    const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}`;
    window.history.replaceState(null, "", newUrl);
    
    // Dispatch a custom event to notify other hook instances if they exist
    window.dispatchEvent(new Event("urlsearchparamschange"));
    setSearchParams(newParams);
  }, []);

  useEffect(() => {
    const handleUrlChange = () => {
      setSearchParams(new URLSearchParams(window.location.search));
    };

    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("urlsearchparamschange", handleUrlChange);

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
      window.removeEventListener("urlsearchparamschange", handleUrlChange);
    };
  }, []);

  return [searchParams, updateParams] as const;
}

export default useSearchParams;
