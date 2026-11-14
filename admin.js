// ============================================================
// Zara One Stop Shop — Admin Panel (Supabase Auth + Storage)
// ============================================================

let currentEditingId = null;
let selectedImageFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for app.js to finish loading products
  if (typeof loadProducts === 'function') {
    await loadProducts();
  }

  // Check existing session
  await checkAdminSession();

  setupAdminForm();
  setupAuthForms();
});

// ------------------------------------------------------------
// Auth & Access Control
// ------------------------------------------------------------
async function checkAdminSession() {
  if (!supabaseClient) {
    // Demo mode – show a notice and allow local access with a soft lock
    showDemoModeNotice();
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();

  if (session && session.user) {
    const isAllowed = await isEmailAllowedAdmin(session.user.email);
    if (isAllowed) {
      AppState.isAdmin = true;
      unlockAdminDashboard(session.user.email);
      return;
    } else {
      // Signed in but not in the admins table
      await supabaseClient.auth.signOut();
      showAuthError('Your email is not authorized for admin access.');
    }
  }

  // No valid admin session → keep lock screen visible
  showLockScreen();
}

async function isEmailAllowedAdmin(email) {
  if (!email || !supabaseClient) return false;

  try {
    const { data, error } = await supabaseClient
      .from('admins')
      .select('email')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error) {
      console.warn('Admin check error:', error.message);
      return false;
    }
    return !!data;
  } catch (e) {
    console.warn(e);
    return false;
  }
}

function showLockScreen() {
  const overlay = document.getElementById('admin-lock-screen');
  const dashboard = document.getElementById('admin-protected-dashboard');
  if (overlay) overlay.style.display = 'flex';
  if (dashboard) dashboard.style.display = 'none';
}

function unlockAdminDashboard(email) {
  const overlay = document.getElementById('admin-lock-screen');
  const dashboard = document.getElementById('admin-protected-dashboard');
  if (overlay) overlay.style.display = 'none';
  if (dashboard) dashboard.style.display = 'grid';

  const emailNode = document.getElementById('admin-logged-email');
  if (emailNode) emailNode.textContent = email || 'Admin';

  calculateLiveMetrics();
  renderAdminProductsTable();
}

function showDemoModeNotice() {
  // When Supabase is not configured we still allow a local demo admin
  // so the UI can be tested. In production this path is never taken.
  const overlay = document.getElementById('admin-lock-screen');
  if (overlay) {
    const desc = document.getElementById('lock-description');
    if (desc) {
      desc.innerHTML = `
        <strong style="color:var(--clay)">Demo Mode</strong><br>
        Supabase is not configured yet. Enter any email + password to continue locally.
        <br><small>After you add your real keys in config.js this will require an authorized email.</small>
      `;
    }
  }
}

// ------------------------------------------------------------
// Auth form handlers
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
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleAdminLogout);
  }
}

async function handleAdminLogin() {
  const emailInput = document.getElementById('admin-email');
  const passInput = document.getElementById('admin-password');
  const errorEl = document.getElementById('gate-auth-error');

  const email = (emailInput?.value || '').trim().toLowerCase();
  const password = passInput?.value || '';

  if (!email || !password) {
    showAuthError('Please enter both email and password.');
    return;
  }

  // Demo / local fallback when Supabase is missing
  if (!supabaseClient) {
    AppState.isAdmin = true;
    unlockAdminDashboard(email);
    showToast('Demo admin session started (local only).', 'success');
    return;
  }

  try {
    setAuthLoading(true);

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    const allowed = await isEmailAllowedAdmin(data.user.email);
    if (!allowed) {
      await supabaseClient.auth.signOut();
      showAuthError('This email is not authorized for admin access. Contact the site owner.');
      return;
    }

    AppState.isAdmin = true;
    unlockAdminDashboard(data.user.email);
    showToast('Welcome back, admin!', 'success');
  } catch (err) {
    console.error(err);
    showAuthError(err.message || 'Login failed. Check your credentials.');
  } finally {
    setAuthLoading(false);
  }
}

async function handleAdminLogout() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  AppState.isAdmin = false;
  showLockScreen();
  showToast('Signed out of admin panel.');
  // Clear form
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
    btn.textContent = isLoading ? 'Authorizing…' : 'Authorize Entry';
  }
}

// ------------------------------------------------------------
// Metrics
// ------------------------------------------------------------
function calculateLiveMetrics() {
  const list = AppState.products || [];
  const totalCounter = document.getElementById('metric-total-products');
  const stockCounter = document.getElementById('metric-out-stock');

  if (totalCounter) totalCounter.innerText = list.length;
  if (stockCounter) {
    stockCounter.innerText = list.filter(p => p.tag === 'Sold Out').length;
  }
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

  // Image preview
  const fileInput = document.getElementById('form-file-selector');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      processImageSelectionPreview(e.target);
    });
  }
}

function processImageSelectionPreview(input) {
  const imgElement = document.getElementById('form-preview-node');
  const contextText = document.getElementById('upload-zone-text');

  if (input.files && input.files[0]) {
    selectedImageFile = input.files[0];

    // Size guard (max 4 MB)
    if (selectedImageFile.size > 4 * 1024 * 1024) {
      showToast('Image is too large. Please choose a file under 4 MB.', 'error');
      input.value = '';
      selectedImageFile = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      imgElement.src = e.target.result;
      imgElement.style.display = 'inline-block';
      if (contextText) contextText.style.display = 'none';
    };
    reader.readAsDataURL(selectedImageFile);
  }
}

