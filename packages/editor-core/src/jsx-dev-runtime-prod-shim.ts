/**
 * `react/jsx-dev-runtime` for a PRODUCTION React. A module the session serves
 * as source — a project's adapter, a package's layout — is compiled with the
 * development JSX transform and calls `jsxDEV`, but the editor's React is the
 * product build's production copy, which stubs `jsxDEV` to `undefined`. The
 * shared dev-runtime chunk is built from this module instead
 * (`vite-plugin-shared-react.ts`), so those calls land on the production
 * `jsx`/`jsxs` of the same React.
 */
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

export { Fragment };

export function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
  key: Parameters<typeof jsx>[2],
  isStaticChildren?: boolean,
): ReturnType<typeof jsx> {
  return isStaticChildren ? jsxs(type, props, key) : jsx(type, props, key);
}
