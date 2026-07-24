import { useEffect, useRef } from "react";

// Cierra un overlay (panel de detalle, sheet, dialog) con el botón ATRÁS de
// Android en vez de que se cierre la PWA.
//
// En una PWA instalada (display: standalone) el botón atrás recorre el
// historial del navegador; un overlay que se abre solo con estado de React NO
// deja entrada de historial, así que "atrás" sale de la app en lugar de cerrar
// el overlay. Este hook, mientras el overlay está abierto, empuja una entrada
// de historial: el back la consume y dispara onClose (cierra el overlay). Si en
// cambio se cierra por UI (X, tap afuera, elegir algo), consumimos esa entrada
// sintética con history.back() para que la pila de historial quede balanceada.
export function useAndroidBackClose(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    let poppedByBack = false;
    window.history.pushState({ overlay: true }, "");

    const onPop = () => {
      poppedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Cerrado por UI (no por el back): el back que empujamos sigue en la pila
      // → lo consumimos para no dejar una entrada fantasma que "coma" el próximo
      // back del usuario.
      if (!poppedByBack) {
        window.history.back();
      }
    };
  }, [open]);
}
