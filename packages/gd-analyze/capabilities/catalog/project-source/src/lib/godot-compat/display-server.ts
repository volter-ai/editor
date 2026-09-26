/**
 * @godot-class DisplayServer
 * @role BINDING
 *
 * Godot 4.7's web `DisplayServer` members this lane uses, bound onto the page's browser window
 * (`platform/web/display_server_web.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). A
 * singleton: no receiver. It never reimplements the server.
 */

/**
 * The web display server's answer (`display_server_web.cpp:782`): the page's `'ontouchstart' in
 * window` (`platform/web/js/libs/library_godot_display.js:556`), or `Input` emulating touch from
 * the mouse (`input_devices/pointing/emulate_touch_from_mouse`, off by default and not bound).
 *
 * @godot DisplayServer.is_touchscreen_available
 * @source platform/web/display_server_web.cpp:782
 */
export function is_touchscreen_available(): boolean {
  const page = (globalThis as { readonly window?: object }).window;
  return page !== undefined && 'ontouchstart' in page;
}
