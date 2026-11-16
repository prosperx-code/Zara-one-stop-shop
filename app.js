// ============================================================
// Zara One Stop Shop — Core Application Logic
// Load order on every page: supabase script -> config.js -> app.js
// ============================================================

const FALLBACK_IMG =
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80';

// ------------------------------------------------------------
// Safe helpers (stop injected HTML / bad links from running)
// ------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow normal web images (blocks javascript: links and similar)
function safeImgUrl(url) {
  const s = String(url || '');
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s)) return s;
  return FALLBACK_IMG;
}

function safeJsonParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

// ------------------------------------------------------------
// Supabase client (public key only — never put a secret key here)
// ------------------------------------------------------------
const supabaseClient =
  typeof supabase !== 'undefined' &&
  typeof SUPABASE_URL !== 'undefined' &&
  SUPABASE_URL &&
  !SUPABASE_URL.includes('YOUR_PROJECT')
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

window.AppState = {
  products: [],
  cart: safeJsonParse('zara_cart', []),
  user: null, // filled from the Supabase session by initAuth()
  isAdmin: false,
  supabaseReady: !!supabaseClient
};

// Clean up a cart that was damaged or edited by hand
AppState.cart = (Array.isArray(AppState.cart) ? AppState.cart : []).filter(
  (i) => i && Number.isInteger(i.id) && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 99
);

// ------------------------------------------------------------
// Product loading (one shared request, even if several scripts ask)
// ------------------------------------------------------------
let productsPromise = null;

function loadProducts(force = false) {
  if (!productsPromise || force) productsPromise = fetchProducts();
  return productsPromise;
}

async function fetchProducts() {
  if (!supabaseClient) {
    AppState.products = [];
    return;
  }
  try {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    AppState.products = (data || []).map((row) => ({
      id: Number(row.id),
      name: String(row.name || ''),
      category: String(row.category || ''),
      oldPrice: row.old_price == null ? null : Number(row.old_price),
      newPrice: Number(row.new_price),
      tag: row.tag || 'None',
      img: safeImgUrl(row.img)
    }));
  } catch (err) {
    console.warn('Could not load products:', err.message);
    AppState.products = [];
    showToast('Could not load products. Please refresh the page.', 'error');
  }
}

// Shimmering placeholder cards shown while products load
function skeletonCards(n = 4) {
  return Array.from({ length: n }, (_, i) => `
    <div class="skeleton-card" style="--i:${i}">
      <div class="sk sk-img"></div>
      <div class="sk sk-line" style="width:75%; margin:16px 16px 8px;"></div>
      <div class="sk sk-line" style="width:40%; margin:0 16px 18px;"></div>
    </div>`).join('');
}

// One product card, used by the home, shop and product pages
function renderProductCard(p, i = 0) {
  const id = Number(p.id);
  const delay = Math.min(Number(i) || 0, 12);
  const badge =
    p.tag && p.tag !== 'None' ? `<span class="badge">${escapeHtml(p.tag)}</span>` : '';
  const action =
    p.tag === 'Sold Out'
      ? `<button class="btn-primary btn-disabled" disabled>Sold Out</button>`
      : `<button class="btn-primary" style="padding:9px 14px; font-size:0.9rem;" onclick="addToSelection(${id})">Add to selection</button>`;
  const old = p.oldPrice
    ? `<span class="price-old">₦${Number(p.oldPrice).toLocaleString()}</span>`
    : '';

  return `
    <div class="product-card" style="--i:${delay}">
      ${badge}
      <img src="${escapeHtml(safeImgUrl(p.img))}" alt="${escapeHtml(p.name)}" loading="lazy"
           onclick="location.href='product.html?id=${id}'" style="cursor:pointer;">
      <h3>${escapeHtml(p.name)}</h3>
      <div class="card-footer">
        <div>${old}<span class="price-tag">₦${Number(p.newPrice).toLocaleString()}</span></div>
        ${action}
      </div>
    </div>`;
}

