/**
 * IPAW v3 Google Apps Script Web App entry point.
 *
 * Keep application logic in ipawv3.html. This file only serves the static
 * frontend so the browser can communicate with the Netlify backend over HTTPS.
 */
function doGet(e) {
  return HtmlService
    .createHtmlOutputFromFile('ipawv3')
    .setTitle('IPAW');
}