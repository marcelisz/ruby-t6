(() => {
  const ready = (callback) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  };

  const bootstrapApi = () => window.bootstrap;

  function buildToast(message, variant = "success") {
    const stack = document.getElementById("toastStack");
    const bootstrap = bootstrapApi();
    if (!stack || !bootstrap) return;

    const icon = variant === "danger" ? "exclamation-diamond" : "check2-circle";
    const toast = document.createElement("div");
    toast.className = `toast flash-toast flash-toast--${variant === "danger" ? "danger" : "success"}`;
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", "assertive");
    toast.setAttribute("aria-atomic", "true");
    toast.dataset.bsDelay = "4600";

    const body = document.createElement("div");
    body.className = "toast-body";

    const iconWrap = document.createElement("span");
    iconWrap.className = "flash-toast__icon";
    const iconElement = document.createElement("i");
    iconElement.className = `bi bi-${icon}`;
    iconWrap.appendChild(iconElement);

    const text = document.createElement("span");
    text.className = "flash-toast__message";
    text.textContent = message;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close ms-auto";
    close.dataset.bsDismiss = "toast";
    close.setAttribute("aria-label", "Dismiss notification");

    body.append(iconWrap, text, close);
    toast.appendChild(body);
    stack.appendChild(toast);

    const instance = new bootstrap.Toast(toast, { delay: 4600 });
    toast.addEventListener("hidden.bs.toast", () => toast.remove());
    instance.show();
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        
      }
    }

    try {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      input.style.pointerEvents = "none";
      document.body.appendChild(input);
      input.select();
      input.setSelectionRange(0, input.value.length);
      const succeeded = document.execCommand("copy");
      input.remove();
      return succeeded;
    } catch (error) {
      return false;
    }
  }

  function initTooltips() {
    const bootstrap = bootstrapApi();
    if (!bootstrap) return;

    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => {
      bootstrap.Tooltip.getOrCreateInstance(element, {
        trigger: "hover",
        delay: { show: 350, hide: 100 }
      });
    });
  }

  function initFlashToasts() {
    const bootstrap = bootstrapApi();
    if (!bootstrap) return;

    document.querySelectorAll(".flash-toast").forEach((toast) => {
      const delay = Number.parseInt(toast.dataset.bsDelay || "5200", 10);
      const instance = new bootstrap.Toast(toast, { delay });
      toast.addEventListener("hidden.bs.toast", () => toast.remove());
      instance.show();
    });
  }

  function initBoardsDashboard() {
    const grid = document.querySelector("[data-board-grid]");
    const search = document.querySelector("[data-board-search]");
    const sort = document.querySelector("[data-board-sort]");
    const emptyState = document.querySelector("[data-search-empty]");
    const count = document.querySelector("[data-board-count]");
    const boardSection = document.getElementById("boardsSection");

    if (!grid || !boardSection) return;

    let cards = Array.from(grid.querySelectorAll("[data-board-card]"));

    const updateSearchState = () => {
      const query = (search?.value || "").trim().toLowerCase();
      let visibleCount = 0;

      cards.forEach((card) => {
        const haystack = (card.dataset.search || card.dataset.name || "").toLowerCase();
        const matches = !query || haystack.includes(query);
        card.hidden = !matches;
        if (matches) visibleCount += 1;
      });

      const nothingFound = query.length > 0 && visibleCount === 0;
      if (emptyState) emptyState.hidden = !nothingFound;
      grid.hidden = nothingFound;
      if (count) count.textContent = visibleCount;
    };

    const sortCards = (mode) => {
      const sorted = [...cards].sort((a, b) => {
        if (mode === "name") return (a.dataset.name || "").localeCompare(b.dataset.name || "");
        if (mode === "created") return Number(b.dataset.createdAt) - Number(a.dataset.createdAt);
        return Number(b.dataset.updatedAt) - Number(a.dataset.updatedAt);
      });

      sorted.forEach((card) => grid.appendChild(card));
      cards = sorted;
      updateSearchState();
    };

    if (search) {
      search.addEventListener("input", updateSearchState);
      search.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          search.value = "";
          updateSearchState();
          search.blur();
        }
      });
    }

    if (sort) {
      sort.addEventListener("change", () => sortCards(sort.value));
      sortCards(sort.value);
    }

    if (window.hotkeys) {
      window.hotkeys("/", (event) => {
        if (!search) return;
        event.preventDefault();
        search.focus();
        search.select();
      });
    }
  }

  function initCopyActions() {
    document.addEventListener("click", async (event) => {
      const copyButton = event.target.closest("[data-copy-url], [data-copy-share], [data-copy-target]");
      if (!copyButton) return;

      event.preventDefault();

      let text = copyButton.dataset.copyUrl || "";
      if (!text && copyButton.dataset.copyTarget) {
        text = document.querySelector(copyButton.dataset.copyTarget)?.value || "";
      }
      if (!text && copyButton.hasAttribute("data-copy-share")) {
        text = document.querySelector("[data-share-url]")?.value || window.location.href;
      }
      if (!text) return;

      const copied = await copyToClipboard(text);
      if (!copied) {
        buildToast("Copying didn't work in this browser. Select the link and copy it manually.", "danger");
        return;
      }

      if (copyButton.hasAttribute("data-copy-share")) {
        const label = copyButton.querySelector("span");
        if (label) {
          const original = label.textContent;
          label.textContent = "Copied!";
          setTimeout(() => { label.textContent = original; }, 1800);
        }
        buildToast("Board link copied. Send it to anyone who should join.");
      } else {
        buildToast("Board link copied to your clipboard.");
      }
    });
  }

  function initDeleteActions() {
    const modalElement = document.getElementById("deleteBoardModal");
    if (!modalElement) return;

    const bootstrap = bootstrapApi();
    if (!bootstrap) return;

    const form = modalElement.querySelector("[data-delete-board-form]");
    const name = modalElement.querySelector("[data-delete-board-name]");

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-delete-board]");
      if (!trigger) return;

      event.preventDefault();
      const boardName = trigger.dataset.boardName || "This board";
      if (form) form.action = trigger.dataset.deleteUrl || "";
      if (name) name.textContent = boardName;

      bootstrap.Modal.getOrCreateInstance(modalElement).show();
    });
  }

  function initModalFocus() {
    const bootstrap = bootstrapApi();
    if (!bootstrap) return;

    const newBoardModal = document.getElementById("newBoardModal");
    if (newBoardModal) {
      newBoardModal.addEventListener("shown.bs.modal", () => {
        newBoardModal.querySelector('input[name="name"]')?.focus();
      });
    }

    const identityModal = document.getElementById("identityModal");
    if (identityModal) {
      identityModal.addEventListener("shown.bs.modal", () => {
        const input = identityModal.querySelector("#profile_nickname");
        input?.focus();
        input?.select();
      });
    }
  }

  ready(() => {
    initTooltips();
    initFlashToasts();
    initBoardsDashboard();
    initCopyActions();
    initDeleteActions();
    initModalFocus();
  });

  window.TandemUI = {
    ...(window.TandemUI || {}),
    toast: buildToast,
    copyToClipboard
  };
})();
