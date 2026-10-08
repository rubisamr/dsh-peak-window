// dsh-peak-window — mitad de cliente: el distintivo del compositor.
//
// Es un bundle de módulos del navegador (`__ModuleLoader__.load`), no un módulo ESM
// normal: el GUI carga los plugins de cliente así, y omitir el handshake no falla «sólo
// este paquete», falla la petición del combo entero. El cuerpo es una fábrica que
// devuelve `{ inject, apply }` y al final se copia a `exports`, porque el cargador lee
// `exports.apply` y `exports.inject` directamente.
//
// Dos reglas que vienen de lo que le pasaba al plugin que este reemplaza:
//
//   1. **Las cuentas no se duplican.** El horario lo calcula el host y aquí sólo se
//      resta: el distintivo se queda con `nowMs` y los dos bordes, así que un reloj
//      desajustado en la máquina que mira no puede volver mentirosa la cuenta atrás.
//   2. **Esto no puede reventar.** Todo el render va dentro de un `try`, y si algo falla
//      se pinta un texto honesto en vez de dejar el hueco en blanco: un distintivo que
//      desaparece sin decir nada es exactamente el fallo que había que arreglar.

window.__ModuleLoader__.load({
  id: "dsh-peak-window",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    /** La misma ruta que sirve la mitad de host. */
    var ROUTE = "/dsh-peak-window/api/peak-status";

    /** Cada cuánto se le vuelve a preguntar al host (el estado cambia cada horas). */
    var REFRESH_MS = 60000;

    /** Cada cuánto se repinta la cuenta atrás, para que corra. */
    var TICK_MS = 30000;

    /** El estilo, una sola vez. Nombres propios para no pisar a nadie. */
    var CSS = [
      ".dshPeakStatus{display:inline-flex;align-items:center;gap:6px;font-size:12px;",
      "line-height:1;white-space:nowrap;vertical-align:middle}",
      ".dshPeakStatusDot{width:7px;height:7px;border-radius:50%;background:currentColor;",
      "display:inline-block;flex:0 0 auto}",
      ".dshPeakStatusLabel{font-weight:600}",
      ".dshPeakStatusMeta{opacity:.75}",
      ".dshPeakStatusSep{opacity:.4}",
    ].join("");

    function insertStyles() {
      var el = document.createElement("style");
      el.dataset.plugin = "dsh-peak-window";
      el.textContent = CSS;
      document.head.appendChild(el);
      return function () {
        if (el.parentNode !== null) el.parentNode.removeChild(el);
      };
    }

    /** La cuenta atrás, en el formato más corto que siga siendo útil. */
    function countdown(ms) {
      if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "ahora";
      var total = Math.floor(ms / 1000);
      var d = Math.floor(total / 86400);
      var h = Math.floor((total % 86400) / 3600);
      var m = Math.floor((total % 3600) / 60);
      if (d > 0) return d + "d " + h + "h";
      if (h > 0) return h + "h " + m + "m";
      if (m > 0) return m + "m";
      return "<1m";
    }

    /** El color y la etiqueta de cada estado. */
    function palette(peak, weekend) {
      if (weekend) return { color: "#4ade80", label: "Finde" };
      if (peak) return { color: "#f87171", label: "Pico" };
      return { color: "#fbbf24", label: "Valle" };
    }

    /**
     * Un almacén minúsculo para `useSyncExternalStore`: se pregunta al host, se guarda
     * el último estado bueno y se avisa a quien escuche. La consulta vive fuera de React
     * a propósito: así no se repite en cada repintado.
     */
    function createStore() {
      var state = { status: null, error: false };
      var listeners = new Set();
      var timer = null;

      function emit() {
        listeners.forEach(function (fn) {
          try {
            fn();
          } catch (err) {
            /* un suscriptor roto no puede llevarse el sondeo */
          }
        });
      }

      function read() {
        return fetch(ROUTE, { headers: { accept: "application/json" } })
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          })
          .then(function (body) {
            // Se valida lo que llega: si el host contestara otra cosa, el distintivo
            // dice «no disponible» en vez de pintar una cuenta atrás inventada.
            if (body === null || typeof body !== "object" || typeof body.nowMs !== "number") {
              throw new Error("respuesta inesperada");
            }
            state = { status: body, error: false };
          })
          .catch(function () {
            // Se conserva el último estado bueno: es mejor una cuenta atrás de hace un
            // minuto que un hueco en blanco.
            state = { status: state.status, error: true };
          })
          .then(emit);
      }

      return {
        subscribe: function (fn) {
          listeners.add(fn);
          if (timer === null) {
            read();
            timer = setInterval(read, REFRESH_MS);
          }
          return function () {
            listeners.delete(fn);
            if (listeners.size === 0 && timer !== null) {
              clearInterval(timer);
              timer = null;
            }
          };
        },
        getSnapshot: function () {
          return state;
        },
      };
    }

    /** @param {object} props - los estándar del hueco. */
    function PeakBadge(props) {
      try {
        var store = props.store;
        var snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);

        // Un latido para que la cuenta atrás corra entre consulta y consulta.
        var tick = React.useState(0);
        var setTick = tick[1];
        React.useEffect(function () {
          var id = setInterval(function () {
            setTick(function (n) {
              return n + 1;
            });
          }, TICK_MS);
          return function () {
            clearInterval(id);
          };
        }, []);

        var status = snapshot.status;
        if (status === null) {
          return React.createElement(
            "span",
            { className: "dshPeakStatus", style: { color: "#9ca3af" }, role: "status" },
            snapshot.error ? "Precio de DeepSeek no disponible" : "Consultando precio\u2026",
          );
        }

        var pal = palette(status.peak === true, status.weekend === true);
        // El desfase entre el reloj del host y el de aquí se mide una vez, al recibir el
        // estado, y se arrastra: así la cuenta atrás avanza aunque los relojes no cuadren.
        var skew = Date.now() - status.nowMs;
        var target = status.peak === true ? status.offPeakStartMs : status.peakStartMs;
        var remaining = typeof target === "number" ? target - (Date.now() - skew) : null;
        var primary =
          remaining === null
            ? "sin próximo cambio"
            : (status.peak === true ? "Valle en " : "Pico en ") + countdown(remaining);
        var title = status.weekend === true
          ? "DeepSeek: fin de semana, todo el día a tarifa valle (mitad de precio)"
          : "DeepSeek: pico de lunes a viernes, 01:00-04:00 y 06:00-10:00 UTC. " +
            "Fuera de esas horas la tarifa es la mitad.";

        return React.createElement(
          "span",
          { className: "dshPeakStatus", style: { color: pal.color }, title: title, role: "status" },
          React.createElement("span", { className: "dshPeakStatusDot" }),
          React.createElement("span", { className: "dshPeakStatusLabel" }, pal.label),
          React.createElement("span", { className: "dshPeakStatusSep", "aria-hidden": true }, "\u00b7"),
          React.createElement("span", { className: "dshPeakStatusMeta" }, primary),
        );
      } catch (err) {
        // Última red: pase lo que pase, el hueco no se queda vacío.
        return React.createElement(
          "span",
          { className: "dshPeakStatus", style: { color: "#9ca3af" }, role: "status" },
          "Precio de DeepSeek no disponible",
        );
      }
    }

    function client() {
      return {
        inject: ["slots"],
        apply(ctx) {
          const slots = ctx.get("slots");
          if (slots === undefined) return;

          const disposeStyles = insertStyles();
          // Un almacén para todo el proceso del cliente: el estado es del host, no de
          // una conversación concreta, así que no hace falta uno por sesión.
          const store = createStore();

          slots.inject("conversation.input.left", () =>
            slots.register({ name: "conversation.input.left", id: "peak-window" }, (props) =>
              React.createElement(PeakBadge, { ...props, store }),
            ),
          );

          ctx.effect(() => disposeStyles, "peak-window: estilos");
        },
      };
    }

    // El cuerpo escrito es una fábrica; el bundle tiene que exponer los campos del plugin.
    var plugin = client();
    exports.apply = plugin.apply;
    if (plugin.inject !== undefined) exports.inject = plugin.inject;
    exports.default = plugin;
    return module.exports;
  },
});
