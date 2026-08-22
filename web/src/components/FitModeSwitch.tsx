export type FitMode = 'fits' | 'doctrines';

export function FitModeSwitch({ mode, onMode }: { mode: FitMode; onMode: (mode: FitMode) => void }) {
  return (
    <div className="fits-mode-switch" role="tablist" aria-label="Fits section">
      <button className={mode === 'fits' ? 'active' : ''} onClick={() => onMode('fits')} role="tab" aria-selected={mode === 'fits'}>
        Fits
      </button>
      <button className={mode === 'doctrines' ? 'active' : ''} onClick={() => onMode('doctrines')} role="tab" aria-selected={mode === 'doctrines'}>
        Doctrines
      </button>
    </div>
  );
}
