export interface HistoryEntry {
  id: number;
  url: string;
  text: string;
  model: string;
  voice: string;
  summary: string;
}

export function History({ entries, onClear }: { entries: HistoryEntry[]; onClear: () => void }) {
  if (entries.length === 0) return null;
  return (
    <section className="panel">
      <h2>
        Historique
        <button className="link" onClick={onClear}>
          vider
        </button>
      </h2>
      <ul className="history">
        {entries.map((e) => (
          <li key={e.id}>
            <div className="meta">
              <b>{e.model}</b> · {e.voice} · {e.summary}
            </div>
            <div className="history-text">{e.text}</div>
            <div className="row">
              <audio controls src={e.url} preload="none" />
              <a className="button" href={e.url} download={`phonon-${e.id}.wav`}>
                ⬇
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
