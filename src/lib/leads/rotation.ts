// ============================================================
// Rotación 1-a-1 del reparto de leads.
//
// Regla: recibe el que hace MÁS TIEMPO que no recibe. No el que menos
// acumuló.
//
// Por qué cambió: antes ganaba el de menor cantidad entregada. Con una tanda
// en 0/50 y otra en 35/50, la primera se llevaba los 35 leads siguientes
// seguidos y la segunda quedaba seca hasta emparejarse. Lo mismo pasaba en el
// pozo común cuando una asesora arrancaba un ciclo nuevo. Mirando la ÚLTIMA
// entrega en vez del total, el reparto se alterna desde el primer lead y
// quien se suma a mitad de camino entra en la ronda sin acapararla.
//
// Consecuencia buscada: una pausa no genera deuda. Al volver, quien estuvo
// pausado toma un turno (su última entrega es vieja) y con eso queda al día.
// ============================================================

/**
 * Elige el candidato menos recientemente servido.
 *
 * Orden: primero los que NUNCA recibieron (el más antiguo primero, para que
 * el arranque sea determinista); después, la entrega más vieja. Empate
 * exacto, al azar.
 *
 * `rand` se inyecta para poder testear el desempate.
 */
export function pickLeastRecentlyServed<T>(
  candidates: T[],
  lastServedAt: (c: T) => string | null,
  createdAt: (c: T) => string,
  rand: () => number = Math.random,
): T | null {
  if (candidates.length === 0) return null;

  // Nunca servidos: tienen prioridad absoluta sobre los que ya recibieron.
  const nunca = candidates.filter((c) => !lastServedAt(c));
  const pool = nunca.length > 0 ? nunca : candidates;

  // Dentro del grupo elegido, la clave de orden es la misma idea: lo más
  // antiguo primero (fecha de alta para los que nunca recibieron, última
  // entrega para el resto).
  const key = (c: T) => (nunca.length > 0 ? createdAt(c) : lastServedAt(c)!);

  const min = pool.reduce((acc, c) => (key(c) < key(acc) ? c : acc), pool[0]);
  const empatados = pool.filter((c) => key(c) === key(min));

  return empatados[Math.floor(rand() * empatados.length)];
}
