// Best-effort native OS notification, zero-dependency, per-OS. Fired by the daemon so it works
// even when no dashboard page is open. Never throws.
import { spawn } from 'node:child_process';

function safe(s) { return String(s || '').replace(/['"\r\n`]/g, ' ').slice(0, 180); }

export function notify(title, message) {
  const t = safe(title), m = safe(message);
  try {
    if (process.platform === 'win32') {
      const ps = [
        "$ErrorActionPreference='SilentlyContinue'",
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null',
        "$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
        "$n=$x.GetElementsByTagName('text')",
        `$n.Item(0).AppendChild($x.CreateTextNode('${t}')) > $null`,
        `$n.Item(1).AppendChild($x.CreateTextNode('${m}')) > $null`,
        '$toast=[Windows.UI.Notifications.ToastNotification]::new($x)',
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Beacon').Show($toast)",
      ].join('; ');
      spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `display notification "${m}" with title "${t}"`], { stdio: 'ignore' }).unref();
    } else {
      spawn('notify-send', ['-a', 'Beacon', t, m], { stdio: 'ignore' }).unref();
    }
  } catch { /* best-effort — never throw */ }
}
