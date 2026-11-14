// ============================================================
// Zara One Stop Shop — Core Application Logic
// ============================================================

// Load config (must be included before this file)
const supabaseClient = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && !SUPABASE_URL.includes('YOUR_PROJECT'))
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

window.AppState = {
  products: [],
  cart: JSON.parse(localStorage.getItem('zara_cart')) || [],
  user: JSON.parse(localStorage.getItem('zara_shop_session')) || null,
  isAdmin: false,
  supabaseReady: !!supabaseClient
};

// Fallback demo products (used only when Supabase is not configured or fails)
const fallbackInventoryData = [
  {
    id: 101,
    name: "Premium Commercial Digital Air Fryer",
    category: "Kitchen",
    oldPrice: 85000,
    newPrice: 68000,
    tag: "Sale",
    img: "https://images.unsplash.com/photo-1621972750749-0fbb1abb7736?auto=format&fit=crop&w=600&q=80"
  },
  {
    id: 102,
    name: "Break-Resistant 4-In-1 Kids Lunch Pack",
    category: "Kids",
    oldPrice: 15000,
    newPrice: 12000,
    tag: "Hot",
    img: "https://images.unsplash.com/photo-1606168094316-0cd4b60e9095?auto=format&fit=crop&w=600&q=80"
  },
  {
    id: 103,
    name: "Heavy-Duty Sourcing Utility Gadget",
    category: "Gadgets",
    oldPrice: null,
    newPrice: 34500,
    tag: "None",
    img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80"
  },
  {
    id: 104,
    name: "Standard Anti-Shatter Household Glass Set",
    category: "Home & Living",
    oldPrice: 28000,
    newPrice: 24000,
    tag: "Sold Out",
    img: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80"
  }
];

// ------------------------------------------------------------
// Product loading
// ------------------------------------------------------------
async function loadProducts() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('products')
        .select('*')
        .order('id', { ascending: true });

      if (error) throw error;

      AppState.products = (data || []).map(row => ({
        id: row.id,
        name: row.name,
        category: row.category,
        oldPrice: row.old_price,
        newPrice: row.new_price,
        tag: row.tag || 'None',
        img: row.img || 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80'
      }));

      // Keep a local mirror for offline resilience
      localStorage.setItem('zara_dynamic_products', JSON.stringify(AppState.products));
      return;
    } catch (err) {
      console.warn('Supabase products load failed, using fallback:', err.message);
    }
  }

  // Fallback path
  const stored = JSON.parse(localStorage.getItem('zara_dynamic_products'));
  if (stored && stored.length > 0) {
    AppState.products = stored;
  } else {
    AppState.products = fallbackInventoryData;
    localStorage.setItem('zara_dynamic_products', JSON.stringify(AppState.products));
  }
}

// ------------------------------------------------------------
// Cart helpers
// ------------------------------------------------------------
function addToSelection(productId, quantity = 1) {
  const targetId = parseInt(productId);
  const qtyNum = parseInt(quantity) || 1;
  const product = AppState.products.find(p => p.id === targetId);

  if (!product) {
    showToast('Product not found.');
    return;
  }

  if (product.tag === 'Sold Out') {
    showToast('This item is currently out of stock.');
    return;
  }

  const existingItem = AppState.cart.find(item => item.id === targetId);
  if (existingItem) {
    existingItem.qty += qtyNum;
  } else {
    AppState.cart.push({ id: targetId, qty: qtyNum });
  }

  saveSelectionCartState();
  showToast(`${product.name} added to selection.`);
}

function removeFromSelection(productId) {
  const targetId = parseInt(productId);
  AppState.cart = AppState.cart.filter(item => item.id !== targetId);
  saveSelectionCartState();

  if (typeof renderCartPage === 'function') renderCartPage();
  showToast('Item removed from selection.');
}

function updateSelectionQty(productId, newQty) {
  const targetId = parseInt(productId);
  const count = parseInt(newQty);
  if (count < 1) return;

  const item = AppState.cart.find(i => i.id === targetId);
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
  const countSum = AppState.cart.reduce((acc, current) => acc + current.qty, 0);
  nodes.forEach(n => (n.innerText = countSum));
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
  box.innerText = message;
  container.appendChild(box);

  setTimeout(() => {
    box.style.opacity = '0';
    box.style.transform = 'translateY(12px)';
    box.style.transition = 'all 0.35s ease';
    setTimeout(() => box.remove(), 350);
  }, 3400);
}

// ------------------------------------------------------------
// Profile / session helpers (guest friendly)
// ------------------------------------------------------------
function renderProfileNavigationAnchors() {
  const anchor = document.getElementById('profile-nav-anchor');
  if (!anchor) return;

  if (AppState.user) {
    const firstName = (AppState.user.name || 'Customer').split(' ')[0];
    anchor.innerHTML = `
      <span style="font-weight:600; color:var(--marigold);">Hi, ${firstName}</span>
      <a href="#" onclick="processAccountLogOut(); return false;" style="font-size:0.9rem; opacity:0.85; margin-left:8px;">Sign Out</a>
    `;
  } else {
    anchor.innerHTML = `<a href="signin.html">Sign In</a>`;
  }
}

function processAccountLogOut() {
  AppState.user = null;
  localStorage.removeItem('zara_shop_session');
  showToast('Signed out successfully.');
  setTimeout(() => window.location.reload(), 700);
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await loadProducts();
  updateCartCounter();
  renderProfileNavigationAnchors();
});