// ------------------------------------------------------------
// Cart helpers
// ------------------------------------------------------------
function flashAddedButton(btn) {
  if (!btn || btn.disabled) return;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.classList.add('added');
  btn.textContent = '✓ Added';
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => {
    btn.classList.remove('added');
    btn.textContent = btn.dataset.label;
  }, 1200);
}

function addToSelection(productId, quantity = 1) {
  const targetId = parseInt(productId, 10);
  let qtyNum = parseInt(quantity, 10);
  if (!Number.isFinite(qtyNum) || qtyNum < 1) qtyNum = 1;

  const product = AppState.products.find((p) => p.id === targetId);

  if (!product) {
    showToast('Product not found.', 'error');
    return;
  }
  if (product.tag === 'Sold Out') {
    showToast('This item is currently out of stock.');
    return;
  }

  const existing = AppState.cart.find((item) => item.id === targetId);
  if (existing) {
    existing.qty = Math.min(99, existing.qty + qtyNum);
  } else {
    AppState.cart.push({ id: targetId, qty: Math.min(99, qtyNum) });
  }

  saveSelectionCartState();

  // Button feedback: the clicked button turns green for a moment
  const evt = window.event;
  if (evt && evt.currentTarget instanceof HTMLElement) flashAddedButton(evt.currentTarget);

  showToast(`${product.name} added to selection.`);
}

function removeFromSelection(productId) {
  const targetId = parseInt(productId, 10);
  AppState.cart = AppState.cart.filter((item) => item.id !== targetId);
  saveSelectionCartState();

  if (typeof renderCartPage === 'function') renderCartPage();
  showToast('Item removed from selection.');
}

function updateSelectionQty(productId, newQty) {
  const targetId = parseInt(productId, 10);
  const count = parseInt(newQty, 10);
  if (!Number.isFinite(count) || count < 1 || count > 99) {
    if (typeof renderCartPage === 'function') renderCartPage();
    return;
  }

  const item = AppState.cart.find((i) => i.id === targetId);
  if (item) {
    item.qty = count;
    saveSelectionCartState();
    if (typeof renderCartPage === 'function') renderCartPage();
  }
}

function saveSelectionCartState() {
  localStorage.setItem('zara_cart', JSON.stringify(AppState.cart));
  updateCartCounter();
}

let lastCartTotal = null;

function updateCartCounter() {
  const nodes = document.querySelectorAll('.cart-counter-node');
  const total = AppState.cart.reduce((sum, current) => sum + current.qty, 0);
  nodes.forEach((n) => (n.textContent = total));

  // Little "pop" on the cart badge when something is added
  if (lastCartTotal !== null && total > lastCartTotal) {
    document.querySelectorAll('.cart-counter-node, .header-cart').forEach((n) => {
      n.classList.remove('bump');
      void n.offsetWidth; // restart the animation
      n.classList.add('bump');
    });
  }
  lastCartTotal = total;
}

// ------------------------------------------------------------
// Toast notifications
// ------------------------------------------------------------
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-notification-hub');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-notification-hub';
    container.className = 'toast-hub';
    document.body.appendChild(container);
  }

  const box = document.createElement('div');
  box.className = 'toast';
  box.style.background = type === 'error' ? 'var(--clay)' : type === 'success' ? '#0d9488' : 'var(--teal)';
  box.textContent = message;
  container.appendChild(box);

  setTimeout(() => {
    box.style.opacity = '0';
    box.style.transform = 'translateY(12px)';
    box.style.transition = 'all 0.35s ease';
    setTimeout(() => box.remove(), 350);
  }, 3400);
}

// ------------------------------------------------------------
// Customer accounts (real Supabase sign-in) + admin shortcut
// ------------------------------------------------------------
function userFromSession(session) {
  if (!session || !session.user) return null;
  const meta = session.user.user_metadata || {};
  return {
    id: session.user.id,
    email: session.user.email || '',
    name: String(meta.name || ''),
    phone: String(meta.phone || '')
  };
}

