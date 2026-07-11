import type { LibraryVisibility } from '../api.ts';

interface Props {
  value: LibraryVisibility;
  onChange: (value: LibraryVisibility) => void;
}

export function LibraryScopeSwitch({ value, onChange }: Props) {
  return (
    <div className="library-scope-switch" aria-label="Library scope">
      <button className={value === 'private' ? 'active' : ''} onClick={() => onChange('private')}>
        Private
      </button>
      <button className={value === 'public' ? 'active' : ''} onClick={() => onChange('public')}>
        Public
      </button>
    </div>
  );
}
