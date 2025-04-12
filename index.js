require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { OpenAI } = require("openai");
const cors = require("cors");

const app = express();
const port = 5000;

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

console.log("Shopify Store:", SHOPIFY_STORE);

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

app.use(cors());
app.use(express.json());

const sessionStore = {};

async function fetchStoreProducts() {
  try {
    const response = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/products.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const products = response.data.products.map((product) => ({
      title: product.title,
      titleLower: product.title.toLowerCase(),
      category: (product.product_type || product.tags?.[0] || "General").toLowerCase(),
      description: product.body_html || "No description available.",
      price: product.variants[0]?.price || "N/A",
      url: `https://${SHOPIFY_STORE}/products/${product.handle}`,
    }));

    console.log("✅ Shopify Products Fetched:", products.map(p => `${p.title} - ₹${p.price}`));
    return products;
  } catch (error) {
    console.error("❌ Shopify API error:", error.response?.data || error.message);
    return [];
  }
}

function searchProducts(products, query) {
  const q = query.toLowerCase();
  const priceMatch = q.match(/under\s*₹?(\d+)/i);
  const maxPrice = priceMatch ? parseFloat(priceMatch[1]) : null;

  console.log("🔍 Search Query:", q, "| Max Price:", maxPrice);

  const filtered = products.filter((p) => {
    const textMatch =
      p.title.toLowerCase().includes(q) ||
      p.titleLower.includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q);

    const priceValue = parseFloat(p.price);
    const inBudget = !maxPrice || (priceValue && priceValue <= maxPrice);

    return textMatch && inBudget;
  });

  return filtered;
}

function extractCategoryFromQuery(query, categories) {
  const lowerQuery = query.toLowerCase();
  return categories.find(cat => lowerQuery.includes(cat)) || null;
}

function detectIntent(message) {
  const lowerMsg = message.toLowerCase();

  const greetings = ["hi", "hello", "hey", "hlo", "good morning", "good evening", "gd mrng", "gd evng", "hii", "helo"];
  if (greetings.some(greet => lowerMsg.includes(greet))) return "greeting";

  if (lowerMsg.includes("order status") || lowerMsg.includes("track my order") || lowerMsg.includes("where is my order") || lowerMsg.includes("track order"))
    return "order_status";

  if (lowerMsg.includes("refund") || lowerMsg.includes("return"))
    return "refund_policy";

  if (lowerMsg.includes("shipping") || lowerMsg.includes("delivery") || lowerMsg.includes("how long will it take"))
    return "shipping_policy";

  if (lowerMsg.includes("cancel order"))
    return "cancel_order";

  if (lowerMsg.includes("thank"))
    return "thank_you";

  return "product_search";
}

function getFallbackMessage(query) {
  return `😕 Sorry, I couldn’t find an exact match for "${query}". But don't worry! I can suggest some great alternatives or help you explore similar items. Just let me know what you’re looking for!`;
}

app.post("/chat", async (req, res) => {
  let { message, sessionId } = req.body;

  try {
    if (!sessionStore[sessionId]) sessionStore[sessionId] = {};
    const session = sessionStore[sessionId];

    const products = await fetchStoreProducts();
    if (products.length === 0) {
      return res.json({ reply: "😔 Sorry, I couldn't load product info right now. Please try again later!" });
    }

    const intent = detectIntent(message);
    const confirmationWords = ["yes", "yeah", "yup", "ok", "okay", "show me", "sure", "kk", "s", "okk"];
    const userMsgLower = message.toLowerCase();

    if (confirmationWords.includes(userMsgLower) && session.categoryIntent) {
      message = session.categoryIntent;
    } else {
      session.intent = intent;
    }

    if (intent === "greeting") {
      return res.json({ reply: "👋 Hey! I’m Nia, your friendly shopping assistant. Looking for something fun, useful, or stylish today? Just tell me what you need — I’m here to help!" });
    }

    if (intent === "thank_you") {
      return res.json({ reply: "You're welcome! 😊 Let me know if there's anything else I can help you with." });
    }

    if (intent !== "product_search") {
      const staticResponses = {
        order_status: "📦 You can track your order using the tracking link sent to your email after purchase. If you didn’t receive it, please contact support with your order number!",
        refund_policy: "💰 We offer a hassle-free 7-day return and refund policy. Just head to the 'Refunds' section on our website or contact support to initiate the return.",
        shipping_policy: "🚚 We typically deliver within 3–5 business days. Shipping times may vary by location and product availability.",
        cancel_order: "🛑 Orders can only be cancelled within 1 hour of placement. Please reach out to our support team immediately with your order number."
      };
      return res.json({ reply: staticResponses[intent] });
    }

    const uniqueCategories = [...new Set(products.map(p => p.category.toLowerCase().trim()))].filter(Boolean);
    const category = extractCategoryFromQuery(message, uniqueCategories);
    if (category) session.categoryIntent = category;

    const matches = searchProducts(products, message);

    let productListText;
    if (matches.length > 0) {
      productListText = matches.slice(0, 3).map((p, i) => {
        const cleanDescription = p.description.replace(/<[^>]*>?/gm, "").slice(0, 100).trim();
        return `**${i + 1}. ${p.title}**\n\n💰 Price: ₹${p.price}\n\n📝 ${cleanDescription}...\n\n👉 [Order Now](${p.url})`;
      }).join("\n\n---\n\n");
    } else {
      productListText = getFallbackMessage(message);
    }

    const systemPrompt = `You are a helpful, friendly AI customer query assistant 🤖 for an online store. Recommend products based on live inventory data.

If relevant products are found:
- List them clearly with:
  - Product Name
  - Price
  - 1-sentence description
  - Direct link to buy (e.g., Order Now link)
  - Friendly tone

If no exact matches:
- Let the user know in a polite and encouraging way
- Offer to explore alternatives or similar products

Context:
${productListText}`;

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error("❌ Chatbot Error:", err.message);
    res.status(500).json({ reply: "😔 Sorry, I couldn’t fetch product details right now. Please try again later." });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});


