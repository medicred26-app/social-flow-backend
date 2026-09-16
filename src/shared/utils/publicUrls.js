const PROD_FRONTEND = 'https://socialflow-web.onrender.com';
const PROD_API = 'https://socialflow-api.onrender.com';

function stripSlash(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function isLocalHost(url) {
  return !url || /localhost|127\.0\.0\.1/i.test(url);
}

export function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function getAppUrl() {
  const renderUrl = stripSlash(process.env.RENDER_EXTERNAL_URL);
  const configured = stripSlash(process.env.APP_URL || process.env.BACKEND_URL);
  if (isProduction() && renderUrl && !isLocalHost(renderUrl)) {
    return renderUrl;
  }
  if (isProduction() && isLocalHost(configured)) {
    return PROD_API;
  }
  return configured || renderUrl || 'http://localhost:5000';
}

export function getFrontendUrl(req) {
  const fromQuery = stripSlash(req?.query?.frontend);
  if (fromQuery && /^https?:\/\//i.test(fromQuery) && (!isProduction() || !isLocalHost(fromQuery))) {
    return fromQuery;
  }

  const configured = stripSlash(process.env.FRONTEND_URL);
  if (isProduction() && isLocalHost(configured)) {
    return PROD_FRONTEND;
  }
  return configured || 'http://localhost:4000';
}

export function resolveRedirectUri(configured, path) {
  const appUrl = getAppUrl();
  const value = stripSlash(configured);
  if (!value || (isProduction() && (isLocalHost(value) || (hostOf(value) && hostOf(value) !== hostOf(appUrl))))) {
    return `${appUrl}${path}`;
  }
  return value;
}

export function encodeOAuthState(req, extra = {}) {
  const payload = {
    frontend: getFrontendUrl(req),
    ...extra,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeOAuthState(state) {
  if (!state || typeof state !== 'string') return {};
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function frontendAccountsUrl(req, params) {
  const state = decodeOAuthState(req?.query?.state);
  const frontend = stripSlash(state.frontend) || getFrontendUrl(req);
  const url = new URL('/accounts', `${frontend}/`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}
