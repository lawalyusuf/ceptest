(function (window) {
  "use strict";

  let paymentModalState = {
    transactionRef: null,
    pollInterval: null,
    consecutiveErrorCount: 0,
    MAX_POLLING_ERRORS: 10, //todo
    onClose: null,
    onSuccess: null,
    onFailed: null,
    config: {
      publicKey: null,
      secretKey: null,
      baseUrl: null,
    },
    ui: {
      modalContainer: null,
      iframe: null,
    },
  };

  function textToUint8Array(text) {
    return new TextEncoder().encode(text);
  }

  async function createSignature(method, pathForSignature, data = null) {
    if (!paymentModalState.config.secretKey) {
      throw new Error("SDK Error: Secret key is missing from configuration.");
    }

    const ts = Math.floor(Date.now() / 1000);
    let payloadBody = "";

    if (data && method === "POST") {
      payloadBody = JSON.stringify(data);
    }

    const signatureString = ts + method + pathForSignature + payloadBody;

    const secretKeyBytes = textToUint8Array(paymentModalState.config.secretKey);
    const dataBytes = textToUint8Array(signatureString);

    try {
      const key = await crypto.subtle.importKey(
        "raw",
        secretKeyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign("HMAC", key, dataBytes);

      const signature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return { ts, signature };
    } catch (e) {
      console.error("HMAC signature generation failed:", e);
      throw new Error("Authentication failure during signature creation.");
    }
  }

  async function apiCall(method, fullPath, data = null) {
    if (
      !paymentModalState.config.baseUrl ||
      !paymentModalState.config.publicKey
    ) {
      throw new Error(
        "SDK Error: Base URL or Public Key is missing from configuration."
      );
    }

    let pathForSignature = fullPath.split("?")[0];
    console.log(`[API Call] Signing path: ${pathForSignature}`);

    const { ts, signature } = await createSignature(
      method,
      pathForSignature,
      data
    );
    const url = paymentModalState.config.baseUrl + fullPath;

    const headers = {
      Accept: "application/json",
      "X-Access-Key": paymentModalState.config.publicKey,
      "X-Access-Ts": ts,
      "X-Access-Signature": signature,
      "Content-Type": "application/json",
    };

    const config = {
      method: method,
      headers: headers,
    };

    if (data && method === "POST") {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, config);
      const result = await response.json();

      if (!response.ok) {
        const errorMessage =
          result.message ||
          `API error: ${response.status} ${response.statusText}`;

        console.error("API Response Error Details:", result);

        const error = new Error(errorMessage);
        error.status = response.status;
        throw error;
      }

      return result;
    } catch (error) {
      console.error("Fetch API Error:", error);
      throw error;
    }
  }

  async function handleInitiateApiData(paymentData) {
    const path = "/api/v1/pay";
    const response = await apiCall("POST", path, paymentData);
    return response.data;
  }

  async function handlePaymentStatus(transactionRef) {
    const path = `/api/v1/pay/confirm-status?TransactionRef=${transactionRef}`;
    const response = await apiCall("GET", path, null);

    // If the library was asked to confirm status directly, keep behavior:
    if (response.data && paymentModalState.transactionRef === transactionRef) {
      const status = response.data.status;
      if (status === "Successful") {
        triggerCallbackAndClose(response.data.transactionRef, "success");
      } else if (status === "Failed") {
        triggerCallbackAndClose(response.data.transactionRef, "failed");
      }
    }

    return response.data;
  }

  function removeModal() {
    if (paymentModalState.ui.modalContainer) {
      window.removeEventListener("keydown", handleKeydownClose);
      paymentModalState.ui.modalContainer.remove();
      paymentModalState.ui.modalContainer = null;
      paymentModalState.ui.iframe = null;
    }
  }

  function handleKeydownClose(event) {
    if (event.key === "Escape" && paymentModalState.transactionRef) {
      triggerCallbackAndClose(paymentModalState.transactionRef, "close");
    }
  }

  function triggerCallbackAndClose(transactionRef, eventType) {
    // clear polling
    if (paymentModalState.pollInterval) {
      clearInterval(paymentModalState.pollInterval);
    }
    paymentModalState.pollInterval = null;

    // remove UI
    removeModal();

    // callbacks
    switch (eventType) {
      case "success":
        if (paymentModalState.onSuccess)
          paymentModalState.onSuccess(transactionRef);
        break;
      case "failed":
        if (paymentModalState.onFailed)
          paymentModalState.onFailed(transactionRef);
        break;
      case "close":
        if (paymentModalState.onClose)
          paymentModalState.onClose(transactionRef);
        break;
    }

    // reset transaction
    paymentModalState.transactionRef = null;
  }

  function createModal(paymentUrl, transactionRef) {
    removeModal();
    const modalContainer = document.createElement("div");
    modalContainer.id = "ceptaPay_myModal";
    modalContainer.className = "cepta-modal";
    modalContainer.style.cssText = `
            display: flex; position: fixed; z-index: 9999; left: 0; top: 0;
            width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.6);
            backdrop-filter: blur(4px); justify-content: center; align-items: center;
        `;

    modalContainer.addEventListener("click", (event) => {
      if (event.target === modalContainer) {
        triggerCallbackAndClose(transactionRef, "close");
      }
    });
    window.addEventListener("keydown", handleKeydownClose);

    const modalContentWrapper = document.createElement("div");
    modalContentWrapper.className = "cepta-modal-content-wrapper";
    modalContentWrapper.style.cssText = `
            position: relative;
            width: 95%; max-width: 480px;
            height: 680px; /* FIXED HEIGHT TO ENSURE IFRAME RENDERS */
            background-color: #fff;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.4);
            overflow: hidden; /* Important for clean edges */
        `;

    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = "&times;";
    closeBtn.className = "cepta-close-btn";
    closeBtn.style.cssText = `
            position: absolute; right: 10px; top: 0px;
            color: #4b5563; font-size: 2.2rem; font-weight: bold; cursor: pointer; line-height: 1;
            z-index: 10000; padding: 10px;
            transition: color 0.15s;
        `;
    closeBtn.onmouseover = function () {
      this.style.color = "#1f2937";
    };
    closeBtn.onmouseout = function () {
      this.style.color = "#4b5563";
    };

    closeBtn.addEventListener("click", () => {
      triggerCallbackAndClose(transactionRef, "close");
    });

    const iframe = document.createElement("iframe");
    iframe.className = "cepta-pg-iframe";
    iframe.style.cssText =
      "width: 100%; height: 100%; border: none; display: block;";
    iframe.src = paymentUrl;
    iframe.allow = "clipboard-read; clipboard-write";

    modalContentWrapper.appendChild(iframe);
    modalContentWrapper.appendChild(closeBtn);
    modalContainer.appendChild(modalContentWrapper);
    document.body.appendChild(modalContainer);

    paymentModalState.ui.modalContainer = modalContainer;
    paymentModalState.ui.iframe = iframe;
  }

  async function checkout(params) {
    const { paymentData, config, onSuccess, onFailed, onClose } = params;

    if (!config || !config.publicKey || !config.secretKey || !config.baseUrl) {
      console.error(
        "CeptaPay: Missing required configuration keys (publicKey, secretKey, or baseUrl)."
      );
      const fallbackRef =
        paymentModalState.transactionRef ||
        paymentData?.transactionReference ||
        "unknown_ref";
      if (onFailed) onFailed(fallbackRef);
      return;
    }

    if (paymentModalState.pollInterval) {
      clearInterval(paymentModalState.pollInterval);
    }
    paymentModalState.onSuccess = onSuccess;
    paymentModalState.onFailed = onFailed;
    paymentModalState.onClose = onClose;
    paymentModalState.config = config;

    try {
      console.log("CeptaPay: Initiating payment...");

      const responseData = await handleInitiateApiData(paymentData);

      const transactionRef = responseData.transactionRef;
      const paymentUrl = responseData.paymentUrl || responseData.url;

      if (!transactionRef || !paymentUrl) {
        throw new Error(
          "API response is missing transaction reference or payment URL."
        );
      }

      paymentModalState.transactionRef = transactionRef;

      createModal(paymentUrl, transactionRef);
      console.log(
        `CeptaPay: Modal opened for transactionRef: ${transactionRef}. Automatic status polling enabled.`
      );

      // Polling loop
      paymentModalState.pollInterval = setInterval(async function () {
        try {
          const statusData = (await handlePaymentStatus(transactionRef)) || {};
          const { status, amount, transactionReference } = statusData;

          console.log(`CeptaPay Status Check: ${status}`);

          // Reset error counter on valid response
          paymentModalState.consecutiveErrorCount = 0;

          // Check for success
          const isSuccessful =
            status === "Successful" &&
            amount > 0 &&
            transactionReference !== null;

          // Check for failure (explicit failed OR invalid/missing fields)
          const isFailed =
            status === "Failed" && amount > 0 && transactionReference === null;

          // Use best available ref to report to callbacks
          const callbackRef =
            transactionReference ||
            paymentModalState.transactionRef ||
            transactionRef;

          if (isSuccessful) {
            triggerCallbackAndClose(callbackRef, "success");
            return; // stop further checks
          }

          if (isFailed) {
            triggerCallbackAndClose(callbackRef, "failed");
            return; // stop further checks
          }

          // otherwise continue polling (Pending/Processing/unknown)
        } catch (error) {
          paymentModalState.consecutiveErrorCount++;
          console.error(
            `CeptaPay: Status polling failed (Attempt ${paymentModalState.consecutiveErrorCount}/${paymentModalState.MAX_POLLING_ERRORS}). Error:`,
            error.message
          );

          // Stop polling and report failure if max retries reached
          if (
            paymentModalState.consecutiveErrorCount >=
            paymentModalState.MAX_POLLING_ERRORS
          ) {
            console.error(
              "CeptaPay: Maximum polling errors reached. Stopping check and reporting failure."
            );
            const fallbackRef =
              paymentModalState.transactionRef ||
              paymentData?.transactionReference ||
              "unknown_ref";
            triggerCallbackAndClose(fallbackRef, "failed");
          }
        }
      }, 3000); // Poll every 3 seconds
    } catch (error) {
      console.error("CeptaPay: Payment initiation failed:", error.message);
      const fallbackRef =
        paymentModalState.transactionRef ||
        paymentData?.transactionReference ||
        "unknown_ref";
      if (onFailed) onFailed(fallbackRef);
      removeModal();
    }
  }

  window.CeptaPay = {
    checkout: checkout,
    confirmStatus: handlePaymentStatus,
  };
})(window);
