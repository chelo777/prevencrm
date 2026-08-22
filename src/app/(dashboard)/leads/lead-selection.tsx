"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Selección de leads para acciones masivas.
//
// Hay DOS modos de selección y la diferencia importa:
//   - `ids`: los que el usuario tocó, uno por uno. Se mandan al servidor.
//   - `allMatching`: "todos los que coinciden con el filtro" — puede ser más
//     de lo que hay en pantalla (1057 contra los 50 de la página). Acá NO se
//     guardan 1057 ids: se manda el filtro y el servidor resuelve. Así el
//     conjunto que se modifica es el mismo que el que se contó, aunque entre
//     un lead nuevo entre medio.
//
// El estado vive en un provider para que la barra de acciones (fija abajo) y
// los checkboxes (dentro de la lista) compartan una sola verdad.

interface SelectionState {
  ids: Set<string>;
  allMatching: boolean;
  /** Cuántos leads coinciden con el filtro actual (lo sabe el server). */
  totalMatching: number;
  /** Cuántos hay en la página que se está viendo. */
  pageSize: number;
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  togglePage: (idsOfPage: string[]) => void;
  selectAllMatching: () => void;
  clear: () => void;
}

const Ctx = createContext<SelectionState | null>(null);

export function useLeadSelection(): SelectionState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useLeadSelection necesita estar dentro de LeadSelectionProvider");
  }
  return ctx;
}

export function LeadSelectionProvider({
  totalMatching,
  pageSize,
  children,
}: {
  totalMatching: number;
  pageSize: number;
  children: ReactNode;
}) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const [allMatching, setAllMatching] = useState(false);

  const toggle = useCallback((id: string) => {
    // Tocar un lead individual sale del modo "todos": el usuario está
    // eligiendo a mano, ya no pidiendo el conjunto entero.
    setAllMatching(false);
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const togglePage = useCallback((idsOfPage: string[]) => {
    setAllMatching(false);
    setIds((prev) => {
      const allOn = idsOfPage.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of idsOfPage) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllMatching = useCallback(() => {
    setAllMatching(true);
    setIds(new Set());
  }, []);

  const clear = useCallback(() => {
    setAllMatching(false);
    setIds(new Set());
  }, []);

  const value = useMemo<SelectionState>(
    () => ({
      ids,
      allMatching,
      totalMatching,
      pageSize,
      count: allMatching ? totalMatching : ids.size,
      isSelected: (id: string) => allMatching || ids.has(id),
      toggle,
      togglePage,
      selectAllMatching,
      clear,
    }),
    [ids, allMatching, totalMatching, pageSize, toggle, togglePage, selectAllMatching, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
