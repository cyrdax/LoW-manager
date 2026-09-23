# Outfit420 Cloak Watch Design

**Date:** 2026-09-23  
**Status:** Approved in chat; awaiting written-spec review  
**Target platforms:** macOS and Windows

## Purpose

Outfit420 Cloak Watch is a small local desktop companion that watches the plain-text game logs written by EVE Online. When a new log entry states that the current ship has been decloaked, the companion plays a distinctive ping and shows an operating-system notification containing the character name and the original EVE message.

The companion is intentionally local and read-only. It does not determine continuous cloak state, interact with the EVE client, or automate any response.

## Product boundary

### In scope

- Installable macOS and Windows desktop applications.
- Automatic discovery of the conventional `Documents/EVE/logs/Gamelogs` directory.
- A folder picker for installations whose logs are stored elsewhere.
- Concurrent monitoring of all active game logs so multiple EVE clients are supported.
- Detection of English-language messages that report an actual decloak.
- A synthesized ping and an OS notification for each detected event.
- A tray/menu-bar interface for status and settings.
- Start-at-login enabled on first launch, with a user-controlled toggle.
- Local persistence of the selected folder and preferences.
- Unsigned development installers produced by automated macOS and Windows builds.

### Out of scope

- Reading EVE process memory, client files, cache data, or network traffic.
- Injecting into, modifying, focusing, or overlaying the EVE client.
- Sending keyboard, mouse, controller, or other input.
- Automatically reactivating a cloak or taking any gameplay action.
- Uploading raw logs or detected events to Outfit420 or any other service.
- ESI or EVE SSO integration.
- Claiming to know whether a ship is currently cloaked.
- Non-English message packs in the first release.
- Automatic updates, code signing, or macOS notarization in the first release.

## Compliance posture

CCP does not formally authorize third-party applications and reserves discretion over whether a tool creates an unfair advantage. This companion therefore cannot be described as guaranteed EULA- or TOS-safe.

The implementation minimizes risk by processing only user-selected plain-text game logs, remaining fully local, and providing output-only alerts. It must contain no code path capable of controlling EVE or another application. The README and About screen will state that the project is unofficial, that third-party tools are used at the player's own risk, and that gameplay automation is prohibited.

## Architecture

The companion will be a standalone Electron application under `desktop/cloak-watch/`. It will have its own `package.json`, lockfile, TypeScript configuration, tests, and build configuration. It will not be an npm workspace member and will not add Electron dependencies to the server application's root package. Railway installation and deployment therefore remain unchanged.

The application consists of five focused units:

1. **Log discovery** finds the platform's conventional EVE log directory and validates user-selected alternatives.
2. **Incremental log monitor** follows existing, new, rotated, and truncated `.txt` game logs without replaying historical events.
3. **Log parser** decodes EVE log files, identifies the character, parses new entries, and classifies actual decloak messages.
4. **Alert service** synthesizes the ping and creates the native notification according to saved preferences.
5. **Tray and settings UI** displays monitoring health and exposes the small set of controls.

All filesystem access and native Electron APIs stay in the main process. A context-isolated preload bridge exposes only the specific settings and test-alert operations required by the local renderer. The renderer loads packaged local content, has Node integration disabled, and uses a restrictive Content Security Policy.

## Log discovery

The default directory is the user's documents directory followed by `EVE/logs/Gamelogs`. The implementation obtains the documents directory through Electron rather than hard-coding a username or home directory. This supports the conventional location on both macOS and Windows.

On first launch:

1. If the conventional directory exists and is readable, monitoring starts immediately.
2. Otherwise the settings window explains that the log folder could not be found and offers a native folder picker.
3. A selected directory is accepted only when it exists, is readable, and is a directory.
4. The user may change or open the selected directory from the tray at any time.

The app never creates or modifies files inside the EVE log directory.

## Incremental monitoring

The monitor watches all `.txt` files in the selected directory and supports multiple simultaneous EVE clients.

- At startup, an existing file's header is read to discover its character, but its event cursor begins at the current end of file. Historical entries never alert.
- A file created after monitoring begins is read from its beginning so its header and subsequent entries are available.
- Each tracked file owns a byte cursor, streaming decoder, partial-line buffer, character name, and stable file identity where the platform exposes one.
- A change notification reads only bytes after the cursor. Repeated filesystem notifications cannot replay lines because the cursor advances only after bytes are consumed.
- If a file shrinks, the tracker treats it as truncation, resets its decoder and metadata, and reads the replacement content as a new live file.
- Directory reconciliation runs periodically in addition to native filesystem notifications so dropped or coalesced events do not permanently stop monitoring.
- Removing or losing access to the directory changes the application status to an actionable error. Restoring access or selecting another directory restarts monitoring.

The monitor recognizes UTF-8, UTF-8 with BOM, and UTF-16 little-endian with BOM. Decoding is streaming-safe so a multibyte character or line split across appends is not corrupted.

## Parsing and classification

EVE log headers contain a `Listener:` line. The parser uses it as the character name for that file. If a valid event arrives before a listener can be established, the alert identifies the source as `Unknown EVE client` rather than suppressing the warning.

Log entries are parsed from the standard timestamp/category/message structure. EVE markup is removed for matching and presentation, whitespace is normalized, and the original human-readable message is retained.

A line is classified as an actual decloak when all of these are true:

- It is a new parsed log entry rather than header text.
- The normalized message contains an explicit decloak expression, or contains a cloak/cloaking reference paired with deactivation, forced-disruption, or forced-disable language.
- It does not describe a failed activation, cooldown, inability to cloak, module recovery, or another condition where the ship never entered or did not just leave cloak.

