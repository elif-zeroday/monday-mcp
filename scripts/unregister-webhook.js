"use strict";
/**
 * Script to list and delete webhooks from Monday.com
 *
 * Usage:
 *   List:   MONDAY_TOKEN=xxx npm run unregister-webhook
 *   Delete: MONDAY_TOKEN=xxx WEBHOOK_ID=xxx npm run unregister-webhook
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fetch_1 = __importDefault(require("node-fetch"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const WEBHOOK_ID = process.env.WEBHOOK_ID;
const SUBITEM_BOARD_ID = 18041802160;
async function listWebhooks() {
    console.log(`Listing webhooks for board ${SUBITEM_BOARD_ID}...`);
    console.log('');
    const query = `
    query ListWebhooks($boardId: [ID!]!) {
      boards(ids: $boardId) {
        webhooks {
          id
          event
          board_id
        }
      }
    }
  `;
    const response = await (0, node_fetch_1.default)(MONDAY_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': MONDAY_TOKEN,
            'API-Version': '2024-10',
        },
        body: JSON.stringify({
            query,
            variables: { boardId: [String(SUBITEM_BOARD_ID)] },
        }),
    });
    const result = (await response.json());
    if (result.errors) {
        console.error('GraphQL Errors:');
        result.errors.forEach(err => console.error(`  - ${err.message}`));
        return;
    }
    const webhooks = result.data?.boards?.[0]?.webhooks || [];
    if (webhooks.length === 0) {
        console.log('No webhooks found for this board.');
    }
    else {
        console.log('Webhooks:');
        webhooks.forEach(wh => {
            console.log(`  - ID: ${wh.id}, Event: ${wh.event}`);
        });
        console.log('');
        console.log('To delete a webhook, run:');
        console.log('  WEBHOOK_ID=<id> npm run unregister-webhook');
    }
}
async function deleteWebhook(webhookId) {
    console.log(`Deleting webhook ${webhookId}...`);
    const mutation = `
    mutation DeleteWebhook($webhookId: ID!) {
      delete_webhook(id: $webhookId) {
        id
      }
    }
  `;
    const response = await (0, node_fetch_1.default)(MONDAY_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': MONDAY_TOKEN,
            'API-Version': '2024-10',
        },
        body: JSON.stringify({
            query: mutation,
            variables: { webhookId },
        }),
    });
    const result = (await response.json());
    if (result.errors) {
        console.error('GraphQL Errors:');
        result.errors.forEach(err => console.error(`  - ${err.message}`));
        return;
    }
    if (result.data?.delete_webhook) {
        console.log(`✅ Webhook ${webhookId} deleted successfully!`);
    }
}
async function main() {
    if (!MONDAY_TOKEN) {
        console.error('ERROR: MONDAY_TOKEN environment variable is required');
        process.exit(1);
    }
    if (WEBHOOK_ID) {
        await deleteWebhook(WEBHOOK_ID);
    }
    else {
        await listWebhooks();
    }
}
main();
//# sourceMappingURL=unregister-webhook.js.map