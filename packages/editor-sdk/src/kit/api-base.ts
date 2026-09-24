/**
 * What every `api/<family>.ts` module shares: the route prefix every
 * `/__editor/*` op is written against.
 *
 * The session serves the editor and answers these routes (ARCHITECTURE-CORE
 * §The target shape rule 5), so a family module asks no question before
 * touching the network.
 */

export const BASE = '/__editor';
