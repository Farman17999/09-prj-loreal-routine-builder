/* =========================================================
   L'Oréal Smart Routine & Product Advisor
   ---------------------------------------------------------
   1. Load products from products.json
   2. Filter by category + keyword search
   3. Select / unselect products (saved in localStorage)
   4. Show product descriptions in a modal
   5. Send selected products to OpenAI (through our
      Cloudflare Worker) to generate a routine
   6. Keep the full chat history for follow-up questions
   ========================================================= */

/* 👉 Paste YOUR Cloudflare Worker URL here (no API key in this file!) */
const WORKER_URL = "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/";

/* ---------- Get references to DOM elements ---------- */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedCount = document.getElementById("selectedCount");
const clearAllBtn = document.getElementById("clearAll");
const generateBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const webSearchToggle = document.getElementById("webSearchToggle");
const rtlToggle = document.getElementById("rtlToggle");
const rtlLabel = document.getElementById("rtlLabel");

/* Modal elements */
const modal = document.getElementById("productModal");
const modalClose = document.getElementById("modalClose");
const modalImage = document.getElementById("modalImage");
const modalBrand = document.getElementById("modalBrand");
const modalTitle = document.getElementById("modalTitle");
const modalCategory = document.getElementById("modalCategory");
const modalDescription = document.getElementById("modalDescription");
const modalSelect = document.getElementById("modalSelect");

/* ---------- App state (the data our app remembers) ---------- */
let allProducts = []; // every product from products.json

// Load saved product IDs from localStorage (or start with an empty list)
let selectedIds = JSON.parse(localStorage.getItem("selectedProductIds")) || [];

// The system prompt controls how the AI behaves for the whole conversation
const SYSTEM_PROMPT = `You are "L'Oréal Beauty Advisor", a friendly, expert assistant for L'Oréal Groupe brands (CeraVe, L'Oréal Paris, Garnier, Lancôme, La Roche-Posay, Kiehl's, Maybelline, Kérastase, Redken, YSL, and more).

Your job:
1. When given a list of selected products (as JSON), build a clear, personalized routine that uses ONLY those products. Group steps into Morning (AM) and Evening (PM) when it makes sense, put the steps in the correct order (e.g. cleanse → treat → moisturize → SPF), and explain in one short sentence why each step matters. If a product doesn't fit a daily routine (e.g. fragrance, styling, hair color), add it in a separate "How & When to Use" section.
2. Answer follow-up questions about the routine, or about skincare, haircare, makeup, fragrance, suncare, and grooming.

Rules:
- Stay on topic. If a question is unrelated to beauty, personal care, or the user's routine, politely say you can only help with beauty and routine questions and suggest a related question they could ask.
- Do not diagnose medical conditions. For serious skin concerns, recommend seeing a dermatologist.
- Keep answers concise and easy to scan: use short headings, numbered steps, and bullet points.
- Reply in the same language the user writes in.`;

// Conversation history — sent to the AI on every request so it "remembers"
let messages = [{ role: "system", content: SYSTEM_PROMPT }];

/* =========================================================
   PRODUCTS: load, filter, display
   ========================================================= */

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Turn a category value like "men's grooming" into a nice label */
function formatCategory(category) {
  return category.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  // If nothing matches, show a friendly message instead of an empty grid
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No products match your search. Try a different keyword or category.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = selectedIds.includes(product.id);
      return `
    <div class="product-card ${isSelected ? "selected" : ""}"
         data-id="${product.id}"
         role="button"
         tabindex="0"
         aria-pressed="${isSelected}"
         aria-label="${isSelected ? "Unselect" : "Select"} ${product.brand} ${product.name}">
      <span class="check-badge" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <p class="brand">${product.brand}</p>
        <h3>${product.name}</h3>
        <button class="details-btn" type="button" data-id="${product.id}">
          <i class="fa-solid fa-circle-info"></i> Details
        </button>
      </div>
    </div>
  `;
    })
    .join("");
}

/* Apply BOTH the category filter and the search box at the same time */
function filterAndDisplay() {
  const category = categoryFilter.value;
  const keyword = productSearch.value.trim().toLowerCase();

  // Nothing chosen yet → show the starting message
  if (!category && !keyword) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Select a category or search to view products
      </div>
    `;
    return;
  }

  const filtered = allProducts.filter((product) => {
    // Category check ("all" or empty means every category)
    const matchesCategory =
      !category || category === "all" || product.category === category;

    // Keyword check: look in name, brand, category and description
    const searchableText =
      `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase();
    const matchesKeyword = !keyword || searchableText.includes(keyword);

    return matchesCategory && matchesKeyword;
  });

  displayProducts(filtered);
}

/* Re-filter whenever the category or search text changes */
categoryFilter.addEventListener("change", filterAndDisplay);
productSearch.addEventListener("input", filterAndDisplay);

/* =========================================================
   SELECTING PRODUCTS
   ========================================================= */

