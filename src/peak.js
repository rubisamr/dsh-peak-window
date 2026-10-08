// Las cuentas de las ventanas de precio de DeepSeek, y la ruta que las sirve.
//
// DeepSeek cobra la mitad en las horas valle. El horario publicado —y el que siguen
// estas cuentas— es, **en UTC y sólo de lunes a viernes**:
//
//     01:00 – 04:00   pico
//     06:00 – 10:00   pico
//
// El resto de la semana (los dos huecos del día, toda la tarde-noche y el fin de semana
// entero) es valle. Los bordes son **abiertos por la derecha**: a las 04:00 en punto ya
// no es pico. Las cinco formas de borde —los dos bloques, el hueco entre ellos, los dos
// extremos del fin de semana y la vuelta al pico después— están en las pruebas.
//
// El reloj que manda es **el del host**, y por eso lo que viaja al cliente es el
// instante `nowMs` junto a los dos bordes: el navegador sólo resta. Así la cuenta atrás
// no puede mentir por un reloj desajustado en la máquina que mira.
//
// Las ventanas y la dirección de cada búsqueda son las mismas que publica el plugin
// `@imnotndesh/dsh-peak-pricing-warning` (MIT, © Imnotndesh), cuyo horario es correcto:
// lo que se reescribe aquí es el resto —la mitad de host que no llegaba a montarse y una
// mitad de cliente que se quedaba en blanco—. Ver el README.

/** La ruta exacta que consulta el distintivo. Propia, con espacio de nombres propio. */
export const PEAK_ROUTE = "/dsh-peak-window/api/peak-status";

/** Ventanas de pico, en minutos desde las 00:00 UTC, como [inicio, fin). */
const PEAK_BLOCKS = [
  [60, 240], // 01:00 – 04:00 UTC
  [360, 600], // 06:00 – 10:00 UTC
];

const MIN = 60000;

/**
 * ¿El día UTC es fin de semana? En fin de semana no hay pico.
 * @param {number} dayUtc - 0=domingo … 6=sábado.
 * @returns {boolean}
 */
export function treatAsWeekend(dayUtc) {
  return dayUtc === 0 || dayUtc === 6;
}

/**
 * ¿Ese instante cae en una ventana de pico?
 * @param {number} ms - milisegundos desde la época.
 * @returns {boolean}
 */
export function inPeakWindow(ms) {
  const d = new Date(ms);
  if (treatAsWeekend(d.getUTCDay())) return false;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const [inicio, fin] of PEAK_BLOCKS) {
    if (m >= inicio && m < fin) return true;
  }
  return false;
}

/**
 * El primer instante alineado al minuto, desde `fromMs`, que cumpla `match`.
 * @param {number} fromMs
 * @param {(t: number) => boolean} match
 * @returns {number | null}
 */
function forward(fromMs, match) {
  let t = Math.ceil(fromMs / MIN) * MIN;
  for (let i = 0; i < 60 * 24 * 8; i++) {
    if (match(t)) return t;
    t += MIN;
  }
  return null;
}

/**
 * El último instante alineado al minuto, hasta `fromMs`, que cumpla `match`.
 * @param {number} fromMs
 * @param {(t: number) => boolean} match
 * @returns {number | null}
 */
function backward(fromMs, match) {
  let t = Math.floor(fromMs / MIN) * MIN;
  for (let i = 0; i < 60 * 24 * 8; i++) {
    if (match(t)) return t;
    t -= MIN;
  }
  return null;
}

/**
 * Inicio de la franja barata que gobierna `nowMs`, y del próximo pico.
 *
 * La dirección de cada búsqueda importa: **en pico** la franja barata está por llegar
 * (se busca hacia delante), y **fuera de pico** la que manda ya empezó (se busca hacia
 * atrás, hasta su borde de apertura). Al revés, la franja en curso parecería empezar
 * ahora y la cuenta atrás se quedaría en cero.
 *
 * @param {number} nowMs
 * @returns {{ offPeakStartMs: number | null, peakStartMs: number | null }}
 */
export function windowBounds(nowMs) {
  if (inPeakWindow(nowMs)) {
    return {
      offPeakStartMs: forward(nowMs, (t) => !inPeakWindow(t)),
      peakStartMs: forward(nowMs, (t) => inPeakWindow(t)),
    };
  }
  const offPeakStartMs = backward(nowMs, (t) => !inPeakWindow(t) && inPeakWindow(t - MIN));
  if (offPeakStartMs === null) return { offPeakStartMs: null, peakStartMs: null };
  return {
    offPeakStartMs,
    peakStartMs: forward(offPeakStartMs + MIN, (t) => inPeakWindow(t)),
  };
}

/**
 * El cuerpo que sirve la ruta y consume el distintivo. Sólo escalares: esto cruza un cable.
 * @param {number} [nowMs]
 * @returns {{ nowMs: number, peak: boolean, weekend: boolean, offPeakStartMs: number | null, peakStartMs: number | null }}
 */
export function peakStatus(nowMs = Date.now()) {
  const bounds = windowBounds(nowMs);
  return {
    nowMs,
    peak: inPeakWindow(nowMs),
    weekend: treatAsWeekend(new Date(nowMs).getUTCDay()),
    offPeakStartMs: bounds.offPeakStartMs,
    peakStartMs: bounds.peakStartMs,
  };
}

/**
 * Monta la ruta en el servidor web del perfil.
 *
 * Se llama **dentro** del `ctx.inject(['webServer'])` del plugin, y eso es deliberado: el
 * host puede volver a montar ese servicio (recarga en caliente, recomposición del
 * perfil), y registrar la ruta una sola vez en `apply` la dejaría en la instancia vieja
 * y el servidor vivo contestaría 404 sin decir nada. Es el segundo fallo del plugin
 * original, y se ve exactamente igual que si no se hubiera montado nada.
 *
 * @param {{ webServer?: any, log?: (m: string) => void }} deps
 * @returns {Array<() => void>} desregistradores, o vacío si el perfil no sirve web.
 */
export function registerPeakRoute({ webServer, log }) {
  if (!webServer || typeof webServer.register !== "function") return [];
  return [
    webServer.register({
      kind: "exact",
      path: PEAK_ROUTE,
      handler: (req, res) => {
        // La petición la hace el propio GUI, del mismo origen, así que no lleva
        // `Origin`; una página cualquiera sí lo lleva y no tiene por qué preguntar la
        // hora de esta máquina. Lo que se sirve no es ningún secreto, pero la guarda
        // cuesta una línea y cierra la puerta.
        if (req.headers?.origin) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "esta ruta no se sirve a un navegador" }));
          return;
        }
        try {
          const body = JSON.stringify(peakStatus());
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(body),
            "cache-control": "no-store",
          });
          res.end(body);
        } catch (error) {
          log?.(`peak-window: ${error instanceof Error ? error.message : String(error)}`);
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "no se pudo calcular el estado de precios" }));
        }
      },
    }),
  ];
}
