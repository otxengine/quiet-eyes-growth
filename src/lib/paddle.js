/**
 * paddle.js — loads Paddle.js once and opens the overlay checkout.
 *
 * Env: VITE_PADDLE_CLIENT_TOKEN (live_… / test_…), VITE_PADDLE_ENV ('sandbox' | 'production').
 * The checkout itself is a Paddle-hosted iframe, so card data never touches our app.
 */

const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';

let loadPromise = null;
// Paddle.Initialize accepts one eventCallback for the page's lifetime, so the
// checkout currently open registers its listener here.
let activeListener = null;

function loadPaddle() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
    if (!token) {
      reject(new Error('מערכת התשלומים אינה מוגדרת'));
      return;
    }
    const script = document.createElement('script');
    script.src = PADDLE_JS_URL;
    script.async = true;
    script.onload = () => {
      const Paddle = window.Paddle;
      if (import.meta.env.VITE_PADDLE_ENV === 'sandbox') Paddle.Environment.set('sandbox');
      Paddle.Initialize({
        token,
        eventCallback: (event) => activeListener?.(event),
      });
      resolve(Paddle);
    };
    script.onerror = () => {
      loadPromise = null; // allow a retry after a network blip
      reject(new Error('טעינת מערכת התשלומים נכשלה — בדוק את החיבור ונסה שוב'));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Opens the overlay for a server-created transaction.
 * Resolves 'completed' once payment succeeds, or 'closed' if the user closes it.
 * Plan activation itself arrives via webhook a few seconds after 'completed'.
 */
export async function openPaddleCheckout(transactionId) {
  const Paddle = await loadPaddle();
  return new Promise((resolve) => {
    activeListener = (event) => {
      if (event.name === 'checkout.completed') {
        activeListener = null;
        // Let Paddle's success screen show briefly before handing back to the app.
        setTimeout(() => Paddle.Checkout.close(), 1500);
        resolve('completed');
      } else if (event.name === 'checkout.closed') {
        activeListener = null;
        resolve('closed');
      }
    };
    Paddle.Checkout.open({
      transactionId,
      settings: { displayMode: 'overlay', theme: 'light' },
    });
  });
}
