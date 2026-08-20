import type { CharacterStatus, CurrentUser } from '../api.ts';

type View = 'pilots' | 'planets' | 'skills' | 'fleet' | 'market' | 'industry' | 'contracts' | 'fits' | 'assets';

interface Props {
  chars: CharacterStatus[];
  selection: Set<number>;
  view: View;
  setView: (v: View) => void;
  currentUser?: CurrentUser;
  onLogout?: () => void;
}

export function ControlPanel({ chars, selection, view, setView, currentUser, onLogout }: Props) {
  const mainPilot = currentUser?.mainCharacterId
    ? chars.find(c => c.characterId === currentUser.mainCharacterId) ?? null
    : null;

  return (
    <aside className="sidebar">
      <div>
        <h1>Legion of Wayne Manger</h1>
        <small>{chars.length} characters · {selection.size} selected</small>
      </div>

      {currentUser && (
        <div className="account-box">
          <div className="account-identity">
            {mainPilot && <img src={mainPilot.portraitUrl} alt="" />}
            <div>
              <span>{mainPilot?.name ?? currentUser.email ?? 'Account'}</span>
              <small>{mainPilot && currentUser.email ? `${currentUser.email} · ${currentUser.role}` : currentUser.role}</small>
            </div>
          </div>
          <button onClick={onLogout}>Log out</button>
        </div>
      )}

      <div className="view-nav view-nav-9">
        <button
          className={`nav-btn${view === 'pilots' ? ' active' : ''}`}
          onClick={() => setView('pilots')}
        >Pilots</button>
        <button
          className={`nav-btn${view === 'skills' ? ' active' : ''}`}
          onClick={() => setView('skills')}
        >Skills</button>
        <button
          className={`nav-btn${view === 'fleet' ? ' active' : ''}`}
          onClick={() => setView('fleet')}
        >Fleet</button>
        <button
          className={`nav-btn${view === 'fits' ? ' active' : ''}`}
          onClick={() => setView('fits')}
        >Fits</button>
        <button
          className={`nav-btn${view === 'assets' ? ' active' : ''}`}
          onClick={() => setView('assets')}
        >Assets</button>
        <button
          className={`nav-btn${view === 'market' ? ' active' : ''}`}
          onClick={() => setView('market')}
        >Market</button>
        <button
          className={`nav-btn${view === 'contracts' ? ' active' : ''}`}
          onClick={() => setView('contracts')}
        >Contracts</button>
        <button
          className={`nav-btn${view === 'industry' ? ' active' : ''}`}
          onClick={() => setView('industry')}
        >Industry</button>
        <button
          className={`nav-btn${view === 'planets' ? ' active' : ''}`}
          onClick={() => setView('planets')}
        >Planets</button>
      </div>
    </aside>
  );
}
