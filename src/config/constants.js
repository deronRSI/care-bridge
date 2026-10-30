// In dev, point at the Vite dev server's own origin so requests go through
// its proxy (same-origin, avoiding CORS) instead of hitting the remote
// backend directly.
const BACKEND_ORIGIN = "https://fhirassist.rsystems.com:8081";
export const FHIR_BASE = import.meta.env.DEV ? window.location.origin : BACKEND_ORIGIN;
export const LOGIN_URL = `${FHIR_BASE}/auth/login`;

// p360-local-ai's agent-service — see that repo's docs/frontend-integration.md.
// Same service/models P360 frontend already uses.
export const AGENT_SERVICE_URL = import.meta.env.VITE_AGENT_SERVICE_URL || '';
