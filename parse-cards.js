const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// File paths
const DB_PATH = path.join(__dirname, 'cards.db');
const SORTS_PATH = path.join(__dirname, 'sorts.json');
const OUTPUT_PATH = path.join(__dirname, 'cards.json');

// Lorcast API Endpoint for all cards
const LORCAST_API_URL = 'https://api.lorcast.com/v0/cards/search?q=""';

// Helper function to create a standardized match key
function createMatchKey(name, version) {
    const cleanName = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanVersion = (version || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${cleanName}_${cleanVersion}`;
}

async function main() {
    try {
        // 1. Verify local files exist
        if (!fs.existsSync(DB_PATH) || !fs.existsSync(SORTS_PATH)) {
            console.error("🚨 Error: Make sure both 'cards.db' and 'sorts.json' are in the same folder as this script.");
            process.exit(1);
        }

        // 2. Fetch Lorcast Data
        console.log('🌐 Fetching card metadata (images & prices) from Lorcast API...');
        const response = await fetch(LORCAST_API_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch from Lorcast: ${response.statusText}`);
        }
        const lorcastData = await response.json();

        // Handle Lorcast pagination/results structure
        const lorcastCards = lorcastData.results || lorcastData.data || lorcastData;
        if (!Array.isArray(lorcastCards)) {
            console.error("🚨 Error: Unexpected Lorcast API response format.");
            process.exit(1);
        }
        console.log(`📸 Downloaded data for ${lorcastCards.length} items from Lorcast.`);

        // 3. Build Lorcast Metadata Map for O(1) matching
        console.log('⚡ Building external metadata lookup map...');
        const lorcastMap = new Map();
        lorcastCards.forEach(card => {
            const key = createMatchKey(card.name, card.version);

            // Extract the normal digital image URL safely
            let imageUrl = null;
            if (card.image_uris && card.image_uris.digital) {
                imageUrl = card.image_uris.digital.normal || card.image_uris.digital.small || null;
            }

            // Extract the prices structure safely
            let prices = {
                usd: null,
                usd_foil: null
            };
            if (card.prices) {
                prices.usd = card.prices.usd || null;
                prices.usd_foil = card.prices.usd_foil || null;
            }

            lorcastMap.set(key, { imageUrl, prices });
        });

        // 4. Load Popularity Sorts
        console.log('🔄 Loading sorts.json...');
        const sortsData = JSON.parse(fs.readFileSync(SORTS_PATH, 'utf8'));

        if (!sortsData.trending || !Array.isArray(sortsData.trending)) {
            console.error("🚨 Error: Could not find a 'trending' array inside sorts.json.");
            process.exit(1);
        }

        // 5. Build Popularity Rank Map
        console.log('⚡ Building rank lookup map...');
        const rankMap = new Map();
        sortsData.trending.forEach((id, index) => {
            rankMap.set(id, index + 1);
        });

        // 6. Connect to SQLite DB
        console.log('🗄️  Connecting to cards.db...');
        const db = new Database(DB_PATH, { readonly: true });

        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
        if (!tableCheck) {
            console.error("🚨 Error: The database has no readable tables.");
            process.exit(1);
        }
        const tableName = tableCheck.name;

        console.log(`🔍 Fetching rows from database table "${tableName}"...`);
        const dbCards = db.prepare(`SELECT * FROM ${tableName}`).all();

        // 7. Process & Combine everything
        console.log('🛠️  Merging database entries with ranks, images, and prices...');
        let matchCount = 0;

        const processedCards = dbCards.map(card => {
            const cardId = card.id;

            // Popularity calculation
            let popularRank = 99999;
            if (rankMap.has(cardId)) {
                popularRank = rankMap.get(cardId);
            }

            // External Lorcast fields matching
            const dbVersionIdentifier = card.title || card.subtitle || '';
            const matchKey = createMatchKey(card.name, dbVersionIdentifier);

            let imageUrl = null;
            let prices = { usd: null, usd_foil: null };

            if (lorcastMap.has(matchKey)) {
                const matchData = lorcastMap.get(matchKey);
                imageUrl = matchData.imageUrl;
                prices = matchData.prices;
                matchCount++;
            }

            return {
                ...card,
                popularRank: popularRank,
                image_url: imageUrl,
                prices: prices
            };
        });

        db.close();
        console.log(`🎯 Successfully matched imagery and price data for ${matchCount}/${dbCards.length} cards.`);

        // 8. Write Output
        console.log(`💾 Saving enriched dataset to ${OUTPUT_PATH}...`);
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(processedCards, null, 2), 'utf8');

        console.log('🎉 Done! Processing complete.');

    } catch (error) {
        console.error('🚨 An unexpected error occurred:', error);
    }
}

main();