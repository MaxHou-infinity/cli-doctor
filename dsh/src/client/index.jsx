/**
 * Browser half of the `dsh-cli-doctor` bundle plugin.
 *
 * Registers the two seats the contract fixes (CONTRACT.md §3.3): a row in the
 * sidebar shell's global panel list (`sidebar.panellist`) and the panel page in
 * the layout's keyed `main` slot. Both go through `ctx.slots.inject`, which
 * fires only once the owning shell entry has declared the seat, so load order
 * between this plugin and the shell does not matter and a shell that cannot
 * serve a seat simply leaves the entry absent instead of failing boot.
 *
 * The Host half owns the read-only `/api/cli-doctor` routes; this module never
 * imports a `@deepseek-ai/*` value and requires only `react` /
 * `react/jsx-runtime` at bundle time.
 *
 * @module dsh-cli-doctor/client
 */
import { CliDoctorIcon } from './icon.jsx';
import { CliDoctorPanel } from './panel.jsx';

/** Sidebar row id, shared with the `main` slot key. */
export const PANEL_ID = 'cli-doctor';
/** Row order among the shell's global panel rows. */
export const PANEL_ORDER = 30;
/** Sidebar row label. */
export const PANEL_LABEL = 'CLI Doctor';

/** Cordis services this client plugin needs. */
export const inject = ['slots'];

/** Diagnostic copy for a host whose client runtime exposes no slot registry. */
const MISSING_SLOTS = 'cli-doctor: client slot service unavailable; panel not registered';

/**
 * Mount the sidebar row and the panel page.
 *
 * Never throws: a failure while registering one seat is logged and the other
 * seat (plus the rest of the Web GUI) keeps working — an external plugin must
 * not take the shell's boot down. Registration happens inside `ctx.effect` when
 * the runtime offers it, and the same disposer is also returned, so either
 * convention releases both seats; disposal is idempotent.
 *
 * @param ctx - client root context (services: slots).
 * @returns disposer releasing both registrations.
 */
export function apply(ctx) {
  const slots = ctx && ctx.slots;
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(MISSING_SLOTS);
    return () => {};
  }

  const disposers = [];
  let disposed = false;

  const disposeAll = () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.splice(0)) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch (error) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn(`cli-doctor: disposal failed: ${error && error.message ? error.message : String(error)}`);
        }
      }
    }
  };

  const register = (seat, options, component) => {
    try {
      const dispose = slots.inject(seat, () => slots.register(options, component));
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`cli-doctor: could not register "${seat}": ${error && error.message ? error.message : String(error)}`);
      }
    }
  };

  register('sidebar.panellist', { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: PANEL_LABEL }, CliDoctorIcon);
  register('main', { name: 'main', key: PANEL_ID }, CliDoctorPanel);

  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => disposeAll, 'cli-doctor: slots');
    } catch {
      /* Older runtimes: the returned disposer below still releases both seats. */
    }
  }

  return disposeAll;
}

export { CliDoctorIcon, CliDoctorPanel };