The initial English rules must recognize proximity decloaks, Mobile Observatory decloaks, and general involuntary cloak deactivation messages. Rules are table-driven so new confirmed wording can be added without changing monitor behavior.

An alert event contains:

```ts
interface DecloakEvent {
  characterName: string;
  occurredAt: string;
  message: string;
  sourceFile: string;
  byteOffset: number;
}
```

`sourceFile` and `byteOffset` are internal deduplication and diagnostic data. They are never included in OS notifications or sent elsewhere.

## Alerts

Each accepted event is delivered once to the alert service.

- When sound is enabled, a hidden local renderer uses the Web Audio API to synthesize a short two-tone ping. No copyrighted audio asset or external media is required.
- When notifications are enabled, Electron creates a native notification titled `EVE decloak detected — <character>` whose body is the sanitized EVE message.
- Notification failures do not suppress the sound, and audio failures do not suppress the notification.
- The same alert path powers the tray's `Test alert` command without fabricating or writing an EVE log entry.

The app reports events only. It never raises, focuses, or sends input to the EVE client.

## Tray and settings experience

The app runs primarily from the macOS menu bar or Windows notification area. Closing the settings window hides it; only `Quit` terminates monitoring.

The tray menu contains:

- A non-interactive status line: `Watching <n> active logs`, `Waiting for EVE logs`, or a concise error.
- `Sound` checkbox, enabled initially.
- `Notifications` checkbox, enabled initially.
- `Start at login` checkbox, enabled initially.
- `Test alert`.
- `Open settings`.
- `Open log folder`.
- A disabled line containing the most recent character and detection time, or `No decloak detected this session`.
- `Quit`.

The settings window shows the selected directory, monitoring status, the same three toggles, folder selection, and a test-alert button. It also contains the compliance notice and a clear statement that Cloak Watch cannot determine continuous cloak state.

Preferences are stored as a small versioned JSON document in Electron's per-user application data directory. Updates use write-then-rename so a crash cannot leave a partially written settings file. Invalid settings fall back to safe defaults and surface a recoverable warning.

Electron's login-item API configures start-at-login on both platforms. Because the first release is unsigned, macOS may require the user to approve/open the application manually and login startup may be less reliable until signing and notarization are added.

## Error handling

- **Missing directory:** show `Log folder not found` and expose `Choose log folder`; keep the app running.
- **Permission denied:** show `Log folder is not readable`; retain the configured path so the user can repair permissions or replace it.
- **Malformed line:** ignore only that line and continue monitoring the file.
- **Unsupported encoding:** mark that file unsupported without stopping other files.
- **File deleted or rotated:** retire the old tracker and discover the replacement.
- **Settings corruption:** preserve the unreadable file with a `.corrupt` suffix, load defaults, and show a warning.
- **Notification permission denied:** keep sound active and show the permission state in settings.
- **Watcher failure:** retry with bounded backoff while periodic reconciliation remains active; show an error if retries are exhausted.

No error condition may cause historical events to replay.

## Packaging and delivery

The desktop package uses Electron Builder to produce:

- macOS `.dmg` and `.zip` artifacts.
- Windows NSIS installer and portable `.exe` artifacts.

A GitHub Actions matrix runs tests and packages on native `macos-latest` and `windows-latest` runners. Pull requests run tests and build validation. Version tags produce downloadable artifacts. The first release is unsigned and must document the corresponding Gatekeeper and SmartScreen warnings without suggesting users disable operating-system security globally.

No automatic update mechanism or remote endpoint is included.

## Testing strategy

### Unit tests

- Parse character names and standard event lines.
- Strip EVE markup safely.
- Recognize proximity, Mobile Observatory, and generic forced-decloak wording.
- Reject failed activation, cooldown, and unrelated cloak messages.
- Decode UTF-8 and UTF-16LE chunks split at arbitrary byte boundaries.
- Persist, migrate, and recover preferences.

### Integration tests

- Start from the end of an existing fixture and prove old decloaks do not alert.
- Append a decloak line in fragments and produce exactly one event.
- Create a new log after startup and detect its character and event.
- Monitor two character logs independently.
- Rotate, truncate, and delete logs without replaying events.
- Lose and restore directory access without crashing the application.

### Desktop smoke tests

- Verify tray lifecycle, window hiding, and explicit quit on macOS and Windows CI runners where supported.
- Verify `Test alert` reaches both sound and notification adapters through injected test adapters when native presentation is unavailable in headless CI.
- Package both platform artifacts successfully.
- Manually install and verify the first release on one current macOS machine and one current Windows machine before publishing it as stable.

## Acceptance criteria

The first release is complete when:

1. A user can install and launch Cloak Watch on current macOS and Windows.
2. The conventional EVE log directory is discovered automatically or can be selected manually.
3. Existing historical decloak lines never trigger on startup.
4. A newly appended supported decloak message produces one audible ping and one notification containing the correct character and reason.
5. Failed cloak activation and cooldown messages do not alert.
6. Multiple simultaneous EVE clients are monitored independently.
7. Sound, notifications, and start-at-login can be changed and survive restart.
8. Missing folders, permission problems, malformed lines, and log rotation do not crash the companion or replay old alerts.
9. No network request is made during normal operation.
10. The shipped code contains no facility for game input, client modification, process-memory access, packet inspection, or cache scraping.
11. Automated tests pass and both unsigned platform packages are produced in CI.

## Deferred work

- Code signing and macOS notarization.
- Automatic updates.
- Additional EVE client languages based on confirmed real log samples.
- Optional selection of alternate alert sounds.
- A CCP Support confirmation reference if written guidance is obtained.
