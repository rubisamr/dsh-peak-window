// dsh-peak-window — mitad de host.
//
// Sirve **una** ruta con el estado de precio de DeepSeek (pico / valle / fin de semana y
// los dos bordes). La mitad de cliente pinta el distintivo con la cuenta atrás.
//
// Dos cosas de este fichero no son estilo, son lecciones, y las dos vienen del plugin que
// este reemplaza (ver el README):
//
//   * el descriptor va **como objeto** en `default`. El cargador desenvuelve `.default` y
//     espera `{ name, inject, apply }`; si le llega una **fábrica** —una función— no
//     encuentra ni `inject` ni `apply` y la mitad de host no se aplica nunca: la ruta no
//     existe, contesta 404 y no hay ningún error en ningún sitio.
//   * el registro va **dentro de `ctx.inject(['webServer'])`**, no en `apply` a secas. Así
//     se rehace sobre la instancia viva del servicio cada vez que el host lo vuelve a
//     montar; registrado una sola vez, la ruta se queda en la instancia vieja y el
//     servidor vivo contesta 404 — el mismo síntoma, por otra causa.

import { PEAK_ROUTE, registerPeakRoute } from "./src/peak.js";

export const name = "dsh-peak-window";

/**
 * El servicio web del perfil, si lo sirve.
 *
 * Declararlo aquí es lo que hace que el registro viva dentro de un `ctx.inject`: cuando
 * el servicio se vuelve a crear, el callback corre otra vez y la ruta queda en la
 * instancia **nueva**.
 */
export const inject = ["webServer"];

/**
 * Al log del harness, sin poder tumbar el host por escribir una línea.
 * @param {any} ctx
 * @param {string} message
 */
function note(ctx, message) {
  try {
    const logger = ctx.logger;
    if (typeof logger?.info === "function") logger.info(`${name}: ${message}`);
    else if (typeof logger?.debug === "function") logger.debug(`${name}: ${message}`);
  } catch {
    // Un log nunca puede tumbar al host.
  }
}

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export function apply(ctx) {
  ctx.inject(["webServer"], (webCtx) => {
    // El servicio se pide con `get`: en el `ctx` de cordis no es una propiedad.
    const webServer = webCtx.get("webServer");
    const routes = registerPeakRoute({
      webServer,
      log: (message) => note(webCtx, message),
    });
    if (routes.length > 0) {
      note(webCtx, `estado de precios servido en ${PEAK_ROUTE}`);
    } else {
      note(webCtx, "este perfil no sirve web: no hay ruta de precios");
    }
  });
}

// El descriptor va en `default`, y **como objeto**: ver la cabecera.
export default { name, inject, apply };
