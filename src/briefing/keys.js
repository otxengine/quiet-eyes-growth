/* sessionStorage keys shared by the sign-up page (App.jsx) and the report-only sign-up flow.
   Kept in their own file so App.jsx does not pull the flow's chunk into the main bundle. */
export const BRIEFING_SIGNUP_KEY = 'briefing_signup';        // '1' while a visitor is signing up for the report-only product
export const BUSINESS_QUERY_KEY = 'briefing_business_query'; // what they typed in the landing page search box

const FREE_TOKEN_KEY = 'briefing_free_token';

/**
 * The emailed-link token of the account-less Free plan (/en/start?t=…), or null. It is a login, so
 * the first read moves it from the address bar into this tab's sessionStorage, keeping it out of
 * the browser history and of any link the visitor copies.
 */
export function freeToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('t');
  if (fromUrl) {
    sessionStorage.setItem(FREE_TOKEN_KEY, fromUrl);
    params.delete('t');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }
  return sessionStorage.getItem(FREE_TOKEN_KEY);
}
export const forgetFreeToken = () => sessionStorage.removeItem(FREE_TOKEN_KEY);

/** True if this visitor came from the English landing page; remembers it across Clerk's sign-up steps. */
export function rememberBriefingSignup(search = window.location.search) {
  const params = new URLSearchParams(search);
  if (params.get('briefing') === '1') {
    sessionStorage.setItem(BRIEFING_SIGNUP_KEY, '1');
    const business = (params.get('business') || '').trim().slice(0, 120);
    if (business) sessionStorage.setItem(BUSINESS_QUERY_KEY, business);
  }
  return sessionStorage.getItem(BRIEFING_SIGNUP_KEY) === '1';
}
