
/* SENTINEL — live GitHub dashboard and read-only code review */
(() => {
  "use strict";

  const API_BASE =
    "https://3kbsd10ue2.execute-api.ap-south-1.amazonaws.com";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let reviewData = [];
  let selectedReview = 0;
  let usingLivePullRequests = false;
  let toastTimer;
  let lastFocusedElement = null;

  function safeText(selector, value, root = document) {
    const element = $(selector, root);
    if (element) element.textContent = String(value ?? "");
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function showToast(message, icon = "✓") {
    const toast = $("#toast");
    if (!toast) return;

    safeText("#toastMessage", message);
    safeText(".toast-icon", icon);
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  $("#toastClose")?.addEventListener("click", () => {
    clearTimeout(toastTimer);
    $("#toast")?.classList.remove("show");
  });

  function updateClock() {
    safeText(
      "#clock",
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(new Date())
    );
  }

  updateClock();
  setInterval(updateClock, 1000);

  function animateCount(element, target, duration = 900) {
    if (reducedMotion.matches) {
      element.textContent = Number(target).toLocaleString("en-IN");
      return;
    }

    const start = performance.now();

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);

      element.textContent = Math.round(
        Number(target) * eased
      ).toLocaleString("en-IN");

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  if ("IntersectionObserver" in window) {
    const countObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        animateCount(entry.target, Number(entry.target.dataset.count || 0));
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.3 });

    $$("[data-count]").forEach(element => countObserver.observe(element));

    const sections = [
      "overview", "pull-requests", "findings", "timeline", "quality"
    ].map(id => document.getElementById(id)).filter(Boolean);

    const navObserver = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      $$(".nav-link").forEach(link => {
        link.classList.toggle(
          "active",
          link.getAttribute("href") === `#${visible.target.id}`
        );
      });
    }, { rootMargin: "-15% 0px -62% 0px", threshold: [0, 0.1, 0.35] });

    sections.forEach(section => navObserver.observe(section));
  }

  function updateLiveCounters(count) {
    const sectionCount = $("#pull-requests .section-count");
    if (sectionCount) {
      sectionCount.textContent = String(count).padStart(2, "0");
    }

    const heading = $("#queueList .queue-panel-heading span:first-child b");
    if (heading) heading.textContent = String(count).padStart(2, "0");

    const footer = $("#queueList .queue-panel-footer");
    if (footer) {
      footer.innerHTML =
        `<span><i></i> LIVE GITHUB QUEUE</span><span>${count} OPEN</span>`;
    }
  }

  function renderEmptyQueue() {
    const queue = $("#queueList");

    queue?.querySelectorAll(".queue-item").forEach(item => item.remove());

    const footer = queue?.querySelector(".queue-panel-footer");
    if (footer) {
      footer.innerHTML =
        "<span><i></i> LIVE GITHUB QUEUE</span><span>0 OPEN</span>";
    }

    safeText("#detailRepo", "No open pull requests");
    safeText("#detailPR", "QUEUE EMPTY");
    safeText("#detailDescription", "No open pull requests were returned.");
    safeText("#detailFiles", "—");
    safeText("#detailAdded", "—");
    safeText("#detailRemoved", "—");
    safeText("#detailTime", "—");
    safeText("#evidenceEmpty h3", "No open pull requests.");
    safeText("#evidenceEmpty p", "No review was run.");
    updateLiveCounters(0);
  }

  function renderLiveQueue() {
    const queue = $("#queueList");
    if (!queue) return;

    queue.querySelectorAll(".queue-item").forEach(item => item.remove());

    const footer = queue.querySelector(".queue-panel-footer");

    reviewData.forEach((review, index) => {
      const button = document.createElement("button");
      button.className = `queue-item${index === selectedReview ? " selected" : ""}`;
      button.dataset.review = String(index);
      button.setAttribute("aria-pressed", String(index === selectedReview));

      const status = review.draft
        ? "DRAFT"
        : review.liveResult
          ? "REVIEWED"
          : "NOT REVIEWED";

      button.innerHTML = `
        <span class="repo-symbol symbol-github">⌘</span>
        <span class="queue-copy">
          <span class="queue-title">${escapeHTML(review.repo)}
            <small>#${review.pr}</small>
          </span>
          <span class="queue-description">${escapeHTML(review.owner)} ·
            ${escapeHTML(review.description)}
          </span>
          <span class="queue-badges">
            <i class="badge badge-review">${status}</i>
            <i class="badge badge-files">LIVE</i>
          </span>
        </span>
        <span class="queue-count warn-count">
          <b>${review.liveResult ? review.signals : "—"}</b>
          <small>findings</small>
        </span>
        <span class="queue-indicator">↗</span>
      `;

      button.addEventListener("click", () => renderReview(index));
      queue.insertBefore(button, footer || null);
    });
  }

  async function loadLivePullRequests() {
    try {
      const response = await fetch(`${API_BASE}/pull-requests`, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (!Array.isArray(data.pull_requests)) {
        throw new Error("Unexpected pull-request response");
      }

      reviewData = data.pull_requests.map(pr => ({
        repo: (data.repository || "mdibrahim-ux/ai-code-review-agent")
          .split("/").pop(),
        owner: pr.author || "unknown",
        pr: Number(pr.number),
        description: pr.title || "Untitled pull request",
        url: pr.url || "#",
        updatedAt: pr.updated_at || "",
        draft: Boolean(pr.draft),
        files: "—",
        added: "—",
        removed: "—",
        time: "—",
        signals: 0,
        status: pr.draft ? "DRAFT" : "NOT REVIEWED",
        kind: "warn",
        decision: "Review has not been run",
        decisionCopy:
          "Live pull-request metadata is loaded. Run a review to analyze code changes.",
        liveResult: null,
        isReviewing: false,
        fileTypes: []
      }));

      usingLivePullRequests = true;
      selectedReview = 0;

      renderLiveQueue();
      updateLiveCounters(reviewData.length);

      if (reviewData.length) {
        renderReview(0);
      } else {
        renderEmptyQueue();
      }

      showToast(`Loaded ${reviewData.length} live pull request(s).`);
    } catch (error) {
      console.error("Could not load live pull requests:", error);
      showToast("Could not load live pull requests. Check your API.", "!");
    }
  }

  function fileRowsMarkup(files) {
    const typeClass = type =>
      type === "PY" ? "type-py" :
      type === "MD" ? "type-md" :
      type === "TS" ? "type-ts" :
      type === "CSS" ? "type-css" :
      type === "YML" ? "type-yml" : "type-json";

    return files.map((file, index) => `
      <div class="footprint-row">
        <span class="filetype ${typeClass(file[0])}">
          ${escapeHTML(file[0])}
        </span>
        <span class="footprint-name">${escapeHTML(file[1])}</span>
        <div class="footprint-track">
          <i style="width:${Math.max(0, Math.min(100, Number(file[2]) || 0))}%"></i>
        </div>
        <span class="footprint-count">${escapeHTML(file[3])}</span>
      </div>
    `).join("");
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
    if (card) {
      card.classList.remove("detail-refresh");
      void card.offsetWidth;
      card.classList.add("detail-refresh");
    }

    safeText("#detailRepo", review.repo);
    safeText("#detailPR", `PULL REQUEST #${review.pr}`);
    safeText("#detailDescription", review.description);
    safeText("#detailFiles", review.files);
    safeText("#detailAdded", review.added);
    safeText("#detailRemoved", review.removed);

    const timeNode = $("#detailTime");
    if (timeNode) {
      timeNode.textContent = review.time;
    }

    const status = $("#detailStatus");
    if (status) {
      status.className = `status-label ${review.kind}`;
      status.innerHTML = `<i></i> ${escapeHTML(review.status)}`;
    }

    const footprint = $(".footprint");
    if (footprint) footprint.innerHTML = fileRowsMarkup(review.fileTypes);

    const empty = $("#evidenceEmpty");
    const chain = $("#evidenceChain");

    // Sample evidence is never presented as a real live finding.
    chain?.classList.add("hidden");
    empty?.classList.remove("hidden");

    if (review.liveResult) {
      const findings = Array.isArray(review.liveResult.findings)
        ? review.liveResult.findings
        : [];

      safeText(
        "#evidenceEmpty h3",
        findings.length
          ? `${findings.length} finding(s) detected`
          : "No findings detected."
      );

      const summary = findings.length
        ? findings.map((finding, i) =>
            `${i + 1}. ${finding.rule || finding.type || "Rule match"} — ` +
            `${finding.message || finding.description || "Manual verification recommended."}`
          ).join("\n")
        : "The live analysis completed. No issues matched the configured rules.";

      safeText("#evidenceEmpty p", summary);
    } else {
      safeText("#evidenceEmpty h3", "Review has not been run.");
      safeText(
        "#evidenceEmpty p",
        "Live pull-request metadata is loaded. Run a review to analyze code changes."
      );
    }

    if (reviewButton) {
      reviewButton.disabled = Boolean(review.isReviewing);
    }

    renderLiveQueue();
  }

  function addTimelineEvent(
    title = "Review completed",
    description = "",
    kind = "mint"
  ) {
    const timeline = $("#timelineEvents");
    if (!timeline) return;

    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date());

    const icons = { yellow: "✳", blue: "↗", mint: "✓", red: "!" };
    const event = document.createElement("div");
    event.className = "timeline-event";

    const icon = document.createElement("span");
    icon.className = `event-icon event-${kind}`;
    icon.textContent = icons[kind] || "✳";

    const copy = document.createElement("div");
    copy.className = "event-copy";

    const heading = document.createElement("b");
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.textContent = description;

    copy.append(heading, paragraph);

    const timestamp = document.createElement("time");
    timestamp.textContent = time;

    event.append(icon, copy, timestamp);
    timeline.prepend(event);

    $$(".timeline-event", timeline).slice(6).forEach(old => old.remove());
  }

  // REAL READ-ONLY REVIEW API
  const reviewButton = $("#simulateReview");
  const reviewButtonDefault = reviewButton?.innerHTML || "Run Review";

  reviewButton?.addEventListener("click", async () => {
    const review = reviewData[selectedReview];

    if (!review || !Number.isInteger(review.pr) || review.pr < 1) {
      showToast("Select a valid pull request first.", "!");
      return;
    }

    if (review.isReviewing) return;

    review.isReviewing = true;
    reviewButton.disabled = true;
    reviewButton.classList.add("is-running");
    reviewButton.innerHTML =
      '<span class="button-icon">↻</span><span>Analyzing code...</span>';

    const startedAt = performance.now();

    try {
      const response = await fetch(`${API_BASE}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          pull_request_number: review.pr
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || result.error || `Request failed: HTTP ${response.status}`
        );
      }

      if (result.status !== "reviewed") {
        throw new Error(result.message || "The API did not complete the review.");
      }

      review.liveResult = result;
      review.files = String(result.files_scanned ?? 0).padStart(2, "0");
      review.signals = Number(result.finding_count ?? 0);
      review.time = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
      review.status = review.signals > 0 ? "REVIEW REQUIRED" : "ANALYZED";
      review.kind = review.signals > 0 ? "risk" : "clean";
      review.decision = review.signals > 0
        ? "Findings require manual verification"
        : "No findings detected by configured rules";

      review.decisionCopy =
        `${result.files_scanned} files scanned. ` +
        `${review.signals} finding(s) detected. ` +
        "Read-only analysis; no GitHub comments were published.";

      renderReview(selectedReview);

      addTimelineEvent(
        "Live code review completed",
        `PR #${review.pr} · ${result.files_scanned} files scanned · ` +
        `${review.signals} finding(s) · comments not published`,
        review.signals > 0 ? "red" : "mint"
      );

      showToast(
        `Review complete: ${review.signals} finding(s) in ${result.files_scanned} files.`
      );
    } catch (error) {
      console.error("Live review failed:", error);
      showToast(`Review failed: ${error.message}`, "!");
      addTimelineEvent("Live code review failed", error.message, "red");
    } finally {
      review.isReviewing = false;
      reviewButton.disabled = false;
      reviewButton.classList.remove("is-running");
      reviewButton.innerHTML = reviewButtonDefault;
      renderLiveQueue();
    }
  });

  // Timeline demo button explicitly remains local-only.
  $("#addTimelineEvent")?.addEventListener("click", () => {
    addTimelineEvent(
      "Demo event added",
      "Local dashboard event; no AWS request was made.",
      "yellow"
    );
    showToast("Sample event added. No AWS request was made.");
  });

  $("#jumpTimeline")?.addEventListener("click", () =>
    $("#timeline")?.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "center"
    })
  );

  $("#viewAllReviews")?.addEventListener("click", () =>
    showToast(
      usingLivePullRequests
        ? `Showing ${reviewData.length} live pull request(s).`
        : "Live pull requests are not loaded."
    )
  );

  // Evidence-example controls are disabled as a source of real findings.
  $("#showEvidenceExample")?.addEventListener("click", () =>
    showToast("Sample evidence is not a live finding.", "!")
  );

  $("#hideEvidenceExample")?.addEventListener("click", () => {
    $("#evidenceChain")?.classList.add("hidden");
    $("#evidenceEmpty")?.classList.remove("hidden");
  });

  // Review details modal
  const dossierBackdrop = $("#dossierBackdrop");
  const dossierModal = $("#dossierModal");

  function updateDossier(index) {
    const review = reviewData[index];
    if (!review) return;

    safeText("#dossierPR", `PR #${review.pr}`);
    safeText("#dossierTitle", review.description);
    safeText("#dossierIntro",
      `Repository ${review.repo}, pull request #${review.pr}.`);

    safeText("#dossierStatusTag", review.status);
    safeText("#modalFiles", review.files);
    safeText("#modalAdded", review.added);
    safeText("#modalRemoved", review.removed);
    safeText("#modalTime", review.time);
    safeText("#dossierDecision",
      review.liveResult ? review.decision : "Review has not been run");
    safeText("#dossierDecisionCopy",
      review.liveResult
        ? review.decisionCopy
        : "Run a live review to obtain findings from the AWS API.");

    safeText("#decisionStampNote",
      review.liveResult
        ? `${review.signals} finding(s) · read-only review`
        : "No live scan performed");

    const list = $("#modalFileList");
    if (list) list.replaceChildren();
  }

  function openDossier() {
    if (!dossierBackdrop) return;

    lastFocusedElement = document.activeElement;
    updateDossier(selectedReview);
    dossierBackdrop.classList.remove("hidden", "is-closing");
    dossierBackdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    requestAnimationFrame(() => {
      dossierBackdrop.classList.add("is-open");
      $("#closeDossier")?.focus({ preventScroll: true });
    });
  }

  function closeDossier() {
    if (!dossierBackdrop || dossierBackdrop.classList.contains("hidden")) return;

    dossierBackdrop.classList.remove("is-open");
    dossierBackdrop.classList.add("is-closing");
    dossierBackdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    setTimeout(() => {
      dossierBackdrop.classList.add("hidden");
      dossierBackdrop.classList.remove("is-closing");
      lastFocusedElement?.focus?.({ preventScroll: true });
    }, reducedMotion.matches ? 1 : 360);
  }

  $("#inspectReview")?.addEventListener("click", openDossier);
  $("#openModelDetails")?.addEventListener("click", openDossier);
  $("#detailMenu")?.addEventListener("click", openDossier);
  $("#closeDossier")?.addEventListener("click", closeDossier);
  $("#doneDossier")?.addEventListener("click", closeDossier);

  dossierBackdrop?.addEventListener("click", event => {
    if (event.target === dossierBackdrop) closeDossier();
  });

  // Command palette
  const paletteBackdrop = $("#paletteBackdrop");
  const paletteInput = $("#paletteInput");

  function openPalette() {
    if (!paletteBackdrop) return;

    paletteBackdrop.classList.remove("hidden");
    paletteBackdrop.setAttribute("aria-hidden", "false");
    if (paletteInput) paletteInput.value = "";

    $$(".palette-option").forEach(option => option.classList.remove("hidden"));

    requestAnimationFrame(() => {
      paletteBackdrop.classList.add("is-open");
      paletteInput?.focus({ preventScroll: true });
    });
  }

  function closePalette() {
    if (!paletteBackdrop || paletteBackdrop.classList.contains("hidden")) return;

    paletteBackdrop.classList.remove("is-open");
    paletteBackdrop.setAttribute("aria-hidden", "true");

    setTimeout(
      () => paletteBackdrop.classList.add("hidden"),
      reducedMotion.matches ? 1 : 240
    );
  }

  $("#commandOpen")?.addEventListener("click", openPalette);
  $("#paletteClose")?.addEventListener("click", closePalette);

  paletteBackdrop?.addEventListener("click", event => {
    if (event.target === paletteBackdrop) closePalette();
  });

  paletteInput?.addEventListener("input", () => {
    const query = paletteInput.value.trim().toLowerCase();

    $$(".palette-option").forEach(option => {
      option.classList.toggle(
        "hidden",
        !option.textContent.toLowerCase().includes(query)
      );
    });
  });

  const paletteActions = {
    review: () => reviewButton?.click(),
    queue: () => $("#pull-requests")?.scrollIntoView({ behavior: "smooth" }),
    timeline: () => $("#timeline")?.scrollIntoView({ behavior: "smooth" }),
    evidence: () => showToast("Only live API findings are shown."),
    details: openDossier
  };

  $$(".palette-option").forEach(option => {
    option.addEventListener("click", () => {
      closePalette();
      paletteActions[option.dataset.action]?.();
    });
  });

  document.addEventListener("keydown", event => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName
    );

    if ((event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
      return;
    }

    if (event.key === "Escape") {
      if (paletteBackdrop && !paletteBackdrop.classList.contains("hidden")) {
        closePalette();
      } else {
        closeDossier();
      }
      return;
    }

    if (!isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const actions = {
        r: () => reviewButton?.click(),
        q: () => $("#pull-requests")?.scrollIntoView({ behavior: "smooth" }),
        t: () => $("#timeline")?.scrollIntoView({ behavior: "smooth" }),
        d: openDossier
      };

      actions[event.key.toLowerCase()]?.();
    }

    if (event.key === "Tab" &&
        dossierModal &&
        dossierBackdrop &&
        !dossierBackdrop.classList.contains("hidden")) {
      const focusable = $$(
        "button, a[href], input, [tabindex]:not([tabindex='-1'])",
        dossierModal
      ).filter(element => !element.disabled && element.offsetParent !== null);

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  $("#workspaceSwitch")?.addEventListener("click", () =>
    showToast("Personal / Lab workspace.")
  );

  $("#profileSwitch")?.addEventListener("click", () =>
    showToast("Sentinel dashboard.")
  );

  // Decorative illustration
  const illustration = $(".hero-illustration");

  if (illustration &&
      !reducedMotion.matches &&
      window.matchMedia("(pointer: fine)").matches) {
    illustration.addEventListener("pointermove", event => {
      const bounds = illustration.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;

      illustration.style.setProperty("--tilt-x", `${-y * 1.8}deg`);
      illustration.style.setProperty("--tilt-y", `${x * 1.8}deg`);
    });

    illustration.addEventListener("pointerleave", () => {
      illustration.style.setProperty("--tilt-x", "0deg");
      illustration.style.setProperty("--tilt-y", "0deg");
    });
  }

  // Load real GitHub pull requests on startup.
  loadLivePullRequests();
})();