async function uploadProductImage(file) {
  if (!file) return null;

  // Local / demo mode – return a data URL (not ideal but works for testing)
  if (!supabaseClient) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = `products/${fileName}`;

  const { error: uploadError } = await supabaseClient.storage
    .from('product-images')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (uploadError) {
    throw new Error('Image upload failed: ' + uploadError.message);
  }

  const { data: publicData } = supabaseClient.storage
    .from('product-images')
    .getPublicUrl(path);

  return publicData.publicUrl;
}

async function saveProduct() {
  const name = document.getElementById('form-product-name').value.trim();
  const category = document.getElementById('form-product-category').value;
  const oldPriceRaw = document.getElementById('form-old-price').value;
  const newPrice = parseFloat(document.getElementById('form-new-price').value);
  const tag = document.getElementById('form-product-tag').value;
  const editId = document.getElementById('form-product-id').value;

  if (!name || isNaN(newPrice)) {
    showToast('Please fill in product name and a valid price.', 'error');
    return;
  }

  const submitBtn = document.querySelector('#admin-catalog-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
  }

  try {
    let imageUrl = document.getElementById('form-preview-node').src;

    // If a new file was selected, upload it
    if (selectedImageFile) {
      imageUrl = await uploadProductImage(selectedImageFile);
    }

    // Fallback image if still empty
    if (!imageUrl || imageUrl.includes('#') || imageUrl === window.location.href) {
      imageUrl = 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80';
    }

    const payload = {
      name,
      category,
      old_price: oldPriceRaw ? parseFloat(oldPriceRaw) : null,
      new_price: newPrice,
      tag,
      img: imageUrl
    };

    if (supabaseClient) {
      if (editId) {
        // Update
        const { error } = await supabaseClient
          .from('products')
          .update(payload)
          .eq('id', parseInt(editId));

        if (error) throw error;
        showToast('Product updated successfully.', 'success');
      } else {
        // Insert
        const { error } = await supabaseClient
          .from('products')
          .insert([payload]);

        if (error) throw error;
        showToast('Product published live.', 'success');
      }
    } else {
      // Local fallback
      if (editId) {
        const idx = AppState.products.findIndex(p => p.id === parseInt(editId));
        if (idx !== -1) {
          AppState.products[idx] = {
            id: parseInt(editId),
            name,
            category,
            oldPrice: payload.old_price,
            newPrice,
            tag,
            img: imageUrl
          };
        }
      } else {
        AppState.products.push({
          id: Date.now(),
          name,
          category,
          oldPrice: payload.old_price,
          newPrice,
          tag,
          img: imageUrl
        });
      }
      localStorage.setItem('zara_dynamic_products', JSON.stringify(AppState.products));
      showToast(editId ? 'Product updated (local).' : 'Product added (local).', 'success');
    }

    // Refresh
    await loadProducts();
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
  document.getElementById('form-preview-node').src = '#';
  document.getElementById('upload-zone-text').style.display = 'block';
  document.getElementById('admin-form-heading').innerText = 'Register New Catalog Entry';

  selectedImageFile = null;
  currentEditingId = null;
}

// ------------------------------------------------------------
// Table rendering & actions
// ------------------------------------------------------------
function renderAdminProductsTable() {
  const tbody = document.getElementById('admin-products-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!AppState.products || AppState.products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding:40px; text-align:center; color:var(--gray);">
          No products yet. Add your first item above.
        </td>
      </tr>`;
    return;
  }

  AppState.products.forEach(prod => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--sand)';
    tr.innerHTML = `
      <td style="padding:14px;">
        <img src="${prod.img}" alt="" style="width:48px; height:48px; object-fit:cover; border-radius:8px;">
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
          <button class="btn-primary" style="padding:6px 12px; font-size:0.85rem;" onclick="loadProductToForm(${prod.id})">Edit</button>
          <button class="btn-secondary" style="background:var(--clay); color:white; padding:6px 12px; font-size:0.85rem;" onclick="deleteProduct(${prod.id})">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function loadProductToForm(id) {
  const match = AppState.products.find(p => p.id === id);
  if (!match) return;

  document.getElementById('form-product-id').value = match.id;
  document.getElementById('form-product-name').value = match.name;
  document.getElementById('form-product-category').value = match.category;
  document.getElementById('form-old-price').value = match.oldPrice || '';
  document.getElementById('form-new-price').value = match.newPrice;
  document.getElementById('form-product-tag').value = match.tag || 'None';

  const preview = document.getElementById('form-preview-node');
  preview.src = match.img;
  preview.style.display = 'inline-block';
  document.getElementById('upload-zone-text').style.display = 'none';

  document.getElementById('admin-form-heading').innerText = 'Edit Existing Product';
  selectedImageFile = null;
  currentEditingId = id;

  switchAdminPanelTab('admin-products-view');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteProduct(id) {
  if (!confirm('Permanently delete this product? This cannot be undone.')) return;

  try {
    if (supabaseClient) {
      const { error } = await supabaseClient
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } else {
      AppState.products = AppState.products.filter(p => p.id !== id);
      localStorage.setItem('zara_dynamic_products', JSON.stringify(AppState.products));
    }

    await loadProducts();
    calculateLiveMetrics();
    renderAdminProductsTable();
    showToast('Product deleted.', 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Delete failed.', 'error');
  }
}

function switchAdminPanelTab(tabId) {
  document.querySelectorAll('.admin-view-panel').forEach(panel => {
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

// Small helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
