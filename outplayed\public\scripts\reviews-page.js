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
      ? '<img data-review-avatar data-avatar-fallback="' + escapeHtml(initials(name)) + '" src="' + escapeHtml(avatarUrl) + '" alt="" loading="lazy" decoding="async">'
      : escapeHtml(initials(name));
    var rating = review && review.rating == null ? 5 : review.rating;
    var images = review && Array.isArray(review.images) ? review.images : [];
    var media = images.filter(function (url) { return typeof url === "string" && /^https:\/\//i.test(url); })
      .map(function (url, index) {
        var safeUrl = escapeHtml(url);
        return '<a class="reviews-media-link" href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" aria-label="Open review image ' + (index + 1) + '"><img data-review-image src="' + safeUrl + '" alt="Image attached to review by ' + escapeHtml(name) + '" loading="lazy" decoding="async"></a>';
      }).join("");
    return '<article class="reviews-card">' +
      '<header class="reviews-card-header">' +
        '<div class="reviews-avatar">' + avatar + '</div>' +
        '<div class="reviews-author"><strong>' + escapeHtml(name) + '</strong><span>' + escapeHtml(relativeDate(review)) + '</span></div>' +
      '</header>' +
      '<div class="reviews-stars" role="img" aria-label="' + escapeHtml(String(rating || 5)) + ' out of 5 stars">' + renderStars(rating) + '</div>' +
      '<p class="reviews-message">' + escapeHtml(getMessage(review)) + '</p>' +
      (media ? '<div class="reviews-media">' + media + '</div>' : '') +
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
      '<div class="reviews-main">' +
        '<section class="reviews-intro" aria-labelledby="reviews-title">' +
          '<div><p class="reviews-kicker">OUR REVIEWS</p><h1 id="reviews-title">Customer Vouches</h1><p class="reviews-description">Discover what our customers have to say about their experience with us.</p></div>' +
        '</section>' +
        '<section aria-label="Customer vouches"><div class="reviews-grid">' + reviewListMarkup(reviews, loading, error) + '</div></section>' +
      '</div>' +
    '</div>';
  }
  function setPageMetadata() {
    document.title = "Outplayed - Reviews";
    var description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", "Discover what Outplayed customers have to say about their experience with us.");
  }

  function renderReviewsPage(reviews, loading, error) {
    if (!isReviewsPath()) return;
    var root = document.getElementById("reviews-root");
    if (!root) return;
    if (!root.querySelector("[data-reviews-page]")) {
      root.innerHTML = reviewsPageMarkup(reviews, loading, error);
    }
    else {
      var app = root.querySelector("[data-reviews-page]");
      var current = app.querySelector(".reviews-grid");
      if (current) current.innerHTML = reviewListMarkup(reviews, loading, error);
    }
    setPageMetadata();
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
    document.addEventListener("error", function (event) {
      var image = event.target;
      if (!image || !image.matches) return;
      if (image.matches("img[data-review-avatar]")) {
        var avatar = image.closest(".reviews-avatar");
        if (avatar && avatar.contains(image)) {
          var fallback = document.createTextNode(image.dataset.avatarFallback || "V");
          image.replaceWith(fallback);
        }
        return;
      }
      if (!image.matches("img[data-review-image]")) return;
      var root = document.getElementById("reviews-root");
      if (!root) return;
      if (root.dataset.imageRefreshDone === "true") {
        var failedLink = image.closest(".reviews-media-link");
        if (failedLink) failedLink.hidden = true;
        return;
      }
      if (root.dataset.imageRefreshing === "true") return;
      root.dataset.imageRefreshing = "true";
      fetch(API_PATH + "?refreshImages=1", { headers: { Accept: "application/json" }, cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("Fresh review images request failed");
          return response.json();
        })
        .then(function (payload) {
          var reviews = payload && payload.data && Array.isArray(payload.data.reviews) ? payload.data.reviews : [];
          reviews.sort(function (a, b) { return getDate(b) - getDate(a); });
          root.dataset.imageRefreshDone = "true";
          lastRenderedReviews = reviews;
          renderReviewsPage(reviews, false, false);
        })
        .catch(function () {
          root.dataset.imageRefreshDone = "true";
          var failedLink = image.closest(".reviews-media-link");
          if (failedLink) failedLink.hidden = true;
        })
        .finally(function () { delete root.dataset.imageRefreshing; });
    }, true);
    var observer = new MutationObserver(function () {
      if (isReviewsPath()) {
        if (!document.querySelector("[data-reviews-page]")) renderReviewsPage(lastRenderedReviews || [], !lastRenderedReviews, false);
      } else {
        patchExistingNavigation();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", updateRoute);
    installHistoryListeners();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
