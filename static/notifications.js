/*
 * Notificaciones nativas del sistema operativo (fuera del navegador).
 *
 * Usa la Notification API junto con el Service Worker ya registrado por la
 * app: eso hace que el aviso se muestre como una notificacion nativa del
 * sistema (centro de notificaciones de Windows/macOS/Linux, o la barra de
 * notificaciones de Android si se instalo como app), no como algo dibujado
 * dentro de la pestana. Funciona mientras la app/pestana siga cargada (en
 * primer o segundo plano); si el usuario cierra la app por completo, no hay
 * forma de avisarle sin un servidor de push por internet (VAPID/FCM), que
 * queda fuera del alcance de una app 100% de red local.
 */

const NotificationsModule = (() => {
  let enabled = false;

  function isSupported() {
    return "Notification" in window;
  }

  function permission() {
    return isSupported() ? Notification.permission : "unsupported";
  }

  async function requestPermission() {
    if (!isSupported()) return "unsupported";
    if (Notification.permission === "granted") {
      enabled = true;
      return "granted";
    }
    const result = await Notification.requestPermission();
    enabled = result === "granted";
    return result;
  }

  function setEnabled(value) {
    enabled = value && Notification.permission === "granted";
  }

  function isEnabled() {
    return enabled && isSupported() && Notification.permission === "granted";
  }

  /** Muestra una notificacion nativa. No hace nada si no hay permiso o esta desactivada. */
  async function notify(title, options = {}) {
    if (!isEnabled()) return;
    // Si la pestana esta al frente y visible, no interrumpimos con una
    // notificacion nativa (el toast dentro de la app ya avisa); las
    // mandamos solo cuando el usuario no esta viendo la pestana en ese
    // momento, que es justo el caso donde una notificacion "de verdad" sirve.
    if (document.visibilityState === "visible" && document.hasFocus()) return;

    const finalOptions = {
      icon: "/static/icons/icon-192.png",
      badge: "/static/icons/icon-192.png",
      ...options,
    };

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, finalOptions);
          return;
        }
      }
    } catch {
      // sigue al fallback de abajo
    }
    try {
      new Notification(title, finalOptions);
    } catch {
      // Si el navegador tampoco permite esto (poco comun), simplemente no
      // se muestra nada nativo; el toast dentro de la app sigue funcionando.
    }
  }

  return { isSupported, permission, requestPermission, setEnabled, isEnabled, notify };
})();
