// ============================================================
// Zara One Stop Shop — Admin Panel (Supabase Auth + Storage)
// The real protection is in Supabase (Row Level Security).
// This file only controls what the admin sees on screen.
// ============================================================

let selectedImageFile = null;

const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
const ALLOWED_CATEGORIES = ['Kitchen', 'Kids', 'Home & Living', 'Gadgets'];
const ALLOWED_TAGS = ['None', 'Sale', 'Hot', 'Sold Out'];

document.addEventListener('DOMContentLoaded', async () => {
  setupAuthForms();
  setupAdminForm();

  if (!supabaseClient) {
    showLockScreen();
    showAuthError('The store database is not connected. Check config.js.');
    return;
  }

  // If the session ends (sign out, expired), lock the panel again
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      AppState.isAdmin = false;
      showLockScreen();
    }
  });

  await checkAdminSession();
});

// ------------------------------------------------------------
// Auth & access control
// ------------------------------------------------------------
async function checkAdminSession() {
  const {
    data: { session }
  } = await supabaseClient.auth.getSession();

  if (session && session.user) {
    if (await isAdminUser()) {
      AppState.isAdmin = true;
      await unlockAdminDashboard(session.user.email);
      return;
    }
    await supabaseClient.auth.signOut();
    showAuthError('This account is not authorized for admin access.');
  }

  showLockScreen();
}

// Asks the database "is the signed-in user an admin?" (function is_admin in SQL)
async function isAdminUser() {
  try {
    const { data, error } = await supabaseClient.rpc('is_admin');
    if (error) {
      console.warn('Admin check failed:', error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    return false;
  }
}

function showLockScreen() {
  const overlay = document.getElementById('admin-lock-screen');
  const dashboard = document.getElementById('admin-protected-dashboard');
  if (overlay) overlay.style.display = 'flex';
  if (dashboard) dashboard.style.display = 'none';
}

async function unlockAdminDashboard(email) {
  const overlay = document.getElementById('admin-lock-screen');
  const dashboard = document.getElementById('admin-protected-dashboard');
  if (overlay) overlay.style.display = 'none';
  if (dashboard) dashboard.style.display = 'grid';

  const emailNode = document.getElementById('admin-logged-email');
  if (emailNode) emailNode.textContent = email || 'Admin';

  await loadProducts(true);
  calculateLiveMetrics();
  renderAdminProductsTable();
}

// ------------------------------------------------------------
// Login / logout
// ------------------------------------------------------------
function setupAuthForms() {
  const loginForm = document.getElementById('admin-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleAdminLogin();
    });
  }

  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleAdminLogout);
}

async function handleAdminLogin() {
  const email = (document.getElementById('admin-email')?.value || '').trim().toLowerCase();
  const password = document.getElementById('admin-password')?.value || '';

  if (!email || !password) {
    showAuthError('Enter both your email and password.');
    return;
  }
  if (!supabaseClient) {
    showAuthError('The store database is not connected. Check config.js.');
    return;
  }

  try {
    setAuthLoading(true);

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      showAuthError('Login failed. Check your email and password.');
      return;
    }

    if (!(await isAdminUser())) {
      await supabaseClient.auth.signOut();
      showAuthError('This account is not authorized for admin access.');
      return;
    }

    AppState.isAdmin = true;
    await unlockAdminDashboard(email);
    showToast('Signed in.', 'success');
  } catch (err) {
    console.error(err);
    showAuthError('Login failed. Try again.');
  } finally {
    setAuthLoading(false);
    const passInput = document.getElementById('admin-password');
    if (passInput) passInput.value = '';
  }
}

async function handleAdminLogout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  AppState.isAdmin = false;
  showLockScreen();
  showToast('Signed out.');
  const emailInput = document.getElementById('admin-email');
  const passInput = document.getElementById('admin-password');
  if (emailInput) emailInput.value = '';
  if (passInput) passInput.value = '';
}

function showAuthError(msg) {
  const el = document.getElementById('gate-auth-error');
  if (el) {
    el.style.display = 'block';
    el.style.color = 'var(--clay)';
    el.textContent = msg;
  }
}

function setAuthLoading(isLoading) {
  const btn = document.getElementById('admin-login-btn');
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? 'Signing in…' : 'Authorize Entry';
  }
}

