import { useCallback, useEffect, useMemo, useState } from "react";

export function useBulkSelection(filteredKeys: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sig = useMemo(() => filteredKeys.join("\u0001"), [filteredKeys]);

  useEffect(() => {
    const keys = sig.length ? sig.split("\u0001") : [];
    const allow = new Set(keys);
    setSelected((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (allow.has(k)) next.add(k);
      }
      return next;
    });
  }, [sig]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const toggleAllFiltered = useCallback(() => {
    setSelected((prev) => {
      const allIn = filteredKeys.length > 0 && filteredKeys.every((k) => prev.has(k));
      if (allIn) return new Set();
      return new Set(filteredKeys);
    });
  }, [filteredKeys]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectedInFiltered = useMemo(
    () => filteredKeys.filter((k) => selected.has(k)),
    [filteredKeys, selected],
  );

  const allSelected =
    filteredKeys.length > 0 && selectedInFiltered.length === filteredKeys.length;
  const someSelected =
    selectedInFiltered.length > 0 && selectedInFiltered.length < filteredKeys.length;

  return {
    selected,
    selectedInFiltered,
    toggle,
    toggleAllFiltered,
    clear,
    allSelected,
    someSelected,
  };
}
