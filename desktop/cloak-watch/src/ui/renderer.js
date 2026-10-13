const elements = {
  statusText: document.querySelector('#status-text'),
  logDirectory: document.querySelector('#log-directory'),
  soundEnabled: document.querySelector('#sound-enabled'),
  notificationsEnabled: document.querySelector('#notifications-enabled'),
  startAtLogin: document.querySelector('#start-at-login'),
  latestEventText: document.querySelector('#latest-event-text'),
  warning: document.querySelector('#warning'),
  chooseFolder: document.querySelector('#choose-folder'),
  testAlert: document.querySelector('#test-alert'),
};

function render(state) {
  elements.statusText.textContent = state.statusText;
  elements.logDirectory.textContent = state.logDirectory || 'No log folder selected';
  elements.soundEnabled.checked = state.soundEnabled;
  elements.notificationsEnabled.checked = state.notificationsEnabled;
  elements.startAtLogin.checked = state.startAtLogin;
  elements.latestEventText.textContent = state.latestEventText || 'No decloak detected this session.';
  elements.warning.textContent = state.warning || '';
  elements.warning.hidden = !state.warning;
}

async function run(button, action) {
  button.disabled = true;
  try {
    const state = await action();
    if (state) render(state);
  } catch (error) {
    elements.warning.textContent = error instanceof Error ? error.message : String(error);
    elements.warning.hidden = false;
  } finally {
    button.disabled = false;
  }
}

elements.chooseFolder.addEventListener('click', () => {
  void run(elements.chooseFolder, () => window.cloakWatch.chooseLogDirectory());
});
elements.testAlert.addEventListener('click', () => {
  void run(elements.testAlert, () => window.cloakWatch.testAlert());
});
elements.soundEnabled.addEventListener('change', () => {
  void window.cloakWatch.setSoundEnabled(elements.soundEnabled.checked).then(render);
});
elements.notificationsEnabled.addEventListener('change', () => {
  void window.cloakWatch.setNotificationsEnabled(elements.notificationsEnabled.checked).then(render);
});
elements.startAtLogin.addEventListener('change', () => {
  void window.cloakWatch.setStartAtLogin(elements.startAtLogin.checked).then(render);
});

window.cloakWatch.onState(render);
window.cloakWatch.onPlayPing(playPing);
void window.cloakWatch.getState().then(render);

async function playPing() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContext();
  await context.resume();
  const start = context.currentTime;
  tone(context, 740, start, 0.11);
  tone(context, 988, start + 0.13, 0.14);
  window.setTimeout(() => { void context.close(); }, 450);
}

function tone(context, frequency, start, duration) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}
