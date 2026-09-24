/** The tab reads `UI`, the peer of `Scene` and `3D` in the center strip. The
 *  document ID keeps its longer historical spelling because persisted layouts
 *  address panels by id (and deriving either from the root only made the panel
 *  identity churn on a rename, stranding the old panel in every layout).
 *
 *  Its own module because the registration reads it for the host's absence
 *  prose while the DOCUMENT reads it for the tab, and the two halves are
 *  deliberately in different closures. */
export const UI_COMPONENTS_TITLE = 'UI';
