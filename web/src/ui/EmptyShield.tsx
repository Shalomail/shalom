// Spam vazio: as duas metades do escudo se desenham a partir do topo, se encontram embaixo e o visto
// entra por último. Segura um tempo e recomeça. Com movimento reduzido, o escudo fica pronto e parado.
export function EmptyShield() {
  return (
    <div className="shield" aria-hidden="true">
      <svg viewBox="0 0 240 132" width="240" height="132">
        <path className="shield-side" d="M120 22 C133 30 145 33 156 33 L156 62 C156 85 141 99 120 110" pathLength={1} />
        <path className="shield-side" d="M120 22 C107 30 95 33 84 33 L84 62 C84 85 99 99 120 110" pathLength={1} />
        <path className="shield-check" d="M104 66 L115 77 L137 54" pathLength={1} />
      </svg>
    </div>
  );
}
