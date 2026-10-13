const RELEASES_URL = 'https://github.com/cyrdax/LoW-manager/releases/latest';

export function ToolsView() {
  return (
    <main className="rows-wrap tools-page">
      <section className="tools-hero">
        <div className="tools-hero-copy">
          <p className="tools-kicker">Outfit420 desktop companion</p>
          <div className="tools-title-line">
            <h1>Cloak Watch</h1>
            <span className="tools-preview-pill">Preview</span>
          </div>
          <p className="tools-lede">
            Get a local alert when a supported EVE GameLog message reports that one of your cloaking devices deactivated.
          </p>
          <div className="tools-downloads" aria-label="Cloak Watch downloads">
            <a className="tools-download primary" href={RELEASES_URL} target="_blank" rel="noreferrer">
              <span aria-hidden="true">⌘</span>
              <span><strong>Download for macOS</strong><small>DMG or ZIP</small></span>
            </a>
            <a className="tools-download" href={RELEASES_URL} target="_blank" rel="noreferrer">
              <span aria-hidden="true">⊞</span>
              <span><strong>Download for Windows</strong><small>Installer or portable</small></span>
            </a>
          </div>
          <p className="tools-release-note">Unsigned preview · version 0.1.0 · downloads open on GitHub</p>
        </div>

        <div className="tools-monitor" aria-label="Example Cloak Watch monitor">
          <div className="tools-monitor-bar">
            <span className="tools-monitor-dots" aria-hidden="true">● ● ●</span>
            <span>LOCAL MONITOR</span>
          </div>
          <div className="tools-monitor-state">
            <span className="tools-pulse" aria-hidden="true" />
            <div><strong>Watching GameLogs</strong><small>New entries only</small></div>
          </div>
          <div className="tools-monitor-event">
            <span>Latest detection</span>
            <strong>Cloaking device deactivated</strong>
            <small>Sound + desktop notification</small>
          </div>
          <div className="tools-monitor-footer"><span>NO NETWORK</span><span>READ ONLY</span></div>
        </div>
      </section>

      <section className="tools-section" aria-labelledby="tools-how-heading">
        <div className="tools-section-heading">
          <p className="tools-kicker">Simple by design</p>
          <h2 id="tools-how-heading">How it works</h2>
        </div>
        <div className="tools-flow" aria-label="EVE GameLogs to local parser to notification">
          <div className="tools-flow-step"><span>01</span><strong>EVE GameLogs</strong><small>New combat-log lines on this computer</small></div>
          <span className="tools-flow-arrow" aria-hidden="true">→</span>
          <div className="tools-flow-step"><span>02</span><strong>Read-only local parser</strong><small>Recognizes supported decloak messages</small></div>
          <span className="tools-flow-arrow" aria-hidden="true">→</span>
          <div className="tools-flow-step"><span>03</span><strong>Local alert</strong><small>Sound or desktop notification</small></div>
        </div>
        <div className="tools-boundaries">
          <div><span aria-hidden="true">✓</span><p><strong>Private by default</strong>No network requests. Logs, settings, and character names stay on your computer.</p></div>
          <div><span aria-hidden="true">✓</span><p><strong>No gameplay automation</strong>Cloak Watch never controls or modifies the EVE client and never sends input.</p></div>
          <div><span aria-hidden="true">!</span><p><strong>Detection has limits</strong>It cannot know your continuous cloak state or recover events missed while it was closed.</p></div>
        </div>
      </section>

      <section className="tools-section" aria-labelledby="tools-install-heading">
        <div className="tools-section-heading">
          <p className="tools-kicker">Unsigned preview</p>
          <h2 id="tools-install-heading">Installation</h2>
          <p>Use the per-app approval below. Do not disable Gatekeeper or SmartScreen globally.</p>
        </div>
        <div className="tools-install-grid">
          <article className="tools-install-card">
            <div className="tools-platform"><span aria-hidden="true">⌘</span><div><h3>Install on macOS</h3><small>DMG or ZIP</small></div></div>
            <ol>
              <li>Download the macOS file from the GitHub release and move Cloak Watch to Applications.</li>
              <li>In Finder, Control-click the app, choose <strong>Open</strong>, then confirm <strong>Open</strong>.</li>
              <li>If it is still blocked, use <strong>Privacy &amp; Security → Open Anyway</strong> for this app only.</li>
            </ol>
          </article>
          <article className="tools-install-card">
            <div className="tools-platform"><span aria-hidden="true">⊞</span><div><h3>Install on Windows</h3><small>Setup or portable EXE</small></div></div>
            <ol>
              <li>Download the installer or portable executable from the GitHub release.</li>
              <li>At the SmartScreen prompt, choose <strong>More info</strong> and verify the download came from this repository.</li>
              <li>Choose <strong>Run anyway</strong>. The portable build needs no installation.</li>
            </ol>
          </article>
        </div>
        <div className="tools-log-path">
          <strong>First run</strong>
          <p>Cloak Watch looks in the normal <code>Documents/EVE/logs/Gamelogs</code> folder. If EVE or OneDrive stores it elsewhere, choose that <code>Gamelogs</code> folder in settings.</p>
        </div>
      </section>

      <section className="tools-details-grid" aria-label="Cloak Watch capabilities and troubleshooting">
        <article className="tools-detail-card">
          <p className="tools-kicker">Alerts and controls</p>
          <h2>What you can configure</h2>
          <ul>
            <li>Sound and desktop notifications independently</li>
            <li>Start at login</li>
            <li>GameLog folder selection</li>
            <li>Test Alert and latest detection</li>
            <li>Per-pilot names from EVE's Listener header</li>
          </ul>
        </article>
        <article className="tools-detail-card">
          <p className="tools-kicker">Quick checks</p>
          <h2>Troubleshooting</h2>
          <dl>
            <div><dt>No logs found</dt><dd>Start EVE, enter space, then select the active GameLogs folder.</dd></div>
            <div><dt>No alert</dt><dd>Run Test Alert and check operating-system notification permissions.</dd></div>
            <div><dt>Expected event missed</dt><dd>Keep a redacted copy of the relevant log line when reporting it.</dd></div>
          </dl>
        </article>
      </section>

      <section className="tools-policy-note">
        <p><strong>Use third-party EVE tools at your own risk.</strong> Review CCP's policies before use.</p>
        <div>
          <a href="https://support.eveonline.com/hc/en-us/articles/8564030965660-Third-Party-Policies" target="_blank" rel="noreferrer">CCP Third Party Policies ↗</a>
          <a href="https://support.eveonline.com/hc/en-us/articles/5888034246428-Third-party-applications" target="_blank" rel="noreferrer">Third-party applications guidance ↗</a>
        </div>
      </section>
    </main>
  );
}