/* Save the selected IDs so they survive a page reload */
function saveSelections() {
  localStorage.setItem("selectedProductIds", JSON.stringify(selectedIds));
}

/* Add a product if it isn't selected, remove it if it is */
function toggleProduct(id) {
  if (selectedIds.includes(id)) {
    selectedIds = selectedIds.filter((selectedId) => selectedId !== id);
  } else {
    selectedIds.push(id);
  }
  saveSelections();
  updateSelectedList();
  filterAndDisplay(); // re-draw the grid so highlights update
}

/* Get the full product objects for the selected IDs */
function getSelectedProducts() {
  return allProducts.filter((product) => selectedIds.includes(product.id));
}

/* Draw the "Selected Products" section */
function updateSelectedList() {
  const selected = getSelectedProducts();
  selectedCount.textContent = selected.length;
  clearAllBtn.disabled = selected.length === 0;
  generateBtn.disabled = selected.length === 0;

  if (selected.length === 0) {
    selectedProductsList.innerHTML = `<p class="empty-note">No products selected yet — click a product card to add it.</p>`;
    return;
  }

  selectedProductsList.innerHTML = selected
    .map(
      (product) => `
      <div class="selected-chip">
        <img src="${product.image}" alt="">
        <span>${product.brand} · ${product.name}</span>
        <button class="remove-btn" type="button" data-id="${product.id}"
                aria-label="Remove ${product.name}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `,
    )
    .join("");
}

/* One click listener on the grid handles every card (event delegation) */
productsContainer.addEventListener("click", (e) => {
  // Clicked the "Details" button → open the modal, don't select
  const detailsBtn = e.target.closest(".details-btn");
  if (detailsBtn) {
    openModal(Number(detailsBtn.dataset.id));
    return;
  }

  // Clicked anywhere else on a card → select / unselect it
  const card = e.target.closest(".product-card");
  if (card) toggleProduct(Number(card.dataset.id));
});

/* Keyboard support: Enter or Space on a focused card toggles it */
productsContainer.addEventListener("keydown", (e) => {
  const card = e.target.closest(".product-card");
  if (card && e.target === card && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    toggleProduct(Number(card.dataset.id));
    // Put focus back on the same card after the grid re-draws
    productsContainer.querySelector(`[data-id="${card.dataset.id}"]`)?.focus();
  }
});

/* Remove a single product from the selected list */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-btn");
  if (removeBtn) toggleProduct(Number(removeBtn.dataset.id));
});

/* Clear every selection at once */
clearAllBtn.addEventListener("click", () => {
  selectedIds = [];
  saveSelections();
  updateSelectedList();
  filterAndDisplay();
});

/* =========================================================
   PRODUCT DESCRIPTION MODAL
   ========================================================= */
let modalProductId = null;
let lastFocused = null; // so we can return focus when the modal closes

function openModal(id) {
  const product = allProducts.find((p) => p.id === id);
  if (!product) return;

  modalProductId = id;
  lastFocused = document.activeElement;

  modalImage.src = product.image;
  modalImage.alt = product.name;
  modalBrand.textContent = product.brand;
  modalTitle.textContent = product.name;
  modalCategory.textContent = formatCategory(product.category);
  modalDescription.textContent = product.description;
  updateModalButton();

  modal.hidden = false;
  modalClose.focus();
}

function updateModalButton() {
  const isSelected = selectedIds.includes(modalProductId);
  modalSelect.innerHTML = isSelected
    ? `<i class="fa-solid fa-minus"></i> Remove from routine`
    : `<i class="fa-solid fa-plus"></i> Add to routine`;
}

function closeModal() {
  modal.hidden = true;
  lastFocused?.focus();
}

modalSelect.addEventListener("click", () => {
  toggleProduct(modalProductId);
  updateModalButton();
});
modalClose.addEventListener("click", closeModal);
// Click on the dark background closes the modal
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
// Escape key closes the modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});

/* =========================================================
   CHAT: talking to OpenAI through the Cloudflare Worker
   ========================================================= */

