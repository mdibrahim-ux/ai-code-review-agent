/* ═══════════════════════════════════════════════════════════════════════════
   SENTINEL v2.0 — DETERMINISTIC CODE REVIEW & DIFF INTELLIGENCE
   Preserves live AWS API Gateway integration (GET /pull-requests, POST /review)
   while providing a rich, transparent curated sample dataset fallback,
   interactive code-diff & remediation patch viewer, search/filter/sort,
   evidence chain tracer, and full keyboard accessibility.
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
  "use strict";

  const API_BASE = "https://3kbsd10ue2.execute-api.ap-south-1.amazonaws.com";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ─────────────────────── Curated Sample Pull Requests Dataset ─────────────────────── */
  const SAMPLE_PULL_REQUESTS = [
    {
      repo: "ai-code-review-agent",
      symbol: "⌘",
      symbolClass: "symbol-github",
      owner: "mdibrahim-ux",
      pr: 1,
      branch: "rules/v2-filter → main",
      updatedAt: "Updated 14m ago",
      sortOrder: 4,
      description: "Update deterministic review rules and test file filtering pipeline",
      url: "https://github.com/mdibrahim-ux/ai-code-review-agent/pull/1",
      draft: false,
      files: "05",
      filesCountNum: 5,
      added: "+142",
      removed: "−38",
      time: "4.3s",
      signals: 0,
      status: "CLEAN",
      kind: "clean",
      isSample: true,
      decision: "No active findings under configured rule packs",
      decisionCopy:
        "Illustrative sample record: 5 files were evaluated against the sample rule pack; test fixtures are excluded according to the displayed policy.",
      fileTypes: [
        ["PY", "Python", 74, "03", ""],
        ["MD", "Markdown", 32, "01", "violet-fill"],
        ["{ }", "Config", 20, "01", "mint-fill"]
      ],
      changedFiles: [
        { path: "backend/reviewer/rule_engine.py", type: "PY", added: "+84", removed: "−19", signals: 0 },
        { path: "backend/reviewer/file_filter.py", type: "PY", added: "+36", removed: "−12", signals: 0 },
        { path: "backend/handler.py", type: "PY", added: "+12", removed: "−4", signals: 0 },
        { path: "config/rules.default.json", type: "{ }", added: "+6", removed: "−2", signals: 0 },
        { path: "README.md", type: "MD", added: "+4", removed: "−1", signals: 0 }
      ],
      findings: []
    },
    {
      repo: "valyrian-craft",
      symbol: "V",
      symbolClass: "symbol-purple",
      owner: "mdibrahim-ux",
      pr: 24,
      branch: "feat/cart-sync → main",
      updatedAt: "Updated 32m ago",
      sortOrder: 3,
      description: "Cart state handling, optimistic checkout lock, and discount webhook",
      url: "https://github.com/mdibrahim-ux/valyrian-craft/pull/24",
      draft: false,
      files: "08",
      filesCountNum: 8,
      added: "+318",
      removed: "−94",
      time: "5.8s",
      signals: 3,
      status: "HIGH RISK",
      kind: "risk",
      isSample: true,
      decision: "3 blocking findings require manual verification before merge",
      decisionCopy:
        "Sentinel detected 1 CRITICAL authorization boundary bypass in the checkout override handler and 2 HIGH-severity concurrency / state-mutation risks in cart synchronization.",
      fileTypes: [
        ["TS", "TypeScript", 68, "05", ""],
        ["PY", "Python", 42, "02", "orange-fill"],
        ["{ }", "JSON", 18, "01", "mint-fill"]
      ],
      changedFiles: [
        { path: "backend/checkout/override_handler.py", type: "PY", added: "+64", removed: "−18", signals: 1 },
        { path: "src/cart/cartStore.ts", type: "TS", added: "+118", removed: "−42", signals: 1 },
        { path: "backend/webhooks/discount_sync.py", type: "PY", added: "+52", removed: "−14", signals: 1 },
        { path: "src/cart/types.ts", type: "TS", added: "+34", removed: "−8", signals: 0 },
        { path: "src/components/CartDrawer.tsx", type: "TS", added: "+50", removed: "−12", signals: 0 }
      ],
      findings: [
        {
          id: "F-24-1",
          severity: "CRITICAL",
          rule: "SEC-014 · authorization-boundary-check",
          category: "Security / Access Control",
          title: "Missing role verification on manual price-override endpoint",
          file: "backend/checkout/override_handler.py",
          line: 84,
          issue:
            "The refactored `apply_manual_override()` handler reads `request.user.id` for audit logging but removed the `@require_role('admin', 'support_lead')` guard when migrating from Flask blueprint decorators to the async router.",
          impact:
            "Any authenticated customer session can invoke `POST /api/v2/checkout/override` with an arbitrary `discount_cents` payload and mutate their own order total before payment capture.",
          remediation:
            "Enforce explicit role membership verification on `request.user.roles` prior to mutating `order.subtotal_cents`, and reject unauthorized callers with HTTP 403.",
          trace: {
            step1: "backend/checkout/override_handler.py · lines 79–91",
            step2: "SEC-014 · authorization-boundary-check (CRITICAL)",
            step3: "privileged mutation `order.set_override()` reachable without role guard"
          },
          diffLines: [
            { oldNum: 79, newNum: 79, type: "ctx", code: "async def apply_manual_override(request: Request, order_id: str):" },
            { oldNum: 80, newNum: "",  type: "del", code: "-    if 'admin' not in request.user.roles and 'support' not in request.user.roles:" },
            { oldNum: 81, newNum: "",  type: "del", code: "-        raise ForbiddenError('Insufficient privileges for price override')" },
            { oldNum: 82, newNum: 80, type: "ctx", code: "    payload = await request.json()" },
            { oldNum: 83, newNum: 81, type: "ctx", code: "    order = await OrderRepository.get_for_update(order_id)" },
            { oldNum: "", newNum: 82, type: "add", code: "+    audit_logger.info('Override requested by %s', request.user.id)" },
            { oldNum: "", newNum: 84, type: "add", code: "+    order.apply_discount_cents(int(payload['discount_cents']))", focus: true, annotation: "SENTINEL [SEC-014 CRITICAL]: Privileged state mutation executed without verifying `request.user.roles`." },
            { oldNum: 85, newNum: 85, type: "ctx", code: "    await OrderRepository.save(order)" }
          ],
          fixLines: [
            { oldNum: 79, newNum: 79, type: "ctx", code: "async def apply_manual_override(request: Request, order_id: str):" },
            { oldNum: "", newNum: 80, type: "add", code: "+    if not request.user.has_any_role({'admin', 'support_lead'}):" },
            { oldNum: "", newNum: 81, type: "add", code: "+        raise ForbiddenError('Role admin or support_lead required for override')" },
            { oldNum: 82, newNum: 82, type: "ctx", code: "    payload = await request.json()" },
            { oldNum: 83, newNum: 83, type: "ctx", code: "    order = await OrderRepository.get_for_update(order_id)" },
            { oldNum: 84, newNum: 84, type: "ctx", code: "    order.apply_discount_cents(int(payload['discount_cents']))" },
            { oldNum: 85, newNum: 85, type: "ctx", code: "    await OrderRepository.save(order)" }
          ]
        },
        {
          id: "F-24-2",
          severity: "HIGH",
          rule: "CONC-008 · async-race-mutation",
          category: "Concurrency / State Integrity",
          title: "Unserialized concurrent cart quantity updates overwrite optimistic state",
          file: "src/cart/cartStore.ts",
          line: 112,
          issue:
            "`syncCartItemQty()` snapshots `getState().items` before awaiting the network `PATCH /api/cart/items` call, then writes back the mutated snapshot on resolution without checking if a newer mutation occurred in flight.",
          impact:
            "Rapidly clicking increment/decrement on slow connections causes out-of-order responses to clobber newer cart quantities and desynchronize client totals from server state.",
          remediation:
            "Track a monotonically increasing `mutationSeq` per item or apply functional state updates inside `setState(prev => ...)` guarded by an `AbortController`.",
          trace: {
            step1: "src/cart/cartStore.ts · lines 106–118",
            step2: "CONC-008 · async-race-mutation (HIGH)",
            step3: "stale closure `snapshotItems` written after `await api.patchItem()`"
          },
          diffLines: [
            { oldNum: 106, newNum: 106, type: "ctx", code: "export async function syncCartItemQty(sku: string, qty: number) {" },
            { oldNum: "",  newNum: 107, type: "add", code: "+  const snapshotItems = [...store.getState().items];" },
            { oldNum: 108, newNum: 108, type: "ctx", code: "  const updated = await cartApi.patchQuantity(sku, qty);" },
            { oldNum: "",  newNum: 112, type: "add", code: "+  store.setState({ items: snapshotItems.map(i => i.sku === sku ? updated : i) });", focus: true, annotation: "SENTINEL [CONC-008 HIGH]: Writing pre-await `snapshotItems` overwrites concurrent mutations settled while `patchQuantity` was in flight." },
            { oldNum: 113, newNum: 113, type: "ctx", code: "}" }
          ],
          fixLines: [
            { oldNum: 106, newNum: 106, type: "ctx", code: "export async function syncCartItemQty(sku: string, qty: number, signal?: AbortSignal) {" },
            { oldNum: 107, newNum: 107, type: "ctx", code: "  const updated = await cartApi.patchQuantity(sku, qty, { signal });" },
            { oldNum: "",  newNum: 108, type: "add", code: "+  if (signal?.aborted) return;" },
            { oldNum: "",  newNum: 109, type: "add", code: "+  store.setState(prev => ({ items: prev.items.map(i => i.sku === sku ? updated : i) }));" },
            { oldNum: 110, newNum: 110, type: "ctx", code: "}" }
          ]
        },
        {
          id: "F-24-3",
          severity: "HIGH",
          rule: "SEC-021 · webhook-hmac-timing",
          category: "Security / Cryptography",
          title: "Non-constant-time string comparison on webhook signature header",
          file: "backend/webhooks/discount_sync.py",
          line: 41,
          issue:
            "Webhook signature verification uses standard `==` operator (`computed_sig == provided_sig`) instead of `hmac.compare_digest()`.",
          impact:
            "Exposes the webhook endpoint to byte-by-byte statistical timing side-channel attacks that can forge discount synchronization events.",
          remediation:
            "Replace `computed_sig == provided_sig` with `hmac.compare_digest(computed_sig, provided_sig)`.",
          trace: {
            step1: "backend/webhooks/discount_sync.py · line 41",
            step2: "SEC-021 · webhook-hmac-timing (HIGH)",
            step3: "direct `==` equality on HMAC digest string"
          },
          diffLines: [
            { oldNum: 38, newNum: 38, type: "ctx", code: "def verify_discount_webhook(raw_body: bytes, provided_sig: str) -> bool:" },
            { oldNum: 39, newNum: 39, type: "ctx", code: "    computed_sig = hmac.new(WEBHOOK_SECRET, raw_body, hashlib.sha256).hexdigest()" },
            { oldNum: "", newNum: 41, type: "add", code: "+    return computed_sig == provided_sig", focus: true, annotation: "SENTINEL [SEC-021 HIGH]: Use constant-time `hmac.compare_digest()` when comparing cryptographic MAC digests." }
          ],
          fixLines: [
            { oldNum: 38, newNum: 38, type: "ctx", code: "def verify_discount_webhook(raw_body: bytes, provided_sig: str) -> bool:" },
            { oldNum: 39, newNum: 39, type: "ctx", code: "    computed_sig = hmac.new(WEBHOOK_SECRET, raw_body, hashlib.sha256).hexdigest()" },
            { oldNum: "", newNum: 41, type: "add", code: "+    return hmac.compare_digest(computed_sig, provided_sig or '')" }
          ]
        }
      ]
    },
    {
      repo: "student-portal",
      symbol: "S",
      symbolClass: "symbol-blue",
      owner: "demo-org",
      pr: 18,
      branch: "fix/enrollment-validator → develop",
      updatedAt: "Updated 1h ago",
      sortOrder: 2,
      description: "Input validation for student enrollment query and transcript export",
      url: "https://github.com/ mdibrahim-ux/student-portal/pull/18",
      draft: false,
      files: "03",
      filesCountNum: 3,
      added: "+68",
      removed: "−21",
      time: "3.1s",
      signals: 1,
      status: "REVIEW",
      kind: "warn",
      isSample: true,
      decision: "1 medium-severity validation gap flagged for review",
      decisionCopy:
        "Regex validator sanitizes alphanumeric course codes, but `limit` query parameter is cast directly to `int` without an upper-bound cap.",
      fileTypes: [
        ["PY", "Python", 80, "02", ""],
        ["YML", "Workflow", 25, "01", "violet-fill"]
      ],
      changedFiles: [
        { path: "portal/api/enrollment_views.py", type: "PY", added: "+48", removed: "−15", signals: 1 },
        { path: "portal/validators/schema.py", type: "PY", added: "+16", removed: "−4", signals: 0 },
        { path: ".github/workflows/ci.yml", type: "YML", added: "+4", removed: "−2", signals: 0 }
      ],
      findings: [
        {
          id: "F-18-1",
          severity: "MEDIUM",
          rule: "VAL-019 · unbounded-pagination-limit",
          category: "Reliability / DoS Prevention",
          title: "Unbounded pagination `limit` parameter allows full-table memory fetch",
          file: "portal/api/enrollment_views.py",
          line: 53,
          issue:
            "`page_limit = int(request.args.get('limit', 25))` validates that `limit` is an integer but does not clamp the maximum value before passing it to `Enrollment.query.limit(page_limit)`.",
          impact:
            "A caller passing `?limit=1000000` can trigger an expensive full-table serialization and exhaust worker memory.",
          remediation:
            "Clamp `page_limit` between `1` and `MAX_PAGE_SIZE` (e.g., `min(max(1, int(raw_limit)), 100)`).",
          trace: {
            step1: "portal/api/enrollment_views.py · line 53",
            step2: "VAL-019 · unbounded-pagination-limit (MEDIUM)",
            step3: "unclamped user integer passed to `.limit(page_limit)`"
          },
          diffLines: [
            { oldNum: 51, newNum: 51, type: "ctx", code: "def list_enrollments(request):" },
            { oldNum: "", newNum: 52, type: "add", code: "+    page_limit = int(request.args.get('limit', 25))" },
            { oldNum: "", newNum: 53, type: "add", code: "+    records = Enrollment.query.filter_by(active=True).limit(page_limit).all()", focus: true, annotation: "SENTINEL [VAL-019 MEDIUM]: Clamp `page_limit` to a safe upper bound (e.g. <= 100) before querying." },
            { oldNum: 54, newNum: 54, type: "ctx", code: "    return jsonify([r.to_dict() for r in records])" }
          ],
          fixLines: [
            { oldNum: 51, newNum: 51, type: "ctx", code: "def list_enrollments(request):" },
            { oldNum: "", newNum: 52, type: "add", code: "+    raw_limit = int(request.args.get('limit', 25))" },
            { oldNum: "", newNum: 53, type: "add", code: "+    page_limit = min(max(1, raw_limit), 100)" },
            { oldNum: 54, newNum: 54, type: "ctx", code: "    records = Enrollment.query.filter_by(active=True).limit(page_limit).all()" }
          ]
        }
      ]
    },
    {
      repo: "api-service",
      symbol: "A",
      symbolClass: "symbol-green",
      owner: "demo-org",
      pr: 42,
      branch: "refactor/handler-pool → main",
      updatedAt: "Updated 3h ago",
      sortOrder: 1,
      description: "Refactor request handler connection pooling and structured timeout logs",
      url: "https://github.com/mdibrahim-ux/api-service/pull/42",
      draft: false,
      files: "04",
      filesCountNum: 4,
      added: "+96",
      removed: "−64",
      time: "2.9s",
      signals: 0,
      status: "CLEAN",
      kind: "clean",
      isSample: true,
      decision: "No active findings under configured rule packs",
      decisionCopy:
        "Connection pool lifecycle and context-manager cleanup verified across all 4 files with zero resource leak signals.",
      fileTypes: [
        ["PY", "Python", 85, "03", ""],
        ["{ }", "Config", 25, "01", "mint-fill"]
      ],
      changedFiles: [
        { path: "service/http/pool_manager.py", type: "PY", added: "+54", removed: "−38", signals: 0 },
        { path: "service/middleware/timeout.py", type: "PY", added: "+28", removed: "−18", signals: 0 },
        { path: "service/ telemetry.py", type: "PY", added: "+10", removed: "−6", signals: 0 },
        { path: "config/pool.json", type: "{ }", added: "+4", removed: "−2", signals: 0 }
      ],
      findings: []
    }
  ];

  /* ─────────────────────── Application State ─────────────────────── */
  let reviewData = structuredClone(SAMPLE_PULL_REQUESTS);
  let selectedReview = 0;
  let usingLivePullRequests = false;
  let activeQueueFilter = "all";
  let activeQueueSort = "recent";
  let activeQueueSearch = "";
  let activeSeverityFilter = "all";
  let activeTimelineFilter = "all";
  let metricsMode = "benchmark"; // "benchmark" | "queue"
  let toastTimer = null;
  let lastFocusedElement = null;

  /* ─────────────────────── DOM Utilities ─────────────────────── */
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
    toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
  }

  $("#toastClose")?.addEventListener("click", () => {
    clearTimeout(toastTimer);
    $("#toast")?.classList.remove("show");
  });

  /* ─────────────────────── Theme Management (Light / Dark) ─────────────────────── */
  const themeBtn = $("#themeToggle");
  const themeMeta = $('meta[name="theme-color"]');

  function applyTheme(isDark) {
    document.body.classList.toggle("dark-mode", isDark);
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", String(isDark));
      themeBtn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      themeBtn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
      themeBtn.innerHTML = isDark
        ? '<span class="theme-icon" aria-hidden="true">☀</span><span class="theme-label">Light mode</span>'
        : '<span class="theme-icon" aria-hidden="true">☾</span><span class="theme-label">Dark mode</span>';
    }
    if (themeMeta) {
      themeMeta.setAttribute("content", isDark ? "#0d1017" : "#f4f1e9");
    }
    try {
      localStorage.setItem("sentinel-theme", isDark ? "dark" : "light");
    } catch (_) {}
  }

  (() => {
    let saved = "light";
    try {
      saved = localStorage.getItem("sentinel-theme") || "light";
    } catch (_) {}
    applyTheme(saved === "dark");
  })();

  themeBtn?.addEventListener("click", () => {
    const nextDark = !document.body.classList.contains("dark-mode");
    applyTheme(nextDark);
    showToast(nextDark ? "Dark editorial theme enabled." : "Archival light theme enabled.", "◐");
  });

  /* ─────────────────────── Live IST Clock ─────────────────────── */
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

  /* ─────────────────────── Workspace Switcher Popover ─────────────────────── */
  const wsSwitch = $("#workspaceSwitch");
  const wsPopover = $("#workspacePopover");

  wsSwitch?.addEventListener("click", event => {
    event.stopPropagation();
    const isHidden = wsPopover?.classList.toggle("hidden");
    wsSwitch.setAttribute("aria-expanded", String(!isHidden));
  });

  $$(".workspace-option").forEach(option => {
    option.addEventListener("click", () => {
      $$(".workspace-option").forEach(o => o.classList.remove("active"));
      option.classList.add("active");
      const name = option.dataset.ws || "Personal / Lab";
      const avatar = option.dataset.avatar || "M";
      safeText("#workspaceName", name);
      safeText("#workspaceAvatar", avatar);
      safeText("#breadcrumbWs", name.split("/")[0].trim());
      wsPopover?.classList.add("hidden");
      wsSwitch?.setAttribute("aria-expanded", "false");
      showToast(`Switched workspace context to ${name}.`);
    });
  });

  document.addEventListener("click", event => {
    if (wsPopover && !wsPopover.classList.contains("hidden") && !wsPopover.contains(event.target)) {
      wsPopover.classList.add("hidden");
      wsSwitch?.setAttribute("aria-expanded", "false");
    }
  });

  /* ─────────────────────── Telemetry Metrics Mode (Benchmark vs Active Queue) ─────────────────────── */
  function animateCount(element, target, duration = 650) {
    if (!element) return;
    if (reducedMotion.matches) {
      element.textContent = Number(target).toLocaleString("en-IN");
      return;
    }
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      element.textContent = Math.round(Number(target) * eased).toLocaleString("en-IN");
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function renderTopMetrics() {
    const btnBench = $("#metricsModeBenchmark");
    const btnQueue = $("#metricsModeQueue");
    btnBench?.classList.toggle("active", metricsMode === "benchmark");
    btnQueue?.classList.toggle("active", metricsMode === "queue");

    if (metricsMode === "benchmark") {
      safeText("#telemetryNoticeBadge", "DEMO / SAMPLE METRICS");
      safeText(
        "#telemetryNoticeText",
        "128 reviews, 46 findings, 8 high-risk signals, and 82% are illustrative 7-day benchmark values. Switch to 'Active Queue' to compute live totals from the loaded PR queue."
      );
      safeText("#metricLabel1", "SAMPLE REVIEWS PROCESSED");
      animateCount($("#metricVal1"), 128);
      safeText("#metricChip1", "+12.8%");
      safeText("#metricSub1", "over the previous 7 days");

      safeText("#metricLabel2", "SAMPLE FINDINGS SURFACED");
      animateCount($("#metricVal2"), 46);
      safeText("#metricChip2", "Across 128 reviews");
      safeText("#metricSub2", "configured rule matches");

      safeText("#metricLabel3", "SAMPLE HIGH-RISK SIGNALS");
      animateCount($("#metricVal3"), 8);
      safeText("#metricChip3", "2 critical · 6 high");
      safeText("#metricSub3", "require manual verification");

      safeText("#metricLabel4", "SAMPLE CLEAN REVIEW RATE");
      const val4 = $("#metricVal4");
      if (val4) val4.innerHTML = '82<span class="metric-percent">%</span>';
      safeText("#metricChip4", "↑ 4.2%");
      safeText("#metricSub4", "zero blocking findings");
      const meter = $("#cleanMeterBar");
      if (meter) meter.style.width = "82%";
    } else {
      const totalPRs = reviewData.length;
      const totalFindings = reviewData.reduce((acc, r) => acc + (Number(r.signals) || 0), 0);
      let critCount = 0;
      let highCount = 0;
      reviewData.forEach(r => {
        (r.findings || []).forEach(f => {
          if (f.severity === "CRITICAL") critCount++;
          if (f.severity === "HIGH") highCount++;
        });
      });
      const highRiskTotal = critCount + highCount;
      const cleanPRs = reviewData.filter(r => (Number(r.signals) || 0) === 0).length;
      const cleanRate = totalPRs ? Math.round((cleanPRs / totalPRs) * 100) : 100;

      safeText("#telemetryNoticeBadge", usingLivePullRequests ? "LIVE QUEUE TELEMETRY" : "ACTIVE QUEUE TELEMETRY");
      safeText(
        "#telemetryNoticeText",
        `Computed directly from the ${totalPRs} pull request(s) currently loaded in the workbench queue.`
      );
      safeText("#metricLabel1", "OPEN PRS IN QUEUE");
      animateCount($("#metricVal1"), totalPRs);
      safeText("#metricChip1", usingLivePullRequests ? "LIVE API" : "LOADED");
      safeText("#metricSub1", "in current review queue");

      safeText("#metricLabel2", "ACTIVE QUEUE FINDINGS");
      animateCount($("#metricVal2"), totalFindings);
      safeText("#metricChip2", `Across ${totalPRs} PRs`);
      safeText("#metricSub2", "surfaced in workbench");

      safeText("#metricLabel3", "HIGH-RISK SIGNALS");
      animateCount($("#metricVal3"), highRiskTotal);
      safeText("#metricChip3", `${critCount} critical · ${highCount} high`);
      safeText("#metricSub3", "in active queue");

      safeText("#metricLabel4", "QUEUE CLEAN PR RATE");
      const val4 = $("#metricVal4");
      if (val4) val4.innerHTML = `${cleanRate}<span class="metric-percent">%</span>`;
      safeText("#metricChip4", `${cleanPRs} of ${totalPRs} PRs`);
      safeText("#metricSub4", "zero findings detected");
      const meter = $("#cleanMeterBar");
      if (meter) meter.style.width = `${cleanRate}%`;
    }
  }

  $("#metricsModeBenchmark")?.addEventListener("click", () => {
    metricsMode = "benchmark";
    renderTopMetrics();
  });

  $("#metricsModeQueue")?.addEventListener("click", () => {
    metricsMode = "queue";
    renderTopMetrics();
  });

  /* ─────────────────────── Update Global Counters & Analytics ─────────────────────── */
  function updateCountersAndAnalytics() {
    const count = reviewData.length;
    const totalSignals = reviewData.reduce((sum, r) => sum + (Number(r.signals) || 0), 0);

    safeText("#queueHeaderCount", String(count).padStart(2, "0"));
    safeText("#inboxCountBadge", String(count).padStart(2, "0"));
    safeText("#navPrCount", String(count).padStart(2, "0"));
    safeText("#navFindingCount", String(totalSignals).padStart(2, "0"));

    // Update filter pill counts
    const riskCount = reviewData.filter(r => r.kind === "risk").length;
    const warnCount = reviewData.filter(r => r.kind === "warn").length;
    const cleanCount = reviewData.filter(r => r.kind === "clean").length;

    const pillAll = $('.filter-pill[data-filter="all"]');
    const pillRisk = $('.filter-pill[data-filter="risk"]');
    const pillWarn = $('.filter-pill[data-filter="warn"]');
    const pillClean = $('.filter-pill[data-filter="clean"]');
    if (pillAll) pillAll.textContent = `ALL (${count})`;
    if (pillRisk) pillRisk.textContent = `HIGH RISK (${riskCount})`;
    if (pillWarn) pillWarn.textContent = `NEEDS REVIEW (${warnCount})`;
    if (pillClean) pillClean.textContent = `CLEAN (${cleanCount})`;

    // Compute severity distribution across queue
    let crit = 0, high = 0, med = 0, low = 0;
    reviewData.forEach(r => {
      (r.findings || []).forEach(f => {
        const s = String(f.severity || "MEDIUM").toUpperCase();
        if (s === "CRITICAL") crit++;
        else if (s === "HIGH") high++;
        else if (s === "MEDIUM") med++;
        else low++;
      });
    });
    const totalF = crit + high + med + low;
    const pct = n => (totalF > 0 ? Math.round((n / totalF) * 100) : 0);

    safeText("#analyticsTotalSignalsBadge", `${totalF} SIGNALS IN QUEUE`);
    safeText("#legendCritCount", `${crit} (${pct(crit)}%)`);
    safeText("#legendHighCount", `${high} (${pct(high)}%)`);
    safeText("#legendMedCount", `${med} (${pct(med)}%)`);
    safeText("#legendLowCount", `${low} (${pct(low)}%)`);

    const segCrit = $("#barSegCrit");
    const segHigh = $("#barSegHigh");
    const segMed = $("#barSegMed");
    const segLow = $("#barSegLow");
    if (totalF > 0) {
      if (segCrit) segCrit.style.width = `${(crit / totalF) * 100}%`;
      if (segHigh) segHigh.style.width = `${(high / totalF) * 100}%`;
      if (segMed) segMed.style.width = `${(med / totalF) * 100}%`;
      if (segLow) segLow.style.width = `${(low / totalF) * 100}%`;
    }

    if (metricsMode === "queue") {
      renderTopMetrics();
    }
  }

  /* ─────────────────────── Render Queue List with Search, Filter & Sort ─────────────────────── */
  function getFilteredAndSortedQueue() {
    return reviewData
      .map((item, originalIndex) => ({ item, originalIndex }))
      .filter(({ item }) => {
        if (activeQueueFilter !== "all" && item.kind !== activeQueueFilter) {
          return false;
        }
        if (activeQueueSearch) {
          const haystack = `${item.repo} #${item.pr} ${item.owner} ${item.description} ${item.branch || ""} ${item.status}`.toLowerCase();
          if (!haystack.includes(activeQueueSearch)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (activeQueueSort === "signals") {
          return (Number(b.item.signals) || 0) - (Number(a.item.signals) || 0);
        }
        if (activeQueueSort === "files") {
          return (Number(b.item.filesCountNum) || 0) - (Number(a.item.filesCountNum) || 0);
        }
        if (activeQueueSort === "pr") {
          return (Number(b.item.pr) || 0) - (Number(a.item.pr) || 0);
        }
        return (b.item.sortOrder || 0) - (a.item.sortOrder || 0);
      });
  }

  function renderQueueList() {
    const container = $("#queueItemsContainer");
    if (!container) return;

    container.replaceChildren();
    const filtered = getFilteredAndSortedQueue();

    safeText(
      "#queueFooterMode",
      usingLivePullRequests ? "LIVE GITHUB QUEUE" : "CURATED + LIVE QUEUE"
    );
    safeText(
      "#queueFooterCount",
      `${filtered.length} OF ${reviewData.length} SHOWN`
    );

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "queue-empty-filter";
      empty.innerHTML = `
        <b>No pull requests match your filter.</b>
        <p style="margin:6px 0 10px">Try clearing the search query or switching status filter to ALL.</p>
      `;
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "inline-action";
      resetBtn.textContent = "Reset queue filters";
      resetBtn.addEventListener("click", resetQueueFilters);
      empty.appendChild(resetBtn);
      container.appendChild(empty);
      return;
    }

    filtered.forEach(({ item: review, originalIndex }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `queue-item${originalIndex === selectedReview ? " selected" : ""}`;
      button.dataset.review = String(originalIndex);
      button.setAttribute("aria-pressed", String(originalIndex === selectedReview));

      const badgeClass =
        review.kind === "risk"
          ? "badge-risk"
          : review.kind === "warn"
            ? "badge-review"
            : "badge-clean";

      const countClass =
        review.kind === "risk"
          ? "risk-count"
          : review.kind === "warn"
            ? "warn-count"
            : "clean-count";

      const signalDisplay =
        review.liveResult || review.isSample
          ? String(review.signals).padStart(2, "0")
          : "—";

      const filesBadge =
        review.files && review.files !== "—"
          ? `${Number(review.files)} FILES`
          : "LIVE PR";

      button.innerHTML = `
        <span class="repo-symbol ${escapeHTML(review.symbolClass || "symbol-github")}">${escapeHTML(review.symbol || "⌘")}</span>
        <span class="queue-copy">
          <span class="queue-title">${escapeHTML(review.repo)} <small>#${escapeHTML(review.pr)}</small></span>
          <span class="queue-description">${escapeHTML(review.owner)} · ${escapeHTML(review.description)}</span>
          <span class="queue-badges">
            <i class="badge ${badgeClass}">${escapeHTML(review.status)}</i>
            <i class="badge badge-files">${escapeHTML(filesBadge)}</i>
            ${review.branch ? `<i class="badge badge-branch">${escapeHTML(review.branch.split(" ")[0])}</i>` : ""}
          </span>
        </span>
        <span class="queue-count ${countClass}">
          <b>${escapeHTML(signalDisplay)}</b>
          <small>${Number(review.signals) === 1 ? "signal" : "signals"}</small>
        </span>
        <span class="queue-indicator" aria-hidden="true">↗</span>
      `;

      button.addEventListener("click", () => renderReview(originalIndex));
      container.appendChild(button);
    });
  }

  function resetQueueFilters() {
    activeQueueFilter = "all";
    activeQueueSearch = "";
    activeQueueSort = "recent";
    const searchInput = $("#queueSearchInput");
    if (searchInput) searchInput.value = "";
    $("#queueSearchClear")?.classList.add("hidden");
    const sortSelect = $("#queueSortSelect");
    if (sortSelect) sortSelect.value = "recent";
    $$(".queue-filter-pills .filter-pill").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.filter === "all");
    });
    renderQueueList();
  }

  $("#queueSearchInput")?.addEventListener("input", event => {
    activeQueueSearch = event.target.value.trim().toLowerCase();
    $("#queueSearchClear")?.classList.toggle("hidden", !activeQueueSearch);
    renderQueueList();
  });

  $("#queueSearchClear")?.addEventListener("click", () => {
    activeQueueSearch = "";
    const input = $("#queueSearchInput");
    if (input) {
      input.value = "";
      input.focus();
    }
    $("#queueSearchClear")?.classList.add("hidden");
    renderQueueList();
  });

  $("#queueSortSelect")?.addEventListener("change", event => {
    activeQueueSort = event.target.value;
    renderQueueList();
  });

  $$(".queue-filter-pills .filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      activeQueueFilter = pill.dataset.filter || "all";
      $$(".queue-filter-pills .filter-pill").forEach(p => p.classList.toggle("active", p === pill));
      renderQueueList();
    });
  });

  /* ─────────────────────── Render File Footprint & Changed Files ─────────────────────── */
  function fileRowsMarkup(files) {
    if (!Array.isArray(files) || !files.length) {
      return `
        <div class="footprint-row">
          <span class="filetype type-py">PR</span>
          <span class="footprint-name">Run review to scan</span>
          <div class="footprint-track"><i style="width:18%"></i></div>
          <span class="footprint-count">—</span>
        </div>
      `;
    }

    const typeClass = type =>
      type === "PY" ? "type-py" :
      type === "MD" ? "type-md" :
      type === "TS" ? "type-ts" :
      type === "JS" ? "type-js" :
      type === "CSS" ? "type-css" :
      type === "YML" ? "type-yml" :
      type === "FILE" ? "type-file" : "type-json";

    return files.map(file => `
      <div class="footprint-row">
        <span class="filetype ${typeClass(file[0])}">${escapeHTML(file[0])}</span>
        <span class="footprint-name">${escapeHTML(file[1])}</span>
        <div class="footprint-track">
          <i class="${escapeHTML(file[4] || "")}" style="width:${Math.max(0, Math.min(100, Number(file[2]) || 0))}%"></i>
        </div>
        <span class="footprint-count">${escapeHTML(file[3])}</span>
      </div>
    `).join("");
  }

  function renderChangedFilesList(review) {
    const list = $("#changedFilesList");
    if (!list) return;
    list.replaceChildren();

    const files = Array.isArray(review.changedFiles) ? review.changedFiles : [];
    safeText("#changedFilesCountLabel", review.isSample ? `${files.length} SAMPLE FILES` : `${files.length} FINDING FILES`);

    if (!files.length) {
      const empty = document.createElement("div");
      empty.style.fontSize = "11.5px";
      empty.style.color = "var(--ink-muted)";
      empty.textContent = review.isSample
        ? "This curated sample has no file list for the selected record."
        : review.liveResult
          ? "The read-only endpoint returns paths for files with findings, but not a complete manifest of clean files or line-change totals."
          : "Run a live review to load file paths for any findings; clean-file metadata is not currently exposed by this endpoint.";
      list.appendChild(empty);
      return;
    }

    files.forEach(file => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "changed-file-item";
      const sigBadge = file.signals > 0
        ? `<span class="badge badge-risk">${file.signals} SIGNAL${file.signals > 1 ? "S" : ""}</span>`
        : `<span class="badge badge-clean">CLEAN</span>`;

      btn.innerHTML = `
        <span class="changed-file-path">${escapeHTML(file.path)}</span>
        <span class="changed-file-meta">
          <span class="stat-added">${escapeHTML(file.added)}</span>
          <span class="stat-removed">${escapeHTML(file.removed)}</span>
          ${sigBadge}
        </span>
      `;

      btn.addEventListener("click", () => {
        $("#findings")?.scrollIntoView({
          behavior: reducedMotion.matches ? "auto" : "smooth",
          block: "start"
        });
        if (file.signals > 0) {
          showToast(`Inspecting findings in ${file.path}`);
        } else {
          showToast(`${file.path} passed all active rule checks.`);
        }
      });

      list.appendChild(btn);
    });
  }

  /* ─────────────────────── Render Review Findings & Code-Diff Cards ─────────────────────── */
  function buildDiffRowsHTML(lines) {
    if (!Array.isArray(lines) || !lines.length) return "";
    return lines.map(line => {
      const rowClass =
        line.type === "add" ? "diff-line line-add" :
        line.type === "del" ? "diff-line line-del" : "diff-line";
      const focusClass = line.focus ? " line-focus" : "";
      const sign = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";
      const codeText = line.code.replace(/^[+-]\s?/, "  ");

      let html = `
        <tr class="${rowClass}${focusClass}">
          <td class="diff-num">${escapeHTML(line.oldNum ?? "")}</td>
          <td class="diff-num">${escapeHTML(line.newNum ?? "")}</td>
          <td class="diff-sign">${sign}</td>
          <td class="diff-code">${escapeHTML(codeText)}</td>
        </tr>
      `;
      if (line.annotation) {
        html += `
          <tr class="diff-annotation-row">
            <td colspan="4">↳ <strong>${escapeHTML(line.annotation)}</strong></td>
          </tr>
        `;
      }
      return html;
    }).join("");
  }

  function populateTraceForFinding(finding) {
    const chain = $("#evidenceChain");
    if (!chain) return;
    chain.classList.remove("hidden");

    if (finding && finding.trace) {
      safeText("#traceTargetTitle", `Trace for ${finding.rule} in ${finding.file}`);
      safeText("#traceStep1Meta", finding.trace.step1);
      safeText("#traceStep2Meta", finding.trace.step2);
      safeText("#traceStep3Meta", finding.trace.step3);
      safeText("#traceStep3Badge", finding.severity || "REVIEW");
    }
  }

  function renderFindingsWorkbench(review) {
    const findingsList = $("#findingsList");
    const emptyBox = $("#evidenceEmpty");
    if (!findingsList || !emptyBox) return;

    const allFindings = Array.isArray(review.findings) ? review.findings : [];

    // Update severity counts for this PR
    const cCrit = allFindings.filter(f => f.severity === "CRITICAL").length;
    const cHigh = allFindings.filter(f => f.severity === "HIGH").length;
    const cMed = allFindings.filter(f => f.severity === "MEDIUM").length;
    const cLow = allFindings.filter(f => f.severity === "LOW").length;

    safeText("#findingsHeaderCount", String(allFindings.length).padStart(2, "0"));
    safeText("#sevCountAll", allFindings.length);
    safeText("#sevCountCrit", cCrit);
    safeText("#sevCountHigh", cHigh);
    safeText("#sevCountMed", cMed);
    safeText("#sevCountLow", cLow);

    safeText(
      "#evidenceSourceBadge",
      review.liveResult
        ? "LIVE AWS API ANALYSIS"
        : review.isSample
          ? "SAMPLE DOSSIER RECORD"
          : "DETERMINISTIC RULE ENGINE"
    );

    const filteredFindings = allFindings.filter(f => {
      if (activeSeverityFilter === "all") return true;
      return String(f.severity || "").toUpperCase() === activeSeverityFilter;
    });

    findingsList.replaceChildren();

    if (!allFindings.length) {
      emptyBox.classList.remove("hidden");
      $("#evidenceChain")?.classList.add("hidden");

      if (!review.liveResult && !review.isSample) {
        safeText("#evidenceEmpty h3", "Review has not been run.");
        safeText(
          "#evidenceEmpty p",
          "Live pull-request metadata is loaded. Click 'Run code review' to execute read-only analysis against this pull request."
        );
      } else {
        safeText("#evidenceEmpty h3", "No active findings.");
        safeText(
          "#evidenceEmpty p",
          review.isSample
            ? `This curated sample contains no displayed findings. Its example metadata is illustrative, not a live analysis result.`
            : `No findings matched the configured deterministic rules across ${review.files} files. This does not guarantee that the code is defect-free.`
        );
      }
      return;
    }

    emptyBox.classList.add("hidden");

    // Populate trace pipeline with first finding
    populateTraceForFinding(filteredFindings[0] || allFindings[0]);

    if (!filteredFindings.length) {
      const noMatch = document.createElement("div");
      noMatch.className = "evidence-empty";
      noMatch.innerHTML = `
        <h3>No ${escapeHTML(activeSeverityFilter)} findings in this PR.</h3>
        <p>There are ${allFindings.length} finding(s) in other severity tiers for PR #${escapeHTML(review.pr)}.</p>
      `;
      findingsList.appendChild(noMatch);
      return;
    }

    filteredFindings.forEach((finding, idx) => {
      const sevLower = String(finding.severity || "medium").toLowerCase();
      const card = document.createElement("article");
      card.className = `finding-card sev-border-${sevLower}`;

      const hasDiff = Array.isArray(finding.diffLines) && finding.diffLines.length > 0;
      const hasFix = Array.isArray(finding.fixLines) && finding.fixLines.length > 0;

      card.innerHTML = `
        <div class="finding-header" role="button" tabindex="0" aria-expanded="true">
          <div class="finding-header-main">
            <div class="finding-badges-row">
              <span class="sev-badge ${sevLower}">${escapeHTML(finding.severity || "MEDIUM")}</span>
              <span class="finding-rule-tag">${escapeHTML(finding.rule || "rule-match")}</span>
              <span class="finding-file-loc">${escapeHTML(finding.file || "source")} : line ${escapeHTML(finding.line || 1)}</span>
            </div>
            <h3 class="finding-title">${idx + 1}. ${escapeHTML(finding.title || finding.message || "Code review finding")}</h3>
          </div>
          <div class="finding-header-actions">
            <button type="button" class="finding-expand-btn trace-focus-btn">Trace ⌁</button>
            <button type="button" class="finding-expand-btn toggle-body-btn">Collapse −</button>
          </div>
        </div>
        <div class="finding-body">
          <div class="finding-explanation-grid">
            <div class="finding-explain-box">
              <small>TECHNICAL ISSUE</small>
              <p>${escapeHTML(finding.issue || finding.description || finding.message || "Rule violation detected in changed path.")}</p>
            </div>
            <div class="finding-explain-box">
              <small>SECURITY / RELIABILITY IMPACT</small>
              <p>${escapeHTML(finding.impact || "Requires maintainer verification before merging into target branch.")}</p>
            </div>
            <div class="finding-explain-box">
              <small>RECOMMENDED REMEDIATION</small>
              <p>${escapeHTML(finding.remediation || "Apply the guard or structural fix shown in the remediation patch below.")}</p>
            </div>
          </div>
          ${hasDiff ? `
          <div class="diff-container">
            <div class="diff-topbar">
              <div class="diff-file-label">
                <span>FILE DIFF</span>
                <strong>${escapeHTML(finding.file)}</strong>
                <small style="color:#9ba3b8">(line ${escapeHTML(finding.line)})</small>
              </div>
              <div class="diff-tabs">
                <button type="button" class="diff-tab-btn active" data-mode="patch">PR Patch Diff</button>
                ${hasFix ? `<button type="button" class="diff-tab-btn" data-mode="fix">Recommended Fix Patch ✓</button>` : ""}
                <button type="button" class="diff-copy-btn">${hasFix ? "Copy Fix" : "Copy Diff Context"} ⎘</button>
              </div>
            </div>
            <div class="diff-table-wrap">
              <table class="diff-table" aria-label="Code diff for ${escapeHTML(finding.file)}">
                <tbody>
                  ${buildDiffRowsHTML(finding.diffLines)}
                </tbody>
              </table>
            </div>
          </div>
          ` : ""}
        </div>
      `;

      // Interactive collapse / expand
      const bodyEl = $(".finding-body", card);
      const toggleBtn = $(".toggle-body-btn", card);
      const headerEl = $(".finding-header", card);

      function toggleCard(event) {
        if (event.target.closest(".trace-focus-btn")) return;
        const hidden = bodyEl.classList.toggle("hidden");
        headerEl.setAttribute("aria-expanded", String(!hidden));
        if (toggleBtn) toggleBtn.textContent = hidden ? "Expand +" : "Collapse −";
      }

      headerEl?.addEventListener("click", toggleCard);
      headerEl?.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCard(e);
        }
      });

      // Trace button
      $(".trace-focus-btn", card)?.addEventListener("click", e => {
        e.stopPropagation();
        populateTraceForFinding(finding);
        $("#evidenceChain")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        showToast(`Loaded deterministic trace for ${finding.rule}`);
      });

      // Diff tab switching (PR Patch vs Recommended Fix)
      const tbody = $(".diff-table tbody", card);
      $$(".diff-tab-btn", card).forEach(tabBtn => {
        tabBtn.addEventListener("click", () => {
          $$(".diff-tab-btn", card).forEach(b => b.classList.remove("active"));
          tabBtn.classList.add("active");
          const mode = tabBtn.dataset.mode;
          if (tbody) {
            tbody.innerHTML = buildDiffRowsHTML(mode === "fix" && hasFix ? finding.fixLines : finding.diffLines);
          }
        });
      });

      // Copy a remediation patch if one exists; otherwise copy the observed PR diff context.
      $(".diff-copy-btn", card)?.addEventListener("click", () => {
        const sourceLines = hasFix ? finding.fixLines : finding.diffLines;
        const snippet = (sourceLines || [])
          .map(line => {
            const code = String(line.code || "").replace(/^[+-]\\s?/, "");
            if (hasFix) return line.type === "del" ? null : code;
            const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
            return prefix + code;
          })
          .filter(line => line !== null)
          .join("\\n");
        navigator.clipboard?.writeText(snippet).catch(() => {});
        showToast(hasFix
          ? `Copied remediation patch for ${finding.file}`
          : `Copied observed diff context for ${finding.file}`);
      });

      findingsList.appendChild(card);
    });
  }

  $$(".sev-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      activeSeverityFilter = pill.dataset.sev || "all";
      $$(".sev-pill").forEach(p => p.classList.toggle("active", p === pill));
      const review = reviewData[selectedReview];
      if (review) renderFindingsWorkbench(review);
    });
  });

  /* ─────────────────────── Render Selected Review Detail Card ─────────────────────── */
  function renderReview(index) {
    const review = reviewData[index];
    if (!review) return;

    selectedReview = index;

    const card = $("#reviewDetail");
    if (card) {
      card.classList.remove("detail-refresh");
      void card.offsetWidth;
      card.classList.add("detail-refresh");
    }

    safeText("#heroCardPr", `#${String(review.pr).padStart(3, "0")}`);
    safeText("#detailRepo", review.repo);
    safeText("#detailPR", `PULL REQUEST #${review.pr}`);
    safeText("#detailAuthor", `@${review.owner}`);
    safeText("#detailBranch", review.branch || "feature → main");
    safeText("#detailUpdated", review.updatedAt || "Active PR");
    safeText("#detailDescription", review.description);
    safeText("#detailFiles", review.files);
    safeText("#detailAdded", review.added);
    safeText("#detailRemoved", review.removed);
    safeText("#detailTime", review.time);

    safeText(
      "#detailFindingSummary",
      `${review.signals} SIGNAL${Number(review.signals) === 1 ? "" : "S"} DETECTED`
    );

    const status = $("#detailStatus");
    if (status) {
      status.className = `status-label ${review.kind}`;
      status.innerHTML = `<i></i> ${escapeHTML(review.status)}`;
    }

    const footprint = $("#detailFootprint");
    if (footprint) footprint.innerHTML = fileRowsMarkup(review.fileTypes);

    renderChangedFilesList(review);
    renderFindingsWorkbench(review);

    if (reviewButton) {
      reviewButton.disabled = Boolean(review.isReviewing);
      updateReviewButtonLabel(review);
    }

    renderQueueList();
    updateCountersAndAnalytics();
  }

  /* ─────────────────────── Live GitHub Pull Requests API + Fallback ─────────────────────── */
  function setConnectionStatus(isLive, labelText) {
    const badge = $("#connectionBadge");
    const dot = $("#modeDot");
    safeText("#connectionText", labelText);
    badge?.classList.toggle("is-live", isLive);
    dot?.classList.toggle("sample", !isLive);
    safeText("#modeLabel", isLive ? "Source: Live API" : "Source: Sample");
  }

  async function loadLivePullRequests(manualTrigger = false) {
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 4500);

      const response = await fetch(`${API_BASE}/pull-requests`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (!Array.isArray(data.pull_requests)) {
        throw new Error("Unexpected pull-request response");
      }

      if (data.pull_requests.length > 0) {
        reviewData = data.pull_requests.map((pr, idx) => ({
          repo: (data.repository || "mdibrahim-ux/ai-code-review-agent").split("/").pop(),
          symbol: "⌘",
          symbolClass: "symbol-github",
          owner: pr.author || "mdibrahim-ux",
          pr: Number(pr.number),
          branch: `pr-${pr.number} → main`,
          updatedAt: pr.updated_at ? `Updated ${pr.updated_at.slice(0, 10)}` : "Live GitHub PR",
          sortOrder: 100 - idx,
          description: pr.title || "Untitled pull request",
          url: pr.url || "#",
          draft: Boolean(pr.draft),
          files: "—",
          filesCountNum: 0,
          added: "—",
          removed: "—",
          time: "—",
          signals: 0,
          status: pr.draft ? "DRAFT" : "NOT REVIEWED",
          kind: "warn",
          isSample: false,
          decision: "Review has not been run yet",
          decisionCopy: "Live pull-request metadata is loaded from GitHub via AWS API Gateway. Run a read-only review to analyze the selected pull request.",
          liveResult: null,
          isReviewing: false,
          fileTypes: [["PR", "Awaiting scan", 25, "—", ""]],
          changedFiles: [],
          findings: []
        }));

        usingLivePullRequests = true;
        selectedReview = 0;
        setConnectionStatus(true, "LIVE AWS API");
        safeText("#queueSourceTag", "SOURCE: LIVE GITHUB API");
        renderReview(0);
        showToast(`Loaded ${reviewData.length} live pull request(s) from GitHub.`);
      } else {
        // A reachable API with no open PRs is not a populated live queue.
        usingLivePullRequests = false;
        reviewData = structuredClone(SAMPLE_PULL_REQUESTS);
        selectedReview = 0;
        setConnectionStatus(false, "LIVE API · 0 OPEN PRS / SAMPLE VIEW");
        safeText("#queueSourceTag", "SOURCE: CURATED SAMPLES · 0 LIVE PRS");
        renderReview(0);
        if (manualTrigger) {
          showToast("The API is reachable, but GitHub returned no open pull requests. Showing curated samples.", "i");
        }
      }
    } catch (error) {
      // Reset stale data: never label an old PR list as live after a failed sync.
      usingLivePullRequests = false;
      reviewData = structuredClone(SAMPLE_PULL_REQUESTS);
      selectedReview = 0;
      setConnectionStatus(false, "SAMPLE MODE · API UNAVAILABLE");
      safeText("#queueSourceTag", "SOURCE: CURATED DATASET");
      renderReview(0);

      if (manualTrigger) {
        const message = error?.name === "AbortError"
          ? "The live API request timed out. Showing curated sample data."
          : `Could not load live pull requests (${error.message}). Showing curated sample data.`;
        showToast(message, "!");
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  $("#syncLiveBtn")?.addEventListener("click", () => {
    showToast("Syncing with live AWS GitHub API...", "↻");
    loadLivePullRequests(true);
  });

  $("#modeSwitchBtn")?.addEventListener("click", () => {
    if (usingLivePullRequests) {
      usingLivePullRequests = false;
      reviewData = structuredClone(SAMPLE_PULL_REQUESTS);
      selectedReview = 0;
      setConnectionStatus(false, "SAMPLE DATASET MODE");
      safeText("#queueSourceTag", "SOURCE: CURATED DATASET");
      renderReview(0);
      showToast("Switched to Curated Sample Dataset (4 PRs with inline diffs).");
    } else {
      loadLivePullRequests(true);
    }
  });

  /* ─────────────────────── Flight Recorder (Timeline) ─────────────────────── */
  function addTimelineEvent(title = "Review completed", description = "", kind = "mint", category = "api") {
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
    event.dataset.tkind = category;

    if (activeTimelineFilter !== "all" && activeTimelineFilter !== category) {
      event.classList.add("hidden");
    }

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

    $$(".timeline-event", timeline).slice(8).forEach(old => old.remove());
  }

  $$(".timeline-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTimelineFilter = btn.dataset.tfilter || "all";
      $$(".timeline-filter").forEach(b => b.classList.toggle("active", b === btn));
      $$("#timelineEvents .timeline-event").forEach(ev => {
        const k = ev.dataset.tkind || "api";
        ev.classList.toggle("hidden", activeTimelineFilter !== "all" && k !== activeTimelineFilter);
      });
    });
  });

  /* ─────────────────────── Real Read-Only Review API Execution ─────────────────────── */
  const reviewButton = $("#simulateReview");

  function updateReviewButtonLabel(review) {
    if (!reviewButton || review?.isReviewing) return;
    const sampleMode = Boolean(review?.isSample || !usingLivePullRequests);
    const label = sampleMode ? "Inspect sample dossier" : "Run read-only review";
    const icon = sampleMode ? "⌕" : "▶";
    reviewButton.innerHTML = `<span class="button-icon">${icon}</span><span>${label}</span><span class="button-arrow">↗</span>`;
    reviewButton.title = sampleMode
      ? "Inspect a curated example. This action does not call AWS."
      : "Analyze the selected live pull request using read-only deterministic rules.";
  }

  reviewButton?.addEventListener("click", async () => {
    const review = reviewData[selectedReview];

    if (!review || !Number.isInteger(review.pr) || review.pr < 1) {
      showToast("Select a valid pull request first.", "!");
      return;
    }

    if (review.isReviewing) return;

    if (review.isSample || !usingLivePullRequests) {
      addTimelineEvent(
        "Curated sample dossier inspected",
        `Sample PR #${review.pr} · ${review.signals} illustrative finding(s) · no AWS request was made.`,
        "yellow",
        "rules"
      );
      showToast("This is a curated sample dossier. Switch to Live API to review a real open pull request.", "i");
      $("#findings")?.scrollIntoView({
        behavior: reducedMotion.matches ? "auto" : "smooth",
        block: "start"
      });
      return;
    }

    review.isReviewing = true;
    reviewButton.disabled = true;
    reviewButton.classList.add("is-running");
    reviewButton.innerHTML = '<span class="button-icon">↻</span><span>Analyzing PR #' + review.pr + '...</span>';
    safeText("#heroStatusText", `SCANNING PR #${review.pr} / IN PROGRESS`);

    const startedAt = performance.now();

    try {
      const controller = new AbortController();
      const // The dashboard API runs with a 10-second Lambda ceiling; leave headroom for gateway transit.
      timeoutId = setTimeout(() => controller.abort(), 27000);

      const response = await fetch(`${API_BASE}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          pull_request_number: review.pr
        })
      });
      clearTimeout(timeoutId);

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || `Request failed: HTTP ${response.status}`);
      }

      if (result.status !== "reviewed") {
        throw new Error(result.message || "The API did not complete the review.");
      }

      const rawFindings = Array.isArray(result.findings) ? result.findings : [];
      review.liveResult = result;
      review.files = String(result.files_scanned ?? 0).padStart(2, "0");
      review.filesCountNum = Number(result.files_scanned ?? 0);
      review.signals = Number(result.finding_count ?? rawFindings.length);
      review.time = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
      review.status = review.signals > 0 ? "REVIEW REQUIRED" : "ANALYZED";
      review.kind = review.signals > 0 ? "risk" : "clean";
      review.decision = review.signals > 0
        ? "Findings require manual verification"
        : "No findings detected by configured rules";
      review.decisionCopy =
        `${result.files_scanned} files scanned. ${review.signals} finding(s) detected. Read-only analysis; no GitHub comments were published.`;

      const liveFileMap = new Map();
      rawFindings.forEach(f => {
        const path = String(f.filename || f.file || "").trim();
        if (!path) return;
        const item = liveFileMap.get(path) || { path, signals: 0 };
        item.signals += 1;
        liveFileMap.set(path, item);
      });
      review.changedFiles = Array.from(liveFileMap.values()).map(file => ({
        path: file.path,
        type: file.path.toLowerCase().endsWith(".py") ? "PY" :
          file.path.toLowerCase().endsWith(".js") || file.path.toLowerCase().endsWith(".jsx") ? "JS" :
          file.path.toLowerCase().endsWith(".ts") || file.path.toLowerCase().endsWith(".tsx") ? "TS" : "FILE",
        added: "—",
        removed: "—",
        signals: file.signals
      }));
      review.fileTypes = review.changedFiles.map(file => [
        file.type,
        file.path,
        review.changedFiles.length ? Math.round((file.signals / Math.max(1, rawFindings.length)) * 100) : 0,
        String(file.signals).padStart(2, "0"),
        file.signals ? "orange-fill" : "mint-fill"
      ]);

      if (rawFindings.length > 0) {
        review.findings = rawFindings.map((f, i) => ({
          id: `LIVE-${review.pr}-${i + 1}`,
          severity: String(f.severity || "HIGH").toUpperCase(),
          rule: f.rule || f.type || "rule-match",
          category: "Live AWS Scan",
          title: f.message || f.description || "Rule violation detected",
          file: f.filename || f.file || "Changed file",
          line: f.line || 1,
          issue: f.message || f.description || "Matched deterministic review rule.",
          impact: "Flagged by live AWS API review worker for developer verification.",
          remediation: f.suggestion || "Inspect the flagged file and line before merging.",
          trace: {
            step1: `${f.filename || f.file || "Changed file"} · line ${f.line || 1}`,
            step2: `${f.rule || "rule-match"} (${String(f.severity || "HIGH").toUpperCase()})`,
            step3: "Live API read-only verification required"
          },
          diffLines: Array.isArray(f.diff_context) ? f.diff_context.map(line => {
            const type = line.type === "add" || line.type === "del" ? line.type : "ctx";
            const rawCode = String(line.code || "");
            return {
              oldNum: line.old_line ?? "",
              newNum: line.new_line ?? "",
              type,
              // Preserve the unified-diff marker separately from the source text.
              code: type === "add" ? `+${rawCode}` : type === "del" ? `-${rawCode}` : rawCode,
              focus: Boolean(line.focus),
              annotation: line.focus
                ? `Matched ${f.rule || "rule"} (${String(f.severity || "HIGH").toUpperCase()}): ${f.message || "Rule match"}`
                : ""
            };
          }) : []
        }));
      }

      renderReview(selectedReview);

      addTimelineEvent(
        "Live code review completed",
        `PR #${review.pr} · ${result.files_scanned} files scanned · ${review.signals} finding(s) · comments not published`,
        review.signals > 0 ? "red" : "mint",
        "api"
      );

      showToast(`Live review complete: ${review.signals} finding(s) in ${result.files_scanned} files.`);
    } catch (error) {
      // Honest handling when live AWS API is unreachable or returns an error for sample PRs
      addTimelineEvent(
        review.isSample ? `Inspected curated dossier for PR #${review.pr}` : "Live code review request failed",
        review.isSample
          ? `Live AWS endpoint unreachable; displaying ${review.signals} pre-recorded sample signal(s) for ${review.repo} #${review.pr}.`
          : error.message,
        review.signals > 0 ? "yellow" : "mint",
        "rules"
      );

      renderReview(selectedReview);
      $("#findings")?.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });

      if (review.isSample) {
        showToast(
          `Live AWS endpoint offline — showing ${review.signals} sample signal(s) for PR #${review.pr}.`,
          "i"
        );
      } else {
        showToast(`Live review failed: ${error.message}`, "!");
      }
    } finally {
      review.isReviewing = false;
      reviewButton.disabled = false;
      reviewButton.classList.remove("is-running");
      updateReviewButtonLabel(review);
      safeText("#heroStatusText", "REVIEW SYSTEM / STANDING BY");
      renderQueueList();
    }
  });

  /* ─────────────────────── Navigation & Quick Buttons ─────────────────────── */
  $("#addTimelineEvent")?.addEventListener("click", () => {
    addTimelineEvent(
      "Demo event added (local only)",
      "Simulated dashboard checkpoint; no AWS API request was made.",
      "yellow",
      "rules"
    );
    showToast("Sample event added to flight recorder (local demo only).");
  });

  $("#jumpTimeline")?.addEventListener("click", () =>
    $("#timeline")?.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "center"
    })
  );

  $("#jumpFindings")?.addEventListener("click", () =>
    $("#findings")?.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "start"
    })
  );

  $("#jumpToDiffsBtn")?.addEventListener("click", () =>
    $("#findings")?.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "start"
    })
  );

  $("#viewAllReviews")?.addEventListener("click", () => {
    resetQueueFilters();
    showToast(`Showing all ${reviewData.length} pull requests in queue.`);
  });

  $("#showEvidenceExample")?.addEventListener("click", () => {
    const chain = $("#evidenceChain");
    if (!chain) return;
    const isNowHidden = chain.classList.toggle("hidden");
    if (!isNowHidden) {
      const currentReview = reviewData[selectedReview];
      if (currentReview?.findings?.length) {
        populateTraceForFinding(currentReview.findings[0]);
      }
    }
  });

  $("#previewTraceBtn")?.addEventListener("click", () => {
    $("#evidenceChain")?.classList.remove("hidden");
    $("#evidenceChain")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  $("#hideEvidenceExample")?.addEventListener("click", () => {
    $("#evidenceChain")?.classList.add("hidden");
  });

  $("#inspectFlaggedPrBtn")?.addEventListener("click", () => {
    const flaggedIdx = reviewData.findIndex(r => r.signals > 0);
    if (flaggedIdx !== -1) {
      renderReview(flaggedIdx);
      $("#findings")?.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(`Selected PR #${reviewData[flaggedIdx].pr} (${reviewData[flaggedIdx].signals} signals).`);
    }
  });

  $$(".repo-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetRepo = btn.dataset.repo;
      const idx = reviewData.findIndex(r => r.repo === targetRepo);
      if (idx !== -1) {
        renderReview(idx);
        $("#pull-requests")?.scrollIntoView({ behavior: "smooth", block: "start" });
        showToast(`Selected ${targetRepo} PR #${reviewData[idx].pr}.`);
      }
    });
  });

  /* ─────────────────────── Markdown Export Helper ─────────────────────── */
  function generateMarkdownSummary(review) {
    const findings = review.findings || [];
    const lines = [
      `## Sentinel Code Review Dossier — ${review.repo} #${review.pr}`,
      `- **Title:** ${review.description}`,
      `- **Author:** @${review.owner} | **Branch:** \`${review.branch || "main"}\``,
      `- **Status:** ${review.status} (${review.signals} signal(s), ${review.files} files changed, ${review.added} / ${review.removed})`,
      `- **Decision:** ${review.decision}`,
      ""
    ];
    if (findings.length) {
      lines.push("### Surfaced Findings");
      findings.forEach((f, i) => {
        lines.push(`${i + 1}. **[${f.severity}] \`${f.rule}\`** — ${f.title} (\`${f.file}:${f.line}\`)`);
        lines.push(`   - *Issue:* ${f.issue}`);
        lines.push(`   - *Remediation:* ${f.remediation}`);
      });
    } else {
      lines.push("### Verification Result\nNo findings matched the configured deterministic rules in this review. This does not guarantee the absence of defects.");
    }
    return lines.join("\n");
  }

  $("#copyReportBtn")?.addEventListener("click", () => {
    const review = reviewData[selectedReview];
    if (!review) return;
    navigator.clipboard?.writeText(generateMarkdownSummary(review)).catch(() => {});
    showToast(`Copied Markdown review report for PR #${review.pr}.`);
  });

  $("#copyDossierMd")?.addEventListener("click", () => {
    const review = reviewData[selectedReview];
    if (!review) return;
    navigator.clipboard?.writeText(generateMarkdownSummary(review)).catch(() => {});
    showToast(`Copied Markdown dossier summary for PR #${review.pr}.`);
  });

  /* ─────────────────────── Review Dossier Modal ─────────────────────── */
  const dossierBackdrop = $("#dossierBackdrop");
  const dossierModal = $("#dossierModal");

  function updateDossier(index) {
    const review = reviewData[index];
    if (!review) return;

    safeText("#dossierPR", `PR #${review.pr}`);
    safeText("#dossierModeBadge", review.liveResult ? "LIVE AWS SCAN" : "SAMPLE DOSSIER");
    safeText("#dossierTitle", review.description);
    safeText(
      "#dossierIntro",
      `Repository ${review.repo} · Pull Request #${review.pr} by @${review.owner} (${review.branch || "main"}).`
    );

    safeText("#dossierStatusTag", review.status);
    safeText("#modalFiles", review.files);
    safeText("#modalAdded", review.added);
    safeText("#modalRemoved", review.removed);
    safeText("#modalTime", review.time);
    safeText("#dossierDecision", review.decision);
    safeText("#dossierDecisionCopy", review.decisionCopy);

    safeText("#decisionStampIcon", review.signals > 0 ? "!" : "✓");
    safeText(
      "#decisionStampNote",
      `${review.signals} finding(s) · ${review.liveResult ? "live read-only AWS scan" : "curated sample record"}`
    );

    const list = $("#modalFileList");
    if (list) {
      list.replaceChildren();
      const typeClass = type =>
        type === "PY" ? "type-py" :
        type === "MD" ? "type-md" :
        type === "TS" ? "type-ts" :
        type === "YML" ? "type-yml" : "type-json";

      (review.fileTypes || []).forEach(ft => {
        const row = document.createElement("div");
        row.innerHTML = `
          <span class="modal-file-type ${typeClass(ft[0])}">${escapeHTML(ft[0])}</span>
          <span>${escapeHTML(ft[1])}</span>
          <b>${escapeHTML(ft[3])} files (${escapeHTML(ft[2])}%)</b>
        `;
        list.appendChild(row);
      });
    }
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
    }, reducedMotion.matches ? 1 : 300);
  }

  $("#inspectReview")?.addEventListener("click", openDossier);
  $("#openModelDetails")?.addEventListener("click", openDossier);
  $("#detailMenu")?.addEventListener("click", openDossier);
  $("#closeDossier")?.addEventListener("click", closeDossier);
  $("#doneDossier")?.addEventListener("click", closeDossier);

  dossierBackdrop?.addEventListener("click", event => {
    if (event.target === dossierBackdrop) closeDossier();
  });

  /* ─────────────────────── Command Palette (Ctrl + K) ─────────────────────── */
  const paletteBackdrop = $("#paletteBackdrop");
  const paletteInput = $("#paletteInput");
  let activePaletteIndex = 0;

  function getVisiblePaletteOptions() {
    return $$(".palette-option").filter(opt => !opt.classList.contains("hidden"));
  }

  function highlightPaletteOption(index) {
    const visible = getVisiblePaletteOptions();
    if (!visible.length) return;
    activePaletteIndex = ((index % visible.length) + visible.length) % visible.length;
    visible.forEach((opt, i) => opt.classList.toggle("active-opt", i === activePaletteIndex));
  }

  function openPalette() {
    if (!paletteBackdrop) return;
    lastFocusedElement = document.activeElement;
    paletteBackdrop.classList.remove("hidden");
    paletteBackdrop.setAttribute("aria-hidden", "false");
    if (paletteInput) paletteInput.value = "";
    $$(".palette-option").forEach(option => option.classList.remove("hidden"));
    highlightPaletteOption(0);

    requestAnimationFrame(() => {
      paletteBackdrop.classList.add("is-open");
      paletteInput?.focus({ preventScroll: true });
    });
  }

  function closePalette() {
    if (!paletteBackdrop || paletteBackdrop.classList.contains("hidden")) return;
    paletteBackdrop.classList.remove("is-open");
    paletteBackdrop.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      paletteBackdrop.classList.add("hidden");
      lastFocusedElement?.focus?.({ preventScroll: true });
    }, reducedMotion.matches ? 1 : 220);
  }

  $("#commandOpen")?.addEventListener("click", openPalette);
  $("#paletteClose")?.addEventListener("click", closePalette);

  paletteBackdrop?.addEventListener("click", event => {
    if (event.target === paletteBackdrop) closePalette();
  });

  paletteInput?.addEventListener("input", () => {
    const query = paletteInput.value.trim().toLowerCase();
    $$(".palette-option").forEach(option => {
      option.classList.toggle("hidden", !option.textContent.toLowerCase().includes(query));
    });
    highlightPaletteOption(0);
  });

  const paletteActions = {
    review: () => reviewButton?.click(),
    evidence: () => {
      const flaggedIdx = reviewData.findIndex(r => r.signals > 0);
      if (flaggedIdx !== -1) renderReview(flaggedIdx);
      $("#findings")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    queue: () => $("#pull-requests")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    timeline: () => $("#timeline")?.scrollIntoView({ behavior: "smooth", block: "center" }),
    details: openDossier,
    sync: () => loadLivePullRequests(true),
    theme: () => themeBtn?.click()
  };

  $$(".palette-option").forEach(option => {
    option.addEventListener("click", () => {
      closePalette();
      paletteActions[option.dataset.action]?.();
    });
  });

  /* ─────────────────────── Global Keyboard Shortcuts & Focus Trap ─────────────────────── */
  document.addEventListener("keydown", event => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    const paletteOpen = paletteBackdrop && !paletteBackdrop.classList.contains("hidden");
    const dossierOpen = dossierBackdrop && !dossierBackdrop.classList.contains("hidden");

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (paletteOpen) closePalette();
      else openPalette();
      return;
    }

    if (event.key === "Escape") {
      if (paletteOpen) {
        closePalette();
        return;
      }
      if (dossierOpen) {
        closeDossier();
        return;
      }
    }

    if (paletteOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        highlightPaletteOption(activePaletteIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlightPaletteOption(activePaletteIndex - 1);
      } else if (event.key === "Enter") {
        const visible = getVisiblePaletteOptions();
        if (visible[activePaletteIndex]) {
          event.preventDefault();
          visible[activePaletteIndex].click();
        }
      }
      return;
    }

    if (!isTyping && !event.ctrlKey && !event.metaKey && !event.altKey && !dossierOpen) {
      const key = event.key.toLowerCase();
      if (key === "r") reviewButton?.click();
      else if (key === "q") $("#pull-requests")?.scrollIntoView({ behavior: "smooth" });
      else if (key === "e") paletteActions.evidence();
      else if (key === "t") $("#timeline")?.scrollIntoView({ behavior: "smooth" });
      else if (key === "d") openDossier();
      else if (key === "m") themeBtn?.click();
    }

    if (event.key === "Tab" && dossierOpen && dossierModal) {
      const focusable = $$(
        "button, a[href], input, [tabindex]:not([tabindex='-1'])",
        dossierModal
      ).filter(el => !el.disabled && el.offsetParent !== null);

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

  $("#profileSwitch")?.addEventListener("click", () => {
    showToast("Sentinel Lead Maintainer · Shortcuts: R (Review), E (Diffs), D (Dossier), M (Theme).");
  });

  /* ─────────────────────── Scroll Spy Navigation & Breadcrumb Sync ─────────────────────── */
  if ("IntersectionObserver" in window) {
    const sectionTitles = {
      overview: "Command center",
      "pull-requests": "Pull requests",
      findings: "Evidence & diffs",
      analytics: "Analytics & rules",
      "repositories-section": "Repositories",
      timeline: "Flight recorder",
      quality: "Quality signals"
    };

    const sections = Object.keys(sectionTitles)
      .map(id => document.getElementById(id))
      .filter(Boolean);

    const navObserver = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;
      const id = visible.target.id;

      $$(".nav-link").forEach(link => {
        link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
      });
      if (sectionTitles[id]) {
        safeText("#breadcrumbSection", sectionTitles[id]);
      }
    }, { rootMargin: "-15% 0px -60% 0px", threshold: [0, 0.15, 0.35] });

    sections.forEach(section => navObserver.observe(section));
  }

  /* ─────────────────────── Hero Illustration Pointer Tilt ─────────────────────── */
  const illustration = $(".hero-illustration");
  if (illustration && !reducedMotion.matches && window.matchMedia("(pointer: fine)").matches) {
    illustration.addEventListener("pointermove", event => {
      const bounds = illustration.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      illustration.style.setProperty("--tilt-x", `${-y * 2}deg`);
      illustration.style.setProperty("--tilt-y", `${x * 2}deg`);
    });
    illustration.addEventListener("pointerleave", () => {
      illustration.style.setProperty("--tilt-x", "0deg");
      illustration.style.setProperty("--tilt-y", "0deg");
    });
  }

  /* ─────────────────────── Initial Render & Startup Sync ─────────────────────── */
  // Default to a curated sample dossier on initial load so the user immediately sees illustrative findings & diff examples,
  // while keeping PR #1, #18, and #42 one click away in the queue!
  selectedReview = 1;
  renderReview(selectedReview);
  renderTopMetrics();
  loadLivePullRequests(false);
})();
