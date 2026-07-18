/** Ненавязчивое уведомление о новой версии — отдельно от логики проверки */

let sessionShown = false;
let hideTimer = null;
let el = null;

function ensureEl() {
  if (el) return el;
  el = document.getElementById('version-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'version-notification';
    el.className = 'version-notification hidden';
    el.setAttribute('aria-live', 'polite');
    const stage = document.getElementById('stage');
    if (stage) stage.appendChild(el);
    else document.body.appendChild(el);
  }
  return el;
}

export function showVersionNotification(remoteVersion) {
  if (sessionShown || !remoteVersion) return;
  const node = ensureEl();
  if (!node) return;
  sessionShown = true;
  node.innerHTML =
    '<div class="vn-title">Доступна версия v' + remoteVersion + '</div>' +
    '<div class="vn-hint">Рекомендуем обновить страницу.</div>';
  node.classList.remove('hidden', 'fade-out');
  node.classList.add('fade-in');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    node.classList.remove('fade-in');
    node.classList.add('fade-out');
    setTimeout(() => {
      node.classList.add('hidden');
      node.classList.remove('fade-out');
    }, 500);
  }, 10000);
}

export function _resetVersionNotificationForTest() {
  sessionShown = false;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (el) {
    el.classList.add('hidden');
    el.classList.remove('fade-in', 'fade-out');
  }
}