/* Escape HTML so AI text can't inject tags into our page */
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Very small Markdown → HTML converter for headings, bold, lists and links */
function formatReply(text) {
  const lines = escapeHTML(text).split("\n");
  let html = "";
  let listType = null; // "ul", "ol" or null

  // Helper to close an open list
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  lines.forEach((rawLine) => {
    // Inline formatting: **bold** and [text](url) links
    let line = rawLine
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
      );

    if (/^#{1,6}\s/.test(rawLine)) {
      closeList();
      html += `<h4>${line.replace(/^#{1,6}\s/, "")}</h4>`;
    } else if (/^\s*[-*•]\s+/.test(rawLine)) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${line.replace(/^\s*[-*•]\s+/, "")}</li>`;
    } else if (/^\s*\d+[.)]\s+/.test(rawLine)) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${line.replace(/^\s*\d+[.)]\s+/, "")}</li>`;
    } else if (rawLine.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${line}</p>`;
    }
  });
  closeList();
  return html;
}

/* Add a chat bubble. role is "user" or "assistant" */
function addMessage(role, text, citations = []) {
  const bubble = document.createElement("div");
  bubble.className = `msg ${role}`;

  if (role === "user") {
    bubble.textContent = text; // plain text for user messages
  } else {
    bubble.innerHTML = formatReply(text);

    // If web search returned sources, list them under the answer
    if (citations.length > 0) {
      const sources = citations
        .map(
          (c) =>
            `<li><a href="${escapeHTML(c.url)}" target="_blank" rel="noopener">${escapeHTML(c.title || c.url)}</a></li>`,
        )
        .join("");
      bubble.innerHTML += `<div class="sources"><strong>Sources</strong><ul>${sources}</ul></div>`;
    }
  }

  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight; // auto-scroll to newest
  return bubble;
}

/* Show a "typing…" bubble while we wait for the AI */
function showTyping() {
  const bubble = document.createElement("div");
  bubble.className = "msg assistant typing";
  bubble.innerHTML = `<span></span><span></span><span></span>`;
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

/* Send the whole conversation to the Worker and return the reply */
async function askAI() {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages,
      useWebSearch: webSearchToggle.checked, // LevelUp: live web search
    }),
  });

  if (!response.ok) {
    throw new Error(`Worker responded with status ${response.status}`);
  }

  const data = await response.json();

  // OpenAI sometimes returns an error object instead of choices
  if (data.error) throw new Error(data.error.message || "API error");

  const message = data.choices[0].message;

  // Web-search models attach sources as "url_citation" annotations
  const citations = (message.annotations || [])
    .filter((a) => a.type === "url_citation")
    .map((a) => a.url_citation);

  // Remove duplicate links
  const uniqueCitations = citations.filter(
    (c, index) => citations.findIndex((x) => x.url === c.url) === index,
  );

  return { text: message.content, citations: uniqueCitations };
}

/* Shared helper: push a user message, call the AI, show the reply */
async function sendToAI(userContent, displayText) {
  messages.push({ role: "user", content: userContent });
  addMessage("user", displayText);

  // Disable buttons so the user can't double-send
  setBusy(true);
  const typing = showTyping();

  try {
    const { text, citations } = await askAI();
    typing.remove();
    messages.push({ role: "assistant", content: text }); // remember reply
    addMessage("assistant", text, citations);
  } catch (error) {
    typing.remove();
    // Remove the failed user message so history stays clean
    messages.pop();
    addMessage(
      "assistant",
      `Sorry — I couldn't reach the advisor right now. Please try again. (${error.message})`,
    );
    console.error(error);
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  sendBtn.disabled = isBusy;
  userInput.disabled = isBusy;
  generateBtn.disabled = isBusy || selectedIds.length === 0;
}

/* "Generate Routine" button */
generateBtn.addEventListener("click", () => {
  const selected = getSelectedProducts();
  if (selected.length === 0) return;

  // Only send the useful fields for each product (not the image URL)
  const productData = selected.map((p) => ({
    name: p.name,
    brand: p.brand,
    category: p.category,
    description: p.description,
  }));

  const prompt = `Please build a personalized routine using ONLY these selected products:\n${JSON.stringify(productData, null, 2)}`;

  sendToAI(
    prompt,
    `✨ Generate a routine with my ${selected.length} selected product(s)`,
  );
});

/* Chat form: follow-up questions */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = userInput.value.trim();
  if (!question) return;
  userInput.value = "";
  sendToAI(question, question);
});

/* =========================================================
   RTL SUPPORT (LevelUp)
   ========================================================= */
function applyDirection(isRTL) {
  document.documentElement.dir = isRTL ? "rtl" : "ltr";
  document.documentElement.lang = isRTL ? "ar" : "en";
  rtlToggle.setAttribute("aria-pressed", isRTL);
  rtlLabel.textContent = isRTL ? "LTR" : "RTL";
  localStorage.setItem("rtlMode", isRTL);
}

rtlToggle.addEventListener("click", () => {
  applyDirection(document.documentElement.dir !== "rtl");
});

/* =========================================================
   START THE APP
   ========================================================= */
async function init() {
  applyDirection(localStorage.getItem("rtlMode") === "true");

  allProducts = await loadProducts();

  // Drop any saved IDs that no longer exist in products.json
  selectedIds = selectedIds.filter((id) =>
    allProducts.some((p) => p.id === id),
  );
  saveSelections();

  filterAndDisplay();
  updateSelectedList();

  // Friendly greeting in the chat window
  addMessage(
    "assistant",
    "Hi! I'm your L'Oréal Beauty Advisor. Select a few products above and click **Generate Routine** — or ask me any skincare, haircare, makeup, or fragrance question.",
  );
}

init();
