// Pruebas de `dsh-peak-window`.
//
//   node --test test/peak.mjs
//
// Dos partes, y las dos importan:
//
//   1. **Las cuentas**: el contrato del horario publicado. Ventanas de pico de 01:00 a
//      04:00 y de 06:00 a 10:00 UTC, sólo de lunes a viernes, con los bordes abiertos por
//      la derecha (a las 04:00 en punto ya no es pico). Si esto se equivoca, la cuenta
//      atrás miente —que es peor que no enseñar nada—.
//   2. **La ruta**, sobre un servidor `node:http` como el del harness: que contesta el
//      JSON del contrato, que no pide credenciales (quien pregunta es el propio GUI) y
//      que rechaza a un navegador de otro origen.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  PEAK_ROUTE,
  inPeakWindow,
  peakStatus,
  registerPeakRoute,
  treatAsWeekend,
  windowBounds,
} from "../src/peak.js";

const MIN = 60000;

/** Un instante UTC concreto. */
const utc = (year, month, day, hour, minute = 0) => Date.UTC(year, month - 1, day, hour, minute);

/**
 * El primer día de octubre de 2026 que cumple `match`, a la hora pedida. Se busca así
 * para no depender de que quien lea la prueba sepa en qué día cayó un miércoles.
 * @param {(day: number) => boolean} match
 * @param {number} hour
 * @returns {number} epoch ms
 */
function primerDia(match, hour) {
  for (let day = 1; day <= 31; day++) {
    const t = utc(2026, 10, day, hour);
    if (match(new Date(t).getUTCDay())) return t;
  }
  throw new Error("no encontré el día buscado");
}

test("las ventanas de pico son las publicadas, con los bordes abiertos por la derecha", () => {
  const dia = new Date(primerDia((d) => d === 3, 0)).getUTCDate(); // un miércoles
  const aLas = (h, m = 0) => utc(2026, 10, dia, h, m);

  assert.equal(inPeakWindow(aLas(0, 30)), false, "00:30 UTC no es pico");
  assert.equal(inPeakWindow(aLas(1, 0)), true, "01:00 UTC empieza el pico");
  assert.equal(inPeakWindow(aLas(3, 59)), true, "03:59 sigue siendo pico");
  assert.equal(inPeakWindow(aLas(4, 0)), false, "04:00 ya no: el borde es abierto");
  assert.equal(inPeakWindow(aLas(5, 0)), false, "05:00 es valle");
  assert.equal(inPeakWindow(aLas(6, 0)), true, "06:00 empieza el segundo pico");
  assert.equal(inPeakWindow(aLas(9, 59)), true, "09:59 sigue");
  assert.equal(inPeakWindow(aLas(10, 0)), false, "10:00 ya no");
  assert.equal(inPeakWindow(aLas(23, 0)), false, "23:00 es valle");
});

test("en fin de semana no hay pico, ni siquiera a la hora del pico", () => {
  const sabado = primerDia((d) => d === 6, 2);
  const domingo = primerDia((d) => d === 0, 2);
  assert.equal(treatAsWeekend(6), true);
  assert.equal(treatAsWeekend(0), true);
  assert.equal(inPeakWindow(sabado), false, "sábado 02:00 UTC: valle");
  assert.equal(inPeakWindow(domingo), false, "domingo 02:00 UTC: valle");
  assert.equal(peakStatus(sabado).weekend, true);
});

test("las franjas apuntan al lado correcto: en valle ya empezó, en pico está por llegar", () => {
  const dia = new Date(primerDia((d) => d === 3, 0)).getUTCDate();

  const valle = utc(2026, 10, dia, 5, 0);
  const enValle = windowBounds(valle);
  assert.ok(enValle.offPeakStartMs !== null && enValle.offPeakStartMs <= valle, "el valle ya empezó");
  assert.equal(enValle.peakStartMs, utc(2026, 10, dia, 6, 0), "el pico empieza a las 06:00 UTC");

  const enPico = windowBounds(utc(2026, 10, dia, 2, 0));
  assert.equal(enPico.offPeakStartMs, utc(2026, 10, dia, 4, 0), "el valle llega a las 04:00");
});

test("peakStatus trae exactamente los cinco campos del contrato", () => {
  const s = peakStatus(primerDia((d) => d === 3, 2));
  assert.deepEqual(Object.keys(s).sort(), [
    "nowMs",
    "offPeakStartMs",
    "peak",
    "peakStartMs",
    "weekend",
  ]);
  assert.equal(s.peak, true);
  assert.equal(s.weekend, false);
  assert.equal(typeof s.peakStartMs, "number");
});

/** Un `webServer` de mentira, como el del harness: registrar y poder pedir la ruta. */
function fakeWebServer() {
  const rutas = new Map();
  return {
    rutas,
    register({ path, handler }) {
      rutas.set(path, handler);
      return () => rutas.delete(path);
    },
  };
}

/** Monta un servidor de verdad que despacha a las rutas registradas. */
async function montar(web) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const handler = web.rutas.get(path);
    if (!handler) {
      res.writeHead(404);
      res.end();
      return;
    }
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("la ruta contesta el JSON sin credenciales, y rechaza a un navegador de otro origen", async () => {
  const web = fakeWebServer();
  const montadas = registerPeakRoute({ webServer: web });
  assert.equal(montadas.length, 1, "una ruta, una");
  assert.ok(web.rutas.has(PEAK_ROUTE), `se monta en ${PEAK_ROUTE}`);

  const { server, base } = await montar(web);
  try {
    const ok = await fetch(`${base}${PEAK_ROUTE}`);
    assert.equal(ok.status, 200, "contesta sin credenciales: quien pregunta es el GUI");
    const cuerpo = await ok.json();
    assert.equal(typeof cuerpo.nowMs, "number");
    assert.equal(typeof cuerpo.peak, "boolean");
    assert.equal(typeof cuerpo.weekend, "boolean");
    assert.ok("offPeakStartMs" in cuerpo && "peakStartMs" in cuerpo, "los campos del contrato");

    const cruzada = await fetch(`${base}${PEAK_ROUTE}`, { headers: { origin: "https://otra.example" } });
    assert.equal(cruzada.status, 403, "una página cualquiera no pregunta la hora de esta máquina");

    const otra = await fetch(`${base}/dsh-peak-window/api/nada`);
    assert.equal(otra.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("sin servidor web no se monta nada, y no revienta", () => {
  assert.deepEqual(registerPeakRoute({ webServer: null }), []);
  assert.deepEqual(registerPeakRoute({ webServer: {} }), []);
});

test("el instante que se sirve es el del host, no uno inventado", () => {
  const antes = Date.now();
  const s = peakStatus();
  const despues = Date.now();
  assert.ok(s.nowMs >= antes && s.nowMs <= despues, "nowMs es el reloj del host, ahora mismo");
  assert.equal(s.peak, inPeakWindow(s.nowMs));
  assert.ok(Math.abs(s.nowMs - antes) < MIN, "y sin desfases raros");
});