// Asks the database if the signed-in person is an admin (admins see an Admin link)
async function refreshAdminFlag() {
  if (!supabaseClient || !AppState.user) {
    AppState.isAdmin = false;
    renderProfileNavigationAnchors();
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc('is_admin');
    AppState.isAdmin = !error && data === true;
  } catch (e) {
    AppState.isAdmin = false;
  }
  renderProfileNavigationAnchors();
}

async function initAuth() {
  if (!supabaseClient) return;
  try {
    const {
      data: { session }
    } = await supabaseClient.auth.getSession();
    AppState.user = userFromSession(session);
  } catch (e) {
    AppState.user = null;
  }
  renderProfileNavigationAnchors();
  await refreshAdminFlag();

  // Keep the menu in sync when someone signs in or out (also in other tabs)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    AppState.user = userFromSession(session);
    renderProfileNavigationAnchors();
    // Run the admin check right after this callback, not inside it
    setTimeout(refreshAdminFlag, 0);
  });
}

function setMobileAccountLink(el, href, label) {
  if (!el) return;
  el.href = href;
  el.innerHTML = `<span>👤</span><span>${label}</span>`;
}

function renderProfileNavigationAnchors() {
  const anchor = document.getElementById('profile-nav-anchor');
  const mobile = document.getElementById('mobile-account-link');
  const mobileNav = document.querySelector('.mobile-nav');

  const adminLink = AppState.isAdmin
    ? `<a href="admin.html" style="font-weight:600; color:var(--marigold); margin-right:14px;">⚙️ Admin</a>`
    : '';

  if (AppState.user) {
    const label = AppState.user.name || AppState.user.email.split('@')[0] || 'there';
    const first = escapeHtml(label.split(' ')[0]);
    if (anchor) {
      anchor.innerHTML = `
        ${adminLink}
        <a href="account.html" style="font-weight:600; color:var(--marigold);">Hi, ${first}</a>
        <a href="#" onclick="processAccountLogOut(); return false;" style="font-size:0.9rem; opacity:0.85; margin-left:12px;">Sign out</a>`;
    }
    setMobileAccountLink(mobile, 'account.html', 'Account');
  } else {
    if (anchor) {
      anchor.innerHTML = `
        <a href="signin.html">Sign In</a>
        <a href="register.html" class="btn-secondary" style="padding:6px 14px; font-size:0.85rem; margin-left:12px;">Register</a>`;
    }
    setMobileAccountLink(mobile, 'signin.html', 'Sign In');
  }

  // Admins get a shortcut in the mobile bar too
  const mobileAdmin = document.getElementById('mobile-admin-link');
  if (AppState.isAdmin && mobileNav && !mobileAdmin) {
    mobileNav.insertAdjacentHTML(
      'beforeend',
      '<a href="admin.html" id="mobile-admin-link"><span>⚙️</span><span>Admin</span></a>'
    );
  } else if (!AppState.isAdmin && mobileAdmin) {
    mobileAdmin.remove();
  }
}

async function processAccountLogOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  AppState.user = null;
  AppState.isAdmin = false;
  showToast('You have signed out.');
  setTimeout(() => window.location.reload(), 700);
}

// Start loading the session right away; pages can `await authReady`
const authReady = initAuth();

// ------------------------------------------------------------
// Motion & polish (header shadow, scroll reveal, page transitions)
// ------------------------------------------------------------
function initUiEffects() {
  // Header gets a shadow once you scroll
  const header = document.querySelector('header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Sections fade up as they enter the screen
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in-view');
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0, rootMargin: '0px 0px -40px 0px' }
    );
    document
      .querySelectorAll('main > section, main > h2, main > hr, .section-title, .reveal-on-scroll')
      .forEach((el) => {
        el.classList.add('reveal');
        io.observe(el);
      });
  }

  // Smooth fade between pages
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;

    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) return;

    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;

    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(() => {
      location.href = url.href;
    }, 170);
  });
  // Coming back with the Back button should not leave the page faded out
  window.addEventListener('pageshow', () => document.body.classList.remove('leaving'));
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  updateCartCounter();
  renderProfileNavigationAnchors();
  initUiEffects();
  await loadProducts();
});