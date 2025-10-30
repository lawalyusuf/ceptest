/**
 * CeptaPay UI SDK (Inline Pop-up Checkout) - MODIFIED FOR SECURE AJAX
 * This script handles modal UI only. All API calls (Initiate, Status Check)
 * are proxied securely through the WordPress backend.
 */
(function (window) {
  "use strict";

  // --- 1. CONFIGURATION & STATE ---
  let paymentModalState = {
    transactionRef: null,
    onClose: null,
    onSuccess: null,
    onFailed: null,
    // The client only needs the public key and base URL
    config: {
      publicKey: null,
      baseUrl: null,
      ajaxUrl: null, // NEW: WordPress AJAX endpoint URL
    },
    ui: {
      modalContainer: null,
      iframe: null,
    },
  };

  // --- 2. AJAX CALLER (REPLACING API CALLER) ---

  /**
   * Proxies the API request to the secure WordPress PHP backend.
   * @param {string} action - The WordPress AJAX action (e.g., 'ceptapay_initiate').
   * @param {object} data - The data to send to the server.
   * @returns {Promise<object>}
   */
  async function ajaxCall(action, data) {
    if (!paymentModalState.config.ajaxUrl) {
      throw new Error("SDK Error: WordPress AJAX URL is missing.");
    }

    const formData = new FormData();
    formData.append("action", action);
    formData.append("data", JSON.stringify(data));
    formData.append("public_key", paymentModalState.config.publicKey);

    // Security Note: nonce must be handled on the main page where the script is enqueued.
    // For simplicity here, we assume it's added separately or handled by the parent caller.

    try {
      const response = await fetch(paymentModalState.config.ajaxUrl, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AJAX request failed with status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success === false) {
        throw new Error(
          result.data.message || "Payment initiation failed via AJAX."
        );
      }

      return result.data; // The API response data from the PHP proxy
    } catch (error) {
      console.error("AJAX Fetch Error:", error);
      throw error;
    }
  }

  async function handleInitiatePayment(paymentData) {
    // Calls the PHP AJAX hook to perform the secure HMAC POST request
    return ajaxCall("ceptapay_initiate_payment", { paymentData });
  }

  /**
   * Confirms the payment status of a given transaction reference using the PHP proxy.
   * @param {string} transactionRef
   * @returns {Promise<object>} Status data from the API.
   */
  async function handlePaymentStatus(transactionRef) {
    // Calls the PHP AJAX hook to perform the secure HMAC GET request
    const statusData = await ajaxCall("ceptapay_confirm_status", {
      transactionRef,
    });

    // Check for final statuses and automatically close the modal if terminal
    if (statusData && paymentModalState.transactionRef === transactionRef) {
      const status = statusData.status;
      if (status === "Paid") {
        triggerCallbackAndClose(statusData.transactionRef, "success");
      } else if (status === "Failed") {
        triggerCallbackAndClose(statusData.transactionRef, "failed");
      }
    }

    return statusData;
  }

  // --- 3. MODAL/UI HANDLER (KEEPING EXISTING LOGIC) ---
  // (Functions: removeModal, handleKeydownClose, triggerCallbackAndClose, createModal)
  // *** COPY YOUR EXISTING MODAL/UI HANDLER FUNCTIONS HERE (SECTION 4) ***

  // ... (Your existing functions: removeModal, handleKeydownClose, triggerCallbackAndClose, createModal)

  function removeModal() {
    // ... (existing code for removeModal)
    if (paymentModalState.ui.modalContainer) {
      window.removeEventListener("keydown", handleKeydownClose);
      paymentModalState.ui.modalContainer.remove();
      paymentModalState.ui.modalContainer = null;
      paymentModalState.ui.iframe = null;
    }
  }
  function handleKeydownClose(event) {
    // ... (existing code for handleKeydownClose)
    if (event.key === "Escape" && paymentModalState.transactionRef) {
      triggerCallbackAndClose(paymentModalState.transactionRef, "close");
    }
  }
  function triggerCallbackAndClose(transactionRef, eventType) {
    // ... (existing code for triggerCallbackAndClose)
    // ... (Your existing triggerCallbackAndClose function content)
    removeModal();

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

    paymentModalState.transactionRef = null;
  }
  function createModal(paymentUrl, transactionRef) {
    // ... (existing code for createModal)
    removeModal(); // Ensure no existing modal is present

    // 1. Full-screen backdrop container
    const modalContainer = document.createElement("div");
    modalContainer.id = "ceptaPay_myModal";
    modalContainer.className = "cepta-modal";
    // Full screen, centered, dark backdrop
    modalContainer.style.cssText = `
            display: flex; position: fixed; z-index: 9999; left: 0; top: 0; 
            width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.6);
            backdrop-filter: blur(4px); justify-content: center; align-items: center;
        `;

    // Allow closing by clicking the backdrop
    modalContainer.addEventListener("click", (event) => {
      if (event.target === modalContainer) {
        triggerCallbackAndClose(transactionRef, "close");
      }
    });
    // Allow closing with Escape key
    window.addEventListener("keydown", handleKeydownClose);

    // 2. Modal content wrapper (the visible box)
    const modalContentWrapper = document.createElement("div");
    modalContentWrapper.className = "cepta-modal-content-wrapper";
    // Set explicit, manageable dimensions for the container
    modalContentWrapper.style.cssText = `
            position: relative; 
            width: 95%; max-width: 480px; 
            height: 680px; /* FIXED HEIGHT TO ENSURE IFRAME RENDERS */
            background-color: #fff; 
            border-radius: 12px; 
            box-shadow: 0 10px 25px rgba(0,0,0,0.4);
            overflow: hidden; /* Important for clean edges */
        `;

    // 3. Close Button
    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = "&times;";
    closeBtn.className = "cepta-close-btn";
    // Position the button absolutely over the content wrapper
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

    // 4. The Iframe
    const iframe = document.createElement("iframe");
    iframe.className = "cepta-pg-iframe";
    iframe.style.cssText =
      "width: 100%; height: 100%; border: none; display: block;";
    iframe.src = paymentUrl;
    iframe.allow = "clipboard-read; clipboard-write";

    // Assemble the modal
    modalContentWrapper.appendChild(iframe);
    modalContentWrapper.appendChild(closeBtn); // Close button is layered on top
    modalContainer.appendChild(modalContentWrapper);
    document.body.appendChild(modalContainer);

    paymentModalState.ui.modalContainer = modalContainer;
    paymentModalState.ui.iframe = iframe;
  }

  // --- 4. MAIN PUBLIC API ---

  /**
   * Initiates the Cepta payment process.
   * @param {{
   * paymentData: object,
   * config: { publicKey: string, baseUrl: string, ajaxUrl: string }, // NOTE: secretKey is removed
   * onSuccess: function(string),
   * onFailed: function(string),
   * onClose: function(string)
   * }} params - Configuration parameters and callbacks.
   */
  async function checkout(params) {
    const { paymentData, config, onSuccess, onFailed, onClose } = params;

    // Basic validation (secretKey is no longer required on the client)
    if (!config || !config.publicKey || !config.baseUrl || !config.ajaxUrl) {
      console.error(
        "CeptaPay: Missing required configuration keys (publicKey, baseUrl, or ajaxUrl)."
      );
      if (onFailed)
        onFailed(paymentData?.transactionReference || "unknown_ref");
      return;
    }

    // Clear any existing state and store new state
    paymentModalState.onSuccess = onSuccess;
    paymentModalState.onFailed = onFailed;
    paymentModalState.onClose = onClose;

    // Store the dynamic config (without secretKey)
    paymentModalState.config = config;

    try {
      console.log("CeptaPay: Initiating payment via secure PHP proxy...");

      // 1. Initiate Payment (Happens securely on the server via AJAX)
      const responseData = await handleInitiatePayment(paymentData);

      const transactionRef = responseData.transactionRef;
      const paymentUrl = responseData.paymentUrl || responseData.url;

      if (!transactionRef || !paymentUrl) {
        throw new Error(
          "API response is missing transaction reference or payment URL."
        );
      }

      paymentModalState.transactionRef = transactionRef;

      // 2. Open Modal
      createModal(paymentUrl, transactionRef);
      console.log(
        `CeptaPay: Modal opened for transactionRef: ${transactionRef}.`
      );
    } catch (error) {
      console.error("CeptaPay: Payment initiation failed:", error.message);
      // If initiation fails, call the failed callback immediately without opening modal
      if (onFailed) onFailed(paymentData.transactionReference || "unknown_ref");
      removeModal();
    }
  }

  // Expose the SDK to the global window object
  window.CeptaPay = {
    checkout: checkout,
    // The manual status check function remains exposed
    confirmStatus: handlePaymentStatus,
  };
})(window);
