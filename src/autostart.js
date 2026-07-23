// Start Beacon's daemon on login. Best-effort, per-OS. Returns { ok, enabled, message }.
// Windows: a hidden-launch .vbs in the user's Startup folder.
// Linux:   an XDG autostart .desktop file.
// macOS:   a LaunchAgent plist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(__dirname, 'daemon.js');
const NODE = process.execPath;

function winStartupFile() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'beacon-autostart.vbs');
}
function linuxAutostartFile() {
  return path.join(os.homedir(), '.config', 'autostart', 'beacon.desktop');
}
function macAgentFile() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.beacon.daemon.plist');
}

export function setAutoStart(enabled) {
  try {
    if (process.platform === 'win32') {
      const f = winStartupFile();
      if (enabled) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        // WindowStyle 0 = hidden, so no console flashes on login.
        fs.writeFileSync(f, `CreateObject("WScript.Shell").Run """${NODE}"" ""${DAEMON}""", 0, False\n`);
      } else if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      return { ok: true, enabled };
    }
    if (process.platform === 'linux') {
      const f = linuxAutostartFile();
      if (enabled) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Beacon\nExec="${NODE}" "${DAEMON}"\nX-GNOME-Autostart-enabled=true\n`);
      } else if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      return { ok: true, enabled };
    }
    if (process.platform === 'darwin') {
      const f = macAgentFile();
      if (enabled) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.beacon.daemon</string>\n<key>ProgramArguments</key><array><string>${NODE}</string><string>${DAEMON}</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`);
        spawnSync('launchctl', ['load', f]);
      } else if (fs.existsSync(f)) { spawnSync('launchctl', ['unload', f]); fs.rmSync(f, { force: true }); }
      return { ok: true, enabled };
    }
    return { ok: false, enabled: false, message: `auto-start not supported on ${process.platform} yet` };
  } catch (e) {
    return { ok: false, enabled, message: (e && e.message) || String(e) };
  }
}

export function isAutoStartEnabled() {
  try {
    if (process.platform === 'win32') return fs.existsSync(winStartupFile());
    if (process.platform === 'linux') return fs.existsSync(linuxAutostartFile());
    if (process.platform === 'darwin') return fs.existsSync(macAgentFile());
  } catch { /* */ }
  return false;
}
