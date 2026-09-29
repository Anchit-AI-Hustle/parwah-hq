// Swaps the Neon driver for neon-shim.mjs. Loaded only by the database tests.
export async function resolve(specifier, context, next) {
  if (specifier === '@neondatabase/serverless') {
    return { url: new URL('./neon-shim.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