// ------------------------------------------------------------
// Metrics
// ------------------------------------------------------------
function calculateLiveMetrics() {
  const list = AppState.products || [];
  const totalCounter = document.getElementById('metric-total-products');
  const stockCounter = document.getElementById('metric-out-stock');

  if (totalCounter) totalCounter.textContent = list.length;
  if (stockCounter) stockCounter.textContent = list.filter((p) => p.tag === 'Sold Out').length;
}

// ------------------------------------------------------------
// Product form & image handling
// ------------------------------------------------------------
function setupAdminForm() {
  const form = document.getElementById('admin-catalog-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProduct();
  });

  const fileInput = document.getElementById('form-file-selector');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => processImageSelectionPreview(e.target));
  }
}

function processImageSelectionPreview(input) {
  const imgElement = document.getElementById('form-preview-node');
  const contextText = document.getElementById('upload-zone-text');

  if (!(input.files && input.files[0])) return;
  const file = input.files[0];

  if (!ALLOWED_IMAGE_TYPES[file.type]) {
    showToast('Only JPG, PNG or WebP images are allowed.', 'error');
    input.value = '';
    selectedImageFile = null;
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showToast('Image is too large. Choose a file under 4 MB.', 'error');
    input.value = '';
    selectedImageFile = null;
    return;
  }

  selectedImageFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    imgElement.src = e.target.result;
    imgElement.style.display = 'inline-block';
    if (contextText) contextText.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function uploadProductImage(file) {
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) throw new Error('Only JPG, PNG or WebP images are allowed.');

  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = `products/${fileName}`;

  const { error: uploadError } = await supabaseClient.storage
    .from('product-images')
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

  if (uploadError) throw new Error('Image upload failed: ' + uploadError.message);

  const { data: publicData } = supabaseClient.storage.from('product-images').getPublicUrl(path);
  return publicData.publicUrl;
}

async function saveProduct() {
  if (!supabaseClient || !AppState.isAdmin) {
    showToast('Please sign in as admin first.', 'error');
    return;
  }

  const name = document.getElementById('form-product-name').value.trim();
  const category = document.getElementById('form-product-category').value;
  const oldPriceRaw = document.getElementById('form-old-price').value;
  const newPrice = parseFloat(document.getElementById('form-new-price').value);
  const oldPrice = oldPriceRaw ? parseFloat(oldPriceRaw) : null;
  const tag = document.getElementById('form-product-tag').value;
  const editId = document.getElementById('form-product-id').value;

  if (!name || name.length > 120) {
    showToast('Enter a product name (up to 120 characters).', 'error');
    return;
  }
  if (isNaN(newPrice) || newPrice < 0) {
    showToast('Enter a valid current price.', 'error');
    return;
  }
  if (oldPrice !== null && (isNaN(oldPrice) || oldPrice < 0)) {
    showToast('Old price must be a positive number or empty.', 'error');
    return;
  }
  if (!ALLOWED_CATEGORIES.includes(category) || !ALLOWED_TAGS.includes(tag)) {
    showToast('Invalid category or badge.', 'error');
    return;
  }

  const submitBtn = document.querySelector('#admin-catalog-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
  }

  try {
    let imageUrl = document.getElementById('form-preview-node').getAttribute('src') || '';

    if (selectedImageFile) {
      imageUrl = await uploadProductImage(selectedImageFile);
    }
    if (!imageUrl || imageUrl === '#' || imageUrl.startsWith('data:')) {
      imageUrl = FALLBACK_IMG;
    }

    const payload = {
      name,
      category,
      old_price: oldPrice,
      new_price: newPrice,
      tag,
      img: imageUrl
    };

    if (editId) {
      const { data, error } = await supabaseClient
        .from('products')
        .update(payload)
        .eq('id', parseInt(editId, 10))
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Update was not applied. Sign in again as admin.');
      }
      showToast('Product updated.', 'success');
    } else {
      const { error } = await supabaseClient.from('products').insert([payload]);
      if (error) throw error;
      showToast('Product published.', 'success');
    }

    await loadProducts(true);
    resetAdminForm();
    calculateLiveMetrics();
    renderAdminProductsTable();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Failed to save product.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish Asset Live';
    }
  }
}

