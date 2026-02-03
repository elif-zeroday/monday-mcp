# Monday.com Subitem Link Automation

This automation syncs subitem-to-main links with parent-to-main links in Monday.com.

## What It Does

When a **Subitem** (from P2S Feature Board subitems) gets linked to a **Main Agile Item** via the "İlgili Task" column:

→ The automation automatically ensures that the same Main Agile Item is also linked to the **Subitem's Parent** (Feature item) via the "İlgili Epic" column.

### Board Structure

```
P2S Feature Board (18041801957)
  └── Subitems Board (18041802160)
        └── board_relation_mkw4vrjt ("İlgili Task") ──→ Main Agile Board (18012438587)
                                                           └── board_relation_mkw8vvdh ("İlgili Epic")
```

## Quick Start

### 1. Install Dependencies

```bash
cd /Users/elifkeskin/Desktop/MondayMCP
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and set your MONDAY_TOKEN
```

Get your Monday.com API token from: https://zerodayteam.monday.com/admin/apps/api

### 3. Test Locally (Dry Run)

```bash
# Test with a specific subitem without making changes
DRY_RUN=true SUBITEM_ID=18050734484 npx ts-node scripts/test-webhook.ts
```

### 4. Build & Deploy

```bash
npm run build
```

#### Hosting Options (Recommended: Render.com)

**Option A: Render.com (Simplest)**
1. Create account at https://render.com
2. New → Web Service → Connect GitHub repo
3. Settings:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Environment Variables: Add `MONDAY_TOKEN`
4. Deploy and note the URL (e.g., `https://your-service.onrender.com`)

**Option B: Railway.app**
1. Create account at https://railway.app
2. New Project → Deploy from GitHub
3. Add environment variable `MONDAY_TOKEN`
4. Get your public URL from settings

**Option C: Vercel (Serverless)**
Requires adapting to Vercel serverless functions format.

### 5. Register Webhook

```bash
# Set your deployed URL
WEBHOOK_URL=https://your-server.com/webhook npm run register-webhook
```

This registers a webhook on board 18041802160 for `change_column_value` events.

### 6. Verify

1. Go to Monday.com
2. Navigate to P2S Feature Board
3. Open a subitem
4. Link it to a Main Agile item via "İlgili Task" column
5. Check the Main Agile item - the parent Feature should now be linked in "İlgili Epic"

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONDAY_TOKEN` | Yes | Your Monday.com API token |
| `PORT` | No | Server port (default: 3000) |
| `DRY_RUN` | No | Set to `true` to log without making changes |
| `WEBHOOK_SIGNING_SECRET` | No | For webhook signature verification |

### Dry-Run Mode

Enable dry-run mode to test the automation without making actual changes:

```bash
DRY_RUN=true npm start
```

In dry-run mode, the server will:
- Process all webhook events normally
- Log what changes would be made
- Skip the actual Monday.com API update calls

## Testing

### Test with Sample Subitems

```bash
# Test subitem 18050734484
DRY_RUN=true SUBITEM_ID=18050734484 npx ts-node scripts/test-webhook.ts

# Test subitem 18050735105
DRY_RUN=true SUBITEM_ID=18050735105 npx ts-node scripts/test-webhook.ts
```

### Simulate Webhook Event

You can also send a test webhook payload to your running server:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "boardId": 18041802160,
      "pulseId": 18050734484,
      "columnId": "board_relation_mkw4vrjt",
      "columnType": "board_relation",
      "value": {
        "linkedPulseIds": [{"linkedPulseId": 12345678}]
      }
    }
  }'
```

## Webhook Management

### List Webhooks

```bash
npm run unregister-webhook
```

### Delete a Webhook

```bash
WEBHOOK_ID=<id> npm run unregister-webhook
```

## Token Rotation

To safely rotate your Monday.com API token:

1. Generate a new token from Monday.com admin panel
2. Update the `MONDAY_TOKEN` in your deployment environment
3. Restart the service
4. Verify the webhook is still working
5. Revoke the old token from Monday.com

## Architecture

```
┌─────────────────┐      ┌───────────────────┐      ┌─────────────────┐
│   Monday.com    │      │  Webhook Server   │      │  Monday.com     │
│   (Subitem)     │─────▶│  (Node.js)        │─────▶│  API            │
│                 │      │                   │      │                 │
│  Change column  │      │  1. Validate      │      │  Update main    │
│  relation       │      │  2. Get parent    │      │  item links     │
│                 │      │  3. Merge links   │      │                 │
└─────────────────┘      └───────────────────┘      └─────────────────┘
```

## Files

```
.
├── src/
│   ├── index.ts          # Express server entry point
│   ├── config.ts         # Configuration and validation
│   ├── logger.ts         # Structured logging
│   ├── monday-client.ts  # Monday.com GraphQL API client
│   └── webhook-handler.ts # Webhook event processing logic
├── scripts/
│   ├── register-webhook.ts   # Register webhook with Monday
│   ├── unregister-webhook.ts # List/delete webhooks
│   └── test-webhook.ts       # Test the handler locally
├── .env.example          # Environment template
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Troubleshooting

### Webhook Not Triggering

1. Check that the webhook is registered: `npm run unregister-webhook` (lists webhooks)
2. Verify the server is accessible from the internet
3. Check the server logs for incoming requests

### Updates Not Working

1. Enable dry-run mode and check the logs
2. Verify the MONDAY_TOKEN has write permissions
3. Check that the board/column IDs match

### Duplicate Links

The automation includes deduplication - it will skip updates if the parent is already linked. Check logs for "skipping" messages.

## GraphQL Queries Used

### Get Subitem with Parent
```graphql
query GetSubitemWithParent($itemId: [ID!]!) {
  items(ids: $itemId) {
    id
    name
    parent_item {
      id
      board { id }
    }
    column_values(ids: ["board_relation_mkw4vrjt"]) {
      id
      value
    }
  }
}
```

### Get Main Item Links
```graphql
query GetMainItemLinks($itemId: [ID!]!) {
  items(ids: $itemId) {
    id
    column_values(ids: ["board_relation_mkw8vvdh"]) {
      id
      value
    }
  }
}
```

### Update Main Item Links
```graphql
mutation UpdateMainItemLinks($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(
    board_id: $boardId,
    item_id: $itemId,
    column_id: $columnId,
    value: $value
  ) {
    id
  }
}
```

### Create Webhook
```graphql
mutation CreateWebhook($boardId: ID!, $url: String!, $event: WebhookEventType!) {
  create_webhook(board_id: $boardId, url: $url, event: $event) {
    id
    board_id
  }
}
```
