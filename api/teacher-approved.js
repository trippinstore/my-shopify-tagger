// api/teacher-approved.js

// Configuration codée en dur pour simplifier la lecture, 
// mais on utilisera process.env pour les secrets.
const TAG_TO_ADD = "teacher-approved";

export default async function handler(req, res) {
  // 1. Sécurité & Validation de méthode
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
    console.error("⚠️ Payload invalide : Email manquant.");
    return res.status(400).json({ error: 'Missing email' });
  }

  try {
    console.log(`🔍 Recherche du client : ${email}`);

    // 2. Chercher le customer ID via Shopify API
    // On demande juste l'ID et les tags pour être léger
    const shopUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}&fields=id,tags`;
    
    const searchRes = await fetch(shopUrl, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!searchRes.ok) {
      throw new Error(`Erreur Shopify Search: ${searchRes.statusText}`);
    }

    const searchData = await searchRes.json();

    if (searchData.customers.length === 0) {
      console.warn(`🤷 Client introuvable pour ${email}`);
      // On renvoie 200 pour que Klaviyo ne réessaie pas en boucle inutilement
      return res.status(200).json({ message: 'Customer not found in Shopify' });
    }

    const customer = searchData.customers[0];
    const currentTagsString = customer.tags || "";

    // 3. Logique de Tags (Idempotence & Nettoyage)
    // On transforme la string "tag1, tag 2" en tableau propre pour manipuler
    let tagsArray = currentTagsString.split(',').map(t => t.trim()).filter(t => t.length > 0);

    // Vérifier si le tag existe déjà
    if (tagsArray.includes(TAG_TO_ADD)) {
      console.log(`✅ Client ${customer.id} a déjà le tag. Aucune action.`);
      return res.status(200).json({ message: 'Tag already exists', skipped: true });
    }

    // Ajouter le nouveau tag
    tagsArray.push(TAG_TO_ADD);
    const newTagsString = tagsArray.join(', ');

    console.log(`📝 Mise à jour client ${customer.id}. Tags: "${currentTagsString}" -> "${newTagsString}"`);

    // 4. Mettre à jour Shopify
    const updateUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/customers/${customer.id}.json`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer: {
          id: customer.id,
          tags: newTagsString
        }
      })
    });

    if (!updateRes.ok) {
      const errDetail = await updateRes.text();
      throw new Error(`Erreur Shopify Update: ${errDetail}`);
    }

    console.log("🎉 Tags mis à jour avec succès.");
    return res.status(200).json({ success: true, tags: newTagsString });

  } catch (error) {
    console.error("❌ Erreur serveur:", error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
