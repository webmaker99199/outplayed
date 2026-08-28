(function() {
  function initProductCarousel() {
    if (!window.location.pathname.startsWith('/products/')) return;
    // The app renders asynchronously on a hard refresh. Never use a broad image
    // fallback here: it can accidentally select and replace the header logo.
    const main = document.querySelector('main');
    if (!main) return;
    const pathParts = window.location.pathname.split('/');
    const slug = decodeURIComponent(pathParts[pathParts.length - 1] || '');
    if (!slug) return;

    // Check if already initialized for this slug
    const existing = document.getElementById('sellauth-carousel-container');
    if (existing && existing.dataset.slug === slug) return;

    // Fetch all products to find matching product
    fetch('/api/outplayed/products')
      .then(res => res.json())
      .then(data => {
        const products = data?.data?.products || [];
        const product = products.find(p => {
          const pId = String(p.id);
          const pPath = String(p.path || '');
          const pNameSlug = String(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          return pId === slug || pPath === slug || pNameSlug === slug.toLowerCase() || slug.toLowerCase().includes(pPath);
        });

        const images = Array.isArray(product?.images) ? product.images.filter(Boolean) : [];
        let showcasePlan = (Array.isArray(product?.plans) ? product.plans : []).find(plan => /showcase/i.test(String(plan?.name || plan?.title || plan?.label || '')));
        const streamableId = findStreamableId(showcasePlan) || findStreamableId(product);
        if (!product || (!images.length && !streamableId)) return;

        // Find image container or img element in main content
        const targetImg = main.querySelector('img');
        if (!targetImg || targetImg.closest('header, nav')) return;

        const imgContainer = targetImg.closest('.relative') || targetImg.parentElement;
        if (!imgContainer || !main.contains(imgContainer) || imgContainer.closest('header, nav')) return;

        let carouselWrap = document.getElementById('sellauth-carousel-container');
        if (!carouselWrap) {
          carouselWrap = document.createElement('div');
          carouselWrap.id = 'sellauth-carousel-container';
          carouselWrap.dataset.slug = slug;
          // Replace only a product image container that belongs to main.
          imgContainer.replaceWith(carouselWrap);
        }

        const mediaCount = images.length + (streamableId ? 1 : 0);
        let currentIndex = 0;

        function findStreamableId(value) {
          const fields = [value?.description, value?.streamableId, value?.streamable, value?.video, value?.videoUrl, value?.metadata?.description, value?.data?.description];
          for (const field of fields) {
            const match = String(field || '').match(/(?:https?:\/\/)?(?:www\.)?streamable\.com\/(?:[eo]\/)?([A-Za-z0-9]{4,})/i);
            if (match) return match[1];
            if (/^[A-Za-z0-9]{4,}$/.test(String(field || '').trim()) && field !== value?.description) return String(field).trim();
          }
          return null;
        }

        function renderCarousel() {
          const showingVideo = Boolean(streamableId && currentIndex === images.length);
          const currentMedia = showingVideo
            ? `<iframe src="https://streamable.com/e/${streamableId}" title="${product.name || 'Product'} video" allow="autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen frameborder="0" style="display: block; width: 100%; height: 100%; border: 0; border-radius: 1rem;"></iframe>`
            : `<img src="${images[currentIndex]}" alt="${product.name || 'Product Image'} - Photo ${currentIndex + 1}" style="display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; object-position: center; border-radius: 1rem;" />`;
          carouselWrap.className = 'relative w-full';
          carouselWrap.innerHTML = `
            <div style="position: relative; width: 100%; aspect-ratio: 16/10; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.4); user-select: none;">
              ${currentMedia}
              
              <button id="carousel-prev" aria-label="Previous image" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.8); color: white; padding: 12px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.25); cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 30; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              
              <button id="carousel-next" aria-label="Next image" style="position: absolute; right: 16px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.8); color: white; padding: 12px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.25); cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 30; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
              
              <div style="position: absolute; top: 16px; right: 16px; background: rgba(0,0,0,0.85); padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.95); border: 1px solid rgba(255,255,255,0.2); z-index: 30;">
                ${currentIndex + 1} / ${mediaCount}
              </div>
            </div>

            <div style="padding-top: 16px; display: flex; gap: 10px; overflow-x: auto;">
              ${images.map((img, idx) => `
                <button data-index="${idx}" aria-label="View image ${idx + 1}" style="position: relative; height: 64px; width: 80px; flex-shrink: 0; border-radius: 12px; overflow: hidden; border: 2px solid ${idx === currentIndex ? '#a855f7' : 'rgba(255,255,255,0.2)'}; opacity: ${idx === currentIndex ? '1' : '0.6'}; cursor: pointer; transition: all 0.2s;" class="thumbnail-btn">
                  <img src="${img}" alt="Thumbnail ${idx + 1}" style="height: 100%; width: 100%; object-fit: cover; border-radius: 10px;" />
                </button>
              `).join('')}
              ${streamableId ? `<button data-index="${images.length}" aria-label="View product video" style="position: relative; height: 64px; width: 80px; flex-shrink: 0; border-radius: 12px; overflow: hidden; border: 2px solid ${currentIndex === images.length ? '#a855f7' : 'rgba(255,255,255,0.2)'}; opacity: ${currentIndex === images.length ? '1' : '0.6'}; cursor: pointer; background: #171021; color: white; font-size: 12px; font-weight: 600;" class="thumbnail-btn">▶ Video</button>` : ''}
            </div>
          `;

          const prevBtn = carouselWrap.querySelector('#carousel-prev');
          const nextBtn = carouselWrap.querySelector('#carousel-next');

          if (prevBtn) {
            prevBtn.onclick = (e) => {
              e.preventDefault();
              currentIndex = (currentIndex - 1 + mediaCount) % mediaCount;
              renderCarousel();
            };
          }

          if (nextBtn) {
            nextBtn.onclick = (e) => {
              e.preventDefault();
              currentIndex = (currentIndex + 1) % mediaCount;
              renderCarousel();
            };
          }

          carouselWrap.querySelectorAll('.thumbnail-btn').forEach(btn => {
            btn.onclick = (e) => {
              e.preventDefault();
              currentIndex = Number(btn.dataset.index);
              renderCarousel();
            };
          });
        }

        renderCarousel();
      })
      .catch(err => console.error("Failed to load products for carousel:", err));
  }

  // Keyboard arrow navigation
  window.addEventListener('keydown', (e) => {
    if (!window.location.pathname.startsWith('/products/')) return;
    const carouselWrap = document.getElementById('sellauth-carousel-container');
    if (!carouselWrap) return;
    const nextBtn = carouselWrap.querySelector('#carousel-next');
    const prevBtn = carouselWrap.querySelector('#carousel-prev');
    if (e.key === 'ArrowRight' && nextBtn) {
      nextBtn.click();
    } else if (e.key === 'ArrowLeft' && prevBtn) {
      prevBtn.click();
    }
  });

  // Observe route and DOM changes
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(initProductCarousel, 400);
    }
  }, 250);

  window.addEventListener('DOMContentLoaded', () => setTimeout(initProductCarousel, 500));
  window.addEventListener('popstate', () => setTimeout(initProductCarousel, 400));
  // Wait for the product route to finish mounting before querying its image.
  setTimeout(initProductCarousel, 1000);
})();
