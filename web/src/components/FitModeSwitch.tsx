export type FitMode = 'fits' | 'fits-v2' | 'doctrines';

export function FitModeSwitch({ mode, onMode }: { mode: FitMode; onMode: (mode: FitMode) => void }) {
  return (
    <div className="fits-mode-switch" role="tablist" aria-label="Fits section">
      <button className={mode === 'fits' ? 'active' : ''} onClick={() => onMode('fits')} role="tab" aria-selected={mode === 'fits'}>
        Fits
      </button>
      <button className={mode === 'fits-v2' ? 'active' : ''} onClick={() => onMode('fits-v2')} role="tab" aria-selected={mode === 'fits-v2'}>
        Fits v2
      </button>
      <button className={mode === 'doctrines' ? 'active' : ''} onClick={() => onMode('doctrines')} role="tab" aria-selected={mode === 'doctrines'}>
        Doctrines
      </button>
    </div>
  );
}
