# Outfit420 Cloak Watch

Cloak Watch is a small, local-only desktop companion for EVE Online. It watches new lines appended to EVE combat logs and alerts when a log message indicates that one of your cloaking devices deactivated.

It does not read memory, inspect network traffic, control the EVE client, press keys, or automate gameplay. It cannot determine your current cloak state or reconstruct decloaks that happened while it was not running. Log wording can also change, so treat every alert as a convenience—not a guarantee.

## Download

Unsigned preview builds are published on the [GitHub Releases page](https://github.com/cyrdax/LoW-manager/releases). Each release includes:

- macOS: DMG and ZIP
- Windows: installer (`Setup.exe`) and portable executable

These preview builds are unsigned. Only download them from the repository above.

## Install on macOS

1. Download the DMG or ZIP from the GitHub release and place **Outfit420 Cloak Watch** in Applications.
2. In Finder, open Applications, Control-click the app, choose **Open**, then confirm **Open**.
3. If macOS still blocks it, open **System Settings → Privacy & Security** and use **Open Anyway** for this app only.

Do not disable Gatekeeper globally.

## Install on Windows

1. Download either the installer or portable executable from the GitHub release.
2. If Microsoft Defender SmartScreen appears, choose **More info**, confirm the file came from this repository, then choose **Run anyway**.
3. For the installer build, choose the destination folder and finish setup. The portable build runs without installation.

Do not disable SmartScreen globally.

## First run

Cloak Watch first looks for the conventional EVE log folder:

- macOS: `~/Documents/EVE/logs/Gamelogs`
- Windows: `%USERPROFILE%\Documents\EVE\logs\Gamelogs`

If your Documents folder is redirected—commonly through OneDrive—or EVE stores logs elsewhere, use **Choose log folder** and select the `Gamelogs` directory manually.

The tray menu and settings window let you:

- see whether logs are being watched;
- turn sound and desktop notifications on or off independently;
- send a Test Alert;
- open the selected log folder;
- start Cloak Watch when you sign in; and
- inspect the most recent decloak event seen during this run.

Existing log history is ignored at startup. Only newly appended events trigger alerts.

## Privacy and gameplay boundary

The complete data flow is local:

```text
EVE GameLogs → read-only local parser → sound and/or desktop notification
```

Cloak Watch has no network feature and does not upload logs, character names, settings, or alert history. Its settings remain on the computer. It performs no input, client manipulation, or gameplay action.

Third-party EVE tools are used at your own risk. Review CCP's [Third Party Policies](https://support.eveonline.com/hc/en-us/articles/8564030965660-Third-Party-Policies) and [Third party applications guidance](https://support.eveonline.com/hc/en-us/articles/5888034246428-Third-party-applications). Stop using the tool if you are uncertain whether it is permitted for your situation.

## Troubleshooting

- **No logs found:** start EVE, enter space, and confirm combat logging is enabled; then choose the active `Gamelogs` folder manually.
- **No alert:** use **Test Alert** first, then confirm sound/notification preferences and operating-system notification permissions.
- **Old messages triggered:** this is a bug; report it with the platform, app version, and a redacted sample log.
- **An expected decloak was missed:** preserve the relevant redacted log line when reporting it. The parser deliberately alerts only on recognized successful deactivation messages and excludes failed activation messages.

## Development and packaging

From the repository root:

```bash
npm ci --prefix desktop/cloak-watch
npm test --prefix desktop/cloak-watch
npm run typecheck --prefix desktop/cloak-watch
npm run dev --prefix desktop/cloak-watch
```

Native packages must be built on their target operating system:

```bash
npm run package:mac --prefix desktop/cloak-watch
npm run package:win --prefix desktop/cloak-watch
```

Release tags use the form `cloak-watch-v0.1.0`. The GitHub workflow builds on both native hosts and uploads to a draft release for inspection before publication.