function resetAdminForm() {
  const form = document.getElementById('admin-catalog-form');
  if (form) form.reset();

  document.getElementById('form-product-id').value = '';
  document.getElementById('form-preview-node').style.display = 'none';
  document.getElementById('form-preview-node').setAttribute('src', '#');
  document.getElementById('upload-zone-text').style.display = 'block';
  document.getElementById('admin-form-heading').textContent = 'Register New Catalog Entry';

  selectedImageFile = null;
}

// ------------------------------------------------------------
// Table rendering & actions
// ------------------------------------------------------------
function renderAdminProductsTable() {
  const tbody = document.getElementById('admin-products-tbody');
  if (!tbody) return;

  if (!AppState.products || AppState.products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding:40px; text-align:center; color:var(--gray);">
          No products yet. Add your first item above.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = AppState.products
    .map((prod) => {
      const id = Number(prod.id);
      return `
      <tr style="border-bottom:1px solid var(--sand);">
        <td style="padding:14px;">
          <img src="${escapeHtml(safeImgUrl(prod.img))}" alt="" style="width:48px; height:48px; object-fit:cover; border-radius:8px;">
        </td>
        <td style="padding:14px; font-weight:600;">${escapeHtml(prod.name)}</td>
        <td style="padding:14px; color:var(--teal); font-weight:500;">${escapeHtml(prod.category)}</td>
        <td style="padding:14px; font-family:'IBM Plex Mono',monospace; color:var(--gray);">
          ${prod.oldPrice ? '₦' + Number(prod.oldPrice).toLocaleString() : '—'}
        </td>
        <td style="padding:14px; font-family:'IBM Plex Mono',monospace; font-weight:700; color:var(--teal);">
          ₦${Number(prod.newPrice).toLocaleString()}
        </td>
        <td style="padding:14px;">
          <span class="badge" style="position:static; display:inline-block;">${escapeHtml(prod.tag)}</span>
        </td>
        <td style="padding:14px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-primary" style="padding:6px 12px; font-size:0.85rem;" onclick="loadProductToForm(${id})">Edit</button>
            <button class="btn-secondary" style="background:var(--clay); color:white; padding:6px 12px; font-size:0.85rem;" onclick="deleteProduct(${id})">Delete</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

function loadProductToForm(id) {
  const match = AppState.products.find((p) => p.id === id);
  if (!match) return;

  document.getElementById('form-product-id').value = match.id;
  document.getElementById('form-product-name').value = match.name;
  document.getElementById('form-product-category').value = match.category;
  document.getElementById('form-old-price').value = match.oldPrice || '';
  document.getElementById('form-new-price').value = match.newPrice;
  document.getElementById('form-product-tag').value = match.tag || 'None';

  const preview = document.getElementById('form-preview-node');
  preview.setAttribute('src', safeImgUrl(match.img));
  preview.style.display = 'inline-block';
  document.getElementById('upload-zone-text').style.display = 'none';

  document.getElementById('admin-form-heading').textContent = 'Edit Existing Product';
  selectedImageFile = null;

  switchAdminPanelTab('admin-products-view');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteProduct(id) {
  if (!supabaseClient || !AppState.isAdmin) {
    showToast('Please sign in as admin first.', 'error');
    return;
  }
  if (!confirm('Permanently delete this product? This cannot be undone.')) return;

  try {
    const { data, error } = await supabaseClient
      .from('products')
      .delete()
      .eq('id', id)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Delete was not applied. Sign in again as admin.');
    }

    await loadProducts(true);
    calculateLiveMetrics();
    renderAdminProductsTable();
    showToast('Product deleted.', 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Delete failed.', 'error');
  }
}

function switchAdminPanelTab(tabId) {
  document.querySelectorAll('.admin-view-panel').forEach((panel) => {
    panel.style.display = 'none';
  });
  const target = document.getElementById(tabId);
  if (target) target.style.display = 'block';

  const btnStats = document.getElementById('tab-btn-stats');
  const btnProducts = document.getElementById('tab-btn-products');

  if (btnStats && btnProducts) {
    btnStats.style.background = tabId === 'admin-stats-view' ? 'rgba(255,255,255,0.12)' : 'transparent';
    btnProducts.style.background = tabId === 'admin-products-view' ? 'rgba(255,255,255,0.12)' : 'transparent';
  }
}