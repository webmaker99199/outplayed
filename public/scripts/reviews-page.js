(function () {
  "use strict";

  var REVIEW_PATH = "/reviews";
  var API_PATH = "/api/outplayed/reviews";
  var lastRenderedReviews = null;
  var observerStarted = false;

  function isReviewsPath() {
    return window.location.pathname.replace(/\/+$/, "") === REVIEW_PATH;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getName(review) {
    return String(review && review.author && review.author.name || "Verified Customer").trim() || "Verified Customer";
  }

  function getMessage(review) {
    return String(review && (review.message || review.feedback || review.comment) || "").trim() || "A great experience from start to finish.";
  }

  function getDate(review) {
    var raw = review && (review.createdAt || review.created_at || review.date);
    var parsed = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function relativeDate(value) {
    var timestamp = getDate(value);
    if (!timestamp) return "Recently";
    var seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
    var units = [
      [31536000, "year"],
      [2592000, "month"],
      [604800, "week"],
      [86400, "day"],
      [3600, "hour"],
      [60, "minute"]
    ];
    for (var i = 0; i < units.length; i += 1) {
      if (seconds >= units[i][0]) {
        var amount = Math.floor(seconds / units[i][0]);
        return amount + " " + units[i][1] + (amount === 1 ? "" : "s") + " ago";
      }
    }
    return "Just now";
  }

  function initials(name) {
    var parts = name.split(/\s+/).filter(Boolean);
    return (parts[0] || "V").charAt(0) + (parts[1] || "").charAt(0);
  }

  function starIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.122 2.122 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.123 2.123 0 0 0 1.597-1.16z" /></svg>';
  }

  function renderStars(rating) {
    var count = Number(rating);
    count = Number.isFinite(count) && count >= 0 ? Math.min(5, Math.round(count)) : 5;
    return Array.from({ length: 5 }, function (_, index) {
      return '<span class="reviews-star' + (index < count ? "" : " reviews-star-empty") + '">' + starIcon() + '</span>';
    }).join("");
  }

  function renderReviewCard(review) {
    var name = getName(review);
    var avatarUrl = review && review.author && review.author.avatarUrl;
    var avatar = avatarUrl
      ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" loading="lazy" decoding="async">'
      : escapeHtml(initials(name));
    var rating = review && review.rating == null ? 5 : review.rating;
    return '<article class="reviews-card">' +
      '<header class="reviews-card-header">' +
        '<div class="reviews-avatar">' + avatar + '</div>' +
        '<div class="reviews-author"><strong>' + escapeHtml(name) + '</strong><span>' + escapeHtml(relativeDate(review)) + '</span></div>' +
      '</header>' +
      '<div class="reviews-stars" role="img" aria-label="' + escapeHtml(String(rating || 5)) + ' out of 5 stars">' + renderStars(rating) + '</div>' +
      '<p class="reviews-message">' + escapeHtml(getMessage(review)) + '</p>' +
    '</article>';
  }

  function reviewListMarkup(reviews, loading, error) {
    if (loading) return '<div class="reviews-state">Loading the latest customer vouches…</div>';
    if (error) return '<div class="reviews-state">We could not load the reviews right now. Please try again shortly.</div>';
    if (!reviews.length) return '<div class="reviews-state">No customer vouches yet.</div>';
    return reviews.map(renderReviewCard).join("");
  }

  function reviewsPageMarkup(reviews, loading, error) {
    return '<div class="reviews-app" data-reviews-page="true">' +
      '<div aria-hidden="true" class="bs-glow-layer"><div class="absolute -top-48 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(197,151,241,0.18),transparent_70%)] blur-3xl"></div><div class="absolute -top-40 left-[-120px] h-[420px] w-[420px] rounded-full" style="background-image: radial-gradient(circle at 30% 30%, rgba(126, 63, 219, 0.24), transparent 60%);"></div><div class="absolute -bottom-44 right-[-160px] h-[520px] w-[520px] rounded-full" style="background-image: radial-gradient(circle, rgba(197, 151, 241, 0.22), transparent 60%);"></div><div class="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(197,151,241,0.12),transparent_55%)]"></div><div class="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,10,25,0)_0%,rgba(10,10,25,0.35)_65%,rgba(10,10,25,0.7)_100%)]"></div><div class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(126,63,219,0.12),transparent_55%)]"></div><div class="absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(197,151,241,0.22)_1px,transparent_1px)] [background-size:28px_28px]"></div></div>' +
      '<header class="reviews-site-header sticky top-0 z-50 border-b border-white/10 bg-[#0a0a19]/95 backdrop-blur-none pt-[env(safe-area-inset-top)] transform-gpu sm:bg-[#0a0a19]/80 sm:backdrop-blur-xl">' +
        '<div class="reviews-nav-shell mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between py-2 sm:py-3">' +
          '<a class="reviews-brand flex items-center gap-2 text-left" href="/" aria-label="Outplayed home">' +
            '<img class="h-10 w-10 rounded-xl object-contain" src="/images/logo.png" alt="Outplayed logo">' +
            '<span class="reviews-brand-copy"><span class="reviews-brand-name text-[13px] font-semibold text-white sm:text-sm">Outplayed</span><span class="reviews-brand-caption hidden text-[11px] text-white/60 sm:block">Digital Products</span></span>' +
          '</a>' +
          '<nav class="reviews-nav hidden lg:flex gap-1" aria-label="Primary navigation">' +
            '<a class="rounded-xl px-3 py-2 text-sm font-medium transition" href="/">Home</a><a class="rounded-xl px-3 py-2 text-sm font-medium transition text-white/70 hover:bg-white/5 hover:text-white" href="/products">Products</a><a class="rounded-xl px-3 py-2 text-sm font-medium transition text-white/70 hover:bg-white/5 hover:text-white" href="/status">Status</a><a class="rounded-xl px-3 py-2 text-sm font-medium transition bg-white/10 text-white" href="/reviews" aria-current="page">Reviews</a>' +
          '</nav>' +
          '<div class="reviews-header-actions flex items-center gap-1.5 sm:gap-2">' +
            '<a class="reviews-discord-mobile relative rounded-xl border border-white/10 bg-white/5 p-2 text-white/80 transition hover:bg-white/10 lg:hidden" href="/discord" aria-label="Discord"><svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371 13.2832 13.2832 0 00-.6086 1.2488 18.9888 18.9888 0 00-.6177-1.2488.077.077 0 00-.0785-.0371 19.7368 19.7368 0 00-4.8852 1.5152.0699.0699 0 00-.0321.0277C.5334 9.0458-.3193 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561 19.9 19.9 0 005.9937 3.0375.0777.0777 0 00.0842-.0276 14.0275 14.0275 0 001.2242-1.9948.076.076 0 00-.0416-.1057 13.1072 13.1072 0 01-1.8722-.8928.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7937 8.18 1.7937 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1971.3729.2914a.077.077 0 01-.0066.1277 12.299 12.299 0 01-1.873.8928.0766.0766 0 00-.0407.1067 13.152 13.152 0 001.2242 1.9948.076.076 0 00.0842.0286 19.838 19.838 0 005.9937-3.0375.077.077 0 00.0312-.0561c.5-5.177-.8383-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0276zM8.02 15.3312c-1.183 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.419-2.1569 2.419zm7.975 0c-1.183 0-2.157-1.0857-2.157-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z"/></svg></a>' +
            '<button type="button" class="reviews-cart-button relative rounded-xl border border-white/10 bg-white/5 p-2 text-white/80 transition hover:bg-white/10" aria-label="Open cart"><svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg></button>' +
            '<div class="reviews-desktop-actions hidden items-center gap-2 lg:flex"><a class="reviews-discord inline-flex items-center justify-center gap-2 rounded-2xl border border-[rgba(126,63,219,0.35)] bg-[rgba(126,63,219,0.08)] px-4 py-2.5 text-sm font-semibold text-white/90 transition hover:border-[rgba(197,151,241,0.6)] hover:bg-[rgba(126,63,219,0.18)]" href="/discord">Discord</a><a class="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-sm transition hover:shadow-md" href="/products">Shop Now</a></div>' +
            '<button type="button" class="reviews-menu-button relative rounded-xl border border-white/10 bg-white/5 p-2 text-white/80 transition hover:bg-white/10 lg:hidden" aria-label="Open menu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true" class="reviews-menu-open h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16M4 12h16M4 19h16"/></svg><svg viewBox="0 0 24 24" aria-hidden="true" class="reviews-menu-close h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>' +
          '</div>' +
        '</div>' +
        '<div class="reviews-mobile-menu hidden lg:hidden"><a href="/">Home</a><a href="/products">Products</a><a href="/status">Status</a><a href="/reviews" aria-current="page">Reviews</a><a href="/products">Shop Now</a></div>' +
      '</header>' +
      '<main class="reviews-main" id="main-content">' +
        '<section class="reviews-intro" aria-labelledby="reviews-title">' +
          '<div class="reviews-intro-copy"><p class="reviews-kicker">OUR REVIEWS</p><h1 id="reviews-title">Customer Vouches</h1><p class="reviews-description">Discover what our customers have to say about their experience with us.</p></div>' +
        '</section>' +
        '<section aria-label="Customer vouches"><div class="reviews-grid">' + reviewListMarkup(reviews, loading, error) + '</div></section>' +
      '</main>' +
      '<footer class="reviews-site-footer"><div class="reviews-site-footer-inner"><span>© 2025 Outplayed. All rights reserved.</span><a href="/">Back to home</a></div></footer>' +
    '</div>';
  }

  function setPageMetadata() {
    document.title = "Outplayed - Reviews";
    var description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", "Discover what Outplayed customers have to say about their experience with us.");
  }

  function renderReviewsPage(reviews, loading, error) {
    if (!isReviewsPath()) return;
    var root = document.getElementById("root");
    if (!root) return;
    if (!root.querySelector("[data-reviews-page]")) {
      root.innerHTML = reviewsPageMarkup(reviews, loading, error);
      var menuButton = root.querySelector(".reviews-menu-button");
      var mobileMenu = root.querySelector(".reviews-mobile-menu");
      if (menuButton && mobileMenu) {
        menuButton.addEventListener("click", function () {
          var open = menuButton.getAttribute("aria-expanded") === "true";
          menuButton.setAttribute("aria-expanded", String(!open));
          menuButton.setAttribute("aria-label", open ? "Open menu" : "Close menu");
          mobileMenu.classList.toggle("hidden", open);
          menuButton.classList.toggle("is-open", !open);
        });
      }
    }
    else {
      var app = root.querySelector("[data-reviews-page]");
      var current = app.querySelector(".reviews-grid");
      if (current) current.innerHTML = reviewListMarkup(reviews, loading, error);
    }
  }

  function patchExistingNavigation() {
    document.querySelectorAll('a[href="/showcase"]').forEach(function (showcaseLink) {
      var parent = showcaseLink.parentElement;
      if (!parent || parent.querySelector('a[href="/reviews"]')) return;
      var reviewsLink = showcaseLink.cloneNode(true);
      reviewsLink.href = REVIEW_PATH;
      reviewsLink.textContent = "Reviews";
      reviewsLink.removeAttribute("aria-current");
      parent.insertBefore(reviewsLink, showcaseLink.nextSibling);
    });
  }

  function startReviewsRoute() {
    setPageMetadata();
    renderReviewsPage([], true, false);
    fetch(API_PATH, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("Reviews request failed");
        return response.json();
      })
      .then(function (payload) {
        var reviews = payload && payload.data && Array.isArray(payload.data.reviews) ? payload.data.reviews : [];
        reviews.sort(function (a, b) { return getDate(b) - getDate(a); });
        lastRenderedReviews = reviews;
        renderReviewsPage(reviews, false, false);
      })
      .catch(function () {
        renderReviewsPage(lastRenderedReviews || [], false, true);
      });
  }

  function updateRoute() {
    if (isReviewsPath()) {
      startReviewsRoute();
    } else {
      lastRenderedReviews = null;
      patchExistingNavigation();
    }
  }

  function handleReviewsNavigation(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href="/reviews"]') : null;
    if (!link || link.target === "_blank" || link.hasAttribute("download") || isReviewsPath()) return;
    event.preventDefault();
    event.stopPropagation();
    window.history.pushState({}, "", REVIEW_PATH);
    updateRoute();
  }

  function installHistoryListeners() {
    if (window.__outplayedReviewsHistoryPatched) return;
    window.__outplayedReviewsHistoryPatched = true;
    ["pushState", "replaceState"].forEach(function (method) {
      var original = window.history[method];
      window.history[method] = function () {
        var result = original.apply(this, arguments);
        window.setTimeout(updateRoute, 0);
        return result;
      };
    });
  }

  function boot() {
    updateRoute();
    if (observerStarted) return;
    observerStarted = true;
    var observer = new MutationObserver(function () {
      if (isReviewsPath()) {
        if (!document.querySelector("[data-reviews-page]")) renderReviewsPage(lastRenderedReviews || [], !lastRenderedReviews, false);
      } else {
        patchExistingNavigation();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", updateRoute);
    document.addEventListener("click", handleReviewsNavigation, true);
    installHistoryListeners();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
