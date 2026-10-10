/* SENTINEL — interaction layer
   All review records below are local sample data. No AWS/GitHub API is called. */
(() => {
  "use strict";

  const reviewData = [
    {
      repo: "ai-code-review-agent", owner: "mdibrahim-ux", pr: 1,
      description: "Update review rules and filtering", files: "05", added: "+142", removed: "−38", time: "4.3s",
      signals: 0, status: "CLEAN", kind: "clean", sub: "mdibrahim-ux · Update review rules",
      decision: "No active findings", decisionCopy: "The sample review returned zero signals under the configured rules. That describes this demo record; it is not a guarantee that a repository has no defects.",
      fileTypes: [["PY", "Python", 74, "03"], ["MD", "Markdown", 32, "01"], ["{ }", "Config", 20, "01"]]
    },
    {
      repo: "valyrian-craft", owner: "mdibrahim-ux", pr: 24,
      description: "Cart state handling", files: "08", added: "+286", removed: "−74", time: "7.8s",
      signals: 3, status: "HIGH RISK", kind: "risk", sub: "mdibrahim-ux · Cart state handling",
      decision: "Manual review recommended", decisionCopy: "This illustrative record contains three sample signals. Inspect the changed paths and supporting context before deciding whether the changes are safe to merge.",
      fileTypes: [["TS", "TypeScript", 82, "05"], ["CSS", "Styles", 42, "02"], ["JSON", "Config", 18, "01"]]
    },
    {
      repo: "student-portal", owner: "demo-org", pr: 18,
      description: "Input validation", files: "03", added: "+91", removed: "−21", time: "3.1s",
      signals: 1, status: "REVIEW", kind: "warn", sub: "demo-org · Input validation",
      decision: "One signal needs context", decisionCopy: "One illustrative rule match has been associated with this sample pull request. A rule match is a prompt to investigate, not proof of a vulnerability.",
      fileTypes: [["TS", "TypeScript", 75, "02"], ["MD", "Markdown", 28, "01"]]
    },
    {
      repo: "api-service", owner: "demo-org", pr: 42,
      description: "Refactor request handler", files: "04", added: "+118", removed: "−65", time: "3.9s",
      signals: 0, status: "CLEAN", kind: "clean", sub: "demo-org · Refactor request handler",
      decision: "No active findings", decisionCopy: "The example record has no signals in its sample result. This local preview has not inspected the actual repository or performed a fresh scan.",
      fileTypes: [["PY", "Python", 70, "02"], ["YML", "Config", 34, "01"], ["MD", "Markdown", 24, "01"]]
    }
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let toastTimer = 0;
  let runCount = 0;
  let selectedReview = 0;
  let lastFocusedElement = null;
  let backdropTransitionTimer = 0;
  let paletteTransitionTimer = 0;

  function safeText(selector, value, root = document) {
    const node = $(selector, root);
    if (node) node.textContent = value;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function showToast(message, icon = "✓") {
    const toast = $("#toast");
    safeText("#toastMessage", message);
    safeText(".toast-icon", icon);
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3600);
  }

  $("#toastClose").addEventListener("click", () => {
    window.clearTimeout(toastTimer);
    $("#toast").classList.remove("show");
  });

  // A live clock is a useful instrument, not a source of backend state.
  function updateClock() {
    const now = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date());
    safeText("#clock", now);
  }
  updateClock();
  window.setInterval(updateClock, 1000);

  // Numerals arrive in a short, eased count-up instead of jumping into place.
  function animateCount(element, target, duration = 1050) {
    if (prefersReducedMotion.matches) {
      element.textContent = target.toLocaleString("en-IN");
      return;
    }
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      element.textContent = Math.round(target * eased).toLocaleString("en-IN");
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  const countObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const element = entry.target;
      animateCount(element, Number(element.dataset.count));
      observer.unobserve(element);
    });
  }, { threshold: 0.3 });
  $$('[data-count]').forEach(element => countObserver.observe(element));

  // Keep the side navigation in sync with the section currently being viewed.
  const navSections = ["overview", "pull-requests", "findings", "timeline", "quality"]
    .map(id => document.getElementById(id)).filter(Boolean);
  if ("IntersectionObserver" in window) {
    const navObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      $$('.nav-link').forEach(link => {
        const target = link.getAttribute("href");
        link.classList.toggle("active", target === `#${visible.target.id}` ||
          (visible.target.id === "overview" && target === "#overview"));
      });
    }, { rootMargin: "-15% 0px -62% 0px", threshold: [0, 0.1, 0.35] });
    navSections.forEach(section => navObserver.observe(section));
  }

  function fileRowsMarkup(files) {
    const typeClass = type => type === "PY" ? "type-py" : type === "MD" ? "type-md" : type === "TS" ? "type-ts" : type === "CSS" ? "type-css" : type === "YML" ? "type-yml" : "type-json";
    const fillClass = index => index === 1 ? "violet-fill" : index === 2 ? "mint-fill" : "";
    return files.map((file, index) => `
      <div class="footprint-row">
        <span class="filetype ${typeClass(file[0])}">${escapeHTML(file[0])}</span>
        <span class="footprint-name">${escapeHTML(file[1])}</span>
        <div class="footprint-track"><i class="${fillClass(index)}" style="width:${Math.max(0, Math.min(100, Number(file[2])))}%"></i></div>
        <span class="footprint-count">${escapeHTML(file[3])}</span>
      </div>`).join("");
  }

  function renderReview(index) {
    const review = reviewData[index];
    if (!review) return;
    selectedReview = index;
    $$(".queue-item").forEach((item, itemIndex) => {
      item.classList.toggle("selected", itemIndex === index);
      item.setAttribute("aria-pressed", String(itemIndex === index));
    });

    const card = $("#reviewDetail");
    card.classList.remove("detail-refresh");
    // Restart the content entrance for a crisp, quick transition between records.
    void card.offsetWidth;
    card.classList.add("detail-refresh");
    safeText("#detailRepo", review.repo);
    safeText("#detailPR", `PULL REQUEST #${review.pr}`);
    safeText("#detailDescription", review.description);
    safeText("#detailFiles", review.files);
    safeText("#detailAdded", review.added);
    safeText("#detailRemoved", review.removed);
    $("#detailTime").innerHTML = `${escapeHTML(review.time.replace(/s$/, ""))}<span>s</span>`;

    const status = $("#detailStatus");
    status.className = `status-label ${review.kind}`;
    status.innerHTML = `<i></i> ${escapeHTML(review.status)}`;
    $(".footprint").innerHTML = fileRowsMarkup(review.fileTypes);

    const empty = $("#evidenceEmpty");
    const chain = $("#evidenceChain");
    empty.classList.toggle("hidden", review.signals > 0);
    chain.classList.toggle("hidden", review.signals === 0);
    if (review.signals === 0) {
      safeText("#evidenceEmpty h3", "No active findings.");
      safeText("#evidenceEmpty p", "This review has no findings under the current rule set. Select a review with signals to explore an example evidence chain.");
    } else {
      safeText("#evidenceEmpty h3", `${review.signals} signal${review.signals === 1 ? "" : "s"} require attention.`);
      safeText("#evidenceEmpty p", "This sample review contains illustrative findings. Open the evidence example to inspect how a finding could be traced.");
    }
  }

  $$(".queue-item").forEach(item => {
    item.setAttribute("aria-pressed", String(item.classList.contains("selected")));
    item.addEventListener("click", () => renderReview(Number(item.dataset.review)));
  });

  // Modal content is populated from the selected local record each time it opens.
  function updateDossier(index) {
    const review = reviewData[index];
    if (!review) return;
    safeText("#dossierPR", `PR #${review.pr}`);
    const title = $("#dossierTitle");
    const titleFirst = review.kind === "risk" ? "Signals worth" : review.kind === "warn" ? "One signal." : "A closer look";
    const titleSecond = review.kind === "risk" ? "a closer look." : review.kind === "warn" ? "More context." : "at the evidence.";
    title.innerHTML = `${escapeHTML(titleFirst)}<br><em>${escapeHTML(titleSecond)}</em>`;
    safeText("#dossierIntro", `A structured view of ${review.repo}, pull request #${review.pr}, its review status, and the evidence available to support that status.`);
    safeText("#dossierStatusTag", `${review.status} REVIEW`);
    safeText("#modalFiles", review.files);
    safeText("#modalAdded", review.added);
    safeText("#modalRemoved", review.removed);
    safeText("#modalTime", review.time);
    safeText("#dossierDecision", review.decision);
    safeText("#dossierDecisionCopy", review.decisionCopy);
    safeText("#decisionStampNote", `${review.signals} sample finding${review.signals === 1 ? "" : "s"} · no live scan performed`);
    const stamp = $("#decisionStamp");
    stamp.style.background = review.kind === "risk" ? "#ffd1cb" : review.kind === "warn" ? "#ffec9b" : "var(--mint)";

    const fileMarkup = review.fileTypes.map(file => {
      const style = file[0] === "PY" ? "type-py" : file[0] === "MD" ? "type-md" : file[0] === "TS" ? "type-ts" : file[0] === "CSS" ? "type-css" : file[0] === "YML" ? "type-yml" : "type-json";
      return `<div><span class="modal-file-type ${style}">${escapeHTML(file[0])}</span><span>${escapeHTML(file[1])}</span><b>${escapeHTML(file[3])}</b></div>`;
    }).join("");
    $("#modalFileList").innerHTML = fileMarkup;
  }

  const dossierBackdrop = $("#dossierBackdrop");
  const dossierModal = $("#dossierModal");
  const closeDossierButton = $("#closeDossier");
  function openDossier() {
    window.clearTimeout(backdropTransitionTimer);
    lastFocusedElement = document.activeElement;
    updateDossier(selectedReview);
    dossierBackdrop.classList.remove("hidden", "is-closing");
    dossierBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      dossierBackdrop.classList.add("is-open");
      closeDossierButton.focus({ preventScroll: true });
    });
  }
  function closeDossier() {
    if (dossierBackdrop.classList.contains("hidden")) return;
    dossierBackdrop.classList.remove("is-open");
    dossierBackdrop.classList.add("is-closing");
    dossierBackdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    window.clearTimeout(backdropTransitionTimer);
    backdropTransitionTimer = window.setTimeout(() => {
      dossierBackdrop.classList.add("hidden");
      dossierBackdrop.classList.remove("is-closing");
      if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
        lastFocusedElement.focus({ preventScroll: true });
      }
    }, prefersReducedMotion.matches ? 1 : 360);
  }
  $("#inspectReview").addEventListener("click", openDossier);
  $("#openModelDetails").addEventListener("click", openDossier);
  $("#closeDossier").addEventListener("click", closeDossier);
  $("#doneDossier").addEventListener("click", closeDossier);
  dossierBackdrop.addEventListener("click", event => {
    if (event.target === dossierBackdrop) closeDossier();
  });

  // Sample events are intentionally labeled demo-only: they don't call the webhook.
  function addTimelineEvent(title = "Demo review queued", description = "A simulated event was added to the timeline.", kind = "yellow") {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date());
    const icons = { yellow: "✳", blue: "↗", mint: "✓", red: "!" };
    const event = document.createElement("div");
    event.className = "timeline-event";
    event.innerHTML = `<span class="event-icon event-${kind}">${icons[kind] || "✳"}</span><div class="event-copy"><b>${escapeHTML(title)}</b><p>${escapeHTML(description)}</p></div><time>${time}</time>`;
    const timeline = $("#timelineEvents");
    timeline.prepend(event);
    $$(".timeline-event", timeline).slice(6).forEach(oldEvent => oldEvent.remove());
    if (!prefersReducedMotion.matches && typeof event.animate === "function") {
      event.animate([
        { opacity: 0, transform: "translateY(-10px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], { duration: 420, easing: "cubic-bezier(.16, 1, .3, 1)" });
    }
  }

  $("#addTimelineEvent").addEventListener("click", () => {
    addTimelineEvent("Demo review queued", "Simulated webhook · background job accepted", "yellow");
    showToast("Sample event added. No AWS request was made.");
  });

  const reviewButton = $("#simulateReview");
  const reviewButtonDefault = reviewButton.innerHTML;
  reviewButton.addEventListener("click", () => {
    runCount += 1;
    const outcome = runCount % 3 === 0 ? "risk" : "clean";
    if (outcome === "risk") {
      addTimelineEvent("Illustrative signal surfaced", "Sample rule match · manual verification recommended", "red");
      showToast("Demo review complete: an illustrative signal was added.", "!");
    } else {
      addTimelineEvent("Review completed", `Demo run ${String(runCount).padStart(2, "0")} · 0 sample findings · 0 failures`, "mint");
      showToast("Demo review complete: no sample findings.");
    }
    reviewButton.classList.add("is-running");
    reviewButton.innerHTML = '<span class="button-icon">✓</span><span>Demo complete</span><span class="button-arrow">↗</span>';
    window.setTimeout(() => {
      reviewButton.classList.remove("is-running");
      reviewButton.innerHTML = reviewButtonDefault;
    }, 1500);
  });

  $("#jumpTimeline").addEventListener("click", () => $("#timeline").scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth", block: "center" }));
  $("#detailMenu").addEventListener("click", openDossier);
  $("#viewAllReviews").addEventListener("click", () => showToast("All four local sample pull requests are shown in the queue."));
  $("#showEvidenceExample").addEventListener("click", () => {
    $("#evidenceEmpty").classList.add("hidden");
    $("#evidenceChain").classList.remove("hidden");
    showToast("Illustrative evidence chain opened. No live finding was created.");
  });
  $("#hideEvidenceExample").addEventListener("click", () => {
    $("#evidenceChain").classList.add("hidden");
    $("#evidenceEmpty").classList.remove("hidden");
  });

  // Command menu, including keyboard shortcuts and basic option filtering.
  const paletteBackdrop = $("#paletteBackdrop");
  const paletteInput = $("#paletteInput");
  function openPalette() {
    window.clearTimeout(paletteTransitionTimer);
    paletteBackdrop.classList.remove("hidden");
    paletteBackdrop.setAttribute("aria-hidden", "false");
    paletteInput.value = "";
    $$(".palette-option").forEach(option => option.classList.remove("hidden"));
    requestAnimationFrame(() => {
      paletteBackdrop.classList.add("is-open");
      paletteInput.focus({ preventScroll: true });
    });
  }
  function closePalette() {
    if (paletteBackdrop.classList.contains("hidden")) return;
    paletteBackdrop.classList.remove("is-open");
    paletteBackdrop.setAttribute("aria-hidden", "true");
    window.clearTimeout(paletteTransitionTimer);
    paletteTransitionTimer = window.setTimeout(() => paletteBackdrop.classList.add("hidden"), prefersReducedMotion.matches ? 1 : 240);
  }
  $("#commandOpen").addEventListener("click", openPalette);
  $("#paletteClose").addEventListener("click", closePalette);
  paletteBackdrop.addEventListener("click", event => {
    if (event.target === paletteBackdrop) closePalette();
  });
  paletteInput.addEventListener("input", () => {
    const query = paletteInput.value.trim().toLowerCase();
    $$(".palette-option").forEach(option => option.classList.toggle("hidden", !option.textContent.toLowerCase().includes(query)));
  });
  const paletteActions = {
    review: () => reviewButton.click(),
    queue: () => $("#pull-requests").scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth" }),
    timeline: () => $("#timeline").scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth" }),
    evidence: () => $("#showEvidenceExample").click(),
    details: openDossier
  };
  $$(".palette-option").forEach(option => option.addEventListener("click", () => {
    closePalette();
    const action = paletteActions[option.dataset.action];
    if (action) action();
  }));

  // Keyboard behavior: Ctrl/Cmd+K opens search; Escape closes the topmost panel.
  document.addEventListener("keydown", event => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (!dossierBackdrop.classList.contains("hidden")) closeDossier();
      openPalette();
      return;
    }
    if (event.key === "Escape") {
      if (!paletteBackdrop.classList.contains("hidden")) closePalette();
      else if (!dossierBackdrop.classList.contains("hidden")) closeDossier();
      return;
    }
    if (!isTyping && !event.ctrlKey && !event.metaKey && !event.altKey && paletteBackdrop.classList.contains("hidden") && dossierBackdrop.classList.contains("hidden")) {
      const actions = { r: () => reviewButton.click(), q: () => $("#pull-requests").scrollIntoView({ behavior: "smooth" }), t: () => $("#timeline").scrollIntoView({ behavior: "smooth" }), e: () => $("#showEvidenceExample").click(), d: openDossier };
      const action = actions[event.key.toLowerCase()];
      if (action) action();
    }

    // Keep keyboard focus inside the open dossier while it behaves as a modal.
    if (event.key === "Tab" && !dossierBackdrop.classList.contains("hidden")) {
      const focusable = $$("button, a[href], input, [tabindex]:not([tabindex='-1'])", dossierModal)
        .filter(element => !element.disabled && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });

  // Small local-only affordances instead of controls that look live but do nothing.
  $("#workspaceSwitch").addEventListener("click", () => showToast("Personal / Lab is the active sample workspace."));
  $("#profileSwitch").addEventListener("click", () => showToast("Builder workspace · local dashboard preview."));

  // Respect reduced-motion preferences, otherwise use a restrained pointer tilt on the illustration.
  const illustration = $(".hero-illustration");
  if (!prefersReducedMotion.matches && window.matchMedia("(pointer: fine)").matches) {
    let pointerFrame = 0;
    illustration.addEventListener("pointermove", event => {
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        const bounds = illustration.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - .5;
        const y = (event.clientY - bounds.top) / bounds.height - .5;
        illustration.style.setProperty("--tilt-x", `${(-y * 1.8).toFixed(2)}deg`);
        illustration.style.setProperty("--tilt-y", `${(x * 1.8).toFixed(2)}deg`);
      });
    });
    illustration.addEventListener("pointerleave", () => {
      illustration.style.setProperty("--tilt-x", "0deg");
      illustration.style.setProperty("--tilt-y", "0deg");
    });
  }

  // Friendly initial defaults for assistive technologies and queue state.
  renderReview(0);
})();
