// api/teacher-approved.js
import fetch from 'node-fetch'; // Décommenter si nécessaire en local

const TAG_TO_ADD = "teacher-approved";

// Nouvelle fonction pour obtenir un token temporaire (Client Credentials Flow)
async function getShopifyAccessToken() {
  const url = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`;
  
  const params = new URLSearchParams();
  params.append('client_id', process.env.SHOPIFY_CLIENT_ID);
  params.append('client_secret', process.env.SHOPIFY_CLIENT_SECRET);
  params.append('grant_type', 'client_credentials');

  const response = await fetch(url, {
    method: 'POST',
    body: params
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get access token: ${text}`);
  }

  const data = await response.json();
  return data.access_token; // Ce token est valide temporairement
}

export default async function handler(req, res) {
  // 1. Sécurité Webhook (Rien ne change ici)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    console.error("⛔ Accès refusé : Secret invalide.");
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  try {
    // 2. Authentification : Obtenir le token dynamique
    // On le fait à chaque requête pour garantir qu'il est valide (stateless)
    // En production intensive, on pourrait le mettre en cache, mais pour un webhook c'est négligeable.
    const accessToken = await getShopifyAccessToken();

    // 3. Recherche du client
    const shopUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}&fields=id,tags`;
    
    const searchRes = await fetch(shopUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken, // On utilise le token dynamique ici
        'Content-Type': 'application/json'
      }
    });

    if (!searchRes.ok) throw new Error(`Shopify Search Error: ${searchRes.statusText}`);

    const searchData = await searchRes.json();
    if (searchData.customers.length === 0) {
      return res.status(200).json({ message: 'Customer not found' });
    }

    const customer = searchData.customers[0];
    const currentTagsString = customer.tags || "";
    let tagsArray = currentTagsString.split(',').map(t => t.trim()).filter(t => t.length > 0);

    if (tagsArray.includes(TAG_TO_ADD)) {
      return res.status(200).json({ message: 'Tag already exists', skipped: true });
    }

    tagsArray.push(TAG_TO_ADD);
    const newTagsString = tagsArray.join(', ');

    // 4. Mise à jour
    const updateUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/customers/${customer.id}.json`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken, // Et ici aussi
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer: { id: customer.id, tags: newTagsString }
      })
    });

    if (!updateRes.ok) throw new Error(`Shopify Update Error: ${await updateRes.text()}`);

    return res.status(200).json({ success: true, tags: newTagsString });

  } catch (error) {
    console.error("❌ Erreur:", error);
    return res.status(500).json({ error: error.message });
  }
}
