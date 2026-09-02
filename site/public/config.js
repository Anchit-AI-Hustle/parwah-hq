/* The two IDs the marketing site needs before it can measure anything, and
   the one place to put them.

   Leave them empty and the site loads NO third-party script, sets no cookie
   and makes no request anywhere — analytics.js checks this first and returns.
   That is the state it ships in.

   Fill them in and the launch funnel becomes measurable: page views, and
   `join_waitlist` every time somebody joins the list by form or by WhatsApp.
   Without that number there is no blended CAC and no ROAS, which are the
   gates the plan actually turns on.

   This is the public site only. Nothing in /app/ loads this file: family data
   is not measured, ever. */
window.PARWAH_ANALYTICS = {
  ga4: '',        // e.g. 'G-XXXXXXXXXX'  — Google Analytics 4 measurement ID
  metaPixel: ''   // e.g. '1234567890'    — Meta Pixel ID
};
