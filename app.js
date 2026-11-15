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
  user: safeJsonParse('zara_shop_session', null),
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

// One product card, used by the home, shop and product pages
function renderProductCard(p) {
  const id = Number(p.id);
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
    <div class="product-card">
      ${badge}
      <img src="${escapeHtml(safeImgUrl(p.img))}" alt="${escapeHtml(p.name)}"
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

function updateCartCounter() {
  const nodes = document.querySelectorAll('.cart-counter-node');
  const total = AppState.cart.reduce((sum, current) => sum + current.qty, 0);
  nodes.forEach((n) => (n.textContent = total));
}

// ------------------------------------------------------------
// Toast notifications
// ------------------------------------------------------------
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-notification-hub');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-notification-hub';
    container.style.cssText =
      'position:fixed; bottom:30px; right:30px; z-index:9999; display:flex; flex-direction:column; gap:10px; max-width:360px;';
    document.body.appendChild(container);
  }

  const box = document.createElement('div');
  const bg = type === 'error' ? 'var(--clay)' : type === 'success' ? '#0d9488' : 'var(--teal)';
  box.style.cssText = `background:${bg}; color:var(--white); padding:14px 22px; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.15); font-weight:500; font-size:0.95rem; animation:fadeInFrame 0.3s ease;`;
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
// "Your details" (saved only on this device, no password)
// ------------------------------------------------------------
function renderProfileNavigationAnchors() {
  const anchor = document.getElementById('profile-nav-anchor');
  if (!anchor) return;

  if (AppState.user && AppState.user.name) {
    const firstName = escapeHtml(String(AppState.user.name).split(' ')[0]);
    anchor.innerHTML = `
      <span style="font-weight:600; color:var(--marigold);">Hi, ${firstName}</span>
      <a href="#" onclick="processAccountLogOut(); return false;" style="font-size:0.9rem; opacity:0.85; margin-left:8px;">Clear details</a>
    `;
  } else {
    anchor.innerHTML = `<a href="register.html">Your Details</a>`;
  }
}

function processAccountLogOut() {
  AppState.user = null;
  localStorage.removeItem('zara_shop_session');
  showToast('Your saved details were cleared.');
  setTimeout(() => window.location.reload(), 700);
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  updateCartCounter();
  renderProfileNavigationAnchors();
  await loadProducts();
});