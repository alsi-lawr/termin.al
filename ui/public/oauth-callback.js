"use strict";

history.replaceState(null, "", location.pathname);

const { authOk, publicOrigin } = document.body.dataset;

if (window.opener && (authOk === "true" || authOk === "false") && publicOrigin) {
  window.opener.postMessage(
    { type: "termin.al.auth.complete", ok: authOk === "true" },
    publicOrigin,
  );
  window.close();
}
