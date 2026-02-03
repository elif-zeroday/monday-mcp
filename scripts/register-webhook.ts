/**
 * Script to register the webhook with Monday.com
 * 
 * NOTE: Webhooks cannot be created on subitem boards directly.
 * Instead, we create the webhook on the PARENT board (Feature Board)
 * and listen for 'change_subitem_column_value' events.
 * 
 * Usage: MONDAY_TOKEN=xxx WEBHOOK_URL=https://your-server.com/webhook npm run register-webhook
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// IMPORTANT: Webhook must be on the PARENT board, not subitem board
// Subitem boards don't support direct webhooks
const FEATURE_BOARD_ID = 18041801957;  // P2S (Feature Board) - parent of subitems

interface GraphQLResponse {
  data?: {
    create_webhook?: {
      id: string;
      board_id: string;
    };
  };
  errors?: Array<{ message: string }>;
}

async function registerWebhook(): Promise<void> {
  if (!MONDAY_TOKEN) {
    console.error('ERROR: MONDAY_TOKEN environment variable is required');
    process.exit(1);
  }
  
  if (!WEBHOOK_URL) {
    console.error('ERROR: WEBHOOK_URL environment variable is required');
    console.error('Example: WEBHOOK_URL=https://your-server.com/webhook');
    process.exit(1);
  }
  
  console.log('Registering webhook...');
  console.log(`  Parent Board ID: ${FEATURE_BOARD_ID} (P2S Feature Board)`);
  console.log(`  Webhook URL: ${WEBHOOK_URL}`);
  console.log(`  Event: change_subitem_column_value`);
  console.log('');
  console.log('NOTE: Webhook is on parent board because subitem boards');
  console.log('      do not support direct webhook creation.');
  console.log('');
  
  const mutation = `
    mutation CreateWebhook($boardId: ID!, $url: String!, $event: WebhookEventType!) {
      create_webhook(
        board_id: $boardId,
        url: $url,
        event: $event
      ) {
        id
        board_id
      }
    }
  `;
  
  const variables = {
    boardId: String(FEATURE_BOARD_ID),
    url: WEBHOOK_URL,
    event: 'change_subitem_column_value',  // Listen for subitem column changes
  };
  
  try {
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_TOKEN,
        'API-Version': '2024-10',
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
    
    const result = (await response.json()) as GraphQLResponse;
    
    if (result.errors) {
      console.error('GraphQL Errors:');
      result.errors.forEach(err => console.error(`  - ${err.message}`));
      process.exit(1);
    }
    
    if (result.data?.create_webhook) {
      console.log('✅ Webhook registered successfully!');
      console.log(`  Webhook ID: ${result.data.create_webhook.id}`);
      console.log(`  Board ID: ${result.data.create_webhook.board_id}`);
      console.log('');
      console.log('The webhook will trigger when any subitem column changes.');
      console.log('The handler filters for column: board_relation_mkw4vrjt (İlgili Task)');
    } else {
      console.error('Unexpected response:', JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Failed to register webhook:', error);
    process.exit(1);
  }
}

registerWebhook();
