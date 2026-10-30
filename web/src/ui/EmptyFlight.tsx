// Entrada vazia: o aviãozinho de papel plana numa curva e deixa um rastro fino que some no fim.
// Sem piscar nem pulsar; com movimento reduzido, o avião fica parado no meio da curva.
const FLIGHT = 'M 14 104 C 74 22, 150 142, 226 34';

export function EmptyFlight() {
  return (
    <div className="flight" aria-hidden="true">
      <svg className="flight-trail" viewBox="0 0 240 132" width="240" height="132">
        <path d={FLIGHT} pathLength={1} />
      </svg>
      <svg className="flight-plane" viewBox="0 0 24 24" width="26" height="26">
        <path d="M3 11.5 21.5 3.5 14.5 21 11 13z" />
        <path d="M11 13 21.5 3.5" />
      </svg>
    </div>
  );
}
