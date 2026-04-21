import { useEffect, useRef, useState } from 'react';
import { fetchCharacters, type CharacterStatus } from '../api.ts';

export function useCharacters() {
  const [chars, setChars] = useState<Map<number, CharacterStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchCharacters()
      .then(list => {
        if (cancelled) return;
        setChars(new Map(list.map(c => [c.characterId, c])));
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const es = new EventSource('/api/stream');
    esRef.current = es;

    es.addEventListener('snapshot', (ev) => {
      const list = JSON.parse((ev as MessageEvent).data) as CharacterStatus[];
      setChars(new Map(list.map(c => [c.characterId, c])));
    });

    es.addEventListener('status', (ev) => {
      const update = JSON.parse((ev as MessageEvent).data) as Partial<CharacterStatus> & { characterId: number };
      setChars(prev => {
        const next = new Map(prev);
        const existing = next.get(update.characterId);
        next.set(update.characterId, { ...(existing ?? ({ characterId: update.characterId, name: '' } as CharacterStatus)), ...update } as CharacterStatus);
        return next;
      });
    });

    es.addEventListener('removed', (ev) => {
      const { characterId } = JSON.parse((ev as MessageEvent).data);
      setChars(prev => {
        const next = new Map(prev);
        next.delete(characterId);
        return next;
      });
    });

    es.onerror = () => {
      // Let the browser auto-reconnect.
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  const refresh = async () => {
    const list = await fetchCharacters();
    setChars(new Map(list.map(c => [c.characterId, c])));
  };

  return { chars, loading, refresh };
}
